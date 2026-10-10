import { getClient } from '#lib/server/db/client.ts';
import { getMyPage } from '#lib/server/domain/me.ts';
import { actorOf, handle, ok } from '#lib/server/http/handler.ts';
import type { RequestHandler } from './$types';

// The caller's own loans, bookings and history. Available to every signed-in user.
export const GET: RequestHandler = (event) =>
	handle(async () => ok(await getMyPage(getClient(), actorOf(event))));
