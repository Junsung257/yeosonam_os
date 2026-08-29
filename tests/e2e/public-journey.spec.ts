import { expect, test } from '@playwright/test';

const PUBLIC_ROUTES = [
  '/',
  '/packages',
  '/destinations',
  '/blog',
  '/free-travel',
  '/group-inquiry',
  '/concierge',
  '/privacy',
  '/terms',
];

test.describe('public customer journey', () => {
  test('core public routes render without a server error', async ({ page }) => {
    for (const route of PUBLIC_ROUTES) {
      const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
      expect(response?.status(), `${route} response`).toBeLessThan(400);
      await expect(page.locator('body'), `${route} body`).not.toContainText(
        /Application error|Internal Server Error|Unhandled Runtime Error/i,
      );
    }
  });

  test('health endpoint remains available to public clients', async ({ request }) => {
    const response = await request.get('/api/v1/health');
    expect(response.status()).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
  });

  test('sitemap destination URLs are not marked noindex', async ({ request }) => {
    const sitemapResponse = await request.get('/sitemap.xml');
    expect(sitemapResponse.status()).toBe(200);
    const xml = await sitemapResponse.text();
    const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
    const destinationUrls = urls.filter((url) => {
      const pathname = new URL(url).pathname;
      return pathname.startsWith('/destinations/') && pathname.split('/').length === 3;
    });

    expect(destinationUrls.length).toBeGreaterThan(0);
    for (const url of destinationUrls.slice(0, 10)) {
      const pageResponse = await request.get(url);
      expect(pageResponse.status(), `${url} response`).toBeLessThan(400);
      const html = await pageResponse.text();
      const robots = [...html.matchAll(/<meta[^>]+name=["']robots["'][^>]+content=["']([^"']+)["'][^>]*>/gi)]
        .map((match) => match[1])
        .join(',');
      expect(robots, `${url} robots`).not.toMatch(/noindex/i);
    }
  });

  test('published blog article images have descriptive alt text', async ({ page }) => {
    const response = await page.goto('/blog/fukuoka-3', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBeLessThan(400);
    const articleImages = page.locator('article img');
    await expect(articleImages.first()).toBeVisible();
    const emptyAltSources = await articleImages.evaluateAll((images) => images
      .filter((image) => !(image.getAttribute('alt') || '').trim())
      .map((image) => image.getAttribute('src') || 'unknown'));
    expect(emptyAltSources).toEqual([]);
  });
});
