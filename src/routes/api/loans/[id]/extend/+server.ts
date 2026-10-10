import { getClient } from '#lib/server/db/client.ts';
import { extendLoan } from '#lib/server/domain/loans.ts';
import { readExtendInput } from '#lib/server/http/bodies.ts';
import { actorOf, handle, ok, readJson } from '#lib/server/http/handler.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) =>
	handle(async () => {
		const { dueAt } = readExtendInput(await readJson(event.request));
		return ok(await extendLoan(getClient(), actorOf(event), event.params.id, dueAt));
	});
