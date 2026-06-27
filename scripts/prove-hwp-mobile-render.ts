import './load-script-env';

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { chromium, type Browser, type Page } from 'playwright';

import { supabaseAdmin } from '../src/lib/supabase';
import { getSecret } from '../src/lib/secret-registry';
import { renderPackage } from '../src/lib/render-contract';

type PackageRow = {
  id: string;
  title: string | null;
  display_title: string | null;
  destination: string | null;
  status: string | null;
  audit_status: string | null;
  audit_report: Record<string, unknown> | null;
  updated_at: string | null;
  duration: number | null;
  nights: number | null;
  trip_style: string | null;
  price: number | null;
  price_dates: unknown;
  price_tiers: unknown;
  itinerary_data: unknown;
  inclusions: unknown;
  excludes: unknown;
  optional_tours: unknown;
  accommodations: unknown;
  internal_code: string | null;
};

type CheckResult = {
  name: string;
  ok: boolean;
  detail?: string;
};

type PackageProofResult = {
  id: string;
  title: string | null;
  internal_code: string | null;
  url: string;
  http_status: number | null;
  status: 'pass' | 'fail';
  checked_at: string;
  package_updated_at: string | null;
  mobile_checks: CheckResult[];
  a4_checks: CheckResult[];
  screenshot_path?: string;
  error?: string;
};

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage:
  npx tsx scripts/prove-hwp-mobile-render.ts --package-ids=id1,id2 --base=http://127.0.0.1:3000 --apply
  npx tsx scripts/prove-hwp-mobile-render.ts --since=2026-06-26T13:50:00Z --limit=100 --base=http://127.0.0.1:3000

Options:
  --package-ids=...   Comma-separated travel_packages ids.
  --since=...         Load packages created at or after this ISO timestamp when package ids are omitted.
  --limit=...         Max packages to load, default 200.
  --base=...          Customer site base URL, default NEXT_PUBLIC_BASE_URL or http://127.0.0.1:3000.
  --output-dir=...    Report and screenshot directory.
  --apply             Persist passing mobile_browser_proof into travel_packages.audit_report.
  --json              Print the full JSON report.
`);
  process.exit(0);
}

function argValue(name: string): string | null {
  const prefix = `--${name}=`;
  const found = args.find(arg => arg.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : null;
}

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

function parseList(value: string | null): string[] {
  return String(value ?? '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

const apply = hasFlag('apply');
const jsonOnly = hasFlag('json');
const baseUrl = (argValue('base') || process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const packageIds = parseList(argValue('package-ids'));
const since = argValue('since');
const limit = Math.max(1, Math.min(Number(argValue('limit') ?? '200') || 200, 500));
const outputDir = argValue('output-dir') || path.join(process.cwd(), 'data/product-registration/hwp-inbox/reports/mobile-browser-proof');
const screenshotDir = path.join(outputDir, 'screenshots');
const viewport = { width: 390, height: 844 };

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function getItineraryDays(value: unknown): Array<Record<string, unknown>> {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  return asArray(record?.days).filter((item): item is Record<string, unknown> => (
    Boolean(item) && typeof item === 'object' && !Array.isArray(item)
  ));
}

function representativeScheduleTerms(pkg: PackageRow): string[] {
  const days = getItineraryDays(pkg.itinerary_data);
  const terms: string[] = [];
  for (const day of days) {
    for (const item of asArray((day as { schedule?: unknown }).schedule)) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const activity = normalizeText((item as { activity?: unknown }).activity);
      if (activity.length < 3) continue;
      if (/공항|출발|도착|호텔|조식|중식|석식|이동|체크|미팅|가이드/.test(activity)) continue;
      if (/추천\s*옵션|강력추천옵션|현지옵션|선택관광|현지지불옵션|옵션[:：]|^\s*[※\[]/.test(activity)) continue;
      const token = activity
        .replace(/[()[\]{}"'`]/g, ' ')
        .split(/[,\s/]+/)
        .map(part => part.trim())
        .find(part => /[가-힣A-Za-z]/.test(part) && part.length >= 3 && !/추천|옵션|선택관광/.test(part));
      if (token) terms.push(token);
      if (terms.length >= 3) return [...new Set(terms)];
    }
  }
  return [...new Set(terms)];
}

function containsAny(text: string, markers: string[]): boolean {
  return markers.some(marker => text.includes(marker));
}

function buildRenderPackageInput(pkg: PackageRow): Record<string, unknown> {
  return {
    title: pkg.display_title || pkg.title || 'Untitled package',
    destination: pkg.destination || '',
    duration: pkg.duration || undefined,
    nights: pkg.nights || undefined,
    trip_style: pkg.trip_style || undefined,
    price: pkg.price || undefined,
    price_dates: pkg.price_dates,
    price_tiers: pkg.price_tiers,
    itinerary_data: pkg.itinerary_data,
    inclusions: pkg.inclusions,
    excludes: pkg.excludes,
    optional_tours: pkg.optional_tours,
    accommodations: pkg.accommodations,
  };
}

function auditA4PayloadForPackage(pkg: PackageRow): CheckResult[] {
  const checks: CheckResult[] = [];
  try {
    const view = renderPackage(buildRenderPackageInput(pkg) as Parameters<typeof renderPackage>[0]);
    const days = asArray((view as { days?: unknown }).days);
    checks.push({
      name: 'a4_days_present',
      ok: days.length > 0,
      detail: `${days.length} day(s)`,
    });
    checks.push({
      name: 'a4_price_dates_present',
      ok: asArray(pkg.price_dates).length > 0,
      detail: `${asArray(pkg.price_dates).length} date row(s)`,
    });
    const payload = JSON.stringify(view);
    for (const forbidden of ['supplier_raw_departure_dates', 'net_price', 'internal_memo', 'land_operator']) {
      checks.push({
        name: `a4_forbidden_${forbidden}`,
        ok: !payload.includes(forbidden),
      });
    }
  } catch (error) {
    checks.push({
      name: 'a4_render_contract',
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  return checks;
}

async function clickLikelyItinerary(page: Page) {
  for (const label of ['여행 일정', '일정표', '일정']) {
    const locator = page.getByText(label, { exact: false }).first();
    if (await locator.count().catch(() => 0)) {
      await locator.click({ timeout: 1500 }).catch(() => undefined);
      await page.waitForTimeout(500);
      return;
    }
  }
}

async function inspectMobilePage(page: Page, pkg: PackageRow, proofSecret: string): Promise<PackageProofResult> {
  const checkedAt = new Date().toISOString();
  const url = `${baseUrl}/packages/${encodeURIComponent(pkg.id)}`;
  const result: PackageProofResult = {
    id: pkg.id,
    title: pkg.display_title || pkg.title,
    internal_code: pkg.internal_code,
    url,
    http_status: null,
    status: 'fail',
    checked_at: checkedAt,
    package_updated_at: pkg.updated_at,
    mobile_checks: [],
    a4_checks: auditA4PayloadForPackage(pkg),
  };

  try {
    await page.setExtraHTTPHeaders({
      'x-yeosonam-render-proof': proofSecret,
      'Cache-Control': 'no-cache',
    });
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    result.http_status = response?.status() ?? null;
    await page.waitForTimeout(1800);
    await clickLikelyItinerary(page);
    await page.evaluate(() => window.scrollTo(0, Math.min(document.body.scrollHeight, 1200))).catch(() => undefined);
    await page.waitForTimeout(500);

    const bodyText = normalizeText(await page.locator('body').innerText({ timeout: 15_000 }).catch(() => ''));
    const html = await page.content().catch(() => '');
    const days = getItineraryDays(pkg.itinerary_data);
    const expectedTerms = representativeScheduleTerms(pkg);
    const missingTerms = expectedTerms.filter(term => !bodyText.includes(term));

    result.mobile_checks.push(
      { name: 'http_200', ok: result.http_status === 200, detail: String(result.http_status ?? 'no response') },
      {
        name: 'no_application_error',
        ok: !/Application error|Internal Server Error|FUNCTION_INVOCATION_TIMEOUT|client-side exception|server-side exception/i.test(`${html} ${bodyText}`),
      },
      {
        name: 'not_not_found',
        ok: !/not found|404|상품을 찾을 수|Package not found/i.test(bodyText),
      },
      {
        name: 'price_marker_visible',
        ok: containsAny(bodyText, ['판매가', '요금', '가격', '출발일']) || /\d{1,3}(,\d{3})+\s*원/.test(bodyText),
      },
      {
        name: 'itinerary_marker_visible',
        ok: containsAny(bodyText, ['DAY 1', '여행 일정', '일정표']),
      },
      {
        name: 'booking_marker_visible',
        ok: containsAny(bodyText, ['예약 문의', '카톡 상담', '상담하기', '문의']),
      },
      {
        name: 'last_day_visible',
        ok: days.length === 0 || bodyText.includes(`DAY ${days.length}`),
        detail: `${days.length} day(s)`,
      },
      {
        name: 'representative_schedule_terms_visible',
        ok: expectedTerms.length === 0 || missingTerms.length === 0,
        detail: missingTerms.length ? `missing: ${missingTerms.join(', ')}` : `checked: ${expectedTerms.join(', ')}`,
      },
      {
        name: 'image_present',
        ok: /<img\b|_next\/image|images\.pexels\.com|supabase\.co\/storage/i.test(html),
      },
    );

    for (const forbidden of ['supplier_raw_departure_dates', 'net_price', 'internal_memo', 'land_operator']) {
      result.mobile_checks.push({
        name: `mobile_forbidden_${forbidden}`,
        ok: !bodyText.includes(forbidden),
      });
    }

    ensureDir(screenshotDir);
    const safeName = `${pkg.internal_code || pkg.id}`.replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 120);
    const screenshotPath = path.join(screenshotDir, `${safeName}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
    result.screenshot_path = screenshotPath;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    result.mobile_checks.push({ name: 'browser_navigation', ok: false, detail: result.error });
  }

  const allChecks = [...result.mobile_checks, ...result.a4_checks];
  result.status = allChecks.every(check => check.ok) ? 'pass' : 'fail';
  return result;
}

async function loadPackages(): Promise<PackageRow[]> {
  let query = supabaseAdmin
    .from('travel_packages')
    .select('id,title,display_title,destination,status,audit_status,audit_report,updated_at,duration,nights,trip_style,price,price_dates,price_tiers,itinerary_data,inclusions,excludes,optional_tours,accommodations,internal_code')
    .order('created_at', { ascending: true })
    .limit(limit);

  if (packageIds.length > 0) {
    query = query.in('id', packageIds);
  } else if (since) {
    query = query.gte('created_at', since);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as PackageRow[];
}

async function persistPassProof(result: PackageProofResult) {
  const { data: current, error: loadError } = await supabaseAdmin
    .from('travel_packages')
    .select('audit_report')
    .eq('id', result.id)
    .maybeSingle();
  if (loadError) throw new Error(loadError.message);

  const existing = current?.audit_report && typeof current.audit_report === 'object' && !Array.isArray(current.audit_report)
    ? current.audit_report as Record<string, unknown>
    : {};
  const nextReport = { ...existing };
  delete nextReport.mobile_browser_proof_required;
  nextReport.mobile_browser_proof = {
    status: 'pass',
    checked_at: result.checked_at,
    package_updated_at: result.package_updated_at,
    surfaces: ['packages'],
    url: result.url,
    http_status: result.http_status,
    viewport,
    checks: result.mobile_checks,
    a4: {
      status: result.a4_checks.every(check => check.ok) ? 'pass' : 'fail',
      checks: result.a4_checks,
    },
    screenshot_path: result.screenshot_path,
    source: 'hwp-mobile-browser-proof',
  };

  const { error } = await supabaseAdmin
    .from('travel_packages')
    .update({
      audit_report: nextReport,
      audit_checked_at: result.checked_at,
    })
    .eq('id', result.id);
  if (error) throw new Error(error.message);
}

async function main() {
  ensureDir(outputDir);
  const proofSecret = getSecret('REVALIDATE_SECRET') || getSecret('ADMIN_API_TOKEN');
  if (!proofSecret) {
    throw new Error('REVALIDATE_SECRET or ADMIN_API_TOKEN is required for non-public package render proof.');
  }

  const packages = await loadPackages();
  if (packages.length === 0) {
    throw new Error('No packages matched the requested filter.');
  }

  let browser: Browser | null = null;
  const results: PackageProofResult[] = [];
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport,
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
      userAgent: 'YeosonamHwpMobileProof/1.0 Mobile Safari',
    });
    const page = await context.newPage();

    for (const pkg of packages) {
      const result = await inspectMobilePage(page, pkg, proofSecret);
      results.push(result);
      if (!jsonOnly) {
        const failed = [...result.mobile_checks, ...result.a4_checks].filter(check => !check.ok);
        console.log(`${result.status.toUpperCase()} ${pkg.internal_code || pkg.id} ${failed.length ? failed.map(item => item.name).join(', ') : ''}`);
      }
      if (apply && result.status === 'pass') {
        await persistPassProof(result);
      }
    }
  } finally {
    await browser?.close().catch(() => undefined);
  }

  const summary = {
    total: results.length,
    pass: results.filter(result => result.status === 'pass').length,
    fail: results.filter(result => result.status === 'fail').length,
    applied: apply,
    baseUrl,
    outputDir,
  };
  const report = { summary, results };
  const reportPath = path.join(outputDir, `mobile-browser-proof-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  if (jsonOnly) {
    console.log(JSON.stringify({ ...report, reportPath }, null, 2));
  } else {
    console.log(JSON.stringify({ summary, reportPath }, null, 2));
  }
  if (summary.fail > 0) process.exitCode = 1;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
