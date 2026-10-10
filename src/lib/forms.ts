import { tick } from 'svelte';
import { ApiError, errorCode } from './api.ts';

// Form error handling shared by every dialog and inline form (DESIGN.md §8.6):
// problems tied to a field are shown under that field; anything else goes to
// the dialog's general error box.

export type FieldErrors = Record<string, string>;

/**
 * Split an API failure into per-field reasons (only for the fields the form
 * shows) and a general error code.
 *
 * A field error for an input the form does not show (the screen that opened
 * the dialog fixed the record or the person) becomes the general error:
 * `hidden[<field>]` (by the last part of a nested name, `assignment.userId` ->
 * `userId`), else `validation_failed`.
 */
export function splitError(
	err: unknown,
	shown: readonly string[],
	hidden: Readonly<Record<string, string>> = {},
): { fields: FieldErrors; general: string | null } {
	if (!(err instanceof ApiError) || !err.fields) {
		return { fields: {}, general: errorCode(err) };
	}
	const fields: FieldErrors = {};
	let general: string | null = null;
	for (const [key, reason] of Object.entries(err.fields)) {
		if (shown.includes(key)) {
			fields[key] = reason;
		} else {
			general ??= hidden[key.split('.').pop() ?? key] ?? 'validation_failed';
		}
	}
	return { fields, general };
}

/** Build a field-error map from client-side checks (`false` = no problem). */
export function check(checks: Record<string, string | false>): FieldErrors {
	return Object.fromEntries(Object.entries(checks).filter(([, reason]) => reason)) as FieldErrors;
}

/**
 * The problem with a wall-clock time input (`YYYY-MM-DDTHH:MM`, as a
 * datetime field holds it), for `check()`: `required` when it is empty, `step`
 * when it is not on a 15-minute boundary, `past` when it is not after `after`
 * or is before `notBefore` (when given), `before_start` when it is not after
 * `start` (the period's start, when there is one); `false` when it is fine.
 */
export function timeProblem(
	value: string,
	{ after, notBefore, start }: { after?: string; notBefore?: string; start?: string },
): 'required' | 'step' | 'past' | 'before_start' | false {
	if (value === '') {
		return 'required';
	}
	if (Number(value.slice(14, 16)) % 15 !== 0) {
		return 'step';
	}
	if ((after !== undefined && value <= after) || (notBefore !== undefined && value < notBefore)) {
		return 'past';
	}
	if (start && value <= start) {
		return 'before_start';
	}
	return false;
}

/** True when the map has at least one entry. */
export function hasErrors(errors: FieldErrors): boolean {
	return Object.keys(errors).length > 0;
}

/** `errors` without the entry for `key` (the same object when there is none). */
export function without(errors: FieldErrors, key: string): FieldErrors {
	if (!(key in errors)) {
		return errors;
	}
	return Object.fromEntries(Object.entries(errors).filter(([k]) => k !== key));
}

/**
 * `oninput` on a <form>: once the user edits a field, its message goes away.
 * Inputs carry `name` = the field key.
 */
export function withoutEdited(errors: FieldErrors, e: Event): FieldErrors {
	const name = (e.target as HTMLInputElement | null)?.name;
	return name ? without(errors, name) : errors;
}

/**
 * After the errors render, move focus to the first invalid field: in `root`,
 * or else in the open dialog.
 */
export async function focusFirstInvalid(root?: ParentNode | null): Promise<void> {
	await tick();
	const scope = root ?? document.querySelector('dialog[open]') ?? document;
	scope.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
}
