import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from './support/app.ts';
import { csvLines, expect, fillFixture, hasBom, openDialog, uniqueTag } from './support/harness.ts';

// The CSV to import (Japanese headers and values, so it lives in e2e/fixtures/).
// Its placeholders are filled per run: `{{PREFIX}}` is a run-unique prefix of
// the asset tags and of a type the file names before it exists (so the import
// adds it, every run anew), `{{TYPE}}` / `{{LOCATION}}` an existing type and
// storage location.
const FIXTURE = join(import.meta.dirname, 'fixtures', 'import.csv');

// 5. Download the template (BOM + header) -> import the fixture: the preview
// judges each row (one names a type that is not registered yet), the import
// registers them all, and they are in the ledger.
test('download the template, preview and import equipment', async ({ page, api }) => {
	const prefix = uniqueTag('05');
	const { types, locations } = await api.masters();
	const active = (entries: { name: string; active: boolean }[]) =>
		entries.find((e) => e.active)?.name ?? '';
	const csv = fillFixture(readFileSync(FIXTURE, 'utf8'), {
		PREFIX: prefix,
		TYPE: active(types),
		LOCATION: active(locations),
	});

	await page.goto('/import');
	const [download] = await Promise.all([
		page.waitForEvent('download'),
		page.getByTestId('import-template').click(),
	]);
	const template = readFileSync(await download.path());
	expect(hasBom(template)).toBe(true);
	const [header, ...examples] = csvLines(template);
	expect(header.filter((h) => h.endsWith('*'))).toHaveLength(2);
	expect(examples).toHaveLength(2);
	expect(csvLines(Buffer.from(csv))[0]).toEqual(header.map((h) => h.replace(/\*$/, '')));

	await page.getByTestId('import-file').setInputFiles({
		name: 'e2e-import.csv',
		mimeType: 'text/csv',
		buffer: Buffer.from(csv),
	});
	await expect(page.getByTestId('import-count-all')).toHaveText('3');
	await expect(page.getByTestId('import-count-ok')).toHaveText('2');
	await expect(page.getByTestId('import-count-warn')).toHaveText('1');
	await expect(page.getByTestId('import-count-error')).toHaveText('0');

	await page.getByTestId('import-run').click();
	await expect(page.getByTestId('import-result')).toBeVisible();
	await expect(page.getByTestId('import-created')).toHaveText('3');
	// The type the file named is registered now (an active entry of the list).
	const added = (await api.masters()).types.filter((t) => t.name.startsWith(prefix));
	expect(added.map((t) => t.active)).toEqual([true]);

	await page.goto(`/equipment?q=${prefix}`);
	await expect(page.getByTestId('equipment-row')).toHaveCount(3);
});

// Registering one piece by hand (the dialog next to the CSV import):
// cancelling discards what was typed, so the form opens empty again.
test('cancel discards the register form', async ({ page, api }) => {
	const tag = uniqueTag('05');
	const { types, locations } = await api.masters();
	const type = types.find((t) => t.active);
	const location = locations.find((l) => l.active);
	if (!type || !location) {
		throw new Error('no active equipment type or location');
	}

	await page.goto('/equipment');
	await page.getByTestId('equipment-register').click();
	const dialog = openDialog(page);
	await dialog.locator('[name="assetTag"]').fill(tag);
	await dialog.locator('[name="typeId"]').selectOption(String(type.id));
	await dialog.locator('[name="name"]').fill(`E2E camera ${tag}`);
	await dialog.locator('[name="serialNo"]').fill(`SN-${tag}`);
	await dialog.locator('[name="locationId"]').selectOption(String(location.id));
	await dialog.locator('[name="note"]').fill('Never saved.');
	await dialog.getByTestId('equipment-form-cancel').click();
	await expect(dialog).toBeHidden();

	await page.getByTestId('equipment-register').click();
	await expect(dialog).toBeVisible();
	for (const field of ['assetTag', 'typeId', 'name', 'serialNo', 'locationId', 'note']) {
		await expect(dialog.locator(`[name="${field}"]`)).toHaveValue('');
	}
	await expect(api.findEquipment(tag)).rejects.toThrow();
});

// "Save and continue" registers the piece and keeps the dialog open for the
// next one: the type and the location stay, everything else is cleared.
test('save and continue keeps the type and the location', async ({ page, api }) => {
	const first = uniqueTag('05');
	const second = uniqueTag('05');
	const { types, locations } = await api.masters();
	const type = types.find((t) => t.active);
	const location = locations.find((l) => l.active);
	if (!type || !location) {
		throw new Error('no active equipment type or location');
	}

	await page.goto('/equipment');
	await page.getByTestId('equipment-register').click();
	const dialog = openDialog(page);
	await dialog.locator('[name="assetTag"]').fill(first);
	await dialog.locator('[name="typeId"]').selectOption(String(type.id));
	await dialog.locator('[name="name"]').fill(`E2E camera ${first}`);
	await dialog.locator('[name="serialNo"]').fill(`SN-${first}`);
	await dialog.locator('[name="locationId"]').selectOption(String(location.id));
	await dialog.locator('[name="note"]').fill('First of two.');
	await dialog.getByTestId('equipment-form-continue').click();

	await expect(dialog.locator('[name="assetTag"]')).toHaveValue('');
	await expect(dialog).toBeVisible();
	for (const field of ['name', 'serialNo', 'note']) {
		await expect(dialog.locator(`[name="${field}"]`)).toHaveValue('');
	}
	await expect(dialog.locator('[name="typeId"]')).toHaveValue(String(type.id));
	await expect(dialog.locator('[name="locationId"]')).toHaveValue(String(location.id));
	expect(await api.findEquipment(first)).toMatchObject({
		typeId: type.id,
		locationId: location.id,
		serialNo: `SN-${first}`,
	});

	await dialog.locator('[name="assetTag"]').fill(second);
	await dialog.locator('[name="name"]').fill(`E2E camera ${second}`);
	await dialog.getByTestId('equipment-form-submit').click();
	await expect(dialog).toBeHidden();
	expect(await api.findEquipment(second)).toMatchObject({
		typeId: type.id,
		locationId: location.id,
		serialNo: null,
		note: null,
	});
});
