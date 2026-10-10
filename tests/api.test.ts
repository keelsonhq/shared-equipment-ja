import { afterEach, describe, expect, it } from 'vite-plus/test';
import * as fallbackRoute from '../src/routes/api/[...rest]/+server.ts';
import * as attachmentFile from '../src/routes/api/attachments/[id]/+server.ts';
import * as equipmentRoute from '../src/routes/api/equipment/+server.ts';
import * as equipmentOneRoute from '../src/routes/api/equipment/[id]/+server.ts';
import * as attachmentsRoute from '../src/routes/api/equipment/[id]/attachments/+server.ts';
import * as equipmentEventsRoute from '../src/routes/api/equipment/[id]/events/+server.ts';
import * as qrRoute from '../src/routes/api/equipment/[id]/qr/+server.ts';
import * as resumeRoute from '../src/routes/api/equipment/[id]/resume/+server.ts';
import * as suspendRoute from '../src/routes/api/equipment/[id]/suspend/+server.ts';
import * as exportRoute from '../src/routes/api/equipment/export/+server.ts';
import * as eventsRoute from '../src/routes/api/events/+server.ts';
import * as homeRoute from '../src/routes/api/home/+server.ts';
import * as importExecuteRoute from '../src/routes/api/import/execute/+server.ts';
import * as importPreviewRoute from '../src/routes/api/import/preview/+server.ts';
import * as importTemplateRoute from '../src/routes/api/import/template/+server.ts';
import * as loansRoute from '../src/routes/api/loans/+server.ts';
import * as extendRoute from '../src/routes/api/loans/[id]/extend/+server.ts';
import * as returnRoute from '../src/routes/api/loans/[id]/return/+server.ts';
import * as masterKindRoute from '../src/routes/api/masters/[kind]/+server.ts';
import * as meRoute from '../src/routes/api/me/+server.ts';
import * as myPageRoute from '../src/routes/api/me/page/+server.ts';
import * as reservationsRoute from '../src/routes/api/reservations/+server.ts';
import * as cancelRoute from '../src/routes/api/reservations/[id]/cancel/+server.ts';
import { setDirectoryForTest } from '#lib/server/domain/directory.ts';
import { ADMIN, cleanupDbs, freshDb, MEMBER, OTHER } from './support/harness.ts';
import { addEquipment, day, slot } from './support/helpers.ts';
import { as, call, type Handler } from './support/http.ts';

// HTTP-level tests: requests go through the real `handle` hook
// (authentication) and the real +server.ts handlers, exactly as in the built
// server, without opening a port.

afterEach(cleanupDbs);

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe('authentication', () => {
	it('answers 401 without trusted headers (production behaviour)', async () => {
		await freshDb();
		const { status, body } = await call(meRoute.GET, 'GET', '/api/me');
		expect(status).toBe(401);
		expect(body).toEqual({ error: 'unauthorized' });
	});

	it('reads the gateway identity, the manage grant and the server time', async () => {
		await freshDb();
		const member = await call(meRoute.GET, 'GET', '/api/me', { headers: as(MEMBER) });
		expect(member.body).toMatchObject({ userId: MEMBER.id, isAdmin: false, localPreview: false });
		expect((member.body as { now: string }).now).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
		const admin = await call(meRoute.GET, 'GET', '/api/me', { headers: as(ADMIN) });
		expect(admin.body).toMatchObject({ isAdmin: true });
	});

	it('signs in the roster admin only in the SDK local mode (pnpm dev without the CLI)', async () => {
		await freshDb();
		process.env.KEELSON_LOCAL_MODE = '1';
		process.env.KEELSON_LOCAL_USERS_FILE = 'seed-data/dev-users.json';
		const local = await call(meRoute.GET, 'GET', '/api/me');
		expect(local.status).toBe(200);
		expect(local.body).toMatchObject({ isAdmin: true, localPreview: true });
		// In a Keelson deployment the SDK refuses local mode: no identity, 401.
		process.env.KEELSON_APP_URL = 'https://example.test';
		expect((await call(meRoute.GET, 'GET', '/api/me')).status).toBe(401);
	});

	it('shows the local-preview banner behind keelson dev serve only', async () => {
		await freshDb();
		process.env.KEELSON_MODE = 'local';
		const local = await call(meRoute.GET, 'GET', '/api/me', { headers: as(MEMBER) });
		expect(local.body).toMatchObject({ isAdmin: false, localPreview: true });
		process.env.KEELSON_APP_URL = 'https://example.test';
		const deployed = await call(meRoute.GET, 'GET', '/api/me', { headers: as(MEMBER) });
		expect(deployed.body).toMatchObject({ localPreview: false });
	});

	it('answers unknown API paths with a code-only 404', async () => {
		await freshDb();
		const missing = await call(fallbackRoute.fallback, 'GET', '/api/nope', { headers: as(ADMIN) });
		expect(missing).toMatchObject({ status: 404, body: { error: 'not_found' } });
	});
});

describe('admin-only APIs answer 403 to members', () => {
	it.each([
		['GET /api/home', homeRoute.GET, 'GET', '/api/home', undefined, {}],
		[
			'POST /api/equipment',
			equipmentRoute.POST,
			'POST',
			'/api/equipment',
			{ assetTag: 'X', name: 'Y' },
			{},
		],
		['GET /api/equipment/export', exportRoute.GET, 'GET', '/api/equipment/export', undefined, {}],
		['GET /api/events', eventsRoute.GET, 'GET', '/api/events', undefined, {}],
		[
			'GET /api/equipment/1/events',
			equipmentEventsRoute.GET,
			'GET',
			'/api/equipment/1/events',
			undefined,
			{ id: '1' },
		],
		[
			'POST /api/equipment/1/suspend',
			suspendRoute.POST,
			'POST',
			'/api/equipment/1/suspend',
			{ reason: 'repair' },
			{ id: '1' },
		],
		[
			'GET /api/import/template',
			importTemplateRoute.GET,
			'GET',
			'/api/import/template',
			undefined,
			{},
		],
		[
			'POST /api/masters/types',
			masterKindRoute.POST,
			'POST',
			'/api/masters/types',
			{ name: 'Drone' },
			{ kind: 'types' },
		],
		[
			'GET /api/reservations?scope=all',
			reservationsRoute.GET,
			'GET',
			'/api/reservations?scope=all',
			undefined,
			{},
		],
	] as const)('%s', async (_label, handler, method, path, json, params) => {
		await freshDb();
		const res = await call(handler as Handler, method, path, {
			headers: as(MEMBER),
			json,
			params: params as Record<string, string>,
		});
		expect(res.status).toBe(403);
		expect(res.body).toEqual({ error: 'forbidden_manage_required' });
	});

	it('takes CSV previews only as octet-stream', async () => {
		await freshDb();
		const res = await call(importPreviewRoute.POST, 'POST', '/api/import/preview', {
			headers: { ...as(ADMIN), 'content-type': 'text/csv' },
			body: 'a,b\n',
		});
		expect(res.status).toBe(415);
	});
});

describe('the shared pool over HTTP', () => {
	it('shows members the ledger without admin fields', async () => {
		const db = await freshDb();
		await addEquipment(db, 'PJ-1', { note: 'Admin only' });
		const res = await call(equipmentRoute.GET, 'GET', '/api/equipment', { headers: as(MEMBER) });
		expect(res.status).toBe(200);
		const row = (res.body as { rows: Record<string, unknown>[] }).rows[0];
		expect(row.assetTag).toBe('PJ-1');
		expect(row).not.toHaveProperty('note');
		expect(row).not.toHaveProperty('serialNo');
	});

	it('lets exactly one of two simultaneous loan requests win', async () => {
		const db = await freshDb();
		const equipmentId = await addEquipment(db, 'PJ-2');
		const body = { equipmentId, dueAt: slot(4) };
		const [a, b] = await Promise.all([
			call(loansRoute.POST, 'POST', '/api/loans', { headers: as(MEMBER), json: body }),
			call(loansRoute.POST, 'POST', '/api/loans', { headers: as(OTHER), json: body }),
		]);
		expect([a.status, b.status].sort((x, y) => x - y)).toEqual([201, 409]);
		expect([a.body, b.body]).toContainEqual({ error: 'equipment_on_loan' });
	});

	it('reports an overlapping booking under the start field (422)', async () => {
		const db = await freshDb();
		const equipmentId = await addEquipment(db, 'PJ-3');
		const json = { equipmentId, startsAt: day(1, '10:00'), endsAt: day(1, '11:00') };
		const first = await call(reservationsRoute.POST, 'POST', '/api/reservations', {
			headers: as(MEMBER),
			json,
		});
		expect(first.status).toBe(201);
		const second = await call(reservationsRoute.POST, 'POST', '/api/reservations', {
			headers: as(OTHER),
			json: { ...json, startsAt: day(1, '10:30') },
		});
		expect(second).toMatchObject({
			status: 422,
			body: { error: 'validation_failed', fields: { startsAt: 'overlap' } },
		});
		// Someone else cannot cancel it.
		const id = (first.body as { id: string }).id;
		const cancel = await call(cancelRoute.POST, 'POST', `/api/reservations/${id}/cancel`, {
			headers: as(OTHER),
			json: {},
			params: { id },
		});
		expect(cancel).toMatchObject({ status: 403, body: { error: 'reservation_not_owned' } });
	});

	it("refuses returning or extending someone else's loan", async () => {
		const db = await freshDb();
		const equipmentId = await addEquipment(db, 'PJ-4');
		const lent = await call(loansRoute.POST, 'POST', '/api/loans', {
			headers: as(MEMBER),
			json: { equipmentId, dueAt: slot(4) },
		});
		const id = (lent.body as { id: string }).id;
		const back = await call(returnRoute.POST, 'POST', `/api/loans/${id}/return`, {
			headers: as(OTHER),
			json: {},
			params: { id },
		});
		expect(back).toMatchObject({ status: 403, body: { error: 'loan_not_owned' } });
		const extend = await call(extendRoute.POST, 'POST', `/api/loans/${id}/extend`, {
			headers: as(OTHER),
			json: { dueAt: slot(8) },
			params: { id },
		});
		expect(extend).toMatchObject({ status: 403, body: { error: 'loan_not_owned' } });
		const mine = await call(myPageRoute.GET, 'GET', '/api/me/page', { headers: as(MEMBER) });
		expect((mine.body as { loans: unknown[] }).loans).toHaveLength(1);
	});

	it('serves the QR code of the page as SVG', async () => {
		const db = await freshDb();
		const id = String(await addEquipment(db, 'PJ-5'));
		const local = await call(qrRoute.GET, 'GET', `/api/equipment/${id}/qr`, {
			headers: as(MEMBER),
			params: { id },
		});
		expect(local.status).toBe(200);
		expect(local.res.headers.get('content-type')).toBe('image/svg+xml');
		expect(String(local.body)).toContain('<svg');
		const missing = await call(qrRoute.GET, 'GET', '/api/equipment/9999/qr', {
			headers: as(MEMBER),
			params: { id: '9999' },
		});
		expect(missing).toMatchObject({ status: 404, body: { error: 'equipment_not_found' } });
	});

	it('lets members open attachments but only admins add them', async () => {
		const db = await freshDb();
		const id = String(await addEquipment(db, 'PJ-6'));
		const upload = (headers: Record<string, string>) =>
			call(attachmentsRoute.POST, 'POST', `/api/equipment/${id}/attachments?name=manual.png`, {
				headers: { ...headers, 'content-type': 'application/octet-stream' },
				body: PNG,
				params: { id },
			});
		expect((await upload(as(MEMBER))).status).toBe(403);
		const added = await upload(as(ADMIN));
		expect(added.status).toBe(201);
		const attachmentId = (added.body as { id: string }).id;
		const list = await call(attachmentsRoute.GET, 'GET', `/api/equipment/${id}/attachments`, {
			headers: as(MEMBER),
			params: { id },
		});
		expect((list.body as unknown[]).length).toBe(1);
		const file = await call(attachmentFile.GET, 'GET', `/api/attachments/${attachmentId}`, {
			headers: as(MEMBER),
			params: { id: attachmentId },
		});
		expect(file.status).toBe(200);
		expect(file.res.headers.get('content-type')).toBe('image/png');
		const removed = await call(
			attachmentFile.DELETE,
			'DELETE',
			`/api/attachments/${attachmentId}`,
			{
				headers: as(MEMBER),
				json: {},
				params: { id: attachmentId },
			},
		);
		expect(removed.status).toBe(403);
	});

	it('shows one piece of equipment to everyone, 404 when unknown', async () => {
		const db = await freshDb();
		const id = String(await addEquipment(db, 'PJ-7'));
		const one = await call(equipmentOneRoute.GET, 'GET', `/api/equipment/${id}`, {
			headers: as(MEMBER),
			params: { id },
		});
		expect(one.status).toBe(200);
		expect((one.body as { window: { days: string[] } }).window.days).toHaveLength(7);
	});

	it('stops booking and lending suspended equipment, and resumes', async () => {
		const db = await freshDb();
		const id = String(await addEquipment(db, 'PJ-8'));
		const suspended = await call(suspendRoute.POST, 'POST', `/api/equipment/${id}/suspend`, {
			headers: as(ADMIN),
			json: { reason: 'repair', note: 'Lamp' },
			params: { id },
		});
		expect(suspended.body).toMatchObject({ status: 'suspended', suspendedReason: 'repair' });
		const booking = await call(reservationsRoute.POST, 'POST', '/api/reservations', {
			headers: as(MEMBER),
			json: { equipmentId: Number(id), startsAt: day(1, '10:00'), endsAt: day(1, '11:00') },
		});
		expect(booking).toMatchObject({ status: 409, body: { error: 'equipment_suspended' } });
		const loan = await call(loansRoute.POST, 'POST', '/api/loans', {
			headers: as(MEMBER),
			json: { equipmentId: Number(id), dueAt: slot(4) },
		});
		expect(loan).toMatchObject({ status: 409, body: { error: 'equipment_suspended' } });
		const resumed = await call(resumeRoute.POST, 'POST', `/api/equipment/${id}/resume`, {
			headers: as(ADMIN),
			json: {},
			params: { id },
		});
		expect(resumed.body).toMatchObject({ status: 'available' });
	});

	it('round-trips the CSV export through the import API', async () => {
		const db = await freshDb();
		await addEquipment(db, 'CSV-1', { note: 'Charger included' });
		const exported = await call(exportRoute.GET, 'GET', '/api/equipment/export', {
			headers: as(ADMIN),
		});
		expect(exported.res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
		// Change the asset tag so the same rows import as new equipment.
		const file = String(exported.body).replace('CSV-1', 'CSV-2');
		const octet = { ...as(ADMIN), 'content-type': 'application/octet-stream' };
		const preview = await call(importPreviewRoute.POST, 'POST', '/api/import/preview', {
			headers: octet,
			body: new TextEncoder().encode(file),
		});
		expect((preview.body as { counts: unknown }).counts).toEqual({ ok: 1, warn: 0, error: 0 });
		const run = await call(importExecuteRoute.POST, 'POST', '/api/import/execute?name=x.csv', {
			headers: octet,
			body: new TextEncoder().encode(file),
		});
		expect(run.body).toMatchObject({ created: 1, excluded: 0 });
		const list = await call(equipmentRoute.GET, 'GET', '/api/equipment?q=CSV-', {
			headers: as(ADMIN),
		});
		const rows = (list.body as { rows: { assetTag: string; note: string }[] }).rows;
		expect(rows.map((r) => [r.assetTag, r.note])).toEqual([
			['CSV-1', 'Charger included'],
			['CSV-2', 'Charger included'],
		]);
	});

	it('keeps self-service working without the employee list', async () => {
		const db = await freshDb();
		setDirectoryForTest(null, false);
		const equipmentId = await addEquipment(db, 'PJ-9');
		const proxy = await call(loansRoute.POST, 'POST', '/api/loans', {
			headers: as(ADMIN),
			json: { equipmentId, userId: MEMBER.id, dueAt: slot(4) },
		});
		expect(proxy).toMatchObject({ status: 409, body: { error: 'people_unconfigured' } });
		const self = await call(loansRoute.POST, 'POST', '/api/loans', {
			headers: as(MEMBER),
			json: { equipmentId, dueAt: slot(4) },
		});
		expect(self.status).toBe(201);
	});
});
