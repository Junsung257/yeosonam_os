import { unstable_cache } from 'next/cache';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { resolveLpHeroPhotoUrl } from '@/lib/lp-hero-resolver';
import { mapTravelPackageToLandingData, type LandingProductData } from '@/lib/map-travel-package-to-lp';

async function fetchLpPackageUncached(id: string): Promise<LandingProductData | null> {
  if (!isSupabaseConfigured || !supabaseAdmin) return null;

  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const col = isUUID ? 'id' : 'short_code';

  const { data: pkg, error } = await supabaseAdmin
    .from('travel_packages')
    .select('*, products(internal_code, display_name, departure_region)')
    .eq(col, id)
    .single();

  if (error || !pkg) return null;

  let lpHero: string | null = null;
  try {
    lpHero = await resolveLpHeroPhotoUrl(supabaseAdmin, pkg);
  } catch {
    // 히어로 실패 시 그라디언트만
  }

  return mapTravelPackageToLandingData(pkg as Record<string, unknown>, lpHero);
}

/** LP RSC용 — 300초 ISR, 패키지별 인자는 캐시 키에 포함됨 */
export const loadLpPackageForPage = unstable_cache(
  async (id: string) => fetchLpPackageUncached(id),
  ['lp-package-v1'],
  { revalidate: 300, tags: ['lp-packages'] },
);
