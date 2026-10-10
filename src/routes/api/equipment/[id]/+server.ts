import { getClient } from '#lib/server/db/client.ts';
import { getEquipment, updateEquipment } from '#lib/server/domain/equipment.ts';
import { readEquipmentEdit } from '#lib/server/http/bodies.ts';
import { actorOf, handle, ok, readJson } from '#lib/server/http/handler.ts';
import { parseIdParam } from '#lib/server/http/validate.ts';
import type { RequestHandler } from './$types';

// One piece of equipment with its 7-day strip (everyone, narrowed to the viewer).
export const GET: RequestHandler = (event) =>
	handle(async () =>
		ok(await getEquipment(getClient(), actorOf(event), parseIdParam(event.params.id))),
	);

export const PATCH: RequestHandler = (event) =>
	handle(async () => {
		const { fields, version } = readEquipmentEdit(await readJson(event.request));
		return ok(
			await updateEquipment(
				getClient(),
				actorOf(event),
				parseIdParam(event.params.id),
				version,
				fields,
			),
		);
	});
