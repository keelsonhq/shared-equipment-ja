import { test } from './support/app.ts';
import { expect, uniqueTag } from './support/harness.ts';

// 6. The equipment page shows the QR code of its own URL (an SVG from the
// API), and the label page has it ready to print.
test('the equipment page shows a QR code and a printable label', async ({ page, api, request }) => {
	const tag = uniqueTag('06');
	const equipment = await api.createEquipment(tag);

	await page.goto(`/equipment/${equipment.id}`);
	const qr = page.getByTestId('equipment-qr');
	await expect(qr).toBeVisible();
	await expect(qr).toHaveAttribute('src', `/api/equipment/${equipment.id}/qr`);
	await expect
		.poll(() => qr.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
		.toBe(true);
	const res = await request.get(`/api/equipment/${equipment.id}/qr`);
	expect(res.headers()['content-type']).toBe('image/svg+xml');
	expect(await res.text()).toContain('<svg');

	await page.getByTestId('equipment-label').click();
	await expect(page).toHaveURL(`/equipment/${equipment.id}/label`);
	const sheet = page.getByTestId('label-sheet');
	await expect(sheet).toBeVisible();
	await expect(sheet).toContainText(tag);
	await expect(page.getByTestId('label-print')).toBeVisible();
});
