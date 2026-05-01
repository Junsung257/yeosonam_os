import { supabaseAdmin } from '@/lib/supabase';

export interface HotelBrandEntry {
  patterns: string[];    // lowercase, whitespace/hyphen-stripped
  stars: number[];       // applicable star ratings (e.g. [4, 5])
  score: number;         // 0–1 within_star_score
  brand_family: string;
}

let _cache: HotelBrandEntry[] | null = null;
let _cacheAt = 0;
const CACHE_TTL = 3_600_000; // 1h

export async function loadBrandEntries(): Promise<HotelBrandEntry[]> {
  const now = Date.now();
  if (_cache && now - _cacheAt < CACHE_TTL) return _cache;

  const { data, error } = await supabaseAdmin
    .from('hotel_brands')
    .select('brand_family, name_patterns, applicable_stars, within_star_score');

  if (error || !data) {
    // DB 오류 시 빈 배열 반환 (brand bonus = 0으로 폴백)
    return _cache ?? [];
  }

  _cache = (data as Array<{
    brand_family: string;
    name_patterns: string[];
    applicable_stars: number[];
    within_star_score: number;
  }>).map(row => ({
    brand_family: row.brand_family,
    patterns: row.name_patterns.map(p => p.toLowerCase().replace(/[\s\-_]/g, '')),
    stars: row.applicable_stars.map(Number),
    score: Number(row.within_star_score),
  }));
  _cacheAt = now;
  return _cache;
}

export function invalidateBrandCache(): void {
  _cache = null;
  _cacheAt = 0;
}

/**
 * 호텔명 + 성급 → within_star_score 매핑.
 * 패턴이 hotelName 어딘가에 포함되면 매칭.
 * 미매칭 시 null (호출자가 0.5로 처리 → bonus 0원).
 */
export function matchBrandScore(
  hotelName: string,
  starGrade: number,
  entries: HotelBrandEntry[],
): number | null {
  const normalized = hotelName.toLowerCase().replace(/[\s\-_]/g, '');
  for (const b of entries) {
    if (!b.stars.includes(starGrade)) continue;
    for (const p of b.patterns) {
      if (normalized.includes(p)) return b.score;
    }
  }
  return null;
}
