import { test } from './support/app.ts';
import { expect, openDialog, uniqueTag } from './support/harness.ts';

// 4. Suspend a piece from its page: the booking and lending buttons go away
// and the status says so; resume it and they are back.
test('suspending hides booking, resuming brings it back', async ({ page, api }) => {
	const tag = uniqueTag('04');
	const equipment = await api.createEquipment(tag);

	await page.goto(`/equipment/${equipment.id}`);
	await expect(page.getByTestId('equipment-reserve')).toBeVisible();
	await expect(page.getByTestId('equipment-lend')).toBeVisible();

	await page.getByTestId('equipment-menu').click();
	await page.getByTestId('equipment-suspend').click();
	await openDialog(page).getByTestId('suspend-submit').click();
	await expect(openDialog(page)).toBeHidden();
	await expect(page.getByTestId('status-chip').first()).toHaveAttribute('data-status', 'suspended');
	await expect(page.getByTestId('equipment-reserve')).toHaveCount(0);
	await expect(page.getByTestId('equipment-lend')).toHaveCount(0);
	await expect(page.getByTestId('suspended-warning')).toBeVisible();

	await page.getByTestId('equipment-menu').click();
	await page.getByTestId('equipment-resume').click();
	await expect(page.getByTestId('equipment-reserve')).toBeVisible();
	await expect(page.getByTestId('status-chip').first()).toHaveAttribute('data-status', 'available');
});

// A ledger URL with a status filter opens filtered; clearing the filter lists
// the rest again.
test('a ledger URL opened directly applies its status filter', async ({ page, api }) => {
	const prefix = uniqueTag('04');
	const suspended = await api.createEquipment(`${prefix}-A`);
	await api.createEquipment(`${prefix}-B`);
	await api.suspend(suspended.id);

	await page.goto(`/equipment?q=${prefix}&status=suspended`);
	const rows = page.getByTestId('equipment-row');
	await expect(rows).toHaveCount(1);
	await expect(rows).toContainText(`${prefix}-A`);
	await expect(rows.getByTestId('status-chip')).toHaveAttribute('data-status', 'suspended');
	await page.getByTestId('status-filter').click();
	const option = page.getByTestId('status-filter-suspended');
	await expect(option).toBeChecked();

	await option.uncheck();
	await expect(page).toHaveURL(
		(url) => !url.searchParams.has('status') && url.searchParams.get('q') === prefix,
	);
	await expect(rows).toHaveCount(2);
	// A checklist menu stays open while its boxes are ticked; Escape closes it.
	await expect(page.getByTestId('status-filter')).toHaveAttribute('aria-expanded', 'true');
	await page.keyboard.press('Escape');
	await expect(option).toBeHidden();
});

// The "more" menu of the equipment page (ui/Menu.svelte): Escape and a click
// outside close it, and choosing an item closes it with the focus back on its
// button, where the focus returns when the dialog the item opened closes.
test('the equipment menu closes on Escape, a click outside and a choice', async ({ page, api }) => {
	const equipment = await api.createEquipment(uniqueTag('04'));
	await page.goto(`/equipment/${equipment.id}`);
	const trigger = page.getByTestId('equipment-menu');
	const suspend = page.getByTestId('equipment-suspend');

	await trigger.click();
	await expect(trigger).toHaveAttribute('aria-expanded', 'true');
	await expect(suspend).toBeVisible();
	await page.getByTestId('equipment-title').click();
	await expect(suspend).toBeHidden();
	await expect(trigger).toHaveAttribute('aria-expanded', 'false');

	await trigger.focus();
	await page.keyboard.press('Enter');
	await page.keyboard.press('Tab');
	await expect(suspend).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(suspend).toBeHidden();
	await expect(trigger).toBeFocused();

	await page.keyboard.press('Enter');
	await page.keyboard.press('Tab');
	await page.keyboard.press('Enter');
	const dialog = openDialog(page);
	await expect(dialog).toBeVisible();
	await expect(suspend).toBeHidden();
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	await expect(trigger).toBeFocused();
});
