#!/usr/bin/env tsx

import './load-script-env';

import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { supabaseAdmin } from '../src/lib/supabase';
import { CUSTOMER_VISIBLE_STATUSES } from '../src/lib/visibility-status';
import {
  parseMobileProofRefreshStatusFilter,
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
  statusList: string[];
  includePending: boolean;
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
    'cta_missing',
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
  const includePending = hasFlag('--include-pending');
  const defaultStatuses = includePending
    ? [...CUSTOMER_VISIBLE_STATUSES, 'pending', 'pending_review']
    : CUSTOMER_VISIBLE_STATUSES;
  return {
    apply: hasFlag('--apply'),
    json: hasFlag('--json'),
    summaryOnly: hasFlag('--summary-only'),
    limit: numberArg('--limit', 100, 500),
    batchSize: numberArg('--batch-size', 20, 100),
    baseUrl: (argValue('--base') || process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_BASE_URL || 'https://www.yeosonam.com').replace(/\/+$/, ''),
    reasons: parseReasons(argValue('--reasons')),
    statusList: parseMobileProofRefreshStatusFilter(argValue('--status'), defaultStatuses),
    includePending,
    skipAxe: hasFlag('--skip-axe'),
  };
}

async function loadRows(limit: number, statusList: string[]): Promise<MobileProofRefreshCandidateRow[]> {
  const scanLimit = Math.max(500, limit * 10, limit);
  const { data, error } = await supabaseAdmin
    .from('travel_packages')
    .select('*')
    .in('status', statusList)
    .order('updated_at', { ascending: false })
    .limit(scanLimit);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as MobileProofRefreshCandidateRow[];
  if (rows.length === 0) return rows;

  const ids = rows.map(row => row.id);
  const { data: pointers, error: pointerError } = await supabaseAdmin
    .from('product_registration_v5_publication_pointers')
    .select('package_id, current_snapshot_id, current_revision_id, state')
    .in('package_id', ids)
    .eq('channel', 'customer')
    .eq('locale', 'ko-KR')
    .eq('state', 'published');
  if (pointerError) throw new Error(pointerError.message);
  const pointerRows = (pointers ?? []) as Array<{
    package_id: string;
    current_snapshot_id: string | null;
    current_revision_id: string | null;
  }>;
  const snapshotIds = pointerRows.map(pointer => pointer.current_snapshot_id).filter((id): id is string => Boolean(id));
  const { data: snapshots, error: snapshotError } = snapshotIds.length
    ? await supabaseAdmin
      .from('public_package_snapshots')
      .select('id, package_id, canonical_revision_id, snapshot_hash, renderer_build_id, status')
      .in('id', snapshotIds)
      .eq('status', 'published')
    : { data: [], error: null };
  if (snapshotError) throw new Error(snapshotError.message);
  const snapshotById = new Map((snapshots ?? []).map(snapshot => [String(snapshot.id), snapshot as {
    id: string;
    package_id: string;
    canonical_revision_id: string | null;
    snapshot_hash: string;
    renderer_build_id: string;
  }]));
  const packageSnapshot = new Map<string, { snapshotId: string; revisionId: string; snapshotHash: string; rendererBuildId: string }>();
  for (const pointer of pointerRows) {
    const snapshot = pointer.current_snapshot_id ? snapshotById.get(String(pointer.current_snapshot_id)) : null;
    if (!snapshot || !pointer.current_revision_id || String(snapshot.canonical_revision_id) !== String(pointer.current_revision_id)) continue;
    packageSnapshot.set(pointer.package_id, {
      snapshotId: String(snapshot.id),
      revisionId: String(pointer.current_revision_id),
      snapshotHash: String(snapshot.snapshot_hash),
      rendererBuildId: String(snapshot.renderer_build_id),
    });
  }
  const { data: proofs, error: proofError } = await supabaseAdmin
    .from('product_registration_v5_proof_runs')
    .select('package_id, public_snapshot_id, revision_id, snapshot_hash, renderer_build_id, status, route, result, checked_at, created_at')
    .in('package_id', ids)
    .eq('status', 'passed')
    .order('created_at', { ascending: false });
  if (proofError) throw new Error(proofError.message);
  const proofByPackage = new Map<string, unknown>();
  for (const proof of proofs ?? []) {
    const binding = packageSnapshot.get(String(proof.package_id));
    if (!binding || proof.public_snapshot_id !== binding.snapshotId || proof.revision_id !== binding.revisionId || proof.snapshot_hash !== binding.snapshotHash || proof.renderer_build_id !== binding.rendererBuildId) continue;
    if (!proofByPackage.has(String(proof.package_id))) proofByPackage.set(String(proof.package_id), {
      status: proof.status,
      checked_at: proof.checked_at,
      package_revision: null,
      public_snapshot_hash: proof.snapshot_hash,
      app_build_id: proof.renderer_build_id,
      source: 'hwp-mobile-browser-proof',
      ...(proof.result && typeof proof.result === 'object' ? proof.result : {}),
    });
  }
  return rows.map(row => ({
    ...row,
    immutable_proof: proofByPackage.get(row.id) ?? null,
    immutable_snapshot_hash: packageSnapshot.get(row.id)?.snapshotHash ?? null,
    immutable_renderer_build_id: packageSnapshot.get(row.id)?.rendererBuildId ?? null,
  }));
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function runProofBatch(input: { batch: MobileProofRefreshCandidate[]; options: Options }) {
  const packageIds = input.batch.map(candidate => candidate.id).join(',');
  // The child intentionally keeps going after an individual package failure,
  // so its process exit code alone is not authoritative. Always capture the
  // JSON summary and turn any failed package or persistence error into a
  // failed refresh batch.
  const args = [
    'node_modules/tsx/dist/cli.mjs',
    'scripts/prove-hwp-mobile-render.ts',
    `--package-ids=${packageIds}`,
    `--base=${input.options.baseUrl}`,
    '--apply-pass-only',
    '--continue-on-fail',
    '--json',
    '--summary-only',
    ...(input.options.skipAxe ? ['--skip-axe'] : []),
  ];
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'pipe',
    encoding: 'utf8',
  });
  let childSummary: { total?: number; pass?: number; fail?: number } | null = null;
  try {
    const raw = result.stdout ?? '';
    const jsonStart = raw.lastIndexOf('{\n  "summary"');
    const parsed = JSON.parse(jsonStart >= 0 ? raw.slice(jsonStart) : raw) as { summary?: { total?: number; pass?: number; fail?: number } };
    childSummary = parsed.summary ?? null;
  } catch {
    childSummary = null;
  }
  const childFailed = childSummary ? Number(childSummary.fail ?? 0) > 0 : true;
  return {
    packageIds: input.batch.map(candidate => candidate.id),
    internalCodes: input.batch.map(candidate => candidate.internalCode),
    exitCode: result.status === 0 && !childFailed ? 0 : 1,
    childSummary,
    stdout: input.options.json && !input.options.summaryOnly ? result.stdout : undefined,
    stderr: result.status === 0 && !childFailed ? undefined : (result.stderr ?? result.stdout ?? '').slice(-4_000),
    error: result.error ? result.error.message : undefined,
  };
}

async function main() {
  const opts = options();
  const rows = await loadRows(opts.limit, opts.statusList);
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
    statusFilter: opts.statusList,
    includePending: opts.includePending,
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
    console.log(`mode=${report.mode} candidates=${summary.total} status=${opts.statusList.join(',')}`);
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
