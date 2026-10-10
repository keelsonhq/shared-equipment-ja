import { afterEach, describe, expect, it } from 'vite-plus/test';
import {
	loanTargetOfAttention,
	loanTargetOfEquipment,
	loanTargetOfLoan,
	loanTargetOfToday,
} from '#lib/components/loans/loanTarget.ts';
import { getEquipment } from '#lib/server/domain/equipment.ts';
import { getHome, type TodayRow } from '#lib/server/domain/home.ts';
import { lendEquipment } from '#lib/server/domain/loans.ts';
import { getMyPage } from '#lib/server/domain/me.ts';
import { ADMIN, cleanupDbs, freshDb, MEMBER } from './support/harness.ts';
import { addEquipment, lendInput, slot } from './support/helpers.ts';

// The return / extend dialogs' target, from the rows the API gives the
// screens: a piece of equipment (ledger, equipment page), a loan (my page) and
// the home screen's rows. All describe the same open loan.

afterEach(cleanupDbs);

async function overdueLoan() {
	const db = await freshDb();
	const id = await addEquipment(db, 'PJ-1', { name: 'Projector' });
	const loan = await lendEquipment(db, MEMBER, lendInput(id, slot(8)));
	// Overdue, so the home screen lists it as needing action.
	await db.execute({ sql: 'UPDATE loans SET due_at = ? WHERE id = ?', args: [slot(-2), loan.id] });
	return { db, id, loanId: loan.id };
}

describe('loan targets', () => {
	it('describe the same open loan from the equipment, the loan and the home row', async () => {
		const { db, id, loanId } = await overdueLoan();
		const expected = {
			loanId,
			assetTag: 'PJ-1',
			equipmentName: 'Projector',
			name: MEMBER.name,
			lentAt: expect.any(String),
			dueAt: slot(-2),
		};
		const fromEquipment = loanTargetOfEquipment((await getEquipment(db, MEMBER, id)).equipment);
		expect(fromEquipment).toEqual({ ...expected, mine: true });
		const [mine] = (await getMyPage(db, MEMBER)).loans;
		expect(loanTargetOfLoan(mine)).toEqual(fromEquipment);
		// The home screen is the admin's: the loan is someone else's.
		const row = (await getHome(db, ADMIN)).attention.rows.find((r) => r.equipmentId === id);
		if (!row) throw new Error('no attention row');
		expect(loanTargetOfAttention(row)).toEqual({ ...fromEquipment, mine: false });
	});

	it('are null when nothing is out', async () => {
		const db = await freshDb();
		const id = await addEquipment(db, 'PJ-2');
		expect(loanTargetOfEquipment((await getEquipment(db, ADMIN, id)).equipment)).toBeNull();
		const booking: TodayRow = {
			kind: 'reservation',
			at: slot(4),
			endsAt: slot(8),
			lentAt: null,
			equipmentId: id,
			assetTag: 'PJ-2',
			equipmentName: 'Projector',
			userId: MEMBER.id,
			name: MEMBER.name,
			imageUrl: null,
			membership: 'member',
			loanId: null,
			overdue: false,
			status: 'active',
		};
		// One rule for every screen: no blank to fill in, never a half target.
		expect(loanTargetOfToday(booking)).toBeNull();
		expect(loanTargetOfToday({ ...booking, kind: 'return', loanId: 'l-1' })).toBeNull();
		expect(
			loanTargetOfToday({ ...booking, kind: 'return', loanId: 'l-1', lentAt: slot(-8) }),
		).toMatchObject({ loanId: 'l-1', lentAt: slot(-8), dueAt: slot(4), mine: false });
	});
});
