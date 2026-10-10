import { getClient } from '#lib/server/db/client.ts';
import { listUpcomingForEquipment } from '#lib/server/domain/reservations.ts';
import { actorOf, handle, ok } from '#lib/server/http/handler.ts';
import { parseIdParam } from '#lib/server/http/validate.ts';
import type { RequestHandler } from './$types';

// Bookings still to come or running now (everyone; purposes only one's own).
export const GET: RequestHandler = (event) =>
	handle(async () =>
		ok(await listUpcomingForEquipment(getClient(), actorOf(event), parseIdParam(event.params.id))),
	);
