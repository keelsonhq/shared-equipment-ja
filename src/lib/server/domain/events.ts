import type { Client, InStatement, Row } from '@libsql/client';
import type { Actor } from '#lib/server/auth/actor.ts';
import { addDays, nowIso, zonedDayStartIso } from '#lib/server/dates.ts';
import { requireAdmin } from '#lib/server/auth/guard.ts';
import { type NamedArgs, namedList, namedStatement } from '#lib/server/db/named.ts';
import { numOrNull, str, strOrNull } from '#lib/server/db/rows.ts';
import { likePattern } from '#lib/server/db/like.ts';

// Operation history. Every operation on equipment, bookings and loans
// (register, edit, suspend, resume, reserve, cancel, lend, extend, return)
// writes its events in the same atomic batch as the change itself. A CSV
// import writes each row's event with the row (100 rows per batch) and one
// `import` event after the last batch. Changes to the masters and the
// attachments keep no history.

export const EVENT_KINDS = [
	'create',
	'edit',
	'suspend',
	'resume',
	'reserve',
	'cancel',
	'lend',
	'extend',
	'return',
	'import',
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/**
 * The equipment a statement writes about: by id, or by asset tag for a piece
 * inserted earlier in the same batch (its id is not known yet).
 */
export type EquipmentTarget = { id: number } | { assetTag: string };

export interface EventInput {
	kind: EventKind;
	equipment: EquipmentTarget | null;
	reservationId?: string | null;
	loanId?: string | null;
	subject?: { id: string; name: string } | null;
	actor: Pick<Actor, 'id' | 'name' | 'source'>;
	detail?: Record<string, unknown> | null;
	/** Defaults to now; the sample-data loader passes historical times. */
	at?: string;
}

// The equipment id / tag / name snapshot columns: the equipment's own values
// when it is given by id, looked up by its unique tag otherwise.
function equipmentColumnsSql(equipment: EquipmentTarget | null): string {
	if (equipment === null) {
		return 'NULL, NULL, NULL';
	}
	if ('id' in equipment) {
		return `:equipmentId, (SELECT asset_tag FROM equipment WHERE id = :equipmentId),
			(SELECT name FROM equipment WHERE id = :equipmentId)`;
	}
	return `(SELECT id FROM equipment WHERE asset_tag = :assetTag), :assetTag,
		(SELECT name FROM equipment WHERE asset_tag = :assetTag)`;
}

function eventInsert(input: EventInput, condition: string): InStatement {
	const equipment = input.equipment;
	const detail = input.actor.source
		? { ...input.detail, source: input.actor.source }
		: (input.detail ?? null);
	return namedStatement(
		`INSERT INTO events (id, at, kind, equipment_id, equipment_tag, equipment_name,
				reservation_id, loan_id, subject_user_id, subject_user_name, actor_id, actor_name, detail)
			SELECT :id, :at, :kind, ${equipmentColumnsSql(equipment)}, :reservationId, :loanId,
				:subjectId, :subjectName, :actorId, :actorName, :detail
			${condition}`,
		{
			id: crypto.randomUUID(),
			at: input.at ?? nowIso(),
			kind: input.kind,
			equipmentId: equipment && 'id' in equipment ? equipment.id : null,
			assetTag: equipment && 'assetTag' in equipment ? equipment.assetTag : null,
			reservationId: input.reservationId ?? null,
			loanId: input.loanId ?? null,
			subjectId: input.subject?.id ?? null,
			subjectName: input.subject?.name ?? null,
			actorId: input.actor.id,
			actorName: input.actor.name,
			detail: detail ? JSON.stringify(detail) : null,
		},
	);
}

/**
 * INSERT for one event, written only when the statement just before it in the
 * batch changed exactly one row (SQLite `changes()`), so an event is never
 * logged for a guarded write that did not happen. Every operation of the
 * business layer logs through this. Equipment tag / name are snapshotted from
 * the equipment table. A change made through an AI assistant (MCP) adds
 * `source: "mcp"` to the detail; the history screen does not show it.
 */
export function eventAfterChangeStatement(input: EventInput): InStatement {
	return eventInsert(input, 'WHERE changes() = 1');
}

/**
 * INSERT for one event that does not depend on the statement before it (no
 * `changes()` check, unlike `eventAfterChangeStatement`): the sample data
 * (records written as they are) and the CSV import's summary.
 */
export function unguardedEventStatement(input: EventInput): InStatement {
	return eventInsert(input, '');
}

export interface EventView {
	id: string;
	at: string;
	kind: EventKind;
	equipmentId: number | null;
	equipmentTag: string | null;
	equipmentName: string | null;
	reservationId: string | null;
	loanId: string | null;
	subjectId: string | null;
	subjectName: string | null;
	actorId: string;
	actorName: string;
	detail: Record<string, unknown> | null;
}

function eventViewOf(r: Row): EventView {
	const raw = strOrNull(r, 'detail');
	let detail: Record<string, unknown> | null = null;
	if (raw) {
		try {
			detail = JSON.parse(raw) as Record<string, unknown>;
		} catch {
			detail = null;
		}
	}
	return {
		id: str(r, 'id'),
		at: str(r, 'at'),
		kind: str(r, 'kind') as EventKind,
		equipmentId: numOrNull(r, 'equipment_id'),
		equipmentTag: strOrNull(r, 'equipment_tag'),
		equipmentName: strOrNull(r, 'equipment_name'),
		reservationId: strOrNull(r, 'reservation_id'),
		loanId: strOrNull(r, 'loan_id'),
		subjectId: strOrNull(r, 'subject_user_id'),
		subjectName: strOrNull(r, 'subject_user_name'),
		actorId: str(r, 'actor_id'),
		actorName: str(r, 'actor_name'),
		detail,
	};
}

export interface EventQuery {
	kinds: EventKind[];
	from: string | null;
	to: string | null;
	actorId: string | null;
	q: string | null;
	page: number;
	size: number;
}

/** One page of the history (GET /api/events). */
export interface EventList {
	rows: EventView[];
	total: number;
	/** Everyone who has acted, for the actor filter. */
	actors: { id: string; name: string }[];
}

/** Paged operation history for the admin history screen. */
export async function listEvents(db: Client, actor: Actor, query: EventQuery): Promise<EventList> {
	requireAdmin(actor);
	const where: string[] = [];
	const args: NamedArgs = {};
	if (query.kinds.length > 0) {
		where.push(`kind IN (${namedList('kind', query.kinds, args)})`);
	}
	if (query.from) {
		args.from = zonedDayStartIso(query.from);
		where.push('at >= :from');
	}
	if (query.to) {
		args.to = zonedDayStartIso(addDays(query.to, 1));
		where.push('at < :to');
	}
	if (query.actorId) {
		args.actorId = query.actorId;
		where.push('actor_id = :actorId');
	}
	if (query.q) {
		args.q = likePattern(query.q);
		where.push(
			`(equipment_tag LIKE :q ESCAPE '\\' OR equipment_name LIKE :q ESCAPE '\\'
			  OR subject_user_name LIKE :q ESCAPE '\\' OR actor_name LIKE :q ESCAPE '\\')`,
		);
	}
	const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
	const [count, page, actors] = await Promise.all([
		db.execute(namedStatement(`SELECT COUNT(*) AS n FROM events ${whereSql}`, args)),
		db.execute(
			namedStatement(
				`SELECT * FROM events ${whereSql} ORDER BY at DESC, rowid DESC LIMIT :limit OFFSET :offset`,
				{ ...args, limit: query.size, offset: (query.page - 1) * query.size },
			),
		),
		db.execute(
			`SELECT actor_id, MAX(actor_name) AS actor_name FROM events
			 GROUP BY actor_id ORDER BY actor_name`,
		),
	]);
	return {
		rows: page.rows.map(eventViewOf),
		total: Number(count.rows[0]?.n ?? 0),
		actors: actors.rows.map((r) => ({ id: str(r, 'actor_id'), name: str(r, 'actor_name') })),
	};
}

/** Every event of one piece of equipment, newest first (equipment page, history tab). */
export async function listEquipmentEvents(
	db: Client,
	actor: Actor,
	equipmentId: number,
): Promise<EventView[]> {
	requireAdmin(actor);
	const res = await db.execute({
		sql: 'SELECT * FROM events WHERE equipment_id = ? ORDER BY at DESC, rowid DESC',
		args: [equipmentId],
	});
	return res.rows.map(eventViewOf);
}

/** The latest `limit` events (home screen). */
export async function recentEvents(db: Client, limit: number): Promise<EventView[]> {
	const res = await db.execute({
		sql: 'SELECT * FROM events ORDER BY at DESC, rowid DESC LIMIT ?',
		args: [limit],
	});
	return res.rows.map(eventViewOf);
}
