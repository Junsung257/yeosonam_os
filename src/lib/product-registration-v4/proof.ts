import type { SupabaseClient } from '@supabase/supabase-js';

export type ProductRegistrationV5ProofStatus = 'pending' | 'passed' | 'failed' | 'stale' | 'blocked';

export type ProductRegistrationV5ProofInput = {
  tenantId?: string | null;
  packageId: string;
  revisionId: string;
  publicSnapshotId: string;
  snapshotHash: string;
  rendererBuildId: string;
  proofSuiteVersion: string;
  route: string;
  viewport: Record<string, unknown>;
  locale?: string;
  deviceProfile?: string;
  status: ProductRegistrationV5ProofStatus;
  result: Record<string, unknown>;
  screenshotHash?: string | null;
  checkedAt?: string | null;
};

function ensureHash(value: string, code: string): string {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(code);
  return value;
}

export function buildProductRegistrationV5ProofRow(input: ProductRegistrationV5ProofInput): Record<string, unknown> {
  if (!input.packageId || !input.revisionId || !input.publicSnapshotId) throw new Error('V5_PROOF_LINEAGE_REQUIRED');
  ensureHash(input.snapshotHash, 'V5_PROOF_SNAPSHOT_HASH_INVALID');
  if (!input.rendererBuildId.trim()) throw new Error('V5_PROOF_RENDERER_BUILD_REQUIRED');
  if (!input.proofSuiteVersion.trim()) throw new Error('V5_PROOF_SUITE_VERSION_REQUIRED');
  if (!input.route.trim()) throw new Error('V5_PROOF_ROUTE_REQUIRED');
  return {
    tenant_id: input.tenantId ?? null,
    package_id: input.packageId,
    revision_id: input.revisionId,
    public_snapshot_id: input.publicSnapshotId,
    snapshot_hash: input.snapshotHash,
    renderer_build_id: input.rendererBuildId,
    proof_suite_version: input.proofSuiteVersion,
    route: input.route,
    viewport: input.viewport,
    locale: input.locale ?? 'ko-KR',
    device_profile: input.deviceProfile ?? 'mobile',
    status: input.status,
    result: input.result,
    screenshot_hash: input.screenshotHash ?? null,
    checked_at: input.checkedAt ?? null,
  };
}

export async function persistProductRegistrationV5ProofRun(input: {
  supabase: SupabaseClient;
  proof: ProductRegistrationV5ProofInput;
}): Promise<{ proofRunId: string; inserted: boolean }> {
  const row = buildProductRegistrationV5ProofRow(input.proof);
  const query = input.supabase
    .from('product_registration_v5_proof_runs')
    .select('id')
    .eq('snapshot_hash', input.proof.snapshotHash)
    .eq('renderer_build_id', input.proof.rendererBuildId)
    .eq('proof_suite_version', input.proof.proofSuiteVersion)
    .eq('route', input.proof.route)
    .eq('locale', input.proof.locale ?? 'ko-KR')
    .eq('device_profile', input.proof.deviceProfile ?? 'mobile');
  const { data: existing, error: existingError } = await query.maybeSingle();
  if (existingError) throw existingError;
  if (existing) return { proofRunId: String((existing as { id: string }).id), inserted: false };

  const { data, error } = await input.supabase
    .from('product_registration_v5_proof_runs')
    .insert(row)
    .select('id')
    .single();
  if (error) {
    const { data: raced, error: racedError } = await input.supabase
      .from('product_registration_v5_proof_runs')
      .select('id')
      .eq('snapshot_hash', input.proof.snapshotHash)
      .eq('renderer_build_id', input.proof.rendererBuildId)
      .eq('proof_suite_version', input.proof.proofSuiteVersion)
      .eq('route', input.proof.route)
      .eq('locale', input.proof.locale ?? 'ko-KR')
      .eq('device_profile', input.proof.deviceProfile ?? 'mobile')
      .maybeSingle();
    if (racedError || !raced) throw error;
    return { proofRunId: String((raced as { id: string }).id), inserted: false };
  }
  return { proofRunId: String((data as { id: string }).id), inserted: true };
}
