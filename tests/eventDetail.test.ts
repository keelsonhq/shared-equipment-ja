import { describe, expect, it } from 'vite-plus/test';
import { type DetailLabels, detailLines } from '#lib/components/events/eventDetail.ts';

// An event's detail as display lines (src/lib/components/events/eventDetail.ts):
// values print as String() prints them, wall-clock times with a space, empty
// ones as the "empty" label, and the words come from the caller's labels
// (English here: no CJK in tests).

const LABELS: DetailLabels = {
	fields: {
		note: 'Note',
		dueAt: 'Due',
		location: 'Location',
		fileName: 'File',
		created: 'Created',
		excluded: 'Excluded',
		addedTypes: 'Added types',
	},
	reasons: { broken: 'Broken' },
	returnKinds: { collected: 'Collected by an admin' },
	arrow: ' -> ',
	separator: ': ',
	empty: '(none)',
};

describe('detailLines', () => {
	it('prints the changes of an edit, empty values as the empty label', () => {
		const changes = { note: ['', 'Cracked'], dueAt: ['2026-10-03T18:00', null] };
		expect(detailLines('edit', { changes }, LABELS)).toEqual([
			'Note: (none) -> Cracked',
			'Due: 2026-10-03 18:00 -> (none)',
		]);
	});

	it('prints the facts of an import, numbers and zero included, lists joined', () => {
		const detail = {
			fileName: 'equipment.csv',
			created: 12,
			excluded: 0,
			addedTypes: ['Camera', 'Drone'],
			addedLocations: [],
			failedFromLine: null,
		};
		expect(detailLines('import', detail, LABELS)).toEqual([
			'File: equipment.csv',
			'Created: 12',
			'Excluded: 0',
			'Added types: Camera / Drone',
		]);
	});

	it('names what the label tables know and keeps the code of what they do not', () => {
		expect(detailLines('suspend', { reason: 'broken', note: '' }, LABELS)).toEqual([
			'reason: Broken',
		]);
		expect(
			detailLines('return', { returnKind: 'collected', location: 'Shelf A', note: 'Box' }, LABELS),
		).toEqual(['Collected by an admin', 'Location: Shelf A', 'Note: Box']);
		expect(detailLines('return', { returnKind: 'lost_in_post' }, LABELS)).toEqual(['lost_in_post']);
		expect(detailLines('lend', { dueAt: '2026-10-03T18:00' }, LABELS)).toEqual([
			'Due: 2026-10-03 18:00',
		]);
		expect(detailLines('lend', null, LABELS)).toEqual([]);
	});
});
