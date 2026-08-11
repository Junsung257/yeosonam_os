import { unstable_cache } from 'next/cache';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { resolveLpHeroPhotoUrl } from '@/lib/lp-hero-resolver';
import { mapTravelPackageToLandingData, type LandingProductData } from '@/lib/map-travel-package-to-lp';
import { isCustomerVisibleStatus } from '@/lib/visibility-status';
import { evaluateVerifyChecks } from '@/lib/upload-verify';
import { fetchLatestPublicPackageSnapshot } from '@/lib/package-publication/repository';
import { isPublicPublicationState } from '@/lib/package-publication/types';
import { isCustomerPubliclyOpenable } from '@/lib/package-public-eligibility';

export async function fetchLpPackageUncached(
  id: string,
  options: { allowNonPublicProof?: boolean } = {},
): Promise<LandingProductData | null> {
  if (!isSupabaseConfigured || !supabaseAdmin) return null;

  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const col = isUUID ? 'id' : 'short_code';

  const { data: rawPkg, error } = await supabaseAdmin
    .from('travel_packages')
    .select('*, products(internal_code, display_name, departure_region)')
    .eq(col, id)
    .single();

  if (error || !rawPkg) return null;
  const publicSnapshot = options.allowNonPublicProof
    ? null
    : await fetchLatestPublicPackageSnapshot(
        supabaseAdmin,
        (rawPkg as { id: string }).id,
        { expectedPackageRevision: Number((rawPkg as { package_revision?: unknown }).package_revision ?? 1) },
      ).catch(() => null);
  const pkg = options.allowNonPublicProof ? rawPkg : publicSnapshot?.package;
  const status = (rawPkg as { status?: string | null }).status;
  const publicationState = (rawPkg as { publication_state?: string | null }).publication_state;
  if (!options.allowNonPublicProof && !isPublicPublicationState(publicationState)) return null;
  if (!options.allowNonPublicProof && !publicSnapshot) return null;
  const authoritativeV5Snapshot = Boolean(
    publicSnapshot?.row.canonical_revision_id
    && publicSnapshot.row.snapshot_hash,
  );
  if (!options.allowNonPublicProof && (!isCustomerVisibleStatus(status))) return null;
  if (!options.allowNonPublicProof && !isCustomerPubliclyOpenable(rawPkg, {
    authoritativeV5Snapshot,
    packageRevision: publicSnapshot?.row.package_revision,
    publicSnapshotHash: publicSnapshot?.row.snapshot_hash,
  })) return null;
  if (!pkg) return null;

  const liveVerify = publicSnapshot
    ? null
    : evaluateVerifyChecks(rawPkg as Parameters<typeof evaluateVerifyChecks>[0]);
  if (!options.allowNonPublicProof && liveVerify?.status === 'blocked') return null;

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
