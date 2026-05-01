import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { searchPexelsPhotos, destToEnKeyword, isPexelsConfigured } from '@/lib/pexels';

async function copyPexelsToStorage(pexelsUrl: string, storagePath: string): Promise<string> {
  const res = await fetch(pexelsUrl);
  if (!res.ok) throw new Error(`Pexels fetch 실패: ${res.status}`);
  const buf = await res.arrayBuffer();

  const { error } = await supabaseAdmin.storage
    .from('destination-photos')
    .upload(storagePath, buf, { contentType: 'image/jpeg', upsert: true });

  if (error) throw new Error(`Storage 업로드 실패: ${error.message}`);

  const { data: { publicUrl } } = supabaseAdmin.storage
    .from('destination-photos')
    .getPublicUrl(storagePath);

  return publicUrl;
}

/** GET /api/destinations/hero-photo?destination=보홀&keyword=bohol philippines
 *  Pexels 검색 결과만 반환 (저장 안 함) */
export async function GET(req: NextRequest) {
  if (!isPexelsConfigured()) return NextResponse.json({ error: 'PEXELS_API_KEY 미설정' }, { status: 503 });

  const { searchParams } = req.nextUrl;
  const destination = searchParams.get('destination');
  if (!destination) return NextResponse.json({ error: 'destination 파라미터 필요' }, { status: 400 });

  const keyword = searchParams.get('keyword') || destToEnKeyword(destination);

  try {
    const photos = await searchPexelsPhotos(keyword, 8);
    return NextResponse.json({
      photos: photos.map(p => ({
        id: p.id,
        photographer: p.photographer,
        src_large: p.src.large2x,
        src_medium: p.src.large,
        src_thumb: p.src.medium,
        alt: p.alt,
      })),
      keyword,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Pexels 검색 실패' },
      { status: 500 }
    );
  }
}

/** POST /api/destinations/hero-photo
 *  body: { destination, pexels_id, src_large, photographer }
 *  → Pexels 이미지를 Supabase Storage에 복사 저장
 *  → destination_metadata upsert (photo_approved=false) */
export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB not configured' }, { status: 503 });

  let body: { destination?: string; pexels_id?: number; src_large?: string; photographer?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '유효하지 않은 JSON' }, { status: 400 });
  }

  const { destination, pexels_id, src_large, photographer } = body;
  if (!destination || !src_large || !pexels_id || !photographer) {
    return NextResponse.json({ error: 'destination, pexels_id, src_large, photographer 필수' }, { status: 400 });
  }

  const storagePath = `${encodeURIComponent(destination)}/hero.jpg`;

  try {
    const publicUrl = await copyPexelsToStorage(src_large, storagePath);

    const { data, error } = await supabaseAdmin
      .from('destination_metadata')
      .upsert(
        {
          destination,
          hero_image_url: publicUrl,
          hero_image_pexels_id: pexels_id,
          hero_photographer: photographer,
          photo_approved: false,
        },
        { onConflict: 'destination' }
      )
      .select()
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
      data,
      public_url: publicUrl,
      message: '저장 완료. 어드민에서 승인 후 고객 페이지에 노출됩니다.',
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '저장 실패' },
      { status: 500 }
    );
  }
}
