#!/usr/bin/env tsx

import './load-script-env';

import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { supabaseAdmin } from '../src/lib/supabase';
import { CUSTOMER_VISIBLE_STATUSES } from '../src/lib/visibility-status';
import {
  selectMobileProofRefreshCandidates,
  summarizeMobileProofRefreshCandidates,
  type MobileProofRefreshCandidate,
  type MobileProofRefreshCandidateRow,
  type MobileProofRefreshReason,
} from '../src/lib/product-registration/mobile-proof-refresh-candidates';

type Options = {
  apply: boolean;
  json: boolean;
  summaryOnly: boolean;
  limit: number;
  batchSize: number;
  baseUrl: string;
  reasons: MobileProofRefreshReason[];
  skipAxe: boolean;
};

function argValue(name: string): string | null {
  const prefix = `${name}=`;
  const found = process.argv.find(arg => arg.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function numberArg(name: string, fallback: number, max: number): number {
  const parsed = Number(argValue(name));
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function parseReasons(value: string | null): MobileProofRefreshReason[] {
  const allowed = new Set<MobileProofRefreshReason>([
    'missing',
    'stale',
    'hash_missing',
    'surface_missing',
    'source_invalid',
    'status_not_pass',
    'unknown',
  ]);
  return String(value ?? '')
    .split(',')
    .map(item => item.trim())
    .filter((item): item is MobileProofRefreshReason => allowed.has(item as MobileProofRefreshReason));
}

function options(): Options {
  return {
    apply: hasFlag('--apply'),
    json: hasFlag('--json'),
    summaryOnly: hasFlag('--summary-only'),
    limit: numberArg('--limit', 100, 500),
    batchSize: numberArg('--batch-size', 20, 100),
    baseUrl: (argValue('--base') || process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_BASE_URL || 'https://www.yeosonam.com').replace(/\/+$/, ''),
    reasons: parseReasons(argValue('--reasons')),
    skipAxe: hasFlag('--skip-axe'),
  };
}

async function loadPublicRows(limit: number): Promise<MobileProofRefreshCandidateRow[]> {
  const { data, error } = await supabaseAdmin
    .from('travel_packages')
    .select('id,internal_code,title,status,updated_at,audit_report')
    .in('status', [...CUSTOMER_VISIBLE_STATUSES])
    .order('updated_at', { ascending: false })
    .limit(Math.max(limit * 3, limit));
  if (error) throw new Error(error.message);
  return (data ?? []) as MobileProofRefreshCandidateRow[];
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function runProofBatch(input: { batch: MobileProofRefreshCandidate[]; options: Options }) {
  const packageIds = input.batch.map(candidate => candidate.id).join(',');
  const captureChildOutput = input.options.json && !input.options.summaryOnly;
  const args = [
    'node_modules/tsx/dist/cli.mjs',
    'scripts/prove-hwp-mobile-render.ts',
    `--package-ids=${packageIds}`,
    `--base=${input.options.baseUrl}`,
    '--apply-pass-only',
    '--continue-on-fail',
    '--json',
    ...(input.options.skipAxe ? ['--skip-axe'] : []),
  ];
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: input.options.json ? 'pipe' : 'inherit',
    encoding: 'utf8',
  });
  return {
    packageIds: input.batch.map(candidate => candidate.id),
    internalCodes: input.batch.map(candidate => candidate.internalCode),
    exitCode: result.status ?? 1,
    stdout: captureChildOutput ? result.stdout : undefined,
    stderr: result.status === 0 ? undefined : (result.stderr ?? '').slice(0, 4_000),
    error: result.error ? result.error.message : undefined,
  };
}

async function main() {
  const opts = options();
  const rows = await loadPublicRows(opts.limit);
  const candidates = selectMobileProofRefreshCandidates(rows, {
    limit: opts.limit,
    reasons: opts.reasons,
  });
  const summary = summarizeMobileProofRefreshCandidates(candidates);
  const runs = opts.apply
    ? chunks(candidates, opts.batchSize).map(batch => runProofBatch({ batch, options: opts }))
    : [];
  const ok = runs.every(run => run.exitCode === 0);
  const report = {
    checkedAt: new Date().toISOString(),
    mode: opts.apply ? 'apply' : 'dry-run',
    baseUrl: opts.baseUrl,
    summary,
    candidates: opts.summaryOnly ? [] : candidates.map(candidate => ({
      id: candidate.id,
      internalCode: candidate.internalCode,
      status: candidate.status,
      reason: candidate.reason,
      detail: candidate.detail,
      updatedAt: candidate.updatedAt,
    })),
    runs,
    ok,
  };

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('[mobile-proof-refresh]');
    console.log(`mode=${report.mode} candidates=${summary.total}`);
    console.log(`byReason=${JSON.stringify(summary.byReason)}`);
    for (const candidate of report.candidates.slice(0, 20)) {
      console.log(`- ${candidate.internalCode ?? candidate.id} ${candidate.reason}: ${candidate.detail}`);
    }
  }
  if (!ok) process.exit(1);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
