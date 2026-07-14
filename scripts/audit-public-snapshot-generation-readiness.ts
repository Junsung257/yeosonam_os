import dotenv from 'dotenv';

import { buildPublicPackageSnapshot } from '../src/lib/package-publication/public-snapshot';
import { diagnosePublicSnapshotGeneration } from '../src/lib/package-publication/public-snapshot-diagnostics';
import type { PublicSnapshotGenerationField, PublicSnapshotGenerationStatus } from '../src/lib/package-publication/public-snapshot-diagnostics';
import { evaluatePublicSnapshotPublishGate } from '../src/lib/package-publication/publish-gate';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

type AnyRecord = Record<string, unknown>;

const GOLDEN_SET = [
  { key: 'yanji_baekdu', pattern: /연길|백두산/ },
  { key: 'zhangjiajie', pattern: /장가계/ },
  { key: 'danang_hoian', pattern: /다낭|호이안/ },
  { key: 'nhatrang_dalat', pattern: /나트랑|달랏/ },
  { key: 'phuquoc', pattern: /푸꾸옥/ },
  { key: 'fukuoka', pattern: /후쿠오카/ },
  { key: 'hokkaido', pattern: /북해도|홋카이도/ },
  { key: 'hanoi_halong', pattern: /하노이|하롱베이|하롱/ },
  { key: 'tsushima', pattern: /대마도/ },
  { key: 'cebu', pattern: /세부/ },
];

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

function rowText(row: AnyRecord): string {
  return [
    row.title,
    row.display_title,
    row.destination,
    row.raw_text,
    row.product_summary,
  ].map(value => String(value ?? '')).join('\n');
}

function goldenKey(row: AnyRecord): string | null {
  const haystack = rowText(row);
  return GOLDEN_SET.find(item => item.pattern.test(haystack))?.key ?? null;
}

function statusPriority(status: PublicSnapshotGenerationStatus): number {
  if (status === 'blocked') return 2;
  if (status === 'repairable') return 1;
  return 0;
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
    const { snapshot, snapshotHash } = buildPublicPackageSnapshot(row);
    const gate = evaluatePublicSnapshotPublishGate({
      pkg: {
        ...row,
        title: snapshot.public_title,
        display_title: snapshot.public_title,
        hero_tagline: snapshot.public_subtitle ?? row.hero_tagline,
        product_summary: snapshot.package.product_summary ?? row.product_summary,
        images_public: snapshot.images_public,
        hero_image_url: snapshot.package.hero_image_url,
        lp_hero_image_url: snapshot.package.lp_hero_image_url,
        thumbnail_urls: snapshot.package.thumbnail_urls,
        _public_notice_source_paths: snapshot.public_notice_source_paths,
        _card_projection: snapshot.card_projection,
        _lp_projection: snapshot.lp_projection,
      },
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
    reports.push(report);
    for (const action of report.repair_actions) increment(actionCounts, action);

    const item = {
      id: row.id,
      destination: row.destination ?? null,
      raw_title: row.title ?? null,
      public_title: snapshot.public_title,
      public_subtitle: snapshot.public_subtitle,
      overall_status: report.overall_status,
      fields: Object.fromEntries(report.diagnostics.map(diagnostic => [diagnostic.field, diagnostic.status])),
      repair_actions: report.repair_actions,
    };
    if (samples.length < options.samples && report.overall_status !== 'generated') samples.push(item);

    const key = goldenKey(row);
    if (key && !golden[key]) golden[key] = item;
  }

  const totals: Record<PublicSnapshotGenerationStatus, number> = { generated: 0, repairable: 0, blocked: 0 };
  for (const report of reports) increment(totals, report.overall_status);
  const fieldStatus = summarizeFieldStatus(reports);
  const report = {
    checked_at: new Date().toISOString(),
    scope: {
      status: options.status,
      limit: options.limit,
      total: reports.length,
    },
    totals,
    field_status: fieldStatus,
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

main().catch((error) => {
  console.error(formatError(error));
  process.exit(1);
});
