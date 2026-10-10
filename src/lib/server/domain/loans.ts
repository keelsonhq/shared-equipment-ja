import type { Client, InStatement, Row } from '@libsql/client';
import type { Actor } from '#lib/server/auth/actor.ts';
import { requireAdmin } from '#lib/server/auth/guard.ts';
import { addMinutes, nowIso, nowLocal, onStep } from '#lib/server/dates.ts';
import { namedStatement } from '#lib/server/db/named.ts';
import { num, str, strOrNull } from '#lib/server/db/rows.ts';
import { AppError, ErrorCode, type FieldErrors, ValidationError } from '#lib/server/errors.ts';
import { type SuspendReason, type Suspension, suspendStatements } from './equipment.ts';
import { eventAfterChangeStatement } from './events.ts';
import { findActiveMaster } from './masters.ts';
import {
	findPerson,
	imageUrlOf,
	type Membership,
	membershipOf,
	peopleIndex,
	type PeopleIndex,
	type PersonSummary,
} from './directory.ts';

// Loans: one row per hand-over of one piece of equipment to one person, from
// the moment it is lent until the return is recorded (returned_at IS NULL =
// out now). A loan is never closed automatically, not even after its due time.
//
// Every write is ONE libSQL batch (one transaction) whose first statement
// carries the business rule in its WHERE clause; follow-up statements run only
// if the previous one changed a row (`changes() = 1`). With the partial unique
// index on open loans, a piece of equipment can never be lent twice at once,
// even under concurrent requests.
//
// The lending rule is one condition: not
// suspended, no open loan, and [now, due) overlaps no active booking of
// anyone other than the borrower. That single overlap covers both "someone
// else's booking runs now" and "a walk-in loan must be back before the next
// booking starts".

export type ReturnKind = 'returned' | 'collected';

/** A booking may be picked up this many minutes before it starts (D-5). */
export const EARLY_PICKUP_MINUTES = 30;

/**
 * One loan as `viewer` may see it: the borrower and admins see everything;
 * notes are theirs. `userId` / `email` only for admins.
 */
export interface LoanView {
	id: string;
	equipmentId: number;
	assetTag: string;
	equipmentName: string;
	typeName: string | null;
	suspendedReason: SuspendReason | null;
	name: string;
	/**
	 * The borrower's current profile image (directory members only; null for
	 * former members and when none is set). Attached at read time by
	 * `withBorrowerDirectoryInfo`, never stored: name / email are the snapshot, this is not.
	 */
	imageUrl: string | null;
	/**
	 * Whether the borrower is still a workspace member (`former` = left: the
	 * "former member" chip, DESIGN.md §8.10). Attached with the image by
	 * `withBorrowerDirectoryInfo`; `unknown` when the people list could not tell.
	 */
	membership: Membership;
	mine: boolean;
	reservationId: string | null;
	lentAt: string;
	dueAt: string;
	/** Out and past its due time. */
	overdue: boolean;
	note: string | null;
	lentByName: string;
	returnedAt: string | null;
	returnKind: ReturnKind | null;
	returnedByName: string | null;
	returnNote: string | null;
	returnLocationName: string | null;
	userId?: string;
	email?: string | null;
}

// A loan row with its equipment: `SELECT ${LOAN_COLUMNS_SQL} ${LOAN_FROM_SQL} WHERE …`.
const LOAN_COLUMNS_SQL = `o.*, e.asset_tag, e.name AS equipment_name, e.suspended_reason,
	t.name AS type_name`;
const LOAN_FROM_SQL = `FROM loans o
	JOIN equipment e ON e.id = o.equipment_id
	LEFT JOIN equipment_types t ON t.id = e.type_id`;

// rowid breaks ties between rows written in the same minute.
const LEDGER_ORDER = 'ORDER BY o.lent_at DESC, o.created_at DESC, o.rowid DESC';

function loanViewOf(r: Row, viewer: Actor, now: string): LoanView {
	const mine = str(r, 'user_id') === viewer.id;
	const own = mine || viewer.isAdmin;
	const returnedAt = strOrNull(r, 'returned_at');
	const view: LoanView = {
		id: str(r, 'id'),
		equipmentId: num(r, 'equipment_id'),
		assetTag: str(r, 'asset_tag'),
		equipmentName: str(r, 'equipment_name'),
		typeName: strOrNull(r, 'type_name'),
		suspendedReason: strOrNull(r, 'suspended_reason') as SuspendReason | null,
		name: str(r, 'user_name'),
		imageUrl: null,
		membership: 'unknown',
		mine,
		reservationId: strOrNull(r, 'reservation_id'),
		lentAt: str(r, 'lent_at'),
		dueAt: str(r, 'due_at'),
		overdue: returnedAt === null && str(r, 'due_at') < now,
		note: own ? strOrNull(r, 'note') : null,
		lentByName: str(r, 'lent_by_name'),
		returnedAt,
		returnKind: strOrNull(r, 'return_kind') as ReturnKind | null,
		returnedByName: strOrNull(r, 'returned_by_name'),
		returnNote: own ? strOrNull(r, 'return_note') : null,
		returnLocationName: strOrNull(r, 'return_location_name'),
	};
	if (viewer.isAdmin) {
		view.userId = str(r, 'user_id');
		view.email = strOrNull(r, 'user_email');
	}
	return view;
}

/**
 * Views of `rows` for `viewer`, each with the borrower's current profile image
 * and membership looked up in the people index. Works from the rows, not the
 * views: a view carries the borrower's id only for admins.
 */
function withBorrowerDirectoryInfo(
	index: PeopleIndex,
	rows: Row[],
	viewer: Actor,
	now: string,
): LoanView[] {
	return rows.map((r) => ({
		...loanViewOf(r, viewer, now),
		imageUrl: imageUrlOf(index, str(r, 'user_id')),
		membership: membershipOf(index, str(r, 'user_id')),
	}));
}

// Lookups: find* = no authorization, null when missing; load* = no
// authorization, the not-found error (404) when missing.

/** Internal lookup without an authorization check. */
async function findLoan(
	db: Client,
	viewer: Actor,
	id: string,
): Promise<{ view: LoanView; userId: string } | null> {
	const res = await db.execute({
		sql: `SELECT ${LOAN_COLUMNS_SQL} ${LOAN_FROM_SQL} WHERE o.id = ?`,
		args: [id],
	});
	const row = res.rows[0];
	return row ? { view: loanViewOf(row, viewer, nowLocal()), userId: str(row, 'user_id') } : null;
}

/** findLoan for a loan that must exist: `loan_not_found` when it does not. */
async function loadLoan(
	db: Client,
	viewer: Actor,
	id: string,
): Promise<{ view: LoanView; userId: string }> {
	const found = await findLoan(db, viewer, id);
	if (!found) {
		throw new AppError(ErrorCode.LoanNotFound);
	}
	return found;
}

/**
 * The loan ledger of one piece of equipment, newest first. Admins see every
 * loan; a member sees only their own (other people's past use is their
 * history).
 */
export async function listEquipmentLoans(
	db: Client,
	actor: Actor,
	equipmentId: number,
): Promise<LoanView[]> {
	const now = nowLocal();
	const [index, res] = await Promise.all([
		peopleIndex(),
		db.execute(
			namedStatement(
				`SELECT ${LOAN_COLUMNS_SQL} ${LOAN_FROM_SQL}
				WHERE o.equipment_id = :equipmentId ${actor.isAdmin ? '' : 'AND o.user_id = :userId'}
				${LEDGER_ORDER}`,
				{ equipmentId, userId: actor.id },
			),
		),
	]);
	return withBorrowerDirectoryInfo(index, res.rows, actor, now);
}

/**
 * Every loan of one person, newest first. No authorization here: callers
 * (me.ts) decide whose ledger may be read, and pass the people index they
 * already hold (one index read per request).
 */
export async function listPersonLoans(
	db: Client,
	viewer: Actor,
	userId: string,
	index: PeopleIndex,
): Promise<LoanView[]> {
	const now = nowLocal();
	const res = await db.execute({
		sql: `SELECT ${LOAN_COLUMNS_SQL} ${LOAN_FROM_SQL} WHERE o.user_id = ? ${LEDGER_ORDER}`,
		args: [userId],
	});
	return withBorrowerDirectoryInfo(index, res.rows, viewer, now);
}

export interface LendInput {
	equipmentId: number;
	/** The borrower. Omitted (or the caller's own id) = oneself. */
	userId: string | null;
	dueAt: string;
	note: string | null;
	/** Pick up this booking (it must be the borrower's, and due now). */
	reservationId: string | null;
}

// Someone other than :userId has an active booking overlapping [:now, :dueAt).
const OTHERS_BOOKING_SQL = `EXISTS (SELECT 1 FROM reservations r WHERE r.equipment_id = :equipmentId
	AND r.status = 'active' AND r.user_id != :userId AND r.starts_at < :dueAt AND r.ends_at > :now)`;

function isOpenLoanViolation(err: unknown): boolean {
	return err instanceof Error && /UNIQUE constraint failed: loans\.equipment_id/i.test(err.message);
}

/**
 * Why a piece of equipment cannot be lent to `userId` until `dueAt` right
 * now, or null if it can. Field problems come back as ValidationError.
 */
async function lendBlocker(
	db: Client,
	equipmentId: number,
	userId: string,
	now: string,
	dueAt: string,
): Promise<AppError | null> {
	const res = await db.execute(
		namedStatement(
			`SELECT e.suspended_reason,
				(SELECT o.due_at FROM loans o WHERE o.equipment_id = e.id AND o.returned_at IS NULL)
					AS open_due,
				EXISTS (SELECT 1 FROM reservations r WHERE r.equipment_id = e.id AND r.status = 'active'
					AND r.user_id != :userId AND r.starts_at <= :now AND r.ends_at > :now) AS reserved_now,
				${OTHERS_BOOKING_SQL} AS runs_into_booking
			FROM equipment e WHERE e.id = :equipmentId`,
			{ equipmentId, userId, now, dueAt },
		),
	);
	const row = res.rows[0];
	if (!row) {
		return new ValidationError({ equipmentId: 'not_found' });
	}
	if (row.suspended_reason !== null) {
		return new AppError(ErrorCode.EquipmentSuspended);
	}
	const openDue = strOrNull(row, 'open_due');
	if (openDue !== null) {
		return new AppError(
			openDue < now ? ErrorCode.PreviousLoanNotReturned : ErrorCode.EquipmentOnLoan,
		);
	}
	if (num(row, 'reserved_now') === 1) {
		return new AppError(ErrorCode.EquipmentReserved);
	}
	if (num(row, 'runs_into_booking') === 1) {
		return new ValidationError({ dueAt: 'conflict' });
	}
	return null;
}

/**
 * The borrower's booking this loan picks up: the given one (it must be theirs,
 * active, for this equipment, and due within EARLY_PICKUP_MINUTES), or else
 * their earliest such booking, if any.
 */
async function bookingToPickUp(
	db: Client,
	input: LendInput,
	userId: string,
	now: string,
): Promise<string | null> {
	const soon = addMinutes(now, EARLY_PICKUP_MINUTES);
	const res = await db.execute(
		namedStatement(
			`SELECT id FROM reservations
			WHERE equipment_id = :equipmentId AND user_id = :userId AND status = 'active'
				AND starts_at <= :soon AND ends_at > :now
				${input.reservationId === null ? '' : 'AND id = :reservationId'}
			ORDER BY starts_at LIMIT 1`,
			{
				equipmentId: input.equipmentId,
				userId,
				soon,
				now,
				reservationId: input.reservationId,
			},
		),
	);
	const id = res.rows[0] ? str(res.rows[0], 'id') : null;
	if (input.reservationId !== null && id === null) {
		throw new AppError(ErrorCode.ReservationNotActive);
	}
	return id;
}

/**
 * Lend a piece of equipment now, to oneself or (admin) to someone else, until
 * `dueAt`. The borrower's own booking that is due now is picked up (marked
 * fulfilled and linked) in the same transaction.
 *
 * Refusals: `equipment_suspended`; `previous_loan_not_returned` (someone still
 * has it past its due time — never returned automatically) or
 * `equipment_on_loan`; `equipment_reserved` (someone else's booking runs now);
 * `dueAt: conflict` (the due time runs into someone else's booking).
 */
export async function lendEquipment(db: Client, actor: Actor, input: LendInput): Promise<LoanView> {
	const self = input.userId === null || input.userId === actor.id;
	if (!self) {
		requireAdmin(actor);
	}
	const now = nowLocal();
	const errors: FieldErrors = {};
	if (!onStep(input.dueAt)) {
		errors.dueAt = 'step';
	} else if (input.dueAt <= now) {
		errors.dueAt = 'past';
	}
	const person: PersonSummary | null = self
		? { id: actor.id, name: actor.name, email: actor.email }
		: await findPerson(input.userId as string);
	if (!person) {
		errors.userId = 'not_found';
	}
	if (Object.keys(errors).length > 0 || !person) {
		throw new ValidationError(errors);
	}
	const blocker = await lendBlocker(db, input.equipmentId, person.id, now, input.dueAt);
	if (blocker) {
		throw blocker;
	}
	const reservationId = await bookingToPickUp(db, input, person.id, now);

	const id = crypto.randomUUID();
	const ts = nowIso();
	const args = {
		id,
		equipmentId: input.equipmentId,
		userId: person.id,
		userName: person.name,
		userEmail: person.email,
		reservationId,
		now,
		dueAt: input.dueAt,
		note: input.note,
		actorId: actor.id,
		actorName: actor.name,
		ts,
	};
	const guards = [
		'EXISTS (SELECT 1 FROM equipment WHERE id = :equipmentId AND suspended_reason IS NULL)',
		'NOT EXISTS (SELECT 1 FROM loans WHERE equipment_id = :equipmentId AND returned_at IS NULL)',
		`NOT ${OTHERS_BOOKING_SQL}`,
	];
	if (reservationId !== null) {
		guards.push(`EXISTS (SELECT 1 FROM reservations WHERE id = :reservationId
			AND status = 'active' AND user_id = :userId)`);
	}
	const statements: InStatement[] = [
		namedStatement(
			`INSERT INTO loans (id, equipment_id, user_id, user_name, user_email, reservation_id, lent_at,
					due_at, note, lent_by_id, lent_by_name, created_at, updated_at)
				SELECT :id, :equipmentId, :userId, :userName, :userEmail, :reservationId, :now, :dueAt,
					:note, :actorId, :actorName, :ts, :ts
				WHERE ${guards.join(' AND ')}`,
			args,
		),
		eventAfterChangeStatement({
			kind: 'lend',
			equipment: { id: input.equipmentId },
			loanId: id,
			reservationId,
			subject: { id: person.id, name: person.name },
			actor,
			detail: { lentAt: now, dueAt: input.dueAt, note: input.note },
		}),
	];
	if (reservationId !== null) {
		// Guarded on the event insert above, which only happened if the loan was written.
		statements.push({
			sql: `UPDATE reservations SET status = 'fulfilled', loan_id = ?, updated_at = ?
				WHERE id = ? AND status = 'active' AND changes() = 1`,
			args: [id, ts, reservationId],
		});
	}
	let inserted: number;
	try {
		const results = await db.batch(statements, 'write');
		inserted = results[0].rowsAffected;
	} catch (err) {
		if (!isOpenLoanViolation(err)) {
			throw err;
		}
		inserted = 0;
	}
	if (inserted === 0) {
		// Lost a race: find out which rule stopped it now.
		throw (
			(await lendBlocker(db, input.equipmentId, person.id, now, input.dueAt)) ??
			new AppError(ErrorCode.EquipmentOnLoan)
		);
	}
	return (await loadLoan(db, actor, id)).view;
}

export interface ReturnInput {
	note: string | null;
	/** Admin only: where the equipment is kept from now on. */
	locationId: number | null;
	/** Admin only: suspend it (needs repair, broken, ...). */
	suspend: Suspension | null;
}

/**
 * Record a return, at the current time. The borrower returns their own loan
 * (kind `returned`); an admin may also record it for anyone (kind
 * `collected`), and at the same time set where it is kept and suspend it.
 * Works on suspended equipment too.
 */
export async function returnLoan(
	db: Client,
	actor: Actor,
	loanId: string,
	input: ReturnInput,
): Promise<LoanView> {
	const found = await loadLoan(db, actor, loanId);
	const own = found.userId === actor.id;
	if (!own && !actor.isAdmin) {
		throw new AppError(ErrorCode.LoanNotOwned);
	}
	if (input.locationId !== null || input.suspend !== null) {
		requireAdmin(actor);
	}
	if (found.view.returnedAt !== null) {
		throw new AppError(ErrorCode.LoanAlreadyReturned);
	}
	const location =
		input.locationId === null ? null : await findActiveMaster(db, 'locations', input.locationId);
	if (input.locationId !== null && !location) {
		throw new ValidationError({ locationId: 'not_found' });
	}

	const kind: ReturnKind = own ? 'returned' : 'collected';
	const now = nowLocal();
	const ts = nowIso();
	const equipmentId = found.view.equipmentId;
	const statements: InStatement[] = [
		namedStatement(
			`UPDATE loans SET returned_at = :now, return_kind = :kind, returned_by_id = :actorId,
					returned_by_name = :actorName, return_note = :note, return_location_id = :locationId,
					return_location_name = :locationName, updated_at = :ts
				WHERE id = :loanId AND returned_at IS NULL ${actor.isAdmin ? '' : 'AND user_id = :actorId'}`,
			{
				now,
				kind,
				actorId: actor.id,
				actorName: actor.name,
				note: input.note,
				locationId: location?.id ?? null,
				locationName: location?.name ?? null,
				ts,
				loanId,
			},
		),
		eventAfterChangeStatement({
			kind: 'return',
			equipment: { id: equipmentId },
			loanId,
			subject: { id: found.userId, name: found.view.name },
			actor,
			detail: {
				returnKind: kind,
				returnedAt: now,
				dueAt: found.view.dueAt,
				note: input.note,
				location: location?.name ?? null,
			},
		}),
	];
	if (location !== null) {
		statements.push({
			sql: `UPDATE equipment SET location_id = ?, version = version + 1, updated_at = ?
				WHERE id = ? AND changes() = 1`,
			args: [location.id, ts, equipmentId],
		});
	}
	if (input.suspend !== null) {
		statements.push(
			...suspendStatements(equipmentId, input.suspend, actor, { at: ts, followUp: true }),
		);
	}
	const [update] = await db.batch(statements, 'write');
	if (update.rowsAffected === 0) {
		throw new AppError(ErrorCode.LoanAlreadyReturned);
	}
	return (await loadLoan(db, actor, loanId)).view;
}

/**
 * Move the due time of an open loan (extend, or bring it forward): the
 * borrower or an admin. Refused when [now, new due) runs into someone else's
 * booking (`dueAt: conflict`).
 */
export async function extendLoan(
	db: Client,
	actor: Actor,
	loanId: string,
	dueAt: string,
): Promise<LoanView> {
	const found = await loadLoan(db, actor, loanId);
	if (found.userId !== actor.id && !actor.isAdmin) {
		throw new AppError(ErrorCode.LoanNotOwned);
	}
	if (found.view.returnedAt !== null) {
		throw new AppError(ErrorCode.LoanAlreadyReturned);
	}
	const now = nowLocal();
	if (!onStep(dueAt)) {
		throw new ValidationError({ dueAt: 'step' });
	}
	if (dueAt <= now) {
		throw new ValidationError({ dueAt: 'past' });
	}
	if (dueAt === found.view.dueAt) {
		return found.view;
	}
	const args = {
		id: loanId,
		equipmentId: found.view.equipmentId,
		userId: found.userId,
		now,
		dueAt,
		ts: nowIso(),
	};
	const conflict = await db.execute(namedStatement(`SELECT ${OTHERS_BOOKING_SQL} AS taken`, args));
	if (num(conflict.rows[0], 'taken') === 1) {
		throw new ValidationError({ dueAt: 'conflict' });
	}
	const [update] = await db.batch(
		[
			namedStatement(
				`UPDATE loans SET due_at = :dueAt, updated_at = :ts
					WHERE id = :id AND returned_at IS NULL AND NOT ${OTHERS_BOOKING_SQL}`,
				args,
			),
			eventAfterChangeStatement({
				kind: 'extend',
				equipment: { id: found.view.equipmentId },
				loanId,
				subject: { id: found.userId, name: found.view.name },
				actor,
				detail: { changes: { dueAt: [found.view.dueAt, dueAt] } },
			}),
		],
		'write',
	);
	if (update.rowsAffected === 0) {
		const again = await findLoan(db, actor, loanId);
		if (again?.view.returnedAt !== null) {
			throw new AppError(ErrorCode.LoanAlreadyReturned);
		}
		throw new ValidationError({ dueAt: 'conflict' });
	}
	return (await loadLoan(db, actor, loanId)).view;
}
