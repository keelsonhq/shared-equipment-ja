import { describe, expect, it } from 'vite-plus/test';
import { ApiError } from '#lib/api.ts';
import { splitError, timeProblem } from '#lib/forms.ts';

// splitError: field errors the form shows stay on their fields; any other
// field error becomes the general error. timeProblem: the one check every time
// input of the dialogs makes.

const failed = (fields: Record<string, string>) =>
	new ApiError(422, 'validation_failed', fields, null);

describe('splitError', () => {
	it('keeps the reasons of the fields the form shows', () => {
		expect(splitError(failed({ name: 'required', note: 'too_long' }), ['name', 'note'])).toEqual({
			fields: { name: 'required', note: 'too_long' },
			general: null,
		});
	});

	it('turns an error on a field the form does not show into validation_failed', () => {
		expect(splitError(failed({ name: 'required', userId: 'not_found' }), ['name'])).toEqual({
			fields: { name: 'required' },
			general: 'validation_failed',
		});
	});

	it('uses the code the caller gives for a hidden field, nested or not', () => {
		const hidden = { userId: 'member_not_found', equipmentId: 'equipment_not_found' };
		expect(splitError(failed({ userId: 'not_found' }), ['name'], hidden).general).toBe(
			'member_not_found',
		);
		expect(splitError(failed({ 'loan.equipmentId': 'invalid' }), [], hidden).general).toBe(
			'equipment_not_found',
		);
		expect(splitError(failed({ locationId: 'required' }), [], hidden).general).toBe(
			'validation_failed',
		);
	});

	it('passes other failures through as their code', () => {
		expect(splitError(new ApiError(409, 'equipment_on_loan'), ['name'])).toEqual({
			fields: {},
			general: 'equipment_on_loan',
		});
		expect(splitError(new TypeError('offline'), []).general).toBe('network_error');
	});
});

describe('timeProblem', () => {
	const NOW = '2026-10-06T10:07';
	const SLOT = '2026-10-06T10:00';

	it.each([
		// A due time: required, on a step, after now.
		['2026-10-06T10:15', { after: NOW }, false],
		['', { after: NOW }, 'required'],
		['2026-10-06T10:20', { after: NOW }, 'step'],
		['2026-10-06T10:00', { after: NOW }, 'past'],
		// A booking's start: not before the current slot (the slot itself is fine).
		['2026-10-06T10:00', { notBefore: SLOT }, false],
		['2026-10-06T09:45', { notBefore: SLOT }, 'past'],
		// A booking's end: after the start, when there is one.
		['2026-10-06T11:00', { start: '2026-10-06T10:00' }, false],
		['2026-10-06T10:00', { start: '2026-10-06T10:00' }, 'before_start'],
		['2026-10-06T09:00', { start: '' }, false],
		['', { start: '2026-10-06T10:00' }, 'required'],
	] as const)('%s with %o -> %s', (value, opts, expected) => {
		expect(timeProblem(value, opts)).toBe(expected);
	});
});
