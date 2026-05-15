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
 * G3 무료 quota 가드 (2026-05-15 박제): 월 누적 elapsed 시간 임계치 초과 시 skip.
 * 사장님 비용 0 유지 — Vercel Hobby/Pro plan 무관하게 일정 한도 안에서만 호출.
 * 환경변수 PLAYWRIGHT_MONTHLY_QUOTA_HOURS 로 임계치 조정 (기본 4시간 = Vercel Hobby 안전 마진).
 */
async function checkMonthlyQuota(): Promise<{ allowed: boolean; usedMs: number; quotaMs: number }> {
  const quotaHours = Number(process.env.PLAYWRIGHT_MONTHLY_QUOTA_HOURS ?? 4);
  const quotaMs = quotaHours * 60 * 60 * 1000;
  try {
    const { supabaseAdmin, isSupabaseConfigured } = await import('@/lib/supabase');
    if (!isSupabaseConfigured) return { allowed: true, usedMs: 0, quotaMs };
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const { data } = await supabaseAdmin
      .from('attractions_seed_usage')
      .select('elapsed_ms')
      .gte('called_at', monthStart.toISOString())
      .eq('source', 'playwright')
      .in('status', ['success', 'timeout']);
    const usedMs = ((data ?? []) as Array<{ elapsed_ms: number }>).reduce((s, r) => s + (r.elapsed_ms ?? 0), 0);
    return { allowed: usedMs < quotaMs, usedMs, quotaMs };
  } catch {
    return { allowed: true, usedMs: 0, quotaMs }; // fail-soft (DB 오류 시 호출 허용)
  }
}

async function recordUsage(args: {
  attractionName?: string;
  url: string;
  elapsedMs: number;
  status: 'success' | 'timeout' | 'error' | 'skipped_quota';
}): Promise<void> {
  try {
    const { supabaseAdmin, isSupabaseConfigured } = await import('@/lib/supabase');
    if (!isSupabaseConfigured) return;
    await supabaseAdmin.from('attractions_seed_usage').insert({
      attraction_name: args.attractionName ?? null,
      url: args.url,
      elapsed_ms: args.elapsedMs,
      status: args.status,
      source: 'playwright',
    });
  } catch {
    /* swallow */
  }
}

/**
 * SPA OTA 페이지 fetch (env flag enabled 시만 활성).
 * 동적 import 로 playwright-core 패키지 부재 시 throw — caller 가 fail-soft.
 * 월 누적 시간 임계치 초과 시 skipped_quota 적재 후 null 반환.
 */
export async function fetchOtaWithBrowser(url: string, attractionName?: string): Promise<string | null> {
  // G3 quota check
  const quota = await checkMonthlyQuota();
  if (!quota.allowed) {
    console.warn(`[Playwright] 월 quota 초과 — used=${(quota.usedMs / 3600000).toFixed(2)}h / quota=${(quota.quotaMs / 3600000).toFixed(2)}h. 정적 fallback.`);
    void recordUsage({ attractionName, url, elapsedMs: 0, status: 'skipped_quota' });
    return null;
  }

  const startedAt = Date.now();
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

  let status: 'success' | 'timeout' | 'error' = 'success';
  let html: string | null = null;
  try {
    const ctx = await browser.newContext({
      userAgent: 'YeosonamOS/1.0 (catalog assist; contact: admin@yeosonam.com)',
      locale: 'ko-KR',
    });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PLAYWRIGHT_TIMEOUT_MS });
    // SPA 가 JS 로 컨텐츠 채우는 시간 대기 (3초)
    await page.waitForTimeout(3000);
    html = await page.content();
    if (html.length < 1000) html = null;
  } catch (e) {
    status = (e instanceof Error && /timeout/i.test(e.message)) ? 'timeout' : 'error';
    throw e;
  } finally {
    await browser.close();
    void recordUsage({
      attractionName,
      url,
      elapsedMs: Date.now() - startedAt,
      status,
    });
  }
  return html;
}
