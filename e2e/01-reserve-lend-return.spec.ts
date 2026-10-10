import { BOOKERS, dayAt, test } from './support/app.ts';
import { expect, openDialog, uniqueTag } from './support/harness.ts';

// 1. Book a piece of equipment from its page (the dialog's default period
// starts now) -> lend it from that booking -> return it: the loan ledger shows
// the seal, and the booking was picked up (linked to the loan).
test('book, lend from the booking, return', async ({ page, api }) => {
	const tag = uniqueTag('01');
	const equipment = await api.createEquipment(tag);

	await page.goto(`/equipment/${equipment.id}`);
	await page.getByTestId('equipment-reserve').click();
	await openDialog(page).getByTestId('reservation-submit').click();
	await expect(openDialog(page)).toBeHidden();
	await expect(page.getByTestId('reservation-row')).toHaveCount(1);
	await expect(page.getByTestId('reservation-chip')).toHaveAttribute('data-status', 'current');

	await page.getByTestId('equipment-lend').click();
	await openDialog(page).getByTestId('lend-submit').click();
	await expect(openDialog(page)).toBeHidden();
	await expect(page.getByTestId('status-chip').first()).toHaveAttribute('data-status', 'on_loan');
	const [loan] = await api.loans(equipment.id);
	expect(loan.reservationId).not.toBeNull();

	await page.getByTestId('equipment-return').click();
	await openDialog(page).getByTestId('return-submit').click();
	await expect(openDialog(page)).toBeHidden();
	await expect(page.getByTestId('status-chip').first()).toHaveAttribute('data-status', 'available');
	const row = page.getByTestId('loan-row');
	await expect(row).toHaveCount(1);
	// Returned by the borrower (the local admin borrowed it): "returned".
	await expect(row.getByTestId('seal')).toHaveAttribute('data-kind', 'returned');
});

// A history URL opened directly applies its filters (operation kind, from date).
test('a history URL opened directly applies its filters', async ({ page, api }) => {
	const tag = uniqueTag('01');
	const equipment = await api.createEquipment(tag);
	const { now, today } = await api.session();
	await api.reserve(equipment.id, dayAt(now, 1, '10:00'), dayAt(now, 1, '12:00'), BOOKERS[0].id);

	await page.goto(`/history?kind=reserve&from=${today}`);
	await expect(page.getByTestId('history-kind')).toHaveValue('reserve');
	await expect(page.getByTestId('history-from')).toHaveValue(today);
	await expect(page.getByTestId('history-to')).toHaveValue('');
	const rows = page.getByTestId('event-row');
	// The booking of this equipment is listed; its create event is not.
	await expect(rows.filter({ hasText: tag })).toHaveCount(1);
	const kinds = await rows
		.getByTestId('event-kind')
		.evaluateAll((els) => els.map((el) => el.getAttribute('data-kind')));
	expect(new Set(kinds)).toEqual(new Set(['reserve']));
	// The first cell is the local date and time (YYYY-MM-DD HH:mm).
	const days = await rows.evaluateAll((els) =>
		els.map((el) => el.querySelector('td')?.textContent?.trim().slice(0, 10) ?? ''),
	);
	expect(days.filter((day) => day < today)).toEqual([]);
});

// The person picker (ui/Combobox.svelte) from the keyboard: the arrows move
// through the candidates, Escape closes the list but not the dialog, Enter
// chooses the highlighted one.
test('the person picker works from the keyboard', async ({ page, api }) => {
	const equipment = await api.createEquipment(uniqueTag('01'));
	await page.goto(`/equipment/${equipment.id}`);
	await page.getByTestId('equipment-lend').click();
	const dialog = openDialog(page);

	// "yama" matches the two sample people no other scenario lends to.
	const combobox = dialog.getByTestId('member-combobox');
	const list = dialog.getByRole('listbox');
	const options = list.getByRole('option');
	await combobox.fill('yama');
	await expect(options).toHaveCount(2);
	await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
	await page.keyboard.press('ArrowDown');
	await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
	await page.keyboard.press('ArrowDown');
	await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
	await page.keyboard.press('ArrowUp');
	await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
	await page.keyboard.press('ArrowDown');
	const email = (await options.nth(1).textContent())?.match(/[\w.]+@example\.com/)?.[0];
	expect(email).toBeTruthy();

	await page.keyboard.press('Escape');
	await expect(list).toBeHidden();
	await expect(combobox).toHaveAttribute('aria-expanded', 'false');
	await expect(dialog).toBeVisible();

	await page.keyboard.press('ArrowDown');
	await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
	await page.keyboard.press('Enter');
	await expect(list).toBeHidden();
	await dialog.getByTestId('lend-submit').click();
	await expect(dialog).toBeHidden();
	const [loan] = await api.loans(equipment.id);
	expect(loan.email).toBe(email);
});
