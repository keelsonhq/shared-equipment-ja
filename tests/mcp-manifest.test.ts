import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vite-plus/test';
import { parse } from 'yaml';
import { MCP_LIST_LIMIT } from '#lib/limits.ts';
import { MCP_TOOLS } from '#lib/server/mcp/registry.ts';

// The AI assistant (MCP) tools as keelson.yaml declares them to the platform:
// the declarations agree with the registry (src/lib/server/mcp/registry.ts)
// and stay within the platform limits. What the tools do is tests/mcp.test.ts.

interface ToolDecl {
	name: string;
	description: string;
	input: {
		type: string;
		properties: Record<string, { description?: string; minimum?: number; maximum?: number }>;
		required?: string[];
	};
	access: string;
	permission?: string;
}

const manifest = parse(readFileSync(new URL('../keelson.yaml', import.meta.url), 'utf8')) as {
	mcp: { enabled: boolean; instructions: string; tools: ToolDecl[] };
};

describe('keelson.yaml mcp declaration', () => {
	const tools = manifest.mcp.tools;

	it('declares exactly the registry tools, with the same access and permission', () => {
		expect(manifest.mcp.enabled).toBe(true);
		expect(tools.map((t) => t.name).sort()).toEqual(Object.keys(MCP_TOOLS).sort());
		for (const t of tools) {
			expect(t.access, t.name).toBe(MCP_TOOLS[t.name].access);
			expect(t.permission ?? 'view', t.name).toBe(MCP_TOOLS[t.name].permission);
		}
	});

	it('stays within the gateway limits', () => {
		expect(tools.length).toBeGreaterThan(0);
		expect(tools.length).toBeLessThanOrEqual(40);
		expect(new Set(tools.map((t) => t.name)).size).toBe(tools.length);
		expect(manifest.mcp.instructions.length).toBeLessThanOrEqual(4096);
		for (const t of tools) {
			expect(t.name).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
			expect(t.description.length, t.name).toBeGreaterThan(0);
			expect(t.description.length, t.name).toBeLessThanOrEqual(1024);
			expect(t).not.toHaveProperty('endpoint');
			expect(JSON.stringify(t.input)).not.toContain('$ref');
			expect(JSON.stringify(t.input).length).toBeLessThanOrEqual(64 * 1024);
		}
	});

	it('keeps the human-language values on one line without quote characters', () => {
		// They are extracted for translation as quoted one-line strings.
		const texts = [
			manifest.mcp.instructions,
			...tools.flatMap((t) => [
				t.description,
				...Object.values(t.input.properties ?? {}).map((p) => p.description ?? ''),
			]),
		];
		for (const text of texts) {
			expect(text).not.toMatch(/[\n"'\\]/);
		}
	});

	it('gives every tool an object input whose required keys are declared and described', () => {
		for (const t of tools) {
			expect(t.input.type, t.name).toBe('object');
			const keys = Object.keys(t.input.properties ?? {});
			for (const key of t.input.required ?? []) {
				expect(keys, `${t.name}.${key}`).toContain(key);
			}
			for (const key of keys) {
				expect(typeof t.input.properties[key].description, `${t.name}.${key}`).toBe('string');
			}
		}
	});

	it('bounds every list size by the limit the tools enforce (src/lib/limits.ts)', () => {
		for (const t of tools) {
			const limit = t.input.properties?.limit;
			if (limit) {
				expect([limit.minimum, limit.maximum], `${t.name}.limit`).toEqual([1, MCP_LIST_LIMIT.max]);
			}
		}
	});
});
