import { NextRequest, NextResponse } from 'next/server';

import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';
import { publishProductRegistrationV5SnapshotAtomic } from '@/lib/product-registration-v4/publication';
import { getProductRegistrationV6RuntimeConfig } from '@/lib/product-registration-v6/runtime-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type V5PublishBody = {
  packageId?: unknown;
  revisionId?: unknown;
  snapshotId?: unknown;
  snapshotHash?: unknown;
  proofRunId?: unknown;
  expectedPointerVersion?: unknown;
  idempotencyKey?: unknown;
  policyVersion?: unknown;
  publicationState?: unknown;
  dryRun?: unknown;
};

type Preflight = {
  ok: boolean;
  packageId: string;
  revisionId: string;
  snapshotId: string;
  snapshotHash: string;
  proofRunId: string;
  expectedPointerVersion: number;
  currentPointerVersion: number;
  policyVersion: string;
  publicationState: 'approved' | 'published';
  blockers: string[];
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_RE = /^[0-9a-f]{64}$/;

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function uuidValue(value: unknown): string {
  const candidate = stringValue(value);
  return UUID_RE.test(candidate) ? candidate : '';
}

async function buildPreflight(body: V5PublishBody): Promise<Preflight | NextResponse> {
  const packageId = uuidValue(body.packageId);
  const revisionId = uuidValue(body.revisionId);
  const snapshotId = uuidValue(body.snapshotId);
  const proofRunId = uuidValue(body.proofRunId);
  const snapshotHash = stringValue(body.snapshotHash).toLowerCase();
  const policyVersion = stringValue(body.policyVersion) || 'v5-risk-policy-1';
  const requestedPublicationState = stringValue(body.publicationState);
  const publicationState = requestedPublicationState === 'approved' ? 'approved' : 'published';
  const expectedPointerVersion = Number(body.expectedPointerVersion);
  const blockers: string[] = [];

  if (!packageId) blockers.push('PACKAGE_ID_INVALID');
  if (!revisionId) blockers.push('REVISION_ID_INVALID');
  if (!snapshotId) blockers.push('SNAPSHOT_ID_INVALID');
  if (!proofRunId) blockers.push('PROOF_RUN_ID_INVALID');
  if (!HASH_RE.test(snapshotHash)) blockers.push('SNAPSHOT_HASH_INVALID');
  if (!Number.isInteger(expectedPointerVersion) || expectedPointerVersion < 0) blockers.push('POINTER_VERSION_INVALID');
  if (requestedPublicationState && !['approved', 'published'].includes(requestedPublicationState)) blockers.push('PUBLICATION_STATE_INVALID');
  if (blockers.length > 0) {
    return NextResponse.json({ ok: false, code: 'V5_PREFLIGHT_INVALID', blockers }, { status: 400 });
  }

  const [{ data: revision, error: revisionError }, { data: snapshot, error: snapshotError }, { data: proof, error: proofError }, { data: pointer, error: pointerError }, { data: policy, error: policyError }] = await Promise.all([
    supabaseAdmin.from('product_registration_v5_revisions')
      .select('id,package_id,status,payload_hash')
      .eq('id', revisionId)
      .maybeSingle(),
    supabaseAdmin.from('public_package_snapshots')
      .select('id,package_id,snapshot_hash,canonical_revision_id,status')
      .eq('id', snapshotId)
      .maybeSingle(),
    supabaseAdmin.from('product_registration_v5_proof_runs')
      .select('id,package_id,revision_id,public_snapshot_id,snapshot_hash,status')
      .eq('id', proofRunId)
      .maybeSingle(),
    supabaseAdmin.from('product_registration_v5_publication_pointers')
      .select('pointer_version,state')
      .eq('package_id', packageId)
      .eq('channel', 'customer')
      .eq('locale', 'ko-KR')
      .maybeSingle(),
    supabaseAdmin.from('product_registration_v5_publication_policies')
      .select('policy_version,enabled')
      .eq('policy_version', policyVersion)
      .maybeSingle(),
  ]);

  if (revisionError) blockers.push(`REVISION_LOOKUP_FAILED:${revisionError.message}`);
  if (snapshotError) blockers.push(`SNAPSHOT_LOOKUP_FAILED:${snapshotError.message}`);
  if (proofError) blockers.push(`PROOF_LOOKUP_FAILED:${proofError.message}`);
  if (pointerError) blockers.push(`POINTER_LOOKUP_FAILED:${pointerError.message}`);
  if (policyError) blockers.push(`POLICY_LOOKUP_FAILED:${policyError.message}`);

  const revisionRow = revision as { id?: string; package_id?: string | null; status?: string } | null;
  const snapshotRow = snapshot as { id?: string; package_id?: string; snapshot_hash?: string; canonical_revision_id?: string | null; status?: string } | null;
  const proofRow = proof as { id?: string; package_id?: string; revision_id?: string; public_snapshot_id?: string; snapshot_hash?: string; status?: string } | null;
  const pointerRow = pointer as { pointer_version?: number | null } | null;
  const policyRow = policy as { policy_version?: string; enabled?: boolean } | null;
  const currentPointerVersion = Number(pointerRow?.pointer_version ?? 0);

  if (!revisionRow?.id) blockers.push('REVISION_NOT_FOUND');
  if (revisionRow?.package_id !== packageId) blockers.push('REVISION_PACKAGE_MISMATCH');
  if (!revisionRow?.status || !['verified', 'approved', 'published'].includes(revisionRow.status)) blockers.push(`REVISION_NOT_PUBLISHABLE:${revisionRow?.status ?? 'missing'}`);
  if (!snapshotRow?.id) blockers.push('SNAPSHOT_NOT_FOUND');
  if (snapshotRow && snapshotRow.package_id !== packageId) blockers.push('SNAPSHOT_PACKAGE_MISMATCH');
  if (snapshotRow && snapshotRow.snapshot_hash !== snapshotHash) blockers.push('SNAPSHOT_HASH_MISMATCH');
  if (snapshotRow && snapshotRow.canonical_revision_id !== revisionId) blockers.push('SNAPSHOT_REVISION_MISMATCH');
  if (snapshotRow && !['approved', 'published'].includes(String(snapshotRow.status))) blockers.push('SNAPSHOT_NOT_PUBLIC');
  if (!proofRow?.id) blockers.push('PROOF_NOT_FOUND');
  if (proofRow && proofRow.package_id !== packageId) blockers.push('PROOF_PACKAGE_MISMATCH');
  if (proofRow && proofRow.revision_id !== revisionId) blockers.push('PROOF_REVISION_MISMATCH');
  if (proofRow && proofRow.public_snapshot_id !== snapshotId) blockers.push('PROOF_SNAPSHOT_MISMATCH');
  if (proofRow && proofRow.snapshot_hash !== snapshotHash) blockers.push('PROOF_HASH_MISMATCH');
  if (proofRow && proofRow.status !== 'passed') blockers.push(`PROOF_NOT_PASSED:${proofRow.status ?? 'missing'}`);
  if (currentPointerVersion !== expectedPointerVersion) blockers.push(`POINTER_VERSION_CONFLICT:${currentPointerVersion}`);
  if (!policyRow?.enabled) blockers.push('POLICY_NOT_ENABLED');

  return {
    ok: blockers.length === 0,
    packageId,
    revisionId,
    snapshotId,
    snapshotHash,
    proofRunId,
    expectedPointerVersion,
    currentPointerVersion,
    policyVersion,
    publicationState,
    blockers,
  };
}

async function postHandler(request: NextRequest) {
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ ok: false, code: 'SUPABASE_ADMIN_UNAVAILABLE' }, { status: 503 });
  }

  let body: V5PublishBody;
  try {
    body = await request.json() as V5PublishBody;
  } catch {
    return NextResponse.json({ ok: false, code: 'INVALID_JSON' }, { status: 400 });
  }

  const authority = getProductRegistrationV6RuntimeConfig();
  if (authority.authorityMode === 'kernel') {
    return NextResponse.json({
      ok: false,
      code: 'LEGACY_PUBLICATION_AUTHORITY_RETIRED',
    }, { status: 410, headers: { 'Cache-Control': 'no-store' } });
  }

  const preflight = await buildPreflight(body);
  if (preflight instanceof NextResponse) return preflight;

  const dryRun = body.dryRun !== false;
  if (dryRun) {
    return NextResponse.json({ ok: preflight.ok, dryRun: true, preflight }, { status: preflight.ok ? 200 : 409, headers: { 'Cache-Control': 'no-store' } });
  }
  if (process.env.PRODUCT_REGISTRATION_V5_AUTHORITATIVE !== '1') {
    return NextResponse.json({ ok: false, code: 'V5_AUTHORITATIVE_DISABLED', preflight }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
  }
  if (!preflight.ok) {
    return NextResponse.json({ ok: false, code: 'V5_PREFLIGHT_BLOCKED', preflight }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
  }

  const idempotencyKey = stringValue(body.idempotencyKey);
  if (!idempotencyKey) {
    return NextResponse.json({ ok: false, code: 'IDEMPOTENCY_KEY_REQUIRED' }, { status: 400 });
  }

  try {
    const result = await publishProductRegistrationV5SnapshotAtomic({
      supabase: supabaseAdmin,
      publication: {
        packageId: preflight.packageId,
        revisionId: preflight.revisionId,
        snapshotId: preflight.snapshotId,
        snapshotHash: preflight.snapshotHash,
        proofRunId: preflight.proofRunId,
        expectedPointerVersion: preflight.expectedPointerVersion,
        idempotencyKey,
        policyVersion: preflight.policyVersion,
        publicationState: preflight.publicationState,
      },
    });
    return NextResponse.json({ ok: true, dryRun: false, preflight, result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ ok: false, code: 'V5_PUBLICATION_FAILED', detail: sanitizeDbError(error), preflight }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
  }
}

export const POST = withAdminGuard(postHandler);
