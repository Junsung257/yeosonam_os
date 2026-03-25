import { NextRequest, NextResponse } from 'next/server';
import { searchPexelsPhotos, isPexelsConfigured } from '@/lib/pexels';

/**
 * Pexels 이미지 검색 서버사이드 프록시
 * - PEXELS_API_KEY를 클라이언트에 노출하지 않기 위한 프록시
 * - 인증 필요 (middleware JWT 체크)
 */
export async function GET(request: NextRequest) {
  if (!isPexelsConfigured()) {
    return NextResponse.json(
      { error: 'PEXELS_API_KEY 환경변수가 설정되지 않았습니다.', photos: [] },
      { status: 503 }
    );
  }

  const { searchParams } = request.nextUrl;
  const keyword = searchParams.get('keyword');
  const page = parseInt(searchParams.get('page') ?? '1');
  const perPage = Math.min(parseInt(searchParams.get('per_page') ?? '5'), 20);

  if (!keyword) {
    return NextResponse.json({ error: 'keyword 필수' }, { status: 400 });
  }

  try {
    const photos = await searchPexelsPhotos(keyword, perPage, page);

    // 클라이언트에 필요한 필드만 반환 (용량 최소화)
    const simplified = photos.map(p => ({
      id: p.id,
      src_medium: p.src.medium,
      src_large2x: p.src.large2x,
      photographer: p.photographer,
      alt: p.alt,
    }));

    return NextResponse.json({ photos: simplified, total: photos.length });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Pexels 조회 실패';
    console.error('Pexels API 오류:', error);
    return NextResponse.json({ error: msg, photos: [] }, { status: 500 });
  }
}
