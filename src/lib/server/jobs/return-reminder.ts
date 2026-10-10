import { closeClient, getClient } from '#lib/server/db/client.ts';
import { migrate } from '#lib/server/db/migrate.ts';
import { runReturnReminders } from '#lib/server/domain/notifications.ts';
import { webhookSender } from '#lib/server/domain/notify.ts';
import { appUrl, notifyWebhook } from '#lib/server/env.ts';

// Scheduled job `return-reminder` (keelson.yaml crons, every morning): remind
// borrowers of loans due today and of overdue loans.
//
// Runs in its own container, separate from the web service, and reaches the
// same database (db.mode: libsql). Node runs this file directly (TypeScript
// type stripping, no build step): `node src/lib/server/jobs/return-reminder.ts`.
// Locally it uses ./local.db (or LOCAL_DB_URL), like the app.
//
// Without NOTIFY_WEBHOOK_URL nothing is sent: the job logs how many reminders
// are due and exits 0. A failed send is logged, recorded and tried again on
// the next run (domain/notify.ts); the run then exits 1, so it shows as failed
// in the console's run history.
async function main(): Promise<boolean> {
	const db = getClient();
	try {
		await migrate(db);
		const webhook = notifyWebhook();
		const result = await runReturnReminders(db, {
			sender: webhook ? webhookSender(webhook) : null,
			appUrl: appUrl() ?? null,
		});
		if (!webhook) {
			console.log(
				`return-reminder: NOTIFY_WEBHOOK_URL is not set; ${result.unsent} reminder(s) would have been sent (${result.due} loan(s) due today or overdue)`,
			);
		} else {
			console.log(
				`return-reminder: ${result.due} loan(s) due today or overdue; sent ${result.sent}, failed ${result.failed}, no address ${result.skipped}`,
			);
		}
		return result.failed === 0;
	} finally {
		closeClient();
	}
}

main().then(
	(ok) => {
		if (!ok) {
			process.exitCode = 1;
		}
	},
	(err: unknown) => {
		console.error('return-reminder: failed', err);
		process.exitCode = 1;
	},
);
