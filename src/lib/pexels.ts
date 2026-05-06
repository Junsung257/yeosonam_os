/**
 * Pexels API 클라이언트
 * - 서버사이드 전용 (PEXELS_API_KEY 노출 방지)
 * - /api/card-news/pexels 라우트를 통해 클라이언트에 제공
 * - 무료 플랜: 200 req/hour, 20,000 req/month
 */

import { getSecret } from '@/lib/secret-registry';
const PEXELS_API_BASE = 'https://api.pexels.com/v1';

export interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  url: string;         // Pexels 상세 페이지 URL
  photographer: string;
  photographer_url: string;
  alt: string;
  src: {
    original: string;
    large2x: string;   // ~1880px
    large: string;     // ~940px
    medium: string;    // ~350px
    small: string;     // ~130px
    portrait: string;  // 800×1200
    landscape: string; // 1200×627
    tiny: string;      // 280×200
  };
}

interface PexelsSearchResponse {
  photos: PexelsPhoto[];
  total_results: number;
  next_page?: string;
  page: number;
  per_page: number;
}

function getPexelsHeaders() {
  const apiKey = getSecret('PEXELS_API_KEY');
  if (!apiKey) {
    throw new Error('PEXELS_API_KEY 환경변수가 설정되지 않았습니다.');
  }
  return { Authorization: apiKey };
}

/**
 * 키워드로 이미지 검색
 * @param keyword 검색 키워드 (한글 가능 — Pexels가 번역 처리)
 * @param perPage 결과 수 (기본 5, 최대 80)
 * @param page 페이지 번호 (기본 1)
 */
export async function searchPexelsPhotos(
  keyword: string,
  perPage = 5,
  page = 1
): Promise<PexelsPhoto[]> {
  const params = new URLSearchParams({
    query: keyword,
    per_page: String(Math.min(perPage, 80)),
    page: String(page),
    orientation: 'landscape', // 카드뉴스 배경용 가로 사진
  });

  const res = await fetch(`${PEXELS_API_BASE}/search?${params}`, {
    headers: getPexelsHeaders(),
    next: { revalidate: 3600 }, // 1시간 캐시 (Next.js fetch 캐시)
  });

  if (!res.ok) {
    if (res.status === 401) throw new Error('Pexels API 키가 유효하지 않습니다.');
    if (res.status === 429) throw new Error('Pexels API 요청 한도 초과 (200 req/hour)');
    throw new Error(`Pexels API 오류: ${res.status}`);
  }

  const data: PexelsSearchResponse = await res.json();
  return data.photos;
}

/**
 * 키워드로 랜덤 이미지 1개 반환
 * 페이지를 랜덤으로 선택하여 다양성 확보
 */
export async function getRandomPexelsPhoto(keyword: string): Promise<PexelsPhoto | null> {
  // 1~5 페이지 중 랜덤 선택
  const randomPage = Math.ceil(Math.random() * 5);
  const photos = await searchPexelsPhotos(keyword, 10, randomPage);
  if (photos.length === 0) return null;
  // 결과 중 랜덤 선택
  return photos[Math.floor(Math.random() * photos.length)];
}

/**
 * 슬라이드 주제에 맞는 Pexels 검색 키워드 생성
 * destination + 주제 조합으로 더 관련성 높은 이미지 검색
 */
export function buildPexelsKeyword(destination: string, slideType: string): string {
  const typeMap: Record<string, string> = {
    cover: `${destination} travel landscape`,
    itinerary: `${destination} sightseeing tour`,
    inclusions: `${destination} hotel luxury travel`,
    excludes: `${destination} travel activity`,
    cta: `${destination} vacation beach sunset`,
  };
  return typeMap[slideType] ?? `${destination} travel`;
}

export function isPexelsConfigured(): boolean {
  return !!getSecret('PEXELS_API_KEY');
}

/**
 * 한글 도시/지역명 → Pexels 영어 검색 키워드 변환
 * 멀티시티("나트랑/호치민") 지원 — 첫 매칭 토큰 기준
 */
const KOREAN_TO_EN_DEST: Record<string, string> = {
  '나트랑': 'Nha Trang Vietnam beach',
  '다낭': 'Da Nang Vietnam coast',
  '호치민': 'Ho Chi Minh City Vietnam',
  '하노이': 'Hanoi Vietnam',
  '푸꾸옥': 'Phu Quoc Vietnam island',
  '달랏': 'Da Lat Vietnam mountains',
  '하롱베이': 'Ha Long Bay Vietnam',
  '사파': 'Sapa Vietnam rice terraces',
  '오사카': 'Osaka Japan city',
  '도쿄': 'Tokyo Japan skyline',
  '교토': 'Kyoto Japan temple',
  '후쿠오카': 'Fukuoka Japan',
  '큐슈': 'Kyushu Japan nature',
  '북해도': 'Hokkaido Japan snow',
  '삿포로': 'Sapporo Japan winter',
  '오키나와': 'Okinawa Japan beach',
  '시즈오카': 'Shizuoka Japan Mount Fuji',
  '장가계': 'Zhangjiajie China mountains',
  '서안': 'Xian China ancient city',
  '상해': 'Shanghai China skyline',
  '북경': 'Beijing China',
  '청도': 'Qingdao China coast',
  '칭다오': 'Qingdao China coast',
  '연길': 'Yanbian China',
  '구채구': 'Jiuzhaigou China',
  '방콕': 'Bangkok Thailand temple',
  '치앙마이': 'Chiang Mai Thailand',
  '푸켓': 'Phuket Thailand beach',
  '파타야': 'Pattaya Thailand',
  '발리': 'Bali Indonesia rice terrace',
  '코타키나발루': 'Kota Kinabalu Malaysia',
  '쿠알라룸푸르': 'Kuala Lumpur Malaysia',
  '싱가포르': 'Singapore skyline marina bay',
  '세부': 'Cebu Philippines beach',
  '보홀': 'Bohol Philippines ocean',
  '마닐라': 'Manila Philippines',
  '마카오': 'Macau cityscape night',
  '홍콩': 'Hong Kong skyline victoria harbour',
  '타이베이': 'Taipei Taiwan night market',
  '울란바토르': 'Mongolia steppe grassland',
  '테를지': 'Terelj Mongolia landscape',
  '제주': 'Jeju Island Korea coastal',
  '부산': 'Busan Korea seaside',
  '경주': 'Gyeongju Korea heritage',
  '파리': 'Paris France Eiffel Tower',
  '로마': 'Rome Italy Colosseum',
  '이스탄불': 'Istanbul Turkey',
  '프라하': 'Prague Czech Republic',
};

export function destToEnKeyword(dest: string): string {
  const tokens = dest.split(/[\/,·\s]+/).map(s => s.trim()).filter(Boolean);
  for (const token of tokens) {
    for (const [kr, en] of Object.entries(KOREAN_TO_EN_DEST)) {
      if (token.includes(kr) || kr.includes(token)) return en;
    }
  }
  return `${dest} travel destination landscape`;
}

export { getBrandPlaceholder, BRAND_PLACEHOLDERS } from '@/lib/card-news/placeholders';
