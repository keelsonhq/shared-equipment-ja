import { afterEach, describe, expect, it } from 'vite-plus/test';
import {
	createEquipment,
	getEquipment,
	listEquipment,
	resumeEquipment,
	suspendEquipment,
	updateEquipment,
} from '#lib/server/domain/equipment.ts';
import { listEquipmentEvents } from '#lib/server/domain/events.ts';
import { lendEquipment } from '#lib/server/domain/loans.ts';
import { createReservation } from '#lib/server/domain/reservations.ts';
import { parseEquipmentQuery } from '#lib/server/http/queries.ts';
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
	day,
	equipmentFields,
	lendInput,
	locationId,
	reserveInput,
	slot,
	typeId,
} from './support/helpers.ts';

// The equipment ledger: registering, editing, suspending, and what the list
// shows to admins and to members.

afterEach(cleanupDbs);

const query = (qs = '') => parseEquipmentQuery(new URLSearchParams(qs));

describe('register and edit', () => {
	it('registers equipment with a type and a location, and logs it', async () => {
		const db = await freshDb();
		const view = await createEquipment(
			db,
			ADMIN,
			equipmentFields('CM-1', { typeId: await typeId(db), locationId: await locationId(db) }),
		);
		expect(view).toMatchObject({ assetTag: 'CM-1', status: 'available', version: 1 });
		expect(view.typeName).not.toBeNull();
		expect(view.locationName).not.toBeNull();
		expect((await listEquipmentEvents(db, ADMIN, view.id)).map((e) => e.kind)).toEqual(['create']);
	});

	it('reports a taken asset tag and unusable masters under their fields', async () => {
		const db = await freshDb();
		await addEquipment(db, 'CM-2');
		await expectError(
			createEquipment(db, ADMIN, equipmentFields('CM-2', { typeId: 9999, locationId: 9999 })),
			invalid({ assetTag: 'taken', typeId: 'not_found', locationId: 'not_found' }),
		);
	});

	it('is admin-only', async () => {
		const db = await freshDb();
		await expectError(createEquipment(db, MEMBER, equipmentFields('CM-3')), {
			status: 403,
			code: 'forbidden_manage_required',
		});
	});

	it('edits with optimistic concurrency and records names in the history', async () => {
		const db = await freshDb();
		const id = await addEquipment(db, 'CM-4');
		const location = await locationId(db, 2);
		const edited = await updateEquipment(
			db,
			ADMIN,
			id,
			1,
			equipmentFields('CM-4', { name: 'Camera', locationId: location }),
		);
		expect(edited).toMatchObject({ name: 'Camera', locationId: location, version: 2 });
		await expectError(
			updateEquipment(db, ADMIN, id, 1, equipmentFields('CM-4', { name: 'Again' })),
			{ status: 409, code: 'equipment_version_conflict' },
		);
		const edit = (await listEquipmentEvents(db, ADMIN, id)).find((e) => e.kind === 'edit');
		expect(edit?.detail?.changes).toMatchObject({
			name: ['Projector CM-4', 'Camera'],
			location: [null, edited.locationName],
		});
	});

	it('suspends and resumes (admin only)', async () => {
		const db = await freshDb();
		const id = await addEquipment(db, 'CM-5');
		await expectError(suspendEquipment(db, MEMBER, id, 'broken', null), {
			status: 403,
			code: 'forbidden_manage_required',
		});
		const suspended = await suspendEquipment(db, ADMIN, id, 'lost', 'Not found after the event');
		expect(suspended).toMatchObject({ status: 'suspended', suspendedReason: 'lost' });
		await expectError(suspendEquipment(db, ADMIN, id, 'lost', null), {
			status: 409,
			code: 'equipment_suspended',
		});
		expect((await resumeEquipment(db, ADMIN, id)).status).toBe('available');
		await expectError(resumeEquipment(db, ADMIN, id), {
			status: 409,
			code: 'equipment_not_suspended',
		});
	});
});

describe('the list', () => {
	it('shows each display status and counts every condition', async () => {
		const db = await freshDb();
		const free = await addEquipment(db, 'A-1');
		const out = await addEquipment(db, 'A-2');
		const late = await addEquipment(db, 'A-3');
		const booked = await addEquipment(db, 'A-4');
		const broken = await addEquipment(db, 'A-5');
		await lendEquipment(db, MEMBER, lendInput(out, slot(8)));
		const lateLoan = await lendEquipment(db, OTHER, lendInput(late, slot(8)));
		await db.execute({
			sql: 'UPDATE loans SET due_at = ? WHERE id = ?',
			args: [slot(-2), lateLoan.id],
		});
		await createReservation(db, OTHER, reserveInput(booked, slot(0), slot(4)));
		await createReservation(db, OTHER, {
			equipmentId: free,
			userId: null,
			startsAt: day(2, '10:00'),
			endsAt: day(2, '11:00'),
			purpose: null,
		});
		await suspendEquipment(db, ADMIN, broken, 'repair', null);

		const { rows, counts } = await listEquipment(db, ADMIN, query());
		expect(Object.fromEntries(rows.map((r) => [r.assetTag, r.status]))).toEqual({
			'A-1': 'available',
			'A-2': 'on_loan',
			'A-3': 'overdue',
			'A-4': 'reserved',
			'A-5': 'suspended',
		});
		// "reserved" counts every piece with a booking to come (A-1 and A-4).
		expect(counts).toEqual({
			all: 5,
			available: 1,
			on_loan: 2,
			reserved: 2,
			overdue: 1,
			suspended: 1,
		});
		const filtered = await listEquipment(db, ADMIN, query('status=available'));
		expect(filtered.rows.map((r) => r.assetTag)).toEqual(['A-1']);
		const due = await listEquipment(db, ADMIN, query('status=on_loan&sort=due'));
		expect(due.rows.map((r) => r.assetTag)).toEqual(['A-3', 'A-2']);
	});

	it('draws the 7-day strip from bookings and loans', async () => {
		const db = await freshDb();
		const id = await addEquipment(db, 'B-1');
		await createReservation(db, OTHER, {
			equipmentId: id,
			userId: null,
			startsAt: day(1, '10:00'),
			endsAt: day(1, '12:00'),
			purpose: null,
		});
		await lendEquipment(db, MEMBER, lendInput(id, slot(4)));
		const { equipment, window } = await getEquipment(db, MEMBER, id);
		expect(window.days).toHaveLength(7);
		expect(equipment.bands.map((b) => [b.kind, b.mine])).toEqual([
			['loan', true],
			['reservation', false],
		]);
	});

	it('gives members the shared facts only', async () => {
		const db = await freshDb();
		const id = await addEquipment(db, 'C-1', { note: 'Admin-only note' });
		await lendEquipment(db, OTHER, lendInput(id, slot(4)));
		const { rows } = await listEquipment(db, MEMBER, query());
		const row = rows[0];
		expect(row.loan).toMatchObject({ name: OTHER.name, mine: false });
		expect(row.loan).not.toHaveProperty('userId');
		expect(row.loan).not.toHaveProperty('email');
		for (const key of ['serialNo', 'note', 'suspendedNote', 'version']) {
			expect(row).not.toHaveProperty(key);
		}
		// Notes are not searchable by members either.
		expect((await listEquipment(db, MEMBER, query('q=Admin-only'))).total).toBe(0);
		expect((await listEquipment(db, ADMIN, query('q=Admin-only'))).total).toBe(1);
		// The current borrower's name is searchable by admins.
		expect((await listEquipment(db, ADMIN, query(`q=${OTHER.name}`))).total).toBe(1);
	});

	it('pages on the server', async () => {
		const db = await freshDb();
		await db.batch(
			Array.from({ length: 120 }, (_, i) => ({
				sql: `INSERT INTO equipment (asset_tag, name, version, created_at, updated_at)
					VALUES (?, ?, 1, 't', 't')`,
				args: [`P-${String(i).padStart(4, '0')}`, `Unit ${i}`],
			})),
			'write',
		);
		const second = await listEquipment(db, MEMBER, query('page=2&size=50'));
		expect(second.total).toBe(120);
		expect(second.rows).toHaveLength(50);
		expect(second.rows[0].assetTag).toBe('P-0050');
	});
});
