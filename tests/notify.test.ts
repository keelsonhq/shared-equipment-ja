import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { failureCode, SendError, webhookSender } from '#lib/server/domain/notify.ts';
import { webhookReceiver } from './support/job.ts';

// The notification webhook (domain/notify.ts): what goes over the wire, and
// the stable codes a failed send leaves in `notifications.last_error`.

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

const HOOK = 'https://relay.example.com/hook';
const MESSAGE = { to: 'a@example.com', subject: 'Subject', text: 'Body' };

function stubFetch(answer: () => Promise<Response>) {
	const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => answer());
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

/** The code of the SendError a send throws. */
async function codeOf(send: Promise<void>): Promise<string> {
	const err = await send.then(
		() => null,
		(e: unknown) => e,
	);
	expect(err).toBeInstanceOf(SendError);
	return (err as SendError).code;
}

describe('webhookSender', () => {
	it('posts { to, subject, text } as JSON with the bearer token, waiting 15 s at most', async () => {
		const timeout = vi.spyOn(AbortSignal, 'timeout');
		const fetchMock = stubFetch(async () => new Response(null, { status: 204 }));
		const send = webhookSender({ url: HOOK, token: 'secret-token' });
		await send({ ...MESSAGE, extra: 'not sent' } as typeof MESSAGE);
		await send({ ...MESSAGE, to: 'b@example.com' });

		expect(fetchMock).toHaveBeenCalledTimes(2);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe(HOOK);
		expect(init.method).toBe('POST');
		expect(init.headers).toEqual({
			'content-type': 'application/json',
			authorization: 'Bearer secret-token',
		});
		expect(JSON.parse(init.body as string)).toEqual(MESSAGE);
		expect(JSON.parse(fetchMock.mock.calls[1][1].body as string).to).toBe('b@example.com');
		expect(timeout).toHaveBeenCalledWith(15_000);
		expect(init.signal).toBeInstanceOf(AbortSignal);
	});

	it('sends no authorization header without a token', async () => {
		const fetchMock = stubFetch(async () => new Response('{}', { status: 200 }));
		await webhookSender({ url: HOOK })(MESSAGE);
		expect(fetchMock.mock.calls[0][1].headers).toEqual({ 'content-type': 'application/json' });
	});

	it('turns an answer other than 2xx into webhook_status_<N>', async () => {
		for (const status of [400, 401, 404, 500, 503]) {
			stubFetch(async () => new Response('relay says no', { status }));
			expect(await codeOf(webhookSender({ url: HOOK })(MESSAGE))).toBe(`webhook_status_${status}`);
		}
	});

	it('turns a network error into webhook_unreachable', async () => {
		stubFetch(async () => {
			throw new TypeError('fetch failed');
		});
		expect(await codeOf(webhookSender({ url: HOOK })(MESSAGE))).toBe('webhook_unreachable');
	});

	it('gives up on a webhook that does not answer in time: webhook_unreachable', async () => {
		const timeout = AbortSignal.timeout.bind(AbortSignal);
		vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => timeout(100));
		const receiver = await webhookReceiver('no-answer');
		try {
			const started = Date.now();
			expect(await codeOf(webhookSender({ url: receiver.url })(MESSAGE))).toBe(
				'webhook_unreachable',
			);
			expect(Date.now() - started).toBeLessThan(5_000);
			expect(receiver.received).toHaveLength(1);
		} finally {
			await receiver.close();
		}
	});

	it('keeps the code of a SendError, and send_failed for anything else', () => {
		expect(failureCode(new SendError('webhook_status_502'))).toBe('webhook_status_502');
		expect(failureCode(new Error('relay down: see https://relay.example.com'))).toBe('send_failed');
		expect(failureCode('boom')).toBe('send_failed');
	});
});
