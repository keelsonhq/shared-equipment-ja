import { test } from './support/app.ts';
import { expect, openDialog, uniqueTag } from './support/harness.ts';

// 3. A general user (perms `view`): the shared ledger, no admin menu -> borrow a
// free piece from its row -> return it -> my page shows the seal; the admin
// APIs answer 403.
test('a general user borrows a free piece and returns it', async ({ memberPage: page, api }) => {
	const tag = uniqueTag('03');
	await api.createEquipment(tag);

	await page.goto('/');
	await expect(page).toHaveURL('/me');
	const links = page.getByRole('navigation').getByRole('link');
	await expect(links).toHaveCount(3);

	await page.goto(`/equipment?q=${tag}`);
	const row = page.getByTestId('equipment-row').filter({ hasText: tag });
	await expect(row.getByTestId('status-chip')).toHaveAttribute('data-status', 'available');
	await row.getByTestId('row-lend').click();
	await openDialog(page).getByTestId('lend-submit').click();
	await expect(openDialog(page)).toBeHidden();
	await expect(row.getByTestId('status-chip')).toHaveAttribute('data-status', 'on_loan');

	await row.getByTestId('row-return').click();
	await openDialog(page).getByTestId('return-submit').click();
	await expect(openDialog(page)).toBeHidden();
	await expect(row.getByTestId('status-chip')).toHaveAttribute('data-status', 'available');

	await page.goto('/me');
	await page.getByTestId('me-tab-history').click();
	const ledger = page.getByTestId('loan-row').filter({ hasText: tag });
	await expect(ledger.getByTestId('seal')).toHaveAttribute('data-kind', 'returned');

	const refused = await page.evaluate(async () => {
		const answers = [];
		for (const path of ['/api/home', '/api/events', '/api/import/template']) {
			const res = await fetch(path);
			answers.push({ status: res.status, body: await res.json() });
		}
		return answers;
	});
	expect(refused).toEqual(
		Array.from({ length: 3 }, () => ({
			status: 403,
			body: { error: 'forbidden_manage_required' },
		})),
	);
});

// The ledger's sort column and direction live in the URL and survive a reload
// (for a general user too).
test('the ledger sort order is kept in the URL', async ({ memberPage: page, api }) => {
	// Name order differs from asset-tag order, so each step shows.
	const prefix = uniqueTag('03');
	const a = `${prefix}-A`;
	const b = `${prefix}-B`;
	const c = `${prefix}-C`;
	await api.createEquipment(a, { name: 'E2E zeta' });
	await api.createEquipment(b, { name: 'E2E alpha' });
	await api.createEquipment(c, { name: 'E2E mu' });

	const rows = page.getByTestId('equipment-row');
	const inOrder = (tags: string[]) => tags.map((tag) => new RegExp(tag));
	const byName = page.getByTestId('sort-name');
	const query = () => new URL(page.url()).searchParams;

	await page.goto(`/equipment?q=${prefix}`);
	await expect(rows).toHaveText(inOrder([a, b, c]));
	await byName.getByRole('button').click();
	await expect(page).toHaveURL(
		(url) => url.searchParams.get('sort') === 'name' && url.searchParams.get('dir') === 'asc',
	);
	await expect(byName).toHaveAttribute('aria-sort', 'ascending');
	await expect(rows).toHaveText(inOrder([b, c, a]));
	await byName.getByRole('button').click();
	await expect(page).toHaveURL((url) => url.searchParams.get('dir') === 'desc');
	await expect(rows).toHaveText(inOrder([a, c, b]));

	await page.reload();
	expect(Object.fromEntries(query())).toEqual({ q: prefix, sort: 'name', dir: 'desc' });
	await expect(byName).toHaveAttribute('aria-sort', 'descending');
	await expect(rows).toHaveText(inOrder([a, c, b]));
});
