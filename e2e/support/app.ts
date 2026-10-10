import type { APIRequestContext } from '@playwright/test';
import type { Session } from '../../src/lib/server/auth/session.ts';
import type { EquipmentView } from '../../src/lib/server/domain/equipment.ts';
import type { LoanView } from '../../src/lib/server/domain/loans.ts';
import type { MasterEntry } from '../../src/lib/server/domain/masters.ts';
import type { ReservationView } from '../../src/lib/server/domain/reservations.ts';
import {
	csvLines,
	expect,
	okJson,
	samplePerson,
	type SamplePerson,
	test as base,
} from './harness.ts';

// This app's test data, set up through the API as the roster's admin, its times,
// and the `test` of the specs: harness.ts `test` (with `memberPage`) plus `api`.

/**
 * Roster users the admin books for in the scenarios (indexes into the general
 * users of seed-data/dev-users.json; 0 is harness.ts MEMBER).
 * Each scenario books its own equipment, so they may share them.
 */
export const BOOKERS: readonly SamplePerson[] = [samplePerson(1), samplePerson(2)];

/** `YYYY-MM-DDTHH:MM` -> the date `days` later at `time`. */
export function dayAt(now: string, days: number, time: string): string {
	const d = new Date(`${now.slice(0, 10)}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return `${d.toISOString().slice(0, 10)}T${time}`;
}

/** Test data set up through the API as the local admin. */
export class AdminApi {
	constructor(private readonly request: APIRequestContext) {}

	async session(): Promise<Session> {
		return okJson<Session>(await this.request.get('/api/me'));
	}

	async createEquipment(
		assetTag: string,
		fields: Record<string, unknown> = {},
	): Promise<EquipmentView> {
		return okJson<EquipmentView>(
			await this.request.post('/api/equipment', {
				data: { assetTag, name: `E2E equipment ${assetTag}`, ...fields },
			}),
		);
	}

	async reserve(
		equipmentId: number,
		startsAt: string,
		endsAt: string,
		userId: string | null = null,
	): Promise<ReservationView> {
		return okJson<ReservationView>(
			await this.request.post('/api/reservations', {
				data: { equipmentId, userId, startsAt, endsAt },
			}),
		);
	}

	async suspend(equipmentId: number, reason = 'repair'): Promise<EquipmentView> {
		return okJson<EquipmentView>(
			await this.request.post(`/api/equipment/${equipmentId}/suspend`, {
				data: { reason, note: null },
			}),
		);
	}

	async masters(): Promise<{ types: MasterEntry[]; locations: MasterEntry[] }> {
		return okJson(await this.request.get('/api/masters'));
	}

	async loans(equipmentId: number): Promise<LoanView[]> {
		return okJson<LoanView[]>(await this.request.get(`/api/equipment/${equipmentId}/loans`));
	}

	async findEquipment(assetTag: string): Promise<EquipmentView> {
		const { rows } = await okJson<{ rows: EquipmentView[] }>(
			await this.request.get('/api/equipment', { params: { q: assetTag } }),
		);
		const found = rows.find((r) => r.assetTag === assetTag);
		if (!found) {
			throw new Error(`equipment ${assetTag} not found`);
		}
		return found;
	}

	/** The import template's header cells (the column names of the CSV files). */
	async templateHeader(): Promise<string[]> {
		const res = await this.request.get('/api/import/template');
		expect(res.ok()).toBe(true);
		return csvLines(await res.body())[0];
	}
}

export const test = base.extend<{ api: AdminApi }>({
	api: async ({ request }, use) => {
		await use(new AdminApi(request));
	},
});
