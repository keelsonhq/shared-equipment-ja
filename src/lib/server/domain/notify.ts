// The notification webhook: the one way this app sends a message out.
//
// One endpoint outside the app (NOTIFY_WEBHOOK_URL, server/env.ts) takes
// `POST` JSON `{ "to", "subject", "text" }` and relays it as mail. The
// optional NOTIFY_WEBHOOK_TOKEN goes in `Authorization: Bearer`. One request
// per message; callers send them one at a time.
//
// This file is the transport and the retry rules only. What is sent, to whom
// and when is in domain/notifications.ts, which records each notification in
// the `notifications` table:
// - a failed send throws a SendError whose stable code is kept in
//   `last_error`: `webhook_unreachable` (network error, or no answer within
//   SEND_TIMEOUT_MS) or `webhook_status_<N>` (an answer other than 2xx). The
//   webhook's own wording is never kept;
// - a notification is tried at most MAX_ATTEMPTS times;
// - one left half-sent (the job stopped mid-way) is taken again after
//   SENDING_LEASE_MS.
//
// The cron job runs this file with Node's type stripping (no build step): keep
// it erasable TypeScript (no enums, namespaces or parameter properties) with
// no imports.

/** One message to one recipient. */
export interface OutgoingMessage {
	to: string;
	subject: string;
	text: string;
}

/** Delivers one message; throws when it fails (the webhook: a SendError). */
export type Sender = (message: OutgoingMessage) => Promise<void>;

/** A notification is given up after this many failed sends. */
export const MAX_ATTEMPTS = 5;

/** A send that never reported back (the job stopped mid-way) is retried after this long. */
export const SENDING_LEASE_MS = 15 * 60_000;

/** How long to wait for the webhook to answer. */
const SEND_TIMEOUT_MS = 15_000;

/** A failed send, with the stable code kept in `notifications.last_error`. */
export class SendError extends Error {
	readonly code: string;

	constructor(code: string) {
		super(code);
		this.name = 'SendError';
		this.code = code;
	}
}

/** Sends through the webhook from env.ts `notifyWebhook()`. */
export function webhookSender(config: { url: string; token?: string }): Sender {
	return async (message) => {
		let res: Response;
		try {
			res = await fetch(config.url, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					...(config.token ? { authorization: `Bearer ${config.token}` } : {}),
				},
				body: JSON.stringify({ to: message.to, subject: message.subject, text: message.text }),
				signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
			});
		} catch {
			throw new SendError('webhook_unreachable');
		}
		if (!res.ok) {
			throw new SendError(`webhook_status_${res.status}`);
		}
	};
}

/** The code to keep in `last_error` for a failed send: a SendError's code, else `send_failed`. */
export function failureCode(err: unknown): string {
	return err instanceof SendError ? err.code : 'send_failed';
}
