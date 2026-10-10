import type { MemberItem } from '@keelsonhq/identity';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import * as equipmentLoansRoute from '../src/routes/api/equipment/[id]/loans/+server.ts';
import * as meRoute from '../src/routes/api/me/+server.ts';
import { getEquipment, listEquipment } from '#lib/server/domain/equipment.ts';
import { getHome } from '#lib/server/domain/home.ts';
import { lendEquipment, type LoanView, listEquipmentLoans } from '#lib/server/domain/loans.ts';
import { getMyPage } from '#lib/server/domain/me.ts';
import {
	directorySnapshot,
	memberToPerson,
	type Person,
	searchPeople,
	setDirectoryForTest,
} from '#lib/server/domain/directory.ts';
import {
	createReservation,
	listReservations,
	listUpcomingForEquipment,
} from '#lib/server/domain/reservations.ts';
import { parseEquipmentQuery } from '#lib/server/http/queries.ts';
import {
	ADMIN,
	cleanupDbs,
	directoryPerson,
	freshDb,
	IMAGE_URLS,
	MEMBER,
	OTHER,
} from './support/harness.ts';
import { addEquipment, lendInput, reserveInput, slot } from './support/helpers.ts';
import { as, call } from './support/http.ts';

afterEach(cleanupDbs);

// A cold cache under concurrent requests (every page load reads the index
// through /api/me) must cost one directory read, shared by all of them.
describe('directory cache', () => {
	it('shares one read between concurrent requests', async () => {
		await freshDb();
		let calls = 0;
		let release: (people: Person[]) => void = () => {};
		setDirectoryForTest(() => {
			calls++;
			return new Promise<Person[]>((resolve) => {
				release = resolve;
			});
		});
		const pending = Promise.all(Array.from({ length: 5 }, () => directorySnapshot()));
		expect(calls).toBe(1);
		release([directoryPerson(ADMIN)]);
		const all = await pending;
		expect(all.map((r) => r.state)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
		expect(all[0].people.map((p) => p.id)).toEqual([ADMIN.id]);
		expect(all.every((r) => r.people === all[0].people)).toBe(true);
		// Served from the cache afterwards.
		expect((await directorySnapshot()).people).toBe(all[0].people);
		expect(calls).toBe(1);
	});

	it('shares one failed read too, and caches the failure', async () => {
		await freshDb();
		let calls = 0;
		setDirectoryForTest(async () => {
			calls++;
			await new Promise((resolve) => setTimeout(resolve, 5));
			throw new Error('network down');
		});
		const all = await Promise.all(Array.from({ length: 5 }, () => directorySnapshot()));
		expect(calls).toBe(1);
		expect(all.every((r) => r.state === 'unavailable' && r.people.length === 0)).toBe(true);
		// The failure is cached (FAILURE_TTL_MS): no new read right away.
		expect((await directorySnapshot()).state).toBe('unavailable');
		expect(calls).toBe(1);
	});
});

// Profile images come from the directory and are looked up on every display,
// never stored. Every response that names a person
// carries `imageUrl`: the member's current image, or null.
describe('profile images', () => {
	const EVERYONES_UPCOMING = {
		scope: 'all' as const,
		when: 'upcoming' as const,
		from: null,
		to: null,
		q: null,
		page: 1,
		size: 50,
	};

	it('maps the directory image_url, treating a missing one as null', () => {
		const base: MemberItem = {
			id: 'u-1',
			email: 'u1@example.com',
			name: 'U One',
			role: null,
			image_url: 'https://img.example.com/u/1',
		};
		expect(memberToPerson(base).imageUrl).toBe('https://img.example.com/u/1');
		expect(memberToPerson({ ...base, image_url: null }).imageUrl).toBeNull();
		// An older directory that does not send the field at all.
		const { image_url: _omitted, ...withoutImage } = base;
		expect(memberToPerson(withoutImage as MemberItem).imageUrl).toBeNull();
	});

	it('puts the image on every response that names a member', async () => {
		const db = await freshDb();
		const projector = await addEquipment(db, 'PJ-10');
		const camera = await addEquipment(db, 'CM-11');
		const drone = await addEquipment(db, 'DR-12');
		// ADMIN (with an image) and MEMBER (without) have something out; OTHER
		// (with an image) has booked the projector next and the drone right now.
		await lendEquipment(db, ADMIN, lendInput(projector, slot(8)));
		await lendEquipment(db, ADMIN, lendInput(camera, slot(8), { userId: MEMBER.id }));
		await createReservation(
			db,
			ADMIN,
			reserveInput(projector, slot(8), slot(12), { userId: OTHER.id }),
		);
		await createReservation(db, ADMIN, reserveInput(drone, slot(0), slot(4), { userId: OTHER.id }));

		// Who am I (/api/me), with and without an image.
		const admin = await call(meRoute.GET, 'GET', '/api/me', { headers: as(ADMIN) });
		expect(admin.body).toMatchObject({ userId: ADMIN.id, imageUrl: IMAGE_URLS[ADMIN.id] });
		const member = await call(meRoute.GET, 'GET', '/api/me', { headers: as(MEMBER) });
		expect(member.body).toMatchObject({ userId: MEMBER.id, imageUrl: null });

		// Picker candidates.
		const search = await searchPeople(ADMIN, '');
		expect(search.items.find((p) => p.id === OTHER.id)?.imageUrl).toBe(IMAGE_URLS[OTHER.id]);
		expect(search.items.find((p) => p.id === MEMBER.id)?.imageUrl).toBeNull();

		// The ledger and an equipment page: the current borrower, for a member
		// too (whose view has no user id, but still the image).
		const ledger = await listEquipment(db, MEMBER, parseEquipmentQuery(new URLSearchParams()));
		const borrowers = new Map(ledger.rows.map((r) => [r.assetTag, r.loan?.imageUrl]));
		expect(borrowers.get('PJ-10')).toBe(IMAGE_URLS[ADMIN.id]);
		expect(borrowers.get('CM-11')).toBeNull();
		expect(ledger.rows.find((r) => r.assetTag === 'PJ-10')?.loan).not.toHaveProperty('userId');
		expect((await getEquipment(db, MEMBER, projector)).equipment.loan?.imageUrl).toBe(
			IMAGE_URLS[ADMIN.id],
		);
		expect((await getEquipment(db, ADMIN, camera)).equipment.loan?.imageUrl).toBeNull();

		// The loan ledger of a piece of equipment and its upcoming bookings.
		expect((await listEquipmentLoans(db, ADMIN, projector)).map((l) => l.imageUrl)).toEqual([
			IMAGE_URLS[ADMIN.id],
		]);
		expect((await listEquipmentLoans(db, ADMIN, camera)).map((l) => l.imageUrl)).toEqual([null]);
		const [upcoming] = await listUpcomingForEquipment(db, MEMBER, projector);
		expect(upcoming).toMatchObject({ name: OTHER.name, imageUrl: IMAGE_URLS[OTHER.id] });
		expect(upcoming).not.toHaveProperty('userId');

		// The reservations screen (everyone's, admin) and people's own pages.
		const all = await listReservations(db, ADMIN, EVERYONES_UPCOMING);
		expect(all.rows.map((r) => [r.assetTag, r.imageUrl])).toEqual([
			['DR-12', IMAGE_URLS[OTHER.id]],
			['PJ-10', IMAGE_URLS[OTHER.id]],
		]);
		const others = await getMyPage(db, OTHER);
		expect(others.reservations.map((r) => r.imageUrl)).toEqual([
			IMAGE_URLS[OTHER.id],
			IMAGE_URLS[OTHER.id],
		]);
		const members = await getMyPage(db, MEMBER);
		expect(members.loans.map((l) => l.imageUrl)).toEqual([null]);
		expect(members.history.map((l) => l.imageUrl)).toEqual([null]);
		expect((await getMyPage(db, ADMIN)).history.map((l) => l.imageUrl)).toEqual([
			IMAGE_URLS[ADMIN.id],
		]);

		// The home screen: the overdue loan under "needs action", today's bookings.
		await db.execute({
			sql: 'UPDATE loans SET due_at = ? WHERE equipment_id = ?',
			args: [slot(-2), projector],
		});
		const home = await getHome(db, ADMIN);
		expect(home.attention.rows.find((r) => r.assetTag === 'PJ-10')).toMatchObject({
			kind: 'overdue',
			loan: { name: ADMIN.name, imageUrl: IMAGE_URLS[ADMIN.id] },
		});
		expect(home.today.find((r) => r.assetTag === 'DR-12')).toMatchObject({
			kind: 'reservation',
			name: OTHER.name,
			imageUrl: IMAGE_URLS[OTHER.id],
		});
	});

	it('shows no image for someone who left the workspace', async () => {
		const db = await freshDb();
		const projector = await addEquipment(db, 'PJ-20');
		const camera = await addEquipment(db, 'CM-21');
		await lendEquipment(db, ADMIN, lendInput(projector, slot(8), { userId: OTHER.id }));
		await createReservation(
			db,
			ADMIN,
			reserveInput(camera, slot(8), slot(12), { userId: OTHER.id }),
		);
		// OTHER leaves the workspace.
		setDirectoryForTest(async () => [directoryPerson(ADMIN), directoryPerson(MEMBER)]);

		expect((await listEquipmentLoans(db, ADMIN, projector))[0]).toMatchObject({
			name: OTHER.name,
			imageUrl: null,
		});
		expect((await getEquipment(db, ADMIN, projector)).equipment.loan?.imageUrl).toBeNull();
		expect((await listUpcomingForEquipment(db, ADMIN, camera))[0]).toMatchObject({
			name: OTHER.name,
			imageUrl: null,
		});
		expect((await listReservations(db, ADMIN, EVERYONES_UPCOMING)).rows[0].imageUrl).toBeNull();
	});

	it('shows no image without a directory', async () => {
		const db = await freshDb();
		setDirectoryForTest(null, false);
		// A deployed app whose directory is not set up: null, not an error.
		const me = await call(meRoute.GET, 'GET', '/api/me', { headers: as(ADMIN) });
		expect(me.status).toBe(200);
		expect(me.body).toMatchObject({ imageUrl: null });
		const projector = await addEquipment(db, 'PJ-30');
		await lendEquipment(db, ADMIN, lendInput(projector, slot(8)));
		expect((await listEquipmentLoans(db, ADMIN, projector))[0].imageUrl).toBeNull();
		expect((await getMyPage(db, ADMIN)).loans[0].imageUrl).toBeNull();
	});
});

// Someone who left the workspace keeps their records under the snapshot name.
// Every row that shows a person says so (`membership`), so the screens can put
// the "former member" chip next to them (DESIGN.md §8.10).
describe('former members', () => {
	const EVERYONES_UPCOMING = {
		scope: 'all' as const,
		when: 'upcoming' as const,
		from: null,
		to: null,
		q: null,
		page: 1,
		size: 50,
	};

	it('marks every row of someone no longer in the directory', async () => {
		const db = await freshDb();
		const projector = await addEquipment(db, 'PJ-40');
		const camera = await addEquipment(db, 'CM-41');
		const drone = await addEquipment(db, 'DR-42');
		// OTHER has the projector out and the camera booked now; MEMBER has the drone.
		await lendEquipment(db, ADMIN, lendInput(projector, slot(8), { userId: OTHER.id }));
		await createReservation(
			db,
			ADMIN,
			reserveInput(camera, slot(0), slot(4), { userId: OTHER.id }),
		);
		await lendEquipment(db, ADMIN, lendInput(drone, slot(8), { userId: MEMBER.id }));
		await db.execute({
			sql: 'UPDATE loans SET due_at = ? WHERE equipment_id = ?',
			args: [slot(-2), projector],
		});
		// OTHER leaves the workspace.
		setDirectoryForTest(async () => [directoryPerson(ADMIN), directoryPerson(MEMBER)]);

		// The loan ledger of a piece of equipment (the HTTP answer the page reads).
		const loans = await call(equipmentLoansRoute.GET, 'GET', `/api/equipment/${projector}/loans`, {
			headers: as(ADMIN),
			params: { id: String(projector) },
		});
		expect(loans.status).toBe(200);
		expect((loans.body as LoanView[]).map((l) => [l.name, l.membership])).toEqual([
			[OTHER.name, 'former'],
		]);
		expect((await listEquipmentLoans(db, ADMIN, drone)).map((l) => l.membership)).toEqual([
			'member',
		]);

		// The ledger and an equipment page: the current borrower, for a member
		// too (whose view has no user id, but still the mark).
		for (const viewer of [ADMIN, MEMBER]) {
			const ledger = await listEquipment(db, viewer, parseEquipmentQuery(new URLSearchParams()));
			const borrowers = new Map(ledger.rows.map((r) => [r.assetTag, r.loan?.membership]));
			expect(borrowers.get('PJ-40')).toBe('former');
			expect(borrowers.get('DR-42')).toBe('member');
		}
		expect((await getEquipment(db, MEMBER, projector)).equipment.loan).toMatchObject({
			name: OTHER.name,
			membership: 'former',
		});

		// Bookings: the equipment page, the reservations screen.
		expect((await listUpcomingForEquipment(db, MEMBER, camera))[0]).toMatchObject({
			name: OTHER.name,
			membership: 'former',
		});
		const all = await listReservations(db, ADMIN, EVERYONES_UPCOMING);
		expect(all.rows.map((r) => [r.assetTag, r.membership])).toEqual([['CM-41', 'former']]);

		// The home screen: the overdue loan under "needs action", today's booking.
		const home = await getHome(db, ADMIN);
		expect(home.attention.rows.find((r) => r.assetTag === 'PJ-40')?.loan).toMatchObject({
			name: OTHER.name,
			membership: 'former',
		});
		expect(home.today.find((r) => r.assetTag === 'CM-41')).toMatchObject({
			kind: 'reservation',
			membership: 'former',
		});
	});

	it('calls nobody former when the directory cannot be read or is not set up', async () => {
		const db = await freshDb();
		const projector = await addEquipment(db, 'PJ-50');
		await lendEquipment(db, ADMIN, lendInput(projector, slot(8), { userId: OTHER.id }));
		setDirectoryForTest(async () => {
			throw new Error('network down');
		});
		expect((await listEquipmentLoans(db, ADMIN, projector)).map((l) => l.membership)).toEqual([
			'unknown',
		]);
		setDirectoryForTest(null, false);
		expect((await getEquipment(db, ADMIN, projector)).equipment.loan?.membership).toBe('unknown');
	});

	it('marks the sample former member in local development, and nobody else', async () => {
		// pnpm dev without the CLI: the SDK's local mode lists the roster.
		const db = await freshDb({
			samples: true,
			env: { KEELSON_LOCAL_MODE: '1', KEELSON_LOCAL_USERS_FILE: 'seed-data/dev-users.json' },
		});
		setDirectoryForTest(null);
		const idOf = async (tag: string) =>
			Number(
				(await db.execute({ sql: 'SELECT id FROM equipment WHERE asset_tag = ?', args: [tag] }))
					.rows[0]?.id,
			);
		// SP-0005: returned by the sample former member, booked by a sample member.
		const phone = await idOf('SP-0005');
		const ledger = await listEquipmentLoans(db, ADMIN, phone);
		expect(ledger.map((l) => [l.userId, l.membership])).toEqual([['sample-kobayashi', 'former']]);
		expect((await listUpcomingForEquipment(db, ADMIN, phone))[0]).toMatchObject({
			userId: 'sample-yamamoto',
			membership: 'member',
		});
	});
});
