import type { Client, InStatement, Row } from '@libsql/client';
import type { Actor } from '#lib/server/auth/actor.ts';
import { requireAdmin } from '#lib/server/auth/guard.ts';
import { addDays, nowIso, nowLocal } from '#lib/server/dates.ts';
import { type NamedArgs, namedList, namedStatement } from '#lib/server/db/named.ts';
import { num, numOrNull, str, strOrNull } from '#lib/server/db/rows.ts';
import { AppError, ErrorCode, type FieldErrors, ValidationError } from '#lib/server/errors.ts';
import { likePattern } from '#lib/server/db/like.ts';
import { type EventInput, eventAfterChangeStatement } from './events.ts';
import { findActiveMaster } from './masters.ts';
import {
	imageUrlOf,
	type Membership,
	membershipOf,
	type PeopleIndex,
	peopleIndex,
} from './directory.ts';

// Equipment (the ledger). A piece of equipment never stores who has it or who
// booked it: the current borrower is the loan row with returned_at IS NULL
// (loans.ts) and the bookings are the active reservations (reservations.ts),
// joined in at read time.
//
// Everyone may read the ledger (it is a shared pool); what a member sees is
// narrowed by `forViewer`.

export const EQUIPMENT_STATUSES = [
	'available',
	'on_loan',
	'reserved',
	'overdue',
	'suspended',
] as const;
export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];

export const SUSPEND_REASONS = ['repair', 'broken', 'lost', 'other'] as const;
export type SuspendReason = (typeof SUSPEND_REASONS)[number];

export const EQUIPMENT_SORTS = [
	'tag',
	'name',
	'status',
	'type',
	'location',
	'borrower',
	'due',
	'updated',
] as const;
export type EquipmentSort = (typeof EQUIPMENT_SORTS)[number];

/**
 * Editable equipment fields: the register and edit forms, the API bodies, the
 * CSV import and the AI assistant's register_equipment. EquipmentView carries
 * them too.
 */
export interface EquipmentFields {
	assetTag: string;
	name: string;
	typeId: number | null;
	serialNo: string | null;
	locationId: number | null;
	note: string | null;
}

/**
 * The equipment column of each field. The ledger SELECT (EQUIPMENT_COLUMNS_SQL),
 * the INSERT (equipmentInsertStatements), the edit's UPDATE and its before /
 * after are built from this, so a new field is added here once.
 */
const FIELD_COLUMNS: Record<keyof EquipmentFields, string> = {
	assetTag: 'asset_tag',
	name: 'name',
	typeId: 'type_id',
	serialNo: 'serial_no',
	locationId: 'location_id',
	note: 'note',
};

const FIELD_KEYS = Object.keys(FIELD_COLUMNS) as (keyof EquipmentFields)[];

/** The editable fields a member's view leaves out (forViewer). */
type AdminOnlyField = 'serialNo' | 'note';

/** Who has it out now. `userId` / `email` only for admins. */
export interface CurrentLoan {
	id: string;
	name: string;
	/** The borrower's current profile image (see `withLoanDirectoryInfo`); null when none / former. */
	imageUrl: string | null;
	/** Whether the borrower is still a member (see `withLoanDirectoryInfo`; DESIGN.md §8.10). */
	membership: Membership;
	mine: boolean;
	lentAt: string;
	dueAt: string;
	overdue: boolean;
	userId?: string;
	email?: string | null;
}

/** The booking that covers the current time, if any. `userId` only for admins. */
export interface CurrentReservation {
	id: string;
	name: string;
	mine: boolean;
	startsAt: string;
	endsAt: string;
	userId?: string;
}

/** One occupied stretch on the 7-day availability strip (DESIGN.md §9-A). */
export interface Band {
	kind: 'loan' | 'reservation';
	start: string;
	end: string;
	name: string;
	mine: boolean;
	overdue: boolean;
}

/**
 * One ledger row. The admin-only fields are absent from a member's view
 * (forViewer): serial number, note, suspension detail, version.
 */
export interface EquipmentView
	extends Omit<EquipmentFields, AdminOnlyField>, Partial<Pick<EquipmentFields, AdminOnlyField>> {
	id: number;
	typeName: string | null;
	locationName: string | null;
	status: EquipmentStatus;
	suspendedReason: SuspendReason | null;
	loan: CurrentLoan | null;
	reservedNow: CurrentReservation | null;
	bands: Band[];
	updatedAt: string;
	suspendedNote?: string | null;
	version?: number;
}

/** The 7 days the availability strip shows, and the time it was drawn at. */
export interface StripWindow {
	days: string[];
	now: string;
}

// The SQL fragments below are shared with home.ts.

// The booking that covers :now (bookings never overlap, so at most one).
const RESERVED_NOW_SQL = `(SELECT r.id FROM reservations r WHERE r.equipment_id = e.id
	AND r.status = 'active' AND r.starts_at <= :now AND r.ends_at > :now LIMIT 1)`;

// The shared FROM clause: equipment + type + location + open loan + the
// booking that covers now.
export const EQUIPMENT_FROM_SQL = `FROM equipment e
	LEFT JOIN equipment_types t ON t.id = e.type_id
	LEFT JOIN locations l ON l.id = e.location_id
	LEFT JOIN loans o ON o.equipment_id = e.id AND o.returned_at IS NULL
	LEFT JOIN reservations rn ON rn.id = ${RESERVED_NOW_SQL}`;

// Display status, one per row: suspended > overdue > on loan > reserved now >
// available (a suspended piece can still be out; the borrower column shows who).
const STATUS_SQL = `CASE
	WHEN e.suspended_reason IS NOT NULL THEN 'suspended'
	WHEN o.id IS NOT NULL AND o.due_at < :now THEN 'overdue'
	WHEN o.id IS NOT NULL THEN 'on_loan'
	WHEN rn.id IS NOT NULL THEN 'reserved'
	ELSE 'available' END`;

// Last activity on the equipment, its loans or its bookings (the "updated" column).
const UPDATED_SQL = `MAX(e.updated_at,
	COALESCE((SELECT MAX(x.updated_at) FROM loans x WHERE x.equipment_id = e.id), ''),
	COALESCE((SELECT MAX(y.updated_at) FROM reservations y WHERE y.equipment_id = e.id), ''))`;

// A row with its type, location, open loan and current booking:
// `SELECT ${EQUIPMENT_COLUMNS_SQL} ${EQUIPMENT_FROM_SQL} WHERE …`. The equipment
// fields (e.asset_tag, e.name, … e.note) come from FIELD_COLUMNS; the rest are written out.
const EQUIPMENT_COLUMNS_SQL = `e.id, ${FIELD_KEYS.map((k) => `e.${FIELD_COLUMNS[k]}`).join(', ')},
	t.name AS type_name, l.name AS location_name, e.suspended_reason, e.suspended_note, e.version,
	o.id AS loan_id, o.user_id AS loan_user_id, o.user_name AS loan_user_name,
	o.user_email AS loan_user_email, o.lent_at, o.due_at,
	CASE WHEN o.due_at < :now THEN 1 ELSE 0 END AS loan_overdue,
	rn.id AS res_id, rn.user_id AS res_user_id, rn.user_name AS res_user_name,
	rn.starts_at AS res_starts_at, rn.ends_at AS res_ends_at,
	${STATUS_SQL} AS status,
	${UPDATED_SQL} AS last_activity`;

// Filter predicates per status (a row matches if it matches any selected
// status). Conditions, not the display status: "reserved" here is any active
// booking still to come, while the display status says "reserved" only while
// a booking covers the current time.
export const STATUS_PREDICATE: Record<EquipmentStatus, string> = {
	available: '(e.suspended_reason IS NULL AND o.id IS NULL AND rn.id IS NULL)',
	on_loan: '(o.id IS NOT NULL)',
	reserved: `EXISTS (SELECT 1 FROM reservations r2 WHERE r2.equipment_id = e.id
		AND r2.status = 'active' AND r2.ends_at > :now)`,
	overdue: '(o.id IS NOT NULL AND o.due_at < :now)',
	suspended: '(e.suspended_reason IS NOT NULL)',
};

// Free to book for [:freeFrom, :freeTo): not suspended, and no overlap by the
// same rule a booking checks (reservations.ts OVERLAP_SQL: another active
// booking, or an open loan still within its due time that runs past the
// start). Keep the two in step.
const FREE_SQL = `(e.suspended_reason IS NULL
	AND NOT EXISTS (SELECT 1 FROM reservations fr WHERE fr.equipment_id = e.id
		AND fr.status = 'active' AND fr.starts_at < :freeTo AND fr.ends_at > :freeFrom)
	AND NOT EXISTS (SELECT 1 FROM loans fo WHERE fo.equipment_id = e.id
		AND fo.returned_at IS NULL AND fo.due_at > :freeFrom AND fo.due_at > :now))`;

const SORT_SQL: Record<EquipmentSort, string> = {
	tag: 'e.asset_tag',
	name: 'e.name',
	status: `(CASE (${STATUS_SQL}) WHEN 'available' THEN 0 WHEN 'reserved' THEN 1
		WHEN 'on_loan' THEN 2 WHEN 'overdue' THEN 3 ELSE 4 END)`,
	type: 't.name',
	location: 'l.name',
	borrower: 'o.user_name',
	due: 'o.due_at',
	updated: 'last_activity',
};

/** A row as the database returns it, before narrowing it to the viewer. */
function equipmentViewOf(r: Row, viewer: Actor): EquipmentView {
	const loanId = strOrNull(r, 'loan_id');
	const resId = strOrNull(r, 'res_id');
	const status = str(r, 'status') as EquipmentStatus;
	return {
		id: num(r, 'id'),
		assetTag: str(r, 'asset_tag'),
		name: str(r, 'name'),
		typeId: numOrNull(r, 'type_id'),
		typeName: strOrNull(r, 'type_name'),
		locationId: numOrNull(r, 'location_id'),
		locationName: strOrNull(r, 'location_name'),
		status,
		suspendedReason: strOrNull(r, 'suspended_reason') as SuspendReason | null,
		loan: loanId
			? {
					id: loanId,
					name: str(r, 'loan_user_name'),
					imageUrl: null,
					membership: 'unknown',
					mine: str(r, 'loan_user_id') === viewer.id,
					lentAt: str(r, 'lent_at'),
					dueAt: str(r, 'due_at'),
					overdue: num(r, 'loan_overdue') === 1,
					userId: str(r, 'loan_user_id'),
					email: strOrNull(r, 'loan_user_email'),
				}
			: null,
		reservedNow: resId
			? {
					id: resId,
					name: str(r, 'res_user_name'),
					mine: str(r, 'res_user_id') === viewer.id,
					startsAt: str(r, 'res_starts_at'),
					endsAt: str(r, 'res_ends_at'),
					userId: str(r, 'res_user_id'),
				}
			: null,
		bands: [],
		updatedAt: str(r, 'last_activity'),
		serialNo: strOrNull(r, 'serial_no'),
		note: strOrNull(r, 'note'),
		suspendedNote: strOrNull(r, 'suspended_note'),
		version: num(r, 'version'),
	};
}

/**
 * Full views (before `forViewer`) with each borrower's current profile image
 * and membership looked up in the people index.
 */
export function withLoanDirectoryInfo(index: PeopleIndex, rows: EquipmentView[]): EquipmentView[] {
	return rows.map((v) =>
		v.loan?.userId
			? {
					...v,
					loan: {
						...v.loan,
						imageUrl: imageUrlOf(index, v.loan.userId),
						membership: membershipOf(index, v.loan.userId),
					},
				}
			: v,
	);
}

/**
 * What `viewer` may see of a row. Admins see everything. Members see the
 * shared-pool facts — who has it or booked it and for how long — but not the
 * management fields or anyone's user id.
 */
function forViewer(view: EquipmentView, viewer: Actor): EquipmentView {
	if (viewer.isAdmin) {
		return view;
	}
	const { serialNo: _s, note: _n, suspendedNote: _sn, version: _v, ...shared } = view;
	return {
		...shared,
		loan: view.loan
			? {
					id: view.loan.id,
					name: view.loan.name,
					imageUrl: view.loan.imageUrl,
					membership: view.loan.membership,
					mine: view.loan.mine,
					lentAt: view.loan.lentAt,
					dueAt: view.loan.dueAt,
					overdue: view.loan.overdue,
				}
			: null,
		reservedNow: view.reservedNow
			? {
					id: view.reservedNow.id,
					name: view.reservedNow.name,
					mine: view.reservedNow.mine,
					startsAt: view.reservedNow.startsAt,
					endsAt: view.reservedNow.endsAt,
				}
			: null,
	};
}

/** The 7 days from today and the drawing time. */
function stripWindow(now: string = nowLocal()): StripWindow {
	const today = now.slice(0, 10);
	return { days: Array.from({ length: 7 }, (_, i) => addDays(today, i)), now };
}

/**
 * Occupied stretches of the given equipment within the strip window: active
 * bookings and open loans. An overdue loan is drawn to the end of today (it is
 * not known when it comes back).
 */
async function bandsFor(
	db: Client,
	viewer: Actor,
	ids: number[],
	window: StripWindow,
): Promise<Map<number, Band[]>> {
	const out = new Map<number, Band[]>(ids.map((id) => [id, []]));
	if (ids.length === 0) {
		return out;
	}
	const args: Record<string, string | number> = {
		from: `${window.days[0]}T00:00`,
		to: `${addDays(window.days[window.days.length - 1], 1)}T00:00`,
		now: window.now,
		todayEnd: `${addDays(window.days[0], 1)}T00:00`,
	};
	const idList = namedList('id', ids, args);
	const res = await db.execute(
		namedStatement(
			`SELECT 'reservation' AS kind, r.equipment_id, r.user_id, r.user_name,
				r.starts_at AS band_start, r.ends_at AS band_end, 0 AS overdue
			FROM reservations r
			WHERE r.status = 'active' AND r.equipment_id IN (${idList})
				AND r.starts_at < :to AND r.ends_at > :from
			UNION ALL
			SELECT 'loan' AS kind, o.equipment_id, o.user_id, o.user_name, o.lent_at AS band_start,
				CASE WHEN o.due_at < :now THEN MAX(:todayEnd, :now) ELSE o.due_at END AS band_end,
				CASE WHEN o.due_at < :now THEN 1 ELSE 0 END AS overdue
			FROM loans o
			WHERE o.returned_at IS NULL AND o.equipment_id IN (${idList})
			ORDER BY band_start`,
			args,
		),
	);
	for (const r of res.rows) {
		out.get(num(r, 'equipment_id'))?.push({
			kind: str(r, 'kind') as Band['kind'],
			start: str(r, 'band_start'),
			end: str(r, 'band_end'),
			name: str(r, 'user_name'),
			mine: str(r, 'user_id') === viewer.id,
			overdue: num(r, 'overdue') === 1,
		});
	}
	return out;
}

export interface EquipmentQuery {
	q: string | null;
	statuses: EquipmentStatus[];
	typeId: number | null;
	/** Only equipment without a type (`type=none`). */
	noType: boolean;
	locationId: number | null;
	/** Only equipment that is not suspended (`bookable=1`; the booking picker). */
	bookable: boolean;
	/** Only equipment that can be booked for [from, to) (MCP `find_equipment`). */
	free?: { from: string; to: string } | null;
	ids: number[];
	sort: EquipmentSort;
	dir: 'asc' | 'desc';
	page: number;
	size: number;
}

export type StatusCounts = Record<'all' | EquipmentStatus, number>;

// WHERE clause from every filter except status (the counts strip is computed
// over these so each figure shows what clicking it would give).
function baseWhere(
	query: EquipmentQuery,
	viewer: Actor,
	now: string,
): { sql: string[]; args: Record<string, string | number> } {
	const sql: string[] = [];
	const args: Record<string, string | number> = { now };
	if (query.q) {
		args.q = likePattern(query.q);
		sql.push(
			viewer.isAdmin
				? `(e.asset_tag LIKE :q ESCAPE '\\' OR e.name LIKE :q ESCAPE '\\' OR e.serial_no LIKE :q ESCAPE '\\'
					OR e.note LIKE :q ESCAPE '\\' OR o.user_name LIKE :q ESCAPE '\\' OR t.name LIKE :q ESCAPE '\\')`
				: // Members: tag, name and type only (notes and serials are admin-only).
					`(e.asset_tag LIKE :q ESCAPE '\\' OR e.name LIKE :q ESCAPE '\\' OR t.name LIKE :q ESCAPE '\\')`,
		);
	}
	if (query.typeId !== null) {
		args.typeId = query.typeId;
		sql.push('e.type_id = :typeId');
	}
	if (query.noType) {
		sql.push('e.type_id IS NULL');
	}
	if (query.locationId !== null) {
		args.locationId = query.locationId;
		sql.push('e.location_id = :locationId');
	}
	if (query.bookable) {
		sql.push('e.suspended_reason IS NULL');
	}
	if (query.free) {
		args.freeFrom = query.free.from;
		args.freeTo = query.free.to;
		sql.push(FREE_SQL);
	}
	if (query.ids.length > 0) {
		sql.push(`e.id IN (${namedList('id', query.ids, args)})`);
	}
	return { sql, args };
}

function orderBy(sort: EquipmentSort, dir: 'asc' | 'desc'): string {
	const d = dir === 'desc' ? 'DESC' : 'ASC';
	return `ORDER BY ${SORT_SQL[sort]} ${d} NULLS LAST, e.asset_tag ASC, e.id ASC`;
}

function whereOf(query: EquipmentQuery, base: { sql: string[] }): string {
	const where = [...base.sql];
	if (query.statuses.length > 0) {
		where.push(`(${query.statuses.map((s) => STATUS_PREDICATE[s]).join(' OR ')})`);
	}
	return where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
}

/** One page of the ledger (GET /api/equipment). */
export interface EquipmentList {
	rows: EquipmentView[];
	total: number;
	/** Per-status counts over every filter except the status one (the counts strip). */
	counts: StatusCounts;
	/** The days the rows' strips cover. */
	window: StripWindow;
}

/**
 * The ledger (everyone): one page of equipment with each row's 7-day strip,
 * the total and the per-status counts.
 */
export async function listEquipment(
	db: Client,
	actor: Actor,
	query: EquipmentQuery,
): Promise<EquipmentList> {
	const window = stripWindow();
	const base = baseWhere(query, actor, window.now);
	const whereSql = whereOf(query, base);
	const baseSql = base.sql.length > 0 ? `WHERE ${base.sql.join(' AND ')}` : '';
	const countCols = EQUIPMENT_STATUSES.map(
		(s) => `SUM(CASE WHEN ${STATUS_PREDICATE[s]} THEN 1 ELSE 0 END) AS ${s}`,
	).join(', ');

	const [index, page, total, counts] = await Promise.all([
		peopleIndex(),
		db.execute(
			namedStatement(
				`SELECT ${EQUIPMENT_COLUMNS_SQL} ${EQUIPMENT_FROM_SQL} ${whereSql} ${orderBy(query.sort, query.dir)}
				LIMIT :limit OFFSET :offset`,
				{ ...base.args, limit: query.size, offset: (query.page - 1) * query.size },
			),
		),
		db.execute(namedStatement(`SELECT COUNT(*) AS n ${EQUIPMENT_FROM_SQL} ${whereSql}`, base.args)),
		db.execute(
			namedStatement(
				`SELECT COUNT(*) AS all_count, ${countCols} ${EQUIPMENT_FROM_SQL} ${baseSql}`,
				base.args,
			),
		),
	]);
	const rows = withLoanDirectoryInfo(
		index,
		page.rows.map((r) => equipmentViewOf(r, actor)),
	);
	const bands = await bandsFor(
		db,
		actor,
		rows.map((r) => r.id),
		window,
	);
	const c = counts.rows[0];
	return {
		rows: rows.map((r) => forViewer({ ...r, bands: bands.get(r.id) ?? [] }, actor)),
		total: Number(total.rows[0]?.n ?? 0),
		counts: {
			all: Number(c?.all_count ?? 0),
			available: Number(c?.available ?? 0),
			on_loan: Number(c?.on_loan ?? 0),
			reserved: Number(c?.reserved ?? 0),
			overdue: Number(c?.overdue ?? 0),
			suspended: Number(c?.suspended ?? 0),
		},
		window,
	};
}

/** Every row matching the ledger filters, for CSV export (admin). */
export async function exportEquipment(
	db: Client,
	actor: Actor,
	query: EquipmentQuery,
): Promise<EquipmentView[]> {
	requireAdmin(actor);
	const now = nowLocal();
	const base = baseWhere(query, actor, now);
	const res = await db.execute(
		namedStatement(
			`SELECT ${EQUIPMENT_COLUMNS_SQL} ${EQUIPMENT_FROM_SQL} ${whereOf(query, base)} ${orderBy(query.sort, query.dir)}`,
			base.args,
		),
	);
	return res.rows.map((r) => equipmentViewOf(r, actor));
}

/**
 * The id of the equipment with this asset tag: an exact match, or else the one
 * tag equal to it ignoring case and full-width forms (NFKC). Null when there
 * is none or the loose match is not unique (MCP tools address equipment by tag).
 */
export async function equipmentIdByTag(db: Client, tag: string): Promise<number | null> {
	const exact = await db.execute({
		sql: 'SELECT id FROM equipment WHERE asset_tag = ?',
		args: [tag],
	});
	if (exact.rows[0]) {
		return num(exact.rows[0], 'id');
	}
	const loose = await db.execute({
		sql: 'SELECT id FROM equipment WHERE asset_tag = ? COLLATE NOCASE LIMIT 2',
		args: [tag.normalize('NFKC')],
	});
	return loose.rows.length === 1 ? num(loose.rows[0], 'id') : null;
}

// Lookups: find* = no authorization, null when missing; load* = no
// authorization, the not-found error (404) when missing; get* = what the
// viewer may see.

/** Which of `assetTags` are registered already (CSV import), looked up 500 at a time. */
export async function registeredAssetTags(
	db: Client,
	assetTags: readonly string[],
): Promise<Set<string>> {
	const tags = [...new Set(assetTags.filter((t) => t !== ''))];
	const found = new Set<string>();
	for (let i = 0; i < tags.length; i += 500) {
		const args: NamedArgs = {};
		const list = namedList('tag', tags.slice(i, i + 500), args);
		const res = await db.execute(
			namedStatement(`SELECT asset_tag FROM equipment WHERE asset_tag IN (${list})`, args),
		);
		for (const r of res.rows) {
			found.add(str(r, 'asset_tag'));
		}
	}
	return found;
}

/** Internal lookup without an authorization check (full view). */
export async function findEquipment(
	db: Client,
	viewer: Actor,
	id: number,
	now: string = nowLocal(),
): Promise<EquipmentView | null> {
	const res = await db.execute(
		namedStatement(`SELECT ${EQUIPMENT_COLUMNS_SQL} ${EQUIPMENT_FROM_SQL} WHERE e.id = :id`, {
			id,
			now,
		}),
	);
	const row = res.rows[0];
	return row ? equipmentViewOf(row, viewer) : null;
}

/** findEquipment for a piece that must exist: `equipment_not_found` when it does not. */
async function loadEquipment(
	db: Client,
	viewer: Actor,
	id: number,
	now: string = nowLocal(),
): Promise<EquipmentView> {
	const found = await findEquipment(db, viewer, id, now);
	if (!found) {
		throw new AppError(ErrorCode.EquipmentNotFound);
	}
	return found;
}

/** One piece of equipment with its 7-day strip (GET /api/equipment/:id). */
export interface EquipmentDetail {
	equipment: EquipmentView;
	window: StripWindow;
}

/** One piece of equipment with its 7-day strip, narrowed to the viewer (everyone). */
export async function getEquipment(db: Client, actor: Actor, id: number): Promise<EquipmentDetail> {
	const window = stripWindow();
	const [index, found] = await Promise.all([
		peopleIndex(),
		loadEquipment(db, actor, id, window.now),
	]);
	const bands = await bandsFor(db, actor, [id], window);
	const [equipment] = withLoanDirectoryInfo(index, [{ ...found, bands: bands.get(id) ?? [] }]);
	return { equipment: forViewer(equipment, actor), window };
}

export function isUniqueTagViolation(err: unknown): boolean {
	return (
		err instanceof Error && /UNIQUE constraint failed: equipment\.asset_tag/i.test(err.message)
	);
}

// The equipment fields (columns and `:args`) come from FIELD_COLUMNS.
const EQUIPMENT_INSERT_SQL = `INSERT INTO equipment
	(${FIELD_KEYS.map((k) => FIELD_COLUMNS[k]).join(', ')}, version, created_at, updated_at)
	VALUES (${FIELD_KEYS.map((k) => `:${k}`).join(', ')}, 1, :at, :at)`;

/**
 * INSERT of a new piece of equipment + its `create` event. The new id is not
 * known inside a batch, so the event finds the row by its unique asset tag.
 * Every new piece goes through here: the register form, the AI assistant, the
 * CSV import and the sample data (which passes a past `at`).
 */
export function equipmentInsertStatements(
	fields: EquipmentFields,
	actor: EventInput['actor'],
	at: string = nowIso(),
): InStatement[] {
	return [
		namedStatement(EQUIPMENT_INSERT_SQL, { ...fields, at }),
		eventAfterChangeStatement({
			kind: 'create',
			equipment: { assetTag: fields.assetTag },
			actor,
			at,
		}),
	];
}

// Type and location must be active entries (a value the record already has
// may stay); reported against their fields.
async function checkMasters(
	db: Client,
	fields: EquipmentFields,
	current: EquipmentView | null,
	errors: FieldErrors,
): Promise<void> {
	if (
		fields.typeId !== null &&
		fields.typeId !== current?.typeId &&
		!(await findActiveMaster(db, 'types', fields.typeId))
	) {
		errors.typeId = 'not_found';
	}
	if (
		fields.locationId !== null &&
		fields.locationId !== current?.locationId &&
		!(await findActiveMaster(db, 'locations', fields.locationId))
	) {
		errors.locationId = 'not_found';
	}
}

/** Register a new piece of equipment (admin). Logs a `create` event in the same batch. */
export async function createEquipment(
	db: Client,
	actor: Actor,
	fields: EquipmentFields,
): Promise<EquipmentView> {
	requireAdmin(actor);
	const errors: FieldErrors = {};
	await checkMasters(db, fields, null, errors);
	const taken = await db.execute({
		sql: 'SELECT 1 FROM equipment WHERE asset_tag = ?',
		args: [fields.assetTag],
	});
	if (taken.rows.length > 0) {
		errors.assetTag = 'taken';
	}
	if (Object.keys(errors).length > 0) {
		throw new ValidationError(errors);
	}
	try {
		await db.batch(equipmentInsertStatements(fields, actor), 'write');
	} catch (err) {
		if (isUniqueTagViolation(err)) {
			throw new ValidationError({ assetTag: 'taken' });
		}
		throw err;
	}
	const res = await db.execute({
		sql: 'SELECT id FROM equipment WHERE asset_tag = ?',
		args: [fields.assetTag],
	});
	return loadEquipment(db, actor, num(res.rows[0], 'id'));
}

/** Edit fields (admin) with optimistic concurrency on `version`. */
export async function updateEquipment(
	db: Client,
	actor: Actor,
	id: number,
	version: number,
	fields: EquipmentFields,
): Promise<EquipmentView> {
	requireAdmin(actor);
	const current = await loadEquipment(db, actor, id);
	const errors: FieldErrors = {};
	await checkMasters(db, fields, current, errors);
	if (Object.keys(errors).length > 0) {
		throw new ValidationError(errors);
	}
	const changes: Record<string, [unknown, unknown]> = {};
	for (const key of FIELD_KEYS) {
		const before = current[key] ?? null;
		const after = fields[key] ?? null;
		if (before !== after) {
			changes[key] = [before, after];
		}
	}
	if (Object.keys(changes).length === 0) {
		return current;
	}
	const keys = Object.keys(changes) as (keyof EquipmentFields)[];
	const detail = { changes: await namedChanges(db, changes) };
	try {
		const [update] = await db.batch(
			[
				namedStatement(
					`UPDATE equipment SET ${keys.map((k) => `${FIELD_COLUMNS[k]} = :${k}`).join(', ')},
						version = version + 1, updated_at = :at
					WHERE id = :id AND version = :version`,
					{ ...fields, at: nowIso(), id, version },
				),
				eventAfterChangeStatement({ kind: 'edit', equipment: { id }, actor, detail }),
			],
			'write',
		);
		if (update.rowsAffected === 0) {
			throw new AppError(ErrorCode.EquipmentVersionConflict);
		}
	} catch (err) {
		if (isUniqueTagViolation(err)) {
			throw new ValidationError({ assetTag: 'taken' });
		}
		throw err;
	}
	return loadEquipment(db, actor, id);
}

// The history shows names, not ids: type / location changes are recorded with
// the names they had at the time.
async function namedChanges(
	db: Client,
	changes: Record<string, [unknown, unknown]>,
): Promise<Record<string, [unknown, unknown]>> {
	const out = { ...changes };
	for (const [key, table] of [
		['typeId', 'equipment_types'],
		['locationId', 'locations'],
	] as const) {
		const change = changes[key];
		if (!change) {
			continue;
		}
		const nameOf = async (id: unknown) => {
			if (id === null) {
				return null;
			}
			const res = await db.execute({
				sql: `SELECT name FROM ${table} WHERE id = ?`,
				args: [Number(id)],
			});
			return res.rows[0] ? str(res.rows[0], 'name') : null;
		};
		delete out[key];
		out[key === 'typeId' ? 'type' : 'location'] = [
			await nameOf(change[0]),
			await nameOf(change[1]),
		];
	}
	return out;
}

/** A suspension: why, and what is wrong. */
export interface Suspension {
	reason: SuspendReason;
	note: string | null;
}

/**
 * UPDATE that suspends equipment not suspended yet, and its `suspend` event:
 * `suspendEquipment`, and a return that suspends the returned equipment
 * (loans.ts). With `followUp` the UPDATE also needs the statement before it
 * to have changed a row (the return).
 */
export function suspendStatements(
	equipmentId: number,
	suspension: Suspension,
	actor: EventInput['actor'],
	opts: { at: string; followUp?: boolean },
): InStatement[] {
	return [
		namedStatement(
			`UPDATE equipment SET suspended_reason = :reason, suspended_note = :note,
					version = version + 1, updated_at = :at
				WHERE id = :equipmentId AND suspended_reason IS NULL ${opts.followUp ? 'AND changes() = 1' : ''}`,
			{ reason: suspension.reason, note: suspension.note, at: opts.at, equipmentId },
		),
		eventAfterChangeStatement({
			kind: 'suspend',
			equipment: { id: equipmentId },
			actor,
			detail: { reason: suspension.reason, note: suspension.note },
		}),
	];
}

/**
 * Suspend (admin): repair / broken / lost / other. Existing bookings and an
 * open loan are left untouched: the loan can still be returned, and the
 * bookings are shown with a warning.
 */
export async function suspendEquipment(
	db: Client,
	actor: Actor,
	id: number,
	reason: SuspendReason,
	note: string | null,
): Promise<EquipmentView> {
	requireAdmin(actor);
	const [update] = await db.batch(
		suspendStatements(id, { reason, note }, actor, { at: nowIso() }),
		'write',
	);
	if (update.rowsAffected === 0) {
		const found = await findEquipment(db, actor, id);
		throw found
			? new AppError(ErrorCode.EquipmentSuspended)
			: new AppError(ErrorCode.EquipmentNotFound);
	}
	return loadEquipment(db, actor, id);
}

/** Lift a suspension (admin). */
export async function resumeEquipment(
	db: Client,
	actor: Actor,
	id: number,
): Promise<EquipmentView> {
	requireAdmin(actor);
	const [update] = await db.batch(
		[
			{
				sql: `UPDATE equipment SET suspended_reason = NULL, suspended_note = NULL,
						version = version + 1, updated_at = ?
					WHERE id = ? AND suspended_reason IS NOT NULL`,
				args: [nowIso(), id],
			},
			eventAfterChangeStatement({ kind: 'resume', equipment: { id }, actor }),
		],
		'write',
	);
	if (update.rowsAffected === 0) {
		const found = await findEquipment(db, actor, id);
		throw found
			? new AppError(ErrorCode.EquipmentNotSuspended)
			: new AppError(ErrorCode.EquipmentNotFound);
	}
	return loadEquipment(db, actor, id);
}
