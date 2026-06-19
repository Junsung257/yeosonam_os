import { expect, test, type Page, type TestInfo } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

interface Fixture {
  id: string;
  title: string;
  product: string;
}

interface RouteCheck {
  name: string;
  path: string;
  requireHeading?: boolean;
}

const fixturePath = path.join(__dirname, '..', 'visual', 'fixtures.json');
const fixtures: Fixture[] = fs.existsSync(fixturePath)
  ? JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
  : [];
const detailRoute = fixtures[0]?.product
  ? `/packages/${fixtures[0].product}`
  : fixtures[0]?.id
    ? `/packages/${fixtures[0].id}`
    : '/packages';

const publicRoutes: RouteCheck[] = [
  { name: 'home', path: '/', requireHeading: true },
  { name: 'packages', path: '/packages', requireHeading: true },
  { name: 'package detail', path: detailRoute, requireHeading: true },
  { name: 'concierge', path: '/concierge', requireHeading: true },
  { name: 'group inquiry', path: '/group-inquiry', requireHeading: true },
];

const adminRoutes: RouteCheck[] = [
  { name: 'admin dashboard', path: '/admin' },
  { name: 'admin bookings', path: '/admin/bookings' },
  { name: 'admin packages', path: '/admin/packages' },
  { name: 'admin payments', path: '/admin/payments' },
];

test.describe('public critical UX routes', () => {
  for (const route of publicRoutes) {
    test(`${route.name} renders without console errors or horizontal overflow`, async ({ page }, testInfo) => {
      await verifyRoute(page, route, testInfo);
    });
  }
});

test.describe('admin critical UX routes', () => {
  for (const route of adminRoutes) {
    test(`${route.name} renders without console errors or horizontal overflow`, async ({ page }, testInfo) => {
      await verifyRoute(page, route, testInfo);
    });
  }
});

async function verifyRoute(page: Page, route: RouteCheck, testInfo: TestInfo): Promise<void> {
  const runtimeErrors = collectRuntimeErrors(page);
  const response = route.name === 'package detail'
    ? await gotoAvailablePackageDetail(page, route.path)
    : await page.goto(route.path, { waitUntil: 'domcontentloaded' });

  expect(response?.status(), `${route.path} should not return a server error`).toBeLessThan(500);
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  await expect(page.locator('body')).toBeVisible();

  if (route.requireHeading) {
    await expect(page.locator('h1').first(), `${route.path} should expose a visible H1`).toBeVisible();
  }

  await expectNoHorizontalOverflow(page, route.path);
  await expectAccessibleInteractiveNames(page, route.path);
  await captureScreenshotEvidence(page, route, testInfo);
  expect(runtimeErrors, runtimeErrors.join('\n')).toEqual([]);
}

async function gotoAvailablePackageDetail(page: Page, preferredPath: string) {
  const preferredResponse = await page.goto(preferredPath, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  if ((await page.getByText('NOT_FOUND', { exact: true }).count()) === 0) return preferredResponse;

  await page.goto('/packages', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  const firstDetailHref = await page.locator('a[href^="/packages/"]').first().getAttribute('href').catch(() => null);
  test.skip(!firstDetailHref, 'package detail fixture is unavailable in current package data');

  const response = await page.goto(firstDetailHref!, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  test.skip((await page.getByText('NOT_FOUND', { exact: true }).count()) > 0, 'package detail fixture is unavailable in current package data');
  return response;
}

function collectRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];

  page.on('console', (message) => {
    if (message.type() !== 'error') return;

    const text = message.text();
    if (isKnownConsoleNoise(text)) return;
    errors.push(`console error: ${text}`);
  });

  page.on('pageerror', (error) => {
    errors.push(`page error: ${error.message}`);
  });

  return errors;
}

function isKnownConsoleNoise(text: string): boolean {
  return [
    'favicon.ico',
    'ResizeObserver loop completed with undelivered notifications',
    'Failed to load resource: the server responded with a status of 404',
  ].some((noise) => text.includes(noise));
}

async function expectNoHorizontalOverflow(page: Page, routePath: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    const viewportWidth = root.clientWidth;
    const maxRight = viewportWidth + 2;

    const offenders = Array.from(document.body.querySelectorAll<HTMLElement>('*'))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);

        return {
          tag: element.tagName.toLowerCase(),
          id: element.id,
          className: typeof element.className === 'string' ? element.className : '',
          role: element.getAttribute('role'),
          ariaLabel: element.getAttribute('aria-label'),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          position: style.position,
        };
      })
      .filter((item) => item.width > 0 && item.right > maxRight)
      .slice(0, 5);

    return {
      clientWidth: viewportWidth,
      scrollWidth: root.scrollWidth,
      offenders,
    };
  });

  expect(
    overflow.scrollWidth,
    `${routePath} has horizontal overflow: ${JSON.stringify(overflow.offenders)}`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 2);
}

async function expectAccessibleInteractiveNames(page: Page, routePath: string): Promise<void> {
  const unnamed = await page.evaluate(() => {
    const interactiveSelector = [
      'button',
      'a[href]',
      'input:not([type="hidden"])',
      'select',
      'textarea',
      '[role="button"]',
      '[role="link"]',
      '[role="menuitem"]',
      '[role="menuitemradio"]',
      '[role="checkbox"]',
      '[role="radio"]',
      '[role="tab"]',
      '[role="switch"]',
    ].join(',');

    const normalize = (value: string | null | undefined) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const textFromIds = (ids: string | null, root: Document) => normalize(
      ids?.split(/\s+/).map((id) => root.getElementById(id)?.textContent ?? '').join(' '),
    );

    function isVisible(element: HTMLElement): boolean {
      if (element.closest('[aria-hidden="true"], [hidden], template')) return false;
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 1 && rect.height > 1 && rect.bottom >= 0 && rect.right >= 0;
    }

    function accessibleName(element: HTMLElement): string {
      const ariaLabel = normalize(element.getAttribute('aria-label'));
      if (ariaLabel) return ariaLabel;
      const labelledBy = textFromIds(element.getAttribute('aria-labelledby'), document);
      if (labelledBy) return labelledBy;

      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
        const labelText = normalize(Array.from(element.labels ?? []).map((label) => label.textContent ?? '').join(' '));
        if (labelText) return labelText;
      }

      const ownText = normalize(element.textContent);
      if (ownText) return ownText;
      const imgAlt = normalize(Array.from(element.querySelectorAll('img[alt]')).map((img) => img.getAttribute('alt') ?? '').join(' '));
      if (imgAlt) return imgAlt;
      const svgTitle = normalize(Array.from(element.querySelectorAll('svg title')).map((title) => title.textContent ?? '').join(' '));
      if (svgTitle) return svgTitle;
      return normalize(element.getAttribute('title'));
    }

    return Array.from(document.body.querySelectorAll<HTMLElement>(interactiveSelector))
      .filter((element) => {
        if (!isVisible(element)) return false;
        if (element.matches('[disabled], [aria-disabled="true"], [tabindex="-1"]')) return false;
        if (element.getAttribute('role') === 'presentation' || element.getAttribute('role') === 'none') return false;
        return accessibleName(element).length === 0;
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          role: element.getAttribute('role'),
          id: element.id,
          className: typeof element.className === 'string' ? element.className.slice(0, 120) : '',
          href: element instanceof HTMLAnchorElement ? element.getAttribute('href') : null,
          type: element instanceof HTMLInputElement ? element.type : null,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      })
      .slice(0, 8);
  });

  expect(unnamed, `${routePath} has interactive controls without accessible names: ${JSON.stringify(unnamed)}`).toEqual([]);
}

async function captureScreenshotEvidence(page: Page, route: RouteCheck, testInfo: TestInfo): Promise<void> {
  const screenshot = await page.screenshot({
    animations: 'disabled',
    caret: 'initial',
    fullPage: false,
  });
  await testInfo.attach(`ux-smoke-${testInfo.project.name}-${route.name}`, {
    body: screenshot,
    contentType: 'image/png',
  });

  const signal = await screenshotSignal(screenshot);
  expect(
    signal,
    `${route.path} screenshot looks blank: ${JSON.stringify(signal)}`,
  ).toMatchObject({
    hasDimensions: true,
    hasVisualSignal: true,
  });
}

async function screenshotSignal(buffer: Buffer): Promise<{
  hasDimensions: boolean;
  hasVisualSignal: boolean;
  width: number;
  height: number;
  luminanceStdev: number;
  nonWhiteRatio: number;
}> {
  const image = sharp(buffer);
  const metadata = await image.metadata();
  const stats = await image.stats();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const channels = stats.channels.slice(0, 3);
  const luminanceStdev = channels.reduce((sum, channel) => sum + channel.stdev, 0) / Math.max(channels.length, 1);

  const sample = await sharp(buffer)
    .resize(64, 64, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer();
  let nonWhitePixels = 0;
  for (let index = 0; index < sample.length; index += 3) {
    const red = sample[index] ?? 255;
    const green = sample[index + 1] ?? 255;
    const blue = sample[index + 2] ?? 255;
    if (red < 248 || green < 248 || blue < 248) nonWhitePixels += 1;
  }
  const pixelCount = sample.length / 3;
  const nonWhiteRatio = pixelCount > 0 ? nonWhitePixels / pixelCount : 0;

  return {
    hasDimensions: width >= 320 && height >= 600,
    hasVisualSignal: luminanceStdev > 4 || nonWhiteRatio > 0.01,
    width,
    height,
    luminanceStdev: Number(luminanceStdev.toFixed(2)),
    nonWhiteRatio: Number(nonWhiteRatio.toFixed(4)),
  };
}
