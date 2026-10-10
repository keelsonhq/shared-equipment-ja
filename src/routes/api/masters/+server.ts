import { getClient } from '#lib/server/db/client.ts';
import { handle, ok } from '#lib/server/http/handler.ts';
import { listMasters } from '#lib/server/domain/masters.ts';
import type { RequestHandler } from './$types';

// Equipment types and storage locations, for filters and dialogs (any signed-in user).
export const GET: RequestHandler = () => handle(async () => ok(await listMasters(getClient())));
