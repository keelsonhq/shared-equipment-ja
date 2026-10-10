import { getClient } from '#lib/server/db/client.ts';
import { lendEquipment } from '#lib/server/domain/loans.ts';
import { readLendInput } from '#lib/server/http/bodies.ts';
import { actorOf, handle, ok, readJson } from '#lib/server/http/handler.ts';
import type { RequestHandler } from './$types';

// Lend now: to oneself, or (admin, `userId`) to someone else.
export const POST: RequestHandler = (event) =>
	handle(async () => {
		const input = readLendInput(await readJson(event.request));
		return ok(await lendEquipment(getClient(), actorOf(event), input), 201);
	});
