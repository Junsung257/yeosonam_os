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
import { destinationToIsoSet } from '@/lib/destination-iso';

export async function resolveLpHeroPhotoUrl(
  sb: SupabaseClient,
  pkg: { destination?: string | null; itinerary_data?: unknown },
): Promise<string | null> {
  if (!pkg?.destination) return null;

  let matchQuery = sb.from('attractions').select('name, country, region, aliases, category, mrt_gid');

  const destTokens = pkg.destination.split(/[/,·&]/).map((t: string) => t.trim()).filter(Boolean);
  const regionClauses = destTokens.map((t: string) => `region.ilike.%${t}%`).join(',');
  // 2026-05-15 박제: page.tsx 와 동일한 ISO SSOT 사용 — country 정규화 trigger 적용 후 호환.
  const destIsoCountries = destinationToIsoSet(pkg.destination);
  const isoCountryClauses = [...destIsoCountries].map(c => `country.eq.${c}`).join(',');
  const koreanCountryList = '중국,베트남,일본,필리핀,태국,말레이시아,싱가포르,대만,몽골,라오스,인도네시아,홍콩,마카오';
  const koreanCountryClauses = koreanCountryList.split(',').map(c => `country.eq.${c}`).join(',');
  const clauses = [regionClauses, isoCountryClauses, koreanCountryClauses].filter(Boolean).join(',');
  matchQuery = matchQuery.or(clauses);

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
  // 2026-05-15 박제: country 가 ISO2 (VN/JP 등) 라 한글 destination 에 .includes 매칭 안 됨.
  //   destinationToIsoSet 으로 변환한 후 country 일치 확인.
  const destIsoSet = destinationToIsoSet(pkg.destination);
  const hero = pool.find(
    a => a.photos && a.photos.length > 0 && a.country && (
      destIsoSet.has(a.country) || pkg.destination!.includes(a.country)
    ),
  );
  const p = hero?.photos?.[0];
  return p?.src_large || p?.src_medium || null;
}
