import { getClient } from '#lib/server/db/client.ts';
import { cancelReservation } from '#lib/server/domain/reservations.ts';
import { actorOf, handle, ok, requireJsonBody } from '#lib/server/http/handler.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) =>
	handle(async () => {
		await requireJsonBody(event.request);
		return ok(await cancelReservation(getClient(), actorOf(event), event.params.id));
	});
