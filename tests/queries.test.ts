import { describe, expect, it } from 'vite-plus/test';
import {
	parseEquipmentQuery,
	parseEventQuery,
	parseReservationQuery,
} from '#lib/server/http/queries.ts';

// The list URL contract (DESIGN.md §2, §8.4): what each query key of the
// equipment ledger, reservations and history lists means. A shared or stale
// URL must still open the list, so a bad value falls back to its default
// instead of failing.

const equipment = (qs: string) => parseEquipmentQuery(new URLSearchParams(qs));
const reservations = (qs: string) => parseReservationQuery(new URLSearchParams(qs));
const events = (qs: string) => parseEventQuery(new URLSearchParams(qs));

describe('parseEquipmentQuery (ledger, /api/equipment)', () => {
	it('defaults to every piece by asset tag, 50 per page', () => {
		expect(equipment('')).toEqual({
			q: null,
			statuses: [],
			typeId: null,
			noType: false,
			locationId: null,
			bookable: false,
			ids: [],
			sort: 'tag',
			dir: 'asc',
			page: 1,
			size: 50,
		});
	});

	it.each([
		// search
		['q=%20camera%20', { q: 'camera' }],
		['q=%20%20', { q: null }],
		[`q=${'x'.repeat(150)}`, { q: 'x'.repeat(100) }],
		// status: known values only
		['status=overdue,suspended', { statuses: ['overdue', 'suspended'] }],
		['status=overdue,,bogus,%20on_loan', { statuses: ['overdue', 'on_loan'] }],
		// type: an id, or `none` for equipment without a type
		['type=3', { typeId: 3, noType: false }],
		['type=none', { typeId: null, noType: true }],
		['type=0', { typeId: null, noType: false }],
		['type=-1', { typeId: null, noType: false }],
		['type=1.5', { typeId: null, noType: false }],
		['type=abc', { typeId: null, noType: false }],
		// location
		['location=2', { locationId: 2 }],
		['location=x', { locationId: null }],
		// bookable (the booking picker)
		['bookable=1', { bookable: true }],
		['bookable=true', { bookable: false }],
		// ids (CSV export of the selected rows): positive integers, in order
		['ids=3,1,2', { ids: [3, 1, 2] }],
		['ids=1,x,0,-2,2.5,4', { ids: [1, 4] }],
		// sort and direction
		['sort=borrower&dir=desc', { sort: 'borrower', dir: 'desc' }],
		['sort=due', { sort: 'due', dir: 'asc' }],
		['sort=bogus&dir=sideways', { sort: 'tag', dir: 'asc' }],
		// paging
		['page=3&size=100', { page: 3, size: 100 }],
		['page=0&size=75', { page: 1, size: 50 }],
		['page=2.5&size=200', { page: 1, size: 200 }],
	] as const)('%s', (qs, expected) => {
		expect(equipment(qs)).toMatchObject(expected);
	});

	it('keeps at most 1,000 ids', () => {
		const ids = Array.from({ length: 1200 }, (_, i) => i + 1);
		expect(equipment(`ids=${ids.join(',')}`).ids).toEqual(ids.slice(0, 1000));
	});
});

describe('parseReservationQuery (reservations, /api/reservations)', () => {
	it('defaults to my upcoming bookings, 50 per page', () => {
		expect(reservations('')).toEqual({
			scope: 'mine',
			when: 'upcoming',
			from: null,
			to: null,
			q: null,
			page: 1,
			size: 50,
		});
	});

	it.each([
		// scope: `all` (everyone's, admin) or my own
		['scope=all', { scope: 'all' }],
		['scope=everyone', { scope: 'mine' }],
		// when: past, or upcoming
		['when=past', { when: 'past' }],
		['when=later', { when: 'upcoming' }],
		// from / to: real YYYY-MM-DD dates only
		['from=2025-04-01&to=2025-04-30', { from: '2025-04-01', to: '2025-04-30' }],
		['from=2025/04/01&to=2025-02-30', { from: null, to: null }],
		// search
		['q=%20PJ-1%20', { q: 'PJ-1' }],
		[`q=${'y'.repeat(150)}`, { q: 'y'.repeat(100) }],
		// paging
		['page=2&size=100', { page: 2, size: 100 }],
		['page=x&size=0', { page: 1, size: 50 }],
	] as const)('%s', (qs, expected) => {
		expect(reservations(qs)).toMatchObject(expected);
	});
});

describe('parseEventQuery (history, /api/events)', () => {
	it('defaults to every event, 50 per page', () => {
		expect(events('')).toEqual({
			kinds: [],
			from: null,
			to: null,
			actorId: null,
			q: null,
			page: 1,
			size: 50,
		});
	});

	it.each([
		// kind: known values only
		['kind=lend', { kinds: ['lend'] }],
		['kind=reserve,lend,import', { kinds: ['reserve', 'lend', 'import'] }],
		['kind=lend,nope,', { kinds: ['lend'] }],
		// from / to: real YYYY-MM-DD dates only
		['from=2025-04-01&to=2025-04-30', { from: '2025-04-01', to: '2025-04-30' }],
		['from=2025/04/01&to=2025-02-30', { from: null, to: null }],
		// actor
		['actor=u-admin', { actorId: 'u-admin' }],
		['actor=', { actorId: null }],
		// search
		['q=%20PJ-1%20', { q: 'PJ-1' }],
		[`q=${'y'.repeat(150)}`, { q: 'y'.repeat(100) }],
		// paging
		['page=4&size=200', { page: 4, size: 200 }],
		['page=-1&size=10', { page: 1, size: 50 }],
	] as const)('%s', (qs, expected) => {
		expect(events(qs)).toMatchObject(expected);
	});
});
