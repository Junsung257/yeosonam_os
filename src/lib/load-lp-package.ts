import { unstable_cache } from 'next/cache';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { resolveLpHeroPhotoUrl } from '@/lib/lp-hero-resolver';
import { mapTravelPackageToLandingData, type LandingProductData } from '@/lib/map-travel-package-to-lp';
import { getPublishedPackageDetail } from '@/lib/public-packages';

export async function fetchLpPackageUncached(
  id: string,
  options: { allowNonPublicProof?: boolean } = {},
): Promise<LandingProductData | null> {
  if (!isSupabaseConfigured || !supabaseAdmin) return null;

  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  let pkg: Record<string, unknown> | null = null;
  if (options.allowNonPublicProof) {
    const col = isUUID ? 'id' : 'short_code';
    const { data: rawPkg, error } = await supabaseAdmin
      .from('travel_packages')
      .select('*, products(internal_code, display_name, departure_region)')
      .eq(col, id)
      .single();
    if (error || !rawPkg) return null;
    pkg = rawPkg as Record<string, unknown>;
  } else {
    let packageId = id;
    if (!isUUID) {
      const { data: selected, error } = await supabaseAdmin
        .from('travel_packages')
        .select('id')
        .eq('short_code', id)
        .maybeSingle();
      if (error || !selected?.id) return null;
      packageId = selected.id;
    }
    pkg = await getPublishedPackageDetail(supabaseAdmin, packageId);
  }
  if (!pkg) return null;

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
  ['lp-package-v1'],
  { revalidate: 300, tags: ['lp-packages'] },
);
