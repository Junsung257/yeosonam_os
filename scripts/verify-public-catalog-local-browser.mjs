import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { chromium } from 'playwright';

const baseUrl = (process.argv[2] || 'http://127.0.0.1:3000').replace(/\/+$/u, '');
const screenshotArg = process.argv.find((argument) => argument.startsWith('--screenshots='));
const screenshotDir = screenshotArg ? resolve(screenshotArg.slice('--screenshots='.length)) : null;

const routes = [
  { path: '/', heading: '부산에서 떠나는' },
  { path: '/packages', heading: '현재 예약 조건을 확인할 수 있는 상품' },
  { path: '/cruise', heading: '항차와 객실부터 확인하는 크루즈' },
  { path: '/private-tour', heading: '단독 프라이빗 여행' },
  { path: '/destinations/%EB%8B%A4%EB%82%AD', heading: '다낭 여행' },
  { path: '/about', heading: '여행을 잇는 플랫폼' },
];

const viewports = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1440, height: 900 },
];

if (screenshotDir) await mkdir(screenshotDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport });
    for (const route of routes) {
      const page = await context.newPage();
      const consoleErrors = [];
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      page.on('pageerror', (error) => consoleErrors.push(error.message));

      const response = await page.goto(`${baseUrl}${route.path}`, {
        waitUntil: 'domcontentloaded',
        timeout: 90_000,
      });
      await page.waitForTimeout(750);
      const bodyText = (await page.locator('body').innerText()).trim();
      const headings = await page.locator('h1').allInnerTexts();
      const overlayCount = await page
        .locator('[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay')
        .count();
      const interactiveCount = await page.locator('a[href],button,input,select,textarea').count();
      const essentialCookiesButton = page.getByRole('button', { name: '필수만 허용' });
      const cookieConsentHandled = await essentialCookiesButton.isVisible().catch(() => false);
      if (cookieConsentHandled) {
        await essentialCookiesButton.click();
        await page.waitForTimeout(150);
      }
      const status = response?.status() ?? 0;
      const failures = [];
      if (status < 200 || status >= 400) failures.push(`HTTP_${status}`);
      if (bodyText.length < 80) failures.push('BLANK_OR_THIN_BODY');
      if (!bodyText.includes(route.heading)) failures.push('EXPECTED_HEADING_MISSING');
      if (overlayCount > 0) failures.push('FRAMEWORK_ERROR_OVERLAY');
      if (consoleErrors.length > 0) failures.push('CONSOLE_ERROR');
      if (/120\+|최근 접수 현황|3분 평균 응답|출발 보장|안전 결제/u.test(bodyText)) {
        failures.push('UNSUPPORTED_TRUST_CLAIM');
      }
      if (/yeosonam\.co\.kr/u.test(bodyText)) failures.push('OLD_DOMAIN_VISIBLE');
      if (interactiveCount === 0) failures.push('NO_INTERACTIVE_ELEMENT');

      if (screenshotDir && (route.path === '/' || route.path === '/packages')) {
        const routeName = route.path === '/' ? 'home' : 'packages';
        await page.screenshot({
          path: resolve(screenshotDir, `${routeName}-${viewport.name}.png`),
          fullPage: true,
        });
      }

      results.push({
        viewport: viewport.name,
        route: route.path,
        status,
        bodyLength: bodyText.length,
        headings,
        interactiveCount,
        cookieConsentHandled,
        overlayCount,
        consoleErrors: consoleErrors.slice(0, 5),
        failures,
      });
      await page.close();
    }
    await context.close();
  }
} finally {
  await browser.close();
}

const failed = results.filter((result) => result.failures.length > 0);
console.log(JSON.stringify({ baseUrl, passed: failed.length === 0, results }, null, 2));
if (failed.length > 0) process.exitCode = 1;
