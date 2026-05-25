/**
 * AI Image Generation Pipeline
 *
 * 블로그 각 H2 섹션에 어울리는 이미지를 AI(Gemini Imagen)로 생성하거나
 * Pexels에서 검색하여 자동 삽입.
 *
 * 실패 체인: Gemini Imagen → Pexels 검색 → null
 *
 * Rate limit 보호: 한 번 호출당 최소 1초 간격
 */

import { getSecret } from '@/lib/secret-registry';
import { searchPexelsPhotos } from '@/lib/pexels';

let lastCallTs = 0;

/**
 * rate limit 방어: 최소 1초 간격
 */
async function rateLimitGuard(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastCallTs;
  if (elapsed < 1000) {
    await new Promise((r) => setTimeout(r, 1000 - elapsed));
  }
  lastCallTs = Date.now();
}

/**
 * 섹션 제목에서 이미지 검색에 적합한 키워드 추출
 * 한국어 → 영어 변환
 */
const KOREAN_TRAVEL_KEYWORDS: Record<string, string> = {
  '일정': 'itinerary schedule travel',
  '여행': 'travel vacation trip',
  '관광': 'sightseeing tour landmark',
  '맛집': 'food restaurant delicious',
  '숙소': 'hotel accommodation resort',
  '호텔': 'hotel resort luxury',
  '리조트': 'resort beach vacation',
  '교통': 'transportation travel bus',
  '비행기': 'airplane flight sky',
  '항공': 'airplane flight sky',
  '공항': 'airport terminal travel',
  '가격': 'money price shopping',
  '비용': 'money budget travel',
  '예산': 'budget money finance',
  '날씨': 'weather climate season',
  '계절': 'season weather nature',
  '준비물': 'travel essentials packing',
  '쇼핑': 'shopping mall market',
  '휴식': 'relaxation rest calm',
  '자연': 'nature landscape mountain',
  '바다': 'ocean sea beach',
  '산': 'mountain nature hiking',
  '도시': 'city urban skyline',
  '문화': 'culture tradition history',
  '체험': 'experience activity adventure',
  '추천': 'recommended best top',
  '팁': 'tips advice guide',
  '필수': 'essential must checklist',
  '꿀팁': 'useful tips hacks',
  '가이드': 'guide travel destination',
  '코스': 'course route itinerary',
  '명소': 'attraction landmark sightseeing',
  '액티비티': 'activity adventure fun',
  '사진': 'photo photography instagrammable',
  '예약': 'booking reservation ticket',
  '티켓': 'ticket reservation entrance',
  '야경': 'night view夜景 cityscape',
  '일출': 'sunrise morning nature',
  '일몰': 'sunset evening beach',
  '트레킹': 'trekking hiking mountain',
  '등산': 'mountain climbing hiking',
  '워터파크': 'water park waterpark',
  '테마파크': 'theme park amusement',
  '박물관': 'museum art history',
  '시장': 'market shopping local',
  '공원': 'park nature garden',
};

/**
 * 섹션 제목(한국어)을 분석해 이미지 검색용 영어 키워드 생성
 */
function buildSearchQuery(sectionTitle: string, destination: string, keyword: string): string {
  const destEn = destination.replace(/[^a-zA-Z0-9\s]/g, '').trim();
  const sectionLower = sectionTitle.toLowerCase();

  // 한글 키워드 매칭
  for (const [kr, en] of Object.entries(KOREAN_TRAVEL_KEYWORDS)) {
    if (sectionLower.includes(kr)) {
      return destEn ? `${destEn} ${en}` : en;
    }
  }

  // sectionTitle에서 한글/영문 추출 후 영어 매칭
  if (keyword) {
    const kwEn = keyword.replace(/[^a-zA-Z0-9\s]/g, '').trim();
    if (kwEn) {
      return destEn ? `${destEn} ${kwEn} travel` : `${kwEn} travel`;
    }
  }

  return destEn ? `${destEn} travel destination landscape` : 'travel destination landscape';
}

/**
 * Gemini Imagen API를 통해 이미지 생성 시도
 * 환경변수: GEMINI_API_KEY
 * 엔드포인트: https://generativelanguage.googleapis.com/v1beta/models/imagen-x:generateImages
 */
async function tryGeminiImagen(prompt: string): Promise<string | null> {
  const apiKey = getSecret('GEMINI_API_KEY') || getSecret('GOOGLE_GEMINI_API_KEY');
  if (!apiKey) return null;

  try {
    await rateLimitGuard();

    const imagenPrompt = `Blog article image for travel destination. ${prompt}. Professional photography, high resolution, no text overlay, no watermark, 16:9 aspect ratio.`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:generateImages?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: imagenPrompt,
          sampleCount: 1,
          aspectRatio: '16:9',
        }),
        signal: AbortSignal.timeout(15000),
      },
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn(`[blog-image-gen] Gemini Imagen 실패 (${res.status}): ${errText.substring(0, 200)}`);
      return null;
    }

    const data = await res.json();
    const imageUrl = data?.predictions?.[0]?.bytesBase64Encoded;

    if (!imageUrl) {
      console.warn('[blog-image-gen] Gemini Imagen 응답에 이미지 없음');
      return null;
    }

    // Base64 → data URL 반환 (Supabase Storage 업로드 대신 임시 data URL)
    return `data:image/png;base64,${imageUrl}`;
  } catch (err) {
    console.warn(
      '[blog-image-gen] Gemini Imagen 예외:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Pexels 검색으로 이미지 URL 획득 (fallback)
 */
async function tryPexelsSearch(query: string): Promise<string | null> {
  try {
    await rateLimitGuard();
    const photos = await searchPexelsPhotos(query, 1, 1);
    if (photos.length > 0) {
      return photos[0].src.landscape || photos[0].src.large || photos[0].src.original;
    }
    return null;
  } catch (err) {
    console.warn(
      '[blog-image-gen] Pexels 검색 실패:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * 섹션 제목에 맞는 이미지 URL을 생성한다.
 *
 * @param sectionTitle - H2 섹션 제목 (한국어)
 * @param keyword      - 블로그 메인 키워드
 * @param destination  - 여행 목적지
 * @returns 이미지 URL 또는 null
 *
 * 실패 체인:
 *   1. Gemini Imagen 이미지 생성 (GEMINI_API_KEY 필요)
 *   2. Pexels 검색 (PEXELS_API_KEY 필요)
 *   3. null 반환
 */
export async function generateSectionImage(
  sectionTitle: string,
  keyword: string,
  destination?: string,
): Promise<string | null> {
  const dest = destination || keyword || '';

  // AI 이미지 생성 비활성화 여부 확인
  const aiEnabled = getSecret('AI_IMAGE_GEN_ENABLED');
  if (aiEnabled === 'false') return null;

  const searchQuery = buildSearchQuery(sectionTitle, dest, keyword);

  // 1) Gemini Imagen 시도
  const imagenUrl = await tryGeminiImagen(`${dest} ${keyword} ${sectionTitle}`);
  if (imagenUrl) return imagenUrl;

  // 2) Pexels fallback
  const pexelsUrl = await tryPexelsSearch(searchQuery);
  if (pexelsUrl) return pexelsUrl;

  return null;
}

/**
 * AI 이미지 생성 기능이 설정되었는지 확인
 */
export function isAiImageGenConfigured(): boolean {
  return !!(getSecret('GEMINI_API_KEY') || getSecret('GOOGLE_GEMINI_API_KEY') || getSecret('PEXELS_API_KEY'));
}
