import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { searchPexelsPhotos, isPexelsConfigured } from '@/lib/pexels';

/**
 * POST /api/attractions/photos — Pexels에서 사진 검색
 * body:
 *   { keyword: string, per_page?: number }  — 기존 경로 (keyword 직접 전달)
 *   { attractionId: string, per_page?: number } — 신규: 관광지 id 주면 영어 alias 우선 사용
 *
 * ERR-pexels-korean-search@2026-04-21: 한글 keyword 는 Pexels 에서 generic 사진만 반환.
 *   영어 alias 가 aliases[] 에 있으면 그것으로 검색해 매칭 품질 향상.
 */
function pickEnglishAlias(aliases: unknown): string | null {
  if (!Array.isArray(aliases)) return null;
  for (const a of aliases) {
    if (typeof a !== 'string' || a.length < 2) continue;
    const ascii = a.replace(/[^\x20-\x7E]/g, '');
    if (ascii.length / a.length > 0.8) return a;
  }
  return null;
}

export async function POST(request: NextRequest) {
  if (!isPexelsConfigured()) {
    return NextResponse.json({ error: 'PEXELS_API_KEY 미설정', photos: [] }, { status: 503 });
  }

  try {
    const body = await request.json();
    const { keyword: keywordRaw, attractionId, per_page = 5 } = body;

    // 검색 키워드 결정: attractionId 우선, 없으면 keyword
    let searchKeyword: string | null = null;
    if (attractionId) {
      const { data } = await supabaseAdmin
        .from('attractions')
        .select('name, aliases, region, country')
        .eq('id', attractionId)
        .limit(1);
      const attr = data?.[0];
      if (!attr) return NextResponse.json({ error: '관광지를 찾을 수 없습니다.' }, { status: 404 });
      const eng = pickEnglishAlias(attr.aliases);
      searchKeyword = eng || `${attr.name} ${attr.region || attr.country || ''} travel`.trim();
    } else if (typeof keywordRaw === 'string') {
      searchKeyword = keywordRaw;
    }
    if (!searchKeyword) return NextResponse.json({ error: 'keyword 또는 attractionId 필수' }, { status: 400 });

    const photos = await searchPexelsPhotos(searchKeyword, Math.min(per_page, 10));

    const simplified = photos.map(p => ({
      pexels_id: p.id,
      src_medium: p.src.medium,
      src_large: p.src.large2x,
      photographer: p.photographer,
      alt: p.alt,
    }));

    return NextResponse.json({ photos: simplified, searchKeyword });
  } catch (error) {
    console.error('[Attractions Photos] Pexels 검색 오류:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Pexels 검색 실패', photos: [] }, { status: 500 });
  }
}

/**
 * PATCH /api/attractions/photos — 선택한 사진을 관광지에 저장
 * body: { id: string, photos: Array<{pexels_id, src_medium, src_large, photographer}> }
 */
export async function PATCH(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });

  try {
    const { id, photos } = await request.json();
    if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 });
    if (!Array.isArray(photos)) return NextResponse.json({ error: 'photos 배열 필요' }, { status: 400 });

    const { error } = await supabaseAdmin
      .from('attractions')
      .update({ photos })
      .eq('id', id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Attractions Photos] 저장 오류:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '저장 실패' }, { status: 500 });
  }
}
