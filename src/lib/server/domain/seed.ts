import type { Client, InStatement } from '@libsql/client';
import equipmentFile from '../../../../seed-data/equipment.json';
import devUsersFile from '../../../../seed-data/dev-users.json';
import mastersFile from '../../../../seed-data/masters.json';
import scheduleFile from '../../../../seed-data/schedule.json';
import { addDays, nowIso, nowLocal } from '#lib/server/dates.ts';
import { namedStatement } from '#lib/server/db/named.ts';
import { type EquipmentFields, equipmentInsertStatements } from './equipment.ts';
import { unguardedEventStatement } from './events.ts';
import { listMasters } from './masters.ts';

// Initial data.
//
// - Default equipment types and storage locations (seed-data/masters.json):
//   the initial entries of the masters screen, inserted at every start into a
//   list that is still empty.
// - The sample ledger (equipment, bookings, loans, history) is for local
//   development, tests and screenshots only. The `pnpm dev` launcher asks for it;
//   a deployed app (gateway sign-in) never loads it.
//
// The Japanese text lives in seed-data/*.json; this module is CJK-free. Times
// in the files are relative ([days from today, "HH:MM"]), so the sample always
// looks current: something is out, due today, overdue, booked later today.
// See seed-data/README.md for the story the data tells. Equipment is written
// by equipment.ts `equipmentInsertStatements`, like every new piece.

type When = [number, string];

interface SeedEquipment {
	tag: string;
	name: string;
	type: string;
	serial?: string;
	location: string;
	note?: string;
	createdDaysAgo: number;
	suspend?: { reason: 'repair' | 'broken' | 'lost' | 'other'; note: string; daysAgo: number };
}

interface SeedLoan {
	tag: string;
	user: string;
	lent: When;
	due: When;
	note?: string;
	returned?: When;
	returnKind?: 'returned' | 'collected';
	returnNote?: string;
	/** The loan picked up this booking (from `start` to the loan's due time). */
	booking?: { start: When; purpose: string };
}

interface SeedReservation {
	tag: string;
	user: string;
	start: When;
	end: When;
	purpose: string;
	cancelled?: 'user' | 'admin';
}

interface SeedPerson {
	id: string;
	name: string;
	email: string;
}

/** A wall-clock time from a relative [days, "HH:MM"]. */
function at(base: string, when: When): string {
	return `${addDays(base, when[0])}T${when[1]}`;
}

// Offset of the app time zone from UTC now, in ms (wall clock - UTC).
function zoneOffsetMs(): number {
	const local = Date.parse(`${nowLocal()}:00Z`);
	return Math.round((local - Date.now()) / 60_000) * 60_000;
}

/** An operation timestamp (UTC ISO) for a wall-clock time, plus `seconds`. */
function stamp(local: string, offsetMs: number, seconds = 0): string {
	return new Date(Date.parse(`${local}:00Z`) - offsetMs + seconds * 1000).toISOString();
}

async function isEmpty(
	db: Client,
	table: 'equipment_types' | 'locations' | 'equipment',
): Promise<boolean> {
	const res = await db.execute(`SELECT COUNT(*) AS n FROM ${table}`);
	return Number(res.rows[0]?.n ?? 0) === 0;
}

/**
 * Default equipment types and storage locations. A list that already has rows
 * is left alone (an admin may have renamed or deactivated the defaults).
 * Unique names make a concurrent start by another container harmless.
 */
export async function ensureDefaultMasters(db: Client): Promise<void> {
	const ts = nowIso();
	const statements: InStatement[] = [];
	for (const [table, names] of [
		['equipment_types', mastersFile.types],
		['locations', mastersFile.locations],
	] as const) {
		if (!(await isEmpty(db, table))) {
			continue;
		}
		names.forEach((name, i) => {
			statements.push(
				namedStatement(
					`INSERT INTO ${table} (name, active, sort_order, created_at, updated_at)
					VALUES (:name, 1, :sortOrder, :ts, :ts) ON CONFLICT (name) DO NOTHING`,
					{ name, sortOrder: i + 1, ts },
				),
			);
		});
	}
	if (statements.length > 0) {
		await db.batch(statements, 'write');
	}
}

/** Load the sample ledger into a database that has no equipment yet. */
export async function seedSampleDataIfEmpty(db: Client): Promise<boolean> {
	if (!(await isEmpty(db, 'equipment'))) {
		return false;
	}
	await seedSampleData(db);
	return true;
}

/** The sample ledger: equipment, loans, bookings, and their history. */
export async function seedSampleData(db: Client): Promise<void> {
	const base = nowLocal().slice(0, 10);
	const offset = zoneOffsetMs();
	const admin = equipmentFile.admin;
	// The people of the records: the local roster (who `pnpm dev` signs in and
	// lists as members) and the former members, who appear in the records only.
	const people = new Map<string, SeedPerson>(
		[...devUsersFile.users, ...scheduleFile.former].map((p) => [p.id, p]),
	);
	const person = (id: string): SeedPerson => {
		const found = people.get(id);
		if (!found) {
			throw new Error(`seed: unknown person ${id}`);
		}
		return found;
	};
	const masters = await listMasters(db);
	const typeIds = new Map(masters.types.map((t) => [t.name, t.id]));
	const locationIds = new Map(masters.locations.map((l) => [l.name, l.id]));
	const statements: InStatement[] = [];

	for (const piece of equipmentFile.equipment as SeedEquipment[]) {
		const fields: EquipmentFields = {
			assetTag: piece.tag,
			name: piece.name,
			typeId: typeIds.get(piece.type) ?? null,
			serialNo: piece.serial ?? null,
			locationId: locationIds.get(piece.location) ?? null,
			note: piece.note ?? null,
		};
		const created = stamp(at(base, [-piece.createdDaysAgo, '10:00']), offset);
		statements.push(...equipmentInsertStatements(fields, admin, created));
		if (piece.suspend) {
			const suspendedAt = stamp(at(base, [-piece.suspend.daysAgo, '11:00']), offset);
			statements.push(
				namedStatement(
					`UPDATE equipment SET suspended_reason = :reason, suspended_note = :note,
						updated_at = :at
					WHERE asset_tag = :tag`,
					{
						reason: piece.suspend.reason,
						note: piece.suspend.note,
						at: suspendedAt,
						tag: piece.tag,
					},
				),
				unguardedEventStatement({
					kind: 'suspend',
					equipment: { assetTag: piece.tag },
					actor: admin,
					detail: { reason: piece.suspend.reason, note: piece.suspend.note },
					at: suspendedAt,
				}),
			);
		}
	}

	for (const loan of scheduleFile.loans as SeedLoan[]) {
		const p = person(loan.user);
		const id = crypto.randomUUID();
		const lentAt = at(base, loan.lent);
		const dueAt = at(base, loan.due);
		const returnedAt = loan.returned ? at(base, loan.returned) : null;
		const collected = loan.returnKind === 'collected';
		const reservationId = loan.booking ? crypto.randomUUID() : null;
		if (loan.booking && reservationId) {
			const startsAt = at(base, loan.booking.start);
			const bookedAt = stamp(addDays(startsAt.slice(0, 10), -2) + startsAt.slice(10), offset);
			statements.push(
				namedStatement(
					`INSERT INTO reservations (id, equipment_id, user_id, user_name, user_email, starts_at,
							ends_at, purpose, status, booked_by_id, booked_by_name, loan_id, created_at,
							updated_at)
						VALUES (:id, (SELECT id FROM equipment WHERE asset_tag = :tag), :userId, :userName,
							:userEmail, :startsAt, :endsAt, :purpose, 'fulfilled', :userId, :userName, :loanId,
							:createdAt, :updatedAt)`,
					{
						id: reservationId,
						tag: loan.tag,
						userId: p.id,
						userName: p.name,
						userEmail: p.email,
						startsAt,
						endsAt: dueAt,
						purpose: loan.booking.purpose,
						loanId: id,
						createdAt: bookedAt,
						updatedAt: stamp(lentAt, offset),
					},
				),
				unguardedEventStatement({
					kind: 'reserve',
					equipment: { assetTag: loan.tag },
					reservationId,
					subject: { id: p.id, name: p.name },
					actor: p,
					detail: { startsAt, endsAt: dueAt, purpose: loan.booking.purpose },
					at: bookedAt,
				}),
			);
		}
		statements.push(
			namedStatement(
				`INSERT INTO loans (id, equipment_id, user_id, user_name, user_email, reservation_id,
						lent_at, due_at, note, lent_by_id, lent_by_name, returned_at, return_kind,
						returned_by_id, returned_by_name, return_note, created_at, updated_at)
					VALUES (:id, (SELECT id FROM equipment WHERE asset_tag = :tag), :userId, :userName,
						:userEmail, :reservationId, :lentAt, :dueAt, :note, :lentById, :lentByName,
						:returnedAt, :returnKind, :returnedById, :returnedByName, :returnNote, :createdAt,
						:updatedAt)`,
				{
					id,
					tag: loan.tag,
					userId: p.id,
					userName: p.name,
					userEmail: p.email,
					reservationId,
					lentAt,
					dueAt,
					note: loan.note ?? null,
					lentById: admin.id,
					lentByName: admin.name,
					returnedAt,
					returnKind: returnedAt ? (loan.returnKind ?? 'returned') : null,
					returnedById: returnedAt ? (collected ? admin.id : p.id) : null,
					returnedByName: returnedAt ? (collected ? admin.name : p.name) : null,
					returnNote: loan.returnNote ?? null,
					createdAt: stamp(lentAt, offset),
					updatedAt: stamp(returnedAt ?? lentAt, offset),
				},
			),
			unguardedEventStatement({
				kind: 'lend',
				equipment: { assetTag: loan.tag },
				loanId: id,
				reservationId,
				subject: { id: p.id, name: p.name },
				actor: admin,
				detail: { lentAt, dueAt, note: loan.note ?? null },
				at: stamp(lentAt, offset, 1),
			}),
		);
		if (returnedAt) {
			statements.push(
				unguardedEventStatement({
					kind: 'return',
					equipment: { assetTag: loan.tag },
					loanId: id,
					subject: { id: p.id, name: p.name },
					actor: collected ? admin : p,
					detail: {
						returnKind: collected ? 'collected' : 'returned',
						returnedAt,
						dueAt,
						note: loan.returnNote ?? null,
					},
					at: stamp(returnedAt, offset),
				}),
			);
		}
	}

	for (const r of scheduleFile.reservations as SeedReservation[]) {
		const p = person(r.user);
		const id = crypto.randomUUID();
		const startsAt = at(base, r.start);
		const endsAt = at(base, r.end);
		const bookedAt = stamp(addDays(base, Math.min(r.start[0], 0) - 3) + 'T09:00', offset);
		const cancelledAt = r.cancelled
			? stamp(addDays(base, Math.min(r.start[0], 0) - 1) + 'T12:00', offset)
			: null;
		const canceller = r.cancelled === 'admin' ? admin : p;
		statements.push(
			namedStatement(
				`INSERT INTO reservations (id, equipment_id, user_id, user_name, user_email, starts_at,
						ends_at, purpose, status, booked_by_id, booked_by_name, cancelled_at, cancelled_by_id,
						cancelled_by_name, created_at, updated_at)
					VALUES (:id, (SELECT id FROM equipment WHERE asset_tag = :tag), :userId, :userName,
						:userEmail, :startsAt, :endsAt, :purpose, :status, :userId, :userName, :cancelledAt,
						:cancelledById, :cancelledByName, :createdAt, :updatedAt)`,
				{
					id,
					tag: r.tag,
					userId: p.id,
					userName: p.name,
					userEmail: p.email,
					startsAt,
					endsAt,
					purpose: r.purpose,
					status: cancelledAt ? 'cancelled' : 'active',
					cancelledAt,
					cancelledById: cancelledAt ? canceller.id : null,
					cancelledByName: cancelledAt ? canceller.name : null,
					createdAt: bookedAt,
					updatedAt: cancelledAt ?? bookedAt,
				},
			),
			unguardedEventStatement({
				kind: 'reserve',
				equipment: { assetTag: r.tag },
				reservationId: id,
				subject: { id: p.id, name: p.name },
				actor: p,
				detail: { startsAt, endsAt, purpose: r.purpose },
				at: bookedAt,
			}),
		);
		if (cancelledAt) {
			statements.push(
				unguardedEventStatement({
					kind: 'cancel',
					equipment: { assetTag: r.tag },
					reservationId: id,
					subject: { id: p.id, name: p.name },
					actor: canceller,
					detail: { startsAt, endsAt },
					at: cancelledAt,
				}),
			);
		}
	}

	await db.batch(statements, 'write');
}
