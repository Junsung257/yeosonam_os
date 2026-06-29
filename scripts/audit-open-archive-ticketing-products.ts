#!/usr/bin/env tsx

import { createHash } from 'node:crypto';
import process from 'node:process';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

import type { ExtractedData } from '@/lib/parser';
import { mapTravelPackageToLandingData } from '@/lib/map-travel-package-to-lp';
import { renderPackage, type RenderPackageInput } from '@/lib/render-contract';
import { sanitizeCustomerPackageForClient } from '@/lib/customer-package-payload';
import { registerProductFromRaw } from '@/lib/product-registration/register-product-from-raw';
import { resolveUploadDestinationAndCodes } from '@/lib/product-registration/destination-resolution';
import { extractSourceTicketingDeadline } from '@/lib/product-registration/ticketing-deadline';
import { blockingCustomerVisibleTextIssues } from '@/lib/customer-visible-text-audit';

type Options = {
  apply: boolean;
  json: boolean;
  today: string;
  limit: number;
};

type PackageRow = {
  id: string;
  title: string;
  status: string | null;
  audit_status: string | null;
  created_at: string | null;
  updated_at: string | null;
  internal_code: string | null;
  short_code: string | null;
  destination: string | null;
  duration: number | null;
  departure_airport: string | null;
  airline: string | null;
  accommodations: string[] | null;
  inclusions: string[] | null;
  excludes: string[] | null;
  optional_tours: unknown;
  notices_parsed: unknown;
  customer_notes: string | null;
  price: number | null;
  price_tiers: unknown;
  price_dates: unknown;
  itinerary: string[] | null;
  itinerary_data: unknown;
  min_participants: number | null;
  trip_style: string | null;
  raw_text: string | null;
  raw_text_hash: string | null;
  confidence: number | null;
  ticketing_deadline: string | null;
  audit_report: Record<string, unknown> | null;
};

type ProductPriceRow = {
  product_id: string | null;
  target_date: string | null;
  net_price: number | null;
  adult_selling_price: number | null;
  note: string | null;
};

type DraftRow = {
  id: string;
  package_id: string | null;
  status: string | null;
  gate_result: { status?: string | null } | null;
  ledger: unknown;
  match_summary: { attraction_unmatched_count?: number | null } | null;
  created_at: string | null;
};

const ACTIVE_STATUSES = new Set(['active', 'approved', 'selling', 'available']);
const ARCHIVED_STATUSES = new Set(['archived', 'inactive', 'INACTIVE', 'rejected', 'expired']);
const MANAGED_STATUSES = ['approved', 'active', 'pending', 'pending_review', 'draft', 'selling', 'available'];

function todayInKst(): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
}

function parseOptions(args: string[]): Options {
  const today = args.find(arg => arg.startsWith('--today='))?.split('=')[1]
    ?? todayInKst();
  const limit = Number(args.find(arg => arg.startsWith('--limit='))?.split('=')[1] ?? 1000);
  return {
    apply: args.includes('--apply'),
    json: args.includes('--json'),
    today,
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 5000) : 1000,
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseIsoDate(value: string | null): string | null {
  const date = nonEmpty(value);
  if (!date) return null;
  const match = date.match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function isCustomerVisible(status: string | null): boolean {
  return ACTIVE_STATUSES.has(String(status ?? ''));
}

function isArchived(status: string | null): boolean {
  return ARCHIVED_STATUSES.has(String(status ?? ''));
}

function getDraftStatus(draft: DraftRow | null): string | null {
  const gateStatus = draft?.gate_result?.status;
  return typeof gateStatus === 'string' && gateStatus ? gateStatus : draft?.status ?? null;
}

function countLedgerRows(draft: DraftRow | null, key: 'standard_notices' | 'structured_facts'): number {
  const variants = (draft?.ledger as { variants?: unknown[] } | null)?.variants;
  if (!Array.isArray(variants)) return 0;
  return variants.reduce<number>((sum, variant) => {
    const rows = (variant as Record<string, unknown> | null)?.[key];
    return sum + (Array.isArray(rows) ? rows.length : 0);
  }, 0);
}

function itineraryDays(pkg: PackageRow): number {
  const days = (pkg.itinerary_data as { days?: unknown[] } | null)?.days;
  if (Array.isArray(days)) return days.length;
  return Array.isArray(pkg.itinerary) ? pkg.itinerary.length : 0;
}

function priceDateRows(pkg: PackageRow): Array<{ date: string; price: number }> {
  return asArray<{ date?: unknown; price?: unknown }>(pkg.price_dates)
    .map(row => ({
      date: typeof row.date === 'string' ? row.date : '',
      price: Number(row.price),
    }))
    .filter(row => row.date && Number.isFinite(row.price) && row.price > 0);
}

function resolveTicketingDeadline(pkg: PackageRow, today: string): string | null {
  return parseIsoDate(pkg.ticketing_deadline)
    ?? extractSourceTicketingDeadline(pkg.raw_text, {
      priceDates: pkg.price_dates,
      today,
    });
}

async function loadProductPriceRowsByCode(
  // Supabase's generated client generic differs between script inference and helper
  // inference, but this helper only needs the runtime query surface.
  supabase: any,
  codes: string[],
): Promise<Map<string, ProductPriceRow[]>> {
  const priceRowsByCode = new Map<string, ProductPriceRow[]>();
  for (const code of codes) {
    const rows: ProductPriceRow[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('product_prices')
        .select('product_id,target_date,net_price,adult_selling_price,note')
        .eq('product_id', code)
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      const page = (data ?? []) as ProductPriceRow[];
      rows.push(...page);
      if (page.length < 1000) break;
    }
    priceRowsByCode.set(code, rows);
  }
  return priceRowsByCode;
}

function hasFutureDeparture(pkg: PackageRow, today: string): boolean {
  const dates = priceDateRows(pkg).map(row => row.date).filter(Boolean);
  if (dates.length === 0) return false;
  return dates.some(date => date >= today);
}

function latestDeparture(pkg: PackageRow): string | null {
  const dates = priceDateRows(pkg).map(row => row.date).filter(Boolean).sort();
  return dates.at(-1) ?? null;
}

function priceAlignment(pkg: PackageRow, productPrices: ProductPriceRow[]): string | null {
  const priceDates = priceDateRows(pkg);
  const priceDateByDate = new Map(priceDates.map(row => [row.date, row.price]));
  const pricesByDate = new Map<string, number[]>();
  for (const row of productPrices) {
    const date = nonEmpty(row.target_date);
    const price = Number(row.net_price);
    if (!date || !Number.isFinite(price) || price <= 0) continue;
    const prices = pricesByDate.get(date) ?? [];
    prices.push(price);
    pricesByDate.set(date, prices);
  }
  if (priceDateByDate.size === 0) {
    return pricesByDate.size > 0 ? 'price_dates missing all product_prices dates' : null;
  }
  for (const date of pricesByDate.keys()) {
    if (!priceDateByDate.has(date)) return `price_dates missing date ${date}`;
  }
  for (const [date, price] of priceDateByDate.entries()) {
    const prices = pricesByDate.get(date);
    if (!prices?.length) return `product_prices missing date ${date}`;
    const minPrice = Math.min(...prices);
    if (minPrice !== price) return `${date} product_prices min ${minPrice} != price_dates ${price}`;
  }
  return null;
}

function customerOptionMismatch(pkg: PackageRow, productPrices: ProductPriceRow[]): string | null {
  const rowsByDate = new Map<string, ProductPriceRow[]>();
  for (const row of productPrices) {
    const date = nonEmpty(row.target_date);
    if (!date) continue;
    const rows = rowsByDate.get(date) ?? [];
    rows.push(row);
    rowsByDate.set(date, rows);
  }
  for (const priceDate of priceDateRows(pkg)) {
    const rows = rowsByDate.get(priceDate.date) ?? [];
    if (rows.length === 0) return `customer price options missing date ${priceDate.date}`;
    const missingSelling = rows.find(row => {
      const price = Number(row.adult_selling_price);
      return !Number.isFinite(price) || price <= 0;
    });
    if (missingSelling) return `adult_selling_price missing for ${priceDate.date}`;
    if (rows.length > 1) {
      const labels = rows.map(row => nonEmpty(row.note)).filter(Boolean);
      if (labels.length < rows.length) return `option label missing for ${priceDate.date}`;
      if (new Set(labels).size < rows.length) return `option label duplicated for ${priceDate.date}`;
    }
  }
  return null;
}

function customerVisibleTextFailure(pkg: PackageRow): string | null {
  const issues = blockingCustomerVisibleTextIssues(pkg as unknown as Record<string, unknown>);
  if (issues.length === 0) return null;
  return `customer text quality blocked: ${issues.slice(0, 4).map(issue => `${issue.fieldPath}=${issue.value}`).join(' / ')}`;
}

function hasRawNoticeLeakRisk(pkg: PackageRow): boolean {
  const notices = asArray(pkg.notices_parsed);
  const hasStandardMeta = notices.some(notice =>
    notice && typeof notice === 'object'
    && 'template_key' in notice
    && 'review_status' in notice
    && 'category' in notice,
  );
  if (hasStandardMeta) return false;
  const text = [
    ...notices.map(notice => {
      if (typeof notice === 'string') return notice;
      if (!notice || typeof notice !== 'object') return '';
      const record = notice as Record<string, unknown>;
      return [record.title, record.text].filter(value => typeof value === 'string').join('\n');
    }),
    pkg.customer_notes ?? '',
  ].join('\n');
  if (!text.trim()) return false;
  return /REMARK|리마크|랜드사\s*(?:비고|안내)|여권\s*6개월|전자\s*담배\s*반입|룸\s*배정|일정\s*미참여|마사지\s*팁|싱글\s*차지|single\s*charge/i.test(text);
}

function hasSchedulePolicyLeak(pkg: PackageRow): boolean {
  const days = (pkg.itinerary_data as { days?: Array<{ schedule?: Array<{ activity?: unknown }> }> } | null)?.days ?? [];
  return days.some(day => (day.schedule ?? []).some(item => {
    const activity = String(item.activity ?? '');
    return /취소규정|현금영수증|예약금|수수료|환불|300,000/.test(activity);
  }));
}

function auditReportRecord(pkg: PackageRow): Record<string, unknown> {
  return pkg.audit_report && typeof pkg.audit_report === 'object' && !Array.isArray(pkg.audit_report)
    ? pkg.audit_report
    : {};
}

function mobileBrowserProofFailure(pkg: PackageRow): string | null {
  const report = auditReportRecord(pkg);
  const proof = report.mobile_browser_proof && typeof report.mobile_browser_proof === 'object' && !Array.isArray(report.mobile_browser_proof)
    ? report.mobile_browser_proof as Record<string, unknown>
    : null;
  if (!proof) return 'mobile_browser_proof missing';
  if (proof.status !== 'pass') return `mobile_browser_proof ${String(proof.status ?? 'missing')}`;

  const surfaces = new Set<string>();
  for (const surface of asArray(proof.surfaces)) {
    if (typeof surface === 'string') surfaces.add(surface);
  }
  for (const surfaceResult of asArray(proof.surface_results)) {
    if (!surfaceResult || typeof surfaceResult !== 'object' || Array.isArray(surfaceResult)) continue;
    const record = surfaceResult as Record<string, unknown>;
    if (typeof record.surface === 'string') surfaces.add(record.surface);
    if (record.status && record.status !== 'pass') {
      return `mobile_browser_proof ${String(record.surface ?? 'surface')} ${String(record.status)}`;
    }
  }
  if (!surfaces.has('packages')) return 'mobile_browser_proof packages surface missing';
  if (!surfaces.has('lp')) return 'mobile_browser_proof lp surface missing';

  return null;
}

function hasUnresolvedIdentity(pkg: PackageRow): boolean {
  const code = String(pkg.internal_code ?? pkg.short_code ?? '');
  return !nonEmpty(pkg.destination) || pkg.destination === 'UNK' || /(?:^|-)UNK(?:-|$)/.test(code);
}

function renderFailure(pkg: PackageRow): string | null {
  try {
    const renderInput = pkg as unknown as RenderPackageInput;
    const view = renderPackage(renderInput);
    const landing = mapTravelPackageToLandingData(renderInput as unknown as Record<string, unknown>, null);
    const safe = sanitizeCustomerPackageForClient(pkg as unknown as Record<string, unknown>);
    if (!safe) return 'customer payload empty';
    if ('raw_text' in safe || 'raw_text_hash' in safe || 'internal_notes' in safe) {
      return 'customer payload leaks internal fields';
    }
    if (!Array.isArray(view.days) || view.days.length === 0) return 'renderPackage.days=0';
    if (!landing.priceFrom || landing.priceFrom <= 0) return 'landing.priceFrom=0';
    if (!Array.isArray(landing.price_dates) || landing.price_dates.length === 0) return 'landing.price_dates=0';
    if (!Array.isArray(landing.itinerary?.days) || landing.itinerary.days.length === 0) return 'landing.itinerary.days=0';
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function buildExtractedData(pkg: PackageRow, rawText: string): ExtractedData {
  return {
    title: pkg.title,
    destination: pkg.destination ?? undefined,
    duration: pkg.duration ?? undefined,
    departure_airport: pkg.departure_airport ?? undefined,
    airline: pkg.airline ?? undefined,
    accommodations: pkg.accommodations ?? undefined,
    inclusions: pkg.inclusions ?? undefined,
    excludes: pkg.excludes ?? undefined,
    optional_tours: asArray(pkg.optional_tours),
    notices_parsed: asArray(pkg.notices_parsed),
    price_tiers: asArray(pkg.price_tiers),
    min_participants: pkg.min_participants ?? undefined,
    trip_style: pkg.trip_style ?? undefined,
    rawText,
  };
}

async function reprocessSource(pkg: PackageRow): Promise<string[]> {
  const rawText = pkg.raw_text ?? '';
  if (rawText.trim().length < 50) return ['raw_text missing or too short'];
  const rawTextHash = sha256(rawText);
  const destinationResolution = resolveUploadDestinationAndCodes({
    destination: pkg.destination,
    departureAirport: pkg.departure_airport,
    durationDays: pkg.duration,
    productRawText: rawText,
    documentRawText: rawText,
  });
  const registration = await registerProductFromRaw({
    rawText,
    documentRawText: rawText,
    extractedData: buildExtractedData(pkg, rawText),
    itineraryData: pkg.itinerary_data as never,
    title: pkg.title,
    activeAttractions: [],
    destinationResolution,
    destinationCode: destinationResolution.destinationCode,
    internalCode: pkg.internal_code,
    enableGeminiFallback: false,
    priceYear: 2026,
    confidence: pkg.confidence,
  });
  return [
    pkg.raw_text_hash && pkg.raw_text_hash !== rawTextHash ? 'stored raw_text_hash mismatch' : null,
    registration.evidence.rawTextHash !== rawTextHash ? 'reprocessed raw_text_hash mismatch' : null,
    registration.evidence.spans.length === 0 ? 'source evidence spans missing' : null,
    registration.priceRecovery.priceRows.length === 0 ? 'source price rows missing' : null,
    registration.priceRecovery.priceDates.length === 0 ? 'source price dates missing' : null,
    registration.priceRecovery.ok ? null : `source price recovery failed: ${registration.priceRecovery.failures.join('|')}`,
    registration.deliverability.ok ? null : `source deliverability failed: ${registration.deliverability.blockers.join('|')}`,
    registration.publishable ? null : 'source registration not publishable',
  ].filter((item): item is string => Boolean(item));
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  dotenv.config({ path: '.env.local' });
  dotenv.config({ path: '.env' });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Missing Supabase URL or service role key');

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data: packages, error } = await supabase
    .from('travel_packages')
    .select('id,title,status,audit_status,audit_report,created_at,updated_at,internal_code,short_code,destination,duration,departure_airport,airline,accommodations,inclusions,excludes,optional_tours,notices_parsed,customer_notes,price,price_tiers,price_dates,itinerary,itinerary_data,min_participants,trip_style,raw_text,raw_text_hash,confidence,ticketing_deadline')
    .in('status', MANAGED_STATUSES)
    .order('created_at', { ascending: false })
    .limit(options.limit);

  if (error) throw new Error(error.message);
  const packageRows = (packages ?? []) as PackageRow[];
  const packageIds = packageRows.map(row => row.id);
  const codes = packageRows.map(row => row.internal_code).filter((code): code is string => Boolean(code));

  const uniqueCodes = [...new Set(codes)];
  const priceRowsByCode = await loadProductPriceRowsByCode(supabase, uniqueCodes);

  const latestDraftByPackage = new Map<string, DraftRow>();
  if (packageIds.length > 0) {
    const { data: drafts, error: draftError } = await supabase
      .from('product_registration_drafts')
      .select('id,package_id,status,gate_result,ledger,match_summary,created_at')
      .in('package_id', packageIds)
      .order('created_at', { ascending: false });
    if (draftError) throw new Error(draftError.message);
    for (const draft of (drafts ?? []) as DraftRow[]) {
      if (draft.package_id && !latestDraftByPackage.has(draft.package_id)) {
        latestDraftByPackage.set(draft.package_id, draft);
      }
    }
  }

  const audited = [];
  for (const pkg of packageRows) {
    const draft = latestDraftByPackage.get(pkg.id) ?? null;
    const productPrices = priceRowsByCode.get(pkg.internal_code ?? '') ?? [];
    const ticketingDeadline = resolveTicketingDeadline(pkg, options.today);
    const expiredTicketing = Boolean(ticketingDeadline && ticketingDeadline < options.today);
    const futureTicketing = Boolean(ticketingDeadline && ticketingDeadline >= options.today);
    const latestDate = latestDeparture(pkg);
    const allDepartureDatesPast = Boolean(latestDate && latestDate < options.today);
    const mobileFailures = [
      priceDateRows(pkg).length === 0 ? 'price_dates missing' : null,
      productPrices.length === 0 ? 'product_prices missing' : null,
      priceAlignment(pkg, productPrices),
      customerOptionMismatch(pkg, productPrices),
      itineraryDays(pkg) === 0 ? 'itinerary days missing' : null,
      renderFailure(pkg),
      hasUnresolvedIdentity(pkg) ? 'destination or internal code unresolved' : null,
      hasRawNoticeLeakRisk(pkg) ? 'customer notice raw leak risk' : null,
      hasSchedulePolicyLeak(pkg) ? 'schedule contains policy/payment text' : null,
      customerVisibleTextFailure(pkg),
      mobileBrowserProofFailure(pkg),
    ].filter((item): item is string => Boolean(item));
    const v3Status = getDraftStatus(draft);
    const standardNotices = countLedgerRows(draft, 'standard_notices');
    const structuredFacts = countLedgerRows(draft, 'structured_facts');
    const sourceFailures = futureTicketing && !isCustomerVisible(pkg.status)
      ? await reprocessSource(pkg)
      : [];

    const openEligible = futureTicketing
      && !isCustomerVisible(pkg.status)
      && !isArchived(pkg.status)
      && v3Status === 'ready_to_publish'
      && standardNotices > 0
      && structuredFacts > 0
      && !allDepartureDatesPast
      && mobileFailures.length === 0
      && sourceFailures.length === 0;
    const archiveReasons = [
      expiredTicketing ? 'ticketing_deadline_expired' : null,
      allDepartureDatesPast ? 'all_departure_dates_past' : null,
      mobileFailures.length > 0 ? `mobile_landing_error:${mobileFailures.join('|')}` : null,
    ].filter((item): item is string => Boolean(item));

    audited.push({
      id: pkg.id,
      code: pkg.internal_code,
      title: pkg.title,
      status: pkg.status,
      auditStatus: pkg.audit_status,
      ticketingDeadline,
      futureTicketing,
      latestDeparture: latestDate,
      v3Status,
      standardNotices,
      structuredFacts,
      priceDates: priceDateRows(pkg).length,
      productPrices: productPrices.length,
      itineraryDays: itineraryDays(pkg),
      mobileFailures,
      sourceFailures,
      auditReport: auditReportRecord(pkg),
      openEligible,
      archiveReasons,
    });
  }

  const toOpen = audited.filter(row => row.openEligible);
  const toArchive = audited.filter(row =>
    row.archiveReasons.some(reason =>
      reason === 'ticketing_deadline_expired'
      || reason === 'all_departure_dates_past'
      || (reason.startsWith('mobile_landing_error') && isCustomerVisible(row.status)),
    ) && !isArchived(row.status),
  );

  const applied = { opened: 0, archived: 0, productRowsOpened: 0, productRowsArchived: 0 };
  const now = new Date().toISOString();
  if (options.apply) {
    for (const row of toOpen) {
      const auditReport = {
        ...row.auditReport,
        source: 'ticketing-mobile-landing-open-audit',
        customer_opening: {
          status: 'opened',
          checked_at: now,
          ticketing_deadline: row.ticketingDeadline,
          latest_departure: row.latestDeparture,
          v3_status: row.v3Status,
          standard_notices: row.standardNotices,
          structured_facts: row.structuredFacts,
          mobile_failures: row.mobileFailures,
          source_failures: row.sourceFailures,
        },
      };
      const { error: updateError } = await supabase
        .from('travel_packages')
        .update({
          status: 'active',
          audit_status: 'clean',
          audit_checked_at: now,
          audit_report: auditReport,
          updated_at: now,
        })
        .eq('id', row.id);
      if (updateError) throw new Error(updateError.message);
      applied.opened += 1;
      if (row.code) {
        const { error: productError } = await supabase
          .from('products')
          .update({ status: 'active', updated_at: now })
          .eq('internal_code', row.code);
        if (productError) throw new Error(productError.message);
        applied.productRowsOpened += 1;
      }
    }

    for (const row of toArchive) {
      const auditReport = {
        ...row.auditReport,
        source: 'ticketing-mobile-landing-archive-audit',
        customer_opening: {
          status: 'archived',
          checked_at: now,
          reasons: row.archiveReasons,
          ticketing_deadline: row.ticketingDeadline,
          latest_departure: row.latestDeparture,
          v3_status: row.v3Status,
          mobile_failures: row.mobileFailures,
        },
      };
      const statusPatch: Record<string, unknown> = {
        status: 'archived',
        ticketing_deadline: row.ticketingDeadline,
        audit_checked_at: now,
        audit_report: auditReport,
        updated_at: now,
      };
      if (row.archiveReasons.some(reason => reason.startsWith('mobile_landing_error'))) {
        statusPatch.audit_status = 'blocked';
      }
      const { error: updateError } = await supabase
        .from('travel_packages')
        .update(statusPatch)
        .eq('id', row.id);
      if (updateError) throw new Error(updateError.message);
      applied.archived += 1;
      if (row.code) {
        const { error: productError } = await supabase
          .from('products')
          .update({ status: 'expired', updated_at: now })
          .eq('internal_code', row.code);
        if (productError) throw new Error(productError.message);
        applied.productRowsArchived += 1;
      }
    }
  }

  const report = {
    mode: options.apply ? 'apply' : 'dry-run',
    today: options.today,
    scanned: audited.length,
    summary: {
      openCandidates: toOpen.length,
      archiveCandidates: toArchive.length,
      applied,
      futureTicketingNonPublic: audited.filter(row => row.futureTicketing && !isCustomerVisible(row.status)).length,
      mobileErrorCandidates: audited.filter(row => row.mobileFailures.length > 0).length,
      expiredTicketingCandidates: audited.filter(row => row.archiveReasons.includes('ticketing_deadline_expired')).length,
      allDepartureDatesPastCandidates: audited.filter(row => row.archiveReasons.includes('all_departure_dates_past')).length,
    },
    toOpen,
    toArchive,
    blockedFutureTicketing: audited.filter(row =>
      row.futureTicketing && !isCustomerVisible(row.status) && !row.openEligible,
    ),
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Ticketing/mobile landing audit (${report.mode})`);
    console.log(`- scanned: ${report.scanned}`);
    console.log(`- open candidates: ${toOpen.length}`);
    console.log(`- archive candidates: ${toArchive.length}`);
    console.log(`- applied opened/archived: ${applied.opened}/${applied.archived}`);
    if (toOpen.length > 0) {
      console.log('\nOpen candidates');
      for (const row of toOpen) console.log(`- ${row.code ?? row.id} ${row.title}`);
    }
    if (toArchive.length > 0) {
      console.log('\nArchive candidates');
      for (const row of toArchive.slice(0, 50)) {
        console.log(`- ${row.code ?? row.id} ${row.title}: ${row.archiveReasons.join(', ')}`);
      }
    }
  }

  await supabase.removeAllChannels();
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
