#!/usr/bin/env tsx

/**
 * End-to-end canary for one already-ingested V5 package.
 *
 * It deliberately performs the same order as production:
 * customer proof -> immutable snapshot -> V5 proof rows -> status promotion
 * -> CAS pointer -> outbox delivery -> cache convergence observation.
 */
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

import { buildPublicPackageSnapshot } from '@/lib/package-publication/public-snapshot';
import { loadCustomerOpenContractForPackage } from '@/lib/product-registration/customer-open-contract';
import { persistProductRegistrationV5ProofRun } from '@/lib/product-registration-v4/proof';
import { publishProductRegistrationV5SnapshotAtomic } from '@/lib/product-registration-v4/publication';
import { processProductRegistrationV5OutboxBatch } from '@/lib/product-registration-v4/outbox-worker';
import { observeProductRegistrationV5ConvergenceBatch } from '@/lib/product-registration-v4/convergence-observer';

function arg(name: string): string | null {
  const value = process.argv.find(item => item.startsWith(`${name}=`));
  return value ? value.slice(name.length + 1) : null;
}

function loadEnvironment(): void {
  if (process.env.LIVE_ENV_FILE) dotenv.config({ path: process.env.LIVE_ENV_FILE, override: false });
  dotenv.config({ path: '.env.local', override: false });
  dotenv.config({ path: '.env', override: false });
}

function parseProofJson(stdout: string): {
  summary?: { pass?: number; fail?: number };
  results?: Array<Record<string, unknown>>;
} {
  const marker = stdout.lastIndexOf('{\n  "summary"');
  if (marker < 0) throw new Error('MOBILE_PROOF_JSON_NOT_FOUND');
  return JSON.parse(stdout.slice(marker)) as { summary?: { pass?: number; fail?: number }; results?: Array<Record<string, unknown>> };
}

function runMobileProof(packageId: string, baseUrl: string, apply: boolean): ReturnType<typeof parseProofJson> {
  const args = [
    'node_modules/tsx/dist/cli.mjs',
    'scripts/prove-hwp-mobile-render.ts',
    `--package-ids=${packageId}`,
    `--base=${baseUrl}`,
    '--continue-on-fail',
    '--skip-axe',
    '--json',
    ...(apply ? ['--apply-pass-only'] : []),
  ];
  const child = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if ((child.status ?? 1) !== 0) throw new Error(`MOBILE_PROOF_FAILED:${child.stderr?.slice(-1000) ?? ''}`);
  const parsed = parseProofJson(child.stdout ?? '');
  if (Number(parsed.summary?.pass ?? 0) !== 1 || Number(parsed.summary?.fail ?? 0) !== 0) {
    throw new Error('MOBILE_PROOF_NOT_PASS');
  }
  return parsed;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function main(): Promise<void> {
  loadEnvironment();
  const packageId = arg('--package-id');
  const revisionId = arg('--revision-id');
  const baseUrl = (arg('--base') || 'http://127.0.0.1:3100').replace(/\/+$/, '');
  if (!packageId || !revisionId) throw new Error('PACKAGE_AND_REVISION_REQUIRED');

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !serviceKey) throw new Error('SUPABASE_ADMIN_ENV_REQUIRED');
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // Refresh the customer-facing evidence first. This is the only step that
  // writes the legacy audit report; all V5 rows below bind to the resulting
  // immutable snapshot hash.
  runMobileProof(packageId, baseUrl, true);

  const { data: packageRow, error: packageError } = await supabase
    .from('travel_packages')
    .select('*')
    .eq('id', packageId)
    .single();
  if (packageError || !packageRow) throw new Error(packageError?.message || 'PACKAGE_NOT_FOUND');

  const contract = await loadCustomerOpenContractForPackage(supabase, packageId);
  if (!contract.ok) throw new Error(`CUSTOMER_OPEN_CONTRACT_BLOCKED:${contract.blockers.join('|')}`);

  const { data: revision, error: revisionError } = await supabase
    .from('product_registration_v5_revisions')
    .select('id,package_id,status,payload_hash,revision_no')
    .eq('id', revisionId)
    .single();
  if (revisionError || !revision) throw new Error(revisionError?.message || 'REVISION_NOT_FOUND');
  if (revision.package_id !== packageId) throw new Error('REVISION_PACKAGE_MISMATCH');
  if (!['verified', 'approved', 'published'].includes(String(revision.status))) {
    throw new Error(`REVISION_NOT_VERIFIED:${revision.status}`);
  }

  // The snapshot is the artifact that will be read after CAS publication.
  // Build it with the post-publication customer status so the browser proof
  // and the persisted public payload hash the same bytes.
  const { snapshot, snapshotHash } = buildPublicPackageSnapshot({
    ...(packageRow as Record<string, unknown>),
    status: 'active',
    publication_state: 'published',
  });
  const rendererBuildId = process.env.VERCEL_GIT_COMMIT_SHA || 'local-v5-canary';
  const proofReport = runMobileProof(packageId, baseUrl, false);
  const proofResult = asRecord(proofReport.results?.[0]);
  if (proofResult.public_snapshot_hash !== snapshotHash) {
    throw new Error(`PROOF_SNAPSHOT_HASH_MISMATCH:${String(proofResult.public_snapshot_hash)}:${snapshotHash}`);
  }

  const snapshotRow = {
    package_id: packageId,
    package_revision: Number((packageRow as { package_revision?: unknown }).package_revision ?? 1),
    snapshot_hash: snapshotHash,
    snapshot_json: snapshot,
    card_projection: snapshot.card_projection,
    lp_projection: snapshot.lp_projection,
    route_text_dump: snapshot.route_text_dump,
    source_raw_text_hash: (packageRow as { raw_text_hash?: string | null }).raw_text_hash ?? null,
    parser_revision: 'product-registration-v5-canary',
    audit_revision: (packageRow as { audit_checked_at?: string | null }).audit_checked_at ?? null,
    mobile_proof_revision: (packageRow as { package_revision?: unknown }).package_revision ?? null,
    app_build_id: rendererBuildId,
    status: 'approved',
    canonical_revision_id: revisionId,
    renderer_build_id: rendererBuildId,
    locale: 'ko-KR',
    projection_hashes: {},
  };

  let snapshotId = '';
  const { data: existingSnapshot, error: existingSnapshotError } = await supabase
    .from('public_package_snapshots')
    .select('id,canonical_revision_id,status')
    .eq('package_id', packageId)
    .eq('snapshot_hash', snapshotHash)
    .maybeSingle();
  if (existingSnapshotError) throw existingSnapshotError;
  if (existingSnapshot) {
    if (existingSnapshot.canonical_revision_id !== revisionId || !['approved', 'published'].includes(String(existingSnapshot.status))) {
      throw new Error('EXISTING_SNAPSHOT_NOT_APPROVED_FOR_REVISION');
    }
    snapshotId = String(existingSnapshot.id);
  } else {
    const { data: insertedSnapshot, error: insertSnapshotError } = await supabase
      .from('public_package_snapshots')
      .insert(snapshotRow)
      .select('id')
      .single();
    if (insertSnapshotError || !insertedSnapshot) throw new Error(insertSnapshotError?.message || 'SNAPSHOT_INSERT_FAILED');
    snapshotId = String(insertedSnapshot.id);
  }

  const checkedAt = new Date().toISOString();
  const proofRuns: string[] = [];
  for (const surface of (proofResult.surface_results as unknown[] ?? [])) {
    const surfaceResult = asRecord(surface);
    const route = String(surfaceResult.surface === 'lp' ? `/lp/${packageId}` : `/packages/${packageId}`);
    const persisted = await persistProductRegistrationV5ProofRun({
      supabase,
      proof: {
        packageId,
        revisionId,
        publicSnapshotId: snapshotId,
        snapshotHash,
        rendererBuildId,
        proofSuiteVersion: 'v5-customer-open-mobile-v1',
        route,
        viewport: { width: 390, height: 844 },
        locale: 'ko-KR',
        deviceProfile: 'mobile',
        status: surfaceResult.status === 'pass' ? 'passed' : 'failed',
        result: surfaceResult,
        screenshotHash: typeof surfaceResult.screen_hash === 'string' ? surfaceResult.screen_hash : null,
        checkedAt,
      },
    });
    proofRuns.push(persisted.proofRunId);
  }
  if (proofRuns.length !== 2) throw new Error('V5_PROOF_SURFACE_COUNT_INVALID');

  let promoted: unknown = revision.status;
  if (revision.status === 'verified') {
    const { data: promotedRevision, error: promoteError } = await supabase.rpc('promote_product_registration_v5_revision', {
      p_revision_id: revisionId,
      p_target_status: 'approved',
    });
    if (promoteError) throw promoteError;
    promoted = promotedRevision;
  }

  const { data: pointer } = await supabase
    .from('product_registration_v5_publication_pointers')
    .select('pointer_version')
    .eq('package_id', packageId)
    .eq('channel', 'customer')
    .eq('locale', 'ko-KR')
    .maybeSingle();
  const expectedPointerVersion = Number(pointer?.pointer_version ?? 0);
  const publication = await publishProductRegistrationV5SnapshotAtomic({
    supabase,
    publication: {
      packageId,
      revisionId,
      snapshotId,
      snapshotHash,
      proofRunId: proofRuns[0],
      expectedPointerVersion,
      idempotencyKey: `v5-canary:${packageId}:${snapshotHash}`,
      policyVersion: 'v5-risk-policy-1',
      publicationState: 'published',
    },
  });

  const outbox = await processProductRegistrationV5OutboxBatch({ supabase, limit: 10, workerId: `v5-canary-${packageId}` });
  const convergence = await observeProductRegistrationV5ConvergenceBatch({ supabase, baseUrl, limit: 10, timeoutMs: 30_000 });

  console.log(JSON.stringify({
    ok: true,
    packageId,
    revisionId,
    revisionStatus: promoted ?? 'approved',
    snapshot: { id: snapshotId, hash: snapshotHash, status: 'approved' },
    proofRuns,
    publication,
    outbox,
    convergence,
  }, null, 2));
}

void main().catch(error => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
});
