import { Checker } from '#lib/server/http/validate.ts';
import { MCP_LIST_LIMIT } from '#lib/limits.ts';

// Reading AI assistant (MCP) tool arguments. Nothing here is particular to this
// app (its names and records are in refs.ts). Same rules as the JSON API bodies
// (http/bodies.ts): problems are collected per argument and reported at once
// as `validation_failed` + `fields`, keyed by the argument names the model
// sent.
//
// The gateway checks the arguments against keelson.yaml's input schema, but
// calls that do not come through it (local preview, the tests) are not
// checked: a tool reads every argument with ToolArgs as if nothing had been.

/** A Checker with the argument shapes the tools use. */
export class ToolArgs extends Checker {
	/** List size (`limit`): MCP_LIST_LIMIT's default; a larger value than its max is capped. */
	limit(key = 'limit'): number {
		const value = this.body[key];
		if (value === undefined || value === null) {
			return MCP_LIST_LIMIT.default;
		}
		if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
			this.fail(key, 'invalid');
			return MCP_LIST_LIMIT.default;
		}
		return Math.min(value, MCP_LIST_LIMIT.max);
	}

	/** Optional list of allowed values; absent -> []. Duplicates are dropped. */
	values<T extends string>(key: string, allowed: readonly T[]): T[] {
		const value = this.body[key];
		if (value === undefined || value === null) {
			return [];
		}
		if (
			!Array.isArray(value) ||
			value.some((v) => typeof v !== 'string' || !(allowed as readonly string[]).includes(v))
		) {
			this.fail(key, 'invalid');
			return [];
		}
		return [...new Set(value as T[])];
	}
}

/** How names typed by people compare: width, case and spaces do not matter. */
export function normalizeName(value: string): string {
	return value.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}
