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
import { assessPublicImageReadiness } from '../src/lib/package-publication/public-image-quality';
import { buildProofBoundPublicPackageSnapshot } from '../src/lib/package-publication/public-snapshot';

type PackageRow = {
  [key: string]: unknown;
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
  package_revision?: number | string | null;
};

type CheckResult = {
  name: string;
  ok: boolean;
  detail?: string;
  evidence?: AccessibilityEvidence[];
};

type AccessibilityEvidence = {
  rule: string;
  impact: string | null;
  target: string;
  html: string;
  failure_summary: string | null;
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
  public_snapshot_hash?: string | null;
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
  package_revision: number | null;
  public_snapshot_hash: string | null;
  app_build_id: string | null;
  mobile_checks: CheckResult[];
  a4_checks: CheckResult[];
  surface_results: SurfaceProofResult[];
  screenshot_path?: string;
  error?: string;
};

type OfflineRenderFixtureFile = {
  fixtures?: Array<{
    package?: PackageRow;
  }>;
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
  --fixture-file=...  Load offline render-proof package fixtures instead of querying travel_packages.
  --since=...         Load packages created at or after this ISO timestamp when package ids are omitted.
  --limit=...         Max packages to load, default 200.
  --offset=...        Skip the first N offline fixtures; useful for parallel fixture shards.
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
const offset = Math.max(0, Number(argValue('offset') ?? '0') || 0);
const outputDir = argValue('output-dir') || path.join(process.cwd(), 'data/product-registration/hwp-inbox/reports/mobile-browser-proof');
const screenshotDir = path.join(outputDir, 'screenshots');
const fixtureFilePath = argValue('fixture-file');
const fixtureMode = Boolean(fixtureFilePath);
const viewport = { width: 390, height: 844 };
const appBuildId = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_BUILD_ID ?? null;

if (fixtureMode && apply) {
  throw new Error('--apply and --apply-pass-only are not available with --fixture-file.');
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function proofPackageRevision(pkg: PackageRow): number {
  return buildProofBoundPublicPackageSnapshot(pkg).packageRevision;
}

function proofSnapshotHash(pkg: PackageRow, revision: number): string {
  const candidate = buildProofBoundPublicPackageSnapshot(pkg);
  if (candidate.packageRevision !== revision) {
    throw new Error(`proof revision mismatch: expected ${revision}, got ${candidate.packageRevision}`);
  }
  return candidate.snapshotHash;
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

function customerSurfaceUrl(surface: SurfaceName, packageId: string): string {
  const prefix = fixtureMode ? `/render-proof-local/${surface}` : `/${surface}`;
  return `${baseUrl}${prefix}/${encodeURIComponent(packageId)}`;
}

function normalizeProofSearchKey(value: unknown): string {
  return normalizeText(value)
    .toLocaleLowerCase('ko-KR')
    .replace(/[\s+·,./()[\]{}"'`_-]+/g, '');
}

function customerNoticeTerms(pkg: PackageRow): string[] {
  const { snapshot } = buildProofBoundPublicPackageSnapshot(pkg);
  return snapshot.public_notices.flatMap((item) => {
    if (typeof item === 'string') return [item.trim()].filter(Boolean);
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const title = typeof record.title === 'string' ? record.title.trim() : '';
    const text = typeof record.text === 'string' ? record.text.trim() : '';
    return [title, text].filter(Boolean);
  });
}

function provisionalFlightOptions(pkg: PackageRow): Array<Record<string, unknown>> {
  const itineraryData = pkg.itinerary_data;
  if (!itineraryData || typeof itineraryData !== 'object') return [];
  const options = (itineraryData as Record<string, unknown>).flight_schedule_options;
  return Array.isArray(options)
    ? options.filter((option): option is Record<string, unknown> => (
      typeof option === 'object' && option !== null
    ))
    : [];
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
    '직판 최저가',
    '24시간 현지 지원',
    '빠른 상담 응답',
    '요금표 최고가 대비',
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

async function waitForReactClickHandler(page: Page, selector: string) {
  await page
    .waitForFunction(
      candidate => {
        const element = document.querySelector(candidate);
        if (!element) return false;
        return Object.keys(element).some(key => (
          key.startsWith('__reactProps$')
          && typeof (element as unknown as Record<string, { onClick?: unknown }>)[key]?.onClick === 'function'
        ));
      },
      selector,
      { timeout: fixtureMode ? 2_000 : 15_000 },
    )
    .catch(() => undefined);
}

async function clickCustomerCta(page: Page, selector: string, dialogSelector: string) {
  const cta = page.locator(selector).first();
  const visible = await cta.isVisible({ timeout: 5_000 }).catch(() => false);
  if (!visible) return { visible, dialogVisible: false };

  await waitForReactClickHandler(page, selector);
  await cta.scrollIntoViewIfNeeded().catch(() => undefined);
  await cta.click({ timeout: 5_000 }).catch(() => undefined);

  const dialog = page.locator(dialogSelector).first();
  let dialogVisible = await dialog
    .waitFor({ state: 'visible', timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (!dialogVisible) {
    await cta.evaluate(element => (element as HTMLElement).click()).catch(() => undefined);
    dialogVisible = await dialog
      .waitFor({ state: 'visible', timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
  }

  return { visible, dialogVisible };
}

async function runAccessibilityCheck(page: Page, surface: SurfaceName): Promise<CheckResult> {
  if (!runAxe) return { name: `${surface}_accessibility_wcag`, ok: true, detail: 'skipped' };
  try {
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    // Color contrast is a WCAG 2 AA customer-facing failure. It must not be
    // downgraded to a warning merely because the rest of the page renders.
    const warningRuleIds = new Set(['scrollable-region-focusable']);
    const serious = violations.filter(violation =>
      ['critical', 'serious'].includes(String(violation.impact ?? '')),
    );
    const blocking = serious.filter(violation => !warningRuleIds.has(violation.id));
    const warnings = serious.filter(violation => warningRuleIds.has(violation.id));
    const evidence = serious
      .flatMap(violation =>
        violation.nodes.map(node => ({
          rule: violation.id,
          impact: violation.impact ?? null,
          target: node.target.join(' > ').slice(0, 500),
          html: node.html.slice(0, 500),
          failure_summary: node.failureSummary?.slice(0, 1_000) ?? null,
        })),
      )
      .slice(0, 100);
    return {
      name: `${surface}_accessibility_wcag`,
      ok: blocking.length === 0,
      detail: serious.length === 0
        ? 'ok'
        : [
            blocking.length > 0 ? `blocking=${blocking.slice(0, 8).map(violation => `${violation.id}:${violation.nodes.length}`).join(',')}` : null,
            warnings.length > 0 ? `warnings=${warnings.slice(0, 8).map(violation => `${violation.id}:${violation.nodes.length}`).join(',')}` : null,
          ].filter(Boolean).join(' '),
      evidence,
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
  const url = customerSurfaceUrl(surface, pkg.id);
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
    const bodySearchKey = normalizeProofSearchKey(bodyText);
    const missingTerms = expectedTerms.filter(term => {
      const termSearchKey = normalizeProofSearchKey(term);
      return termSearchKey.length > 0 && !bodySearchKey.includes(termSearchKey);
    });
    const expectedNoticeTerms = customerNoticeTerms(pkg);
    const missingNoticeTerms = expectedNoticeTerms.filter(term => {
      const termSearchKey = normalizeProofSearchKey(term);
      return termSearchKey.length > 0 && !bodySearchKey.includes(termSearchKey);
    });
    const flightOptions = provisionalFlightOptions(pkg);
    const unconfirmedCarrierNames = flightOptions
      .map(option => typeof option.carrier_name === 'string' ? option.carrier_name.trim() : '')
      .filter(Boolean);
    const textQualityIssues = visibleTextQualityIssues(rawBodyText);
    const imageReadiness = assessPublicImageReadiness(pkg);

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
        name: `${surface}_customer_ready_image`,
        ok: imageReadiness.customerReady,
        detail: imageReadiness.customerReady
          ? `approved images: ${imageReadiness.approvedImageCount}`
          : `brand fallback only: ${imageReadiness.brandFallbackCount}`,
      },
      {
        name: `${surface}_visible_text_readable`,
        ok: textQualityIssues.length === 0,
        detail: textQualityIssues.join(' / ') || 'ok',
      },
      {
        name: `${surface}_customer_notices_visible`,
        ok: expectedNoticeTerms.length === 0 || missingNoticeTerms.length === 0,
        detail: missingNoticeTerms.length
          ? `missing: ${missingNoticeTerms.join(' / ')}`
          : `checked: ${expectedNoticeTerms.length}`,
      },
    );

    if (flightOptions.length > 0) {
      result.checks.push(
        {
          name: `${surface}_provisional_flight_not_labeled_direct`,
          ok: !bodyText.includes('직항'),
        },
        {
          name: `${surface}_unconfirmed_carrier_names_hidden`,
          ok: unconfirmedCarrierNames.every(name => !bodyText.includes(name)),
          detail: unconfirmedCarrierNames.length > 0
            ? `checked: ${unconfirmedCarrierNames.join(', ')}`
            : 'no public carrier names stored',
        },
      );
    }

    for (const forbidden of ['supplier_raw_departure_dates', 'net_price', 'internal_memo', 'land_operator']) {
      result.checks.push({
        name: `${surface}_forbidden_${forbidden}`,
        ok: !bodyText.includes(forbidden),
      });
    }

    if (surface === 'packages') {
      const dialogSelector = '[role="dialog"][aria-labelledby="reservation-inquiry-title"]';
      const interaction = await clickCustomerCta(
        page,
        '[data-analytics-id="mobile_sticky_reservation"]',
        dialogSelector,
      );
      result.checks.push({ name: 'packages_reservation_cta_visible', ok: interaction.visible });
      if (interaction.visible) {
        const dialog = page.locator(dialogSelector).first();
        const dialogVisible = interaction.dialogVisible;
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
      const sheetSelector = '[data-testid="lp-lead-bottom-sheet"]';
      const interaction = await clickCustomerCta(
        page,
        '[data-analytics-id="lp_sticky_lead"]',
        sheetSelector,
      );
      result.checks.push({ name: 'lp_lead_cta_visible', ok: interaction.visible });
      if (interaction.visible) {
        const sheet = page.locator(sheetSelector).first();
        const sheetVisible = interaction.dialogVisible;
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
  const packageRevision = proofPackageRevision(pkg);
  const publicSnapshotHash = proofSnapshotHash(pkg, packageRevision);
  const result: PackageProofResult = {
    id: pkg.id,
    title: pkg.display_title || pkg.title,
    internal_code: pkg.internal_code,
    url: customerSurfaceUrl('packages', pkg.id),
    http_status: null,
    status: 'fail',
    checked_at: checkedAt,
    package_updated_at: pkg.updated_at,
    package_revision: packageRevision,
    public_snapshot_hash: publicSnapshotHash,
    app_build_id: appBuildId,
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
  const packageRevision = proofPackageRevision(pkg);
  const publicSnapshotHash = proofSnapshotHash(pkg, packageRevision);
  return {
    id: pkg.id,
    title: pkg.display_title || pkg.title,
    internal_code: pkg.internal_code,
    url: customerSurfaceUrl('packages', pkg.id),
    http_status: null,
    status: 'fail',
    checked_at: checkedAt,
    package_updated_at: pkg.updated_at,
    package_revision: packageRevision,
    public_snapshot_hash: publicSnapshotHash,
    app_build_id: appBuildId,
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
  if (fixtureFilePath) {
    const fullPath = path.resolve(fixtureFilePath);
    const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8')) as OfflineRenderFixtureFile;
    return (parsed.fixtures ?? [])
      .map(fixture => fixture.package)
      .filter((pkg): pkg is PackageRow => Boolean(pkg?.id && pkg?.title))
      .filter(pkg => packageIds.length === 0 || packageIds.includes(pkg.id))
      .slice(offset, offset + limit);
  }

  let query = supabaseAdmin
    .from('travel_packages')
    .select('*')
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
    package_revision: result.package_revision,
    public_snapshot_hash: result.public_snapshot_hash,
    app_build_id: result.app_build_id,
    screen_hash: sha256(screenHashSource),
    customer_visible_hash: sha256(visibleHashSource),
    surfaces,
    url: result.url,
    http_status: result.http_status,
    viewport,
    surface_results: result.surface_results.map(surface => ({
      ...surface,
      public_snapshot_hash: result.public_snapshot_hash,
    })),
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
    if (fixtureMode) {
      await context.route('**/api/{tracking,tracking/**,web-vitals}', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true }),
        });
      });
      await context.route('**/api/packages/*/review-digest', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            digest_quotes: [],
            source_count: 0,
            avg_rating: null,
            generated_at: null,
          }),
        });
      });
    }
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
    sourceMode: fixtureMode ? 'offline-render-fixtures' : 'travel_packages',
    fixtureFile: fixtureFilePath ? path.resolve(fixtureFilePath) : null,
    offset,
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
