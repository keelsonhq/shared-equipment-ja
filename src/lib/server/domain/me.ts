import type { Client } from '@libsql/client';
import type { Actor } from '#lib/server/auth/actor.ts';
import { addMinutes, nowLocal } from '#lib/server/dates.ts';
import { strOrNull } from '#lib/server/db/rows.ts';
import { EARLY_PICKUP_MINUTES, type LoanView, listPersonLoans } from './loans.ts';
import { peopleIndex } from './directory.ts';
import { type ReservationView, withBookerDirectoryInfo } from './reservations.ts';

// The caller's own page (DESIGN.md §9-D): what I have out, my bookings to
// come, and my past loans. Anyone may read their own; nothing about other
// people is returned except why a booking of mine may not be picked up.

/**
 * Why my booking cannot be picked up as things stand: the equipment is
 * suspended, or someone else still has it (past its due time: `not_returned`).
 */
export type BookingBlock = 'suspended' | 'not_returned' | 'on_loan' | null;

export interface MyReservation extends ReservationView {
	blocked: BookingBlock;
	/** Due now (or within the early pick-up window) and not blocked. */
	canPickUp: boolean;
}

export interface MyPage {
	/** Open loans, soonest due first. */
	loans: LoanView[];
	/** Active bookings that are not over yet, soonest first. */
	reservations: MyReservation[];
	/** Every loan of mine, newest first (the two-column ledger). */
	history: LoanView[];
}

export async function getMyPage(db: Client, actor: Actor): Promise<MyPage> {
	const now = nowLocal();
	// One people index for the whole page (loans and bookings carry my image).
	const index = await peopleIndex();
	const [history, bookings] = await Promise.all([
		listPersonLoans(db, actor, actor.id, index),
		db.execute({
			sql: `SELECT r.*, e.asset_tag, e.name AS equipment_name, e.suspended_reason,
					(SELECT o.due_at FROM loans o WHERE o.equipment_id = r.equipment_id
						AND o.returned_at IS NULL AND o.user_id != r.user_id) AS other_due
				FROM reservations r
				JOIN equipment e ON e.id = r.equipment_id
				WHERE r.user_id = ? AND r.status = 'active' AND r.ends_at > ?
				ORDER BY r.starts_at`,
			args: [actor.id, now],
		}),
	]);
	const soon = addMinutes(now, EARLY_PICKUP_MINUTES);
	const views = withBookerDirectoryInfo(index, bookings.rows, actor, now);
	const reservations = bookings.rows.map((row, i): MyReservation => {
		const view = views[i];
		const otherDue = strOrNull(row, 'other_due');
		const blocked: BookingBlock = view.suspendedReason
			? 'suspended'
			: otherDue !== null
				? otherDue < now
					? 'not_returned'
					: 'on_loan'
				: null;
		return { ...view, blocked, canPickUp: blocked === null && view.startsAt <= soon };
	});
	const loans = history
		.filter((l) => l.returnedAt === null)
		.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
	return { loans, reservations, history };
}
