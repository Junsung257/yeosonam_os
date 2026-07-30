import { unstable_cache } from 'next/cache';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { resolveLpHeroPhotoUrl } from '@/lib/lp-hero-resolver';
import { mapTravelPackageToLandingData, type LandingProductData } from '@/lib/map-travel-package-to-lp';
import { isCustomerVisibleStatus } from '@/lib/visibility-status';
import { evaluateVerifyChecks } from '@/lib/upload-verify';
import {
  buildCandidatePublicPackageForProof,
  fetchLatestPublicPackageSnapshot,
} from '@/lib/package-publication/repository';
import { isPublicPublicationState } from '@/lib/package-publication/types';
import { isCustomerPubliclyOpenable } from '@/lib/package-public-eligibility';
import { isSafeImageSrc } from '@/lib/image-url';

export async function fetchLpPackageUncached(
  id: string,
  options: { allowNonPublicProof?: boolean } = {},
): Promise<LandingProductData | null> {
  if (!isSupabaseConfigured || !supabaseAdmin) return null;

  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const col = isUUID ? 'id' : 'short_code';

  const { data: rawPkg, error } = await supabaseAdmin
    .from('travel_packages')
    .select('*, products(internal_code, display_name, departure_region, thumbnail_urls)')
    .eq(col, id)
    .single();

  if (error || !rawPkg) return null;
  const proofCandidate = options.allowNonPublicProof
    ? buildCandidatePublicPackageForProof(rawPkg as Record<string, unknown>)
    : null;
  const publicSnapshot = options.allowNonPublicProof
    ? null
    : await fetchLatestPublicPackageSnapshot(
        supabaseAdmin,
        (rawPkg as { id: string }).id,
        { expectedPackageRevision: Number((rawPkg as { package_revision?: unknown }).package_revision ?? 1) },
      ).catch(() => null);
  const pkg = options.allowNonPublicProof ? proofCandidate?.package : publicSnapshot?.package;
  const status = (rawPkg as { status?: string | null }).status;
  const auditStatus = (rawPkg as { audit_status?: string | null }).audit_status;
  const publicationState = (rawPkg as { publication_state?: string | null }).publication_state;
  if (!options.allowNonPublicProof && !isPublicPublicationState(publicationState)) return null;
  if (!options.allowNonPublicProof && !publicSnapshot) return null;
  if (!options.allowNonPublicProof && (auditStatus === 'blocked' || !isCustomerVisibleStatus(status))) return null;
  if (!options.allowNonPublicProof && !isCustomerPubliclyOpenable(rawPkg)) return null;
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

  const frozenHeroCandidates = [
    (pkg as { lp_hero_image_url?: unknown }).lp_hero_image_url,
    (pkg as { hero_image_url?: unknown }).hero_image_url,
    ...(Array.isArray((pkg as { thumbnail_urls?: unknown }).thumbnail_urls)
      ? (pkg as { thumbnail_urls: unknown[] }).thumbnail_urls
      : []),
  ];
  let lpHero = frozenHeroCandidates.find(
    (value): value is string => typeof value === 'string' && isSafeImageSrc(value),
  ) ?? null;
  if (!lpHero && !publicSnapshot && !proofCandidate) {
    try {
      lpHero = await resolveLpHeroPhotoUrl(supabaseAdmin, pkg);
    } catch {
      // 레거시 비스냅샷 경로에서만 목적지 이미지로 보완한다.
    }
  }

  return mapTravelPackageToLandingData(
    { ...(pkg as Record<string, unknown>), _packageScores: scores ?? [] },
    lpHero,
  );
}

/** LP RSC용 — 300초 ISR, 패키지별 인자는 캐시 키에 포함됨 */
export const loadLpPackageForPage = unstable_cache(
  async (id: string) => fetchLpPackageUncached(id),
  ['lp-package-v1'],
  { revalidate: 300, tags: ['lp-packages'] },
);
