import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

// Running a cron job the way the platform does (`node <file>`: type stripping,
// no build step), and a local stand-in for the notification webhook.

export interface JobRun {
	/** The exit code (null when killed). */
	code: number | null;
	stdout: string;
	stderr: string;
}

/** Run `node <file>` (relative to the template) with only `env` plus PATH. */
export function runJob(file: string, env: Record<string, string>): Promise<JobRun> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [join(process.cwd(), file)], {
			cwd: process.cwd(),
			env: { PATH: process.env.PATH ?? '', ...env },
			timeout: 30_000,
		});
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr.on('data', (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.on('error', reject);
		child.on('close', (code) => resolve({ code, stdout, stderr }));
	});
}

export interface ReceivedPost {
	authorization: string | undefined;
	contentType: string | undefined;
	body: unknown;
}

/**
 * A local webhook on 127.0.0.1 that answers every POST with `status`, or never
 * answers (`'no-answer'`). Keeps what it received.
 */
export async function webhookReceiver(status: number | 'no-answer') {
	const received: ReceivedPost[] = [];
	const server = createServer((req, res) => {
		let data = '';
		req.on('data', (chunk: Buffer) => {
			data += chunk.toString();
		});
		req.on('end', () => {
			received.push({
				authorization: req.headers.authorization,
				contentType: req.headers['content-type'],
				body: JSON.parse(data),
			});
			if (status !== 'no-answer') {
				res.writeHead(status).end();
			}
		});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const { port } = server.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${port}/hook`,
		received,
		close: () =>
			new Promise<void>((resolve) => {
				server.closeAllConnections();
				server.close(() => resolve());
			}),
	};
}
