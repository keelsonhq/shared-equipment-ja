import type { Client, Row } from '@libsql/client';
import type { Actor } from '#lib/server/auth/actor.ts';
import { requireAdmin } from '#lib/server/auth/guard.ts';
import { addDays, minutesBetween, nowIso, nowLocal, onStep, stepStart } from '#lib/server/dates.ts';
import { namedStatement } from '#lib/server/db/named.ts';
import { num, str, strOrNull } from '#lib/server/db/rows.ts';
import { AppError, ErrorCode, type FieldErrors, ValidationError } from '#lib/server/errors.ts';
import { likePattern } from '#lib/server/db/like.ts';
import type { SuspendReason } from './equipment.ts';
import { eventAfterChangeStatement } from './events.ts';
import {
	findPerson,
	imageUrlOf,
	type Membership,
	membershipOf,
	peopleIndex,
	type PeopleIndex,
	type PersonSummary,
} from './directory.ts';

// Reservations: bookings of one piece of equipment for [starts_at, ends_at)
// (half-open, wall-clock times in the app time zone). A booking only exists if
// it overlaps no other active booking of the same equipment and no open loan
// that is still within its due time. No index can express "no overlap", so the
// booking is ONE libSQL batch whose first statement is an INSERT ... SELECT
// carrying that condition; a write transaction runs alone, so of two
// simultaneous bookings of the same slot exactly one is written. The history
// row follows only if the INSERT wrote a row (`changes() = 1`).

const RESERVATION_STATUSES = ['active', 'cancelled', 'fulfilled'] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

/** Longest booking: 30 days. */
const MAX_RESERVATION_MINUTES = 30 * 24 * 60;

/**
 * One booking as `viewer` may see it. The purpose is shown to the person who
 * booked and to admins only; `userId` / `email` / who booked it on someone's
 * behalf only to admins.
 */
export interface ReservationView {
	id: string;
	equipmentId: number;
	assetTag: string;
	equipmentName: string;
	/** The equipment's suspension (a warning on the booking). */
	suspendedReason: SuspendReason | null;
	name: string;
	/**
	 * The booker's current profile image (directory members only; null for
	 * former members and when none is set). Attached at read time by
	 * `withBookerDirectoryInfo`, never stored: name / email are the snapshot, this is not.
	 */
	imageUrl: string | null;
	/**
	 * Whether the booker is still a workspace member (`former` = left: the
	 * "former member" chip, DESIGN.md §8.10). Attached with the image by
	 * `withBookerDirectoryInfo`; `unknown` when the people list could not tell.
	 */
	membership: Membership;
	mine: boolean;
	startsAt: string;
	endsAt: string;
	purpose: string | null;
	status: ReservationStatus;
	/** Active and already over (never picked up). */
	expired: boolean;
	/** Active and covering the current time. */
	current: boolean;
	loanId: string | null;
	createdAt: string;
	userId?: string;
	email?: string | null;
	bookedByName?: string;
	cancelledByName?: string | null;
}

// A booking row with its equipment:
// `SELECT ${RESERVATION_COLUMNS_SQL} ${RESERVATION_FROM_SQL} WHERE …`.
const RESERVATION_COLUMNS_SQL = 'r.*, e.asset_tag, e.name AS equipment_name, e.suspended_reason';
const RESERVATION_FROM_SQL = `FROM reservations r
	JOIN equipment e ON e.id = r.equipment_id`;

function reservationViewOf(r: Row, viewer: Actor, now: string): ReservationView {
	const status = str(r, 'status') as ReservationStatus;
	const mine = str(r, 'user_id') === viewer.id;
	const startsAt = str(r, 'starts_at');
	const endsAt = str(r, 'ends_at');
	const view: ReservationView = {
		id: str(r, 'id'),
		equipmentId: num(r, 'equipment_id'),
		assetTag: str(r, 'asset_tag'),
		equipmentName: str(r, 'equipment_name'),
		suspendedReason: strOrNull(r, 'suspended_reason') as SuspendReason | null,
		name: str(r, 'user_name'),
		imageUrl: null,
		membership: 'unknown',
		mine,
		startsAt,
		endsAt,
		purpose: mine || viewer.isAdmin ? strOrNull(r, 'purpose') : null,
		status,
		expired: status === 'active' && endsAt <= now,
		current: status === 'active' && startsAt <= now && endsAt > now,
		loanId: strOrNull(r, 'loan_id'),
		createdAt: str(r, 'created_at'),
	};
	if (viewer.isAdmin) {
		view.userId = str(r, 'user_id');
		view.email = strOrNull(r, 'user_email');
		view.bookedByName = str(r, 'booked_by_name');
		view.cancelledByName = strOrNull(r, 'cancelled_by_name');
	}
	return view;
}

/**
 * Views of `rows` for `viewer`, each with the booker's current profile image
 * and membership looked up in the people index. Works from the rows, not the
 * views: a view carries the booker's id only for admins.
 */
export function withBookerDirectoryInfo(
	index: PeopleIndex,
	rows: Row[],
	viewer: Actor,
	now: string,
): ReservationView[] {
	return rows.map((r) => ({
		...reservationViewOf(r, viewer, now),
		imageUrl: imageUrlOf(index, str(r, 'user_id')),
		membership: membershipOf(index, str(r, 'user_id')),
	}));
}

// Lookups: find* = no authorization, null when missing; load* = no
// authorization, the not-found error (404) when missing.

/** Internal lookup without an authorization check. */
export async function findReservation(
	db: Client,
	viewer: Actor,
	id: string,
): Promise<{ view: ReservationView; userId: string } | null> {
	const res = await db.execute({
		sql: `SELECT ${RESERVATION_COLUMNS_SQL} ${RESERVATION_FROM_SQL} WHERE r.id = ?`,
		args: [id],
	});
	const row = res.rows[0];
	return row
		? { view: reservationViewOf(row, viewer, nowLocal()), userId: str(row, 'user_id') }
		: null;
}

/** findReservation for a booking that must exist: `reservation_not_found` when it does not. */
async function loadReservation(
	db: Client,
	viewer: Actor,
	id: string,
): Promise<{ view: ReservationView; userId: string }> {
	const found = await findReservation(db, viewer, id);
	if (!found) {
		throw new AppError(ErrorCode.ReservationNotFound);
	}
	return found;
}

/**
 * Bookings of one piece of equipment that are still to come or running now,
 * soonest first (equipment page). Everyone may read them: who and when is
 * shared; the purpose only for one's own (reservationViewOf).
 */
export async function listUpcomingForEquipment(
	db: Client,
	actor: Actor,
	equipmentId: number,
): Promise<ReservationView[]> {
	const now = nowLocal();
	const [index, res] = await Promise.all([
		peopleIndex(),
		db.execute({
			sql: `SELECT ${RESERVATION_COLUMNS_SQL} ${RESERVATION_FROM_SQL} WHERE r.equipment_id = ? AND r.status = 'active' AND r.ends_at > ?
				ORDER BY r.starts_at`,
			args: [equipmentId, now],
		}),
	]);
	return withBookerDirectoryInfo(index, res.rows, actor, now);
}

export interface ReservationQuery {
	/** `mine`: the caller's own; `all`: everyone's (admin). */
	scope: 'mine' | 'all';
	/** `upcoming`: active and not over yet; `past`: everything else. */
	when: 'upcoming' | 'past';
	/** `all` only: bookings overlapping these days (inclusive). */
	from: string | null;
	to: string | null;
	q: string | null;
	page: number;
	size: number;
}

/** One page of the reservations screen (GET /api/reservations). */
export interface ReservationList {
	rows: ReservationView[];
	total: number;
}

/** The reservations screen: the caller's bookings, or everyone's (admin). */
export async function listReservations(
	db: Client,
	actor: Actor,
	query: ReservationQuery,
): Promise<ReservationList> {
	if (query.scope === 'all') {
		requireAdmin(actor);
	}
	const now = nowLocal();
	const where: string[] = [];
	const args: Record<string, string | number> = { now };
	if (query.scope === 'mine') {
		args.userId = actor.id;
		where.push('r.user_id = :userId');
	}
	const upcoming = "(r.status = 'active' AND r.ends_at > :now)";
	if (query.scope === 'mine' || (!query.from && !query.to)) {
		where.push(query.when === 'upcoming' ? upcoming : `NOT ${upcoming}`);
	}
	if (query.scope === 'all' && query.from) {
		args.from = `${query.from}T00:00`;
		where.push('r.ends_at > :from');
	}
	if (query.scope === 'all' && query.to) {
		args.to = `${addDays(query.to, 1)}T00:00`;
		where.push('r.starts_at < :to');
	}
	if (query.q) {
		args.q = likePattern(query.q);
		where.push(
			`(e.asset_tag LIKE :q ESCAPE '\\' OR e.name LIKE :q ESCAPE '\\' OR r.user_name LIKE :q ESCAPE '\\')`,
		);
	}
	const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
	const order =
		query.when === 'past' && query.scope === 'mine'
			? 'ORDER BY r.starts_at DESC, r.created_at DESC'
			: 'ORDER BY r.starts_at ASC, r.created_at ASC';
	const [index, page, total] = await Promise.all([
		peopleIndex(),
		db.execute(
			namedStatement(
				`SELECT ${RESERVATION_COLUMNS_SQL} ${RESERVATION_FROM_SQL} ${whereSql} ${order} LIMIT :limit OFFSET :offset`,
				{
					...args,
					limit: query.size,
					offset: (query.page - 1) * query.size,
				},
			),
		),
		db.execute(
			namedStatement(
				`SELECT COUNT(*) AS n FROM reservations r JOIN equipment e ON e.id = r.equipment_id ${whereSql}`,
				args,
			),
		),
	]);
	return {
		rows: withBookerDirectoryInfo(index, page.rows, actor, now),
		total: Number(total.rows[0]?.n ?? 0),
	};
}

export interface ReservationInput {
	equipmentId: number;
	/** Who the booking is for. Omitted (or the caller's own id) = oneself. */
	userId: string | null;
	startsAt: string;
	endsAt: string;
	purpose: string | null;
}

// Another active booking overlapping [:startsAt, :endsAt), or an open loan
// still within its due time that runs past :startsAt. An overdue loan is not
// an overlap (it should have come back already): the booking can be made, and
// the loan check stops the hand-over until the return is recorded (D-6, D-7).
const OVERLAP_SQL = `(EXISTS (SELECT 1 FROM reservations x WHERE x.equipment_id = :equipmentId
		AND x.status = 'active' AND x.starts_at < :endsAt AND x.ends_at > :startsAt)
	OR EXISTS (SELECT 1 FROM loans o WHERE o.equipment_id = :equipmentId
		AND o.returned_at IS NULL AND o.due_at > :startsAt AND o.due_at > :now))`;

/**
 * Book a piece of equipment for oneself, or (admin) for someone else.
 *
 * - Starts and ends are on 15-minute steps; the start is not before the
 *   current step; at most 30 days.
 * - A suspended piece cannot be booked (`equipment_suspended`).
 * - An overlap is a problem of the start field (`startsAt: overlap`), so the
 *   form shows it under the period it is about.
 */
export async function createReservation(
	db: Client,
	actor: Actor,
	input: ReservationInput,
): Promise<ReservationView> {
	const self = input.userId === null || input.userId === actor.id;
	if (!self) {
		requireAdmin(actor);
	}
	const now = nowLocal();
	const errors: FieldErrors = {};
	if (!onStep(input.startsAt)) {
		errors.startsAt = 'step';
	} else if (input.startsAt < stepStart(now)) {
		errors.startsAt = 'past';
	}
	if (!onStep(input.endsAt)) {
		errors.endsAt = 'step';
	} else if (input.endsAt <= input.startsAt) {
		errors.endsAt = 'before_start';
	} else if (minutesBetween(input.startsAt, input.endsAt) > MAX_RESERVATION_MINUTES) {
		errors.endsAt = 'period_too_long';
	}
	const person: PersonSummary | null = self
		? { id: actor.id, name: actor.name, email: actor.email }
		: await findPerson(input.userId as string);
	if (!person) {
		errors.userId = 'not_found';
	}
	const equipment = await db.execute({
		sql: 'SELECT id, suspended_reason FROM equipment WHERE id = ?',
		args: [input.equipmentId],
	});
	if (!equipment.rows[0]) {
		errors.equipmentId = 'not_found';
	}
	if (Object.keys(errors).length > 0 || !person) {
		throw new ValidationError(errors);
	}
	if (equipment.rows[0].suspended_reason !== null) {
		throw new AppError(ErrorCode.EquipmentSuspended);
	}
	const args = {
		equipmentId: input.equipmentId,
		startsAt: input.startsAt,
		endsAt: input.endsAt,
		now,
	};
	const overlap = await db.execute(namedStatement(`SELECT ${OVERLAP_SQL} AS taken`, args));
	if (num(overlap.rows[0], 'taken') === 1) {
		throw new ValidationError({ startsAt: 'overlap' });
	}

	const id = crypto.randomUUID();
	const ts = nowIso();
	const [insert] = await db.batch(
		[
			namedStatement(
				`INSERT INTO reservations (id, equipment_id, user_id, user_name, user_email, starts_at,
						ends_at, purpose, status, booked_by_id, booked_by_name, created_at, updated_at)
					SELECT :id, :equipmentId, :userId, :userName, :userEmail, :startsAt, :endsAt, :purpose,
						'active', :actorId, :actorName, :ts, :ts
					WHERE EXISTS (SELECT 1 FROM equipment WHERE id = :equipmentId
							AND suspended_reason IS NULL)
						AND NOT ${OVERLAP_SQL}`,
				{
					...args,
					id,
					userId: person.id,
					userName: person.name,
					userEmail: person.email,
					purpose: input.purpose,
					actorId: actor.id,
					actorName: actor.name,
					ts,
				},
			),
			eventAfterChangeStatement({
				kind: 'reserve',
				equipment: { id: input.equipmentId },
				reservationId: id,
				subject: { id: person.id, name: person.name },
				actor,
				detail: { startsAt: input.startsAt, endsAt: input.endsAt, purpose: input.purpose },
			}),
		],
		'write',
	);
	if (insert.rowsAffected === 0) {
		// Lost a race: suspended meanwhile, or someone booked the slot first.
		const again = await db.execute({
			sql: 'SELECT suspended_reason FROM equipment WHERE id = ?',
			args: [input.equipmentId],
		});
		if (again.rows[0]?.suspended_reason !== null) {
			throw new AppError(ErrorCode.EquipmentSuspended);
		}
		throw new ValidationError({ startsAt: 'overlap' });
	}
	return (await loadReservation(db, actor, id)).view;
}

/** Cancel an active booking: the person who has it, or an admin. */
export async function cancelReservation(
	db: Client,
	actor: Actor,
	id: string,
): Promise<ReservationView> {
	const found = await loadReservation(db, actor, id);
	if (found.userId !== actor.id && !actor.isAdmin) {
		throw new AppError(ErrorCode.ReservationNotOwned);
	}
	if (found.view.status !== 'active') {
		throw new AppError(ErrorCode.ReservationNotActive);
	}
	const ts = nowIso();
	const [update] = await db.batch(
		[
			namedStatement(
				`UPDATE reservations SET status = 'cancelled', cancelled_at = :ts, cancelled_by_id = :actorId,
						cancelled_by_name = :actorName, updated_at = :ts
					WHERE id = :id AND status = 'active' ${actor.isAdmin ? '' : 'AND user_id = :actorId'}`,
				{ ts, actorId: actor.id, actorName: actor.name, id },
			),
			eventAfterChangeStatement({
				kind: 'cancel',
				equipment: { id: found.view.equipmentId },
				reservationId: id,
				subject: { id: found.userId, name: found.view.name },
				actor,
				detail: { startsAt: found.view.startsAt, endsAt: found.view.endsAt },
			}),
		],
		'write',
	);
	if (update.rowsAffected === 0) {
		throw new AppError(ErrorCode.ReservationNotActive);
	}
	return (await loadReservation(db, actor, id)).view;
}
