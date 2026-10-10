import { CSV_FILE_PREFIX } from '#lib/server/content.ts';
import { today } from '#lib/server/dates.ts';
import { getClient } from '#lib/server/db/client.ts';
import { exportEquipment } from '#lib/server/domain/equipment.ts';
import { actorOf, handle } from '#lib/server/http/handler.ts';
import { parseEquipmentQuery } from '#lib/server/http/queries.ts';
import { equipmentToCsv } from '#lib/server/import/csv.ts';
import type { RequestHandler } from './$types';

// CSV of the ledger with the same filters as GET /api/equipment (no paging),
// or of the selected rows (`ids`). Admin.
export const GET: RequestHandler = (event) =>
	handle(async () => {
		const rows = await exportEquipment(
			getClient(),
			actorOf(event),
			parseEquipmentQuery(event.url.searchParams),
		);
		return new Response(equipmentToCsv(rows), {
			headers: {
				'content-type': 'text/csv; charset=utf-8',
				'content-disposition': `attachment; filename="${CSV_FILE_PREFIX}-${today()}.csv"`,
				'cache-control': 'no-store',
			},
		});
	});
