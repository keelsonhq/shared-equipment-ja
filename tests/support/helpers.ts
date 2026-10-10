import type { Client } from '@libsql/client';
import { addMinutes, nowLocal, STEP_MINUTES, stepStart } from '#lib/server/dates.ts';
import { createEquipment, type EquipmentFields } from '#lib/server/domain/equipment.ts';
import type { LendInput, ReturnInput } from '#lib/server/domain/loans.ts';
import type { ReservationInput } from '#lib/server/domain/reservations.ts';
import { ADMIN } from './harness.ts';

// This app's records for tests (equipment, types, locations, times) and its
// error check, made in the database of harness.ts `freshDb`.

/** Id of a default storage location by its position (1 = first). */
export async function locationId(db: Client, position = 1): Promise<number> {
	const res = await db.execute({
		sql: 'SELECT id FROM locations ORDER BY sort_order LIMIT 1 OFFSET ?',
		args: [position - 1],
	});
	return Number(res.rows[0]?.id);
}

/** Id of a default equipment type by its position (1 = first). */
export async function typeId(db: Client, position = 1): Promise<number> {
	const res = await db.execute({
		sql: 'SELECT id FROM equipment_types ORDER BY sort_order LIMIT 1 OFFSET ?',
		args: [position - 1],
	});
	return Number(res.rows[0]?.id);
}

export function equipmentFields(
	tag: string,
	overrides: Partial<EquipmentFields> = {},
): EquipmentFields {
	return {
		assetTag: tag,
		name: `Projector ${tag}`,
		typeId: null,
		serialNo: `SN-${tag}`,
		locationId: null,
		note: null,
		...overrides,
	};
}

/** Equipment fields with every field set: none optional, none null. */
export type CompleteEquipmentFields = {
	[K in keyof EquipmentFields]-?: NonNullable<EquipmentFields[K]>;
};

/**
 * A value in every equipment field (tests/equipment-fields.test.ts checks that
 * each one survives every way in and out). A new field in EquipmentFields
 * fails the type check here until it has a value. `second`: a different value
 * in every field (with another tag, type and location, an edit that changes
 * them all).
 */
export function completeEquipmentFields(
	tag: string,
	typeId: number,
	locationId: number,
	second = false,
): CompleteEquipmentFields {
	return {
		assetTag: tag,
		name: second ? `Camera ${tag}` : `Projector ${tag}`,
		typeId,
		serialNo: second ? `SN2-${tag}` : `SN-${tag}`,
		locationId,
		note: second ? 'Spare battery' : 'HDMI cable included',
	};
}

/** Register a piece of equipment as the admin and return its id. */
export async function addEquipment(
	db: Client,
	tag: string,
	overrides: Partial<EquipmentFields> = {},
): Promise<number> {
	return (await createEquipment(db, ADMIN, equipmentFields(tag, overrides))).id;
}

// Times. Business rules compare wall-clock times in the app time zone with
// "now", so tests build their times from the current step: `slot(n)` is the
// start of the 15-minute step `n` steps from the one that contains now
// (slot(0) has already begun). `day(n, "HH:MM")` is a time n days from today.

/** The start of the booking step `n` steps from the current one. */
export function slot(n: number): string {
	return addMinutes(stepStart(nowLocal()), n * STEP_MINUTES);
}

/** `HH:MM` on the day `n` days from today. */
export function day(n: number, time: string): string {
	return `${addMinutes(`${nowLocal().slice(0, 10)}T00:00`, n * 24 * 60).slice(0, 10)}T${time}`;
}

// Inputs of the operations most tests start from, with the optional parts
// empty; a test names only what it is about.

/** A loan of `equipmentId` until `dueAt`, to the caller unless `userId` says otherwise. */
export function lendInput(
	equipmentId: number,
	dueAt: string,
	overrides: Partial<LendInput> = {},
): LendInput {
	return { equipmentId, userId: null, dueAt, note: null, reservationId: null, ...overrides };
}

/** A booking of `equipmentId` for [startsAt, endsAt), for the caller unless `userId` says otherwise. */
export function reserveInput(
	equipmentId: number,
	startsAt: string,
	endsAt: string,
	overrides: Partial<ReservationInput> = {},
): ReservationInput {
	return { equipmentId, userId: null, startsAt, endsAt, purpose: null, ...overrides };
}

/** A plain return: no note, no new location, no suspension. */
export function returnInput(overrides: Partial<ReturnInput> = {}): ReturnInput {
	return { note: null, locationId: null, suspend: null, ...overrides };
}
