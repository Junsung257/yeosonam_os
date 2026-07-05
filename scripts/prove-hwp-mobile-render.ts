import './load-script-env';

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { chromium, type Browser, type Page } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

import { supabaseAdmin } from '../src/lib/supabase';
import { getSecret } from '../src/lib/secret-registry';
import { renderPackage } from '../src/lib/render-contract';
import { auditCustomerVisibleScreenText } from '../src/lib/customer-visible-text-audit';

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

type SurfaceName = 'packages' | 'lp';

type SurfaceProofResult = {
  surface: SurfaceName;
  url: string;
  http_status: number | null;
  status: 'pass' | 'fail';
  checks: CheckResult[];
  screen_hash?: string;
  customer_visible_hash?: string;
  screenshot_path?: string;
  error?: string;
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
  surface_results: SurfaceProofResult[];
  screenshot_path?: string;
  error?: string;
};

const args = process.argv.slice(2);

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

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
  --apply             Persist mobile_browser_proof into travel_packages.audit_report.
  --apply-pass-only   Persist only passing mobile_browser_proof results; failed proofs stay report-only.
  --continue-on-fail  Keep exit code 0 when some packages fail; useful for pass-only refresh batches.
  --skip-lp           Check /packages only. Default checks /packages and /lp.
  --skip-axe          Skip automated WCAG accessibility scan.
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

const apply = hasFlag('apply') || hasFlag('apply-pass-only');
const applyPassOnly = hasFlag('apply-pass-only');
const continueOnFail = hasFlag('continue-on-fail');
const jsonOnly = hasFlag('json');
const checkLp = !hasFlag('skip-lp');
const runAxe = !hasFlag('skip-axe');
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
      const record = item as { activity?: unknown; landing_sentence?: unknown; type?: unknown; entity_kind?: unknown };
      const activity = normalizeText(record.landing_sentence || record.activity);
      if (activity.length < 3) continue;
      if (/공항|출발|도착|호텔|조식|중식|석식|식사|이동|체크|미팅|가이드|옵션|쇼핑|전용차량|자유시간/i.test(activity)) continue;
      if (['meal', 'transfer', 'hotel_stay', 'shopping', 'optional_tour'].includes(String(record.entity_kind ?? record.type ?? ''))) continue;
      const token = activity
        .replace(/[()[\]{}"'`]/g, ' ')
        .split(/[,\s/]+/)
        .map(part => part.trim())
        .find(part => /[\uAC00-\uD7A3A-Za-z]/.test(part) && part.length >= 2);
      if (token) terms.push(token);
      if (terms.length >= 3) return [...new Set(terms)];
    }
  }
  return [...new Set(terms)];
}

function containsAny(text: string, markers: string[]): boolean {
  return markers.some(marker => marker && text.includes(marker));
}

function visibleTextQualityIssues(text: string): string[] {
  const lines = text
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean);
  const issues: string[] = [];
  const brokenLines = lines.filter(line => /\?{2,}/.test(line)).slice(0, 8);
  if (brokenLines.length > 0) {
    issues.push(`question_mark_placeholders: ${brokenLines.join(' | ')}`);
  }
  if (/[�ÃÂ]|(?:챙|챘|챗|챠|챨)[\u0080-\u00ff]/i.test(text)) {
    issues.push('mojibake_characters_visible');
  }
  const koreanMojibakeLines = lines
    .filter(line => /(?:李|留|硫|紐|吏|泥|媛|怨|臾|諛|異|痍|蹂|湲|踰|쨌|竊)/.test(line))
    .slice(0, 8);
  if (koreanMojibakeLines.length > 0) {
    issues.push(`korean_mojibake_lines_visible: ${koreanMojibakeLines.join(' | ')}`);
  }
  const htmlEntityLines = lines.filter(line => /&#(?:x[0-9a-f]+|\d+);/i.test(line)).slice(0, 8);
  if (htmlEntityLines.length > 0) {
    issues.push(`html_entities_visible: ${htmlEntityLines.join(' | ')}`);
  }
  const customerUnsafePhrases = [
    '자동 생성 설명',
    '사진은 정확한 자료가 확인될 때만 노출합니다',
    '일정에서 소개되는 관광 포인트입니다',
  ];
  const unsafeHits = customerUnsafePhrases.filter(phrase => text.includes(phrase));
  if (unsafeHits.length > 0) {
    issues.push(`generic_internal_copy_visible: ${unsafeHits.join(', ')}`);
  }
  const copyIssues = auditCustomerVisibleScreenText(text, { surface: 'mobile-proof' });
  if (copyIssues.length > 0) {
    issues.push(`customer_copy_quality: ${copyIssues
      .slice(0, 12)
      .map(issue => `${issue.code}@${issue.line ?? issue.fieldPath}:${issue.value}`)
      .join(' | ')}`);
  }
  return issues;
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
  for (const label of ['여행 일정', '상세 일정', '일정', 'DAY 1']) {
    const locator = page.getByText(label, { exact: false }).first();
    if (await locator.count().catch(() => 0)) {
      await locator.click({ timeout: 1500 }).catch(() => undefined);
      await page.waitForTimeout(500);
      return;
    }
  }
}

async function runAccessibilityCheck(page: Page, surface: SurfaceName): Promise<CheckResult> {
  if (!runAxe) return { name: `${surface}_accessibility_wcag`, ok: true, detail: 'skipped' };
  try {
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const warningRuleIds = new Set(['color-contrast', 'scrollable-region-focusable']);
    const serious = violations.filter(violation =>
      ['critical', 'serious'].includes(String(violation.impact ?? '')),
    );
    const blocking = serious.filter(violation => !warningRuleIds.has(violation.id));
    const warnings = serious.filter(violation => warningRuleIds.has(violation.id));
    return {
      name: `${surface}_accessibility_wcag`,
      ok: blocking.length === 0,
      detail: serious.length === 0
        ? 'ok'
        : [
            blocking.length > 0 ? `blocking=${blocking.slice(0, 8).map(violation => `${violation.id}:${violation.nodes.length}`).join(',')}` : null,
            warnings.length > 0 ? `warnings=${warnings.slice(0, 8).map(violation => `${violation.id}:${violation.nodes.length}`).join(',')}` : null,
          ].filter(Boolean).join(' '),
    };
  } catch (error) {
    return {
      name: `${surface}_accessibility_wcag`,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function inspectCustomerSurface(page: Page, pkg: PackageRow, proofSecret: string, surface: SurfaceName): Promise<SurfaceProofResult> {
  const url = `${baseUrl}/${surface}/${encodeURIComponent(pkg.id)}`;
  const result: SurfaceProofResult = {
    surface,
    url,
    http_status: null,
    status: 'fail',
    checks: [],
  };

  try {
    await page.setExtraHTTPHeaders({
      'x-yeosonam-render-proof': proofSecret,
      'Cache-Control': 'no-cache',
    });
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    result.http_status = response?.status() ?? null;
    await page.waitForTimeout(1800);

    if (surface === 'packages') {
      await clickLikelyItinerary(page);
      await page.evaluate(() => window.scrollTo(0, Math.min(document.body.scrollHeight, 1200))).catch(() => undefined);
    } else {
      await page.evaluate(() => window.scrollTo(0, Math.min(document.body.scrollHeight, 900))).catch(() => undefined);
    }
    await page.waitForTimeout(500);

    const rawBodyText = await page.locator('body').innerText({ timeout: 15_000 }).catch(() => '');
    const bodyText = normalizeText(rawBodyText);
    const html = await page.content().catch(() => '');
    result.screen_hash = sha256(html);
    result.customer_visible_hash = sha256(bodyText);
    const days = getItineraryDays(pkg.itinerary_data);
    const expectedTerms = representativeScheduleTerms(pkg);
    const missingTerms = expectedTerms.filter(term => !bodyText.includes(term));
    const textQualityIssues = visibleTextQualityIssues(rawBodyText);

    result.checks.push(
      { name: `${surface}_http_200`, ok: result.http_status === 200, detail: String(result.http_status ?? 'no response') },
      {
        name: `${surface}_no_application_error`,
        ok: !/Application error|Internal Server Error|FUNCTION_INVOCATION_TIMEOUT|client-side exception|server-side exception/i.test(`${html} ${bodyText}`),
      },
      {
        name: `${surface}_not_not_found`,
        ok: !/not found|404|상품을 찾을 수|Package not found/i.test(bodyText),
      },
      {
        name: `${surface}_price_marker_visible`,
        ok: containsAny(bodyText, ['판매가', '요금', '가격', '출발일']) || /\d{1,3}(,\d{3})+\s*원/.test(bodyText),
      },
      {
        name: `${surface}_itinerary_marker_visible`,
        ok: containsAny(bodyText, ['DAY 1', '여행 일정', '상세 일정', '일정']),
      },
      {
        name: `${surface}_booking_marker_visible`,
        ok: containsAny(bodyText, ['예약 문의', '카카오', '상담', '문의']),
      },
      {
        name: `${surface}_last_day_visible`,
        ok: surface === 'lp' || days.length === 0 || bodyText.includes(`DAY ${days.length}`),
        detail: `${days.length} day(s)`,
      },
      {
        name: `${surface}_representative_schedule_terms_visible`,
        ok: surface === 'lp' || expectedTerms.length === 0 || missingTerms.length === 0,
        detail: missingTerms.length ? `missing: ${missingTerms.join(', ')}` : `checked: ${expectedTerms.join(', ')}`,
      },
      {
        name: `${surface}_image_present`,
        ok: /<img\b|_next\/image|images\.pexels\.com|supabase\.co\/storage/i.test(html),
      },
      {
        name: `${surface}_visible_text_readable`,
        ok: textQualityIssues.length === 0,
        detail: textQualityIssues.join(' / ') || 'ok',
      },
    );

    for (const forbidden of ['supplier_raw_departure_dates', 'net_price', 'internal_memo', 'land_operator']) {
      result.checks.push({
        name: `${surface}_forbidden_${forbidden}`,
        ok: !bodyText.includes(forbidden),
      });
    }

    if (surface === 'packages') {
      const cta = page.locator('[data-analytics-id="mobile_sticky_reservation"]').first();
      const ctaVisible = await cta.isVisible({ timeout: 3000 }).catch(() => false);
      result.checks.push({ name: 'packages_reservation_cta_visible', ok: ctaVisible });
      if (ctaVisible) {
        await cta.click({ timeout: 3000 }).catch(() => undefined);
        await page.waitForTimeout(500);
        const dialog = page.locator('[role="dialog"][aria-labelledby="reservation-inquiry-title"]').first();
        const dialogVisible = await dialog.isVisible({ timeout: 3000 }).catch(() => false);
        const dialogText = dialogVisible ? normalizeText(await dialog.innerText().catch(() => '')) : '';
        const titleNeedle = normalizeText(pkg.display_title || pkg.title).slice(0, 12);
        result.checks.push(
          { name: 'packages_reservation_sheet_opens', ok: dialogVisible },
          {
            name: 'packages_reservation_sheet_has_product_context',
            ok: dialogVisible && containsAny(dialogText, [titleNeedle, '예약 문의']),
            detail: dialogText.slice(0, 180),
          },
        );
      }
    } else {
      const cta = page.locator('[data-analytics-id="lp_sticky_lead"]').first();
      const ctaVisible = await cta.isVisible({ timeout: 3000 }).catch(() => false);
      result.checks.push({ name: 'lp_lead_cta_visible', ok: ctaVisible });
      if (ctaVisible) {
        await cta.click({ timeout: 3000 }).catch(() => undefined);
        await page.waitForTimeout(500);
        const sheet = page.locator('[data-testid="lp-lead-bottom-sheet"]').first();
        const sheetVisible = await sheet.isVisible({ timeout: 3000 }).catch(() => false);
        const sheetText = sheetVisible ? normalizeText(await sheet.innerText().catch(() => '')) : '';
        result.checks.push(
          { name: 'lp_lead_sheet_opens', ok: sheetVisible },
          {
            name: 'lp_lead_sheet_has_customer_copy',
            ok: sheetVisible && containsAny(sheetText, ['상담 신청', '출발일', '인원', '연락처']),
            detail: sheetText.slice(0, 180),
          },
        );
      }
    }

    result.checks.push(await runAccessibilityCheck(page, surface));

    ensureDir(screenshotDir);
    const safeName = `${pkg.internal_code || pkg.id}`.replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 120);
    const screenshotPath = path.join(screenshotDir, `${safeName}-${surface}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
    result.screenshot_path = screenshotPath;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    result.checks.push({ name: `${surface}_browser_navigation`, ok: false, detail: result.error });
  }

  result.status = result.checks.every(check => check.ok) ? 'pass' : 'fail';
  return result;
}

async function inspectMobilePage(page: Page, pkg: PackageRow, proofSecret: string): Promise<PackageProofResult> {
  const checkedAt = new Date().toISOString();
  const result: PackageProofResult = {
    id: pkg.id,
    title: pkg.display_title || pkg.title,
    internal_code: pkg.internal_code,
    url: `${baseUrl}/packages/${encodeURIComponent(pkg.id)}`,
    http_status: null,
    status: 'fail',
    checked_at: checkedAt,
    package_updated_at: pkg.updated_at,
    mobile_checks: [],
    a4_checks: auditA4PayloadForPackage(pkg),
    surface_results: [],
  };

  const packagesResult = await inspectCustomerSurface(page, pkg, proofSecret, 'packages');
  result.surface_results.push(packagesResult);
  result.http_status = packagesResult.http_status;
  result.screenshot_path = packagesResult.screenshot_path;
  if (checkLp) {
    result.surface_results.push(await inspectCustomerSurface(page, pkg, proofSecret, 'lp'));
  }
  result.mobile_checks = result.surface_results.flatMap(surface => surface.checks);

  const allChecks = [...result.mobile_checks, ...result.a4_checks];
  result.status = allChecks.every(check => check.ok) ? 'pass' : 'fail';
  return result;
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildUnhandledProofFailure(pkg: PackageRow, error: unknown): PackageProofResult {
  const checkedAt = new Date().toISOString();
  const detail = errorDetail(error);
  return {
    id: pkg.id,
    title: pkg.display_title || pkg.title,
    internal_code: pkg.internal_code,
    url: `${baseUrl}/packages/${encodeURIComponent(pkg.id)}`,
    http_status: null,
    status: 'fail',
    checked_at: checkedAt,
    package_updated_at: pkg.updated_at,
    mobile_checks: [
      {
        name: 'mobile_proof_unhandled_error',
        ok: false,
        detail,
      },
    ],
    a4_checks: auditA4PayloadForPackage(pkg),
    surface_results: [],
    error: detail,
  };
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

function buildProofPayload(result: PackageProofResult, status: 'pass' | 'fail', failedChecks: CheckResult[] = []) {
  const surfaces = result.surface_results.map(surface => surface.surface);
  const screenHashSource = result.surface_results.map(surface => `${surface.surface}:${surface.screen_hash ?? ''}`).join('|');
  const visibleHashSource = result.surface_results.map(surface => `${surface.surface}:${surface.customer_visible_hash ?? ''}`).join('|');
  return {
    status,
    checked_at: result.checked_at,
    package_updated_at: result.package_updated_at,
    screen_hash: sha256(screenHashSource),
    customer_visible_hash: sha256(visibleHashSource),
    surfaces,
    url: result.url,
    http_status: result.http_status,
    viewport,
    surface_results: result.surface_results,
    ...(status === 'fail' ? { failed_checks: failedChecks } : {}),
    checks: result.mobile_checks,
    a4: {
      status: result.a4_checks.every(check => check.ok) ? 'pass' : 'fail',
      checks: result.a4_checks,
    },
    screenshot_path: result.screenshot_path,
    source: 'hwp-mobile-browser-proof',
  };
}

async function persistPassProof(result: PackageProofResult) {
  const { data: current, error: loadError } = await supabaseAdmin
    .from('travel_packages')
    .select('audit_status,audit_report')
    .eq('id', result.id)
    .maybeSingle();
  if (loadError) throw new Error(loadError.message);

  const existing = current?.audit_report && typeof current.audit_report === 'object' && !Array.isArray(current.audit_report)
    ? current.audit_report as Record<string, unknown>
    : {};
  const wasBlockedByMobileProof = current?.audit_status === 'blocked' && Boolean(existing.mobile_browser_proof_required);
  const nextReport = { ...existing };
  delete nextReport.mobile_browser_proof_required;
  nextReport.mobile_browser_proof = buildProofPayload(result, 'pass');

  const update: Record<string, unknown> = {
    audit_report: nextReport,
    audit_checked_at: result.checked_at,
  };
  if (wasBlockedByMobileProof) {
    update.audit_status = 'warnings';
  }

  const { error } = await supabaseAdmin
    .from('travel_packages')
    .update(update)
    .eq('id', result.id);
  if (error) throw new Error(error.message);
}

async function persistFailProof(result: PackageProofResult) {
  const { data: current, error: loadError } = await supabaseAdmin
    .from('travel_packages')
    .select('audit_report')
    .eq('id', result.id)
    .maybeSingle();
  if (loadError) throw new Error(loadError.message);

  const existing = current?.audit_report && typeof current.audit_report === 'object' && !Array.isArray(current.audit_report)
    ? current.audit_report as Record<string, unknown>
    : {};
  const failedChecks = [...result.mobile_checks, ...result.a4_checks].filter(check => !check.ok);
  const nextReport = {
    ...existing,
    mobile_browser_proof: buildProofPayload(result, 'fail', failedChecks),
    mobile_browser_proof_required: {
      reason: failedChecks.map(check => `${check.name}${check.detail ? `: ${check.detail}` : ''}`).join(' / '),
      checked_at: result.checked_at,
    },
  };

  const { error } = await supabaseAdmin
    .from('travel_packages')
    .update({
      audit_status: 'blocked',
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
      let result: PackageProofResult;
      try {
        result = await inspectMobilePage(page, pkg, proofSecret);
        if (apply) {
          try {
            if (result.status === 'pass') {
              await persistPassProof(result);
            } else if (!applyPassOnly) {
              await persistFailProof(result);
            }
          } catch (error) {
            result.status = 'fail';
            result.mobile_checks.push({
              name: 'mobile_proof_persist',
              ok: false,
              detail: errorDetail(error),
            });
          }
        }
      } catch (error) {
        result = buildUnhandledProofFailure(pkg, error);
      }
      results.push(result);
      if (!jsonOnly) {
        const failed = [...result.mobile_checks, ...result.a4_checks].filter(check => !check.ok);
        console.log(`${result.status.toUpperCase()} ${pkg.internal_code || pkg.id} ${failed.length ? failed.map(item => item.name).join(', ') : ''}`);
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
    applyMode: applyPassOnly ? 'pass-only' : apply ? 'pass-and-fail' : 'none',
    checkedSurfaces: checkLp ? ['packages', 'lp'] : ['packages'],
    accessibility: runAxe ? 'axe_wcag2a_2aa_21a_21aa' : 'skipped',
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
  if (summary.fail > 0 && !continueOnFail) process.exitCode = 1;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
