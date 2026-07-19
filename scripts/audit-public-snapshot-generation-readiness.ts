import dotenv from 'dotenv';
import { pathToFileURL } from 'node:url';

import { buildPublicPackageSnapshot } from '../src/lib/package-publication/public-snapshot';
import { diagnosePublicSnapshotGeneration } from '../src/lib/package-publication/public-snapshot-diagnostics';
import type {
  PublicSnapshotGenerationField,
  PublicSnapshotGenerationReport,
  PublicSnapshotGenerationStatus,
} from '../src/lib/package-publication/public-snapshot-diagnostics';
import { evaluatePublicSnapshotPublishGate } from '../src/lib/package-publication/publish-gate';
import type { PublicPackageSnapshot } from '../src/lib/package-publication/types';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

type AnyRecord = Record<string, unknown>;

export const GOLDEN_SET = [
  { key: 'yanji_baekdu', patterns: [/\uC5F0\uAE38/, /\uBC31\uB450\uC0B0/], lookupTerms: ['연길', '백두산'] },
  { key: 'zhangjiajie', patterns: [/\uC7A5\uAC00\uACC4/], lookupTerms: ['장가계'] },
  { key: 'danang_hoian', patterns: [/\uB2E4\uB0AD/, /\uD638\uC774\uC548/], lookupTerms: ['다낭', '호이안'] },
  { key: 'nhatrang_dalat', patterns: [/\uB098\uD2B8\uB791/, /\uB2EC\uB78F/], lookupTerms: ['나트랑', '달랏'] },
  { key: 'phuquoc', patterns: [/\uD478\uAFB8\uC625/], lookupTerms: ['푸꾸옥'] },
  {
    key: 'fukuoka',
    patterns: [/\uD6C4\uCFE0\uC624\uCE74/, /\uBD81\uD050\uC288/],
    lookupTerms: ['후쿠오카', '북큐슈', '규슈'],
    excludeIdentityPatterns: [/\uB098\uAC00\uC0AC\uD0A4/],
  },
  { key: 'hokkaido', patterns: [/\uBD81\uD574\uB3C4/, /\uD64B\uCE74\uC774\uB3C4/, /\uC0BF\uD3EC\uB85C/], lookupTerms: ['북해도', '홋카이도', '삿포로'] },
  { key: 'hanoi_halong', patterns: [/\uD558\uB178\uC774/, /\uD558\uB871(?:\uBCA0\uC774)?/, /\uC60C\uB728/], lookupTerms: ['하노이', '하롱', '옌뜨'] },
  { key: 'tsushima', patterns: [/\uB300\uB9C8\uB3C4/, /\uC4F0\uC2DC\uB9C8/], lookupTerms: ['대마도', '쓰시마'] },
  { key: 'cebu', patterns: [/\uC138\uBD80/], lookupTerms: ['세부'] },
] as const;

function parseArgs() {
  const args = process.argv.slice(2);
  const value = (name: string, fallback: string) => {
    const prefix = `--${name}=`;
    const found = args.find(arg => arg.startsWith(prefix));
    return found ? found.slice(prefix.length) : fallback;
  };
  return {
    json: args.includes('--json'),
    limit: Math.max(1, Math.min(Number(value('limit', '500')), 5000)),
    samples: Math.max(1, Math.min(Number(value('samples', '20')), 100)),
    status: value('status', 'all')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean),
  };
}

function increment(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

export function rowText(row: AnyRecord): string {
  return [
    row.title,
    row.display_title,
    row.destination,
    row.raw_text,
    row.product_summary,
  ].map(value => String(value ?? '')).join('\n');
}

function rowIdentityText(row: AnyRecord): string {
  return [
    row.title,
    row.display_title,
    row.destination,
  ].map(value => String(value ?? '')).join('\n');
}

export function goldenKey(row: AnyRecord): string | null {
  const haystack = rowText(row);
  const identity = rowIdentityText(row);
  return GOLDEN_SET.find((item) => {
    const matches = item.patterns.some(pattern => pattern.test(haystack));
    if (!matches) return false;
    if (
      'excludeIdentityPatterns' in item
      && item.excludeIdentityPatterns.some(pattern => pattern.test(identity))
      && !item.patterns.some(pattern => pattern.test(identity))
    ) {
      return false;
    }
    return true;
  })?.key ?? null;
}

function safeLookupTerm(term: string): string {
  return term.replace(/[%,()]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function goldenLookupFilter(item: (typeof GOLDEN_SET)[number]): string {
  const fields = ['title', 'display_title', 'destination'];
  return item.lookupTerms
    .map(safeLookupTerm)
    .filter(Boolean)
    .flatMap(term => fields.map(field => `${field}.ilike.%${term}%`))
    .join(',');
}

function statusPriority(status: PublicSnapshotGenerationStatus): number {
  if (status === 'blocked') return 2;
  if (status === 'repairable') return 1;
  return 0;
}

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : null;
}

function compactText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function truncateText(value: unknown, maxLength = 180): string | null {
  const text = compactText(value);
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function countArray(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function countItineraryDays(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  const record = asRecord(value);
  const days = record?.days;
  return Array.isArray(days) ? days.length : 0;
}

function countProductThumbnails(value: unknown): number {
  const products = Array.isArray(value) ? value : value ? [value] : [];
  return products.reduce((count, product) => {
    const record = asRecord(product);
    return count + countArray(record?.thumbnail_urls);
  }, 0);
}

function countPriceTiers(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function countRouteText(snapshot: PublicPackageSnapshot): number {
  return snapshot.route_text_dump.filter(item => compactText(item)).length;
}

function routeTextSample(snapshot: PublicPackageSnapshot, limit = 30): string[] {
  return snapshot.route_text_dump
    .map(item => truncateText(item, 220))
    .filter((item): item is string => Boolean(item))
    .slice(0, limit);
}

function fieldStatuses(report: PublicSnapshotGenerationReport): Record<string, PublicSnapshotGenerationStatus> {
  return Object.fromEntries(report.diagnostics.map(diagnostic => [diagnostic.field, diagnostic.status]));
}

function fieldDiagnostics(report: PublicSnapshotGenerationReport) {
  return Object.fromEntries(report.diagnostics.map(diagnostic => [
    diagnostic.field,
    {
      status: diagnostic.status,
      process_stage: diagnostic.process_stage ?? null,
      evidence: diagnostic.evidence,
      required_source_evidence: diagnostic.required_source_evidence ?? [],
      repair_actions: diagnostic.repair_actions,
    },
  ]));
}

function fieldsByStatus(report: PublicSnapshotGenerationReport, status: PublicSnapshotGenerationStatus): string[] {
  return report.diagnostics
    .filter(diagnostic => diagnostic.status === status)
    .map(diagnostic => diagnostic.field);
}

export function buildAuditItem(
  row: AnyRecord,
  snapshot: PublicPackageSnapshot,
  report: PublicSnapshotGenerationReport,
) {
  const snapshotPackage = asRecord(snapshot.package) ?? {};
  const cardProjection = asRecord(snapshot.card_projection) ?? {};
  const lpProjection = asRecord(snapshot.lp_projection) ?? {};
  const rawText = compactText(row.raw_text);

  return {
    id: row.id,
    destination: row.destination ?? null,
    raw_title: row.title ?? null,
    public_title: snapshot.public_title,
    public_subtitle: snapshot.public_subtitle,
    overall_status: report.overall_status,
    source: {
      raw_title: truncateText(row.title),
      display_title: truncateText(row.display_title),
      destination: truncateText(row.destination),
      raw_text_chars: rawText.length,
      raw_excerpt: rawText ? truncateText(rawText, 500) : null,
      hero_tagline: truncateText(row.hero_tagline),
      product_summary: truncateText(row.product_summary, 260),
    },
    extracted_fields: {
      duration: row.duration ?? null,
      nights: row.nights ?? null,
      scalar_price: row.price ?? null,
      price_dates_count: countArray(row.price_dates),
      price_tiers_count: countPriceTiers(row.price_tiers),
      product_prices_count: countArray(row.product_prices),
      inclusions_count: countArray(row.inclusions),
      exclusions_count: countArray(row.excludes),
      optional_tours_count: countArray(row.optional_tours),
      itinerary_days_count: countItineraryDays(row.itinerary_data),
      product_thumbnail_count: countProductThumbnails(row.products),
    },
    public_snapshot: {
      package_revision: snapshot.package_revision,
      public_title: snapshot.public_title,
      public_subtitle: snapshot.public_subtitle,
      duration: snapshot.duration,
      destinations: snapshot.destinations,
      price_display: snapshot.price_display,
      price_tiers_count: countPriceTiers(snapshotPackage.price_tiers),
      option_policy: snapshot.option_policy,
      inclusions_public_count: countArray(snapshot.inclusions_public),
      exclusions_public_count: countArray(snapshot.exclusions_public),
      optional_tours_public_count: countArray(snapshot.optional_tours_public),
      itinerary_days_count: countItineraryDays(snapshot.itinerary_public),
      images_public_count: countArray(snapshot.images_public),
      cta_primary: snapshot.cta_copy.primary,
      cta_helper: snapshot.cta_copy.helper,
      card_title: truncateText(cardProjection.title),
      card_summary: truncateText(cardProjection.summary),
      lp_summary: truncateText(lpProjection.summary ?? snapshotPackage.product_summary, 260),
      route_text_count: countRouteText(snapshot),
    },
    mobile_landing_text: {
      route_text_sample: routeTextSample(snapshot),
    },
    fields: fieldStatuses(report),
    field_diagnostics: fieldDiagnostics(report),
    process_gap_summary: {
      blocked_fields: fieldsByStatus(report, 'blocked'),
      repairable_fields: fieldsByStatus(report, 'repairable'),
      next_actions: report.repair_actions,
    },
    repair_actions: report.repair_actions,
  };
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (!error || typeof error !== 'object') return String(error);
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function summarizeFieldStatus(rows: ReturnType<typeof diagnosePublicSnapshotGeneration>[]) {
  const fields: Record<PublicSnapshotGenerationField, Record<PublicSnapshotGenerationStatus, number>> = {
    title: { generated: 0, repairable: 0, blocked: 0 },
    summary: { generated: 0, repairable: 0, blocked: 0 },
    price: { generated: 0, repairable: 0, blocked: 0 },
    itinerary: { generated: 0, repairable: 0, blocked: 0 },
    terms: { generated: 0, repairable: 0, blocked: 0 },
    optional_tours: { generated: 0, repairable: 0, blocked: 0 },
    attractions: { generated: 0, repairable: 0, blocked: 0 },
    images: { generated: 0, repairable: 0, blocked: 0 },
    customer_copy: { generated: 0, repairable: 0, blocked: 0 },
  };

  for (const report of rows) {
    for (const diagnostic of report.diagnostics) {
      fields[diagnostic.field][diagnostic.status]++;
    }
  }
  return fields;
}

function summarizeProcessGaps(rows: ReturnType<typeof diagnosePublicSnapshotGeneration>[]) {
  const output: Record<string, {
    blocked: number;
    repairable: number;
    process_stages: Record<string, number>;
    required_source_evidence: Record<string, number>;
    repair_actions: Record<string, number>;
  }> = {};

  for (const report of rows) {
    for (const diagnostic of report.diagnostics) {
      if (diagnostic.status === 'generated') continue;
      const current = output[diagnostic.field] ?? {
        blocked: 0,
        repairable: 0,
        process_stages: {},
        required_source_evidence: {},
        repair_actions: {},
      };
      if (diagnostic.status === 'blocked') current.blocked++;
      if (diagnostic.status === 'repairable') current.repairable++;
      if (diagnostic.process_stage) increment(current.process_stages, diagnostic.process_stage);
      for (const evidence of diagnostic.required_source_evidence ?? []) increment(current.required_source_evidence, evidence);
      for (const action of diagnostic.repair_actions) increment(current.repair_actions, action);
      output[diagnostic.field] = current;
    }
  }

  return output;
}

function auditRow(row: AnyRecord) {
  const { snapshot, snapshotHash } = buildPublicPackageSnapshot(row);
  const snapshotPackage = snapshot.package && typeof snapshot.package === 'object' && !Array.isArray(snapshot.package)
    ? snapshot.package as AnyRecord
    : {};
  const gate = evaluatePublicSnapshotPublishGate({
    pkg: {
      ...row,
      title: snapshot.public_title,
      display_title: snapshot.public_title,
      hero_tagline: snapshot.public_subtitle ?? row.hero_tagline,
      product_summary: snapshotPackage.product_summary ?? row.product_summary,
      product_highlights: snapshotPackage.product_highlights ?? [],
      marketing_copies: snapshotPackage.marketing_copies ?? [],
      inclusions: snapshot.inclusions_public,
      excludes: snapshot.exclusions_public,
      optional_tours: snapshot.optional_tours_public,
      customer_notes: snapshotPackage.customer_notes ?? null,
      itinerary_data: snapshot.itinerary_public,
      price: snapshotPackage.price ?? row.price,
      price_dates: snapshotPackage.price_dates ?? row.price_dates,
      price_tiers: snapshotPackage.price_tiers ?? row.price_tiers,
      product_prices: snapshotPackage.product_prices ?? row.product_prices,
      images_public: snapshot.images_public,
      hero_image_url: snapshotPackage.hero_image_url,
      lp_hero_image_url: snapshotPackage.lp_hero_image_url,
      thumbnail_urls: snapshotPackage.thumbnail_urls,
      _public_notice_source_paths: snapshot.public_notice_source_paths,
      _card_projection: snapshot.card_projection,
      _lp_projection: snapshot.lp_projection,
    },
    sourcePkg: row,
    publicSnapshotHash: snapshotHash,
    publicSnapshotTitle: snapshot.public_title,
    snapshotExists: true,
    customerOpenContractOk: true,
    routeTextDump: snapshot.route_text_dump,
    publicNoticeSourcePaths: snapshot.public_notice_source_paths,
  });
  const report = diagnosePublicSnapshotGeneration({
    pkg: row,
    snapshot,
    hardBlockers: gate.hard_blockers,
  });

  return {
    item: buildAuditItem(row, snapshot, report),
    report,
  };
}

async function main() {
  const { isSupabaseConfigured, supabaseAdmin } = await import('../src/lib/supabase');
  const options = parseArgs();
  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured. Load .env.local before running this read-only audit.');
  }

  const selectColumns = [
    'id',
    'internal_code',
    'title',
    'display_title',
    'destination',
    'duration',
    'nights',
    'price',
    'price_dates',
    'price_tiers',
    'status',
    'publication_state',
    'package_revision',
    'audit_status',
    'audit_report',
    'updated_at',
    'raw_text',
    'hero_tagline',
    'product_summary',
    'product_highlights',
    'trip_style',
    'product_type',
    'airline',
    'inclusions',
    'excludes',
    'optional_tours',
    'itinerary_data',
    'products(display_name,thumbnail_urls)',
  ].join(',');

  let query = supabaseAdmin
    .from('travel_packages')
    .select(selectColumns)
    .limit(options.limit);
  if (!options.status.includes('all')) {
    query = query.in('status', options.status);
  }
  const { data, error } = await query;
  if (error) throw new Error(`travel_packages lookup failed: ${formatError(error)}`);

  const reports = [];
  const samples = [];
  const actionCounts: Record<string, number> = {};
  const golden: Record<string, unknown> = {};

  for (const row of ((data ?? []) as unknown as AnyRecord[])) {
    const { item, report } = auditRow(row);
    reports.push(report);
    for (const action of report.repair_actions) increment(actionCounts, action);

    const primaryItem = { ...item, audit_scope: 'primary_limit' };
    if (samples.length < options.samples && report.overall_status !== 'generated') samples.push(primaryItem);

    const key = goldenKey(row);
    if (key && !golden[key]) golden[key] = primaryItem;
  }

  for (const goldenItem of GOLDEN_SET) {
    if (golden[goldenItem.key]) continue;
    const filter = goldenLookupFilter(goldenItem);
    if (!filter) continue;

    let supplementalQuery = supabaseAdmin
      .from('travel_packages')
      .select(selectColumns)
      .or(filter)
      .limit(50);
    if (!options.status.includes('all')) {
      supplementalQuery = supplementalQuery.in('status', options.status);
    }
    const { data: supplementalRows, error: supplementalError } = await supplementalQuery;
    if (supplementalError) {
      golden[goldenItem.key] = {
        audit_scope: 'golden_supplemental_lookup_failed',
        error: formatError(supplementalError),
      };
      continue;
    }

    const matched = ((supplementalRows ?? []) as unknown as AnyRecord[])
      .find(row => goldenKey(row) === goldenItem.key);
    if (matched) {
      const { item } = auditRow(matched);
      golden[goldenItem.key] = { ...item, audit_scope: 'golden_supplemental_lookup' };
    }
  }

  const totals: Record<PublicSnapshotGenerationStatus, number> = { generated: 0, repairable: 0, blocked: 0 };
  for (const report of reports) increment(totals, report.overall_status);
  const fieldStatus = summarizeFieldStatus(reports);
  const processGaps = summarizeProcessGaps(reports);
  const report = {
    checked_at: new Date().toISOString(),
    scope: {
      status: options.status,
      limit: options.limit,
      total: reports.length,
    },
    totals,
    field_status: fieldStatus,
    process_gaps: processGaps,
    top_repair_actions: Object.entries(actionCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([action, count]) => ({ action, count })),
    golden_set: Object.fromEntries(GOLDEN_SET.map(item => [item.key, golden[item.key] ?? null])),
    samples,
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`Public snapshot generation readiness: ${reports.length} packages`);
  console.log(`Generated: ${totals.generated} / Repairable: ${totals.repairable} / Blocked: ${totals.blocked}`);
  console.log('\nField status:');
  for (const [field, counts] of Object.entries(fieldStatus)) {
    console.log(`- ${field}: generated=${counts.generated}, repairable=${counts.repairable}, blocked=${counts.blocked}`);
  }
  console.log('\nTop repair actions:');
  report.top_repair_actions.forEach(item => console.log(`- ${item.count}x ${item.action}`));
  console.log('\nGolden set:');
  for (const [key, value] of Object.entries(report.golden_set)) {
    console.log(`- ${key}: ${value ? 'sampled' : 'missing'}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(formatError(error));
    process.exit(1);
  });
}
