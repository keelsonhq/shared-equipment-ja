// Turns an event's JSON detail into display lines. Only structure lives here;
// the words come from the caller's label table (view text).

export interface DetailLabels {
	fields: Record<string, string>;
	reasons: Record<string, string>;
	returnKinds: Record<string, string>;
	arrow: string;
	separator: string;
	empty: string;
}

type Detail = Record<string, unknown> | null;

// Detail values are JSON scalars (no event writes an array or an object here)
// and print as String() prints them. The cast says so to the lint, which
// rejects String() of an `unknown` that could be an object.
type Scalar = string | number | boolean;

function show(value: unknown, labels: DetailLabels): string {
	return value === null || value === undefined || value === ''
		? labels.empty
		: String(value as Scalar);
}

// Wall-clock times are stored as `YYYY-MM-DDTHH:MM`; shown with a space.
function time(value: unknown): unknown {
	return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
		? value.replace('T', ' ')
		: value;
}

/** One line per fact, e.g. ["Due: 2026-10-03 18:00", "Note: ..."]. */
export function detailLines(kind: string, detail: Detail, labels: DetailLabels): string[] {
	if (!detail) {
		return [];
	}
	const lines: string[] = [];
	const field = (key: string, value: unknown) => {
		if (value !== null && value !== undefined && value !== '') {
			lines.push(`${labels.fields[key] ?? key}${labels.separator}${String(time(value) as Scalar)}`);
		}
	};
	const changes = (detail.changes ?? null) as Record<string, [unknown, unknown]> | null;
	if (changes) {
		for (const [key, [before, after]] of Object.entries(changes)) {
			lines.push(
				`${labels.fields[key] ?? key}${labels.separator}${show(time(before), labels)}${labels.arrow}${show(time(after), labels)}`,
			);
		}
	}
	switch (kind) {
		case 'reserve':
		case 'cancel':
			field('startsAt', detail.startsAt);
			field('endsAt', detail.endsAt);
			field('purpose', detail.purpose);
			break;
		case 'lend':
			field('dueAt', detail.dueAt);
			field('note', detail.note);
			break;
		case 'return':
			if (typeof detail.returnKind === 'string') {
				lines.push(labels.returnKinds[detail.returnKind] ?? detail.returnKind);
			}
			field('dueAt', detail.dueAt);
			field('location', detail.location);
			field('note', detail.note);
			break;
		case 'suspend':
			if (typeof detail.reason === 'string') {
				field('reason', labels.reasons[detail.reason] ?? detail.reason);
			}
			field('note', detail.note);
			break;
		case 'import':
			field('fileName', detail.fileName);
			field('created', detail.created);
			field('excluded', detail.excluded);
			for (const key of ['addedTypes', 'addedLocations']) {
				const names = detail[key];
				if (Array.isArray(names) && names.length > 0) {
					field(key, names.join(' / '));
				}
			}
			field('failedFromLine', detail.failedFromLine);
			break;
	}
	return lines;
}
