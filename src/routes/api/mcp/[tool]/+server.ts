import { requireAdmin } from '#lib/server/auth/guard.ts';
import { getClient } from '#lib/server/db/client.ts';
import { AppError, ErrorCode } from '#lib/server/errors.ts';
import { actorOf, handle, ok, readJson } from '#lib/server/http/handler.ts';
import { asBody } from '#lib/server/http/validate.ts';
import { MCP_TOOLS } from '#lib/server/mcp/registry.ts';
import type { RequestHandler } from './$types';

// One AI assistant tool call (keelson.yaml `mcp.tools`). The platform's MCP
// gateway sends POST /api/mcp/<tool> with the tool arguments as the JSON body
// and the caller's identity headers; in a deployed app nothing else reaches
// this path. A 4xx body (`{ "error", "fields", "candidates"? }`) is shown to
// the assistant as is, so it never carries more than the caller may see. The
// actor carries `source: 'mcp'` when the gateway marked the call
// (hooks.server.ts).
export const POST: RequestHandler = (event) => {
	const name = event.params.tool;
	// The user sees only the gateway's request id: it goes into the log line of
	// an unexpected failure, next to the tool.
	const requestId = event.request.headers.get('x-request-id') ?? '-';
	return handle(async () => {
		const tool = Object.hasOwn(MCP_TOOLS, name) ? MCP_TOOLS[name] : undefined;
		if (!tool) {
			throw new AppError(ErrorCode.McpToolNotFound);
		}
		const actor = actorOf(event);
		if (tool.permission === 'manage') {
			requireAdmin(actor);
		}
		const args = asBody(await readJson(event.request));
		return ok(await tool.run({ db: getClient(), actor, args }));
	}, `mcp ${name}, request id ${requestId}`);
};
