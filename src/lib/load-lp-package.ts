import { unstable_cache } from 'next/cache';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { resolveLpHeroPhotoUrl } from '@/lib/lp-hero-resolver';
import { mapTravelPackageToLandingData, type LandingProductData } from '@/lib/map-travel-package-to-lp';
import { evaluateVerifyChecks } from '@/lib/upload-verify';
import { fetchPublicPackageSnapshotById, getCurrentPublicPackage } from '@/lib/package-publication/repository';
import { verifyProductRegistrationV6ProofToken } from '@/lib/product-registration-v6/proof-token';
import { PLATFORM_PRODUCT_REGISTRATION_TENANT_ID } from '@/lib/product-registration-authority/types';

export async function fetchLpPackageUncached(
  id: string,
  options: { allowNonPublicProof?: boolean; proofSnapshotId?: string | null; proofToken?: string | null } = {},
): Promise<LandingProductData | null> {
  if (!isSupabaseConfigured || !supabaseAdmin) return null;

  const exactProofSnapshot = options.proofSnapshotId && options.proofToken
    ? await fetchPublicPackageSnapshotById(supabaseAdmin, options.proofSnapshotId).catch(() => null)
    : null;
  const proofClaims = exactProofSnapshot
    ? verifyProductRegistrationV6ProofToken(options.proofToken, {
        snapshotId: exactProofSnapshot.row.id,
        snapshotHash: exactProofSnapshot.row.snapshot_hash,
        packageId: exactProofSnapshot.row.package_id,
    })
    : null;
  const exactProofAllowed = Boolean(proofClaims && exactProofSnapshot);
  const publicSnapshot = exactProofAllowed
    ? exactProofSnapshot
    : options.allowNonPublicProof
      ? null
      : await getCurrentPublicPackage(supabaseAdmin, {
        tenantId: PLATFORM_PRODUCT_REGISTRATION_TENANT_ID,
        packageRef: id,
        channel: 'customer',
        locale: 'ko-KR',
      }).catch(() => null);
  let rawProofPackage: Record<string, unknown> | null = null;
  if (options.allowNonPublicProof && !exactProofAllowed) {
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    const { data } = await supabaseAdmin
      .from('travel_packages')
      .select('*, products(internal_code, display_name, departure_region)')
      .eq(isUUID ? 'id' : 'short_code', id)
      .maybeSingle();
    rawProofPackage = data as Record<string, unknown> | null;
  }
  const pkg = exactProofAllowed ? exactProofSnapshot?.package : options.allowNonPublicProof ? rawProofPackage : publicSnapshot?.package;
  if (!pkg) return null;

  const liveVerify = publicSnapshot || !rawProofPackage
    ? null
    : evaluateVerifyChecks(rawProofPackage as Parameters<typeof evaluateVerifyChecks>[0]);
  if (!options.allowNonPublicProof && !exactProofAllowed && liveVerify?.status === 'blocked') return null;

  const { data: scores } = await supabaseAdmin
    .from('package_scores')
    .select('package_id, group_key, departure_date, list_price, effective_price, topsis_score, rank_in_group, group_size, breakdown, shopping_count, hotel_avg_grade, free_option_count, is_direct_flight, duration_days')
    .eq('package_id', (pkg as { id: string }).id)
    .order('group_size', { ascending: false })
    .order('rank_in_group', { ascending: true });

  let lpHero: string | null = null;
  try {
    lpHero = await resolveLpHeroPhotoUrl(supabaseAdmin, pkg);
  } catch {
    // 히어로 실패 시 그라디언트만
  }

  return mapTravelPackageToLandingData(
    { ...(pkg as Record<string, unknown>), _packageScores: scores ?? [] },
    lpHero,
  );
}

/** LP RSC용 — 300초 ISR, 패키지별 인자는 캐시 키에 포함됨 */
export const loadLpPackageForPage = unstable_cache(
  async (id: string) => fetchLpPackageUncached(id),
  // Bump the cache contract whenever the source changes from mutable
  // travel_packages to proof-bound V5 public snapshots. A cached null from a
  // pre-publication read must never hide a newly published package.
  // Bump when the LP projection adds/removes customer-visible source facts;
  // otherwise a prior deployment's unstable_cache entry can keep stale legal
  // and preparation notices on the landing route after a successful publish.
  ['lp-package-v3-v5-public-snapshot-source-notices'],
  { revalidate: 300, tags: ['lp-packages'] },
);
