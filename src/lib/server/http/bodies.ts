import {
	type EquipmentFields,
	SUSPEND_REASONS,
	type SuspendReason,
} from '#lib/server/domain/equipment.ts';
import type { LendInput, ReturnInput } from '#lib/server/domain/loans.ts';
import type { ReservationInput } from '#lib/server/domain/reservations.ts';
import {
	EQUIPMENT_LIMITS,
	LEND_NOTE_MAX,
	MASTER_NAME_MAX,
	RESERVATION_ID_MAX,
	RESERVATION_PURPOSE_MAX,
	RETURN_NOTE_MAX,
	SUSPEND_NOTE_MAX,
	USER_ID_MAX,
} from '#lib/limits.ts';
import { asBody, Checker } from './validate.ts';

// JSON request bodies -> business-layer inputs. Every field problem is
// collected and reported at once as `validation_failed` + `fields` (field
// names match the request body keys; nested blocks use `block.key`). Business
// rules (overlaps, past times, duplicate asset tags, ...) are checked in the
// business layer and reported the same way.

function equipmentFields(c: Checker): EquipmentFields {
	return {
		assetTag: c.text('assetTag', { max: EQUIPMENT_LIMITS.assetTag, required: true }),
		name: c.text('name', { max: EQUIPMENT_LIMITS.name, required: true }),
		typeId: c.id('typeId'),
		serialNo: c.text('serialNo', { max: EQUIPMENT_LIMITS.serialNo }),
		locationId: c.id('locationId'),
		note: c.text('note', { max: EQUIPMENT_LIMITS.note }),
	};
}

export function readEquipmentCreate(value: unknown): EquipmentFields {
	const c = new Checker(asBody(value));
	const fields = equipmentFields(c);
	c.done();
	return fields;
}

export function readEquipmentEdit(value: unknown): { fields: EquipmentFields; version: number } {
	const c = new Checker(asBody(value));
	const fields = equipmentFields(c);
	const version = c.version();
	c.done();
	return { fields, version };
}

function suspendFields(c: Checker): { reason: SuspendReason; note: string | null } {
	return {
		reason: c.oneOf('reason', SUSPEND_REASONS),
		note: c.text('note', { max: SUSPEND_NOTE_MAX }),
	};
}

export function readSuspend(value: unknown): { reason: SuspendReason; note: string | null } {
	const c = new Checker(asBody(value));
	const suspend = suspendFields(c);
	c.done();
	return suspend;
}

export function readReservationInput(value: unknown): ReservationInput {
	const c = new Checker(asBody(value));
	const input: ReservationInput = {
		equipmentId: c.id('equipmentId', { required: true }),
		userId: c.text('userId', { max: USER_ID_MAX }),
		startsAt: c.datetime('startsAt', { required: true }),
		endsAt: c.datetime('endsAt', { required: true }),
		purpose: c.text('purpose', { max: RESERVATION_PURPOSE_MAX }),
	};
	c.done();
	return input;
}

export function readLendInput(value: unknown): LendInput {
	const c = new Checker(asBody(value));
	const input: LendInput = {
		equipmentId: c.id('equipmentId', { required: true }),
		userId: c.text('userId', { max: USER_ID_MAX }),
		dueAt: c.datetime('dueAt', { required: true }),
		note: c.text('note', { max: LEND_NOTE_MAX }),
		reservationId: c.text('reservationId', { max: RESERVATION_ID_MAX }),
	};
	c.done();
	return input;
}

export function readReturnInput(value: unknown): ReturnInput {
	const c = new Checker(asBody(value));
	const suspend = c.nested('suspend');
	const input: ReturnInput = {
		note: c.text('note', { max: RETURN_NOTE_MAX }),
		locationId: c.id('locationId'),
		suspend: suspend && suspendFields(suspend),
	};
	c.done();
	return input;
}

export function readExtendInput(value: unknown): { dueAt: string } {
	const c = new Checker(asBody(value));
	const dueAt = c.datetime('dueAt', { required: true });
	c.done();
	return { dueAt };
}

export function readMasterPatch(value: unknown): { name?: string; active?: boolean } {
	const body = asBody(value);
	const c = new Checker(body);
	const patch: { name?: string; active?: boolean } = {};
	if (body.name !== undefined) {
		patch.name = c.text('name', { max: MASTER_NAME_MAX, required: true });
	}
	const active = c.flag('active');
	if (active !== null) {
		patch.active = active;
	}
	c.done();
	return patch;
}

export function readMasterName(value: unknown): string {
	const c = new Checker(asBody(value));
	const name = c.text('name', { max: MASTER_NAME_MAX, required: true });
	c.done();
	return name;
}
