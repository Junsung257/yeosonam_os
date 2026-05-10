import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE = 'http://127.0.0.1:3000';

const SAMPLES: Record<string, string> = {
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
  id: 'e8d25215-6638-4648-af6a-1158249fd6af',
  tenantId: 'ac59675c-0f0e-4230-b8fd-4a3857f2a83b',
  rfqId: '1',
  cardNewsId: 'e5924634-64d2-4701-9bc9-86037eb4da9e',
  group_id: '1',
  bookingId: '07799321-4161-4dee-8877-adfc2d66b1ce',
  booking_id: '07799321-4161-4dee-8877-adfc2d66b1ce',
  key: 'product-extract',
};

function resolveDynamicRoute(route: string): string {
  return route.replace(/\[([^\]]+)\]/g, (_, name) => SAMPLES[name] || 'sample');
}

const routes: string[] = fs
  .readFileSync(path.join(__dirname, 'routes-fixed.txt'), 'utf-8')
  .split('\n')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

for (const route of routes) {
  test(`re-audit ${route}`, async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const failedRequests: { url: string; status: number }[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('response', (res) => {
      if (res.status() >= 400) failedRequests.push({ url: res.url(), status: res.status() });
    });

    const url = BASE + resolveDynamicRoute(route);
    const start = Date.now();
    let status = 0;
    try {
      const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      status = res?.status() ?? 0;
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    } catch (err: any) {
      pageErrors.push(`navigation: ${err.message}`);
    }
    const loadMs = Date.now() - start;

    const realPageErrors = pageErrors.filter((e) => !e.includes('Unexpected token') && !e.includes('<!DOCTYPE'));
    const fives = failedRequests.filter((f) => f.status >= 500);

    const r = {
      route,
      status,
      loadMs,
      pageErrors: realPageErrors.slice(0, 3),
      consoleErrors: consoleErrors.slice(0, 3),
      api5xx: fives.slice(0, 5).map((f) => `${f.status} ${f.url.split(/[?]/)[0].split('/').slice(-3).join('/')}`),
    };

    fs.appendFileSync(path.join(__dirname, 'results-fixed.ndjson'), JSON.stringify(r) + '\n');
  });
}
