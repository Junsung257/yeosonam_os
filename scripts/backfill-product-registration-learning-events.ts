#!/usr/bin/env tsx

import { createHash } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

import type { ExtractedData } from '@/lib/parser';
import type { AttractionData } from '@/lib/attraction-matcher';
import { resolveUploadDestinationAndCodes } from '@/lib/product-registration/destination-resolution';
import { persistImprovementLedgerEvents } from '@/lib/product-registration/improvement-ledger-persistence';
import { loadProductRegistrationLearningReport } from '@/lib/product-registration/learning-engine-report';
import { registerProductFromRaw } from '@/lib/product-registration/register-product-from-raw';
import { runMicroAutoQA } from '@/lib/product-registration/auto-qa';

loadEnv({ path: '.env.local' });
loadEnv();

type PackageRow = {
  id: string;
  title: string;
  status: string | null;
  created_at: string | null;
  internal_code: string | null;
  destination: string | null;
  duration: number | null;
  departure_airport: string | null;
  airline: string | null;
  accommodations: string[] | null;
  inclusions: string[] | null;
  excludes: string[] | null;
  optional_tours: unknown;
  notices_parsed: unknown;
  price_tiers: unknown;
  itinerary: string[] | null;
  itinerary_data: unknown;
  min_participants: number | null;
  trip_style: string | null;
  raw_text: string | null;
  raw_text_hash: string | null;
  confidence: number | null;
};

type PackageIdRow = {
  id: string;
  created_at: string | null;
};

type BackfillResult = {
  id: string;
  code: string | null;
  title: string;
  rawTextHash: string;
  status: string;
  action: 'dry_run' | 'persisted' | 'skipped_existing' | 'failed';
  attempts: number;
  persisted: number;
  microStatus: string | null;
  triggers: string[];
  error: string | null;
};

type BackfillSupabaseClient = {
  from: (table: string) => any;
};

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const includeArchived = args.includes('--include-archived');
const json = args.includes('--json');
const strict = args.includes('--strict');
const skipMacroReport = args.includes('--skip-macro-report');
const missingOnly = args.includes('--missing-only');
const limit = Math.min(numberArg('--limit', 540), 5000);
const offset = Math.max(0, numberArg('--offset', 0));
const batchVersion = stringArg('--version', 'v1');
const beforeCreatedAt = stringArg('--before-created-at', '');

function stringArg(name: string, fallback: string): string {
  const found = args.find(arg => arg.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1) : fallback;
}

function numberArg(name: string, fallback: number): number {
  const raw = stringArg(name, String(fallback));
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function buildUploadId(pkg: PackageRow, rawTextHash: string): string {
  return `learning-backfill:${batchVersion}:${pkg.id}:${rawTextHash.slice(0, 12)}`;
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

const PACKAGE_SELECT = 'id,title,status,created_at,internal_code,destination,duration,departure_airport,airline,accommodations,inclusions,excludes,optional_tours,notices_parsed,price_tiers,itinerary,itinerary_data,min_participants,trip_style,raw_text,raw_text_hash,confidence';

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runSupabaseQuery<T>(
  label: string,
  queryFactory: () => PromiseLike<{ data: T | null; error: unknown }>,
): Promise<{ data: T | null; error: unknown }> {
  let lastResult: { data: T | null; error: unknown } | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = await queryFactory();
    lastResult = result;
    if (!result.error) return result;
    const message = errorMessage(result.error);
    if (!/schema cache|fetch failed|timeout|network|ECONNRESET|ETIMEDOUT/i.test(message)) break;
    if (attempt < 3) await sleep(500 * attempt);
  }
  if (lastResult?.error) console.error(`${label} failed: ${errorMessage(lastResult.error)}`);
  return lastResult ?? { data: null, error: `${label} failed` };
}

async function loadExistingBackfilledPackageIds(input: {
  supabase: BackfillSupabaseClient;
  batchVersion: string;
}): Promise<Set<string>> {
  const packageIds = new Set<string>();
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await runSupabaseQuery<Array<{ package_id: string | null }>>(
      'existing backfill package ids',
      () => input.supabase
        .from('product_registration_improvement_events')
        .select('package_id')
        .like('upload_id', `learning-backfill:${input.batchVersion}:%`)
        .range(from, from + 999) as unknown as PromiseLike<{ data: Array<{ package_id: string | null }> | null; error: unknown }>,
    );
    if (error) throw new Error(errorMessage(error));
    for (const row of data ?? []) {
      if (row.package_id) packageIds.add(row.package_id);
    }
    if (!data || data.length < 1000) break;
  }
  return packageIds;
}

async function loadPackageIdRows(input: {
  supabase: BackfillSupabaseClient;
  includeArchived: boolean;
  beforeCreatedAt: string;
  offset: number;
  limit: number;
  missingOnly: boolean;
  existingPackageIds: Set<string>;
}): Promise<PackageIdRow[]> {
  const rows: PackageIdRow[] = [];
  const pageSize = input.missingOnly ? 1000 : input.limit;
  for (let from = input.offset; from < 20_000 && rows.length < input.limit; from += pageSize) {
    const { data, error } = await runSupabaseQuery<PackageIdRow[]>(
      'travel_packages backfill id page',
      () => {
        let query = input.supabase
          .from('travel_packages')
          .select('id,created_at')
          .not('raw_text', 'is', null)
          .order('created_at', { ascending: false })
          .range(from, from + pageSize - 1);

        if (!input.includeArchived) query = query.not('status', 'in', '(archived,inactive)');
        if (input.beforeCreatedAt) query = query.lt('created_at', input.beforeCreatedAt);
        return query as unknown as PromiseLike<{ data: PackageIdRow[] | null; error: unknown }>;
      },
    );
    if (error) throw new Error(errorMessage(error));
    const page = data ?? [];
    for (const row of page) {
      if (input.missingOnly && input.existingPackageIds.has(row.id)) continue;
      rows.push(row);
      if (rows.length >= input.limit) break;
    }
    if (page.length < pageSize) break;
  }
  return rows;
}

async function main() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Missing Supabase URL or service role key');

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const activeAttractions: AttractionData[] = [];

  const existingPackageIds = new Set<string>();
  if (missingOnly) {
    for (const packageId of await loadExistingBackfilledPackageIds({ supabase, batchVersion })) {
      existingPackageIds.add(packageId);
    }
  }

  const idRows = await loadPackageIdRows({
    supabase,
    includeArchived,
    beforeCreatedAt,
    offset,
    limit,
    missingOnly,
    existingPackageIds,
  });

  const packages: PackageRow[] = [];
  for (const idRow of idRows ?? []) {
    const { data: pkg, error: pkgError } = await runSupabaseQuery<PackageRow>(
      `travel_packages ${idRow.id}`,
      () => supabase
        .from('travel_packages')
        .select(PACKAGE_SELECT)
        .eq('id', idRow.id)
        .single() as unknown as PromiseLike<{ data: PackageRow | null; error: unknown }>,
    );
    if (pkgError) throw new Error(errorMessage(pkgError));
    if (pkg && typeof pkg.raw_text === 'string' && pkg.raw_text.trim().length >= 50) {
      packages.push(pkg);
    }
  }

  const uploadIds = packages.map(pkg => buildUploadId(pkg, sha256(pkg.raw_text ?? '')));
  const existingUploadIds = new Set<string>();
  for (let start = 0; start < uploadIds.length; start += 100) {
    const chunk = uploadIds.slice(start, start + 100);
    if (chunk.length === 0) continue;
    const { data: existing, error: existingError } = await runSupabaseQuery<Array<{ upload_id: string | null }>>(
      'existing learning events',
      () => supabase
        .from('product_registration_improvement_events')
        .select('upload_id')
        .in('upload_id', chunk) as unknown as PromiseLike<{ data: Array<{ upload_id: string | null }> | null; error: unknown }>,
    );
    if (existingError) throw new Error(errorMessage(existingError));
    for (const row of existing ?? []) {
      if (row.upload_id) existingUploadIds.add(row.upload_id);
    }
  }

  const results: BackfillResult[] = [];
  for (const pkg of packages) {
    const rawText = String(pkg.raw_text ?? '');
    const rawTextHash = sha256(rawText);
    const uploadId = buildUploadId(pkg, rawTextHash);
    if (existingUploadIds.has(uploadId)) {
      results.push({
        id: pkg.id,
        code: pkg.internal_code,
        title: pkg.title,
        rawTextHash,
        status: String(pkg.status ?? ''),
        action: 'skipped_existing',
        attempts: 0,
        persisted: 0,
        microStatus: null,
        triggers: [],
        error: null,
      });
      continue;
    }

    try {
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
        activeAttractions,
        destinationResolution,
        destinationCode: destinationResolution.destinationCode,
        internalCode: pkg.internal_code,
        enableGeminiFallback: false,
        priceYear: 2026,
        confidence: pkg.confidence,
      });
      const microQA = runMicroAutoQA({
        uploadId,
        productId: pkg.internal_code,
        packageId: pkg.id,
        rawText,
        sectionRawText: rawText,
        registration,
        uploadFailed: !registration.deliverability.ok,
        trustScore: typeof pkg.confidence === 'number' ? pkg.confidence * 100 : null,
      });
      const persistence = apply
        ? await persistImprovementLedgerEvents({
            supabase,
            isSupabaseConfigured: true,
            events: microQA.attempts,
          })
        : { saved: 0, error: null };

      results.push({
        id: pkg.id,
        code: pkg.internal_code,
        title: pkg.title,
        rawTextHash,
        status: String(pkg.status ?? ''),
        action: apply ? 'persisted' : 'dry_run',
        attempts: microQA.attempts.length,
        persisted: persistence.saved,
        microStatus: microQA.status,
        triggers: microQA.triggers,
        error: persistence.error,
      });
    } catch (err) {
      results.push({
        id: pkg.id,
        code: pkg.internal_code,
        title: pkg.title,
        rawTextHash,
        status: String(pkg.status ?? ''),
        action: 'failed',
        attempts: 0,
        persisted: 0,
        microStatus: null,
        triggers: [],
        error: errorMessage(err),
      });
    }
  }

  const reportAfter = apply && !skipMacroReport
    ? await loadProductRegistrationLearningReport({
        supabase,
        isSupabaseConfigured: true,
        limit: 5000,
        fullRegressionVerified: true,
      })
    : null;

  const summary = {
    apply,
    batchVersion,
    scanned: packages.length,
    dryRun: results.filter(row => row.action === 'dry_run').length,
    persistedPackages: results.filter(row => row.action === 'persisted').length,
    skippedExisting: results.filter(row => row.action === 'skipped_existing').length,
    failed: results.filter(row => row.action === 'failed' || row.error).length,
    attempts: results.reduce((sum, row) => sum + row.attempts, 0),
    persistedEvents: results.reduce((sum, row) => sum + row.persisted, 0),
    statuses: results.reduce<Record<string, number>>((acc, row) => {
      const key = row.microStatus ?? row.action;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
    triggers: results.flatMap(row => row.triggers).reduce<Record<string, number>>((acc, trigger) => {
      acc[trigger] = (acc[trigger] ?? 0) + 1;
      return acc;
    }, {}),
    macroAfter: reportAfter ? {
      eventsPersisted: reportAfter.micro.eventsPersisted,
      macroCandidates: reportAfter.macro.candidates.length,
      promotionWorkItems: reportAfter.promotion.workItems.length,
      score: reportAfter.score,
      runReasons: reportAfter.macro.runReasons,
      topCandidates: reportAfter.macro.candidates.slice(0, 10).map(candidate => ({
        id: candidate.id,
        kind: candidate.kind,
        evidenceCount: candidate.evidenceCount,
        independentSourceCount: candidate.independentSourceCount,
        risk: candidate.risk,
        promotionReady: candidate.promotionReady,
      })),
    } : null,
    nextBeforeCreatedAt: packages
      .map(pkg => pkg.created_at)
      .filter((value): value is string => Boolean(value))
      .sort()
      [0] ?? null,
  };

  const output = {
    summary,
    failed: results.filter(row => row.action === 'failed' || row.error).slice(0, 30),
    samples: results.slice(0, 30),
  };

  if (json) console.log(JSON.stringify(output, null, 2));
  else {
    console.log('Product registration learning backfill');
    console.log(summary);
    if (output.failed.length > 0) console.table(output.failed);
  }

  await supabase.removeAllChannels();
  if (strict && summary.failed > 0) process.exit(1);
}

main().catch(error => {
  console.error(errorMessage(error));
  process.exit(1);
});
