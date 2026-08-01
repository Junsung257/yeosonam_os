import { expect, test } from '@playwright/test';

const PUBLIC_ROUTES = ['/', '/packages', '/private-tour'];

test.describe('P0 public revenue routes', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`anonymous customer can open ${route}`, async ({ page }) => {
      const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
      expect(response?.status()).toBeLessThan(500);
      await expect(page).not.toHaveURL(/\/(?:admin\/)?login(?:[/?#]|$)/);
    });
  }

  test('private-tour does not show fabricated reception proof', async ({ page }) => {
    await page.goto('/private-tour', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('120+')).toHaveCount(0);
    await expect(page.getByText('방금 전')).toHaveCount(0);
  });

  test('admin surface and API remain protected', async ({ page, request }) => {
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/(?:admin\/)?login(?:[/?#]|$)/);

    const apiResponse = await request.get('/api/admin/leads', { maxRedirects: 0 });
    expect([302, 307, 401, 403]).toContain(apiResponse.status());
  });

  test('anonymous customer can open the selected verified offer landing', async ({ page }) => {
    const offerId = process.env.REVENUE_RESCUE_OFFER_ID;
    test.skip(!offerId, 'BLOCKED_OFFER_CANDIDATE: no price-and-inventory-verified offer exists.');
    const response = await page.goto(`/lp/${encodeURIComponent(offerId!)}`, { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBe(200);
    await expect(page).not.toHaveURL(/\/(?:admin\/)?login(?:[/?#]|$)/);
    await expect(page.getByRole('button', { name: /카카오/ })).toBeVisible();
  });
});
