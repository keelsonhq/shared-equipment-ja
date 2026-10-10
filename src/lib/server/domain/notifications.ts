import type { Client } from '@libsql/client';
import { reminderMessage } from '#lib/server/content.ts';
import { nowIso, nowLocal } from '#lib/server/dates.ts';
import { namedStatement } from '#lib/server/db/named.ts';
import { num, str, strOrNull } from '#lib/server/db/rows.ts';
import { failureCode, MAX_ATTEMPTS, type Sender, SENDING_LEASE_MS } from './notify.ts';

// Return reminders, sent by the cron job
// src/lib/server/jobs/return-reminder.ts once every morning:
//
// - `due_today`: an open loan due later today, to its borrower;
// - `overdue`: an open loan past its due time, to its borrower.
//
// Each reminder has a key (loan, kind, due date) with a UNIQUE index, so
// running the job twice (or "run now" in the console) never sends the same
// reminder twice, and moving the due date (an extension) makes a new key. A
// failed send is recorded with its code and tried again on the next run (up to
// MAX_ATTEMPTS). An overdue loan is reminded once per due date, not every day.
//
// The transport is the notification webhook (domain/notify.ts). Without it
// nothing is sent or recorded: the job only logs how many reminders it would
// have sent.
//
// This module is run by Node directly (no build step) from the cron job, so it
// and everything it imports must stay plain, erasable TypeScript: no enums,
// no namespaces, no parameter properties, no JSON imports, no $app/* imports.

export type ReminderKind = 'due_today' | 'overdue';

export interface ReminderResult {
	/** Loans that call for a reminder now. */
	due: number;
	sent: number;
	failed: number;
	/** Recorded without sending: the borrower has no email address. */
	skipped: number;
	/** Not configured: reminders that would have been sent (nothing recorded). */
	unsent: number;
}

interface Target {
	loanId: string;
	kind: ReminderKind;
	targetDate: string;
	email: string | null;
	name: string;
	equipmentId: number;
	assetTag: string;
	equipmentName: string;
	dueAt: string;
}

/** Open loans due later today or already overdue, at `now`. */
async function targets(db: Client, now: string): Promise<Target[]> {
	const res = await db.execute({
		sql: `SELECT o.id, o.user_name, o.user_email, o.due_at, o.equipment_id, e.asset_tag,
				e.name AS equipment_name
			FROM loans o JOIN equipment e ON e.id = o.equipment_id
			WHERE o.returned_at IS NULL AND (o.due_at < ? OR substr(o.due_at, 1, 10) = ?)
			ORDER BY o.due_at`,
		args: [now, now.slice(0, 10)],
	});
	return res.rows.map((r) => ({
		loanId: str(r, 'id'),
		kind: str(r, 'due_at') < now ? 'overdue' : 'due_today',
		targetDate: str(r, 'due_at').slice(0, 10),
		email: strOrNull(r, 'user_email'),
		name: str(r, 'user_name'),
		equipmentId: num(r, 'equipment_id'),
		assetTag: str(r, 'asset_tag'),
		equipmentName: str(r, 'equipment_name'),
		dueAt: str(r, 'due_at'),
	}));
}

/**
 * One run of the reminder job. `sender` null = not configured. `appUrl` (the
 * platform's KEELSON_APP_URL) adds a link to the equipment page.
 */
export async function runReturnReminders(
	db: Client,
	opts: { sender: Sender | null; appUrl?: string | null; now?: string },
): Promise<ReminderResult> {
	const now = opts.now ?? nowLocal();
	const list = await targets(db, now);
	const result: ReminderResult = { due: list.length, sent: 0, failed: 0, skipped: 0, unsent: 0 };
	if (!opts.sender) {
		// Count what has not gone out yet; record nothing, so configuring the
		// webhook later still sends what is due then.
		for (const t of list) {
			const done = await db.execute({
				sql: `SELECT 1 FROM notifications WHERE loan_id = ? AND kind = ? AND target_date = ?
					AND status IN ('sent', 'skipped')`,
				args: [t.loanId, t.kind, t.targetDate],
			});
			if (done.rows.length === 0) {
				result.unsent++;
			}
		}
		return result;
	}

	for (const t of list) {
		const ts = nowIso();
		// Claim the key once; a second run finds it and does not insert again.
		await db.execute(
			namedStatement(
				`INSERT INTO notifications (id, loan_id, kind, target_date, recipient_email, status,
					attempts, last_error, created_at, updated_at)
				VALUES (:id, :loanId, :kind, :targetDate, :email, :status, 0, :lastError, :ts, :ts)
				ON CONFLICT (loan_id, kind, target_date) DO NOTHING`,
				{
					id: crypto.randomUUID(),
					loanId: t.loanId,
					kind: t.kind,
					targetDate: t.targetDate,
					email: t.email,
					status: t.email ? 'pending' : 'skipped',
					lastError: t.email ? null : 'no_recipient',
					ts,
				},
			),
		);
		const row = (
			await db.execute({
				sql: `SELECT id, status, attempts, updated_at FROM notifications
					WHERE loan_id = ? AND kind = ? AND target_date = ?`,
				args: [t.loanId, t.kind, t.targetDate],
			})
		).rows[0];
		if (!row) {
			continue;
		}
		const status = str(row, 'status');
		const attempts = num(row, 'attempts');
		const stale =
			status === 'sending' &&
			str(row, 'updated_at') < new Date(Date.now() - SENDING_LEASE_MS).toISOString();
		if (status === 'skipped') {
			result.skipped++;
			continue;
		}
		if (!(status === 'pending' || status === 'failed' || stale) || attempts >= MAX_ATTEMPTS) {
			continue;
		}
		// Take it for this run (another run that got here first wins).
		const claim = await db.execute(
			namedStatement(
				`UPDATE notifications SET status = 'sending', attempts = attempts + 1, updated_at = :at
				WHERE id = :id AND status = :status AND attempts = :attempts`,
				{ at: nowIso(), id: str(row, 'id'), status, attempts },
			),
		);
		if (claim.rowsAffected === 0) {
			continue;
		}
		const message = reminderMessage({
			kind: t.kind,
			name: t.name,
			assetTag: t.assetTag,
			equipmentName: t.equipmentName,
			dueAt: t.dueAt,
			url: opts.appUrl ? `${opts.appUrl}/equipment/${t.equipmentId}` : null,
		});
		try {
			await opts.sender({ to: t.email as string, ...message });
			await db.execute({
				sql: `UPDATE notifications SET status = 'sent', sent_at = ?, last_error = NULL, updated_at = ?
					WHERE id = ?`,
				args: [nowIso(), nowIso(), str(row, 'id')],
			});
			result.sent++;
		} catch (err) {
			const code = failureCode(err);
			console.error(`[return-reminder] send failed (${t.kind} ${t.loanId}): ${code}`);
			await db.execute({
				sql: `UPDATE notifications SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?`,
				args: [code, nowIso(), str(row, 'id')],
			});
			result.failed++;
		}
	}
	return result;
}
