import type { Client } from '@libsql/client';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import {
	type EquipmentFields,
	equipmentIdByTag,
	findEquipment,
} from '#lib/server/domain/equipment.ts';
import { listEquipmentEvents } from '#lib/server/domain/events.ts';
import { listMasters } from '#lib/server/domain/masters.ts';
import { runImport } from '#lib/server/import/importer.ts';
import { argName } from '#lib/server/mcp/refs.ts';
import * as equipmentRoute from '../src/routes/api/equipment/+server.ts';
import * as equipmentOneRoute from '../src/routes/api/equipment/[id]/+server.ts';
import * as exportRoute from '../src/routes/api/equipment/export/+server.ts';
import { ADMIN, cleanupDbs, freshDb } from './support/harness.ts';
import {
	type CompleteEquipmentFields,
	completeEquipmentFields,
	locationId,
	typeId,
} from './support/helpers.ts';
import { as, call, callTool } from './support/http.ts';

// Every equipment field, set to a value, survives every way in and out: the
// API (register, edit, read), the CSV (export, then import into another
// database), the AI assistant (register_equipment, get_equipment) and the
// edit's history. The fields compared are the keys of completeEquipmentFields,
// whose type lists every key of EquipmentFields: a new field is checked here
// without new tests. The type and the location leave the app by name (CSV,
// AI assistant, history), so those comparisons swap the ids for names.

afterEach(cleanupDbs);

type FieldKey = keyof EquipmentFields;

function keysOf(fields: CompleteEquipmentFields): FieldKey[] {
	return Object.keys(fields) as FieldKey[];
}

/** The equipment fields of a record (anything keyed by the field names). */
function pickFields(record: unknown, keys: FieldKey[]): Record<string, unknown> {
	const r = record as Record<string, unknown>;
	return Object.fromEntries(keys.map((k) => [k, r[k]]));
}

/** The fields with the type and location ids swapped for their names. */
async function byName(
	db: Client,
	fields: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const { types, locations } = await listMasters(db);
	return {
		...fields,
		typeId: types.find((t) => t.id === fields.typeId)?.name,
		locationId: locations.find((l) => l.id === fields.locationId)?.name,
	};
}

/** Register through POST /api/equipment; the new piece's id. */
async function register(fields: CompleteEquipmentFields): Promise<number> {
	const res = await call(equipmentRoute.POST, 'POST', '/api/equipment', {
		headers: as(ADMIN),
		json: fields,
	});
	expect(res.status, JSON.stringify(res.body)).toBe(201);
	return (res.body as { id: number }).id;
}

/** GET /api/equipment/[id]: the piece as the admin sees it. */
async function read(id: number): Promise<Record<string, unknown>> {
	const res = await call(equipmentOneRoute.GET, 'GET', `/api/equipment/${id}`, {
		headers: as(ADMIN),
		params: { id: String(id) },
	});
	expect(res.status, JSON.stringify(res.body)).toBe(200);
	return (res.body as { equipment: Record<string, unknown> }).equipment;
}

describe('every equipment field round-trips', () => {
	it('through the API: register, then edit every field', async () => {
		const db = await freshDb();
		const first = completeEquipmentFields('PJ-F1', await typeId(db, 1), await locationId(db, 1));
		const id = await register(first);
		const created = await read(id);
		expect(pickFields(created, keysOf(first))).toEqual(first);

		const second = completeEquipmentFields(
			'PJ-F2',
			await typeId(db, 2),
			await locationId(db, 2),
			true,
		);
		for (const key of keysOf(first)) {
			expect(second[key], `the edit changes ${key}`).not.toEqual(first[key]);
		}
		const edited = await call(equipmentOneRoute.PATCH, 'PATCH', `/api/equipment/${id}`, {
			headers: as(ADMIN),
			json: { ...second, version: created.version },
			params: { id: String(id) },
		});
		expect(edited.status, JSON.stringify(edited.body)).toBe(200);
		expect(pickFields(await read(id), keysOf(second))).toEqual(second);

		// The edit's history holds [before, after] of every field; the type and
		// the location by name, under `type` / `location`.
		const [event] = (await listEquipmentEvents(db, ADMIN, id)).filter((e) => e.kind === 'edit');
		const { type, location, ...rest } = (event.detail as { changes: Record<string, unknown> })
			.changes;
		const before = await byName(db, first);
		const after = await byName(db, second);
		expect({ ...rest, typeId: type, locationId: location }).toEqual(
			Object.fromEntries(keysOf(first).map((k) => [k, [before[k], after[k]]])),
		);
	});

	it('through the CSV: export, then import into another database', async () => {
		const db = await freshDb();
		const fields = completeEquipmentFields('PJ-F3', await typeId(db, 2), await locationId(db, 2));
		await register(fields);
		const exported = await call(exportRoute.GET, 'GET', '/api/equipment/export', {
			headers: as(ADMIN),
		});
		expect(exported.status).toBe(200);
		const bytes = new Uint8Array(await exported.res.arrayBuffer());
		const expected = await byName(db, fields);

		// The target starts with the same default types and locations; the
		// import matches them by name.
		const target = await freshDb();
		const result = await runImport(
			target,
			ADMIN,
			bytes,
			'export.csv',
			{ autoAddMasters: false },
			'all',
		);
		expect(result.created).toBe(1);
		const id = await equipmentIdByTag(target, fields.assetTag);
		const imported = id === null ? null : await findEquipment(target, ADMIN, id);
		expect(await byName(target, pickFields(imported, keysOf(fields)))).toEqual(expected);
	});

	it('through the AI assistant: register_equipment, then get_equipment', async () => {
		const db = await freshDb();
		const fields = completeEquipmentFields('PJ-F4', await typeId(db, 3), await locationId(db, 3));
		// Arguments are the field names in snake_case (argName); the type and the
		// location go by name.
		const named = await byName(db, fields);
		const args = Object.fromEntries(keysOf(fields).map((k) => [argName(k), named[k]]));
		const registered = await callTool('register_equipment', args, ADMIN);
		expect(registered.status, JSON.stringify(registered.body)).toBe(200);

		const got = await callTool('get_equipment', { asset_tag: fields.assetTag }, ADMIN);
		expect(got.status, JSON.stringify(got.body)).toBe(200);
		const result = got.body as Record<string, unknown>;
		expect(Object.fromEntries(keysOf(fields).map((k) => [k, result[argName(k)]]))).toEqual(named);
	});
});
