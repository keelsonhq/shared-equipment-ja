import type { Client } from '@libsql/client';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { getHome } from '#lib/server/domain/home.ts';
import { extendLoan, lendEquipment, returnLoan } from '#lib/server/domain/loans.ts';
import { runReturnReminders } from '#lib/server/domain/notifications.ts';
import {
	MAX_ATTEMPTS,
	type OutgoingMessage,
	type Sender,
	SendError,
} from '#lib/server/domain/notify.ts';
import { ADMIN, cleanupDbs, freshDb, MEMBER, tempDbUrl } from './support/harness.ts';
import { addEquipment, day, lendInput, slot } from './support/helpers.ts';
import { runJob, webhookReceiver } from './support/job.ts';

// Return reminders: one per (loan, kind, due date),
// never twice, a new one when the due date moves, failures retried.

afterEach(cleanupDbs);

/** A sender that records what it sends; the first `fail` sends throw. */
function recorder(fail = 0): Sender & { sent: OutgoingMessage[]; calls: number } {
	const send = (async (message: OutgoingMessage) => {
		send.calls++;
		if (send.calls <= fail) {
			throw new SendError('webhook_status_502');
		}
		send.sent.push(message);
	}) as Sender & { sent: OutgoingMessage[]; calls: number };
	send.sent = [];
	send.calls = 0;
	return send;
}

async function lendDue(db: Client, tag: string, dueAt: string) {
	const id = await addEquipment(db, tag);
	return lendEquipment(db, MEMBER, lendInput(id, dueAt));
}

async function rows(db: Client) {
	const res = await db.execute(
		'SELECT kind, target_date, status, attempts FROM notifications ORDER BY created_at, kind',
	);
	return res.rows.map((r) => ({ ...r }));
}

async function lastErrors(db: Client) {
	const res = await db.execute(
		`SELECT last_error FROM notifications WHERE status = 'failed' ORDER BY created_at`,
	);
	return res.rows.map((r) => r.last_error);
}

describe('return reminders', () => {
	it('reminds a loan due today once, however often the job runs', async () => {
		const db = await freshDb();
		await lendDue(db, 'SP-1', day(1, '18:00'));
		const sender = recorder();
		const morning = day(1, '09:00');
		const first = await runReturnReminders(db, {
			sender,
			now: morning,
			appUrl: 'https://app.test',
		});
		const second = await runReturnReminders(db, { sender, now: morning });
		const later = await runReturnReminders(db, { sender, now: day(1, '12:00') });
		expect([first.sent, second.sent, later.sent]).toEqual([1, 0, 0]);
		expect(sender.sent).toHaveLength(1);
		expect(sender.sent[0].to).toBe(MEMBER.email);
		expect(sender.sent[0].text).toContain('https://app.test/equipment/');
		expect(await rows(db)).toEqual([
			{ kind: 'due_today', target_date: day(1, '00:00').slice(0, 10), status: 'sent', attempts: 1 },
		]);
	});

	it('reminds an overdue loan once per due date, and again after the due date moves', async () => {
		const db = await freshDb();
		const loan = await lendDue(db, 'SP-2', day(1, '18:00'));
		const sender = recorder();
		await runReturnReminders(db, { sender, now: day(2, '09:00') });
		await runReturnReminders(db, { sender, now: day(3, '09:00') });
		expect(sender.sent.map((m) => m.subject.length > 0)).toEqual([true]);
		// Extended to a new due date (which then passes): a new reminder.
		await db.execute({
			sql: 'UPDATE loans SET due_at = ? WHERE id = ?',
			args: [day(4, '18:00'), loan.id],
		});
		await runReturnReminders(db, { sender, now: day(4, '09:00') });
		await runReturnReminders(db, { sender, now: day(5, '09:00') });
		expect((await rows(db)).map((r) => [r.kind, r.status])).toEqual([
			['overdue', 'sent'],
			['due_today', 'sent'],
			['overdue', 'sent'],
		]);
		expect(sender.sent).toHaveLength(3);
	});

	it('records a failed send and tries it again on the next run, up to a limit', async () => {
		const db = await freshDb();
		const first3 = await lendDue(db, 'SP-3', day(1, '18:00'));
		const flaky = recorder(1);
		const run1 = await runReturnReminders(db, { sender: flaky, now: day(1, '09:00') });
		expect(run1).toMatchObject({ sent: 0, failed: 1 });
		expect((await rows(db))[0]).toMatchObject({ status: 'failed', attempts: 1 });
		expect(await lastErrors(db)).toEqual(['webhook_status_502']);
		const run2 = await runReturnReminders(db, { sender: flaky, now: day(1, '09:30') });
		expect(run2).toMatchObject({ sent: 1, failed: 0 });
		expect(flaky.sent).toHaveLength(1);

		await returnLoan(db, MEMBER, first3.id, { note: null, locationId: null, suspend: null });
		await lendDue(db, 'SP-4', day(2, '18:00'));
		const broken = recorder(Number.POSITIVE_INFINITY);
		for (let i = 0; i < MAX_ATTEMPTS + 2; i++) {
			await runReturnReminders(db, { sender: broken, now: day(2, '09:00') });
		}
		expect(broken.calls).toBe(MAX_ATTEMPTS);
		// Anything but a SendError is kept as a code too, never as its message.
		await lendDue(db, 'SP-4b', day(2, '18:00'));
		await runReturnReminders(db, {
			sender: async () => {
				throw new Error('relay down at https://relay.example.com');
			},
			now: day(2, '09:00'),
		});
		expect(await lastErrors(db)).toContain('send_failed');
	});

	it('sends and records nothing without a webhook, only counts', async () => {
		const db = await freshDb();
		await lendDue(db, 'SP-5', day(1, '18:00'));
		await lendDue(db, 'SP-6', day(1, '10:00'));
		const result = await runReturnReminders(db, { sender: null, now: day(1, '12:00') });
		expect(result).toMatchObject({ due: 2, unsent: 2, sent: 0 });
		expect(await rows(db)).toEqual([]);
	});

	it('skips a borrower without an email address, and returned loans', async () => {
		const db = await freshDb();
		const id = await addEquipment(db, 'SP-7');
		await lendEquipment(
			db,
			{ ...MEMBER, id: 'u-nomail', email: null },
			{
				equipmentId: id,
				userId: null,
				dueAt: day(1, '18:00'),
				note: null,
				reservationId: null,
			},
		);
		const back = await lendDue(db, 'SP-8', day(1, '18:00'));
		await returnLoan(db, MEMBER, back.id, { note: null, locationId: null, suspend: null });
		const sender = recorder();
		const result = await runReturnReminders(db, { sender, now: day(1, '09:00') });
		expect(result).toMatchObject({ due: 1, sent: 0, skipped: 1 });
		expect(sender.calls).toBe(0);
	});

	it('shows on the home screen whether the reminder went out', async () => {
		const db = await freshDb();
		const loan = await lendDue(db, 'SP-9', slot(4));
		expect((await extendLoan(db, MEMBER, loan.id, slot(8))).dueAt).toBe(slot(8));
		await db.execute({
			sql: 'UPDATE loans SET due_at = ? WHERE id = ?',
			args: [slot(-2), loan.id],
		});
		await runReturnReminders(db, { sender: recorder() });
		const home = await getHome(db, ADMIN);
		expect(home.attention.rows[0]).toMatchObject({ kind: 'overdue', notice: 'sent' });
		expect(home.notify.configured).toBe(false);
	});
});

describe('the return-reminder job', () => {
	const JOB = 'src/lib/server/jobs/return-reminder.ts';

	/** A database with one overdue loan, and the job's env for it. */
	async function overdueLoan() {
		const url = tempDbUrl();
		const db = await freshDb({ url });
		const loan = await lendDue(db, 'SP-10', day(1, '18:00'));
		await db.execute({
			sql: 'UPDATE loans SET due_at = ? WHERE id = ?',
			args: [day(-1, '18:00'), loan.id],
		});
		const notified = async () =>
			(
				await db.execute('SELECT status, attempts, last_error, recipient_email FROM notifications')
			).rows.map((r) => ({ ...r }));
		return { env: { LOCAL_DB_URL: url }, notified };
	}

	it('runs under plain Node and exits 0 without a webhook, sending nothing', async () => {
		const { env, notified } = await overdueLoan();
		const run = await runJob(JOB, env);
		expect(run.stderr).not.toMatch(/Error/);
		expect(run.code).toBe(0);
		expect(run.stdout).toContain(
			'NOTIFY_WEBHOOK_URL is not set; 1 reminder(s) would have been sent',
		);
		expect(await notified()).toEqual([]);
	}, 30_000);

	it('posts the reminder to the webhook and exits 0', async () => {
		const { env, notified } = await overdueLoan();
		const receiver = await webhookReceiver(200);
		try {
			const run = await runJob(JOB, {
				...env,
				NOTIFY_WEBHOOK_URL: receiver.url,
				NOTIFY_WEBHOOK_TOKEN: 'secret-token',
			});
			expect(run.code).toBe(0);
			expect(run.stdout).toContain('sent 1, failed 0');
			expect(receiver.received).toEqual([
				{
					authorization: 'Bearer secret-token',
					contentType: 'application/json',
					body: { to: MEMBER.email, subject: expect.any(String), text: expect.any(String) },
				},
			]);
			expect(await notified()).toEqual([
				{ status: 'sent', attempts: 1, last_error: null, recipient_email: MEMBER.email },
			]);
		} finally {
			await receiver.close();
		}
	}, 30_000);

	it('records webhook_status_<N> and exits 1 when the webhook answers an error', async () => {
		const { env, notified } = await overdueLoan();
		const receiver = await webhookReceiver(500);
		try {
			const run = await runJob(JOB, { ...env, NOTIFY_WEBHOOK_URL: receiver.url });
			expect(run.code).toBe(1);
			expect(receiver.received).toHaveLength(1);
			expect(await notified()).toMatchObject([
				{ status: 'failed', attempts: 1, last_error: 'webhook_status_500' },
			]);
		} finally {
			await receiver.close();
		}
	}, 30_000);

	it('records webhook_unreachable and exits 1 when nothing listens', async () => {
		const { env, notified } = await overdueLoan();
		const receiver = await webhookReceiver(200);
		await receiver.close();
		const run = await runJob(JOB, { ...env, NOTIFY_WEBHOOK_URL: receiver.url });
		expect(run.code).toBe(1);
		expect(await notified()).toMatchObject([
			{ status: 'failed', attempts: 1, last_error: 'webhook_unreachable' },
		]);
	}, 30_000);
});
