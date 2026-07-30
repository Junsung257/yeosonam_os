import { expect, test } from '@playwright/test';

const consent = {
  analytics_storage: 'granted',
  ad_storage: 'granted',
  ad_user_data: 'granted',
  ad_personalization: 'granted',
  decided: true,
  updatedAt: '2026-07-29T00:00:00.000Z',
};

async function isAnalyticsRuntimeReady(page: import('@playwright/test').Page): Promise<boolean> {
  try {
    await page.waitForFunction(() => window.__YS_ANALYTICS_RUNTIME__ === true, null, {
      timeout: 5_000,
    });
    return true;
  } catch {
    return false;
  }
}

test.describe('marketing measurement foundation', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('https://www.googletagmanager.com/**', route =>
      route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }),
    );
    await page.addInitScript((storedConsent) => {
      localStorage.setItem('ys_consent_preferences_v2', JSON.stringify(storedConsent));
    }, consent);
  });

  test('captures consented UTM attribution and queues page/list events without an external tag call', async ({ page }) => {
    await page.goto(
      '/packages?utm_source=naver&utm_medium=blog&utm_campaign=e2e&gclid=e2e-click-1',
    );

    const runtimeEnabled = await isAnalyticsRuntimeReady(page);
    test.skip(
      !runtimeEnabled,
      'Start the E2E server with analytics debug env; see docs/analytics/verification-report.md.',
    );

    await expect.poll(() => page.evaluate(() =>
      (window.dataLayer ?? []).filter(
        entry => typeof entry === 'object' && entry !== null
          && (entry as { event?: string }).event === 'page_view',
      ).length,
    )).toBe(1);
    const renderedPackageLinks = await page.locator('a[href^="/packages/"]').count();
    if (renderedPackageLinks > 0) {
      await expect.poll(() => page.evaluate(() =>
        (window.dataLayer ?? []).some(
          entry => typeof entry === 'object' && entry !== null
            && (entry as { event?: string }).event === 'view_item_list',
        ),
      )).toBe(true);
    } else {
      await expect(page.getByText(/0개 상품/)).toBeVisible();
    }

    const attribution = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('ys_attribution_v1') ?? 'null'),
    );
    expect(attribution.firstTouch).toMatchObject({
      source: 'naver',
      medium: 'blog',
      campaign: 'e2e',
      landingPath: '/packages',
    });
    expect(attribution.clickIds).toEqual({ gclid: 'e2e-click-1' });
  });

  test('queues Kakao as an auxiliary click and never creates a lead from the CTA', async ({ page }) => {
    const leadRequests: string[] = [];
    page.on('request', request => {
      if (request.url().includes('/api/leads')) leadRequests.push(request.url());
    });
    await page.goto('/packages');

    const runtimeEnabled = await isAnalyticsRuntimeReady(page);
    test.skip(
      !runtimeEnabled,
      'Start the E2E server with analytics debug env; see docs/analytics/verification-report.md.',
    );

    const kakaoLink = page.locator('a[href*="pf.kakao.com"]').filter({ hasText: /카톡|상담/ }).first();
    await expect(kakaoLink).toBeVisible();
    await kakaoLink.evaluate((element) => {
      element.addEventListener('click', event => event.preventDefault(), { once: true });
      (element as HTMLElement).click();
    });

    await expect.poll(() => page.evaluate(() =>
      (window.dataLayer ?? []).some(
        entry => typeof entry === 'object' && entry !== null
          && (entry as { event?: string }).event === 'ysn_kakao_click',
      ),
    )).toBe(true);
    expect(leadRequests).toEqual([]);
  });
});
