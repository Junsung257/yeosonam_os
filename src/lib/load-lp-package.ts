import { unstable_cache } from 'next/cache';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { mapTravelPackageToLandingData, type LandingProductData } from '@/lib/map-travel-package-to-lp';
import { fetchPublicPackageSnapshotById, getCurrentPublicPackage } from '@/lib/package-publication/repository';
import { verifyProductRegistrationV6ProofToken } from '@/lib/product-registration-v6/proof-token';
import { currentProductRegistrationRendererBuildId } from '@/lib/product-registration-v6/renderer-build';
import { PLATFORM_PRODUCT_REGISTRATION_TENANT_ID } from '@/lib/product-registration-authority/types';

export async function fetchLpPackageUncached(
  id: string,
  options: { proofSnapshotId?: string | null; proofToken?: string | null } = {},
): Promise<LandingProductData | null> {
  if (!isSupabaseConfigured || !supabaseAdmin) return null;

  const exactProofSnapshot = options.proofSnapshotId && options.proofToken
    ? await fetchPublicPackageSnapshotById(supabaseAdmin, options.proofSnapshotId, { allowProofCopyIssues: true }).catch(() => null)
    : null;
  const proofClaims = exactProofSnapshot
    ? verifyProductRegistrationV6ProofToken(options.proofToken, {
        snapshotId: exactProofSnapshot.row.id,
        snapshotHash: exactProofSnapshot.row.snapshot_hash,
        packageId: exactProofSnapshot.row.package_id,
    })
    : null;
  const exactProofAllowed = Boolean(proofClaims && exactProofSnapshot);
  const rawProofPackage = exactProofAllowed ? exactProofSnapshot?.package ?? null : null;
  const publicSnapshot = exactProofAllowed
    ? exactProofSnapshot
    : await getCurrentPublicPackage(supabaseAdmin, {
      tenantId: PLATFORM_PRODUCT_REGISTRATION_TENANT_ID,
      packageRef: id,
      channel: 'customer',
      locale: 'ko-KR',
    }).catch(() => null);
   let pkg = publicSnapshot?.package;
   if (rawProofPackage) pkg = rawProofPackage;
  if (!pkg) return null;

  const { data: scores } = await supabaseAdmin
    .from('package_scores')
    .select('package_id, group_key, departure_date, list_price, effective_price, topsis_score, rank_in_group, group_size, breakdown, shopping_count, hotel_avg_grade, free_option_count, is_direct_flight, duration_days')
    .eq('package_id', (pkg as { id: string }).id)
    .order('group_size', { ascending: false })
    .order('rank_in_group', { ascending: true });

  const packageSnapshot = (pkg as Record<string, unknown>)._public_snapshot;
  const snapshotMetadata = packageSnapshot && typeof packageSnapshot === 'object' && !Array.isArray(packageSnapshot)
    ? packageSnapshot as Record<string, unknown>
    : {};
  return mapTravelPackageToLandingData(
    {
      ...(pkg as Record<string, unknown>),
      _packageScores: scores ?? [],
      _public_snapshot: {
        ...snapshotMetadata,
        // The immutable snapshot's renderer lineage is the proof contract.
        // Do not replace it with the current deployment build while reading a
        // published customer snapshot; a UI deployment must not silently
        // make every existing snapshot appear freshly proven.
        renderer_build_id: (publicSnapshot?.row as { renderer_build_id?: string | null } | undefined)?.renderer_build_id
          ?? currentProductRegistrationRendererBuildId(),
      },
    },
    null,
  );
}

/**
 * Snapshot content may be cached, but visibility is checked outside this
 * function on every route request. Per-package tags let a freeze/release event
 * evict the exact LP instead of relying on a broad five-minute stale window.
 */
export async function loadLpPackageForPage(id: string): Promise<LandingProductData | null> {
  const normalizedId = id.trim();
  if (!normalizedId) return null;
  return unstable_cache(
    async () => fetchLpPackageUncached(normalizedId),
    ['lp-package-v61', normalizedId],
    {
      revalidate: 300,
      tags: [
        'product:lp',
        `product:${normalizedId}`,
        `product:${normalizedId}:lp`,
      ],
    },
  )();
}
