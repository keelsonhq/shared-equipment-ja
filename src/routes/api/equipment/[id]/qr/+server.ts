import { getClient } from '#lib/server/db/client.ts';
import { getEquipment } from '#lib/server/domain/equipment.ts';
import { equipmentQrSvg } from '#lib/server/domain/qr.ts';
import { appUrl } from '#lib/server/env.ts';
import { actorOf, handle } from '#lib/server/http/handler.ts';
import { parseIdParam } from '#lib/server/http/validate.ts';
import type { RequestHandler } from './$types';

// The QR code (SVG) of the equipment page: KEELSON_APP_URL when the platform
// injects it, else the origin of this request (local preview).
export const GET: RequestHandler = (event) =>
	handle(async () => {
		const id = parseIdParam(event.params.id);
		await getEquipment(getClient(), actorOf(event), id);
		const svg = await equipmentQrSvg(appUrl() ?? event.url.origin, id);
		return new Response(svg, {
			headers: {
				'content-type': 'image/svg+xml',
				'x-content-type-options': 'nosniff',
				'cache-control': 'private, no-store',
			},
		});
	});
