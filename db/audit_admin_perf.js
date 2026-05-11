// 어드민 페이지 속도 측정 — Playwright 기반
// 사용: node db/audit_admin_perf.js
// dev-admin 쿠키 필수: GET /api/debug/dev-admin-login?mode=on 먼저 실행

const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3000';
const PAGES = [
  '/admin',
  '/admin/customers',
  '/admin/bookings',
  '/admin/packages',
  '/admin/analytics',
  '/admin/attractions',
  '/admin/affiliates',
  '/admin/affiliate-analytics',
  '/admin/control-tower',
  '/admin/marketing/card-news',
  '/admin/blog',
  '/admin/ledger',
  '/admin/scoring',
  '/admin/inbox',
  '/admin/jarvis',
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addCookies([{
    name: 'ys-dev-admin', value: '1', domain: 'localhost', path: '/',
    httpOnly: false, secure: false, sameSite: 'Lax'
  }]);

  const results = [];

  for (const url of PAGES) {
    // 같은 페이지 2회 측정: cold(첫 컴파일) + warm
    for (const pass of ['cold', 'warm']) {
      const page = await context.newPage();
      const reqs = [];
      const slowReqs = [];

      page.on('requestfinished', async (req) => {
        try {
          const t = req.timing();
          const resp = await req.response();
          if (!resp) return;
          const total = t.responseEnd - t.startTime;
          const rec = {
            url: req.url().replace(BASE, ''),
            method: req.method(),
            status: resp.status(),
            ms: Math.round(total),
            ttfb: Math.round(t.responseStart - t.startTime),
          };
          reqs.push(rec);
          if (total > 300 && rec.url.startsWith('/api/')) slowReqs.push(rec);
        } catch (_) {}
      });

      const t0 = Date.now();
      let navError = null;
      try {
        await page.goto(BASE + url, { waitUntil: 'networkidle', timeout: 90_000 });
      } catch (e) {
        navError = e.message?.slice(0, 80);
      }
      const wallMs = Date.now() - t0;

      // browser-side metrics
      const metrics = await page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0] || {};
        const paint = performance.getEntriesByType('paint');
        const fcp = paint.find(p => p.name === 'first-contentful-paint')?.startTime || 0;
        const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
        const lcp = lcpEntries[lcpEntries.length - 1]?.startTime || 0;
        let domNodes = 0;
        try { domNodes = document.querySelectorAll('*').length; } catch (_) {}
        const resources = performance.getEntriesByType('resource');
        const jsBytes = resources
          .filter(r => r.name.includes('.js') || r.initiatorType === 'script')
          .reduce((s, r) => s + (r.transferSize || 0), 0);
        return {
          ttfb: Math.round(nav.responseStart || 0),
          dcl: Math.round(nav.domContentLoadedEventEnd || 0),
          load: Math.round(nav.loadEventEnd || 0),
          fcp: Math.round(fcp),
          lcp: Math.round(lcp),
          domNodes,
          jsTransferKB: Math.round(jsBytes / 1024),
          resourceCount: resources.length,
        };
      });

      const apiReqs = reqs.filter(r => r.url.startsWith('/api/'));
      const apiBreakdown = apiReqs
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 5)
        .map(r => ({ url: r.url, ms: r.ms, status: r.status }));

      results.push({
        url, pass, wallMs, navError, metrics,
        apiCount: apiReqs.length,
        slowApiCount: slowReqs.length,
        top5SlowApi: apiBreakdown,
      });

      console.log(`[${pass}] ${url.padEnd(40)} wall=${wallMs}ms lcp=${metrics.lcp}ms dom=${metrics.domNodes} api=${apiReqs.length} slow=${slowReqs.length}`);
      await page.close();
    }
  }

  await browser.close();

  const out = path.join(__dirname, 'admin_perf_results.json');
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
  console.log('\n=== Saved:', out);

  // 요약
  const warm = results.filter(r => r.pass === 'warm');
  console.log('\n=== WARM LOAD SUMMARY (sorted by wall time) ===');
  warm.sort((a, b) => b.wallMs - a.wallMs).forEach(r => {
    console.log(`${r.wallMs.toString().padStart(6)}ms  lcp=${r.metrics.lcp.toString().padStart(5)}ms  api=${r.apiCount.toString().padStart(2)}  slow=${r.slowApiCount}  ${r.url}`);
  });

  // 최악 API
  console.log('\n=== TOP SLOW API CALLS (across all warm loads) ===');
  const apiAgg = new Map();
  warm.forEach(r => r.top5SlowApi.forEach(a => {
    const cur = apiAgg.get(a.url) || { count: 0, totalMs: 0, maxMs: 0 };
    cur.count++; cur.totalMs += a.ms; cur.maxMs = Math.max(cur.maxMs, a.ms);
    apiAgg.set(a.url, cur);
  }));
  [...apiAgg.entries()]
    .sort((a, b) => b[1].maxMs - a[1].maxMs)
    .slice(0, 15)
    .forEach(([url, s]) => {
      console.log(`max=${s.maxMs.toString().padStart(5)}ms  avg=${Math.round(s.totalMs/s.count).toString().padStart(5)}ms  n=${s.count}  ${url}`);
    });
})().catch(e => { console.error(e); process.exit(1); });
