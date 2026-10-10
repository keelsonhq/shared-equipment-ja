import { BOOKERS, dayAt, test } from './support/app.ts';
import { expect, openDialog, uniqueTag } from './support/harness.ts';

// 2. A booking that overlaps someone else's is refused under the start field,
// and the dialog stays open with the input.
test('an overlapping booking shows the error under the field', async ({ page, api }) => {
	const tag = uniqueTag('02');
	const equipment = await api.createEquipment(tag);
	const { now } = await api.session();
	await api.reserve(equipment.id, dayAt(now, 1, '10:00'), dayAt(now, 1, '12:00'), BOOKERS[0].id);

	await page.goto(`/equipment/${equipment.id}`);
	await page.getByTestId('equipment-reserve').click();
	const dialog = openDialog(page);
	await dialog.locator('input[name="startsAt"]').fill(dayAt(now, 1, '11:00'));
	await dialog.locator('input[name="endsAt"]').fill(dayAt(now, 1, '13:00'));
	await dialog.getByTestId('reservation-submit').click();
	await expect(dialog.getByTestId('field-error-startsAt')).toBeVisible();
	await expect(dialog.locator('input[name="startsAt"]')).toHaveAttribute('aria-invalid', 'true');
	await expect(dialog).toBeVisible();

	// Back-to-back is fine: [12:00, 13:00) after [10:00, 12:00).
	await dialog.locator('input[name="startsAt"]').fill(dayAt(now, 1, '12:00'));
	await dialog.getByTestId('reservation-submit').click();
	await expect(dialog).toBeHidden();
	await expect(page.getByTestId('reservation-row')).toHaveCount(2);
});

// A reservations URL opened directly shows everyone's bookings of that range
// (admin), and changing the range writes it back to the URL.
test('a reservations URL opened directly applies its range', async ({ page, api }) => {
	const tag = uniqueTag('02');
	const equipment = await api.createEquipment(tag);
	const { now } = await api.session();
	const day = dayAt(now, 1, '00:00').slice(0, 10);
	const later = dayAt(now, 3, '00:00').slice(0, 10);
	await api.reserve(equipment.id, dayAt(now, 1, '10:00'), dayAt(now, 1, '12:00'), BOOKERS[0].id);
	await api.reserve(equipment.id, dayAt(now, 3, '10:00'), dayAt(now, 3, '12:00'), BOOKERS[1].id);

	await page.goto(`/reservations?tab=all&from=${day}&to=${day}`);
	await expect(page.getByTestId('reservations-tab-all')).toHaveAttribute('aria-selected', 'true');
	await expect(page.getByTestId('reservations-from')).toHaveValue(day);
	await expect(page.getByTestId('reservations-to')).toHaveValue(day);
	const rows = page.getByTestId('reservation-row');
	const mine = rows.filter({ hasText: tag });
	// Only the booking of that day, not the one two days later.
	await expect(mine).toHaveCount(1);
	await expect(mine).toContainText(`${day} 10:00`);
	// Every listed booking overlaps the day (the period cell starts with
	// "YYYY-MM-DD HH:mm", and its end carries a date only on another day).
	const periods = await rows.evaluateAll((els) =>
		els.map((el) => el.querySelector('td')?.textContent?.trim() ?? ''),
	);
	for (const period of periods) {
		const [start, end] = period.split(' \u2013 ');
		const endDay = end.length > 5 ? end.slice(0, 10) : start.slice(0, 10);
		expect(start.slice(0, 10) <= day && endDay >= day, period).toBe(true);
	}

	await page.getByTestId('reservations-to').fill(later);
	await expect(page).toHaveURL((url) => url.searchParams.get('to') === later);
	await expect(mine).toHaveCount(2);
});
