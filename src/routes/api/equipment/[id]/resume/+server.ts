import { getClient } from '#lib/server/db/client.ts';
import { resumeEquipment } from '#lib/server/domain/equipment.ts';
import { actorOf, handle, ok, requireJsonBody } from '#lib/server/http/handler.ts';
import { parseIdParam } from '#lib/server/http/validate.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) =>
	handle(async () => {
		await requireJsonBody(event.request);
		return ok(await resumeEquipment(getClient(), actorOf(event), parseIdParam(event.params.id)));
	});
