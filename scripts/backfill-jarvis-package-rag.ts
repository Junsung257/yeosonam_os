#!/usr/bin/env tsx

import dotenv from 'dotenv';
import { supabaseAdmin } from '../src/lib/supabase';
import { indexPackage, type IndexResult } from '../src/lib/jarvis/rag/indexer';

dotenv.config({ path: '.env.local' });
dotenv.config();

type PackageRow = {
  id: string;
  title: string | null;
  destination: string | null;
  internal_code: string | null;
  status: string | null;
  updated_at: string | null;
  product_highlights: string[] | null;
  country: string | null;
  short_code: string | null;
};

type CliOptions = {
  apply: boolean;
  json: boolean;
  statuses: string[];
  limit: number;
  scanLimit: number;
  sample: number;
  destination: string | null;
  ids: string[];
  includeAlreadyIndexed: boolean;
  sleepMs: number;
};

type Candidate = PackageRow & {
  hasRagChunk: boolean;
  missing: string[];
};

function readStringArg(args: string[], name: string): string | null {
  const prefix = `${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function readNumberArg(args: string[], name: string, fallback: number): number {
  const raw = readStringArg(args, name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
}

function parseOptions(args: string[]): CliOptions {
  const apply = args.includes('--apply');
  const explicitLimit = readStringArg(args, '--limit');
  const ids = (readStringArg(args, '--ids') ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  return {
    apply,
    json: args.includes('--json'),
    statuses: (readStringArg(args, '--status') ?? 'active')
      .split(',')
      .map((status) => status.trim())
      .filter(Boolean),
    limit: readNumberArg(args, '--limit', explicitLimit ? 1000 : apply ? 25 : 1000),
    scanLimit: readNumberArg(args, '--scan-limit', 1000),
    sample: readNumberArg(args, '--sample', 20),
    destination: readStringArg(args, '--destination'),
    ids,
    includeAlreadyIndexed: args.includes('--all'),
    sleepMs: readNumberArg(args, '--sleep-ms', apply ? 750 : 0),
  };
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function summarizeResult(results: IndexResult[]): IndexResult {
  return results.reduce<IndexResult>(
    (acc, result) => ({
      inserted: acc.inserted + result.inserted,
      skipped: acc.skipped + result.skipped,
      failed: acc.failed + result.failed,
    }),
    { inserted: 0, skipped: 0, failed: 0 },
  );
}

function missingFields(row: PackageRow, hasRagChunk: boolean): string[] {
  const missing: string[] = [];
  if (!hasRagChunk) missing.push('rag_chunk');
  if (!row.country?.trim()) missing.push('country');
  if (!row.short_code?.trim()) missing.push('short_code');
  if (!Array.isArray(row.product_highlights) || row.product_highlights.length === 0) {
    missing.push('product_highlights');
  }
  return missing;
}

function printJson(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

async function fetchPackageRows(options: CliOptions): Promise<PackageRow[]> {
  let query = supabaseAdmin
    .from('travel_packages')
    .select('id, title, destination, internal_code, status, updated_at, product_highlights, country, short_code')
    .in('status', options.statuses)
    .order('updated_at', { ascending: true })
    .limit(Math.max(options.scanLimit, options.limit, options.ids.length || 0));

  if (options.destination) {
    query = query.ilike('destination', `%${options.destination}%`);
  }
  if (options.ids.length > 0) {
    query = query.in('id', options.ids);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to load travel_packages: ${error.message}`);
  return (data ?? []) as PackageRow[];
}

async function getIndexedPackageIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const indexed = new Set<string>();

  for (let offset = 0; offset < ids.length; offset += 200) {
    const batch = ids.slice(offset, offset + 200);
    const { data, error } = await supabaseAdmin
      .from('jarvis_knowledge_chunks')
      .select('source_id')
      .eq('source_type', 'package')
      .in('source_id', batch);

    if (error) throw new Error(`Failed to load jarvis package chunks: ${error.message}`);
    for (const row of data ?? []) {
      const sourceId = (row as { source_id?: string | null }).source_id;
      if (sourceId) indexed.add(sourceId);
    }
  }

  return indexed;
}

async function buildCandidates(options: CliOptions): Promise<Candidate[]> {
  const rows = await fetchPackageRows(options);
  const indexedIds = await getIndexedPackageIds(rows.map((row) => row.id));

  return rows
    .map((row) => {
      const hasRagChunk = indexedIds.has(row.id);
      return {
        ...row,
        hasRagChunk,
        missing: missingFields(row, hasRagChunk),
      };
    })
    .filter((row) => options.includeAlreadyIndexed || !row.hasRagChunk)
    .slice(0, options.limit);
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const candidates = await buildCandidates(options);

  const destinationCounts = new Map<string, number>();
  const missingCounts = new Map<string, number>();
  for (const candidate of candidates) {
    destinationCounts.set(candidate.destination ?? 'unknown', (destinationCounts.get(candidate.destination ?? 'unknown') ?? 0) + 1);
    for (const missing of candidate.missing) {
      missingCounts.set(missing, (missingCounts.get(missing) ?? 0) + 1);
    }
  }

  const sample = candidates.slice(0, options.sample).map((candidate) => ({
    id: candidate.id,
    internal_code: candidate.internal_code,
    title: candidate.title,
    destination: candidate.destination,
    status: candidate.status,
    missing: candidate.missing,
  }));

  if (!options.apply) {
    const payload = {
      ok: true,
      mode: 'dry-run',
      statuses: options.statuses,
      scannedLimit: Math.max(options.scanLimit, options.limit, options.ids.length || 0),
      candidates: candidates.length,
      destinationCounts: Object.fromEntries(destinationCounts),
      missingCounts: Object.fromEntries(missingCounts),
      sample,
      nextCommand: 'npm run backfill:jarvis-package-rag -- --apply --limit=25',
    };
    if (options.json) printJson(payload);
    else {
      console.log(`Jarvis package RAG backfill dry-run: ${candidates.length} candidate package(s).`);
      console.log(`Statuses: ${options.statuses.join(', ')}`);
      console.log(`Top missing fields: ${Object.entries(payload.missingCounts).slice(0, 5).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}`);
      console.log('Sample:');
      for (const row of sample) {
        console.log(`- ${row.internal_code ?? row.id} | ${row.destination ?? 'unknown'} | ${row.title ?? '(untitled)'} | missing=${row.missing.join(',') || 'none'}`);
      }
      console.log(`Apply with: ${payload.nextCommand}`);
    }
    return;
  }

  if (!process.env.GOOGLE_AI_API_KEY) {
    throw new Error('GOOGLE_AI_API_KEY is required when running with --apply.');
  }

  const results: Array<{ id: string; internal_code: string | null; destination: string | null; result: IndexResult }> = [];
  for (const candidate of candidates) {
    const result = await indexPackage(candidate.id);
    results.push({
      id: candidate.id,
      internal_code: candidate.internal_code,
      destination: candidate.destination,
      result,
    });
    await sleep(options.sleepMs);
  }

  const totals = summarizeResult(results.map((row) => row.result));
  const payload = {
    ok: totals.failed === 0,
    mode: 'apply',
    processed: results.length,
    totals,
    failed: results.filter((row) => row.result.failed > 0).slice(0, options.sample),
  };

  if (options.json) printJson(payload);
  else {
    console.log(
      `Jarvis package RAG backfill applied: processed=${results.length}, ` +
      `inserted=${totals.inserted}, skipped=${totals.skipped}, failed=${totals.failed}`,
    );
    for (const row of payload.failed) {
      console.log(`- failed ${row.internal_code ?? row.id} | ${row.destination ?? 'unknown'} | chunksFailed=${row.result.failed}`);
    }
  }

  if (totals.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
