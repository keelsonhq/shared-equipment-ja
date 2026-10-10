import type { Client } from '@libsql/client';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import {
	type EquipmentFields,
	type EquipmentView,
	findEquipment,
} from '#lib/server/domain/equipment.ts';
import { listEquipmentEvents } from '#lib/server/domain/events.ts';
import { updateMaster } from '#lib/server/domain/masters.ts';
import * as equipmentOneRoute from '../src/routes/api/equipment/[id]/+server.ts';
import { ADMIN, cleanupDbs, freshDb, MEMBER } from './support/harness.ts';
import { addEquipment, locationId, typeId } from './support/helpers.ts';
import { as, call } from './support/http.ts';

// Editing a piece of equipment (PATCH /api/equipment/[id], DESIGN.md §9-E): the
// change is written with an optimistic version check and logged as an `edit`
// event holding the before / after of each changed field (type and location
// by name). The business-layer conflict is in equipment.test.ts.

afterEach(cleanupDbs);

/** PATCH body: every equipment field (the edit form sends them all) + version. */
function editBody(equipment: EquipmentView, changes: Record<string, unknown> = {}) {
	const body: Record<keyof EquipmentFields | 'version', unknown> = {
		assetTag: equipment.assetTag,
		name: equipment.name,
		typeId: equipment.typeId,
		serialNo: equipment.serialNo,
		locationId: equipment.locationId,
		note: equipment.note,
		version: equipment.version,
	};
	return { ...body, ...changes };
}

function patch(id: number, json: unknown, actor = ADMIN) {
	return call(equipmentOneRoute.PATCH, 'PATCH', `/api/equipment/${id}`, {
		headers: as(actor),
		json,
		params: { id: String(id) },
	});
}

async function load(db: Client, id: number): Promise<EquipmentView> {
	const equipment = await findEquipment(db, ADMIN, id);
	if (!equipment) {
		throw new Error(`equipment ${id} not found`);
	}
	return equipment;
}

async function editEvents(db: Client, id: number) {
	return (await listEquipmentEvents(db, ADMIN, id)).filter((e) => e.kind === 'edit');
}

describe('edit a piece of equipment', () => {
	it('saves the changed fields, bumps the version and logs before / after', async () => {
		const db = await freshDb();
		const id = await addEquipment(db, 'PJ-E1');
		const before = await load(db, id);
		const type = await typeId(db, 2);
		const location = await locationId(db, 2);

		const res = await patch(
			id,
			editBody(before, {
				name: 'Projector 4K',
				typeId: type,
				locationId: location,
				note: 'new lamp',
			}),
		);
		expect(res.status).toBe(200);
		const after = res.body as EquipmentView;
		expect(after).toMatchObject({
			id,
			name: 'Projector 4K',
			typeId: type,
			locationId: location,
			note: 'new lamp',
			version: (before.version ?? 0) + 1,
		});

		const events = await editEvents(db, id);
		expect(events).toHaveLength(1);
		expect(events[0].actorId).toBe(ADMIN.id);
		// Only the changed fields, as [before, after]; type and location by name.
		expect(events[0].detail).toEqual({
			changes: {
				name: [before.name, 'Projector 4K'],
				type: [null, after.typeName],
				location: [null, after.locationName],
				note: [null, 'new lamp'],
			},
		});
	});

	it('writes nothing when no field changed', async () => {
		const db = await freshDb();
		const id = await addEquipment(db, 'PJ-E2');
		const before = await load(db, id);
		const res = await patch(id, editBody(before));
		expect(res.status).toBe(200);
		expect((res.body as EquipmentView).version).toBe(before.version);
		expect(await editEvents(db, id)).toEqual([]);
	});

	it('answers 409 equipment_version_conflict to an edit based on an old version', async () => {
		const db = await freshDb();
		const id = await addEquipment(db, 'PJ-E3');
		const stale = await load(db, id);
		// Someone else saved first.
		expect((await patch(id, editBody(stale, { name: 'First' }))).status).toBe(200);

		const res = await patch(id, editBody(stale, { name: 'Second' }));
		expect(res.status).toBe(409);
		expect(res.body).toEqual({ error: 'equipment_version_conflict' });
		expect((await load(db, id)).name).toBe('First');
		// The losing edit is not logged.
		expect((await editEvents(db, id)).map((e) => e.detail)).toEqual([
			{ changes: { name: [stale.name, 'First'] } },
		]);
	});

	it('answers 403 to a general user and changes nothing', async () => {
		const db = await freshDb();
		const id = await addEquipment(db, 'PJ-E4');
		const before = await load(db, id);
		const res = await patch(id, editBody(before, { name: 'Mine now' }), MEMBER);
		expect(res.status).toBe(403);
		expect(res.body).toEqual({ error: 'forbidden_manage_required' });
		expect(await load(db, id)).toEqual(before);
	});

	it('answers 404 for unknown equipment', async () => {
		const db = await freshDb();
		const id = await addEquipment(db, 'PJ-E5');
		const res = await patch(id + 1, editBody(await load(db, id)));
		expect(res.status).toBe(404);
		expect(res.body).toEqual({ error: 'equipment_not_found' });
	});

	it('keeps a type and a location deactivated since, while they stay unchanged', async () => {
		const db = await freshDb();
		const type = await typeId(db, 1);
		const location = await locationId(db, 1);
		const id = await addEquipment(db, 'PJ-E6', { typeId: type, locationId: location });
		await updateMaster(db, ADMIN, 'types', type, { active: false });
		await updateMaster(db, ADMIN, 'locations', location, { active: false });

		const res = await patch(id, editBody(await load(db, id), { name: 'Renamed' }));
		expect(res.status).toBe(200);
		expect(res.body).toMatchObject({ name: 'Renamed', typeId: type, locationId: location });
	});
});

describe('edit: validation_failed carries the field reasons', () => {
	it('reports every bad field of the body at once', async () => {
		const db = await freshDb();
		const id = await addEquipment(db, 'PJ-V1');
		const before = await load(db, id);
		const res = await patch(
			id,
			editBody(before, {
				assetTag: 'X'.repeat(41),
				name: ' ',
				typeId: 'abc',
				note: 'n'.repeat(2001),
			}),
		);
		expect(res.status).toBe(422);
		expect(res.body).toEqual({
			error: 'validation_failed',
			fields: { assetTag: 'too_long', name: 'required', typeId: 'invalid', note: 'too_long' },
		});
		expect(await load(db, id)).toEqual(before);
	});

	it('marks an asset tag another piece already uses', async () => {
		const db = await freshDb();
		await addEquipment(db, 'PJ-V2');
		const id = await addEquipment(db, 'PJ-V3');
		const res = await patch(id, editBody(await load(db, id), { assetTag: 'PJ-V2' }));
		expect(res.status).toBe(422);
		expect(res.body).toEqual({ error: 'validation_failed', fields: { assetTag: 'taken' } });
		expect(await editEvents(db, id)).toEqual([]);
	});

	it('marks a type and a location that do not exist or are deactivated', async () => {
		const db = await freshDb();
		const id = await addEquipment(db, 'PJ-V4');
		const before = await load(db, id);
		const missing = await patch(id, editBody(before, { typeId: 9999, locationId: 9999 }));
		expect(missing.status).toBe(422);
		expect(missing.body).toEqual({
			error: 'validation_failed',
			fields: { typeId: 'not_found', locationId: 'not_found' },
		});

		const type = await typeId(db, 2);
		await updateMaster(db, ADMIN, 'types', type, { active: false });
		const inactive = await patch(id, editBody(before, { typeId: type }));
		expect(inactive.status).toBe(422);
		expect(inactive.body).toEqual({ error: 'validation_failed', fields: { typeId: 'not_found' } });
		expect(await load(db, id)).toEqual(before);
	});

	it('answers 400 invalid_request without a version', async () => {
		const db = await freshDb();
		const id = await addEquipment(db, 'PJ-V5');
		const res = await patch(id, editBody(await load(db, id), { version: undefined }));
		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error: 'invalid_request' });
	});
});
