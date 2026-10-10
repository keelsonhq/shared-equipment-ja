import { getClient } from '#lib/server/db/client.ts';
import { createReservation, listReservations } from '#lib/server/domain/reservations.ts';
import { readReservationInput } from '#lib/server/http/bodies.ts';
import { actorOf, handle, ok, readJson } from '#lib/server/http/handler.ts';
import { parseReservationQuery } from '#lib/server/http/queries.ts';
import type { RequestHandler } from './$types';

// `scope=mine` (default): the caller's bookings; `scope=all`: everyone's (admin).
export const GET: RequestHandler = (event) =>
	handle(async () =>
		ok(
			await listReservations(
				getClient(),
				actorOf(event),
				parseReservationQuery(event.url.searchParams),
			),
		),
	);

// Book for oneself, or (admin, `userId`) for someone else.
export const POST: RequestHandler = (event) =>
	handle(async () => {
		const input = readReservationInput(await readJson(event.request));
		return ok(await createReservation(getClient(), actorOf(event), input), 201);
	});
