import type { Client } from '@libsql/client';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { CSV_COLUMNS, CSV_READONLY_COLUMNS } from '#lib/server/content.ts';
import {
	type EquipmentView,
	exportEquipment,
	listEquipment,
} from '#lib/server/domain/equipment.ts';
import { listEvents } from '#lib/server/domain/events.ts';
import { listMasters, type MasterEntry, updateMaster } from '#lib/server/domain/masters.ts';
import { parseEquipmentQuery, parseEventQuery } from '#lib/server/http/queries.ts';
import {
	decodeCsv,
	equipmentToCsv,
	headerField,
	parseCsv,
	unguard,
} from '#lib/server/import/csv.ts';
import {
	type ImportPreview,
	judgeRow,
	previewImport,
	type RowContext,
	runImport,
} from '#lib/server/import/importer.ts';
import { ADMIN, cleanupDbs, expectError, freshDb, MEMBER } from './support/harness.ts';
import { addEquipment, locationId, typeId } from './support/helpers.ts';

// CSV of equipment (DESIGN.md §9-H): decoding and parsing, row judgments, the
// import itself, and export -> import. Japanese header labels come from
// content.ts; other non-ASCII text is built from code points.

afterEach(cleanupDbs);

const H = CSV_COLUMNS;
const ON = { autoAddMasters: true };
const OFF = { autoAddMasters: false };
const ALL = parseEquipmentQuery(new URLSearchParams('size=200'));

/** A CSV file (UTF-8 with a BOM, CRLF unless told otherwise). */
function csv(
	rows: string[][],
	opts: { bom?: boolean; eol?: string } = {},
): Uint8Array<ArrayBuffer> {
	const eol = opts.eol ?? '\r\n';
	const text = rows.map((r) => r.join(',')).join(eol) + eol;
	return new TextEncoder().encode((opts.bom === false ? '' : '\uFEFF') + text);
}

function hex(value: string): Uint8Array<ArrayBuffer> {
	return new Uint8Array(value.match(/../g)?.map((b) => Number.parseInt(b, 16)) ?? []);
}

function judgments(preview: ImportPreview): Record<number, string> {
	return Object.fromEntries(preview.rows.map((r) => [r.line, r.judgment]));
}

function codes(preview: ImportPreview, line: number): string[] {
	return preview.rows.find((r) => r.line === line)?.issues.map((i) => i.code) ?? [];
}

async function names(db: Client) {
	const m = await listMasters(db);
	return { type: m.types[0].name, location: m.locations[0].name };
}

describe('decoding and parsing', () => {
	it('reads UTF-8 with a BOM, quoted commas, quotes and line breaks', () => {
		const bytes = csv([
			[H.assetTag, H.name, H.note],
			['PJ-1', '"Projector, 1080p"', '"say ""hi"""'],
			['PJ-2', 'Screen', '"two\r\nlines"'],
			['PJ-3', 'Cable', ''],
		]);
		const { text, encoding } = decodeCsv(bytes);
		expect(encoding).toBe('utf-8');
		const records = parseCsv(text);
		expect(records.map((r) => r.line)).toEqual([1, 2, 3, 5]);
		expect(records[1].cells).toEqual(['PJ-1', 'Projector, 1080p', 'say "hi"']);
		expect(records[2].cells).toEqual(['PJ-2', 'Screen', 'two\r\nlines']);
	});

	it('reads LF line ends and drops blank lines', () => {
		const bytes = csv([[H.assetTag, H.name], ['PJ-1', 'A'], [',', ''], [''], ['PJ-2', 'B']], {
			bom: false,
			eol: '\n',
		});
		expect(parseCsv(decodeCsv(bytes).text).map((r) => [r.line, r.cells[0]])).toEqual([
			[1, H.assetTag],
			[2, 'PJ-1'],
			[5, 'PJ-2'],
		]);
	});

	it('falls back to Shift_JIS', () => {
		// "<asset tag>,<name>,<type>\r\nPC-1,<laptop>,\r\n" saved as Shift_JIS.
		const bytes = hex('8ac7979d94d48d862c96bc8fcc2c8eed97de0d0a50432d312c836d815b836750432c0d0a');
		const { text, encoding } = decodeCsv(bytes);
		expect(encoding).toBe('shift_jis');
		const records = parseCsv(text);
		expect(records[0].cells).toEqual([H.assetTag, H.name, H.typeName]);
		// Katakana for "notebook PC", built from code points (no CJK in tests).
		const laptop = `${String.fromCodePoint(0x30ce, 0x30fc, 0x30c8)}PC`;
		expect(records[1].cells).toEqual(['PC-1', laptop, '']);
	});

	it('reports an unclosed quote at the line it opens', async () => {
		const text = `${H.assetTag},${H.name}\r\nPJ-1,ok\r\nPJ-2,"broken\r\nPJ-3,x\r\n`;
		await expectError(() => parseCsv(text), { status: 400, code: 'csv_unclosed_quote', line: 3 });
	});

	it('maps headers (a trailing * is ignored) and undoes the formula guard', () => {
		expect(headerField(`${H.assetTag}*`)).toBe('assetTag');
		expect(headerField(` ${H.locationName} `)).toBe('locationName');
		expect(headerField(CSV_READONLY_COLUMNS.status)).toBeNull();
		expect(unguard("'=SUM(A1)")).toBe('=SUM(A1)');
		expect(unguard("'plain")).toBe("'plain");
	});

	it('also ignores a trailing full-width asterisk, and only one asterisk', () => {
		const fullWidth = String.fromCodePoint(0xff0a);
		expect(headerField(`${H.assetTag}${fullWidth}`)).toBe('assetTag');
		expect(headerField(` ${H.name} ${fullWidth} `)).toBe('name');
		expect(headerField(`${H.name}**`)).toBeNull();
	});
});

describe('preview and import', () => {
	it('judges rows: ok, needs a look (unknown masters), and errors', async () => {
		const db = await freshDb();
		await addEquipment(db, 'OLD-1');
		const { type, location } = await names(db);
		const file = csv([
			[`${H.assetTag}*`, `${H.name}*`, H.typeName, H.serialNo, H.locationName, H.note, 'Extra'],
			['NEW-1', 'Projector', type, 'SN1', location, '', 'ignored'],
			['NEW-2', 'Tripod', 'Drone', '', 'Annex shelf', '', ''],
			['', 'No tag', '', '', '', '', ''],
			['OLD-1', 'Duplicate of a registered tag', '', '', '', '', ''],
			['DUP', 'Twice', '', '', '', '', ''],
			['DUP', 'Twice', '', '', '', '', ''],
		]);
		const preview = await previewImport(db, ADMIN, file, ON);
		expect(preview.columns.map((c) => c.field)).toEqual([
			'assetTag',
			'name',
			'typeName',
			'serialNo',
			'locationName',
			'note',
			null,
		]);
		expect(judgments(preview)).toEqual({
			2: 'ok',
			3: 'warn',
			4: 'error',
			5: 'error',
			6: 'error',
			7: 'error',
		});
		expect(codes(preview, 3)).toEqual(['type_unregistered', 'location_unregistered']);
		expect(codes(preview, 4)).toEqual(['required']);
		expect(codes(preview, 5)).toEqual(['duplicate_existing']);
		expect(codes(preview, 7)).toEqual(['duplicate_in_file']);
		expect(preview.newTypes).toEqual(['Drone']);
		expect(preview.newLocations).toEqual(['Annex shelf']);
		// With the option off, unknown masters are errors.
		const strict = await previewImport(db, ADMIN, file, OFF);
		expect(judgments(strict)[3]).toBe('error');
		// Inactive masters are always errors.
		const masters = await listMasters(db);
		await updateMaster(db, ADMIN, 'types', masters.types[0].id, { active: false });
		expect(codes(await previewImport(db, ADMIN, file, ON), 2)).toEqual(['type_inactive']);
	});

	it('imports (adding the masters), skips errors on request, and logs one import event', async () => {
		const db = await freshDb();
		const file = csv([
			[H.assetTag, H.name, H.typeName, H.locationName],
			['IMP-1', 'Camera', 'Drone', 'Annex shelf'],
			['IMP-2', 'Light', '', ''],
			['', 'Broken row', '', ''],
		]);
		await expectError(runImport(db, ADMIN, file, 'f.csv', ON, 'all'), {
			status: 409,
			code: 'import_has_errors',
		});
		const result = await runImport(db, ADMIN, file, 'f.csv', ON, 'skip_errors');
		expect(result).toMatchObject({
			created: 2,
			excluded: 1,
			addedTypes: ['Drone'],
			addedLocations: ['Annex shelf'],
			failed: null,
		});
		const { rows } = await listEquipment(db, ADMIN, ALL);
		expect(rows.map((r) => [r.assetTag, r.typeName, r.locationName])).toEqual([
			['IMP-1', 'Drone', 'Annex shelf'],
			['IMP-2', null, null],
		]);
		const events = await listEvents(db, ADMIN, parseEventQuery(new URLSearchParams('kind=import')));
		expect(events.rows[0].detail).toMatchObject({ fileName: 'f.csv', created: 2, excluded: 1 });
	});

	it('round-trips: an export imports into an empty ledger as the same equipment', async () => {
		const pick = (r: EquipmentView) => [
			r.assetTag,
			r.name,
			r.typeName,
			r.locationName,
			r.serialNo ?? null,
			r.note ?? null,
		];
		const source = await freshDb();
		await addEquipment(source, 'RT-1', {
			typeId: await typeId(source),
			locationId: await locationId(source),
			note: '=cmd|calc',
		});
		await addEquipment(source, 'RT-2', { name: 'Mic, wireless', serialNo: null });
		const rows = await exportEquipment(source, ADMIN, ALL);
		const before = rows.map(pick);
		const exported = equipmentToCsv(rows);
		expect(exported.startsWith('\uFEFF')).toBe(true);
		// Formula-like cells are guarded on the way out.
		expect(exported).toContain("'=cmd|calc");

		// A second, empty database (the first client is closed by this).
		const target = await freshDb();
		const bytes = new TextEncoder().encode(exported);
		const preview = await previewImport(target, ADMIN, bytes, OFF);
		expect(preview.counts).toEqual({ ok: 2, warn: 0, error: 0 });
		await runImport(target, ADMIN, bytes, 'export.csv', OFF, 'all');
		expect((await exportEquipment(target, ADMIN, ALL)).map(pick)).toEqual(before);
	});

	it('is admin-only', async () => {
		const db = await freshDb();
		const file = csv([
			[H.assetTag, H.name],
			['X-1', 'Y'],
		]);
		await expectError(previewImport(db, MEMBER, file, ON), {
			status: 403,
			code: 'forbidden_manage_required',
		});
		await expectError(exportEquipment(db, MEMBER, ALL), {
			status: 403,
			code: 'forbidden_manage_required',
		});
	});
});

describe('judging one row (no database)', () => {
	function entry(id: number, name: string, active = true): MasterEntry {
		return { id, name, active, sortOrder: id, usage: 0 };
	}

	function context(overrides: Partial<RowContext> = {}): RowContext {
		return {
			options: ON,
			types: new Map([
				['Camera', entry(1, 'Camera')],
				['Retired', entry(2, 'Retired', false)],
			]),
			locations: new Map([
				['Shelf A', entry(1, 'Shelf A')],
				['Closed', entry(2, 'Closed', false)],
			]),
			registered: new Set(['CM-OLD']),
			tagCounts: new Map([
				['CM-1', 1],
				['CM-OLD', 1],
				['CM-2', 2],
			]),
			...overrides,
		};
	}

	it('reads a clean row as the equipment to register', () => {
		const row = judgeRow(
			{
				line: 2,
				values: { assetTag: 'CM-1', name: 'Camera', typeName: 'Camera', locationName: 'Shelf A' },
			},
			context(),
		);
		expect(row).toMatchObject({ line: 2, judgment: 'ok', issues: [] });
		expect(row.fields).toEqual({
			assetTag: 'CM-1',
			name: 'Camera',
			typeName: 'Camera',
			serialNo: null,
			locationName: 'Shelf A',
			note: null,
		});
	});

	it('reports every problem of a row in column order, with its level', () => {
		const row = judgeRow(
			{
				line: 3,
				values: { assetTag: 'CM-OLD', name: '', typeName: 'Unknown', locationName: 'Closed' },
			},
			context(),
		);
		expect(row.issues).toEqual([
			{ field: 'name', code: 'required', level: 'error' },
			{ field: 'assetTag', code: 'duplicate_existing', level: 'error' },
			{ field: 'typeName', code: 'type_unregistered', level: 'warn' },
			{ field: 'locationName', code: 'location_inactive', level: 'error' },
		]);
		expect(row.judgment).toBe('error');
		expect(
			judgeRow({ line: 4, values: { assetTag: 'CM-2', name: 'Camera' } }, context()).issues,
		).toEqual([{ field: 'assetTag', code: 'duplicate_in_file', level: 'error' }]);
	});

	it('adds a missing name only when the option says so', () => {
		const values = { assetTag: 'CM-1', name: 'Camera', locationName: 'Shelf Z' };
		expect(judgeRow({ line: 2, values }, context()).judgment).toBe('warn');
		expect(judgeRow({ line: 2, values }, context({ options: OFF })).issues).toEqual([
			{ field: 'locationName', code: 'location_unregistered', level: 'error' },
		]);
	});

	it('refuses a deactivated type even when missing names may be added', () => {
		const row = judgeRow(
			{ line: 2, values: { assetTag: 'CM-1', name: 'Camera', typeName: 'Retired' } },
			context(),
		);
		expect(row.issues).toEqual([{ field: 'typeName', code: 'type_inactive', level: 'error' }]);
	});
});
