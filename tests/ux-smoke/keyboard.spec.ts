import { expect, test, type Locator, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

interface Fixture {
  id: string;
  product?: string;
}

const fixturePath = path.join(__dirname, '..', 'visual', 'fixtures.json');
const fixtures: Fixture[] = fs.existsSync(fixturePath)
  ? JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
  : [];
const detailRoutes = uniqueStrings([
  ...loadLocalDetailFixturePackageIds(),
  ...fixtures.map((fixture) => fixture.id),
  ...fixtures.map((fixture) => fixture.product),
])
  .filter((id): id is string => Boolean(id))
  .map((id) => `/packages/${id}`);
const detailRoute = detailRoutes[0] ?? '/packages';

function loadLocalDetailFixturePackageIds(): string[] {
  const candidateFiles = [
    path.join(process.cwd(), 'api_test.json'),
    process.env.TEMP ? path.join(process.env.TEMP, 'yeosonam-os-dev-link', 'api_test.json') : null,
  ].filter((file): file is string => Boolean(file));

  for (const candidateFile of candidateFiles) {
    if (!fs.existsSync(candidateFile)) continue;
    try {
      const payload = JSON.parse(fs.readFileSync(candidateFile, 'utf8')) as unknown;
      const rows = Array.isArray(payload)
        ? payload
        : Array.isArray((payload as { data?: unknown } | null)?.data)
          ? (payload as { data: unknown[] }).data
          : [];

      const ids = rows
        .map((row) => (row && typeof row === 'object' ? (row as { id?: unknown }).id : null))
        .filter((id): id is string => typeof id === 'string' && id.length > 0);
      if (ids.length > 0) return ids;
    } catch {
      continue;
    }
  }

  return [];
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

test.describe('keyboard access smoke', () => {
  test('global navigation menus expose controlled regions from keyboard', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const overseasToggle = page.locator('[data-testid="global-nav-overseas-toggle"]:visible').first();
    test.skip(!(await overseasToggle.count()), 'desktop global navigation is unavailable on the current route');

    await expectCanFocus(overseasToggle, 'global navigation overseas menu toggle');
    await expect(overseasToggle).toHaveAttribute('aria-haspopup', 'menu');
    await expect(overseasToggle).toHaveAttribute('aria-expanded', 'false');
    const overseasMenuId = await overseasToggle.getAttribute('aria-controls');
    expect(overseasMenuId, 'global navigation overseas toggle should control a menu').toBeTruthy();
    await page.keyboard.press('Enter');
    await expect(overseasToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator(`[id="${overseasMenuId}"]`)).toHaveAttribute('role', 'menu');
    await expect(page.locator(`[id="${overseasMenuId}"]`)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(overseasToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('[data-testid="global-nav-group-inquiry"]:visible').first()).toHaveAttribute('href', /\/group-inquiry\?.*source=global_nav/);

    await page.setViewportSize({ width: 375, height: 812 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const mobileOpen = page.locator('[data-testid="global-nav-mobile-open"]:visible').first();
    await expectCanFocus(mobileOpen, 'global navigation mobile drawer open');
    await expect(mobileOpen).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(mobileOpen).toHaveAttribute('aria-expanded', 'false');
    const drawerId = await mobileOpen.getAttribute('aria-controls');
    expect(drawerId, 'global navigation mobile toggle should control a drawer').toBeTruthy();
    await page.keyboard.press('Enter');
    await expect(page.locator(`[id="${drawerId}"]`)).toHaveAttribute('role', 'dialog');
    await expect(page.locator(`[id="${drawerId}"]`)).toBeVisible();
    await expect(page.locator('[data-testid="global-nav-mobile-group-inquiry"]:visible').first()).toHaveAttribute('href', /\/group-inquiry\?.*source=global_nav/);

    const regionToggle = page.locator('[data-testid="global-nav-mobile-region-toggle"]:visible').first();
    await expectCanFocus(regionToggle, 'global navigation mobile region toggle');
    await expect(regionToggle).toHaveAttribute('aria-expanded', 'false');
    const regionPanelId = await regionToggle.getAttribute('aria-controls');
    expect(regionPanelId, 'global navigation mobile region toggle should control a panel').toBeTruthy();
    await page.keyboard.press('Enter');
    await expect(regionToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator(`[id="${regionPanelId}"]`)).toHaveAttribute('role', 'region');
    await expect(page.locator(`[id="${regionPanelId}"]`)).toBeVisible();
  });

  test('category group inquiry carries context into AI inquiry', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const categoryGroupInquiry = page.locator('[data-testid="category-group-inquiry"]:visible').first();
    await expectCanFocus(categoryGroupInquiry, 'category group inquiry');
    await expect(categoryGroupInquiry).toHaveAttribute('href', /\/group-inquiry\?.*source=category_icons/);
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/group-inquiry\?.*source=category_icons/, { timeout: 15_000 });
    await expect(page.locator('[data-testid="group-inquiry-handoff-summary"]:visible')).toBeVisible();
    await expect(page.locator('[data-testid="group-inquiry-sticky-handoff-summary"]:visible')).toBeVisible();
  });

  test('home hero group inquiry carries context into AI inquiry', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const groupInquiry = page.locator('[data-testid="home-hero-group-inquiry"]:visible').first();
    await expectCanFocus(groupInquiry, 'home hero group inquiry');
    await expect(groupInquiry).toHaveAttribute('href', /\/group-inquiry\?.*source=home_hero/);
    const href = await groupInquiry.getAttribute('href');
    expect(href).toContain('intent=group_trip');
    expect(href).toContain('party_type=group');
    expect(href).toContain('selected_products=');
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/group-inquiry\?.*source=home_hero/, { timeout: 15_000 });
    await expect(page.locator('[data-testid="group-inquiry-handoff-summary"]:visible')).toBeVisible();
    await expect(page.locator('[data-testid="group-inquiry-sticky-handoff-summary"]:visible')).toBeVisible();
  });

  test('home footer group inquiry preserves entry context', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const footerGroupInquiry = page.locator('[data-testid="home-footer-group-inquiry"]:visible').first();
    await expectCanFocus(footerGroupInquiry, 'home footer group inquiry');
    await expect(footerGroupInquiry).toHaveAttribute('href', /\/group-inquiry\?.*source=home_footer/);
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/group-inquiry\?.*source=home_footer/, { timeout: 15_000 });
    await expect(page.locator('[data-testid="group-inquiry-handoff-summary"]:visible')).toBeVisible();
  });

  test('package filters can be opened and focused with keyboard', async ({ page }) => {
    await page.goto('/packages', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const resultSummary = page.locator('[data-testid="packages-result-summary"]');
    await expect(resultSummary).toHaveCount(1, { timeout: 20_000 });
    await expect(resultSummary).toHaveAttribute('aria-live', 'polite');
    await expect(resultSummary).toHaveAttribute('aria-atomic', 'true');
    await expect(resultSummary).toContainText(/상품 \d+개 중 \d+개/);

    const monthFilter = page.locator('[data-testid="packages-month-filter"]:visible').first();
    if ((await monthFilter.locator('option').count()) > 1) {
      await monthFilter.selectOption({ index: 1 });
      const decisionSummary = page.locator('[data-testid="packages-list-decision-summary"]');
      await expect(decisionSummary, 'package filters should move focus to the refreshed result decision summary').toBeFocused({ timeout: 10_000 });
      await expect(decisionSummary).toHaveAttribute('tabindex', '-1');
    }

    const moreFilters = page.locator('[data-testid="packages-more-filters-toggle"]:visible').first();
    if (await moreFilters.count()) {
      await expectCanFocus(moreFilters, 'packages more filters');
      await expect(moreFilters, 'packages more filters starts collapsed').toHaveAttribute('aria-expanded', 'false');
      await page.keyboard.press('Enter');

      const moreFiltersPanel = page.locator('#package-more-filters');
      const advancedSort = moreFiltersPanel.locator('select').first();
      await expect(moreFilters, 'packages more filters exposes expanded state').toHaveAttribute('aria-expanded', 'true');
      await expect(moreFiltersPanel).toHaveAttribute('role', 'region');
      await expect(moreFiltersPanel).toBeVisible();
      await expect(advancedSort, 'advanced package sort select should receive focus after opening').toBeFocused();
      await page.keyboard.press('Escape');
      await expect(moreFiltersPanel).toBeHidden();
      await expect(moreFilters, 'packages more filters collapses after Escape').toHaveAttribute('aria-expanded', 'false');
      await expect(moreFilters, 'packages more filters should regain focus after Escape').toBeFocused();
      return;
    }

    await expectCanFocus(page.locator('a[href*="group-inquiry"]').first(), 'packages fallback inquiry link');
  });

  test('package list mobile sticky CTA exposes handoff summary', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/packages', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    await expect(page.locator('[data-testid="packages-sticky-handoff-summary"]:visible')).toBeVisible();
    await expectCanFocus(page.locator('[data-testid="packages-sticky-kakao"]:visible').first(), 'packages sticky Kakao CTA');
    const groupInquiry = page.locator('a[href*="/group-inquiry"][href*="source=packages"]:visible').first();
    await expectCanFocus(groupInquiry, 'packages sticky group inquiry CTA');
    const href = await groupInquiry.getAttribute('href');
    expect(href).toContain('intent=group_trip');
    expect(href).toContain('party_type=group');
    expect(href).toContain('selected_products=');
  });

  test('package card links are keyboard focusable and named', async ({ page }) => {
    await page.goto('/packages', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const packageCardLink = page.locator('[data-testid="package-card-link"]:visible').first();
    if (!(await packageCardLink.count())) {
      await expectCanFocus(page.locator('a[href*="group-inquiry"]').first(), 'packages fallback inquiry link');
      return;
    }

    await expectCanFocus(packageCardLink, 'package card detail link');
    await expect(packageCardLink, 'package card detail link should point to a package detail route').toHaveAttribute('href', /^\/packages\/[^/?#]+/);
    await expect(packageCardLink, 'package card detail link should have a stable accessible name').toHaveAttribute('aria-label', /상세 보기$/);
  });

  test('package first candidate inquiry carries selected product context', async ({ page }) => {
    await page.goto('/packages', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    await page.locator('[data-testid="packages-first-candidate-group-inquiry"]:visible').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
    const firstCandidateInquiry = page.locator('[data-testid="packages-first-candidate-group-inquiry"]:visible').first();
    if (!(await firstCandidateInquiry.count())) {
      await expectCanFocus(page.locator('a[href*="group-inquiry"]').first(), 'packages fallback inquiry link');
      return;
    }

    await expectCanFocus(firstCandidateInquiry, 'first candidate inquiry');
    const href = await firstCandidateInquiry.getAttribute('href');
    expect(href, 'first candidate inquiry should route to group inquiry').toContain('/group-inquiry?');
    const query = new URLSearchParams(href?.split('?')[1] ?? '');
    expect(query.get('source'), 'first candidate inquiry source should be explicit').toBe('packages_first_candidate');
    expect(query.get('selected_products'), 'first candidate inquiry should include product context').toBeTruthy();
  });

  test('package card reason toggle exposes expanded state from keyboard', async ({ page }) => {
    await page.goto('/packages', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    await page.locator('[data-testid="package-card-link"]:visible').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
    await page.locator('[data-testid="package-card-reason-toggle"]:visible').first().waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
    const reasonToggle = page.locator('[data-testid="package-card-reason-toggle"]:visible').first();
    test.skip(!(await reasonToggle.count()), 'recommended package reason toggle is unavailable in current package data');

    await expectCanFocus(reasonToggle, 'package card reason toggle');
    await expect(reasonToggle, 'package card reason toggle starts collapsed').toHaveAttribute('aria-expanded', 'false');
    const panelId = await reasonToggle.getAttribute('aria-controls');
    expect(panelId, 'package card reason toggle should control a panel').toBeTruthy();

    await page.keyboard.press('Enter');
    await expect(reasonToggle, 'package card reason toggle exposes expanded state').toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator(`[id="${panelId}"]`)).toBeVisible();
    await expect(page.locator(`[id="${panelId}"]`)).toHaveAttribute('role', 'region');
  });

  test('package comparison modal can be opened and closed with keyboard', async ({ page }) => {
    await page.goto('/packages', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const compareToggles = page.locator('[data-testid="packages-compare-toggle"]:visible');
    if ((await compareToggles.count()) < 2) {
      await expectCanFocus(page.locator('a[href*="group-inquiry"]').first(), 'packages fallback inquiry link');
      return;
    }

    await expectCanFocus(compareToggles.nth(0), 'first package compare toggle');
    await page.keyboard.press('Enter');
    await expect(compareToggles.nth(0)).toHaveAttribute('aria-pressed', 'true');

    await expectCanFocus(compareToggles.nth(1), 'second package compare toggle');
    await page.keyboard.press('Enter');
    await expect(compareToggles.nth(1)).toHaveAttribute('aria-pressed', 'true');

    const openCompare = page.locator('[data-testid="packages-compare-open"]:visible').first();
    await expectCanFocus(openCompare, 'packages compare open');
    await expect(openCompare).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(openCompare).toHaveAttribute('aria-expanded', 'false');
    await expect(openCompare).toHaveAttribute('aria-controls', 'packages-compare-dialog');
    await page.keyboard.press('Enter');

    const compareDialog = page.locator('[data-testid="packages-compare-dialog"]');
    await expect(compareDialog).toBeVisible();
    await expect(openCompare).toHaveAttribute('aria-expanded', 'true');
    await expect(compareDialog).toHaveAttribute('aria-modal', 'true');
    await expect(compareDialog).toHaveAttribute(
      'aria-describedby',
      'package-compare-description package-compare-dialog-handoff-summary package-compare-dialog-next-action',
    );
    await expect(page.locator('[data-testid="package-compare-dialog-handoff-summary"]')).toBeVisible();
    await expect(page.locator('[data-testid="package-compare-dialog-next-action"]')).toBeVisible();

    const dialogGroupInquiry = page.locator('[data-testid="package-compare-dialog-group-inquiry"]:visible').first();
    await expectCanFocus(dialogGroupInquiry, 'package compare dialog group inquiry');
    await expect(dialogGroupInquiry).toHaveAttribute(
      'aria-describedby',
      'package-compare-dialog-handoff-summary package-compare-dialog-next-action',
    );
    const dialogGroupHref = await dialogGroupInquiry.getAttribute('href');
    expect(dialogGroupHref).toContain('source=packages');
    expect(dialogGroupHref).toContain('selected_products=');

    await expectCanFocus(page.locator('[data-testid="packages-compare-close"]').first(), 'packages compare close');
    await page.keyboard.press('Enter');
    await expect(compareDialog).toBeHidden();
    await expect(openCompare, 'packages compare trigger collapses after close').toHaveAttribute('aria-expanded', 'false');
    await expect(openCompare, 'packages compare trigger should regain focus after close').toBeFocused();
  });

  test('package detail keeps primary CTA controls keyboard operable', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const detailAvailable = await gotoPackageDetailWithStickyCta(page);
    test.skip(!detailAvailable, 'package detail sticky CTA is unavailable in current package data');

    const stickyKakao = page.locator('[data-testid="package-detail-sticky-kakao"]:visible').first();

    await expectCanFocus(stickyKakao, 'package detail Kakao CTA');
    await expect(page.locator('[data-testid="package-detail-sticky-handoff-summary"]:visible')).toBeVisible();
    const groupInquiry = page.locator('[data-testid="package-detail-sticky-group-inquiry"]:visible').first();
    await expectCanFocus(groupInquiry, 'package detail group inquiry CTA');
    const href = await groupInquiry.getAttribute('href');
    expect(href).toContain('source=package_detail');
    expect(href).toContain('selected_products=');
    const reservationCta = page.locator('[data-testid="package-detail-reservation-cta"]:visible').first();
    await expectCanFocus(reservationCta, 'package detail reservation CTA');
    await expect(reservationCta).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(reservationCta).toHaveAttribute('aria-controls', 'package-detail-reservation-dialog');
    await expect(reservationCta, 'package detail reservation CTA starts collapsed').toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Enter');

    const reservationDialog = page.locator('[data-testid="package-detail-reservation-dialog"]');
    await expect(reservationDialog).toBeVisible();
    await expect(reservationCta, 'package detail reservation CTA exposes expanded state').toHaveAttribute('aria-expanded', 'true');
    await expect(reservationDialog).toHaveAttribute('role', 'dialog');
    await expect(reservationDialog).toHaveAttribute('aria-modal', 'true');
    await expect(reservationDialog).toHaveAttribute('aria-labelledby', 'reservation-inquiry-title');
    await expectCanFocus(reservationDialog.locator('#reservation-name'), 'reservation inquiry name input');
    const reservationSubmit = reservationDialog.locator('[data-testid="package-detail-reservation-submit"]');
    await reservationSubmit.click();
    await expect(reservationDialog.locator('#reservation-name-error')).toBeVisible();
    await expect(reservationDialog.locator('#reservation-name')).toBeFocused();
    await reservationDialog.locator('#reservation-name').fill('Test User');
    await reservationSubmit.click();
    await expect(reservationDialog.locator('#reservation-phone-error')).toBeVisible();
    await expect(reservationDialog.locator('#reservation-phone')).toBeFocused();
    await reservationDialog.locator('#reservation-phone').fill('010-1234-5678');
    await reservationSubmit.click();
    await expect(reservationDialog.locator('#reservation-consent-error')).toBeVisible();
    await expect(reservationDialog.locator('#reservation-consent')).toBeFocused();
    await expectCanFocus(page.locator('[data-testid="package-detail-reservation-close"]').first(), 'reservation inquiry close');
    await page.keyboard.press('Enter');
    await expect(reservationDialog).toBeHidden();
    await expect(reservationCta, 'package detail reservation CTA collapses after close').toHaveAttribute('aria-expanded', 'false');
    await expect(reservationCta, 'package detail reservation CTA should regain focus after close').toBeFocused();
  });

  test('package detail terms sheet opens and closes from keyboard', async ({ page }) => {
    const termsAvailable = await gotoPackageDetailWithVisibleSelector(page, '[data-testid="package-terms-open"]:visible');
    test.skip(!termsAvailable, 'package terms sheet trigger is unavailable in current package data');

    const termsOpen = page.locator('[data-testid="package-terms-open"]:visible').first();

    await expectCanFocus(termsOpen, 'package terms sheet open');
    await expect(termsOpen).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(termsOpen).toHaveAttribute('aria-expanded', 'false');
    await expect(termsOpen).toHaveAttribute('aria-controls', 'package-terms-sheet');
    await page.keyboard.press('Enter');

    const termsSheet = page.locator('[data-testid="package-terms-sheet"]');
    await expect(termsSheet).toBeVisible();
    await expect(termsSheet).toHaveAttribute('role', 'dialog');
    await expect(termsSheet).toHaveAttribute('aria-modal', 'true');
    await expect(termsSheet).toHaveAttribute('aria-describedby', /(^|\s)package-terms-sheet-description(\s|$)/);
    await expect(termsSheet).toHaveAttribute('aria-describedby', /(^|\s)package-terms-decision-summary(\s|$)/);

    const groupToggle = page.locator('[data-testid="package-terms-group-toggle"]:visible').first();
    await expectCanFocus(groupToggle, 'package terms group toggle');
    const panelId = await groupToggle.getAttribute('aria-controls');
    expect(panelId, 'package terms group toggle should control a panel').toBeTruthy();
    if ((await groupToggle.getAttribute('aria-expanded')) !== 'true') {
      await page.keyboard.press('Enter');
    }
    await expect(groupToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator(`[id="${panelId}"]`)).toHaveAttribute('role', 'region');

    await expectCanFocus(page.locator('[data-testid="package-terms-close"]').first(), 'package terms sheet close');
    await page.keyboard.press('Enter');
    await expect(termsSheet).toBeHidden();
    await expect(termsOpen, 'package terms trigger collapses after close').toHaveAttribute('aria-expanded', 'false');
    await expect(termsOpen, 'package terms trigger should regain focus after close').toBeFocused();
  });

  test('recommendation card disclosures expose controlled regions from keyboard', async ({ page }) => {
    const rationaleToggle = page.locator('[data-testid="recommendation-card-rationale-toggle"]:visible').first();
    const comparisonToggle = page.locator('[data-testid="recommendation-card-comparison-toggle"]:visible').first();
    const fullCompareOpen = page.locator('[data-testid="recommendation-card-full-compare-open"]:visible').first();
    const recommendationAvailable = await gotoPackageDetailWithVisibleSelector(page, [
      '[data-testid="recommendation-card-rationale-toggle"]:visible',
      '[data-testid="recommendation-card-comparison-toggle"]:visible',
      '[data-testid="recommendation-card-full-compare-open"]:visible',
    ]);
    test.skip(
      !recommendationAvailable,
      'recommendation card disclosures are unavailable in current package data',
    );

    if (await rationaleToggle.count()) {
      await expectCanFocus(rationaleToggle, 'recommendation card rationale toggle');
      await expect(rationaleToggle).toHaveAttribute('aria-expanded', 'false');
      const panelId = await rationaleToggle.getAttribute('aria-controls');
      expect(panelId, 'recommendation card rationale toggle should control a panel').toBeTruthy();
      await page.keyboard.press('Enter');
      await expect(rationaleToggle).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator(`[id="${panelId}"]`)).toHaveAttribute('role', 'region');
      await expect(page.locator(`[id="${panelId}"]`)).toBeVisible();
    }

    if (await comparisonToggle.count()) {
      await expectCanFocus(comparisonToggle, 'recommendation card comparison toggle');
      const panelId = await comparisonToggle.getAttribute('aria-controls');
      expect(panelId, 'recommendation card comparison toggle should control a panel').toBeTruthy();
      if ((await comparisonToggle.getAttribute('aria-expanded')) !== 'true') {
        await page.keyboard.press('Enter');
      }
      await expect(comparisonToggle).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator(`[id="${panelId}"]`)).toHaveAttribute('role', 'region');
      await expect(page.locator(`[id="${panelId}"]`)).toBeVisible();
    }

    if (await fullCompareOpen.count()) {
      await expectCanFocus(fullCompareOpen, 'recommendation card full comparison open');
      await expect(fullCompareOpen).toHaveAttribute('aria-haspopup', 'dialog');
      await expect(fullCompareOpen).toHaveAttribute('aria-expanded', 'false');
      await expect(fullCompareOpen).toHaveAttribute('aria-controls', 'pairwise-compare-dialog');
      await page.keyboard.press('Enter');

      const compareDialog = page.locator('[data-testid="pairwise-compare-dialog"]');
      await expect(compareDialog).toBeVisible();
      await expect(compareDialog).toHaveAttribute('role', 'dialog');
      await expect(compareDialog).toHaveAttribute('aria-modal', 'true');
      await expect(compareDialog).toHaveAttribute('aria-describedby', 'pairwise-compare-description');
      await expectCanFocus(page.locator('[data-testid="pairwise-compare-close"]').first(), 'pairwise compare close');
      await page.keyboard.press('Enter');
      await expect(compareDialog).toBeHidden();
    }
  });

  test('travel detail info cards expose controlled disclosure regions from keyboard', async ({ page }) => {
    const fitnessToggle = page.locator('[data-testid="travel-fitness-comparison-toggle"]:visible').first();
    const packingToggle = page.locator('[data-testid="packing-tips-toggle"]:visible').first();
    const detailInfoAvailable = await gotoPackageDetailWithVisibleSelector(page, [
      '[data-testid="travel-fitness-comparison-toggle"]:visible',
      '[data-testid="packing-tips-toggle"]:visible',
    ]);
    test.skip(
      !detailInfoAvailable,
      'travel detail info disclosures are unavailable in current package data',
    );

    if (await fitnessToggle.count()) {
      await expectCanFocus(fitnessToggle, 'travel fitness comparison toggle');
      await expect(fitnessToggle).toHaveAttribute('aria-expanded', 'false');
      const panelId = await fitnessToggle.getAttribute('aria-controls');
      expect(panelId, 'travel fitness comparison toggle should control a panel').toBeTruthy();
      await page.keyboard.press('Enter');
      await expect(fitnessToggle).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator(`[id="${panelId}"]`)).toHaveAttribute('role', 'region');
      await expect(page.locator(`[id="${panelId}"]`)).toBeVisible();
      await expect(page.locator(`[id="${panelId}"] button[aria-pressed="true"]`).first()).toBeVisible();
    }

    if (await packingToggle.count()) {
      await expectCanFocus(packingToggle, 'packing tips toggle');
      await expect(packingToggle).toHaveAttribute('aria-expanded', 'false');
      const panelId = await packingToggle.getAttribute('aria-controls');
      expect(panelId, 'packing tips toggle should control a panel').toBeTruthy();
      await page.keyboard.press('Enter');
      await expect(packingToggle).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator(`[id="${panelId}"]`)).toHaveAttribute('role', 'region');
      await expect(page.locator(`[id="${panelId}"]`)).toBeVisible();
    }
  });

  test('AI consultation entry controls are keyboard focusable', async ({ page }) => {
    await page.route('**/api/concierge/cart**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) });
    });
    await page.route('**/api/concierge/search', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          results: [
            {
              product_id: 'ux-smoke-ai-entry-1',
              product_name: '빠른 시작 결과 포커스 상품',
              api_name: 'internal',
              product_type: 'PACKAGE',
              product_category: 'FIXED',
              price: 980000,
              description: '빠른 시작 검색 후 결과 영역 포커스 검증용 상품입니다.',
            },
          ],
        }),
      });
    });
    await page.goto('/concierge', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const intentPrompt = page.locator('[data-testid="concierge-intent-prompt"]:visible').first();
    await expectCanFocus(intentPrompt, 'concierge intent prompt');
    const searchSubmit = page.locator('form button[type="submit"]').first();
    await expectCanFocus(searchSubmit, 'concierge search submit');

    await intentPrompt.focus();
    await page.keyboard.press('Enter');
    await expect(intentPrompt, 'concierge intent prompt should expose selected state after keyboard activation').toHaveAttribute('aria-pressed', 'true');
    const resultsSection = page.locator('[data-testid="concierge-results-section"]');
    await expect(resultsSection, 'concierge quick start should move focus to recommendation results').toBeFocused({ timeout: 10_000 });
    await expect(resultsSection).toHaveAttribute('tabindex', '-1');
    await expectCanFocus(page.locator('[data-testid="concierge-result-add"]:visible').first(), 'concierge result add button after quick start');
  });

  test('concierge mobile cart sheet opens from keyboard and exposes dialog state', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.route('**/api/concierge/cart**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });
    await page.route('**/api/concierge/search', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          results: [
            {
              product_id: 'ux-smoke-hotel-1',
              product_name: '키보드 접근성 스모크 상품',
              api_name: 'internal',
              product_type: 'HOTEL',
              product_category: 'DYNAMIC',
              price: 1200000,
              description: '모바일 장바구니 시트 검증용 상품입니다.',
            },
          ],
        }),
      });
    });

    await page.goto('/concierge', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    await page.locator('#concierge-search').fill('가족 여행 추천');
    await expectCanFocus(page.locator('form button[type="submit"]').first(), 'concierge search submit');
    await page.keyboard.press('Enter');

    const addButton = page.locator('[data-testid="concierge-result-add"]:visible').first();
    await expectCanFocus(addButton, 'concierge result add button');
    await page.keyboard.press('Enter');

    const mobileCartOpen = page.locator('[data-testid="concierge-mobile-cart-open"]:visible').first();
    await expect(mobileCartOpen, 'concierge add to cart should focus the mobile cart launcher').toBeFocused({ timeout: 10_000 });
    await expect(page.locator('[data-testid="concierge-share-toast"]:visible')).toContainText('선택 구성에 담았습니다');

    const mobileCartGroupInquiry = page.locator('[data-testid="concierge-mobile-cart-group-inquiry"]:visible').first();
    await expectCanFocus(mobileCartGroupInquiry, 'concierge mobile cart group inquiry');
    await expect(mobileCartGroupInquiry).toHaveAttribute('href', /\/group-inquiry\?.*selected_products=/);

    await expectCanFocus(mobileCartOpen, 'concierge mobile cart open');
    await expect(mobileCartOpen, 'concierge mobile cart open starts collapsed').toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Enter');

    const cartSheet = page.locator('[data-testid="concierge-cart-sheet"]');
    await expect(mobileCartOpen, 'concierge mobile cart open exposes expanded state').toHaveAttribute('aria-expanded', 'true');
    await expect(cartSheet).toBeVisible();
    await expect(cartSheet).toHaveAttribute('role', 'dialog');
    await expect(cartSheet).toHaveAttribute('aria-modal', 'true');
    await expect(page.locator('[data-testid="concierge-cart-handoff-summary"]:visible')).toBeVisible();

    const groupInquiryLink = page.locator('[data-testid="concierge-cart-group-inquiry"]:visible').first();
    await expectCanFocus(groupInquiryLink, 'concierge cart group inquiry');
    await expect(groupInquiryLink).toHaveAttribute('href', /\/group-inquiry\?.*selected_products=/);
    const href = await groupInquiryLink.getAttribute('href');
    expect(href).toContain('source=concierge');
    expect(href).toContain('intent=');

    const checkoutButton = page.locator('[data-testid="concierge-cart-checkout"]:visible').first();
    await expectCanFocus(checkoutButton, 'concierge cart checkout');
    await expect(checkoutButton).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(checkoutButton).toHaveAttribute('aria-expanded', 'false');
    await expect(checkoutButton).toHaveAttribute('aria-controls', 'concierge-checkout-dialog');
    await page.keyboard.press('Enter');

    const checkoutDialog = page.locator('[data-testid="concierge-checkout-dialog"]');
    await expect(cartSheet).toBeHidden();
    await expect(mobileCartOpen, 'concierge mobile cart open collapses after checkout handoff').toHaveAttribute('aria-expanded', 'false');
    await expect(checkoutDialog).toBeVisible();
    await expect(checkoutDialog).toHaveAttribute('role', 'dialog');
    await expect(checkoutDialog).toHaveAttribute('aria-modal', 'true');
    await expect(page.locator('#concierge-customer-name')).toBeFocused();
    await expectCanFocus(page.locator('[data-testid="concierge-checkout-submit"]').first(), 'concierge checkout submit');
    await expectCanFocus(page.locator('[data-testid="concierge-checkout-close"]').first(), 'concierge checkout close');
    await page.keyboard.press('Enter');
    await expect(checkoutDialog).toBeHidden();

    await expectCanFocus(mobileCartOpen, 'concierge mobile cart reopen');
    await page.keyboard.press('Enter');
    await expect(cartSheet).toBeVisible();
    await expectCanFocus(page.locator('[data-testid="concierge-cart-sheet-close"]').first(), 'concierge cart sheet close');
    await page.keyboard.press('Enter');
    await expect(cartSheet).toBeHidden();
  });

  test('concierge handoff inquiry preserves selected products before cart add', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.route('**/api/concierge/cart**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) });
    });
    await page.route('**/api/concierge/search', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ results: [] }),
      });
    });

    const selectedProduct = 'PR 마닐라 골프';
    const params = new URLSearchParams({
      source: 'packages',
      intent: 'package_search',
      query: `${selectedProduct} 상담`,
      selected_products: selectedProduct,
    });
    await page.goto(`/concierge?${params.toString()}`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const emptyGroupInquiry = page.locator('[data-testid="concierge-empty-group-inquiry"]:visible').first();
    await expect(emptyGroupInquiry, 'concierge empty group inquiry should be visible').toBeVisible();
    const href = await emptyGroupInquiry.getAttribute('href');
    expect(href, 'concierge empty group inquiry should preserve selected products').toContain('selected_products=');
    const handoffParams = new URLSearchParams(href?.split('?')[1] ?? '');
    expect(handoffParams.get('selected_products')).toBe(selectedProduct);
  });

  test('group inquiry intent chips expose selected state from keyboard', async ({ page }) => {
    await page.route('**/api/rfq/interview', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          reply: '조건을 이어서 정리해드릴게요.',
          state: { extracted: {}, stepsDone: [], isComplete: false },
        }),
      });
    });

    await page.goto('/group-inquiry', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const intentChip = page.locator('[data-testid="group-inquiry-intent-chip"]:visible').first();
    await expectCanFocus(intentChip, 'group inquiry intent chip');
    await expect(intentChip, 'group inquiry intent chip should start unselected').toHaveAttribute('aria-pressed', 'false');

    await page.keyboard.press('Enter');
    await expect(intentChip, 'group inquiry intent chip should expose selected state after keyboard activation').toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-testid="group-inquiry-sticky-handoff-summary"]:visible')).toBeVisible();
  });

  test('group landing can hand off current intent into AI inquiry', async ({ page }) => {
    await page.goto('/group', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const aiHandoff = page.locator('[data-testid="group-landing-ai-handoff"]:visible').first();
    await expectCanFocus(aiHandoff, 'group landing AI handoff');
    await expect(aiHandoff).toHaveAttribute('aria-describedby', /(^|\s)group-landing-ai-handoff-summary(\s|$)/);
    await expect(page.locator('[data-testid="group-landing-ai-handoff-summary"]:visible')).toContainText('AI에 전달될 조건');
    await expect(page.locator('[data-testid="group-landing-ai-handoff-summary"]:visible')).toContainText('/5 입력됨');
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/group-inquiry\?.*source=group_landing/, { timeout: 15_000 });
    const handoffUrl = new URL(page.url());
    expect(handoffUrl.searchParams.get('source')).toBe('group_landing');
    expect(handoffUrl.searchParams.get('intent')).toBeTruthy();
    expect(handoffUrl.searchParams.get('party_type')).toBe('group_landing');
    expect(handoffUrl.searchParams.get('selected_products')).toBe('단체 맞춤 견적');
    await expect(page.locator('[data-testid="group-inquiry-handoff-summary"]:visible')).toBeVisible();
    await expect(page.locator('[data-testid="group-inquiry-sticky-handoff-summary"]:visible')).toBeVisible();
  });

  test('group landing validation focuses the first invalid required field', async ({ page }) => {
    await page.goto('/group', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const submit = page.locator('[data-testid="group-landing-submit"]:visible').first();
    await expectCanFocus(submit, 'group landing submit');
    await page.keyboard.press('Enter');

    const contactName = page.locator('[data-testid="group-landing-contact-name"]:visible').first();
    await expect(contactName).toBeFocused();
    await expect(contactName).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#group-contact-name-error')).toBeVisible();
    await expect(page.locator('#group-landing-submit-error')).toHaveAttribute('role', 'alert');
    await contactName.fill('홍길동');
    await expect(page.locator('#group-landing-submit-error')).toBeHidden();
  });

  test('group landing Kakao action is keyboard reachable and exposes busy state', async ({ page }) => {
    await page.goto('/group', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const kakao = page.locator('[data-testid="group-landing-kakao"]:visible').first();
    await expectCanFocus(kakao, 'group landing Kakao consultation');
    await expect(kakao).toHaveAttribute('aria-busy', 'false');
  });

  test('group inquiry ready summary moves keyboard users into RFQ contact actions', async ({ page }) => {
    await page.route('**/api/rfq/interview', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          reply: '조건 정리가 끝났습니다. 연락처만 확인해 주세요.',
          state: {
            extracted: {
              destination: '다낭',
              adult_count: 20,
              budget_per_person: 1200000,
              duration_nights: 3,
              hotel_grade: '4성급',
              meal_preference: '현지식 포함',
              transport: '전용차량',
              special_requests: '노쇼핑 일정',
            },
            stepsDone: ['destination', 'people', 'budget'],
            isComplete: true,
          },
        }),
      });
    });
    await page.route('**/api/rfq', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'forced failure for keyboard smoke' }),
      });
    });

    await page.goto('/group-inquiry', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const intentChip = page.locator('[data-testid="group-inquiry-intent-chip"]:visible').first();
    await expectCanFocus(intentChip, 'group inquiry intent chip for ready summary');
    await page.keyboard.press('Enter');

    const rfqSummary = page.locator('[data-testid="group-inquiry-rfq-summary"]');
    await expect(rfqSummary).toBeVisible();
    await expect(rfqSummary).toHaveAttribute('aria-labelledby', 'rfq-summary-title');
    await expect(page.locator('[data-testid="group-inquiry-contact-name"]')).toBeFocused();
    await expectCanFocus(page.locator('[data-testid="group-inquiry-contact-phone"]').first(), 'group inquiry contact phone');
    await expectCanFocus(page.locator('[data-testid="group-inquiry-privacy-consent"]').first(), 'group inquiry privacy consent');
    await expectCanFocus(page.locator('[data-testid="group-inquiry-rfq-submit"]').first(), 'group inquiry RFQ submit');
    await expect(page.locator('[data-testid="group-inquiry-rfq-submit"]').first()).toHaveAttribute('aria-busy', 'false');
    await page.keyboard.press('Enter');
    const contactName = page.locator('[data-testid="group-inquiry-contact-name"]');
    const contactPhone = page.locator('[data-testid="group-inquiry-contact-phone"]');
    const privacyConsent = page.locator('[data-testid="group-inquiry-privacy-consent"]');
    const rfqSubmit = page.locator('[data-testid="group-inquiry-rfq-submit"]');

    await expect(contactName).toBeFocused();
    await expect(contactName).toHaveAttribute('aria-invalid', 'true');
    await contactName.fill('홍길동');
    await expect(contactName, 'group inquiry contact name error clears after correction').not.toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#contact-name-error')).toHaveCount(0);

    await expectCanFocus(rfqSubmit.first(), 'group inquiry RFQ submit after name correction');
    await page.keyboard.press('Enter');
    await expect(contactPhone).toBeFocused();
    await expect(contactPhone).toHaveAttribute('aria-invalid', 'true');
    await contactPhone.fill('010-1234-5678');
    await expect(contactPhone, 'group inquiry contact phone error clears after correction').not.toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#contact-phone-error')).toHaveCount(0);

    await expectCanFocus(rfqSubmit.first(), 'group inquiry RFQ submit after phone correction');
    await page.keyboard.press('Enter');
    await expect(privacyConsent).toBeFocused();
    await expect(privacyConsent).toHaveAttribute('aria-invalid', 'true');
    await page.keyboard.press('Space');
    await expect(privacyConsent, 'group inquiry privacy error clears after consent').not.toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#privacy-consent-error')).toHaveCount(0);
    const summaryKakao = page.locator('[data-testid="group-inquiry-summary-kakao"]').first();
    await expectCanFocus(summaryKakao, 'group inquiry summary Kakao CTA');
    await expect(summaryKakao).toHaveAttribute('aria-busy', 'false');

    await expectCanFocus(rfqSubmit.first(), 'group inquiry RFQ submit with valid contact');
    await page.keyboard.press('Enter');
    await expect(page.locator('#group-inquiry-submit-error')).toBeVisible();
    await expect(rfqSubmit).toHaveAttribute('aria-describedby', /(^|\s)group-inquiry-submit-error(\s|$)/);
    await expect(summaryKakao, 'group inquiry submit failure should focus Kakao fallback').toBeFocused();
  });

  test('admin dashboard today work and command links are keyboard focusable', async ({ page }) => {
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const todayWorkLink = page.locator('[data-testid="admin-today-work-queue-link"]:visible').first();
    if (!(await todayWorkLink.count())) {
      await expectCanFocus(page.locator('input[type="email"], input[name="email"]').first(), 'admin login email');
      await expectCanFocus(page.locator('input[type="password"], input[name="password"]').first(), 'admin login password');
      await expectCanFocus(page.locator('button[type="submit"]').first(), 'admin login submit');
      return;
    }

    await expect(page.locator('section[aria-labelledby="admin-today-work-title"]')).toBeVisible();
    await expect(page.locator('section[aria-labelledby="admin-operator-command-title"]')).toBeVisible();
    await expectCanFocus(todayWorkLink, 'admin today work queue link');
    await expectCanFocus(page.locator('[data-testid="admin-operator-command-link"]:visible').first(), 'admin operator command link');
  });

  test('admin booking action queue cards are keyboard focusable', async ({ page }) => {
    await page.goto('/admin/bookings', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const unpaidQueue = page.locator('[data-testid="admin-booking-queue-unpaid"]:visible').first();
    if (!(await unpaidQueue.count())) {
      await expectCanFocus(page.locator('input[type="email"], input[name="email"]').first(), 'admin login email');
      await expectCanFocus(page.locator('input[type="password"], input[name="password"]').first(), 'admin login password');
      await expectCanFocus(page.locator('button[type="submit"]').first(), 'admin login submit');
      return;
    }

    await expectCanFocus(unpaidQueue, 'admin booking unpaid queue');
    await expectQueueActivationState(page, unpaidQueue, 'admin booking unpaid queue');
    await expectCanFocus(page.locator('[data-testid="admin-booking-queue-prep"]:visible').first(), 'admin booking prep queue');
    await expectCanFocus(page.locator('[data-testid="admin-booking-queue-refund"]:visible').first(), 'admin booking refund queue');
  });

  test('admin booking table sort headers are keyboard operable', async ({ page }) => {
    await page.goto('/admin/bookings', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const departureSort = page.locator('[data-testid="admin-booking-sort-departure_date"]:visible').first();
    if (!(await departureSort.count())) {
      await expectCanFocus(page.locator('input[type="email"], input[name="email"]').first(), 'admin login email');
      await expectCanFocus(page.locator('input[type="password"], input[name="password"]').first(), 'admin login password');
      await expectCanFocus(page.locator('button[type="submit"]').first(), 'admin login submit');
      return;
    }

    await expectCanFocus(departureSort, 'admin booking departure sort');
    await page.keyboard.press('Enter');

    await expect(
      page.locator('th[aria-sort="ascending"]').filter({ has: departureSort }),
      'admin booking departure sort should expose ascending aria-sort after keyboard activation',
    ).toBeVisible();
  });

  test('admin booking row actions are keyboard focusable and open cancel dialog safely', async ({ page }) => {
    await page.goto('/admin/bookings', { waitUntil: 'commit' });
    await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const editAction = page.locator('[data-testid="admin-booking-edit-action"]:visible').first();
    if (!(await editAction.count())) {
      await expectCanFocus(page.locator('input[type="email"], input[name="email"]').first(), 'admin login email');
      await expectCanFocus(page.locator('input[type="password"], input[name="password"]').first(), 'admin login password');
      await expectCanFocus(page.locator('button[type="submit"]').first(), 'admin login submit');
      return;
    }

    await expectCanFocus(editAction, 'admin booking edit row action');
    const deleteAction = page.locator('[data-testid="admin-booking-delete-action"]:visible').first();
    await expectCanFocus(deleteAction, 'admin booking delete row action');
    await expect(deleteAction).toHaveAttribute('aria-describedby', 'admin-booking-delete-description');
    await expect(deleteAction).toHaveAttribute('aria-busy', 'false');

    const cancelAction = page.locator('[data-testid="admin-booking-cancel-action"]:visible').first();
    if (!(await cancelAction.count())) return;

    await expectCanFocus(cancelAction, 'admin booking cancel row action');
    await expect(cancelAction).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(cancelAction).toHaveAttribute('aria-expanded', 'false');
    await expect(cancelAction).toHaveAttribute('aria-controls', 'admin-booking-cancel-dialog');
    await page.keyboard.press('Enter');

    const cancelDialog = page.locator('[data-testid="admin-booking-cancel-dialog"]');
    await expect(cancelDialog).toBeVisible();
    await expect(cancelAction).toHaveAttribute('aria-expanded', 'true');
    await expect(cancelDialog).toHaveAttribute('role', 'dialog');
    await expect(cancelDialog).toHaveAttribute('aria-modal', 'true');
    await expect(cancelDialog).toHaveAttribute('aria-labelledby', 'booking-cancel-title');
    await expect(cancelDialog).toHaveAttribute('aria-describedby', 'booking-cancel-description');
    await expect(page.locator('[data-testid="admin-booking-cancel-refund"]')).toBeFocused();
    await expectCanFocus(page.locator('[data-testid="admin-booking-cancel-penalty"]').first(), 'admin booking cancel penalty');
    await expectCanFocus(page.locator('[data-testid="admin-booking-cancel-reason"]').first(), 'admin booking cancel reason');
    await expectCanFocus(page.locator('[data-testid="admin-booking-cancel-confirm"]').first(), 'admin booking cancel confirm');
    await expect(page.locator('[data-testid="admin-booking-cancel-confirm"]').first()).toHaveAttribute('aria-busy', 'false');
    await expectCanFocus(page.locator('[data-testid="admin-booking-cancel-close"]').first(), 'admin booking cancel dialog close');
    await page.keyboard.press('Enter');
    await expect(cancelDialog).toBeHidden();
    await expect(cancelAction).toHaveAttribute('aria-expanded', 'false');
    await expect(cancelAction, 'admin booking cancel action should regain focus after close').toBeFocused();
  });

  test('admin booking mobile card actions expose decision context', async ({ page }) => {
    await page.goto('/admin/bookings', { waitUntil: 'commit' });
    await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const mobileNextAction = page.locator('[data-testid="admin-booking-mobile-next-action"]:visible').first();
    if (!(await mobileNextAction.count())) {
      const editAction = page.locator('[data-testid="admin-booking-edit-action"]:visible').first();
      if (await editAction.count()) {
        await expectCanFocus(editAction, 'admin booking desktop edit action fallback');
        return;
      }
      await expectCanFocus(page.locator('input[type="email"], input[name="email"]').first(), 'admin login email');
      await expectCanFocus(page.locator('input[type="password"], input[name="password"]').first(), 'admin login password');
      await expectCanFocus(page.locator('button[type="submit"]').first(), 'admin login submit');
      return;
    }

    const expectMobileBookingContext = async (action: ReturnType<typeof page.locator>, label: string) => {
      await expect(action, `${label} should include visible decision context`).toHaveAttribute(
        'aria-describedby',
        /admin-booking-mobile-decision-summary-/,
      );

      const describedByIds = ((await action.getAttribute('aria-describedby')) ?? '').split(/\s+/).filter(Boolean);
      const nextActionSummaryId = describedByIds.find(id => id.startsWith('admin-booking-mobile-next-action-summary-'));
      const riskSummaryId = describedByIds.find(id => id.startsWith('admin-booking-mobile-risk-summary-'));

      expect(nextActionSummaryId, `${label} should describe the visible next action summary`).toBeTruthy();
      expect(riskSummaryId, `${label} should describe the visible risk summary`).toBeTruthy();

      if (nextActionSummaryId) {
        await expect(page.locator(`[id="${nextActionSummaryId}"]`)).toContainText('다음 액션');
      }

      if (riskSummaryId) {
        await expect(page.locator(`[id="${riskSummaryId}"]`)).toContainText('운영 사유');
      }
    };

    await expectCanFocus(mobileNextAction, 'admin booking mobile next action');
    await expectMobileBookingContext(mobileNextAction, 'admin booking mobile next action');

    const mobileDetailAction = page.locator('[data-testid="admin-booking-mobile-detail-action"]:visible').first();
    await expectCanFocus(mobileDetailAction, 'admin booking mobile detail action');
    await expectMobileBookingContext(mobileDetailAction, 'admin booking mobile detail action');
  });

  test('admin booking delete action announces undo and moves focus to recovery action', async ({ page }) => {
    await page.goto('/admin/bookings', { waitUntil: 'commit' });
    await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const deleteAction = page.locator('[data-testid="admin-booking-delete-action"]:visible').first();
    if (!(await deleteAction.count())) {
      await expectCanFocus(page.locator('input[type="email"], input[name="email"]').first(), 'admin login email');
      await expectCanFocus(page.locator('input[type="password"], input[name="password"]').first(), 'admin login password');
      await expectCanFocus(page.locator('button[type="submit"]').first(), 'admin login submit');
      return;
    }

    await expectCanFocus(deleteAction, 'admin booking delete row action');
    await expect(deleteAction).toHaveAttribute('aria-describedby', 'admin-booking-delete-description');
    await page.keyboard.press('Enter');

    const undoToast = page.locator('[data-testid="admin-booking-undo-toast"]');
    await expect(undoToast).toBeVisible();
    await expect(undoToast).toHaveAttribute('role', 'status');
    await expect(undoToast).toHaveAttribute('aria-live', 'polite');
    await expect(page.locator('#admin-booking-delete-description')).toContainText('5초 안에 실행 취소');

    const undoButton = page.locator('[data-testid="admin-booking-undo-delete"]');
    await expect(undoButton).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(undoToast).toBeHidden();
  });

  test('admin package action queue is keyboard focusable and opens more actions', async ({ page }) => {
    await page.goto('/admin/packages', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const reviewAction = page.locator('[data-testid="admin-package-review-action"]:visible').first();
    if (!(await reviewAction.count())) {
      await expectCanFocus(page.locator('input[type="email"], input[name="email"]').first(), 'admin login email');
      await expectCanFocus(page.locator('input[type="password"], input[name="password"]').first(), 'admin login password');
      await expectCanFocus(page.locator('button[type="submit"]').first(), 'admin login submit');
      return;
    }

    const packageReviewQueue = page.locator('[data-testid="admin-package-queue-review"]:visible').first();
    await expectCanFocus(packageReviewQueue, 'admin package review queue');
    await expectQueueActivationState(page, packageReviewQueue, 'admin package review queue');
    await expectCanFocus(page.locator('[data-testid="admin-package-queue-publish"]:visible').first(), 'admin package publish queue');

    await expectCanFocus(reviewAction, 'admin package review action');
    await expectCanFocus(page.locator('[data-testid="admin-package-edit-action"]:visible').first(), 'admin package edit action');
    await expectCanFocus(page.locator('[data-testid="admin-package-publish-action"]:visible').first(), 'admin package publish action');

    const moreAction = page.locator('[data-testid="admin-package-more-action"]:visible').first();
    await expectCanFocus(moreAction, 'admin package more action');
    await expect(moreAction).toHaveAttribute('aria-controls', /admin-package-copy-menu-/);
    await page.keyboard.press('Enter');

    await expect(moreAction, 'admin package more action should remain present after keyboard activation').toBeVisible();
    await expect(moreAction, 'admin package more action should expose expanded state').toHaveAttribute('aria-expanded', 'true');
    const copyMenu = page.locator('[data-testid="admin-package-copy-menu"]').first();
    await expect(copyMenu, 'admin package copy menu should open from keyboard').toBeVisible();
    await expect(copyMenu).toHaveAttribute('role', 'menu');
    const firstCopyMenuItem = page.locator('[data-testid="admin-package-copy-menu-item"]:visible').first();
    await expect(firstCopyMenuItem, 'admin package copy menu should move focus to the first item').toBeFocused();
    await expectCanFocus(firstCopyMenuItem, 'admin package copy menu item');

    await page.keyboard.press('Escape');
    await expect(copyMenu, 'admin package copy menu should close with Escape').toBeHidden();
    await expect(moreAction, 'admin package more action should expose collapsed state after Escape').toHaveAttribute('aria-expanded', 'false');
    await expect(moreAction, 'admin package more action should regain focus after Escape').toBeFocused();
  });

  test('admin package mobile card actions are keyboard focusable', async ({ page }) => {
    await page.goto('/admin/packages', { waitUntil: 'commit' });
    await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const mobileEditAction = page.locator('[data-testid="admin-package-mobile-edit-action"]:visible').first();
    if (!(await mobileEditAction.count())) {
      const reviewAction = page.locator('[data-testid="admin-package-review-action"]:visible').first();
      if (await reviewAction.count()) {
        await expectCanFocus(reviewAction, 'admin package desktop review action fallback');
        return;
      }
      await expectCanFocus(page.locator('input[type="email"], input[name="email"]').first(), 'admin login email');
      await expectCanFocus(page.locator('input[type="password"], input[name="password"]').first(), 'admin login password');
      await expectCanFocus(page.locator('button[type="submit"]').first(), 'admin login submit');
      return;
    }

    await expectCanFocus(mobileEditAction, 'admin package mobile edit action');

    const expectMobileActionContext = async (action: ReturnType<typeof page.locator>, label: string) => {
      await expect(action, `${label} should include the visible decision summary`).toHaveAttribute(
        'aria-describedby',
        /admin-package-mobile-decision-summary-/,
      );

      const describedBy = (await action.getAttribute('aria-describedby')) ?? '';
      const describedByIds = describedBy.split(/\s+/).filter(Boolean);
      const nextActionSummaryId = describedByIds.find(id => id.startsWith('admin-package-mobile-next-action-summary-'));
      const riskSummaryId = describedByIds.find(id => id.startsWith('admin-package-mobile-risk-summary-'));

      expect(nextActionSummaryId, `${label} should describe the visible next action summary`).toBeTruthy();
      expect(riskSummaryId, `${label} should describe the visible risk summary`).toBeTruthy();

      if (nextActionSummaryId) {
        await expect(page.locator(`[id="${nextActionSummaryId}"]`), `${label} next action summary should be visible`).toContainText('다음 액션');
      }

      if (riskSummaryId) {
        await expect(page.locator(`[id="${riskSummaryId}"]`), `${label} risk summary should be visible`).toContainText('운영 사유');
      }
    };

    await expectMobileActionContext(mobileEditAction, 'admin package mobile edit action');

    const mobilePrimaryAction = page.locator(
      [
        '[data-testid="admin-package-mobile-review-action"]:visible',
        '[data-testid="admin-package-mobile-approve-action"]:visible',
        '[data-testid="admin-package-mobile-publish-action"]:visible',
        '[data-testid="admin-package-mobile-extend-action"]:visible',
      ].join(', '),
    ).first();
    await expectCanFocus(mobilePrimaryAction, 'admin package mobile primary action');
    await expectMobileActionContext(mobilePrimaryAction, 'admin package mobile primary action');

    const mobileMoreAction = page.locator('[data-testid="admin-package-mobile-more-action"]:visible').first();
    await expectCanFocus(mobileMoreAction, 'admin package mobile more action');
    await expectMobileActionContext(mobileMoreAction, 'admin package mobile more action');
  });

  test('admin payment command queue cards are keyboard focusable', async ({ page }) => {
    await page.goto('/admin/payments', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const reviewQueue = page.locator('[data-testid="admin-payment-queue-review"]:visible').first();
    if (!(await reviewQueue.count())) {
      await expectCanFocus(page.locator('input[type="email"], input[name="email"]').first(), 'admin login email');
      await expectCanFocus(page.locator('input[type="password"], input[name="password"]').first(), 'admin login password');
      await expectCanFocus(page.locator('button[type="submit"]').first(), 'admin login submit');
      return;
    }

    await expectCanFocus(reviewQueue, 'admin payment review queue');
    await expectCanFocus(page.locator('[data-testid="admin-payment-queue-unmatched"]:visible').first(), 'admin payment unmatched queue');
    const staleQueue = page.locator('[data-testid="admin-payment-queue-stale"]:visible').first();
    await expectCanFocus(staleQueue, 'admin payment stale queue');
    await expectQueueActivationState(page, staleQueue, 'admin payment stale queue');
  });

  test('admin payment row actions are keyboard focusable and open match dialog safely', async ({ page }) => {
    await page.goto('/admin/payments', { waitUntil: 'commit' });
    await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const trashAction = page.locator('[data-testid="admin-payment-trash-action"]:visible').first();
    if (!(await trashAction.count())) {
      await expectCanFocus(page.locator('input[type="email"], input[name="email"]').first(), 'admin login email');
      await expectCanFocus(page.locator('input[type="password"], input[name="password"]').first(), 'admin login password');
      await expectCanFocus(page.locator('button[type="submit"]').first(), 'admin login submit');
      return;
    }

    await expectCanFocus(trashAction, 'admin payment trash row action');
    await expect(trashAction, 'admin payment trash action should include visible next action context').toHaveAttribute(
      'aria-describedby',
      /admin-payment-row-next-action-/,
    );
    const trashActionDescriptionIds = ((await trashAction.getAttribute('aria-describedby')) ?? '').split(/\s+/).filter(Boolean);
    const trashNextActionSummaryId = trashActionDescriptionIds.find(id => id.startsWith('admin-payment-row-next-action-'));
    expect(trashNextActionSummaryId, 'admin payment trash action should describe the next action summary').toBeTruthy();
    if (trashNextActionSummaryId) {
      await expect(page.locator(`[id="${trashNextActionSummaryId}"]`)).toContainText('다음 액션');
    }

    const matchAction = page.locator('[data-testid="admin-payment-match-action"]:visible').first();
    if (!(await matchAction.count())) return;

    await expectCanFocus(matchAction, 'admin payment manual match row action');
    await expect(matchAction, 'admin payment match action should include visible next action context').toHaveAttribute(
      'aria-describedby',
      /admin-payment-row-next-action-/,
    );
    await expect(matchAction).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(matchAction).toHaveAttribute('aria-expanded', 'false');
    await expect(matchAction).toHaveAttribute('aria-controls', 'admin-payment-match-dialog');
    await page.keyboard.press('Enter');

    const matchDialog = page.locator('[data-testid="admin-payment-match-dialog"]');
    await expect(matchDialog).toBeVisible();
    await expect(matchAction).toHaveAttribute('aria-expanded', 'true');
    await expect(matchDialog).toHaveAttribute('role', 'dialog');
    await expect(matchDialog).toHaveAttribute('aria-modal', 'true');
    await expect(matchDialog).toHaveAttribute('aria-labelledby', 'payment-manual-match-title');
    await expect(matchDialog).toHaveAttribute('aria-describedby', 'payment-manual-match-description payment-manual-match-status payment-manual-match-decision-summary');
    await expect(matchDialog.locator('[data-testid="admin-payment-manual-match-decision-summary"]')).toBeVisible();
    await expectCanFocus(page.locator('[data-testid="admin-payment-match-close"]').first(), 'admin payment match dialog close');
    await page.keyboard.press('Enter');
    await expect(matchDialog).toBeHidden();
    await expect(matchAction).toHaveAttribute('aria-expanded', 'false');
    await expect(matchAction, 'admin payment match action should regain focus after close').toBeFocused();
  });

  test('admin payment trash disclosure exposes expanded state to keyboard users', async ({ page }) => {
    await page.goto('/admin/payments', { waitUntil: 'commit' });
    await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const trashToggle = page.locator('[data-testid="admin-payment-trash-toggle"]:visible').first();
    if (!(await trashToggle.count())) {
      await expectCanFocus(page.locator('input[type="email"], input[name="email"]').first(), 'admin login email');
      await expectCanFocus(page.locator('input[type="password"], input[name="password"]').first(), 'admin login password');
      await expectCanFocus(page.locator('button[type="submit"]').first(), 'admin login submit');
      return;
    }

    await expectCanFocus(trashToggle, 'admin payment trash disclosure');
    await expect(trashToggle).toHaveAttribute('aria-controls', 'admin-payment-trash-panel');
    await expect(trashToggle).toHaveAttribute('id', 'admin-payment-trash-title');

    const isExpanded = await trashToggle.getAttribute('aria-expanded');
    if (isExpanded !== 'true') {
      await page.keyboard.press('Enter');
      await expect(trashToggle).toHaveAttribute('aria-expanded', 'true');
    }

    const trashPanel = page.locator('[data-testid="admin-payment-trash-panel"]');
    await expect(trashPanel).toBeVisible();
    await expect(trashPanel).toHaveAttribute('role', 'region');
    await expect(trashPanel).toHaveAttribute('aria-labelledby', 'admin-payment-trash-title');
    await expect(page.locator('[data-testid="admin-payment-trash-restore-action"]:visible').first()).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(trashPanel).toBeHidden();
    await expect(trashToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(trashToggle, 'admin payment trash disclosure should regain focus after Escape').toBeFocused();
  });

  test('admin payment command bar opens, focuses input, and closes with keyboard', async ({ page }) => {
    await page.goto('/admin/payments', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const commandOpen = page.locator('[data-testid="payments-command-open"]:visible').first();
    if (!(await commandOpen.count())) {
      await expectCanFocus(page.locator('input[type="email"], input[name="email"]').first(), 'admin login email');
      await expectCanFocus(page.locator('input[type="password"], input[name="password"]').first(), 'admin login password');
      await expectCanFocus(page.locator('button[type="submit"]').first(), 'admin login submit');
      return;
    }

    await expectCanFocus(commandOpen, 'admin payment command open');
    await expect(commandOpen).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(commandOpen).toHaveAttribute('aria-expanded', 'false');
    await expect(commandOpen).toHaveAttribute('aria-controls', 'payments-command-dialog');
    await page.keyboard.press('Enter');

    const commandDialog = page.locator('[data-testid="payments-command-dialog"]');
    await expect(commandDialog).toBeVisible();
    await expect(commandDialog).toHaveAttribute('id', 'payments-command-dialog');
    await expect(commandDialog).toHaveAttribute('role', 'dialog');
    await expect(commandDialog).toHaveAttribute('aria-modal', 'true');
    const commandInput = page.locator('[data-testid="payments-command-input"]');
    await expect(commandInput).toBeFocused();
    await expect(commandInput).toHaveAttribute('aria-describedby', 'payments-command-help');

    await page.keyboard.press('Escape');
    await expect(commandDialog).toBeHidden();
    await expect(commandOpen, 'admin payment command open should regain focus after Escape').toBeFocused();

    await page.keyboard.press('ControlOrMeta+K');
    await expect(commandDialog).toBeVisible();
    await expect(commandInput).toBeFocused();

    await page.keyboard.press('ControlOrMeta+K');
    await expect(commandDialog).toBeHidden();
  });

  test('admin payment import panel opens from keyboard and returns focus on Escape', async ({ page }) => {
    await page.goto('/admin/payments', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const importOpen = page.locator('[data-testid="admin-payment-import-open"]:visible').first();
    if (!(await importOpen.count())) {
      await expectCanFocus(page.locator('input[type="email"], input[name="email"]').first(), 'admin login email');
      await expectCanFocus(page.locator('input[type="password"], input[name="password"]').first(), 'admin login password');
      await expectCanFocus(page.locator('button[type="submit"]').first(), 'admin login submit');
      return;
    }

    await expectCanFocus(importOpen, 'admin payment import open');
    await expect(importOpen).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(importOpen).toHaveAttribute('aria-expanded', 'false');
    await expect(importOpen).toHaveAttribute('aria-controls', 'admin-payment-import-dialog');
    await page.keyboard.press('Enter');

    const importDialog = page.locator('[data-testid="admin-payment-import-dialog"]');
    await expect(importDialog).toBeVisible();
    await expect(importOpen).toHaveAttribute('aria-expanded', 'true');
    await expect(importDialog).toHaveAttribute('role', 'dialog');
    await expect(importDialog).toHaveAttribute('aria-modal', 'true');
    await expect(importDialog).toHaveAttribute('aria-labelledby', 'payment-import-panel-title');
    await expect(page.locator('textarea').first()).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(importDialog).toBeHidden();
    await expect(importOpen).toHaveAttribute('aria-expanded', 'false');
    await expect(importOpen, 'admin payment import open should regain focus after Escape').toBeFocused();
  });
});

async function expectQueueActivationState(page: Page, target: Locator, label: string): Promise<void> {
  const isAriaDisabled = await target.getAttribute('aria-disabled');
  await page.keyboard.press('Enter');

  if (isAriaDisabled === 'true') {
    await expect(target, `${label} should stay unselected when aria-disabled`).not.toHaveAttribute('aria-pressed', 'true');
    return;
  }

  await expect(target, `${label} should expose selected state after keyboard activation`).toHaveAttribute('aria-pressed', 'true');
}

async function gotoPackageDetailWithStickyCta(page: Page): Promise<boolean> {
  return gotoPackageDetailWithVisibleSelector(page, '[data-testid="package-detail-sticky-kakao"]:visible', {
    scrollOffsets: [420, 700],
  });
}

async function gotoPackageDetailWithVisibleSelector(
  page: Page,
  selectors: string | string[],
  options: { scrollOffsets?: number[] } = {},
): Promise<boolean> {
  const selectorList = Array.isArray(selectors) ? selectors : [selectors];
  const candidates = new Set<string>([detailRoute]);

  const packageListResponse = await page.goto('/packages', { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => null);
  if (!packageListResponse && page.url() === 'about:blank') return false;
  await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => {});
  const hrefs = await page.locator('a[href^="/packages/"]').evaluateAll((links) =>
    links
      .map((link) => link.getAttribute('href'))
      .filter((href): href is string => Boolean(href)),
  );
  hrefs.slice(0, 12).forEach((href) => {
    const detailHref = normalizePackageDetailHref(href);
    if (detailHref) candidates.add(detailHref);
  });

  for (const href of Array.from(candidates).slice(0, 16)) {
    const detailResponse = await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 12_000 }).catch(() => null);
    if (!detailResponse) continue;
    await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => {});
    if ((await page.getByText('NOT_FOUND', { exact: true }).count()) > 0) continue;

    const scrollOffsets = options.scrollOffsets ?? [
      0,
      Math.min(720, Math.floor(page.viewportSize()?.height ?? 812)),
      await page.evaluate(() => Math.max(0, document.documentElement.scrollHeight - window.innerHeight - 24)),
    ];

    for (const offset of scrollOffsets) {
      await page.evaluate((scrollY) => window.scrollTo(0, scrollY), offset);
      await page.waitForTimeout(150);
      for (const selector of selectorList) {
        if ((await page.locator(selector).count()) > 0) return true;
      }
    }
  }

  return false;
}

function normalizePackageDetailHref(href: string): string | null {
  try {
    const url = new URL(href, 'http://ux-smoke.local');
    if (!/^\/packages\/[^/?#]+/.test(url.pathname)) return null;
    return `${url.pathname}${url.search}`;
  } catch {
    if (!/^\/packages\/[^/?#]+/.test(href)) return null;
    return href;
  }
}

async function expectCanFocus(target: Locator, label: string): Promise<void> {
  await expect(target, `${label} should be visible`).toBeVisible();
  await target.scrollIntoViewIfNeeded();
  await target.focus();

  await expect
    .poll(
      async () => target.evaluate((element) => element === document.activeElement || element.contains(document.activeElement)),
      { message: `${label} should accept keyboard focus` },
    )
    .toBe(true);
}
