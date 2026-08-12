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
  rendererBuildId: string | null;
  screenshotHash: string | null;
  /** Transient capture bytes. The publication layer stores these in the
   * private source bucket and removes them before the proof JSON is saved. */
  screenshotPng: Uint8Array | null;
  screenshotState: 'customer-page-before-cta' | null;
  bodyTextHash: string | null;
  koreanFontReady: boolean;
  imageCount: number;
  brokenImageCount: number;
  ctaOpened: boolean;
  requiredTextChecked: string[];
  missingRequiredText: string[];
  forbiddenTextFound: string[];
  hydrationErrors: string[];
  failures: string[];
};

export type ProductRegistrationV6BrowserProofResult = {
  status: 'passed' | 'failed';
  browserMode: 'remote-cdp' | 'local-chrome' | 'serverless-chromium';
  viewport: { width: number; height: number; deviceScaleFactor: number };
  surfaces: ProductRegistrationV6BrowserProofSurfaceResult[];
  checkedAt: string;
};

const VIEWPORT = { width: 390, height: 844, deviceScaleFactor: 3 } as const;
let serverlessChromiumExecutable: Promise<string> | null = null;

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

async function openBrowser(): Promise<{
  browser: Browser;
  mode: ProductRegistrationV6BrowserProofResult['browserMode'];
}> {
  const browserWSEndpoint = process.env.PRODUCT_REGISTRATION_BROWSER_WS_ENDPOINT?.trim();
  if (browserWSEndpoint) {
    return {
      browser: await puppeteer.connect({ browserWSEndpoint }),
      mode: 'remote-cdp',
    };
  }
  let executablePath = localChromeCandidates().find(candidate => existsSync(candidate));
  let mode: ProductRegistrationV6BrowserProofResult['browserMode'] = 'local-chrome';
  if (!executablePath) {
    try {
      const bundled = puppeteer.executablePath();
      if (bundled && existsSync(bundled)) executablePath = bundled;
    } catch {
      // A real browser is a publication prerequisite; no fetch-only fallback.
    }
  }
  let serverlessArgs: string[] = [];
  if (!executablePath && process.platform === 'linux') {
    const chromium = (await import('@sparticuz/chromium-min')).default;
    const packUrl = process.env.PRODUCT_REGISTRATION_CHROMIUM_PACK_URL?.trim()
      || 'https://github.com/Sparticuz/chromium/releases/download/v148.0.0/chromium-v148.0.0-pack.x64.tar';
    serverlessChromiumExecutable ??= chromium.executablePath(packUrl).catch(error => {
      serverlessChromiumExecutable = null;
      throw error;
    });
    executablePath = await serverlessChromiumExecutable;
    serverlessArgs = chromium.args;
    mode = 'serverless-chromium';
  }
  if (!executablePath) throw new Error('V6_REAL_CHROME_UNAVAILABLE');
  return {
    browser: await puppeteer.launch({
      executablePath,
      headless: true,
      args: [...new Set([
        ...serverlessArgs,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ])],
    }),
    mode,
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
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
  });
  await page.evaluate(async () => {
    const delay = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
    const max = Math.max(document.body?.scrollHeight ?? 0, document.documentElement?.scrollHeight ?? 0);
    for (let y = 0; y < max; y += Math.max(500, window.innerHeight * 0.8)) {
      window.scrollTo(0, y);
      await delay(80);
    }
    window.scrollTo(0, 0);
  });
  await new Promise(resolve => setTimeout(resolve, 800));
}

async function proveSurface(input: {
  browser: Browser;
  surface: ProductRegistrationV6BrowserSurface;
  url: string;
  proofToken: string;
  expectedSnapshotHash: string;
  expectedRendererBuildId: string;
  requiredText: string[];
  forbiddenText: string[];
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
    ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET
      ? {
          'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
          'x-vercel-set-bypass-cookie': 'true',
        }
      : {}),
  });
  let responseStatus: number | null = null;
  let responseSnapshotHash: string | null = null;
  let responseRendererBuildId: string | null = null;
  let screenshotHash: string | null = null;
  let screenshotPng: Uint8Array | null = null;
  let screenshotState: ProductRegistrationV6BrowserProofSurfaceResult['screenshotState'] = null;
  let bodyTextHash: string | null = null;
  let koreanFontReady = false;
  let imageCount = 0;
  let brokenImageCount = 0;
  let ctaOpened = false;
  let missingRequiredText: string[] = [];
  let forbiddenTextFound: string[] = [];
  try {
    const response = await page.goto(input.url, { waitUntil: 'networkidle2', timeout: 60_000 });
    responseStatus = response?.status() ?? null;
    responseSnapshotHash = response?.headers()['x-product-registration-snapshot-hash'] ?? null;
    responseRendererBuildId = response?.headers()['x-product-registration-renderer-build-id'] ?? null;
    if (responseStatus !== 200) failures.push(`HTTP_STATUS_${responseStatus ?? 'NONE'}`);
    await waitForInteractive(page);

    // The retained visual artifact must show the customer page itself, not a
    // full-page Chromium capture with a fixed consent or lead dialog repeated
    // across scroll tiles. Keep essential-only consent for the proof session,
    // capture the readable page, then exercise the CTA as a separate assertion.
    await page.evaluate(() => {
      const consent = document.querySelector<HTMLElement>('[role="dialog"][aria-labelledby="consent-title"]');
      const essentialOnly = consent?.querySelector<HTMLButtonElement>('button.bg-slate-100');
      essentialOnly?.click();
    });
    await new Promise(resolve => setTimeout(resolve, 300));
    const customerPageScreenshot = await page.screenshot({ fullPage: true, type: 'png' });
    screenshotHash = hash(customerPageScreenshot);
    screenshotPng = customerPageScreenshot;
    screenshotState = 'customer-page-before-cta';

    const ctaSelector = input.surface === 'packages'
      ? '[data-analytics-id="mobile_sticky_reservation"]'
      : '[data-analytics-id="lp_sticky_lead"]';
    await page.waitForSelector(ctaSelector, { visible: true, timeout: 15_000 });
    const ctaActionable = await page.evaluate((selector) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      if (rect.width <= 0 || rect.height <= 0
        || style.display === 'none'
        || style.visibility === 'hidden'
        || style.pointerEvents === 'none') return false;
      element.click();
      return true;
    }, ctaSelector);
    if (!ctaActionable) throw new Error('CUSTOMER_CTA_NOT_ACTIONABLE');
    const dialogSelector = input.surface === 'packages'
      ? '[role="dialog"][aria-labelledby="reservation-inquiry-title"]'
      : '[data-testid="lp-lead-bottom-sheet"][role="dialog"]';
    await page.waitForSelector(dialogSelector, { visible: true, timeout: 10_000 });
    ctaOpened = true;
    if (input.surface === 'lp') {
      await page.evaluate(() => {
        const button = Array.from(document.querySelectorAll('button'))
          .find(item => item.textContent?.includes('약관 보기'));
        if (button instanceof HTMLElement) button.click();
      });
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    const rendered = await page.evaluate(() => {
      const bodyText = document.body?.innerText?.replace(/\s+/g, ' ').trim() ?? '';
      const images = Array.from(document.images);
      const meta = (name: string) => document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? null;
      return {
        bodyText,
        koreanFontReady: Boolean(document.fonts?.check(
          '16px "Yeosonam Korean"',
          '한글 상품 가격 일정 고객',
        )),
        imageCount: images.length,
        brokenImageCount: images.filter(image => image.complete && image.naturalWidth === 0).length,
        snapshotHash: meta('product-registration-v5-snapshot-hash'),
        rendererBuildId: meta('product-registration-v5-renderer-build-id'),
      };
    });
    responseSnapshotHash ??= rendered.snapshotHash;
    responseRendererBuildId ??= rendered.rendererBuildId;
    koreanFontReady = rendered.koreanFontReady;
    if (responseSnapshotHash !== input.expectedSnapshotHash) failures.push('SNAPSHOT_HASH_LINEAGE_MISMATCH');
    if (responseRendererBuildId !== input.expectedRendererBuildId) failures.push('RENDERER_BUILD_LINEAGE_MISMATCH');
    if (!koreanFontReady) failures.push('KOREAN_WEBFONT_NOT_READY');
    imageCount = rendered.imageCount;
    brokenImageCount = rendered.brokenImageCount;
    bodyTextHash = hash(rendered.bodyText);
    const normalizedBodyText = rendered.bodyText.replace(/\s+/g, ' ').trim();
    missingRequiredText = input.requiredText.filter(value => !normalizedBodyText.includes(value.replace(/\s+/g, ' ').trim()));
    forbiddenTextFound = input.forbiddenText.filter(value => normalizedBodyText.includes(value.replace(/\s+/g, ' ').trim()));
    if (rendered.bodyText.length < 200) failures.push('CUSTOMER_BODY_TOO_SHORT');
    if (/not found|찾을 수 없|상품이 없습니다/i.test(rendered.bodyText)) failures.push('CUSTOMER_NOT_FOUND_RENDERED');
    if (brokenImageCount > 0) failures.push(`BROKEN_IMAGES_${brokenImageCount}`);
    if (missingRequiredText.length > 0) failures.push(`REQUIRED_CUSTOMER_FACTS_MISSING_${missingRequiredText.length}`);
    if (forbiddenTextFound.length > 0) failures.push(`UNVERIFIED_CUSTOMER_FACTS_VISIBLE_${forbiddenTextFound.length}`);
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
    rendererBuildId: responseRendererBuildId,
    screenshotHash,
    screenshotPng,
    screenshotState,
    bodyTextHash,
    koreanFontReady,
    imageCount,
    brokenImageCount,
    ctaOpened,
    requiredTextChecked: input.requiredText,
    missingRequiredText,
    forbiddenTextFound,
    hydrationErrors: [...new Set(hydrationErrors)].slice(0, 20),
    failures: [...new Set(failures)],
  };
}

export async function runProductRegistrationV6ChromeProof(input: {
  surfaceUrls: Record<ProductRegistrationV6BrowserSurface, string>;
  proofToken: string;
  expectedSnapshotHash: string;
  expectedRendererBuildId: string;
  requiredText: string[];
  forbiddenText: string[];
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
        expectedRendererBuildId: input.expectedRendererBuildId,
        requiredText: input.requiredText,
        forbiddenText: input.forbiddenText,
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
