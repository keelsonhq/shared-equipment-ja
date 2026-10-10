import { getClient } from '#lib/server/db/client.ts';
import { createEquipment, listEquipment } from '#lib/server/domain/equipment.ts';
import { readEquipmentCreate } from '#lib/server/http/bodies.ts';
import { actorOf, handle, ok, readJson } from '#lib/server/http/handler.ts';
import { parseEquipmentQuery } from '#lib/server/http/queries.ts';
import type { RequestHandler } from './$types';

// The ledger (everyone; a member's rows carry the shared columns only).
export const GET: RequestHandler = (event) =>
	handle(async () =>
		ok(
			await listEquipment(getClient(), actorOf(event), parseEquipmentQuery(event.url.searchParams)),
		),
	);

export const POST: RequestHandler = (event) =>
	handle(async () => {
		const fields = readEquipmentCreate(await readJson(event.request));
		return ok(await createEquipment(getClient(), actorOf(event), fields), 201);
	});
