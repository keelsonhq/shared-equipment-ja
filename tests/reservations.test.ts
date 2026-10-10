import { afterEach, describe, expect, it } from 'vite-plus/test';
import { suspendEquipment } from '#lib/server/domain/equipment.ts';
import { listEquipmentEvents } from '#lib/server/domain/events.ts';
import { lendEquipment } from '#lib/server/domain/loans.ts';
import {
	cancelReservation,
	createReservation,
	listReservations,
	listUpcomingForEquipment,
} from '#lib/server/domain/reservations.ts';
import type { AppError } from '#lib/server/errors.ts';
import {
	ADMIN,
	cleanupDbs,
	expectError,
	freshDb,
	invalid,
	MEMBER,
	OTHER,
} from './support/harness.ts';
import { addEquipment, day, lendInput, reserveInput, slot } from './support/helpers.ts';

// Bookings: no overlap with another active booking of
// the same equipment, half-open periods, one winner under concurrency.

afterEach(cleanupDbs);

describe('booking', () => {
	it('books a free slot and logs the event', async () => {
		const db = await freshDb();
		const id = await addEquipment(db, 'PJ-1');
		const r = await createReservation(
			db,
			MEMBER,
			reserveInput(id, day(1, '10:00'), day(1, '12:00'), { purpose: 'Demo' }),
		);
		expect(r).toMatchObject({ status: 'active', mine: true, name: MEMBER.name, purpose: 'Demo' });
		const kinds = (await listEquipmentEvents(db, ADMIN, id)).map((e) => e.kind);
		expect(kinds).toEqual(['reserve', 'create']);
	});

	it('refuses an overlap under the start field, and allows back-to-back periods', async () => {
		const db = await freshDb();
		const id = await addEquipment(db, 'PJ-2');
		await createReservation(db, MEMBER, reserveInput(id, day(1, '10:00'), day(1, '12:00')));
		// Inside, around, and touching from either side by one step.
		for (const [s, e] of [
			['11:00', '11:30'],
			['09:00', '13:00'],
			['09:45', '10:15'],
			['11:45', '12:15'],
		]) {
			await expectError(
				createReservation(db, OTHER, reserveInput(id, day(1, s), day(1, e))),
				invalid({
					startsAt: 'overlap',
				}),
			);
		}
		// [10:00, 12:00) and [12:00, 13:00) / [09:00, 10:00) do not overlap.
		const after = await createReservation(
			db,
			OTHER,
			reserveInput(id, day(1, '12:00'), day(1, '13:00')),
		);
		const before = await createReservation(
			db,
			OTHER,
			reserveInput(id, day(1, '09:00'), day(1, '10:00')),
		);
		expect([after.status, before.status]).toEqual(['active', 'active']);
	});

	it('lets exactly one of simultaneous bookings of the same slot win', async () => {
		const db = await freshDb();
		const id = await addEquipment(db, 'PJ-3');
		const results = await Promise.allSettled([
			createReservation(db, MEMBER, reserveInput(id, day(2, '10:00'), day(2, '11:00'))),
			createReservation(db, OTHER, reserveInput(id, day(2, '10:30'), day(2, '11:30'))),
			createReservation(db, ADMIN, reserveInput(id, day(2, '09:45'), day(2, '10:15'))),
		]);
		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		for (const r of results.filter((x) => x.status === 'rejected')) {
			expect(((r as PromiseRejectedResult).reason as AppError).code).toBe('validation_failed');
		}
		expect(await listUpcomingForEquipment(db, ADMIN, id)).toHaveLength(1);
		const reserves = (await listEquipmentEvents(db, ADMIN, id)).filter((e) => e.kind === 'reserve');
		expect(reserves).toHaveLength(1);
	});

	it('checks steps, order, the past and the length', async () => {
		const db = await freshDb();
		const id = await addEquipment(db, 'PJ-4');
		await expectError(
			createReservation(db, MEMBER, reserveInput(id, day(1, '10:10'), day(1, '10:00'))),
			invalid({
				startsAt: 'step',
				endsAt: 'before_start',
			}),
		);
		await expectError(
			createReservation(db, MEMBER, reserveInput(id, slot(-1), slot(2))),
			invalid({
				startsAt: 'past',
			}),
		);
		await expectError(
			createReservation(db, MEMBER, reserveInput(id, day(1, '10:00'), day(40, '10:00'))),
			invalid({
				endsAt: 'period_too_long',
			}),
		);
		await expectError(
			createReservation(db, MEMBER, reserveInput(9999, day(1, '10:00'), day(1, '11:00'))),
			invalid({
				equipmentId: 'not_found',
			}),
		);
		// The current step may be booked: a booking that starts "now".
		const now = await createReservation(db, MEMBER, reserveInput(id, slot(0), slot(2)));
		expect(now.current).toBe(true);
	});

	it('refuses suspended equipment, and keeps the bookings it already has', async () => {
		const db = await freshDb();
		const id = await addEquipment(db, 'PJ-5');
		await createReservation(db, MEMBER, reserveInput(id, day(1, '10:00'), day(1, '11:00')));
		await suspendEquipment(db, ADMIN, id, 'repair', null);
		await expectError(
			createReservation(db, OTHER, reserveInput(id, day(2, '10:00'), day(2, '11:00'))),
			{
				status: 409,
				code: 'equipment_suspended',
			},
		);
		const kept = await listUpcomingForEquipment(db, MEMBER, id);
		expect(kept).toHaveLength(1);
		expect(kept[0].suspendedReason).toBe('repair');
	});

	it('lets an admin book for someone else, but not a member (403)', async () => {
		const db = await freshDb();
		const id = await addEquipment(db, 'PJ-6');
		const r = await createReservation(
			db,
			ADMIN,
			reserveInput(id, day(1, '10:00'), day(1, '11:00'), { userId: MEMBER.id }),
		);
		expect(r).toMatchObject({ name: MEMBER.name, userId: MEMBER.id, bookedByName: ADMIN.name });
		await expectError(
			createReservation(
				db,
				MEMBER,
				reserveInput(id, day(1, '12:00'), day(1, '13:00'), { userId: OTHER.id }),
			),
			{ status: 403, code: 'forbidden_manage_required' },
		);
	});

	it('treats an open loan as taken until its due time, but not once it is overdue', async () => {
		const db = await freshDb();
		const id = await addEquipment(db, 'PJ-7');
		const loan = await lendEquipment(db, MEMBER, lendInput(id, slot(8)));
		await expectError(
			createReservation(db, OTHER, reserveInput(id, slot(4), slot(12))),
			invalid({
				startsAt: 'overlap',
			}),
		);
		expect((await createReservation(db, OTHER, reserveInput(id, slot(8), slot(12)))).status).toBe(
			'active',
		);
		// Overdue: the booking can be made (the hand-over is what stops).
		await db.execute({
			sql: 'UPDATE loans SET due_at = ? WHERE id = ?',
			args: [slot(-4), loan.id],
		});
		expect((await createReservation(db, ADMIN, reserveInput(id, slot(0), slot(4)))).status).toBe(
			'active',
		);
	});
});

describe('cancel', () => {
	it('lets the owner or an admin cancel an active booking, nobody else', async () => {
		const db = await freshDb();
		const id = await addEquipment(db, 'CM-1');
		const r = await createReservation(
			db,
			MEMBER,
			reserveInput(id, day(1, '10:00'), day(1, '11:00')),
		);
		await expectError(cancelReservation(db, OTHER, r.id), {
			status: 403,
			code: 'reservation_not_owned',
		});
		const cancelled = await cancelReservation(db, MEMBER, r.id);
		expect(cancelled.status).toBe('cancelled');
		await expectError(cancelReservation(db, MEMBER, r.id), {
			status: 409,
			code: 'reservation_not_active',
		});
		const r2 = await createReservation(
			db,
			OTHER,
			reserveInput(id, day(1, '10:00'), day(1, '11:00')),
		);
		expect((await cancelReservation(db, ADMIN, r2.id)).cancelledByName).toBe(ADMIN.name);
		await expectError(cancelReservation(db, MEMBER, 'nope'), {
			status: 404,
			code: 'reservation_not_found',
		});
		const kinds = (await listEquipmentEvents(db, ADMIN, id)).map((e) => e.kind);
		expect(kinds.filter((k) => k === 'cancel')).toHaveLength(2);
	});

	it('frees the slot for someone else', async () => {
		const db = await freshDb();
		const id = await addEquipment(db, 'CM-2');
		const r = await createReservation(
			db,
			MEMBER,
			reserveInput(id, day(1, '10:00'), day(1, '11:00')),
		);
		await cancelReservation(db, MEMBER, r.id);
		const again = await createReservation(
			db,
			OTHER,
			reserveInput(id, day(1, '10:00'), day(1, '11:00')),
		);
		expect(again.status).toBe('active');
	});
});

describe('who sees what', () => {
	it('shows members who and when, never other people purposes or ids', async () => {
		const db = await freshDb();
		const id = await addEquipment(db, 'CM-3');
		await createReservation(
			db,
			OTHER,
			reserveInput(id, day(1, '10:00'), day(1, '11:00'), { purpose: 'Secret' }),
		);
		await createReservation(
			db,
			MEMBER,
			reserveInput(id, day(1, '11:00'), day(1, '12:00'), { purpose: 'Mine' }),
		);
		const [theirs, mine] = await listUpcomingForEquipment(db, MEMBER, id);
		expect(theirs).toMatchObject({ name: OTHER.name, mine: false, purpose: null });
		expect(theirs).not.toHaveProperty('userId');
		expect(theirs).not.toHaveProperty('email');
		expect(mine).toMatchObject({ mine: true, purpose: 'Mine' });
		const [adminView] = await listUpcomingForEquipment(db, ADMIN, id);
		expect(adminView).toMatchObject({ purpose: 'Secret', userId: OTHER.id });
	});

	it("lists my bookings (upcoming / past), and everyone's for admins only", async () => {
		const db = await freshDb();
		const id = await addEquipment(db, 'CM-4');
		const r = await createReservation(
			db,
			MEMBER,
			reserveInput(id, day(1, '10:00'), day(1, '11:00')),
		);
		await createReservation(db, OTHER, reserveInput(id, day(1, '11:00'), day(1, '12:00')));
		await createReservation(db, MEMBER, reserveInput(id, day(2, '10:00'), day(2, '11:00')));
		await cancelReservation(db, MEMBER, r.id);
		const paging = { from: null, to: null, q: null, page: 1, size: 50 };
		const upcoming = await listReservations(db, MEMBER, {
			scope: 'mine',
			when: 'upcoming',
			...paging,
		});
		const past = await listReservations(db, MEMBER, { scope: 'mine', when: 'past', ...paging });
		expect(upcoming.total).toBe(1);
		expect(past.rows.map((x) => x.status)).toEqual(['cancelled']);
		await expectError(listReservations(db, MEMBER, { scope: 'all', when: 'upcoming', ...paging }), {
			status: 403,
			code: 'forbidden_manage_required',
		});
		const all = await listReservations(db, ADMIN, {
			scope: 'all',
			when: 'upcoming',
			...paging,
			from: day(1, '00:00').slice(0, 10),
			to: day(1, '00:00').slice(0, 10),
		});
		expect(all.total).toBe(2);
	});
});
