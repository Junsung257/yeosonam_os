/**
 * LP·광고 랜딩용 히어로 이미지 URL — 상품 상세(DetailClient)와 동일한 2단계 관광지 매칭 규칙.
 * GET /api/packages?id= 에서만 호출해 CDN 캐시와 함께 서빙 (클라이언트 이중 fetch 방지).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildAttractionIndex,
  matchAttractionIndexed,
  normalizeDays,
} from '@/lib/attraction-matcher';
import type { AttractionData } from '@/lib/attraction-matcher';

export async function resolveLpHeroPhotoUrl(
  sb: SupabaseClient,
  pkg: { destination?: string | null; itinerary_data?: unknown },
): Promise<string | null> {
  if (!pkg?.destination) return null;

  let matchQuery = sb.from('attractions').select('name, country, region, aliases');

  const destTokens = pkg.destination.split(/[/,·&]/).map((t: string) => t.trim()).filter(Boolean);
  const regionClauses = destTokens.map((t: string) => `region.ilike.%${t}%`).join(',');
  const countryList = '중국,베트남,일본,필리핀,태국,말레이시아,싱가포르,대만,몽골,라오스,인도네시아,홍콩,마카오';
  const countryClauses = countryList.split(',').map(c => `country.eq.${c}`).join(',');
  const destCountryClause = `country.ilike.%${pkg.destination}%`;
  matchQuery = matchQuery.or(`${regionClauses},${destCountryClause},${countryClauses}`);

  const matchResult = await matchQuery.limit(3000);
  const lightAttractions = (matchResult.data ?? []) as unknown as AttractionData[];

  const matchedNames = new Set<string>();
  if (pkg.itinerary_data && lightAttractions.length) {
    const index = buildAttractionIndex(lightAttractions, pkg.destination);
    const daysData = normalizeDays<{ day: number; schedule?: { activity: string; type?: string }[] }>(
      pkg.itinerary_data,
    );
    for (const day of daysData) {
      for (const item of day.schedule || []) {
        if (item.type === 'flight' || item.type === 'hotel' || item.type === 'shopping') continue;
        const single = matchAttractionIndexed(item.activity, index);
        if (single) matchedNames.add(single.name);
        if (!single && /[,，]/.test(item.activity)) {
          const parts = item.activity
            .replace(/^▶/, '')
            .split(/[,，]\s*/)
            .map(s => s.trim())
            .filter(s => s.length >= 2);
          for (const part of parts) {
            const m = matchAttractionIndexed(part, index);
            if (m) matchedNames.add(m.name);
          }
        }
      }
    }
  }

  let relevantAttractions: AttractionData[] = [];
  if (matchedNames.size > 0) {
    const { data: detail } = await sb
      .from('attractions')
      .select('id, name, photos, country, region')
      .in('name', Array.from(matchedNames));
    relevantAttractions = (detail ?? []) as unknown as AttractionData[];
  }

  const pool = relevantAttractions.length > 0 ? relevantAttractions : lightAttractions;
  const hero = pool.find(
    a => a.photos && a.photos.length > 0 && a.country && pkg.destination!.includes(a.country),
  );
  const p = hero?.photos?.[0];
  return p?.src_large || p?.src_medium || null;
}
