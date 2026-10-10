import type { Client } from '@libsql/client';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { findEquipment, resumeEquipment, suspendEquipment } from '#lib/server/domain/equipment.ts';
import { listEquipmentEvents } from '#lib/server/domain/events.ts';
import {
	extendLoan,
	lendEquipment,
	listEquipmentLoans,
	returnLoan,
} from '#lib/server/domain/loans.ts';
import { getMyPage } from '#lib/server/domain/me.ts';
import {
	createReservation,
	findReservation,
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
import {
	addEquipment,
	lendInput,
	locationId,
	reserveInput,
	returnInput,
	slot,
} from './support/helpers.ts';

// Loans: one open loan per piece of equipment, the
// [now, due) overlap rule against other people's bookings, never returned
// automatically, returns by the borrower ("returned") or an admin
// ("collected"), and extensions.

afterEach(cleanupDbs);

async function makeOverdue(db: Client, loanId: string) {
	await db.execute({ sql: 'UPDATE loans SET due_at = ? WHERE id = ?', args: [slot(-2), loanId] });
}

describe('lending', () => {
	it('lends free equipment to oneself and logs the event', async () => {
		const db = await freshDb();
		const id = await addEquipment(db, 'SP-1');
		const loan = await lendEquipment(db, MEMBER, lendInput(id, slot(8)));
		expect(loan).toMatchObject({ mine: true, name: MEMBER.name, dueAt: slot(8), returnedAt: null });
		expect((await findEquipment(db, MEMBER, id))?.status).toBe('on_loan');
		const kinds = (await listEquipmentEvents(db, ADMIN, id)).map((e) => e.kind);
		expect(kinds).toEqual(['lend', 'create']);
	});

	it("picks up the borrower's own booking that covers now", async () => {
		const db = await freshDb();
		const id = await addEquipment(db, 'SP-2');
		const r = await createReservation(db, MEMBER, reserveInput(id, slot(0), slot(8)));
		const loan = await lendEquipment(db, MEMBER, lendInput(id, slot(8)));
		expect(loan.reservationId).toBe(r.id);
		const after = await findReservation(db, ADMIN, r.id);
		expect(after?.view).toMatchObject({ status: 'fulfilled', loanId: loan.id });
	});

	it('lets a booking be picked up up to 30 minutes early', async () => {
		const db = await freshDb();
		const id = await addEquipment(db, 'SP-3');
		const r = await createReservation(db, MEMBER, reserveInput(id, slot(1), slot(8)));
		const loan = await lendEquipment(db, MEMBER, lendInput(id, slot(8), { reservationId: r.id }));
		expect(loan.reservationId).toBe(r.id);
		// Too early for a booking further out.
		const id2 = await addEquipment(db, 'SP-3B');
		const later = await createReservation(db, MEMBER, reserveInput(id2, slot(6), slot(8)));
		await expectError(
			lendEquipment(db, MEMBER, lendInput(id2, slot(8), { reservationId: later.id })),
			{
				status: 409,
				code: 'reservation_not_active',
			},
		);
	});

	it("refuses while someone else's booking runs now", async () => {
		const db = await freshDb();
		const id = await addEquipment(db, 'SP-4');
		await createReservation(db, OTHER, reserveInput(id, slot(0), slot(4)));
		await expectError(lendEquipment(db, MEMBER, lendInput(id, slot(2))), {
			status: 409,
			code: 'equipment_reserved',
		});
	});

	it('keeps a walk-in loan before the next booking of someone else', async () => {
		const db = await freshDb();
		const id = await addEquipment(db, 'SP-5');
		await createReservation(db, OTHER, reserveInput(id, slot(4), slot(8)));
		await expectError(
			lendEquipment(db, MEMBER, lendInput(id, slot(5))),
			invalid({ dueAt: 'conflict' }),
		);
		// Due exactly when the booking starts: allowed (half-open periods).
		const loan = await lendEquipment(db, MEMBER, lendInput(id, slot(4)));
		expect(loan.dueAt).toBe(slot(4));
	});

	it('lets exactly one of simultaneous loans win', async () => {
		const db = await freshDb();
		const id = await addEquipment(db, 'SP-6');
		const results = await Promise.allSettled([
			lendEquipment(db, MEMBER, lendInput(id, slot(4))),
			lendEquipment(db, OTHER, lendInput(id, slot(4))),
			lendEquipment(db, ADMIN, lendInput(id, slot(4), { userId: MEMBER.id })),
		]);
		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		for (const r of results.filter((x) => x.status === 'rejected')) {
			expect(((r as PromiseRejectedResult).reason as AppError).code).toBe('equipment_on_loan');
		}
		expect((await listEquipmentLoans(db, ADMIN, id)).filter((l) => !l.returnedAt)).toHaveLength(1);
		const lends = (await listEquipmentEvents(db, ADMIN, id)).filter((e) => e.kind === 'lend');
		expect(lends).toHaveLength(1);
	});

	it('enforces one open loan per piece of equipment in the database', async () => {
		const db = await freshDb();
		const id = await addEquipment(db, 'SP-7');
		await lendEquipment(db, MEMBER, lendInput(id, slot(4)));
		await expect(
			db.execute({
				sql: `INSERT INTO loans (id, equipment_id, user_id, user_name, lent_at, due_at, lent_by_id,
					lent_by_name, created_at, updated_at) VALUES ('x', ?, 'u', 'u', 't', 't', 'a', 'a', 't', 't')`,
				args: [id],
			}),
		).rejects.toThrow(/UNIQUE/);
	});

	it('never returns an overdue loan by itself and refuses the next borrower', async () => {
		const db = await freshDb();
		const id = await addEquipment(db, 'SP-8');
		const first = await lendEquipment(db, OTHER, lendInput(id, slot(4)));
		await makeOverdue(db, first.id);
		// My booking for now is there, but the previous borrower still has it.
		await createReservation(db, MEMBER, reserveInput(id, slot(0), slot(8)));
		await expectError(lendEquipment(db, MEMBER, lendInput(id, slot(8))), {
			status: 409,
			code: 'previous_loan_not_returned',
		});
		const view = await findEquipment(db, ADMIN, id);
		expect(view?.status).toBe('overdue');
		expect(view?.loan).toMatchObject({ id: first.id, overdue: true });
		const mine = await getMyPage(db, MEMBER);
		expect(mine.reservations[0]).toMatchObject({ blocked: 'not_returned', canPickUp: false });
		// Once it comes back, the booking can be picked up.
		await returnLoan(db, OTHER, first.id, returnInput());
		const loan = await lendEquipment(db, MEMBER, lendInput(id, slot(8)));
		expect(loan.reservationId).not.toBeNull();
	});

	it('stops lending suspended equipment, but its loan can still be returned', async () => {
		const db = await freshDb();
		const id = await addEquipment(db, 'SP-9');
		const loan = await lendEquipment(db, MEMBER, lendInput(id, slot(4)));
		await suspendEquipment(db, ADMIN, id, 'broken', 'Cracked screen');
		expect((await returnLoan(db, MEMBER, loan.id, returnInput())).returnKind).toBe('returned');
		await expectError(lendEquipment(db, OTHER, lendInput(id, slot(4))), {
			status: 409,
			code: 'equipment_suspended',
		});
		await resumeEquipment(db, ADMIN, id);
		expect((await lendEquipment(db, OTHER, lendInput(id, slot(4)))).name).toBe(OTHER.name);
	});

	it('checks the due time and who may lend to whom', async () => {
		const db = await freshDb();
		const id = await addEquipment(db, 'SP-10');
		await expectError(
			lendEquipment(db, MEMBER, lendInput(id, `${slot(4).slice(0, 14)}07`)),
			invalid({
				dueAt: 'step',
			}),
		);
		await expectError(
			lendEquipment(db, MEMBER, lendInput(id, slot(0))),
			invalid({ dueAt: 'past' }),
		);
		await expectError(lendEquipment(db, MEMBER, lendInput(id, slot(4), { userId: OTHER.id })), {
			status: 403,
			code: 'forbidden_manage_required',
		});
		await expectError(
			lendEquipment(db, ADMIN, lendInput(id, slot(4), { userId: 'u-stranger' })),
			invalid({
				userId: 'not_found',
			}),
		);
		const loan = await lendEquipment(db, ADMIN, lendInput(id, slot(4), { userId: OTHER.id }));
		expect(loan).toMatchObject({ name: OTHER.name, lentByName: ADMIN.name });
	});
});

describe('return', () => {
	it('records the borrower\'s return as "returned"', async () => {
		const db = await freshDb();
		const id = await addEquipment(db, 'TB-1');
		const loan = await lendEquipment(db, MEMBER, lendInput(id, slot(4)));
		const back = await returnLoan(db, MEMBER, loan.id, { ...returnInput(), note: 'Fine' });
		expect(back).toMatchObject({
			returnKind: 'returned',
			returnedByName: MEMBER.name,
			returnNote: 'Fine',
		});
		expect(back.returnedAt).not.toBeNull();
		expect((await findEquipment(db, MEMBER, id))?.status).toBe('available');
		await expectError(returnLoan(db, MEMBER, loan.id, returnInput()), {
			status: 409,
			code: 'loan_already_returned',
		});
	});

	it("refuses a member returning someone else's loan", async () => {
		const db = await freshDb();
		const id = await addEquipment(db, 'TB-2');
		const loan = await lendEquipment(db, MEMBER, lendInput(id, slot(4)));
		await expectError(returnLoan(db, OTHER, loan.id, returnInput()), {
			status: 403,
			code: 'loan_not_owned',
		});
		await expectError(
			returnLoan(db, MEMBER, loan.id, { ...returnInput(), locationId: await locationId(db) }),
			{ status: 403, code: 'forbidden_manage_required' },
		);
	});

	it('lets an admin collect, move it and suspend it in one step', async () => {
		const db = await freshDb();
		const id = await addEquipment(db, 'TB-3');
		const loan = await lendEquipment(db, MEMBER, lendInput(id, slot(4)));
		const location = await locationId(db, 2);
		const back = await returnLoan(db, ADMIN, loan.id, {
			note: 'Left at reception',
			locationId: location,
			suspend: { reason: 'repair', note: 'Battery swells' },
		});
		expect(back).toMatchObject({ returnKind: 'collected', returnedByName: ADMIN.name });
		const after = await findEquipment(db, ADMIN, id);
		expect(after).toMatchObject({ locationId: location, suspendedReason: 'repair' });
		const kinds = (await listEquipmentEvents(db, ADMIN, id)).map((e) => e.kind);
		expect(kinds).toEqual(['suspend', 'return', 'lend', 'create']);
	});
});

describe('extend', () => {
	it('moves the due time and logs the change', async () => {
		const db = await freshDb();
		const id = await addEquipment(db, 'NW-1');
		const loan = await lendEquipment(db, MEMBER, lendInput(id, slot(4)));
		const longer = await extendLoan(db, MEMBER, loan.id, slot(12));
		expect(longer.dueAt).toBe(slot(12));
		const extend = (await listEquipmentEvents(db, ADMIN, id)).find((e) => e.kind === 'extend');
		expect(extend?.detail).toEqual({ changes: { dueAt: [slot(4), slot(12)] } });
	});

	it("refuses running into someone else's booking, and other people", async () => {
		const db = await freshDb();
		const id = await addEquipment(db, 'NW-2');
		const loan = await lendEquipment(db, MEMBER, lendInput(id, slot(4)));
		await createReservation(db, OTHER, reserveInput(id, slot(6), slot(10)));
		await expectError(extendLoan(db, MEMBER, loan.id, slot(8)), invalid({ dueAt: 'conflict' }));
		expect((await extendLoan(db, MEMBER, loan.id, slot(6))).dueAt).toBe(slot(6));
		await expectError(extendLoan(db, OTHER, loan.id, slot(5)), {
			status: 403,
			code: 'loan_not_owned',
		});
		// An admin may move it too (still not into the booking).
		expect((await extendLoan(db, ADMIN, loan.id, slot(5))).dueAt).toBe(slot(5));
	});
});

describe('my page and the ledger of others', () => {
	it('shows my loans and bookings, warns about suspended equipment', async () => {
		const db = await freshDb();
		const a = await addEquipment(db, 'AU-1');
		const b = await addEquipment(db, 'AU-2');
		await lendEquipment(db, MEMBER, lendInput(a, slot(4)));
		await createReservation(db, MEMBER, reserveInput(b, slot(8), slot(12)));
		await suspendEquipment(db, ADMIN, b, 'repair', null);
		const page = await getMyPage(db, MEMBER);
		expect(page.loans.map((l) => l.assetTag)).toEqual(['AU-1']);
		expect(page.reservations[0]).toMatchObject({ assetTag: 'AU-2', blocked: 'suspended' });
		expect(page.history).toHaveLength(1);
		expect((await getMyPage(db, OTHER)).loans).toEqual([]);
	});

	it('shows members only their own past loans of a piece of equipment', async () => {
		const db = await freshDb();
		const id = await addEquipment(db, 'AU-3');
		const theirs = await lendEquipment(db, OTHER, lendInput(id, slot(4)));
		await returnLoan(db, OTHER, theirs.id, returnInput());
		const mine = await lendEquipment(db, MEMBER, lendInput(id, slot(4)));
		expect((await listEquipmentLoans(db, MEMBER, id)).map((l) => l.id)).toEqual([mine.id]);
		expect(await listEquipmentLoans(db, ADMIN, id)).toHaveLength(2);
		// The booking list still shows the occupancy of others (name and period).
		await createReservation(db, OTHER, reserveInput(id, slot(8), slot(10)));
		const [upcoming] = await listUpcomingForEquipment(db, MEMBER, id);
		expect(upcoming).toMatchObject({ name: OTHER.name, mine: false });
	});
});
