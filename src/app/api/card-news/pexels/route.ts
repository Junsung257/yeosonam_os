import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { searchPexelsPhotos, isPexelsConfigured } from '@/lib/pexels';

/**
 * Pexels image search proxy.
 * Keeps PEXELS_API_KEY server-side and returns only the fields the UI needs.
 */
export async function GET(request: NextRequest) {
  if (!isPexelsConfigured()) {
    return apiResponse(
      { error: 'Pexels API가 설정되지 않았습니다.', photos: [] },
      { status: 503 },
    );
  }

  const { searchParams } = request.nextUrl;
  const keyword = searchParams.get('keyword') ?? searchParams.get('q');
  const page = parseInt(searchParams.get('page') ?? '1', 10);
  const perPage = Math.min(parseInt(searchParams.get('per_page') ?? '5', 10), 20);

  if (!keyword) {
    return apiResponse({ error: 'keyword는 필수입니다.' }, { status: 400 });
  }

  try {
    const photos = await searchPexelsPhotos(keyword, perPage, page);
    const simplified = photos.map((photo) => ({
      id: photo.id,
      src_medium: photo.src.medium,
      src_large2x: photo.src.large2x,
      photographer: photo.photographer,
      alt: photo.alt,
    }));

    return apiResponse({ photos: simplified, total: photos.length });
  } catch (error) {
    console.error('[card-news/pexels] search failed:', sanitizeDbError(error));
    return apiResponse(
      { error: 'Pexels 이미지 조회에 실패했습니다.', photos: [] },
      { status: 500 },
    );
  }
}
