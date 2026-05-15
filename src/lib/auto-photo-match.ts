/**
 * @file auto-photo-match.ts
 * @description 등록 직후 Pexels 자동 매칭 + thumbnail 자동 채움 (Phase 8-2 박제).
 *
 * 박제 사유 (2026-05-13):
 * 사장님이 검수 큐에서 매번 "이미지 불러오기" 버튼 클릭 + 사진 선택해야 함.
 * 등록 직후 destination 키워드로 자동 매칭 → 후보 3개 thumbnail_urls 에 채워
 * 검수 시 1-click 으로 사용 또는 변경 가능.
 *
 * 정책:
 * - 자동 채움 = 임시 후보 (status='ACTIVE' 전까지 자유 변경)
 * - 사장님 승인 시 첫 번째 사진 사용 (또는 사장님 선택)
 * - PEXELS_API_KEY 없으면 skip (fail-soft)
 */

import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { searchPexelsPhotos, isPexelsConfigured, destToEnKeyword } from '@/lib/pexels';
import { searchMultilingualPhotos, getDestinationNative } from '@/lib/parser/multilingual-photo';

export async function runAutoPhotoMatch(args: {
  internalCode: string;
  destination: string | null | undefined;
  title?: string | null;
}): Promise<void> {
  if (!isSupabaseConfigured || !isPexelsConfigured()) return;
  const dest = args.destination?.trim();
  if (!dest) return;

  try {
    // 1) 영문 + 지역어 동시 검색 (2026-05-15 UX-V5 박제)
    //    "Bana Hills Vietnam" + "Bà Nà Hills" 같이 영문/지역어 동시 → 정확도 ↑
    const baseKeyword = destToEnKeyword(dest);
    const keyword = `${baseKeyword} travel landscape`;
    const nativeHint = getDestinationNative(dest);

    // 2) Pexels 검색 — multilingual fallback
    let photos = await searchMultilingualPhotos({
      englishKeyword: keyword,
      destinationKorean: dest,
      count: 5,
    });
    // multilingual 실패하면 fallback to 영문 only
    if (photos.length === 0) {
      photos = await searchPexelsPhotos(keyword, 5);
    }
    if (nativeHint) {
      console.log(`[AutoPhoto] ${args.internalCode}: multilingual ${nativeHint.native} (${nativeHint.locale})`);
    }
    if (photos.length === 0) {
      console.log(`[AutoPhoto] ${args.internalCode}: no photos for "${keyword}"`);
      return;
    }

    // 3) 상위 3개 URL 추출
    const urls = photos.slice(0, 3).map(p => p.src.large);

    // 4) products.thumbnail_urls 자동 채움 (단, 이미 사장님이 박힌 경우 덮어쓰지 않음)
    const { data: existing } = await supabaseAdmin
      .from('products')
      .select('thumbnail_urls')
      .eq('internal_code', args.internalCode)
      .maybeSingle();

    const existingUrls = Array.isArray((existing as { thumbnail_urls?: string[] } | null)?.thumbnail_urls)
      ? ((existing as { thumbnail_urls: string[] }).thumbnail_urls)
      : [];

    // 비어있을 때만 자동 채움
    if (existingUrls.length === 0) {
      await supabaseAdmin
        .from('products')
        .update({ thumbnail_urls: urls, updated_at: new Date().toISOString() })
        .eq('internal_code', args.internalCode);
      console.log(`[AutoPhoto] ${args.internalCode}: ${urls.length} 후보 자동 적용 (keyword="${keyword}")`);
    } else {
      console.log(`[AutoPhoto] ${args.internalCode}: 기존 thumbnail 있음 — 자동 채움 skip`);
    }
  } catch (e) {
    console.warn('[AutoPhoto] 실패(무시):', (e as Error).message);
  }
}
