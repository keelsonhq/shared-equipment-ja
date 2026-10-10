import { describe, expect, it } from 'vite-plus/test';
import { commaSeparatedParam, listParams, PAGE_SIZES, queryHref } from '#lib/urlquery.ts';

// How the list screens change their URL query (src/lib/urlquery.ts, used by
// updateQuery in urlstate.ts): the browser side of the list URL contract.

const at = (href: string) => new URL(href, 'http://app.test');

describe('queryHref', () => {
	it.each([
		[
			'sets a new key after the existing ones',
			'/equipment?q=pc',
			{ status: 'overdue' },
			'/equipment?q=pc&status=overdue',
		],
		[
			'replaces a key in place',
			'/equipment?q=pc&sort=name',
			{ q: 'camera' },
			'/equipment?q=camera&sort=name',
		],
		['removes a key on null', '/equipment?q=pc&type=3', { type: null }, '/equipment?q=pc'],
		['removes a key on an empty string', '/equipment?q=pc&type=3', { q: '' }, '/equipment?type=3'],
		['drops the query when nothing is left', '/equipment?q=pc', { q: null }, '/equipment'],
		['writes numbers as text', '/equipment', { size: 100 }, '/equipment?size=100'],
		[
			'starts again from page 1 on a new filter',
			'/equipment?q=pc&page=3',
			{ q: 'camera' },
			'/equipment?q=camera',
		],
		[
			'starts again from page 1 on a new page size',
			'/history?page=2',
			{ size: 200 },
			'/history?size=200',
		],
		[
			'starts again from page 1 on another tab',
			'/reservations?page=2',
			{ tab: 'all' },
			'/reservations?tab=all',
		],
		[
			'keeps a page the change sets itself',
			'/equipment?q=pc&page=3',
			{ page: 4 },
			'/equipment?q=pc&page=4',
		],
		[
			'sets sort and direction together',
			'/equipment?status=on_loan',
			{ sort: 'due', dir: 'desc' },
			'/equipment?status=on_loan&sort=due&dir=desc',
		],
	] as const)('%s', (_label, from, changes, expected) => {
		expect(queryHref(at(from), changes)).toBe(expected);
	});

	it('keeps the page when resetPage is false (the paging buttons)', () => {
		expect(queryHref(at('/equipment?q=pc&page=2'), { size: 100 }, { resetPage: false })).toBe(
			'/equipment?q=pc&page=2&size=100',
		);
	});

	it('resets the page when the options leave resetPage out', () => {
		expect(queryHref(at('/equipment?q=pc&page=2'), { q: 'camera' }, {})).toBe(
			'/equipment?q=camera',
		);
	});

	it('round-trips list values and spaces through the query', () => {
		const href = queryHref(at('/history'), { kind: 'lend,return', q: 'PC 1' });
		const params = at(href).searchParams;
		expect(params.get('q')).toBe('PC 1');
		expect(commaSeparatedParam(params, 'kind')).toEqual(['lend', 'return']);
	});

	it('does not change the URL it was given', () => {
		const url = at('/equipment?q=pc&page=3');
		queryHref(url, { q: null });
		expect(url.search).toBe('?q=pc&page=3');
	});
});

describe('commaSeparatedParam', () => {
	it.each([
		['', []],
		['status=overdue', ['overdue']],
		['status=overdue,suspended', ['overdue', 'suspended']],
		['status=overdue,,suspended,', ['overdue', 'suspended']],
		['status=', []],
	] as const)('%s', (qs, expected) => {
		expect(commaSeparatedParam(new URLSearchParams(qs), 'status')).toEqual(expected);
	});
});

describe('listParams', () => {
	it.each([
		['an empty query', '', { sort: 'tag', dir: 'asc', page: 1, size: 50 }],
		[
			'every key set',
			'sort=name&dir=desc&page=3&size=200',
			{ sort: 'name', dir: 'desc', page: 3, size: 200 },
		],
		['a direction other than desc', 'dir=down', { sort: 'tag', dir: 'asc', page: 1, size: 50 }],
		['page 0', 'page=0', { sort: 'tag', dir: 'asc', page: 1, size: 50 }],
		['a negative page', 'page=-2', { sort: 'tag', dir: 'asc', page: 1, size: 50 }],
		['a page that is not a number', 'page=two', { sort: 'tag', dir: 'asc', page: 1, size: 50 }],
		['a size the bar does not offer', 'size=75', { sort: 'tag', dir: 'asc', page: 1, size: 50 }],
		['a size of 100', 'size=100', { sort: 'tag', dir: 'asc', page: 1, size: 100 }],
		['a size that is not a number', 'size=all', { sort: 'tag', dir: 'asc', page: 1, size: 50 }],
		// The server checks the sort key against its own list.
		['an unknown sort key', 'sort=color', { sort: 'color', dir: 'asc', page: 1, size: 50 }],
	] as const)('%s', (_label, qs, expected) => {
		expect(listParams(new URLSearchParams(qs), { sort: 'tag' })).toEqual(expected);
	});

	it('reads an empty sort when the screen has none (history, my page)', () => {
		expect(listParams(new URLSearchParams('page=2'))).toEqual({
			sort: '',
			dir: 'asc',
			page: 2,
			size: 50,
		});
	});

	it('defaults to the first page size the bar offers', () => {
		expect(listParams(new URLSearchParams('')).size).toBe(PAGE_SIZES[0]);
	});
});
