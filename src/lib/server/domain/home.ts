import type { Client, Row } from '@libsql/client';
import type { Actor } from '#lib/server/auth/actor.ts';
import { requireAdmin } from '#lib/server/auth/guard.ts';
import { addMinutes, nowLocal } from '#lib/server/dates.ts';
import { namedStatement } from '#lib/server/db/named.ts';
import { num, str, strOrNull } from '#lib/server/db/rows.ts';
import { notifyWebhook } from '#lib/server/env.ts';
import { EQUIPMENT_FROM_SQL, STATUS_PREDICATE, type SuspendReason } from './equipment.ts';
import { type EventView, recentEvents } from './events.ts';
import {
	imageUrlOf,
	type Membership,
	membershipOf,
	type PeopleIndex,
	peopleIndex,
} from './directory.ts';

// The admin home screen (DESIGN.md §9-L): today's figures, what needs
// action, today's returns and bookings, and the latest history, in one
// request. Works without notifications: the due list is always here.

/** Hours ahead in which a booking counts as "coming up" for an open loan. */
const COMING_UP_HOURS = 24;

export interface HomeCounts {
	/** Open loans due later today. */
	dueToday: number;
	/** Open loans past their due time. */
	overdue: number;
	/** Bookings (active or picked up) that start today. */
	reservationsToday: number;
	/** Equipment free right now (not suspended, not out, nobody's booking running). */
	availableNow: number;
}

export type AttentionKind = 'overdue' | 'due_soon' | 'suspended';

export interface AttentionRow {
	kind: AttentionKind;
	equipmentId: number;
	assetTag: string;
	equipmentName: string;
	suspendedReason: SuspendReason | null;
	suspendedNote: string | null;
	/**
	 * The open loan (overdue / due soon rows). `imageUrl` and `membership`:
	 * see `withLoanDirectoryInfo`.
	 */
	loan: {
		id: string;
		userId: string;
		name: string;
		imageUrl: string | null;
		membership: Membership;
		lentAt: string;
		dueAt: string;
	} | null;
	/** The next booking of someone other than the borrower. */
	next: { name: string; startsAt: string } | null;
	/** Active bookings still to come (suspended equipment: who is affected). */
	bookings: number;
	/** The latest return reminder for this loan. */
	notice: 'sent' | 'failed' | null;
}

export interface TodayRow {
	kind: 'return' | 'reservation';
	/** Due time (returns) or start time (bookings). */
	at: string;
	endsAt: string | null;
	lentAt: string | null;
	equipmentId: number;
	assetTag: string;
	equipmentName: string;
	/**
	 * The borrower (returns) or the booker (bookings). `imageUrl` and
	 * `membership`: see `withTodayDirectoryInfo`.
	 */
	userId: string;
	name: string;
	imageUrl: string | null;
	membership: Membership;
	loanId: string | null;
	overdue: boolean;
	status: 'active' | 'fulfilled' | null;
}

export interface HomeData {
	now: string;
	counts: HomeCounts;
	attention: AttentionList;
	today: TodayRow[];
	recent: EventView[];
	/** Whether the reminder webhook is set (else reminders are not sent). */
	notify: { configured: boolean };
}

export async function getHome(db: Client, actor: Actor): Promise<HomeData> {
	requireAdmin(actor);
	const now = nowLocal();
	const [index, counts, attention, today, recent] = await Promise.all([
		peopleIndex(),
		homeCounts(db, now),
		attentionRows(db, now, 10),
		todayRows(db, now),
		recentEvents(db, 10),
	]);
	return {
		now,
		counts,
		attention: { rows: withLoanDirectoryInfo(index, attention.rows), total: attention.total },
		today: withTodayDirectoryInfo(index, today),
		recent,
		notify: { configured: notifyWebhook() !== null },
	};
}

/**
 * Rows with each borrower's current profile image and membership looked up in
 * the people index.
 */
function withLoanDirectoryInfo(index: PeopleIndex, rows: AttentionRow[]): AttentionRow[] {
	return rows.map((r) =>
		r.loan
			? {
					...r,
					loan: {
						...r.loan,
						imageUrl: imageUrlOf(index, r.loan.userId),
						membership: membershipOf(index, r.loan.userId),
					},
				}
			: r,
	);
}

/**
 * Rows with each person's current profile image and membership looked up in
 * the people index.
 */
function withTodayDirectoryInfo(index: PeopleIndex, rows: TodayRow[]): TodayRow[] {
	return rows.map((r) => ({
		...r,
		imageUrl: imageUrlOf(index, r.userId),
		membership: membershipOf(index, r.userId),
	}));
}

async function homeCounts(db: Client, now: string): Promise<HomeCounts> {
	const res = await db.execute(
		namedStatement(
			`SELECT
				(SELECT COUNT(*) FROM loans WHERE returned_at IS NULL AND due_at >= :now
					AND substr(due_at, 1, 10) = :today) AS due_today,
				(SELECT COUNT(*) FROM loans WHERE returned_at IS NULL AND due_at < :now) AS overdue,
				(SELECT COUNT(*) FROM reservations WHERE status IN ('active', 'fulfilled')
					AND substr(starts_at, 1, 10) = :today) AS reservations_today,
				(SELECT COUNT(*) ${EQUIPMENT_FROM_SQL} WHERE ${STATUS_PREDICATE.available}) AS available_now`,
			{ now, today: now.slice(0, 10) },
		),
	);
	const r = res.rows[0];
	return {
		dueToday: num(r, 'due_today'),
		overdue: num(r, 'overdue'),
		reservationsToday: num(r, 'reservations_today'),
		availableNow: num(r, 'available_now'),
	};
}

// The next booking of someone other than the borrower, as two columns.
const NEXT_SQL = (field: 'starts_at' | 'user_name') => `(SELECT r.${field} FROM reservations r
	WHERE r.equipment_id = o.equipment_id AND r.status = 'active' AND r.user_id != o.user_id
		AND r.ends_at > :now ORDER BY r.starts_at LIMIT 1)`;

const NOTICE_SQL = `(SELECT n.status FROM notifications n WHERE n.loan_id = o.id
	ORDER BY n.updated_at DESC LIMIT 1)`;

function loanRow(kind: AttentionKind, r: Row): AttentionRow {
	const nextStart = strOrNull(r, 'next_start');
	const notice = strOrNull(r, 'notice');
	return {
		kind,
		equipmentId: num(r, 'equipment_id'),
		assetTag: str(r, 'asset_tag'),
		equipmentName: str(r, 'equipment_name'),
		suspendedReason: strOrNull(r, 'suspended_reason') as SuspendReason | null,
		suspendedNote: null,
		loan: {
			id: str(r, 'id'),
			userId: str(r, 'user_id'),
			name: str(r, 'user_name'),
			imageUrl: null,
			membership: 'unknown',
			lentAt: str(r, 'lent_at'),
			dueAt: str(r, 'due_at'),
		},
		next: nextStart ? { name: str(r, 'next_name'), startsAt: nextStart } : null,
		bookings: 0,
		notice: notice === 'sent' || notice === 'failed' ? notice : null,
	};
}

/** Rows that need action: the first rows and how many there are in all. */
export interface AttentionList {
	rows: AttentionRow[];
	total: number;
}

/**
 * What needs action, in this order: overdue loans (longest overdue first),
 * open loans with someone else's booking coming up within COMING_UP_HOURS
 * (soonest first), suspended equipment (with how many bookings it still has).
 * At most `limit` rows, plus the total.
 */
async function attentionRows(db: Client, now: string, limit: number): Promise<AttentionList> {
	const loanSql = `SELECT o.*, e.asset_tag, e.name AS equipment_name, e.suspended_reason,
		${NEXT_SQL('starts_at')} AS next_start, ${NEXT_SQL('user_name')} AS next_name,
		${NOTICE_SQL} AS notice
		FROM loans o JOIN equipment e ON e.id = o.equipment_id
		WHERE o.returned_at IS NULL`;
	const [overdue, open, suspended] = await Promise.all([
		db.execute(namedStatement(`${loanSql} AND o.due_at < :now ORDER BY o.due_at`, { now })),
		db.execute(namedStatement(`${loanSql} AND o.due_at >= :now ORDER BY o.due_at`, { now })),
		db.execute(
			namedStatement(
				`SELECT e.id, e.asset_tag, e.name, e.suspended_reason, e.suspended_note,
					(SELECT COUNT(*) FROM reservations r WHERE r.equipment_id = e.id
						AND r.status = 'active' AND r.ends_at > :now) AS bookings
				FROM equipment e WHERE e.suspended_reason IS NOT NULL
				ORDER BY bookings DESC, e.asset_tag`,
				{ now },
			),
		),
	]);
	const comingUp = addMinutes(now, COMING_UP_HOURS * 60);
	const rows: AttentionRow[] = [
		...overdue.rows.map((r) => loanRow('overdue', r)),
		...open.rows
			.map((r) => loanRow('due_soon', r))
			.filter((r) => r.next !== null && r.next.startsAt < comingUp)
			.sort((a, b) => (a.next?.startsAt ?? '').localeCompare(b.next?.startsAt ?? '')),
		...suspended.rows.map((r): AttentionRow => ({
			kind: 'suspended',
			equipmentId: num(r, 'id'),
			assetTag: str(r, 'asset_tag'),
			equipmentName: str(r, 'name'),
			suspendedReason: strOrNull(r, 'suspended_reason') as SuspendReason | null,
			suspendedNote: strOrNull(r, 'suspended_note'),
			loan: null,
			next: null,
			bookings: num(r, 'bookings'),
			notice: null,
		})),
	];
	return { rows: rows.slice(0, limit), total: rows.length };
}

/** Today's returns (open loans due today) and bookings starting today, by time. */
async function todayRows(db: Client, now: string): Promise<TodayRow[]> {
	const today = now.slice(0, 10);
	const [returns, bookings] = await Promise.all([
		db.execute({
			sql: `SELECT o.id, o.equipment_id, o.user_id, o.user_name, o.lent_at, o.due_at, e.asset_tag,
					e.name AS equipment_name
				FROM loans o JOIN equipment e ON e.id = o.equipment_id
				WHERE o.returned_at IS NULL AND substr(o.due_at, 1, 10) = ?`,
			args: [today],
		}),
		db.execute({
			sql: `SELECT r.equipment_id, r.user_id, r.user_name, r.starts_at, r.ends_at, r.status,
					r.loan_id,
					e.asset_tag, e.name AS equipment_name
				FROM reservations r JOIN equipment e ON e.id = r.equipment_id
				WHERE r.status IN ('active', 'fulfilled') AND substr(r.starts_at, 1, 10) = ?`,
			args: [today],
		}),
	]);
	const rows: TodayRow[] = [
		...returns.rows.map((r): TodayRow => ({
			kind: 'return',
			at: str(r, 'due_at'),
			endsAt: null,
			lentAt: str(r, 'lent_at'),
			equipmentId: num(r, 'equipment_id'),
			assetTag: str(r, 'asset_tag'),
			equipmentName: str(r, 'equipment_name'),
			userId: str(r, 'user_id'),
			name: str(r, 'user_name'),
			imageUrl: null,
			membership: 'unknown',
			loanId: str(r, 'id'),
			overdue: str(r, 'due_at') < now,
			status: null,
		})),
		...bookings.rows.map((r): TodayRow => ({
			kind: 'reservation',
			at: str(r, 'starts_at'),
			endsAt: str(r, 'ends_at'),
			lentAt: null,
			equipmentId: num(r, 'equipment_id'),
			assetTag: str(r, 'asset_tag'),
			equipmentName: str(r, 'equipment_name'),
			userId: str(r, 'user_id'),
			name: str(r, 'user_name'),
			imageUrl: null,
			membership: 'unknown',
			loanId: strOrNull(r, 'loan_id'),
			overdue: false,
			status: str(r, 'status') as 'active' | 'fulfilled',
		})),
	];
	return rows.sort((a, b) => a.at.localeCompare(b.at) || a.assetTag.localeCompare(b.assetTag));
}
