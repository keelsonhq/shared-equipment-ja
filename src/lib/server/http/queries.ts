import { isIsoDate } from '#lib/server/dates.ts';
import { EQUIPMENT_IDS_MAX, IMPORT_FILE_NAME_MAX, SEARCH_MAX } from '#lib/limits.ts';
import {
	EQUIPMENT_SORTS,
	EQUIPMENT_STATUSES,
	type EquipmentQuery,
	type EquipmentSort,
	type EquipmentStatus,
} from '#lib/server/domain/equipment.ts';
import { EVENT_KINDS, type EventKind, type EventQuery } from '#lib/server/domain/events.ts';
import type { ReservationQuery } from '#lib/server/domain/reservations.ts';
import type { ImportMode, ImportOptions } from '#lib/server/import/importer.ts';
import { readDir, readList, readPaging } from './validate.ts';

// Query-string parsers for the list endpoints. Unknown or malformed values fall
// back to defaults (a stale shared URL should still open the list), so these
// never throw.

function positiveInt(value: string | null): number | null {
	const n = Number(value);
	return value !== null && Number.isInteger(n) && n > 0 ? n : null;
}

function text(value: string | null, max = SEARCH_MAX): string | null {
	const trimmed = value?.trim() ?? '';
	return trimmed === '' ? null : trimmed.slice(0, max);
}

export function parseEquipmentQuery(params: URLSearchParams): EquipmentQuery {
	const sort = params.get('sort');
	return {
		q: text(params.get('q')),
		statuses: readList(params, 'status').filter((s): s is EquipmentStatus =>
			(EQUIPMENT_STATUSES as readonly string[]).includes(s),
		),
		typeId: positiveInt(params.get('type')),
		noType: params.get('type') === 'none',
		locationId: positiveInt(params.get('location')),
		bookable: params.get('bookable') === '1',
		ids: readList(params, 'ids')
			.map(Number)
			.filter((n) => Number.isInteger(n) && n > 0)
			.slice(0, EQUIPMENT_IDS_MAX),
		sort: (EQUIPMENT_SORTS as readonly string[]).includes(sort ?? '')
			? (sort as EquipmentSort)
			: 'tag',
		dir: readDir(params, 'asc'),
		...readPaging(params),
	};
}

export function parseReservationQuery(params: URLSearchParams): ReservationQuery {
	const from = params.get('from');
	const to = params.get('to');
	return {
		scope: params.get('scope') === 'all' ? 'all' : 'mine',
		when: params.get('when') === 'past' ? 'past' : 'upcoming',
		from: isIsoDate(from) ? from : null,
		to: isIsoDate(to) ? to : null,
		q: text(params.get('q')),
		...readPaging(params),
	};
}

export function parseEventQuery(params: URLSearchParams): EventQuery {
	const from = params.get('from');
	const to = params.get('to');
	return {
		kinds: readList(params, 'kind').filter((k): k is EventKind =>
			(EVENT_KINDS as readonly string[]).includes(k),
		),
		from: isIsoDate(from) ? from : null,
		to: isIsoDate(to) ? to : null,
		actorId: text(params.get('actor')),
		q: text(params.get('q')),
		...readPaging(params),
	};
}

/** The CSV import's options (preview and import; on by default). */
export function parseImportOptions(params: URLSearchParams): ImportOptions {
	return { autoAddMasters: params.get('autoAddMasters') !== '0' };
}

/**
 * The import run: `mode=skip_errors` leaves the `error` rows out (anything
 * else is `all`), and `name` is the file name the history keeps.
 */
export function parseImportRun(params: URLSearchParams): {
	mode: ImportMode;
	fileName: string | null;
} {
	return {
		mode: params.get('mode') === 'skip_errors' ? 'skip_errors' : 'all',
		fileName: text(params.get('name'), IMPORT_FILE_NAME_MAX),
	};
}
