import type { Client } from '@libsql/client';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { listEquipment } from '#lib/server/domain/equipment.ts';
import { lendEquipment } from '#lib/server/domain/loans.ts';
import { listMasters, updateMaster } from '#lib/server/domain/masters.ts';
import { searchPeople, setDirectoryForTest } from '#lib/server/domain/directory.ts';
import { ensureDefaultMasters } from '#lib/server/domain/seed.ts';
import { parseEquipmentQuery } from '#lib/server/http/queries.ts';
import equipmentFile from '../seed-data/equipment.json';
import masters from '../seed-data/masters.json';
import devUsers from '../seed-data/dev-users.json';
import { ADMIN, cleanupDbs, expectError, freshDb, invalid, tempDbUrl } from './support/harness.ts';
import { lendInput, slot } from './support/helpers.ts';

// What a database contains after the server starts: default lists always,
// the sample ledger only in local development (`pnpm dev`), never in production.

afterEach(cleanupDbs);

const ALL = parseEquipmentQuery(new URLSearchParams('size=200'));
/** `pnpm dev` without the CLI: the SDK's local mode with the roster, and the samples. */
const LOCAL_DEV = {
	KEELSON_LOCAL_MODE: '1',
	KEELSON_LOCAL_USERS_FILE: 'seed-data/dev-users.json',
	LOCAL_SAMPLE_DATA: '1',
};
/** A general user of the local roster (seed-data/dev-users.json). */
const SAMPLE_PERSON = devUsers.users.filter((u) => !u.perms.includes('manage'))[0];

async function count(db: Client): Promise<number> {
	return (await listEquipment(db, ADMIN, ALL)).total;
}

describe('production-equivalent start (gateway sign-in, pnpm start)', () => {
	it('starts with an empty ledger and the default lists', async () => {
		const db = await freshDb();
		expect(await count(db)).toBe(0);
		const lists = await listMasters(db);
		expect(lists.types.map((t) => t.name)).toEqual(masters.types);
		expect(lists.locations.map((l) => l.name)).toEqual(masters.locations);
	});

	it('never loads samples, even if LOCAL_SAMPLE_DATA is set or in a Keelson deployment', async () => {
		expect(await count(await freshDb({ env: { LOCAL_SAMPLE_DATA: '1' } }))).toBe(0);
		expect(
			await count(
				await freshDb({ env: { ...LOCAL_DEV, KEELSON_APP_URL: 'https://example.test' } }),
			),
		).toBe(0);
	});

	it('does not re-add a default list entry an admin renamed', async () => {
		const db = await freshDb();
		const before = await listMasters(db);
		await updateMaster(db, ADMIN, 'locations', before.locations[0].id, { name: 'Basement' });
		await ensureDefaultMasters(db);
		const after = (await listMasters(db)).locations.map((l) => l.name);
		expect(after).toHaveLength(masters.locations.length);
		expect(after).not.toContain(masters.locations[0]);
	});

	it('offers no one without a directory, and refuses lending to a roster person outside it', async () => {
		const db = await freshDb({ samples: true });
		setDirectoryForTest(null, false);
		const res = await searchPeople(ADMIN, '');
		expect(res).toEqual({ state: 'unconfigured', items: [] });
		const free = (
			await listEquipment(db, ADMIN, parseEquipmentQuery(new URLSearchParams('status=available')))
		).rows[0];
		setDirectoryForTest(async () => []);
		await expectError(
			lendEquipment(db, ADMIN, lendInput(free.id, slot(4), { userId: SAMPLE_PERSON.id })),
			invalid({ userId: 'not_found' }),
		);
	});
});

describe('local development (pnpm dev)', () => {
	it('loads the sample ledger into an empty database, with every state the screens show', async () => {
		const db = await freshDb({ env: LOCAL_DEV });
		const { counts } = await listEquipment(db, ADMIN, ALL);
		expect(counts.all).toBe(equipmentFile.equipment.length);
		expect(counts.on_loan).toBeGreaterThan(0);
		expect(counts.overdue).toBeGreaterThan(0);
		expect(counts.reserved).toBeGreaterThan(0);
		expect(counts.suspended).toBe(equipmentFile.equipment.filter((e) => 'suspend' in e).length);
		expect(counts.available).toBeGreaterThan(0);
	});

	it('does not load the samples twice, and can start empty', async () => {
		const url = tempDbUrl();
		await freshDb({ env: LOCAL_DEV, url });
		expect(await count(await freshDb({ env: LOCAL_DEV, url }))).toBe(
			equipmentFile.equipment.length,
		);
		expect(await count(await freshDb({ env: { ...LOCAL_DEV, LOCAL_SAMPLE_DATA: '0' } }))).toBe(0);
	});

	it('lists the local roster as the members', async () => {
		await freshDb({ env: LOCAL_DEV });
		setDirectoryForTest(null);
		const res = await searchPeople(ADMIN, '');
		expect(res.state).toBe('ok');
		expect(res.items.map((p) => p.id).sort()).toEqual(devUsers.users.map((u) => u.id).sort());
	});

	it('lets the local admin lend to a roster person', async () => {
		const db = await freshDb({ env: LOCAL_DEV });
		setDirectoryForTest(null);
		const free = (
			await listEquipment(db, ADMIN, parseEquipmentQuery(new URLSearchParams('status=available')))
		).rows[0];
		const loan = await lendEquipment(
			db,
			ADMIN,
			lendInput(free.id, slot(4), { userId: SAMPLE_PERSON.id }),
		);
		expect(loan.name).toBe(SAMPLE_PERSON.name);
	});
});
