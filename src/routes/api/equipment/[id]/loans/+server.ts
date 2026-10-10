import { getClient } from '#lib/server/db/client.ts';
import { listEquipmentLoans } from '#lib/server/domain/loans.ts';
import { actorOf, handle, ok } from '#lib/server/http/handler.ts';
import { parseIdParam } from '#lib/server/http/validate.ts';
import type { RequestHandler } from './$types';

// The loan ledger: every loan for admins, one's own loans for members.
export const GET: RequestHandler = (event) =>
	handle(async () =>
		ok(await listEquipmentLoans(getClient(), actorOf(event), parseIdParam(event.params.id))),
	);
