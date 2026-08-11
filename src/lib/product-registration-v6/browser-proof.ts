import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';

import puppeteer, { type Browser, type ConsoleMessage, type Page } from 'puppeteer';

export type ProductRegistrationV6BrowserSurface = 'packages' | 'lp';

export type ProductRegistrationV6BrowserProofSurfaceResult = {
  surface: ProductRegistrationV6BrowserSurface;
  url: string;
  status: 'passed' | 'failed';
  responseStatus: number | null;
  snapshotHash: string | null;
  screenshotHash: string | null;
  bodyTextHash: string | null;
  imageCount: number;
  brokenImageCount: number;
  ctaOpened: boolean;
  hydrationErrors: string[];
  failures: string[];
};

export type ProductRegistrationV6BrowserProofResult = {
  status: 'passed' | 'failed';
  browserMode: 'remote-cdp' | 'local-chrome';
  viewport: { width: number; height: number; deviceScaleFactor: number };
  surfaces: ProductRegistrationV6BrowserProofSurfaceResult[];
  checkedAt: string;
};

const VIEWPORT = { width: 390, height: 844, deviceScaleFactor: 3 } as const;

function hash(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function localChromeCandidates(): string[] {
  return [
    process.env.PRODUCT_REGISTRATION_CHROME_EXECUTABLE_PATH,
    process.env.CHROME_EXECUTABLE_PATH,
    process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : null,
    process.platform === 'win32' ? 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe' : null,
    process.platform === 'linux' ? '/usr/bin/google-chrome-stable' : null,
    process.platform === 'linux' ? '/usr/bin/google-chrome' : null,
    process.platform === 'linux' ? '/usr/bin/chromium' : null,
  ].filter((value): value is string => Boolean(value));
}

async function openBrowser(): Promise<{ browser: Browser; mode: 'remote-cdp' | 'local-chrome' }> {
  const browserWSEndpoint = process.env.PRODUCT_REGISTRATION_BROWSER_WS_ENDPOINT?.trim();
  if (browserWSEndpoint) {
    return {
      browser: await puppeteer.connect({ browserWSEndpoint }),
      mode: 'remote-cdp',
    };
  }
  let executablePath = localChromeCandidates().find(candidate => existsSync(candidate));
  if (!executablePath) {
    try {
      const bundled = puppeteer.executablePath();
      if (bundled && existsSync(bundled)) executablePath = bundled;
    } catch {
      // A real browser is a publication prerequisite; no fetch-only fallback.
    }
  }
  if (!executablePath) throw new Error('V6_REAL_CHROME_UNAVAILABLE');
  return {
    browser: await puppeteer.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    }),
    mode: 'local-chrome',
  };
}

function collectConsoleError(message: ConsoleMessage, errors: string[]) {
  if (message.type() !== 'error') return;
  const value = message.text().trim();
  if (/favicon\.ico|Failed to load resource.*(?:404|ERR_BLOCKED_BY_CLIENT)/i.test(value)) return;
  if (/hydration|uncaught|chunkloaderror|not defined|cannot read|failed to fetch dynamically imported module/i.test(value)) {
    errors.push(value.slice(0, 500));
  }
}

async function waitForInteractive(page: Page) {
  await page.waitForFunction(() => document.readyState === 'complete', { timeout: 45_000 });
  await new Promise(resolve => setTimeout(resolve, 1_000));
}

async function proveSurface(input: {
  browser: Browser;
  surface: ProductRegistrationV6BrowserSurface;
  url: string;
  proofToken: string;
  expectedSnapshotHash: string;
}): Promise<ProductRegistrationV6BrowserProofSurfaceResult> {
  const page = await input.browser.newPage();
  const failures: string[] = [];
  const hydrationErrors: string[] = [];
  page.on('console', message => collectConsoleError(message, hydrationErrors));
  page.on('pageerror', error => hydrationErrors.push(
    (error instanceof Error ? error.message : String(error)).slice(0, 500),
  ));
  await page.setViewport(VIEWPORT);
  await page.setExtraHTTPHeaders({
    'x-product-registration-v6-proof-token': input.proofToken,
    'accept-language': 'ko-KR,ko;q=0.9',
    'cache-control': 'no-cache',
  });
  let responseStatus: number | null = null;
  let responseSnapshotHash: string | null = null;
  let screenshotHash: string | null = null;
  let bodyTextHash: string | null = null;
  let imageCount = 0;
  let brokenImageCount = 0;
  let ctaOpened = false;
  try {
    const response = await page.goto(input.url, { waitUntil: 'networkidle2', timeout: 60_000 });
    responseStatus = response?.status() ?? null;
    responseSnapshotHash = response?.headers()['x-product-registration-snapshot-hash'] ?? null;
    if (responseStatus !== 200) failures.push(`HTTP_STATUS_${responseStatus ?? 'NONE'}`);
    if (responseSnapshotHash !== input.expectedSnapshotHash) failures.push('SNAPSHOT_HASH_HEADER_MISMATCH');
    await waitForInteractive(page);
    const rendered = await page.evaluate(() => {
      const bodyText = document.body?.innerText?.replace(/\s+/g, ' ').trim() ?? '';
      const images = Array.from(document.images);
      return {
        bodyText,
        imageCount: images.length,
        brokenImageCount: images.filter(image => image.complete && image.naturalWidth === 0).length,
      };
    });
    imageCount = rendered.imageCount;
    brokenImageCount = rendered.brokenImageCount;
    bodyTextHash = hash(rendered.bodyText);
    if (rendered.bodyText.length < 200) failures.push('CUSTOMER_BODY_TOO_SHORT');
    if (/not found|찾을 수 없|상품이 없습니다/i.test(rendered.bodyText)) failures.push('CUSTOMER_NOT_FOUND_RENDERED');
    if (brokenImageCount > 0) failures.push(`BROKEN_IMAGES_${brokenImageCount}`);

    const ctaSelector = input.surface === 'packages'
      ? '[data-analytics-id="mobile_sticky_reservation"]'
      : '[data-analytics-id="lp_sticky_lead"]';
    await page.waitForSelector(ctaSelector, { visible: true, timeout: 15_000 });
    await page.click(ctaSelector);
    const dialogSelector = input.surface === 'packages'
      ? '[role="dialog"][aria-labelledby="reservation-inquiry-title"]'
      : '[data-testid="lp-lead-bottom-sheet"][role="dialog"]';
    await page.waitForSelector(dialogSelector, { visible: true, timeout: 10_000 });
    ctaOpened = true;
    const screenshot = await page.screenshot({ fullPage: true, type: 'png' });
    screenshotHash = hash(screenshot);
  } catch (error) {
    failures.push(`BROWSER_ASSERTION:${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await page.close().catch(() => undefined);
  }
  if (hydrationErrors.length > 0) failures.push('HYDRATION_OR_RUNTIME_ERROR');
  return {
    surface: input.surface,
    url: input.url,
    status: failures.length === 0 ? 'passed' : 'failed',
    responseStatus,
    snapshotHash: responseSnapshotHash,
    screenshotHash,
    bodyTextHash,
    imageCount,
    brokenImageCount,
    ctaOpened,
    hydrationErrors: [...new Set(hydrationErrors)].slice(0, 20),
    failures: [...new Set(failures)],
  };
}

export async function runProductRegistrationV6ChromeProof(input: {
  surfaceUrls: Record<ProductRegistrationV6BrowserSurface, string>;
  proofToken: string;
  expectedSnapshotHash: string;
}): Promise<ProductRegistrationV6BrowserProofResult> {
  const { browser, mode } = await openBrowser();
  try {
    const surfaces: ProductRegistrationV6BrowserProofSurfaceResult[] = [];
    for (const surface of ['packages', 'lp'] as const) {
      surfaces.push(await proveSurface({
        browser,
        surface,
        url: input.surfaceUrls[surface],
        proofToken: input.proofToken,
        expectedSnapshotHash: input.expectedSnapshotHash,
      }));
    }
    return {
      status: surfaces.every(surface => surface.status === 'passed') ? 'passed' : 'failed',
      browserMode: mode,
      viewport: VIEWPORT,
      surfaces,
      checkedAt: new Date().toISOString(),
    };
  } finally {
    await browser.close().catch(() => undefined);
  }
}
