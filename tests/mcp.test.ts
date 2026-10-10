import { afterEach, describe, expect, it } from 'vite-plus/test';
import * as mcpRoute from '../src/routes/api/mcp/[tool]/+server.ts';
import { addDays, nowLocal } from '#lib/server/dates.ts';
import { listEquipmentEvents } from '#lib/server/domain/events.ts';
import { setDirectoryForTest } from '#lib/server/domain/directory.ts';
import { argName } from '#lib/server/mcp/refs.ts';
import { defaultDueAt, nextStep } from '#lib/server/mcp/registry.ts';
import { ADMIN, cleanupDbs, freshDb, MEMBER, OTHER } from './support/harness.ts';
import { addEquipment, day, slot } from './support/helpers.ts';
import { as, call, type Caller } from './support/http.ts';

// AI assistant tools work end to end through POST /api/mcp/<tool> with the
// gateway's identity headers (members and admins). The keelson.yaml
// declaration is checked in tests/mcp-manifest.test.ts.

afterEach(cleanupDbs);

type Reply = { status: number; body: Record<string, unknown> };

/** One tool call as the gateway makes it. */
async function tool(
	who: Caller,
	name: string,
	args: Record<string, unknown> = {},
	headers: Record<string, string> = {},
): Promise<Reply> {
	const res = await call(mcpRoute.POST, 'POST', `/api/mcp/${name}`, {
		headers: { ...as(who), 'x-keelson-auth-source': 'mcp', ...headers },
		json: args,
		params: { tool: name },
	});
	return { status: res.status, body: res.body as Record<string, unknown> };
}

async function ok(who: Caller, name: string, args: Record<string, unknown> = {}) {
	const res = await tool(who, name, args);
	expect(res.status, JSON.stringify(res.body)).toBe(200);
	return res.body;
}

type Item = Record<string, unknown>;
const items = (body: Record<string, unknown>) => body.items as Item[];

describe('POST /api/mcp/<tool>', () => {
	it('answers 404 mcp_tool_not_found for an unknown tool name', async () => {
		await freshDb();
		for (const name of ['nope', 'constructor', '__proto__']) {
			const res = await tool(ADMIN, name);
			expect(res, name).toMatchObject({ status: 404, body: { error: 'mcp_tool_not_found' } });
		}
	});

	it('needs the gateway identity (401) and a JSON object body', async () => {
		await freshDb();
		const anonymous = await call(mcpRoute.POST, 'POST', '/api/mcp/my_loans', {
			json: {},
			params: { tool: 'my_loans' },
		});
		expect(anonymous.status).toBe(401);
		const list = await call(mcpRoute.POST, 'POST', '/api/mcp/my_loans', {
			headers: as(MEMBER),
			json: [],
			params: { tool: 'my_loans' },
		});
		expect(list).toMatchObject({ status: 400, body: { error: 'invalid_request' } });
	});

	it('refuses manage tools to members (403) before reading the arguments', async () => {
		const db = await freshDb();
		await addEquipment(db, 'PJ-1');
		for (const [name, args] of [
			['register_equipment', { asset_tag: 'X-1', name: 'Projector' }],
			['suspend_equipment', { asset_tag: 'PJ-1', reason: 'broken' }],
			['resume_equipment', { asset_tag: 'PJ-1' }],
			['register_equipment', {}],
		] as const) {
			const res = await tool(MEMBER, name, args);
			expect(res, name).toEqual({ status: 403, body: { error: 'forbidden_manage_required' } });
		}
	});
});

describe('the main flow', () => {
	it('registers, lends, looks up, extends and returns (admin and member)', async () => {
		const db = await freshDb();
		const masters = await ok(ADMIN, 'list_masters');
		const typeName = (masters.types as { name: string }[])[0].name;
		const locationName = (masters.locations as { name: string }[])[0].name;

		const created = await ok(ADMIN, 'register_equipment', {
			asset_tag: 'PJ-10',
			name: 'Mobile projector',
			type: typeName,
			location: locationName,
			serial_no: 'SN-10',
		});
		expect(created).toMatchObject({
			asset_tag: 'PJ-10',
			type: typeName,
			location: locationName,
			status: 'available',
		});
		// Registering the same tag twice is refused by the unique tag.
		const again = await tool(ADMIN, 'register_equipment', { asset_tag: 'PJ-10', name: 'Twice' });
		expect(again).toEqual({
			status: 422,
			body: { error: 'validation_failed', fields: { asset_tag: 'taken' } },
		});

		// The admin lends it to the member, named by email (any case).
		const lent = await ok(ADMIN, 'lend_equipment', {
			asset_tag: 'pj-10',
			person: MEMBER.email?.toUpperCase(),
			due_at: slot(8),
		});
		expect(lent).toMatchObject({ asset_tag: 'PJ-10', borrower: MEMBER.name, due_at: slot(8) });

		const mine = await ok(MEMBER, 'my_loans');
		expect(mine).toMatchObject({ total: 1, truncated: false });
		expect(items(mine)[0]).toMatchObject({ asset_tag: 'PJ-10', mine: true, overdue: false });

		const detail = await ok(MEMBER, 'get_equipment', { asset_tag: 'PJ-10' });
		expect(detail).toMatchObject({
			status: 'on_loan',
			borrower: MEMBER.name,
			loan: { mine: true, due_at: slot(8) },
		});
		expect(detail).not.toHaveProperty('serial_no');
		expect(await ok(ADMIN, 'get_equipment', { asset_tag: 'PJ-10' })).toMatchObject({
			serial_no: 'SN-10',
		});

		// A date alone means that day at 18:00.
		const tomorrow = addDays(nowLocal().slice(0, 10), 1);
		const extended = await ok(MEMBER, 'extend_loan', { asset_tag: 'PJ-10', due_at: tomorrow });
		expect(extended).toMatchObject({ due_at: `${tomorrow}T18:00` });

		const returned = await ok(MEMBER, 'return_equipment', { asset_tag: 'PJ-10', note: 'Fine' });
		expect(returned).toMatchObject({ asset_tag: 'PJ-10', return_kind: 'returned' });
		expect(returned.returned_at).toBeTruthy();
		const free = await ok(MEMBER, 'find_equipment', { status: ['available'] });
		expect(items(free).map((i) => i.asset_tag)).toContain('PJ-10');

		// Changes made through MCP are marked in the history.
		const events = await listEquipmentEvents(db, ADMIN, created.id as number);
		expect(events.map((e) => e.kind)).toEqual(['return', 'extend', 'lend', 'create']);
		expect(events.every((e) => e.detail?.source === 'mcp')).toBe(true);
	});

	it('books, lists and cancels a reservation (member)', async () => {
		const db = await freshDb();
		await addEquipment(db, 'CM-1');
		const booked = await ok(MEMBER, 'reserve_equipment', {
			asset_tag: 'CM-1',
			starts_at: day(1, '13:00'),
			ends_at: day(1, '15:00'),
			purpose: 'Shooting',
		});
		expect(booked).toMatchObject({
			asset_tag: 'CM-1',
			person: MEMBER.name,
			starts_at: day(1, '13:00'),
			ends_at: day(1, '15:00'),
			status: 'active',
		});
		const overlap = await tool(OTHER, 'reserve_equipment', {
			asset_tag: 'CM-1',
			starts_at: day(1, '14:00'),
			ends_at: day(1, '16:00'),
		});
		expect(overlap.body).toEqual({ error: 'validation_failed', fields: { starts_at: 'overlap' } });

		const mine = await ok(MEMBER, 'my_reservations');
		expect(items(mine)[0]).toMatchObject({ asset_tag: 'CM-1', purpose: 'Shooting' });
		// Others see who booked, not why.
		const seen = await ok(OTHER, 'get_equipment', { asset_tag: 'CM-1' });
		expect((seen.reservations as { items: Item[] }).items[0]).toMatchObject({
			person: MEMBER.name,
			mine: false,
			purpose: null,
		});
		expect(seen.next_reservation).toMatchObject({ starts_at: day(1, '13:00') });

		// Another member cannot cancel it; its owner can, by the equipment alone.
		const theirs = await tool(OTHER, 'cancel_reservation', {
			asset_tag: 'CM-1',
			starts_at: day(1, '13:00'),
		});
		expect(theirs).toEqual({ status: 403, body: { error: 'reservation_not_owned' } });
		const cancelled = await ok(MEMBER, 'cancel_reservation', { asset_tag: 'CM-1' });
		expect(cancelled).toMatchObject({ status: 'cancelled', starts_at: day(1, '13:00') });
		expect(await tool(MEMBER, 'cancel_reservation', { asset_tag: 'CM-1' })).toEqual({
			status: 404,
			body: { error: 'reservation_not_found' },
		});
	});

	it('cancels by reservation id and asks for the start when there are several', async () => {
		const db = await freshDb();
		await addEquipment(db, 'CM-2');
		const first = await ok(MEMBER, 'reserve_equipment', {
			asset_tag: 'CM-2',
			starts_at: day(1, '09:00'),
			ends_at: day(1, '10:00'),
		});
		await ok(MEMBER, 'reserve_equipment', {
			asset_tag: 'CM-2',
			starts_at: day(2, '09:00'),
			ends_at: day(2, '10:00'),
		});
		expect((await tool(MEMBER, 'cancel_reservation', { asset_tag: 'CM-2' })).body).toEqual({
			error: 'validation_failed',
			fields: { starts_at: 'required' },
		});
		expect((await tool(MEMBER, 'cancel_reservation', {})).body).toEqual({
			error: 'validation_failed',
			fields: { asset_tag: 'required' },
		});
		const byId = await ok(MEMBER, 'cancel_reservation', {
			reservation_id: first.reservation_id,
		});
		expect(byId).toMatchObject({ status: 'cancelled', starts_at: day(1, '09:00') });
	});
});

describe('permissions on other people records', () => {
	it('keeps members to their own loans and bookings', async () => {
		const db = await freshDb();
		await addEquipment(db, 'PJ-20');
		await ok(OTHER, 'lend_equipment', { asset_tag: 'PJ-20', due_at: slot(8) });
		expect(await tool(MEMBER, 'return_equipment', { asset_tag: 'PJ-20' })).toEqual({
			status: 403,
			body: { error: 'loan_not_owned' },
		});
		expect(await tool(MEMBER, 'extend_loan', { asset_tag: 'PJ-20', due_at: slot(12) })).toEqual({
			status: 403,
			body: { error: 'loan_not_owned' },
		});
		// Lending for someone else is for admins; naming oneself is fine.
		await addEquipment(db, 'PJ-21');
		expect(
			await tool(MEMBER, 'lend_equipment', { asset_tag: 'PJ-21', person: OTHER.email }),
		).toEqual({ status: 403, body: { error: 'forbidden_manage_required' } });
		const self = await ok(MEMBER, 'lend_equipment', {
			asset_tag: 'PJ-21',
			person: MEMBER.email,
			due_at: slot(8),
		});
		expect(self).toMatchObject({ borrower: MEMBER.name, mine: true });
		// Return options that change the equipment are for admins.
		expect(
			await tool(MEMBER, 'return_equipment', { asset_tag: 'PJ-21', needs_repair: true }),
		).toEqual({ status: 403, body: { error: 'forbidden_manage_required' } });
	});

	it('lets an admin collect a loan and suspend it for repair in one go', async () => {
		const db = await freshDb();
		await addEquipment(db, 'PJ-22');
		await ok(MEMBER, 'lend_equipment', { asset_tag: 'PJ-22', due_at: slot(8) });
		const masters = await ok(ADMIN, 'list_masters');
		const shelf = (masters.locations as { name: string }[])[1].name;
		const collected = await ok(ADMIN, 'return_equipment', {
			asset_tag: 'PJ-22',
			needs_repair: true,
			location: shelf,
			note: 'Scratched lens',
		});
		expect(collected).toMatchObject({
			return_kind: 'collected',
			suspended_reason: 'repair',
			location: shelf,
		});
		expect(await ok(ADMIN, 'get_equipment', { asset_tag: 'PJ-22' })).toMatchObject({
			location: shelf,
			suspended_note: 'Scratched lens',
		});
		expect(await tool(ADMIN, 'return_equipment', { asset_tag: 'PJ-22' })).toEqual({
			status: 409,
			body: { error: 'equipment_not_on_loan' },
		});
		expect(await tool(MEMBER, 'lend_equipment', { asset_tag: 'PJ-22' })).toEqual({
			status: 409,
			body: { error: 'equipment_suspended' },
		});
		const resumed = await ok(ADMIN, 'resume_equipment', { asset_tag: 'PJ-22' });
		expect(resumed).toMatchObject({ status: 'available', suspended_reason: null });
		const suspended = await ok(ADMIN, 'suspend_equipment', {
			asset_tag: 'PJ-22',
			reason: 'broken',
			detail: 'Does not power on',
		});
		expect(suspended).toMatchObject({ status: 'suspended', suspended_reason: 'broken' });
		expect(
			(await tool(ADMIN, 'suspend_equipment', { asset_tag: 'PJ-22', reason: 'lost' })).body,
		).toEqual({ error: 'equipment_suspended' });
	});
});

describe('person references', () => {
	// Suzuki Taro / Suzuki Hanako / Sato Jiro, written in kanji (no CJK in tests).
	const SUZUKI = String.fromCodePoint(0x9234, 0x6728);
	const TARO = String.fromCodePoint(0x592a, 0x90ce);
	const HANAKO = String.fromCodePoint(0x82b1, 0x5b50);
	const SATO = String.fromCodePoint(0x4f50, 0x85e4);
	const JIRO = String.fromCodePoint(0x6b21, 0x90ce);
	const SAN = String.fromCodePoint(0x3055, 0x3093);
	const people = [
		{
			id: 'u-taro',
			name: `${SUZUKI} ${TARO}`,
			email: 'taro@example.com',
			imageUrl: null,
		},
		{
			id: 'u-hanako',
			name: `${SUZUKI} ${HANAKO}`,
			email: 'hanako@example.com',
			imageUrl: null,
		},
		{
			id: 'u-jiro',
			name: `${SATO} ${JIRO}`,
			email: 'jiro@example.com',
			imageUrl: null,
		},
	];

	async function setUp() {
		const db = await freshDb();
		setDirectoryForTest(async () => people);
		return db;
	}

	async function lendTo(person: string, tag: string) {
		return tool(ADMIN, 'lend_equipment', { asset_tag: tag, person, due_at: slot(8) });
	}

	it('resolves an email, an exact name, a part of a name and a name with an honorific', async () => {
		const db = await setUp();
		for (const tag of ['A-1', 'A-2', 'A-3', 'A-4']) {
			await addEquipment(db, tag);
		}
		expect((await lendTo('Hanako@Example.com', 'A-1')).body).toMatchObject({
			borrower: people[1].name,
		});
		expect((await lendTo(`${SUZUKI}${TARO}`, 'A-2')).body).toMatchObject({
			borrower: people[0].name,
		});
		expect((await lendTo(SATO, 'A-3')).body).toMatchObject({ borrower: people[2].name });
		// "Sato-san": no one is called that, so the honorific is dropped.
		expect((await lendTo(`${SATO}${SAN}`, 'A-4')).body).toMatchObject({
			borrower: people[2].name,
		});
	});

	it('answers not_found, or ambiguous with the candidates', async () => {
		const db = await setUp();
		await addEquipment(db, 'B-1');
		expect((await lendTo('nobody@example.com', 'B-1')).body).toEqual({
			error: 'validation_failed',
			fields: { person: 'not_found' },
		});
		const ambiguous = await lendTo(SUZUKI, 'B-1');
		expect(ambiguous.status).toBe(422);
		expect(ambiguous.body).toMatchObject({
			error: 'validation_failed',
			fields: { person: 'ambiguous' },
		});
		const candidates = ambiguous.body.candidates as Item[];
		expect(candidates).toHaveLength(2);
		expect(candidates).toEqual(
			expect.arrayContaining([
				{ id: 'u-hanako', name: people[1].name, email: 'hanako@example.com' },
				{ id: 'u-taro', name: people[0].name, email: 'taro@example.com' },
			]),
		);
		// Nothing was lent.
		expect(await ok(ADMIN, 'get_equipment', { asset_tag: 'B-1' })).toMatchObject({ loan: null });
	});

	it('books for someone else (admin) by name', async () => {
		const db = await setUp();
		await addEquipment(db, 'B-2');
		const booked = await ok(ADMIN, 'reserve_equipment', {
			asset_tag: 'B-2',
			person: 'jiro@example.com',
			starts_at: day(1, '10:00'),
		});
		expect(booked).toMatchObject({ person: people[2].name, ends_at: day(1, '11:00') });
	});
});

describe('defaults and limits', () => {
	it('lends until 18:00 today (or tomorrow once it has passed) when no due time is given', async () => {
		const db = await freshDb();
		await addEquipment(db, 'D-1');
		const before = defaultDueAt(nowLocal());
		const lent = await ok(MEMBER, 'lend_equipment', { asset_tag: 'D-1' });
		const after = defaultDueAt(nowLocal());
		expect([before, after]).toContain(lent.due_at);
		expect(lent.due_at).toMatch(/T18:00$/);
	});

	it('books from the next 15-minute step for an hour when no times are given', async () => {
		const db = await freshDb();
		await addEquipment(db, 'D-2');
		const before = nextStep(nowLocal());
		const booked = await ok(MEMBER, 'reserve_equipment', { asset_tag: 'D-2' });
		const after = nextStep(nowLocal());
		expect([before, after]).toContain(booked.starts_at);
		expect(Number(String(booked.starts_at).slice(14, 16)) % 15).toBe(0);
	});

	it('renames business-layer field errors to the tool arguments', async () => {
		const db = await freshDb();
		await addEquipment(db, 'D-3');
		expect(
			(await tool(MEMBER, 'lend_equipment', { asset_tag: 'D-3', due_at: day(1, '10:10') })).body,
		).toEqual({ error: 'validation_failed', fields: { due_at: 'step' } });
		expect((await tool(MEMBER, 'get_equipment', { asset_tag: 'NOPE' })).body).toEqual({
			error: 'validation_failed',
			fields: { asset_tag: 'not_found' },
		});
		expect(
			(await tool(ADMIN, 'register_equipment', { asset_tag: 'D-4', name: 'X', type: 'Nope' })).body,
		).toEqual({ error: 'validation_failed', fields: { type: 'not_found' } });
		expect(
			(await tool(MEMBER, 'reserve_equipment', { asset_tag: 'D-3', starts_at: 'tomorrow' })).body,
		).toEqual({ error: 'validation_failed', fields: { starts_at: 'invalid_datetime' } });
	});

	it('caps list results at 50 rows and reports the total', async () => {
		const db = await freshDb();
		for (let i = 1; i <= 55; i++) {
			await addEquipment(db, `L-${String(i).padStart(2, '0')}`);
		}
		const first = await ok(MEMBER, 'find_equipment');
		expect(items(first)).toHaveLength(20);
		expect(first).toMatchObject({ total: 55, truncated: true });
		const capped = await ok(MEMBER, 'find_equipment', { limit: 1000 });
		expect(items(capped)).toHaveLength(50);
		const few = await ok(MEMBER, 'find_equipment', { q: 'L-05' });
		expect(few).toMatchObject({ total: 1, truncated: false });
		expect((await tool(MEMBER, 'find_equipment', { limit: 0 })).body).toEqual({
			error: 'validation_failed',
			fields: { limit: 'invalid' },
		});
	});

	it('filters by type name: exact, or the one type containing it', async () => {
		await freshDb();
		const masters = await ok(ADMIN, 'list_masters');
		const types = masters.types as { name: string }[];
		// The default types include a laptop type whose name ends in "PC".
		const laptop = types.find((t) => t.name.endsWith('PC'));
		expect(laptop).toBeTruthy();
		await ok(ADMIN, 'register_equipment', { asset_tag: 'T-1', name: 'Laptop', type: laptop?.name });
		await ok(ADMIN, 'register_equipment', { asset_tag: 'T-2', name: 'Other', type: types[0].name });
		const tags = async (type: string) =>
			items(await ok(MEMBER, 'find_equipment', { type })).map((i) => i.asset_tag);
		expect(await tags(laptop?.name ?? '')).toEqual(['T-1']);
		expect(await tags('pc')).toEqual(['T-1']);
		expect((await tool(MEMBER, 'find_equipment', { type: 'Drone' })).body).toEqual({
			error: 'validation_failed',
			fields: { type: 'not_found' },
		});
		// Registering needs the exact name of an active type.
		expect(
			(await tool(ADMIN, 'register_equipment', { asset_tag: 'T-3', name: 'X', type: 'pc' })).body,
		).toEqual({ error: 'validation_failed', fields: { type: 'not_found' } });
	});

	it('finds equipment free for a period (the booking overlap rule)', async () => {
		const db = await freshDb();
		await addEquipment(db, 'F-1');
		await addEquipment(db, 'F-2');
		await ok(OTHER, 'reserve_equipment', {
			asset_tag: 'F-1',
			starts_at: day(1, '13:00'),
			ends_at: day(1, '15:00'),
		});
		const tags = async (args: Record<string, unknown>) =>
			items(await ok(MEMBER, 'find_equipment', args)).map((i) => i.asset_tag);
		expect(await tags({ available_from: day(1, '14:00'), available_to: day(1, '16:00') })).toEqual([
			'F-2',
		]);
		expect(await tags({ available_from: day(1, '15:00'), available_to: day(1, '16:00') })).toEqual([
			'F-1',
			'F-2',
		]);
		// A date alone covers the whole day.
		const tomorrow = day(1, '00:00').slice(0, 10);
		expect(await tags({ available_from: tomorrow, available_to: tomorrow })).toEqual(['F-2']);
		expect(
			(await tool(MEMBER, 'find_equipment', { available_from: day(1, '14:00') })).body,
		).toEqual({ error: 'validation_failed', fields: { available_to: 'required' } });
	});
});

describe('argument names in errors', () => {
	it('names every field the business layer reports after the tool argument', () => {
		const names = {
			// every tool that names a piece of equipment
			equipmentId: 'asset_tag',
			// register_equipment
			assetTag: 'asset_tag',
			serialNo: 'serial_no',
			typeId: 'type',
			locationId: 'location',
			// lend_equipment / extend_loan / reserve_equipment
			userId: 'person',
			dueAt: 'due_at',
			startsAt: 'starts_at',
			endsAt: 'ends_at',
			purpose: 'purpose',
			// a field added later follows the rule without an entry
			purchasedOn: 'purchased_on',
		};
		for (const [field, arg] of Object.entries(names)) {
			expect(argName(field)).toBe(arg);
		}
	});
});
