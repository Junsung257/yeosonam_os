import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE = process.env.AUDIT_BASE_URL || 'http://127.0.0.1:3000';

const SAMPLES = {
  pkg: 'e8d25215-6638-4648-af6a-1158249fd6af',
  booking: '07799321-4161-4dee-8877-adfc2d66b1ce',
  customer: 'da839629-b7ce-4d2e-b3b1-8503965a9a2f',
  tenant: 'ac59675c-0f0e-4230-b8fd-4a3857f2a83b',
  cardnews: 'e5924634-64d2-4701-9bc9-86037eb4da9e',
  terms: '755876c2-fb62-4710-9e9f-90415461e770',
  blog: '1',
  rfq: '1',
  affiliate: '1',
  city: 'singapore',
  region: 'southeast-asia',
  slug: 'singapore-package',
  token: 'sample-token',
  code: 'sample-code',
  id: '1',
  tenantId: 'ac59675c-0f0e-4230-b8fd-4a3857f2a83b',
  rfqId: '1',
  cardNewsId: 'e5924634-64d2-4701-9bc9-86037eb4da9e',
  group_id: '1',
  bookingId: '07799321-4161-4dee-8877-adfc2d66b1ce',
  booking_id: '07799321-4161-4dee-8877-adfc2d66b1ce',
  key: 'product-extract',
};

function resolveDynamicRoute(route: string): string {
  return route.replace(/\[([^\]]+)\]/g, (_, name) => {
    const v = (SAMPLES as any)[name];
    if (v) return String(v);
    return 'sample';
  });
}

const routes: string[] = fs
  .readFileSync(path.join(__dirname, 'routes.txt'), 'utf-8')
  .split('\n')
  .map((s) => s.trim())
  .filter((s) => s.length > 0 && !s.startsWith('#'));

type AuditResult = {
  route: string;
  url: string;
  status: number;
  loadMs: number;
  domContentLoadedMs: number;
  consoleErrors: string[];
  consoleWarns: string[];
  pageErrors: string[];
  failedRequests: { url: string; status: number; reason?: string }[];
  hasErrorText: boolean;
  buttonCount: number;
  buttonsNoHandler: number;
  linksCount: number;
  brokenLinks: number;
  bodyTextSnippet: string;
};

const RESULTS: AuditResult[] = [];

function safeName(r: string) {
  return r.replace(/[^a-z0-9]/gi, '_').slice(0, 60);
}

for (const route of routes) {
  test(`audit ${route}`, async ({ page }) => {
    const consoleErrors: string[] = [];
    const consoleWarns: string[] = [];
    const pageErrors: string[] = [];
    const failedRequests: { url: string; status: number; reason?: string }[] = [];

    page.on('console', (msg) => {
      const t = msg.type();
      const text = msg.text();
      // Filter benign
      if (text.includes('Download the React DevTools')) return;
      if (text.includes('Fast Refresh')) return;
      if (t === 'error') consoleErrors.push(text);
      else if (t === 'warning') consoleWarns.push(text);
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('requestfailed', (req) =>
      failedRequests.push({ url: req.url(), status: 0, reason: req.failure()?.errorText }),
    );
    page.on('response', (res) => {
      if (res.status() >= 400) {
        failedRequests.push({ url: res.url(), status: res.status() });
      }
    });

    const url = BASE + resolveDynamicRoute(route);
    const start = Date.now();
    let status = 0;
    let domLoaded = 0;

    try {
      const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      status = res?.status() ?? 0;
      domLoaded = Date.now() - start;
      // wait for hydration / redirects
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    } catch (err: any) {
      pageErrors.push(`navigation: ${err.message}`);
    }

    const loadMs = Date.now() - start;

    let bodyTextSnippet = '';
    let hasErrorText = false;
    let buttonCount = 0;
    let buttonsNoHandler = 0;
    let linksCount = 0;
    let brokenLinks = 0;

    try {
      // Get main content text only (exclude AdminLayout sidebar)
      const mainText = await page.evaluate(() => {
        const main = document.querySelector('main') || document.body;
        // Try to exclude any navigation
        return (main as HTMLElement)?.innerText?.slice(0, 2000) || '';
      });
      bodyTextSnippet = mainText;
      // Strict patterns — must be clearly an error message, not a sidebar label
      const errPatterns = [
        'this page could not be found',
        'page not found',
        'internal server error',
        'application error: a client-side exception',
        'something went wrong',
        '문제가 발생했',
        '오류가 발생했',
        '페이지를 찾을 수 없',
        'unhandled runtime error',
        'unhandled exception',
        'next.js error',
      ];
      const lower = mainText.toLowerCase();
      hasErrorText = errPatterns.some((p) => lower.includes(p.toLowerCase()));

      buttonCount = await page.locator('button:visible').count();
      // buttons without onclick/type=submit/data-action — heuristic
      buttonsNoHandler = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        let n = 0;
        for (const b of btns) {
          if (!(b as HTMLElement).offsetParent) continue; // not visible
          const hasClick = (b as any).onclick || b.hasAttribute('onclick');
          const isSubmit = b.getAttribute('type') === 'submit';
          const inForm = !!b.closest('form');
          const hasReactHandler = Object.keys(b).some((k) => k.startsWith('__reactProps') || k.startsWith('__reactEventHandlers'));
          // React adds props internally; we can't detect handlers reliably — just count disabled-no-handler obvious cases
          if (b.disabled) continue;
          if (!hasClick && !isSubmit && !inForm && !hasReactHandler) n++;
        }
        return n;
      });

      const linkInfo = await page.evaluate(() => {
        const as = Array.from(document.querySelectorAll('a'));
        let count = 0;
        let broken = 0;
        for (const a of as) {
          const href = a.getAttribute('href');
          if (!href) continue;
          if (href === '#' || href === '') {
            broken++;
            count++;
            continue;
          }
          if (href.startsWith('javascript:')) {
            broken++;
            count++;
            continue;
          }
          count++;
        }
        return { count, broken };
      });
      linksCount = linkInfo.count;
      brokenLinks = linkInfo.broken;
    } catch {}

    const r: AuditResult = {
      route,
      url,
      status,
      loadMs,
      domContentLoadedMs: domLoaded,
      consoleErrors: consoleErrors.slice(0, 10),
      consoleWarns: consoleWarns.slice(0, 5),
      pageErrors: pageErrors.slice(0, 5),
      failedRequests: failedRequests.slice(0, 10),
      hasErrorText,
      buttonCount,
      buttonsNoHandler,
      linksCount,
      brokenLinks,
      bodyTextSnippet: bodyTextSnippet.slice(0, 300),
    };
    RESULTS.push(r);

    // append-on-the-fly so partial results survive
    fs.appendFileSync(
      path.join(__dirname, 'results.ndjson'),
      JSON.stringify(r) + '\n',
    );
  });
}

test.afterAll(async () => {
  fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(RESULTS, null, 2));
});
