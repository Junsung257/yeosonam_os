import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { searchPexelsPhotos, isPexelsConfigured } from '@/lib/pexels';

/**
 * POST /api/attractions/photos — Pexels에서 사진 검색
 * body: { keyword: string, per_page?: number }
 * 반환: 선택 가능한 사진 목록
 */
export async function POST(request: NextRequest) {
  if (!isPexelsConfigured()) {
    return NextResponse.json({ error: 'PEXELS_API_KEY 미설정', photos: [] }, { status: 503 });
  }

  try {
    const { keyword, per_page = 5 } = await request.json();
    if (!keyword) return NextResponse.json({ error: 'keyword 필수' }, { status: 400 });

    const photos = await searchPexelsPhotos(keyword, Math.min(per_page, 10));

    const simplified = photos.map(p => ({
      pexels_id: p.id,
      src_medium: p.src.medium,
      src_large: p.src.large2x,
      photographer: p.photographer,
      alt: p.alt,
    }));

    return NextResponse.json({ photos: simplified });
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
