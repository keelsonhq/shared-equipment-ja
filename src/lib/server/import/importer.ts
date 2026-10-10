import type { Client, InStatement } from '@libsql/client';
import type { Actor } from '#lib/server/auth/actor.ts';
import { requireAdmin } from '#lib/server/auth/guard.ts';
import {
	type EquipmentFields,
	equipmentInsertStatements,
	isUniqueTagViolation,
	registeredAssetTags,
} from '#lib/server/domain/equipment.ts';
import { unguardedEventStatement } from '#lib/server/domain/events.ts';
import {
	addMissingMasterStatements,
	listMasters,
	type MasterEntry,
} from '#lib/server/domain/masters.ts';
import { AppError, CsvError, ErrorCode } from '#lib/server/errors.ts';
import {
	type CsvEncoding,
	type CsvField,
	decodeCsv,
	headerField,
	importTemplateCsv,
	parseCsv,
	REQUIRED_FIELDS,
	unguard,
} from './csv.ts';
import {
	EQUIPMENT_LIMITS,
	IMPORT_BYTES_MAX,
	IMPORT_ROWS_MAX,
	MASTER_NAME_MAX,
} from '#lib/limits.ts';

// CSV import of equipment (DESIGN.md §9-H). Stateless: the preview and the
// import both get the file and the options, and the import judges every row
// again, so what is written is what the rules say at that moment.
//
// Row judgments:
// - error (not imported): a required value is missing, a value is too long,
//   the asset tag is repeated in the file or already registered, a type /
//   location is deactivated; and the "needs a look" case below when its option
//   is off.
// - warn (imported as the option says): a type / location is not registered
//   yet (added).
// - ok.
// Bookings and loans are not imported.
//
// The steps: readImportFile (bytes -> columns and rows, or the error that
// rejects the whole file), judgeRow (one row against a RowContext; no
// database, so it is tested on its own) and summarize (counts and the names to
// add). plan() reads what the rows are judged against once per file.

export type ImportIssueCode =
	| 'required'
	| 'too_long'
	| 'duplicate_in_file'
	| 'duplicate_existing'
	| 'type_unregistered'
	| 'location_unregistered'
	| 'type_inactive'
	| 'location_inactive';

export type Judgment = 'ok' | 'warn' | 'error';

export interface ImportOptions {
	/** Add types / locations that the file names but the lists do not have. */
	autoAddMasters: boolean;
}

export interface ImportIssue {
	field: CsvField;
	code: ImportIssueCode;
	level: 'warn' | 'error';
}

export interface PreviewRow {
	/** File line the row starts on (the header is line 1). */
	line: number;
	judgment: Judgment;
	/** The cells of the recognized columns, trimmed. */
	values: Partial<Record<CsvField, string>>;
	issues: ImportIssue[];
}

export interface ImportColumn {
	header: string;
	/** null: a column the import does not use (ignored). */
	field: CsvField | null;
}

export interface ImportPreview {
	encoding: CsvEncoding;
	columns: ImportColumn[];
	rows: PreviewRow[];
	counts: Record<Judgment, number>;
	/** Types / locations the import would add (from rows that will be imported). */
	newTypes: string[];
	newLocations: string[];
}

export type ImportMode = 'all' | 'skip_errors';

export interface ImportResult {
	created: number;
	/** Rows left out because they were judged `error` ("skip errors"). */
	excluded: number;
	addedTypes: string[];
	addedLocations: string[];
	/**
	 * The batch that failed, if one did: rows before it are in, rows from
	 * `fromLine` on are not.
	 */
	failed: { fromLine: number; toLine: number; code: string } | null;
}

/** Rows per transaction when importing. */
const IMPORT_BATCH_ROWS = 100;

/**
 * A row's equipment: the equipment fields, with the type and the location
 * still names (their ids are looked up on import).
 */
type ImportFields = Omit<EquipmentFields, 'typeId' | 'locationId'> & {
	typeName: string | null;
	locationName: string | null;
};

/** One data row of the file: its line and the cells of the recognized columns. */
export interface FileRow {
	line: number;
	values: Partial<Record<CsvField, string>>;
}

/** A judged row: what the preview shows, plus the equipment the import writes. */
export interface PlannedRow extends PreviewRow {
	fields: ImportFields;
}

interface Plan {
	preview: ImportPreview;
	rows: PlannedRow[];
}

// --- Reading the file ------------------------------------------------------------

/** Bytes -> the columns and the data rows, or the CsvError that rejects the whole file. */
export function readImportFile(bytes: Uint8Array): {
	encoding: CsvEncoding;
	columns: ImportColumn[];
	rows: FileRow[];
} {
	if (bytes.length > IMPORT_BYTES_MAX) {
		throw new CsvError(ErrorCode.CsvTooLarge);
	}
	const { text, encoding } = decodeCsv(bytes);
	const records = parseCsv(text);
	if (records.length === 0) {
		throw new CsvError(ErrorCode.CsvEmpty);
	}
	const [header, ...data] = records;
	const columns: ImportColumn[] = header.cells.map((h) => ({
		header: h.trim(),
		field: headerField(h),
	}));
	const mapped = columns.map((c) => c.field).filter((f): f is CsvField => f !== null);
	if (new Set(mapped).size !== mapped.length) {
		throw new CsvError(ErrorCode.CsvDuplicateColumn, header.line);
	}
	if (REQUIRED_FIELDS.some((f) => !mapped.includes(f))) {
		throw new CsvError(ErrorCode.CsvMissingColumns, header.line);
	}
	if (data.length === 0) {
		throw new CsvError(ErrorCode.CsvNoRows);
	}
	if (data.length > IMPORT_ROWS_MAX) {
		throw new CsvError(ErrorCode.CsvTooManyRows);
	}
	const rows = data.map((record) => {
		const values: FileRow['values'] = {};
		columns.forEach((c, i) => {
			if (c.field) {
				values[c.field] = unguard((record.cells[i] ?? '').trim());
			}
		});
		return { line: record.line, values };
	});
	return { encoding, columns, rows };
}

// --- Judging one row -------------------------------------------------------------

/** What every row of one file is judged against (read once per file). */
export interface RowContext {
	options: ImportOptions;
	/** Equipment types and storage locations by name. */
	types: Map<string, MasterEntry>;
	locations: Map<string, MasterEntry>;
	/** Asset tags already registered. */
	registered: Set<string>;
	/** How many rows of the file carry each asset tag. */
	tagCounts: Map<string, number>;
}

const TEXT_LIMITS: Partial<Record<CsvField, number>> = {
	...EQUIPMENT_LIMITS,
	typeName: MASTER_NAME_MAX,
	locationName: MASTER_NAME_MAX,
};

const MASTER_ISSUES = {
	typeName: { unregistered: 'type_unregistered', inactive: 'type_inactive' },
	locationName: { unregistered: 'location_unregistered', inactive: 'location_inactive' },
} as const;

/** One row's cells, read with the checks every column shares; problems collect in `issues`. */
class RowReader {
	readonly values: FileRow['values'];
	readonly issues: ImportIssue[] = [];

	constructor(values: FileRow['values']) {
		this.values = values;
	}

	add(field: CsvField, code: ImportIssueCode, level: 'warn' | 'error' = 'error'): void {
		this.issues.push({ field, code, level });
	}

	/** The cell, or null when empty; `too_long` past the column's limit. */
	text(field: CsvField): string | null {
		const v = this.values[field] ?? '';
		const max = TEXT_LIMITS[field];
		if (max !== undefined && v.length > max) {
			this.add(field, 'too_long');
		}
		return v === '' ? null : v;
	}
}

// A type / location name: one the list does not have yet is added (a warning)
// or refused (an error) as the option says; a deactivated one is refused.
function checkMasterName(
	row: RowReader,
	field: keyof typeof MASTER_ISSUES,
	entry: MasterEntry | undefined,
	ctx: RowContext,
): void {
	if (!entry) {
		row.add(
			field,
			MASTER_ISSUES[field].unregistered,
			ctx.options.autoAddMasters ? 'warn' : 'error',
		);
	} else if (!entry.active) {
		row.add(field, MASTER_ISSUES[field].inactive);
	}
}

// The equipment columns. The asset tag must be new, and once in the file.
function readEquipment(row: RowReader, ctx: RowContext): ImportFields {
	const assetTag = row.text('assetTag');
	const name = row.text('name');
	for (const f of REQUIRED_FIELDS) {
		if (!row.values[f]) {
			row.add(f, 'required');
		}
	}
	if (assetTag && (ctx.tagCounts.get(assetTag) ?? 0) > 1) {
		row.add('assetTag', 'duplicate_in_file');
	}
	if (assetTag && ctx.registered.has(assetTag)) {
		row.add('assetTag', 'duplicate_existing');
	}
	const typeName = row.text('typeName');
	if (typeName) {
		checkMasterName(row, 'typeName', ctx.types.get(typeName), ctx);
	}
	const locationName = row.text('locationName');
	if (locationName) {
		checkMasterName(row, 'locationName', ctx.locations.get(locationName), ctx);
	}
	return {
		assetTag: assetTag ?? '',
		name: name ?? '',
		typeName,
		serialNo: row.text('serialNo'),
		locationName,
		note: row.text('note'),
	};
}

function judgmentOf(issues: ImportIssue[]): Judgment {
	if (issues.some((i) => i.level === 'error')) {
		return 'error';
	}
	return issues.length > 0 ? 'warn' : 'ok';
}

/** Judge one row: its issues and judgment, and the equipment to register. */
export function judgeRow({ line, values }: FileRow, ctx: RowContext): PlannedRow {
	const row = new RowReader(values);
	const fields = readEquipment(row, ctx);
	return { line, judgment: judgmentOf(row.issues), values, issues: row.issues, fields };
}

// --- The whole file ----------------------------------------------------------------

function byName(entries: MasterEntry[]): Map<string, MasterEntry> {
	return new Map(entries.map((e) => [e.name, e]));
}

function countTags(rows: FileRow[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const r of rows) {
		const tag = r.values.assetTag ?? '';
		if (tag) {
			counts.set(tag, (counts.get(tag) ?? 0) + 1);
		}
	}
	return counts;
}

/** Rows per judgment, and the types / locations the rows that will be imported add. */
function summarize(
	rows: PlannedRow[],
): Pick<ImportPreview, 'counts' | 'newTypes' | 'newLocations'> {
	const counts: Record<Judgment, number> = { ok: 0, warn: 0, error: 0 };
	const newTypes = new Set<string>();
	const newLocations = new Set<string>();
	for (const r of rows) {
		counts[r.judgment]++;
		if (r.judgment === 'error') {
			continue;
		}
		for (const i of r.issues) {
			if (i.code === 'type_unregistered' && r.fields.typeName) {
				newTypes.add(r.fields.typeName);
			}
			if (i.code === 'location_unregistered' && r.fields.locationName) {
				newLocations.add(r.fields.locationName);
			}
		}
	}
	return { counts, newTypes: [...newTypes], newLocations: [...newLocations] };
}

/** Read the file and judge every row (admin). */
async function plan(
	db: Client,
	actor: Actor,
	bytes: Uint8Array,
	options: ImportOptions,
): Promise<Plan> {
	requireAdmin(actor);
	const file = readImportFile(bytes);
	const [masters, registered] = await Promise.all([
		listMasters(db),
		registeredAssetTags(
			db,
			file.rows.map((r) => r.values.assetTag ?? ''),
		),
	]);
	const ctx: RowContext = {
		options,
		types: byName(masters.types),
		locations: byName(masters.locations),
		registered,
		tagCounts: countTags(file.rows),
	};
	const rows = file.rows.map((r) => judgeRow(r, ctx));
	const { counts, newTypes, newLocations } = summarize(rows);
	return {
		preview: {
			encoding: file.encoding,
			columns: file.columns,
			rows: rows.map(({ line, judgment, values, issues }) => ({ line, judgment, values, issues })),
			counts,
			newTypes,
			newLocations,
		},
		rows,
	};
}

/** The file to fill in (admin): the header and two example rows. */
export function importTemplate(actor: Actor): string {
	requireAdmin(actor);
	return importTemplateCsv();
}

/** Judge a file without writing anything (admin). */
export async function previewImport(
	db: Client,
	actor: Actor,
	bytes: Uint8Array,
	options: ImportOptions,
): Promise<ImportPreview> {
	return (await plan(db, actor, bytes, options)).preview;
}

// --- Writing -----------------------------------------------------------------------

/**
 * Import a file (admin). `all` requires no `error` rows; `skip_errors` leaves
 * them out. Missing types / locations are added first, then the rows go in
 * batches of IMPORT_BATCH_ROWS, each one transaction (equipment + `create`
 * event). A failing batch stops the import; the result says where. One
 * `import` event records the counts.
 */
export async function runImport(
	db: Client,
	actor: Actor,
	bytes: Uint8Array,
	fileName: string | null,
	options: ImportOptions,
	mode: ImportMode,
): Promise<ImportResult> {
	const { preview, rows } = await plan(db, actor, bytes, options);
	if (mode === 'all' && preview.counts.error > 0) {
		throw new AppError(ErrorCode.ImportHasErrors);
	}
	const todo = rows.filter((r) => r.judgment !== 'error');
	if (todo.length === 0) {
		throw new AppError(ErrorCode.ImportNothingToImport);
	}

	if (preview.newTypes.length > 0 || preview.newLocations.length > 0) {
		await db.batch(
			[
				...addMissingMasterStatements('types', preview.newTypes),
				...addMissingMasterStatements('locations', preview.newLocations),
			],
			'write',
		);
	}
	const masters = await listMasters(db);
	const typeIds = new Map(masters.types.map((t) => [t.name, t.id]));
	const locationIds = new Map(masters.locations.map((l) => [l.name, l.id]));

	const result: ImportResult = {
		created: 0,
		excluded: rows.length - todo.length,
		addedTypes: preview.newTypes,
		addedLocations: preview.newLocations,
		failed: null,
	};
	for (let i = 0; i < todo.length; i += IMPORT_BATCH_ROWS) {
		const chunk = todo.slice(i, i + IMPORT_BATCH_ROWS);
		const statements: InStatement[] = chunk.flatMap((r) => {
			const { typeName, locationName, ...fields } = r.fields;
			return equipmentInsertStatements(
				{
					...fields,
					typeId: typeName ? (typeIds.get(typeName) ?? null) : null,
					locationId: locationName ? (locationIds.get(locationName) ?? null) : null,
				},
				actor,
			);
		});
		try {
			await db.batch(statements, 'write');
		} catch (err) {
			const duplicate = isUniqueTagViolation(err);
			if (!duplicate) {
				console.error('[import] batch failed', err);
			}
			result.failed = {
				fromLine: chunk[0].line,
				toLine: chunk[chunk.length - 1].line,
				code: duplicate ? 'duplicate_existing' : ErrorCode.InternalError,
			};
			break;
		}
		result.created += chunk.length;
	}

	await db.execute(
		unguardedEventStatement({
			kind: 'import',
			equipment: null,
			actor,
			detail: {
				fileName,
				created: result.created,
				excluded: result.excluded,
				addedTypes: result.addedTypes,
				addedLocations: result.addedLocations,
				failedFromLine: result.failed?.fromLine ?? null,
			},
		}),
	);
	return result;
}
