import type { SupabaseClient } from '@supabase/supabase-js';

import { persistProductRegistrationV5ProofRun } from '../product-registration-v4/proof';

export type CustomerSnapshotBinding = {
  tenantId: string | null;
  packageId: string;
  catalogProductId: string | null;
  snapshotId: string;
  revisionId: string;
  snapshotHash: string;
  rendererBuildId: string;
};

type ProofSurface = {
  surface: string;
  status: string;
  public_snapshot_hash?: string | null;
  renderer_build_id?: string | null;
  screen_hash?: string | null;
  customer_visible_hash?: string | null;
  checks?: unknown;
  [key: string]: unknown;
};

export type CustomerMobileProofPersistenceInput = {
  binding: CustomerSnapshotBinding;
  status: 'passed' | 'failed';
  checkedAt: string;
  packageUpdatedAt?: string | null;
  packageRevision?: number | null;
  surfaceResults: ProofSurface[];
  result: Record<string, unknown>;
  screenshotHash?: string | null;
};

export async function loadCurrentCustomerSnapshotBinding(input: {
  supabase: SupabaseClient;
  packageId: string;
}): Promise<CustomerSnapshotBinding | null> {
  const { data: pointer, error: pointerError } = await input.supabase
    .from('product_registration_v5_publication_pointers')
    .select('tenant_id, package_id, catalog_product_id, current_snapshot_id, current_revision_id, state')
    .eq('package_id', input.packageId)
    .eq('channel', 'customer')
    .eq('locale', 'ko-KR')
    .maybeSingle();
  if (pointerError) throw pointerError;
  if (!pointer?.current_snapshot_id || !pointer.current_revision_id || pointer.state !== 'published') return null;

  const { data: snapshot, error: snapshotError } = await input.supabase
    .from('public_package_snapshots')
    .select('id, package_id, tenant_id, catalog_product_id, canonical_revision_id, snapshot_hash, renderer_build_id, status')
    .eq('id', pointer.current_snapshot_id)
    .eq('package_id', input.packageId)
    .maybeSingle();
  if (snapshotError) throw snapshotError;
  if (!snapshot?.id || !snapshot.canonical_revision_id || !snapshot.snapshot_hash || !snapshot.renderer_build_id) return null;
  if (snapshot.status !== 'published') return null;
  if (String(snapshot.canonical_revision_id) !== String(pointer.current_revision_id)) return null;

  return {
    tenantId: pointer.tenant_id ? String(pointer.tenant_id) : snapshot.tenant_id ? String(snapshot.tenant_id) : null,
    packageId: String(pointer.package_id ?? input.packageId),
    catalogProductId: pointer.catalog_product_id
      ? String(pointer.catalog_product_id)
      : snapshot.catalog_product_id
        ? String(snapshot.catalog_product_id)
        : null,
    snapshotId: String(snapshot.id),
    revisionId: String(snapshot.canonical_revision_id),
    snapshotHash: String(snapshot.snapshot_hash),
    rendererBuildId: String(snapshot.renderer_build_id),
  };
}

function lineageMismatches(input: CustomerMobileProofPersistenceInput): string[] {
  const mismatches: string[] = [];
  for (const surface of input.surfaceResults) {
    if (surface.public_snapshot_hash && surface.public_snapshot_hash !== input.binding.snapshotHash) {
      mismatches.push(`${surface.surface}:snapshot_hash`);
    }
    if (surface.renderer_build_id && surface.renderer_build_id !== input.binding.rendererBuildId) {
      mismatches.push(`${surface.surface}:renderer_build_id`);
    }
  }
  return mismatches;
}

export async function persistCustomerMobileSnapshotProof(input: {
  supabase: SupabaseClient;
  proof: CustomerMobileProofPersistenceInput;
}): Promise<{ proofRunId: string; inserted: boolean }> {
  const mismatches = lineageMismatches(input.proof);
  if (input.proof.status === 'passed' && mismatches.length > 0) {
    throw new Error(`CUSTOMER_PROOF_LINEAGE_MISMATCH:${mismatches.join(',')}`);
  }

  const surfaceHashes = input.proof.surfaceResults
    .map(surface => `${surface.surface}:${surface.screen_hash ?? ''}:${surface.customer_visible_hash ?? ''}`)
    .join('|');
  const proofSuiteVersion = `hwp-mobile-browser-proof-v2-${input.proof.status}-${Buffer.from(surfaceHashes).toString('base64url').slice(0, 32)}`;
  return persistProductRegistrationV5ProofRun({
    supabase: input.supabase,
    proof: {
      tenantId: input.proof.binding.tenantId,
      catalogProductId: input.proof.binding.catalogProductId,
      packageId: input.proof.binding.packageId,
      revisionId: input.proof.binding.revisionId,
      publicSnapshotId: input.proof.binding.snapshotId,
      snapshotHash: input.proof.binding.snapshotHash,
      rendererBuildId: input.proof.binding.rendererBuildId,
      proofSuiteVersion,
      route: input.proof.surfaceResults.map(surface => surface.surface).sort().join('|'),
      viewport: { width: 390, height: 844, deviceScaleFactor: 2 },
      locale: 'ko-KR',
      deviceProfile: 'mobile-customer',
      status: input.proof.status,
      result: {
        ...input.proof.result,
        source: 'hwp-mobile-browser-proof',
        snapshotHash: input.proof.binding.snapshotHash,
        rendererBuildId: input.proof.binding.rendererBuildId,
        snapshotId: input.proof.binding.snapshotId,
        revisionId: input.proof.binding.revisionId,
        lineageMismatches: mismatches,
        legacyPackageMutation: false,
        screenshotArtifactsPrivate: false,
      },
      screenshotHash: input.proof.screenshotHash ?? null,
      checkedAt: input.proof.checkedAt,
    },
  });
}
