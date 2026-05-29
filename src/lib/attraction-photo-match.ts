/**
 * @file attraction-photo-match.ts — 관광지 단위 사진 자동 검색
 *
 * Pexels + Wikimedia Commons 에서 관광지 사진을 찾아 attractions.photos 에 저장.
 * runAutoPhotoMatch (제품 단위) 와 달리 관광지(attraction) 자체의 사진을 관리.
 *
 * 호출 시점:
 *   - 신규 관광지 INSERT 직후 (upload route 에서 fire-and-forget)
 *   - cron: photos 가 빈 attractions 대상 배치 처리 (매일)
 */

import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { searchPexelsPhotos, isPexelsConfigured } from '@/lib/pexels';
import type { PexelsPhoto } from '@/lib/pexels';

const WIKIMEDIA_API = 'https://commons.wikimedia.org/w/api.php';
const UA = 'YeosonamOS/1.0 (https://yeosonam.com; admin@yeosonam.com) attraction-photo-match';

export interface AttractionPhoto {
  src_medium: string;
  src_large: string;
  photographer: string;
  source: 'pexels' | 'wikimedia';
  /** Wikimedia 경우 없음 */
  pexels_id?: number;
}

/**
 * Pexels 로 관광지 사진 검색.
 * 한국어/영어 키워드를 조합해 다양성 확보.
 */
async function searchPexelsForAttraction(
  keywords: string[],
  count: number,
): Promise<AttractionPhoto[]> {
  if (!isPexelsConfigured()) return [];
  const results: AttractionPhoto[] = [];
  const seen = new Set<string>();

  for (const kw of keywords) {
    if (results.length >= count) break;
    const searchKws = [`${kw} travel`, `${kw} landscape`, `${kw} sightseeing`];
    for (const sk of searchKws) {
      if (results.length >= count) break;
      try {
        const photos = await searchPexelsPhotos(sk, 3);
        for (const p of photos) {
          if (seen.has(p.url)) continue;
          seen.add(p.url);
          results.push({
            src_medium: p.src.medium,
            src_large: p.src.large,
            photographer: p.photographer,
            source: 'pexels',
            pexels_id: p.id,
          });
          if (results.length >= count) break;
        }
      } catch {
        continue;
      }
    }
  }
  return results;
}

/**
 * Wikimedia Commons 에서 qid 기반 이미지 검색.
 */
async function searchWikimediaForAttraction(
  qid: string,
): Promise<AttractionPhoto[]> {
  try {
    // 1) wbgetentities 로 P18 image filename 획득
    const entUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=claims&format=json`;
    const entRes = await fetch(entUrl, { headers: { 'User-Agent': UA } });
    if (!entRes.ok) return [];
    const entJson = await entRes.json() as { entities?: Record<string, { claims?: Record<string, unknown> }> };
    const entity = entJson.entities?.[qid];
    if (!entity) return [];

    const p18Claims = entity.claims?.P18 as Array<{ mainsnak?: { datavalue?: { value?: string } } }> | undefined;
    if (!p18Claims) return [];

    const results: AttractionPhoto[] = [];
    for (const claim of p18Claims) {
      const filename = claim.mainsnak?.datavalue?.value;
      if (!filename || typeof filename !== 'string') continue;
      results.push({
        src_medium: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}?width=480`,
        src_large: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}?width=1200`,
        photographer: 'Wikimedia Commons',
        source: 'wikimedia',
      });
    }
    return results.slice(0, 5);
  } catch {
    return [];
  }
}

/**
 * 단일 관광지의 사진을 검색하여 attractions.photos 에 저장.
 */
export async function runAttractionPhotoMatch(
  attractionId: string,
  options: {
    /** 검색 키워드 (한국어명, 영어명, aliases...) */
    keywords: string[];
    /** Wikidata QID (Wikimedia Commons 검색용) */
    qid?: string | null;
    /** 최대 사진 수 (기본 5) */
    maxPhotos?: number;
  },
): Promise<AttractionPhoto[]> {
  if (!isSupabaseConfigured) return [];
  const maxPhotos = options.maxPhotos ?? 5;

  // 1) Pexels 검색
  const pexels = await searchPexelsForAttraction(options.keywords, Math.ceil(maxPhotos * 0.7));

  // 2) Wikimedia Commons 검색 (qid 있을 때)
  const wikimedia = options.qid
    ? await searchWikimediaForAttraction(options.qid)
    : [];

  // 3) 병합 + 중복 제거
  const all = [...pexels, ...wikimedia];
  const seen = new Set<string>();
  const merged: AttractionPhoto[] = [];
  for (const p of all) {
    const key = p.pexels_id ? `pexels:${p.pexels_id}` : p.src_medium;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(p);
    if (merged.length >= maxPhotos) break;
  }

  if (merged.length === 0) return [];

  // 4) DB 저장 (기존 photos 가 비어있을 때만)
  const { data: existing } = await supabaseAdmin
    .from('attractions')
    .select('photos')
    .eq('id', attractionId)
    .maybeSingle();

  const existingPhotos = (existing as { photos?: AttractionPhoto[] } | null)?.photos ?? [];
  if (Array.isArray(existingPhotos) && existingPhotos.length === 0) {
    await supabaseAdmin
      .from('attractions')
      .update({
        photos: merged,
        updated_at: new Date().toISOString(),
      })
      .eq('id', attractionId);
    console.log(`[AttractionPhoto] ${attractionId}: ${merged.length}장 자동 적용`);
  } else {
    console.log(`[AttractionPhoto] ${attractionId}: 기존 photos 있음 — skip`);
  }

  return merged;
}

/**
 * photos 가 빈 모든 attraction 대상 배치 사진 검색.
 * cron 에서 호출.
 */
export async function batchAttractionPhotoMatch(
  limit = 50,
): Promise<{ processed: number; totalPhotos: number }> {
  if (!isSupabaseConfigured) return { processed: 0, totalPhotos: 0 };

  const { data: rows, error } = await supabaseAdmin
    .from('attractions')
    .select('id, name, aliases, qid')
    .eq('is_active', true)
    .or('photos.is.null,photos.eq."[]"')
    .limit(limit);

  if (error || !rows) {
    console.warn('[AttractionPhoto] batch fetch 실패:', error?.message);
    return { processed: 0, totalPhotos: 0 };
  }

  let totalPhotos = 0;
  for (const row of rows as Array<{ id: string; name: string; aliases: string[]; qid: string | null }>) {
    const keywords = [row.name, ...(row.aliases ?? [])].filter(Boolean);
    const photos = await runAttractionPhotoMatch(row.id, {
      keywords,
      qid: row.qid,
      maxPhotos: 5,
    });
    totalPhotos += photos.length;
    // rate limit 방어
    await new Promise(r => setTimeout(r, 200));
  }

  return { processed: rows.length, totalPhotos };
}
