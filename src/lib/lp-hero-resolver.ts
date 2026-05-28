/**
 * LP·광고 랜딩용 히어로 이미지 URL — upload route의 관광지 매칭 결과 재활용.
 *
 * upload 시점에 enrichItineraryWithAttractionReferences()가 itinerary_data의
 * 각 schedule[]에 attraction_ids를 박는다. 이 함수는 DB에서 id로만 photos를 조회해
 * 중복 매칭 없이 히어로 이미지를 결정한다.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AttractionData } from '@/lib/attraction-matcher';
import { destinationToIsoSet } from '@/lib/destination-iso';

/** schedule item의 attraction_ids 필드 타입 — itinerary_data JSONB 내부 */
interface ItineraryDayData {
  day?: number;
  schedule?: Array<{
    activity?: string;
    type?: string;
    attraction_ids?: string[];
    attraction_names?: string[];
  }>;
  [key: string]: unknown;
}

export async function resolveLpHeroPhotoUrl(
  sb: SupabaseClient,
  pkg: { destination?: string | null; itinerary_data?: unknown },
): Promise<string | null> {
  if (!pkg?.destination) return null;

  // upload 시 박힌 attraction_ids 수집
  const collectedIds = collectAttractionIds(pkg.itinerary_data);
  if (collectedIds.length === 0) return null;

  // DB에서 photos만 조회 (중복 매칭 없음)
  const { data: detail } = await sb
    .from('attractions')
    .select('id, name, photos, country, region')
    .in('id', collectedIds);

  const matched = (detail ?? []) as unknown as AttractionData[];
  if (matched.length === 0) return null;

  const destIsoSet = destinationToIsoSet(pkg.destination);
  // 첫 번째로 photos가 있는 attraction 선택
  const hero = matched.find(
    a => a.photos && a.photos.length > 0 && a.country && destIsoSet.has(a.country),
  );
  const p = hero?.photos?.[0];
  return p?.src_large || p?.src_medium || null;
}

function collectAttractionIds(itineraryData: unknown): string[] {
  if (!itineraryData || typeof itineraryData !== 'object') return [];

  const raw = itineraryData as Record<string, unknown>;
  // itinSchema 구조: { days: [...] } 또는 [day1, day2, ...]
  const days: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray(raw.days)
      ? (raw.days as unknown[])
      : [];

  const ids = new Set<string>();
  for (const day of days) {
    if (!day || typeof day !== 'object') continue;
    const d = day as ItineraryDayData;
    if (!Array.isArray(d.schedule)) continue;
    for (const item of d.schedule) {
      if (Array.isArray(item.attraction_ids)) {
        for (const id of item.attraction_ids) {
          if (id && typeof id === 'string') ids.add(id);
        }
      }
    }
  }
  return Array.from(ids);
}
