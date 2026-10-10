import type { Client } from '@libsql/client';
import type { Actor } from '#lib/server/auth/actor.ts';
import {
	addDays,
	addMinutes,
	isIsoDate,
	nowLocal,
	onStep,
	STEP_MINUTES,
} from '#lib/server/dates.ts';
import {
	createEquipment,
	EQUIPMENT_STATUSES,
	type EquipmentStatus,
	type EquipmentView,
	getEquipment,
	listEquipment,
	resumeEquipment,
	SUSPEND_REASONS,
	type SuspendReason,
	suspendEquipment,
} from '#lib/server/domain/equipment.ts';
import { extendLoan, lendEquipment, type LoanView, returnLoan } from '#lib/server/domain/loans.ts';
import { listMasters, type MasterEntry } from '#lib/server/domain/masters.ts';
import { getMyPage } from '#lib/server/domain/me.ts';
import {
	cancelReservation,
	createReservation,
	listUpcomingForEquipment,
	type ReservationView,
} from '#lib/server/domain/reservations.ts';
import { AppError, ErrorCode, ValidationError } from '#lib/server/errors.ts';
import { type Body, Checker } from '#lib/server/http/validate.ts';
import {
	EQUIPMENT_LIMITS,
	LEND_NOTE_MAX,
	MASTER_NAME_MAX,
	PERSON_REF_MAX,
	RESERVATION_ID_MAX,
	RESERVATION_PURPOSE_MAX,
	RETURN_NOTE_MAX,
	SEARCH_MAX,
	SUSPEND_NOTE_MAX,
} from '#lib/limits.ts';
import { ToolArgs } from './args.ts';
import { type PersonRef, resolvePersonRef } from './people.ts';
import { equipmentArg, equipmentByTag, masterArg, openLoanId, withArgNames } from './refs.ts';

// AI assistant tools (MCP). The platform gateway speaks MCP and OAuth; the app
// only sees POST /api/mcp/<tool> with the tool arguments as the JSON body
// (routes/api/mcp/[tool]/+server.ts). Each tool reads its arguments with
// ToolArgs (args.ts) and calls the business layer, which keeps every rule,
// permission check and history entry — no SQL here.
//
// The tools are declared a second time in keelson.yaml (`mcp.tools`: name,
// description, input schema, access, permission); tests/mcp.test.ts keeps
// the two in step. Arguments and results use snake_case keys; field errors
// from the business layer (camelCase) are renamed to the argument they are
// about (refs.ts `argName`). Results stay small: lists carry `limit` rows at most plus `total`
// and `truncated`.

export interface McpToolContext {
	db: Client;
	actor: Actor;
	args: Body;
}

export interface McpTool {
	/** `read` tools change nothing (listed as read-only to the assistant). */
	access: 'read' | 'write';
	/** `manage`: admins only (also checked by the route and the business layer). */
	permission: 'view' | 'manage';
	run(ctx: McpToolContext): Promise<unknown>;
}

/** Upcoming bookings shown with one piece of equipment. */
const DETAIL_RESERVATIONS = 5;
/** Leading characters of an equipment note shown to admins. */
const NOTE_EXCERPT = 200;
/** A due time given as a date only is this time of that day (D-26). */
const DEFAULT_DUE_TIME = '18:00';
/** A booking without an end lasts this long (D-26). */
const DEFAULT_RESERVATION_MINUTES = 60;

// --- Arguments ---------------------------------------------------------------

function tool(
	access: McpTool['access'],
	permission: McpTool['permission'],
	run: (ctx: McpToolContext) => Promise<unknown>,
): McpTool {
	return {
		access,
		permission,
		run: (ctx) => withArgNames(() => run(ctx)),
	};
}

/** A due time: `YYYY-MM-DDTHH:MM`, or a date meaning that day at 18:00. */
function dueArg(c: Checker, args: Body, key: string, required: boolean): string | null {
	const raw = args[key];
	if (typeof raw === 'string' && isIsoDate(raw.trim())) {
		return `${raw.trim()}T${DEFAULT_DUE_TIME}`;
	}
	return required ? c.datetime(key, { required: true }) : c.datetime(key);
}

/**
 * A free-period filter from `available_from` / `available_to`: both or
 * neither; a date alone means the whole day (from its start / to its end).
 */
function periodArg(c: Checker, args: Body): { from: string; to: string } | null {
	const read = (key: string, endOfDay: boolean): string | null => {
		const raw = args[key];
		if (typeof raw === 'string' && isIsoDate(raw.trim())) {
			return `${endOfDay ? addDays(raw.trim(), 1) : raw.trim()}T00:00`;
		}
		return c.datetime(key);
	};
	const from = read('available_from', false);
	const to = read('available_to', true);
	if (from === null && to === null) {
		return null;
	}
	if (from === null) {
		c.fail('available_from', 'required');
		return null;
	}
	if (to === null) {
		c.fail('available_to', 'required');
		return null;
	}
	if (to <= from) {
		c.fail('available_to', 'before_start');
		return null;
	}
	return { from, to };
}

async function personArg(db: Client, actor: Actor, ref: string | null): Promise<PersonRef | null> {
	return ref === null ? null : resolvePersonRef(db, actor, ref);
}

/** Today at 18:00, or tomorrow at 18:00 once that has passed (D-26). */
export function defaultDueAt(now: string): string {
	const todayDue = `${now.slice(0, 10)}T${DEFAULT_DUE_TIME}`;
	return todayDue > now ? todayDue : `${addDays(now.slice(0, 10), 1)}T${DEFAULT_DUE_TIME}`;
}

/** The next booking step: now if it is on one, else the following one (D-26). */
export function nextStep(now: string): string {
	if (onStep(now)) {
		return now;
	}
	const minute = Number(now.slice(14, 16));
	return addMinutes(now, STEP_MINUTES - (minute % STEP_MINUTES));
}

// --- Results -----------------------------------------------------------------

function list<T>(items: T[], total: number): { total: number; truncated: boolean; items: T[] } {
	return { total, truncated: total > items.length, items };
}

/** One piece of equipment, the facts the assistant needs to answer with. */
function equipmentRow(e: EquipmentView, now: string) {
	const next = e.bands
		.filter((b) => b.kind === 'reservation' && b.end > now)
		.sort((a, b) => a.start.localeCompare(b.start))[0];
	return {
		id: e.id,
		asset_tag: e.assetTag,
		name: e.name,
		type: e.typeName,
		location: e.locationName,
		status: e.status,
		suspended_reason: e.suspendedReason,
		borrower: e.loan?.name ?? null,
		borrowed_by_me: e.loan?.mine ?? false,
		due_at: e.loan?.dueAt ?? null,
		next_reservation: next
			? { starts_at: next.start, ends_at: next.end, person: next.name, mine: next.mine }
			: null,
	};
}

function equipmentSummary(e: EquipmentView) {
	return {
		id: e.id,
		asset_tag: e.assetTag,
		name: e.name,
		type: e.typeName,
		location: e.locationName,
		status: e.status,
		suspended_reason: e.suspendedReason,
		borrower: e.loan?.name ?? null,
		due_at: e.loan?.dueAt ?? null,
	};
}

function reservationRow(r: ReservationView) {
	return {
		reservation_id: r.id,
		asset_tag: r.assetTag,
		name: r.equipmentName,
		person: r.name,
		mine: r.mine,
		starts_at: r.startsAt,
		ends_at: r.endsAt,
		purpose: r.purpose,
		status: r.status,
		current: r.current,
	};
}

function loanRow(l: LoanView) {
	return {
		loan_id: l.id,
		asset_tag: l.assetTag,
		name: l.equipmentName,
		borrower: l.name,
		mine: l.mine,
		lent_at: l.lentAt,
		due_at: l.dueAt,
		overdue: l.overdue,
	};
}

// --- Tools -------------------------------------------------------------------

async function findEquipmentTool({ db, actor, args }: McpToolContext) {
	const c = new ToolArgs(args);
	const q = c.text('q', { max: SEARCH_MAX });
	const statuses = c.values<EquipmentStatus>('status', EQUIPMENT_STATUSES);
	const typeName = c.text('type', { max: MASTER_NAME_MAX });
	const locationName = c.text('location', { max: MASTER_NAME_MAX });
	const free = periodArg(c, args);
	const limit = c.limit();
	const masters = await listMasters(db);
	const typeId = masterArg(c, 'type', masters.types, typeName, 'search');
	const locationId = masterArg(c, 'location', masters.locations, locationName, 'search');
	c.done();
	const result = await listEquipment(db, actor, {
		q,
		statuses,
		typeId,
		noType: false,
		locationId,
		bookable: false,
		free,
		ids: [],
		sort: 'tag',
		dir: 'asc',
		page: 1,
		size: limit,
	});
	return list(
		result.rows.map((e) => equipmentRow(e, result.window.now)),
		result.total,
	);
}

async function getEquipmentTool({ db, actor, args }: McpToolContext) {
	const c = new ToolArgs(args);
	const id = await equipmentArg(db, c);
	c.done();
	const [{ equipment: e, window }, upcoming] = await Promise.all([
		getEquipment(db, actor, id),
		listUpcomingForEquipment(db, actor, id),
	]);
	const admin = actor.isAdmin
		? {
				serial_no: e.serialNo ?? null,
				note: e.note ? e.note.slice(0, NOTE_EXCERPT) : null,
				note_truncated: (e.note?.length ?? 0) > NOTE_EXCERPT,
				suspended_note: e.suspendedNote ?? null,
			}
		: {};
	return {
		...equipmentRow(e, window.now),
		...admin,
		loan: e.loan
			? {
					borrower: e.loan.name,
					mine: e.loan.mine,
					lent_at: e.loan.lentAt,
					due_at: e.loan.dueAt,
					overdue: e.loan.overdue,
				}
			: null,
		reservations: list(upcoming.slice(0, DETAIL_RESERVATIONS).map(reservationRow), upcoming.length),
	};
}

async function myLoansTool({ db, actor, args }: McpToolContext) {
	const c = new ToolArgs(args);
	const limit = c.limit();
	c.done();
	const page = await getMyPage(db, actor);
	return list(page.loans.slice(0, limit).map(loanRow), page.loans.length);
}

async function myReservationsTool({ db, actor, args }: McpToolContext) {
	const c = new ToolArgs(args);
	const limit = c.limit();
	c.done();
	const page = await getMyPage(db, actor);
	return list(
		page.reservations.slice(0, limit).map((r) => ({
			...reservationRow(r),
			can_pick_up: r.canPickUp,
			blocked: r.blocked,
			suspended_reason: r.suspendedReason,
		})),
		page.reservations.length,
	);
}

async function listMastersTool({ db }: McpToolContext) {
	const masters = await listMasters(db);
	const names = (entries: MasterEntry[]) =>
		entries.map((e) => ({ name: e.name, active: e.active }));
	return { types: names(masters.types), locations: names(masters.locations) };
}

async function registerEquipmentTool({ db, actor, args }: McpToolContext) {
	const c = new ToolArgs(args);
	const assetTag = c.text('asset_tag', { max: EQUIPMENT_LIMITS.assetTag, required: true });
	const name = c.text('name', { max: EQUIPMENT_LIMITS.name, required: true });
	const serialNo = c.text('serial_no', { max: EQUIPMENT_LIMITS.serialNo });
	const note = c.text('note', { max: EQUIPMENT_LIMITS.note });
	const typeName = c.text('type', { max: MASTER_NAME_MAX });
	const locationName = c.text('location', { max: MASTER_NAME_MAX });
	const masters = await listMasters(db);
	const typeId = masterArg(c, 'type', masters.types, typeName, 'write');
	const locationId = masterArg(c, 'location', masters.locations, locationName, 'write');
	c.done();
	const created = await createEquipment(db, actor, {
		assetTag,
		name,
		typeId,
		serialNo,
		locationId,
		note,
	});
	return equipmentSummary(created);
}

async function lendEquipmentTool({ db, actor, args }: McpToolContext) {
	const c = new ToolArgs(args);
	const equipmentId = await equipmentArg(db, c);
	const due = dueArg(c, args, 'due_at', false);
	const note = c.text('note', { max: LEND_NOTE_MAX });
	const ref = c.text('person', { max: PERSON_REF_MAX });
	c.done();
	const person = await personArg(db, actor, ref);
	const loan = await lendEquipment(db, actor, {
		equipmentId,
		userId: person?.id ?? null,
		dueAt: due ?? defaultDueAt(nowLocal()),
		note,
		reservationId: null,
	});
	return { ...loanRow(loan), picked_up_reservation_id: loan.reservationId };
}

async function returnEquipmentTool({ db, actor, args }: McpToolContext) {
	const c = new ToolArgs(args);
	const equipmentId = await equipmentArg(db, c);
	const note = c.text('note', { max: RETURN_NOTE_MAX });
	const locationName = c.text('location', { max: MASTER_NAME_MAX });
	const needsRepair = c.flag('needs_repair') === true;
	const locationId =
		locationName === null
			? null
			: masterArg(c, 'location', (await listMasters(db)).locations, locationName, 'write');
	c.done();
	const loan = await returnLoan(db, actor, await openLoanId(db, actor, equipmentId), {
		note,
		locationId,
		suspend: needsRepair ? { reason: 'repair', note } : null,
	});
	return {
		...loanRow(loan),
		returned_at: loan.returnedAt,
		return_kind: loan.returnKind,
		location: loan.returnLocationName,
		suspended_reason: loan.suspendedReason,
	};
}

async function extendLoanTool({ db, actor, args }: McpToolContext) {
	const c = new ToolArgs(args);
	const equipmentId = await equipmentArg(db, c);
	const dueAt = dueArg(c, args, 'due_at', true) as string;
	c.done();
	return loanRow(await extendLoan(db, actor, await openLoanId(db, actor, equipmentId), dueAt));
}

async function reserveEquipmentTool({ db, actor, args }: McpToolContext) {
	const c = new ToolArgs(args);
	const equipmentId = await equipmentArg(db, c);
	const startsArg = c.datetime('starts_at');
	const endsArg = c.datetime('ends_at');
	const purpose = c.text('purpose', { max: RESERVATION_PURPOSE_MAX });
	const ref = c.text('person', { max: PERSON_REF_MAX });
	c.done();
	const person = await personArg(db, actor, ref);
	const startsAt = startsArg ?? nextStep(nowLocal());
	const reservation = await createReservation(db, actor, {
		equipmentId,
		userId: person?.id ?? null,
		startsAt,
		endsAt: endsArg ?? addMinutes(startsAt, DEFAULT_RESERVATION_MINUTES),
		purpose,
	});
	return reservationRow(reservation);
}

async function cancelReservationTool({ db, actor, args }: McpToolContext) {
	const c = new ToolArgs(args);
	let reservationId = c.text('reservation_id', { max: RESERVATION_ID_MAX });
	const tag = c.text('asset_tag', { max: EQUIPMENT_LIMITS.assetTag });
	const startsAt = c.datetime('starts_at');
	if (reservationId === null && tag === null) {
		c.fail('asset_tag', 'required');
	}
	const equipmentId = tag === null ? null : await equipmentByTag(db, c, tag);
	c.done();
	if (reservationId === null && equipmentId !== null) {
		// By equipment: the booking starting then (anyone's; cancelling checks
		// ownership), or else the caller's one upcoming booking of it.
		const upcoming = await listUpcomingForEquipment(db, actor, equipmentId);
		const hits = upcoming.filter((r) => (startsAt === null ? r.mine : r.startsAt === startsAt));
		if (hits.length === 0) {
			throw new AppError(ErrorCode.ReservationNotFound);
		}
		if (hits.length > 1) {
			throw new ValidationError({ starts_at: 'required' });
		}
		reservationId = hits[0].id;
	}
	return reservationRow(await cancelReservation(db, actor, reservationId as string));
}

async function suspendEquipmentTool({ db, actor, args }: McpToolContext) {
	const c = new ToolArgs(args);
	const equipmentId = await equipmentArg(db, c);
	const reason = c.oneOf<SuspendReason>('reason', SUSPEND_REASONS);
	const detail = c.text('detail', { max: SUSPEND_NOTE_MAX });
	c.done();
	return equipmentSummary(await suspendEquipment(db, actor, equipmentId, reason, detail));
}

async function resumeEquipmentTool({ db, actor, args }: McpToolContext) {
	const c = new ToolArgs(args);
	const equipmentId = await equipmentArg(db, c);
	c.done();
	return equipmentSummary(await resumeEquipment(db, actor, equipmentId));
}

/** Every tool, by the name declared in keelson.yaml `mcp.tools`. */
export const MCP_TOOLS: Record<string, McpTool> = {
	find_equipment: tool('read', 'view', findEquipmentTool),
	get_equipment: tool('read', 'view', getEquipmentTool),
	my_loans: tool('read', 'view', myLoansTool),
	my_reservations: tool('read', 'view', myReservationsTool),
	list_masters: tool('read', 'view', listMastersTool),
	register_equipment: tool('write', 'manage', registerEquipmentTool),
	lend_equipment: tool('write', 'view', lendEquipmentTool),
	return_equipment: tool('write', 'view', returnEquipmentTool),
	extend_loan: tool('write', 'view', extendLoanTool),
	reserve_equipment: tool('write', 'view', reserveEquipmentTool),
	cancel_reservation: tool('write', 'view', cancelReservationTool),
	suspend_equipment: tool('write', 'manage', suspendEquipmentTool),
	resume_equipment: tool('write', 'manage', resumeEquipmentTool),
};
