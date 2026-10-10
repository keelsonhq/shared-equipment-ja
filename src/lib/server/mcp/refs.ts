import type { Client } from '@libsql/client';
import type { Actor } from '#lib/server/auth/actor.ts';
import { equipmentIdByTag, findEquipment } from '#lib/server/domain/equipment.ts';
import type { MasterEntry } from '#lib/server/domain/masters.ts';
import { AppError, ErrorCode, type FieldErrors, ValidationError } from '#lib/server/errors.ts';
import type { Checker } from '#lib/server/http/validate.ts';
import { EQUIPMENT_LIMITS } from '#lib/limits.ts';
import { normalizeName } from './args.ts';

// How this app's records and names meet the tools' arguments: what the model
// names (a piece of equipment by asset tag, a type, a location) turned into
// the ids the business layer takes — an unknown one is a `not_found` argument
// error — and the business layer's field names turned back into the argument
// names in errors. People are in people.ts.

// --- Records by name (equipment, types, locations) ---------------------------

/** The equipment named by `asset_tag` (required); records `not_found`. */
export async function equipmentArg(db: Client, c: Checker): Promise<number> {
	const tag = c.text('asset_tag', { max: EQUIPMENT_LIMITS.assetTag, required: true });
	return tag === '' ? 0 : ((await equipmentByTag(db, c, tag)) ?? 0);
}

export async function equipmentByTag(db: Client, c: Checker, tag: string): Promise<number | null> {
	const id = await equipmentIdByTag(db, tag);
	if (id === null) {
		c.fail('asset_tag', 'not_found');
	}
	return id;
}

/** An entry of a type / location list by name (NFKC, case and spaces ignored). */
function masterByName(
	entries: MasterEntry[],
	name: string,
	opts: { activeOnly: boolean; partial: boolean },
): MasterEntry | null {
	const key = normalizeName(name);
	const pool = opts.activeOnly ? entries.filter((e) => e.active) : entries;
	const exact = pool.filter((e) => normalizeName(e.name) === key);
	if (exact.length === 1 || !opts.partial) {
		return exact.length === 1 ? exact[0] : null;
	}
	const partial = pool.filter((e) => normalizeName(e.name).includes(key));
	return partial.length === 1 ? partial[0] : null;
}

/**
 * A type / location argument by name -> its id; records `not_found`. Writes
 * take an active entry by its exact name; a search also takes the one entry
 * whose name contains it (D-34).
 */
export function masterArg(
	c: Checker,
	key: 'type' | 'location',
	entries: MasterEntry[],
	name: string | null,
	use: 'write' | 'search',
): number | null {
	if (name === null) {
		return null;
	}
	const entry = masterByName(entries, name, {
		activeOnly: use === 'write',
		partial: use === 'search',
	});
	if (!entry) {
		c.fail(key, 'not_found');
	}
	return entry?.id ?? null;
}

/** The open loan of a piece of equipment (return / extend address it by tag). */
export async function openLoanId(db: Client, actor: Actor, equipmentId: number): Promise<string> {
	const found = await findEquipment(db, actor, equipmentId);
	if (!found?.loan) {
		throw new AppError(ErrorCode.EquipmentNotOnLoan);
	}
	return found.loan.id;
}

// --- Field names in errors -> argument names --------------------------------

// Business-layer field names that are not just their argument name in
// snake_case: ids the tool takes something else in place of (an asset tag, a
// name, a person).
const ARG_NAMES: Record<string, string> = {
	equipmentId: 'asset_tag',
	typeId: 'type',
	locationId: 'location',
	userId: 'person',
};

/** A business-layer field name as the tool's argument name: `dueAt` -> `due_at`, `userId` -> `person`. */
export function argName(field: string): string {
	return ARG_NAMES[field] ?? field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/**
 * Run a business-layer call, renaming the fields of its ValidationError to the
 * tool's argument names (argName). Reasons are kept as they are.
 */
export async function withArgNames<T>(run: () => Promise<T>): Promise<T> {
	try {
		return await run();
	} catch (err) {
		if (!(err instanceof ValidationError)) {
			throw err;
		}
		const fields: FieldErrors = {};
		for (const [key, reason] of Object.entries(err.fields)) {
			fields[argName(key)] ??= reason;
		}
		throw new ValidationError(fields, err.extra);
	}
}
