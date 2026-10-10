import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { readPref, writePref } from '#lib/state/prefs.ts';

// Display preferences live in localStorage under the app's key prefix. A
// preference saved by an earlier version of the app must still be read.

let store: Map<string, string>;

beforeEach(() => {
	store = new Map();
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => store.set(key, value),
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('display preferences', () => {
	it('stores values as JSON under the shared-equipment: prefix', () => {
		writePref('equipment.columns', ['name', 'type']);
		expect([...store.entries()]).toEqual([
			['shared-equipment:equipment.columns', '["name","type"]'],
		]);
		expect(readPref('equipment.columns', [])).toEqual(['name', 'type']);
	});

	it('reads what browsers already saved, and falls back when there is nothing', () => {
		store.set('shared-equipment:density.dense', 'true');
		expect(readPref('density.dense', false)).toBe(true);
		expect(readPref('equipment.columns', ['name'])).toEqual(['name']);
	});

	it('falls back when storage is blocked or the value is broken', () => {
		store.set('shared-equipment:density.dense', '{broken');
		expect(readPref('density.dense', false)).toBe(false);
		vi.stubGlobal('localStorage', {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('blocked');
			},
		});
		expect(readPref('density.dense', false)).toBe(false);
		expect(() => writePref('density.dense', true)).not.toThrow();
	});
});
