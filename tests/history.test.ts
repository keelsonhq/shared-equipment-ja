import type { Client } from '@libsql/client';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { addDays, today } from '#lib/server/dates.ts';
import { type EventQuery, listEvents } from '#lib/server/domain/events.ts';
import { lendEquipment, returnLoan } from '#lib/server/domain/loans.ts';
import { ADMIN, cleanupDbs, freshDb, MEMBER } from './support/harness.ts';
import { addEquipment, lendInput, slot } from './support/helpers.ts';

// The history screen's filters: kind, period, who acted and the search box.
// Each one adds a condition with its own named values, so every filter (and a
// combination) runs here through the strict client.

afterEach(cleanupDbs);

const NO_FILTER: EventQuery = {
	kinds: [],
	from: null,
	to: null,
	actorId: null,
	q: null,
	page: 1,
	size: 50,
};

async function history(db: Client, filter: Partial<EventQuery>): Promise<string[]> {
	const res = await listEvents(db, ADMIN, { ...NO_FILTER, ...filter });
	return res.rows.map((e) => `${e.kind} ${e.equipmentTag}`);
}

describe('history filters', () => {
	it('narrows by kind, period, actor and search, alone and together', async () => {
		const db = await freshDb();
		const borrowed = await addEquipment(db, 'PJ-H1');
		await addEquipment(db, 'PJ-H2');
		const loan = await lendEquipment(db, MEMBER, lendInput(borrowed, slot(8)));
		await returnLoan(db, MEMBER, loan.id, { note: null, locationId: null, suspend: null });

		expect(await history(db, {})).toEqual([
			'return PJ-H1',
			'lend PJ-H1',
			'create PJ-H2',
			'create PJ-H1',
		]);
		expect(await history(db, { kinds: ['lend', 'return'] })).toEqual([
			'return PJ-H1',
			'lend PJ-H1',
		]);
		expect(await history(db, { actorId: MEMBER.id })).toEqual(['return PJ-H1', 'lend PJ-H1']);
		expect(await history(db, { actorId: ADMIN.id })).toEqual(['create PJ-H2', 'create PJ-H1']);
		expect(await history(db, { q: 'H2' })).toEqual(['create PJ-H2']);
		// The person the event is about, or who acted.
		expect(await history(db, { q: MEMBER.name })).toEqual(['return PJ-H1', 'lend PJ-H1']);
		expect(await history(db, { from: today(), to: today() })).toHaveLength(4);
		expect(await history(db, { from: addDays(today(), 1) })).toEqual([]);
		expect(await history(db, { to: addDays(today(), -1) })).toEqual([]);
		expect(await history(db, { kinds: ['create'], q: 'H1', from: today() })).toEqual([
			'create PJ-H1',
		]);
	});
});
