import { afterEach, describe, expect, it } from 'vite-plus/test';
import { suspendEquipment } from '#lib/server/domain/equipment.ts';
import { getHome } from '#lib/server/domain/home.ts';
import { lendEquipment } from '#lib/server/domain/loans.ts';
import { createReservation } from '#lib/server/domain/reservations.ts';
import { ADMIN, cleanupDbs, expectError, freshDb, MEMBER, OTHER } from './support/harness.ts';
import { addEquipment, lendInput, reserveInput, slot } from './support/helpers.ts';

// The admin home (DESIGN.md §9-L): today's figures, what needs action and
// today's schedule, in one request.

afterEach(cleanupDbs);

describe('home', () => {
	it('lists overdue loans, loans with a booking coming up, and suspended equipment', async () => {
		const db = await freshDb();
		const late = await addEquipment(db, 'H-1');
		const soon = await addEquipment(db, 'H-2');
		const broken = await addEquipment(db, 'H-3');
		await addEquipment(db, 'H-4');
		const lateLoan = await lendEquipment(db, MEMBER, lendInput(late, slot(8)));
		await db.execute({
			sql: 'UPDATE loans SET due_at = ? WHERE id = ?',
			args: [slot(-1), lateLoan.id],
		});
		await lendEquipment(db, MEMBER, lendInput(soon, slot(4)));
		await createReservation(db, OTHER, reserveInput(soon, slot(4), slot(8)));
		await createReservation(db, OTHER, reserveInput(broken, slot(8), slot(12)));
		await suspendEquipment(db, ADMIN, broken, 'repair', 'Lens');

		const home = await getHome(db, ADMIN);
		expect(home.attention.rows.map((r) => [r.kind, r.assetTag])).toEqual([
			['overdue', 'H-1'],
			['due_soon', 'H-2'],
			['suspended', 'H-3'],
		]);
		expect(home.attention.rows[1].next).toMatchObject({ name: OTHER.name, startsAt: slot(4) });
		expect(home.attention.rows[2]).toMatchObject({ bookings: 1, suspendedNote: 'Lens' });
		expect(home.counts.overdue).toBe(1);
		expect(home.counts.availableNow).toBe(1);
	});

	it('is admin-only', async () => {
		const db = await freshDb();
		await expectError(getHome(db, MEMBER), { status: 403, code: 'forbidden_manage_required' });
	});
});
