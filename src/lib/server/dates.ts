import { appTimeZone } from './env.ts';

// Calendar dates are plain `YYYY-MM-DD` strings. Booking and loan times are
// wall-clock times in the app time zone, `YYYY-MM-DDTHH:MM` (no offset, minute
// precision): fixed width, so comparing the strings compares the times, and a
// day is a prefix. Operation timestamps (created_at, events.at) are ISO-8601
// UTC instants.
//
// Arithmetic on wall-clock times is naive (every day has 24 hours). That is
// exact for zones without daylight saving time, such as the default
// Asia/Tokyo.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** Booking granularity: starts, ends and due times are on 15-minute steps. */
export const STEP_MINUTES = 15;

/** True for a real calendar date in `YYYY-MM-DD` form. */
export function isIsoDate(value: unknown): value is string {
	if (typeof value !== 'string' || !DATE_RE.test(value)) {
		return false;
	}
	const d = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** True for a real wall-clock time in `YYYY-MM-DDTHH:MM` form. */
export function isLocalDateTime(value: unknown): value is string {
	if (typeof value !== 'string' || !DATETIME_RE.test(value)) {
		return false;
	}
	const d = new Date(`${value}:00Z`);
	return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 16) === value;
}

/** Current wall-clock time in the app time zone, `YYYY-MM-DDTHH:MM`. */
export function nowLocal(now: Date = new Date(), timeZone: string = appTimeZone()): string {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		hourCycle: 'h23',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
	}).formatToParts(now);
	const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
	return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/** Today's date in the app time zone (APP_TIME_ZONE, default Asia/Tokyo). */
export function today(now: Date = new Date(), timeZone: string = appTimeZone()): string {
	return nowLocal(now, timeZone).slice(0, 10);
}

/** The calendar date `days` after `date` (negative: before). */
export function addDays(date: string, days: number): string {
	const d = new Date(`${date}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

/** A wall-clock time `minutes` later (negative: earlier). */
export function addMinutes(at: string, minutes: number): string {
	const d = new Date(`${at}:00Z`);
	d.setUTCMinutes(d.getUTCMinutes() + minutes);
	return d.toISOString().slice(0, 16);
}

/** Whole minutes from `from` to `to` (negative when `to` is earlier). */
export function minutesBetween(from: string, to: string): number {
	return Math.round((Date.parse(`${to}:00Z`) - Date.parse(`${from}:00Z`)) / 60_000);
}

/** Whether a wall-clock time is on a booking step (:00 / :15 / :30 / :45). */
export function onStep(at: string): boolean {
	return Number(at.slice(14, 16)) % STEP_MINUTES === 0;
}

/** The start of the booking step that contains `at` (10:07 -> 10:00). */
export function stepStart(at: string): string {
	const minute = Number(at.slice(14, 16));
	return `${at.slice(0, 14)}${String(minute - (minute % STEP_MINUTES)).padStart(2, '0')}`;
}

/** Current instant as an ISO-8601 UTC string. */
export function nowIso(): string {
	return new Date().toISOString();
}

/**
 * UTC instant at which a local calendar day starts in `timeZone`. Turns a
 * date-range filter (local dates) into bounds on an ISO-8601 UTC column.
 */
export function zonedDayStartIso(date: string, timeZone: string = appTimeZone()): string {
	const utcMidnight = new Date(`${date}T00:00:00Z`);
	// Offset of the zone at that instant: format the instant in the zone and
	// read it back as if it were UTC.
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hourCycle: 'h23',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	}).formatToParts(utcMidnight);
	const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
	const asUtc = Date.UTC(
		get('year'),
		get('month') - 1,
		get('day'),
		get('hour'),
		get('minute'),
		get('second'),
	);
	const offsetMs = asUtc - utcMidnight.getTime();
	return new Date(utcMidnight.getTime() - offsetMs).toISOString();
}
