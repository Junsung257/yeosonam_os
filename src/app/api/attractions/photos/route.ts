import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { searchPexelsPhotos, isPexelsConfigured } from '@/lib/pexels';
import { validateRequest, UuidSchema } from '@/lib/api-validation';

const PhotoSearchSchema = z.object({
  keyword: z.string().min(1).max(200),
  per_page: z.number().int().min(1).max(10).default(5),
});

const PhotoItemSchema = z.object({
  pexels_id: z.union([z.string(), z.number()]),
  src_medium: z.string().url().max(500),
  src_large: z.string().url().max(500),
  photographer: z.string().max(200).optional(),
  alt: z.string().max(500).optional(),
});

const PhotoSaveSchema = z.object({
  id: UuidSchema,
  photos: z.array(PhotoItemSchema).max(20),
});

/**
 * POST /api/attractions/photos — Pexels에서 사진 검색
 */
export async function POST(request: NextRequest) {
  if (!isPexelsConfigured()) {
    return NextResponse.json({ error: 'PEXELS_API_KEY 미설정', photos: [] }, { status: 503 });
  }

  const validation = await validateRequest(request, PhotoSearchSchema);
  if (!validation.success) return validation.response;
  const { keyword, per_page } = validation.data;

  try {
    const photos = await searchPexelsPhotos(keyword, per_page ?? 5);

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

  const validation = await validateRequest(request, PhotoSaveSchema);
  if (!validation.success) return validation.response;
  const { id, photos } = validation.data;

  try {
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
