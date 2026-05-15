/**
 * @file ota-playwright-fetcher.ts — G3 인프라 placeholder (2026-05-15)
 *
 * 사장님 비전 V5 + 본 세션 검토: 하나투어/모두투어 SPA 페이지가 정적 fetch 로 빈 HTML 반환.
 * 진짜 해결책 = headless browser. 인프라:
 *   - playwright-core (lightweight, 32MB)
 *   - @sparticuz/chromium (Vercel-friendly chromium 빌드)
 *   - Vercel Sandbox / Pro plan timeout 60s+ 필요
 *
 * 활성화 조건:
 *   1. npm install playwright-core @sparticuz/chromium
 *   2. ENABLE_PLAYWRIGHT_OTA=1 (Vercel env)
 *   3. Vercel Pro plan (Hobby 는 1024MB 메모리 한계로 chromium 못 띄움)
 *
 * 비용 예상 (사장님 결정 후 박제):
 *   - 1 attraction fetch ~10초 + ~500MB memory
 *   - Vercel Pro $0.128/CPU-hour → 1000 attractions ≈ $0.36
 *   - 월 5시간 hobby quota 충분 (1800 attractions 시드)
 *
 * 참고: https://github.com/Sparticuz/chromium
 *      https://www.zenrows.com/blog/playwright-vercel
 */

const PLAYWRIGHT_TIMEOUT_MS = 15000;

/**
 * SPA OTA 페이지 fetch (env flag enabled 시만 활성).
 * 동적 import 로 playwright-core 패키지 부재 시 throw — caller 가 fail-soft.
 */
export async function fetchOtaWithBrowser(url: string): Promise<string | null> {
  // 동적 import (패키지 없으면 throw → caller catch → 정적 fallback)
  type ChromiumPkg = {
    default?: {
      args?: string[];
      executablePath?: () => Promise<string>;
      headless?: boolean | 'shell';
    };
    args?: string[];
    executablePath?: () => Promise<string>;
    headless?: boolean | 'shell';
  };
  type PlaywrightCore = typeof import('playwright-core');

  let chromium: ChromiumPkg;
  let playwright: PlaywrightCore;
  try {
    chromium = (await import(/* webpackIgnore: true */ '@sparticuz/chromium' as string)) as ChromiumPkg;
    playwright = (await import(/* webpackIgnore: true */ 'playwright-core' as string)) as PlaywrightCore;
  } catch (e) {
    throw new Error(`playwright-core / @sparticuz/chromium 미설치 — npm install 필요: ${e instanceof Error ? e.message : 'unknown'}`);
  }

  const sparticuz = chromium.default ?? chromium;
  const browser = await playwright.chromium.launch({
    args: sparticuz.args ?? [],
    executablePath: sparticuz.executablePath ? await sparticuz.executablePath() : undefined,
    headless: true,
  });

  try {
    const ctx = await browser.newContext({
      userAgent: 'YeosonamOS/1.0 (catalog assist; contact: admin@yeosonam.com)',
      locale: 'ko-KR',
    });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PLAYWRIGHT_TIMEOUT_MS });
    // SPA 가 JS 로 컨텐츠 채우는 시간 대기 (3초)
    await page.waitForTimeout(3000);
    const html = await page.content();
    return html.length >= 1000 ? html : null;
  } finally {
    await browser.close();
  }
}
