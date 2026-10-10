import {
	appendFileSync,
	copyFileSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Client, createClient } from '@libsql/client';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { migrationsDir } from '#lib/server/db/migrate.ts';
import { str } from '#lib/server/db/rows.ts';
import { MigrationError, runMigrations, splitStatements } from '../scripts/migrate.mjs';
import { strictClient } from './support/strict-client.ts';

// The migration runner (scripts/migrate.mjs), used by the CLI and at startup.

const dirs: string[] = [];
const clients: Client[] = [];

afterEach(() => {
	for (const c of clients.splice(0)) {
		c.close();
	}
	for (const d of dirs.splice(0)) {
		rmSync(d, { recursive: true, force: true });
	}
});

function memoryDb(): Client {
	const c = strictClient(createClient({ url: ':memory:' }));
	clients.push(c);
	return c;
}

/** A temporary migrations directory holding a copy of the given files. */
function tempMigrations(files: string[]): string {
	const dir = mkdtempSync(join(tmpdir(), 'shared-equipment-migrations-'));
	dirs.push(dir);
	for (const f of files) {
		copyFileSync(join(migrationsDir(), f), join(dir, f));
	}
	return dir;
}

async function names(db: Client, type: 'table' | 'index'): Promise<string[]> {
	const res = await db.execute({
		sql: "SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name",
		args: [type],
	});
	return res.rows.map((r) => str(r, 'name'));
}

async function ledger(db: Client) {
	const res = await db.execute(
		'SELECT version, checksum, applied_at FROM schema_migrations ORDER BY version',
	);
	return res.rows.map((r) => ({ ...r }));
}

// Every migration shipped in migrations/, in order. Read from the directory so
// that adding a migration (CUSTOMIZE.md §5) needs no change here.
const ALL = readdirSync(migrationsDir())
	.filter((f) => f.endsWith('.sql'))
	.sort()
	.map((f) => f.replace(/\.sql$/, ''));

describe('runMigrations', () => {
	it('applies every migration to an empty database', async () => {
		const db = memoryDb();
		const result = await runMigrations(db, migrationsDir());
		expect(result.applied).toEqual(ALL);
		// At least these; a later migration may add more.
		expect(await names(db, 'table')).toEqual(
			expect.arrayContaining([
				'attachments',
				'equipment',
				'equipment_types',
				'events',
				'loans',
				'locations',
				'notifications',
				'reservations',
				'schema_migrations',
			]),
		);
		expect(await names(db, 'index')).toEqual(
			expect.arrayContaining([
				'idx_attachments_equipment',
				'idx_equipment_location',
				'idx_equipment_name',
				'idx_equipment_type',
				'idx_events_at',
				'idx_events_equipment',
				'idx_events_subject',
				'idx_loans_due',
				'idx_loans_equipment',
				'idx_loans_user',
				'idx_notifications_status',
				'idx_reservations_equipment',
				'idx_reservations_starts',
				'idx_reservations_user',
				'ux_loans_open_equipment',
			]),
		);
	});

	it('is a no-op the second time', async () => {
		const db = memoryDb();
		await runMigrations(db, migrationsDir());
		const before = await ledger(db);
		const again = await runMigrations(db, migrationsDir());
		expect(again).toEqual({ applied: [], skipped: ALL });
		expect(await ledger(db)).toEqual(before);
	});

	it('stops with migration_checksum_mismatch when an applied file was edited', async () => {
		const db = memoryDb();
		const dir = tempMigrations(['0001_init.sql']);
		await runMigrations(db, dir);
		appendFileSync(join(dir, '0001_init.sql'), '\n-- edited after it was applied\n');
		const run = runMigrations(db, dir);
		await expect(run).rejects.toBeInstanceOf(MigrationError);
		await expect(run).rejects.toMatchObject({
			code: 'migration_checksum_mismatch',
			message: expect.stringContaining('0001_init.sql'),
		});
	});

	it('adds a column to a database migrated with an older set of files', async () => {
		const db = memoryDb();
		const dir = tempMigrations(['0001_init.sql']);
		await runMigrations(db, dir);
		// A later release ships a new migration; the existing database gets it.
		writeFileSync(
			join(dir, '0002_add_column.sql'),
			'-- Purchase date (optional).\nALTER TABLE equipment ADD COLUMN purchased_on TEXT;\n',
		);
		const result = await runMigrations(db, dir);
		expect(result).toEqual({ applied: ['0002_add_column'], skipped: ['0001_init'] });
		const columns = await db.execute('PRAGMA table_info(equipment)');
		expect(columns.rows.map((r) => str(r, 'name'))).toContain('purchased_on');
		expect((await ledger(db)).map((r) => r.version)).toEqual(['0001_init', '0002_add_column']);
	});

	it('rolls back a failing migration and records nothing', async () => {
		const db = memoryDb();
		const dir = tempMigrations(['0001_init.sql']);
		writeFileSync(
			join(dir, '0002_broken.sql'),
			'CREATE TABLE extra (id INTEGER);\nALTER TABLE no_such_table ADD COLUMN x TEXT;\n',
		);
		await expect(runMigrations(db, dir)).rejects.toMatchObject({ code: 'migration_failed' });
		expect(await names(db, 'table')).not.toContain('extra');
		expect((await ledger(db)).map((r) => r.version)).toEqual(['0001_init']);
	});

	it('lets two processes migrate the same database at once', async () => {
		const dir = tempMigrations([]);
		const url = `file:${join(dir, 'shared.db')}`;
		const a = strictClient(createClient({ url }));
		const b = strictClient(createClient({ url }));
		clients.push(a, b);
		const [ra, rb] = await Promise.all([
			runMigrations(a, migrationsDir()),
			runMigrations(b, migrationsDir()),
		]);
		expect([...ra.applied, ...rb.applied].sort()).toEqual(ALL);
		expect([...ra.skipped, ...rb.skipped].sort()).toEqual(ALL);
		expect((await ledger(a)).map((r) => r.version)).toEqual(ALL);
	});

	it('rejects a badly named file', async () => {
		const db = memoryDb();
		const dir = tempMigrations([]);
		writeFileSync(join(dir, '2_Add Column.sql'), 'SELECT 1;\n');
		await expect(runMigrations(db, dir)).rejects.toMatchObject({ code: 'migration_invalid_name' });
	});
});

describe('splitStatements', () => {
	it('splits at a semicolon that ends a line and drops comment lines', () => {
		const sql =
			'-- a comment; with a semicolon;\nCREATE TABLE a (\n  x TEXT\n);\n\nCREATE INDEX i ON a (x);  \n-- tail\n';
		expect(splitStatements(sql)).toEqual([
			'CREATE TABLE a (\n  x TEXT\n)',
			'CREATE INDEX i ON a (x)',
		]);
	});
});
