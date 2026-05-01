/**
 * ══════════════════════════════════════════════════════════
 * Product Parser — 여행 상품 원문 → 구조화 JSON (Gemini AI)
 * ══════════════════════════════════════════════════════════
 * - travel_packages.raw_content → parsed_data JSONB
 * - 7일 캐시, raw_text_hash 변경 감지
 * - 전체 소재 품질의 70%를 좌우하는 핵심 엔진
 */

import { generateBlogJSON, hasBlogApiKey } from '@/lib/blog-ai-caller';
import { createHash } from 'crypto';

// ── 타입 정의 ──────────────────────────────────────────────

export interface ParsedHighlight {
  name: string;
  hook: string;
  day: number;
  visual_score: number; // 1-10
}

export interface ParsedItinerary {
  day: number;
  regions: string[];
  key_points: string[];
}

export interface ParsedProductData {
  destination: string;
  country: string;
  nights: number;
  days: number;
  departure_date: string | null;
  deadline: string | null;
  seats_left: number | null;
  base_price: number;
  min_people: number | null;
  hotel_stars: number | null;
  hotels: string[];
  no_tip: boolean;
  no_option: boolean;
  special_gifts: string[];
  meals: {
    korean: string[];
    local: string[];
  };
  highlights: ParsedHighlight[];
  itinerary: ParsedItinerary[];
  urgency_level: 'high' | 'mid' | 'low';
  destination_type: string;
  price_range: string;
  // 원본 필드 (파싱 실패 시 fallback용)
  product_id?: string;
}

// ── Gemini 프롬프트 ────────────────────────────────────────

const PARSE_PROMPT = `당신은 여행 상품 데이터 파서입니다.
아래 원문을 분석해 JSON으로만 출력하세요. 다른 텍스트 절대 금지.

=== 원문 ===
{RAW_TEXT}

=== 출력 스키마 ===
{
  "destination": "나트랑/달랏",
  "country": "베트남",
  "nights": 3,
  "days": 5,
  "departure_date": "4/20",
  "deadline": "3/30",
  "seats_left": 2,
  "base_price": 489000,
  "min_people": 6,
  "hotel_stars": 5,
  "hotels": ["호라이즌", "멀펄 달랏"],
  "no_tip": true,
  "no_option": true,
  "special_gifts": ["과일도시락 1팩/룸"],
  "meals": {
    "korean": ["제육쌈밥", "무한대삼겹이", "소부고기전골"],
    "local": ["분짜", "반쎄오", "스프링롤"]
  },
  "highlights": [
    { "name": "달빗산 전망대", "hook": "해발 1900m 직행", "day": 3, "visual_score": 9 },
    { "name": "다뭄블라 폭포", "hook": "레일바이크", "day": 3, "visual_score": 8 }
  ],
  "itinerary": [
    { "day": 2, "regions": ["나트랑","달랏"], "key_points": ["포나가르탑","침향탑사"] }
  ],
  "urgency_level": "high",
  "destination_type": "동남아단거리",
  "price_range": "50만미만"
}

urgency_level 기준:
- "high": seats_left <= 3 또는 deadline이 오늘로부터 7일 이내
- "mid": seats_left 4~10 또는 deadline 8~14일
- "low": 그 외

destination_type 기준:
- 동남아(베트남,태국,필리핀,인도네시아,말레이시아,캄보디아,라오스) + 5박 이하 → "동남아단거리"
- 동남아 + 6박 이상 → "동남아장거리"
- 일본 → "일본"
- 유럽 → "유럽"
- 그 외 → "기타"

price_range:
- base_price < 500000 → "50만미만"
- 500000 <= base_price < 1000000 → "50-100만"
- base_price >= 1000000 → "100만이상"

visual_score: 이미지로 표현했을 때 시각적 임팩트 1~10점
`;

// ── 메인 함수 ──────────────────────────────────────────────

export async function parseProduct(productId: string): Promise<ParsedProductData> {
  const { supabaseAdmin } = await import('@/lib/supabase');

  // 상품 조회
  const { data: pkg, error } = await supabaseAdmin
    .from('travel_packages')
    .select('id, title, destination, price, duration, itinerary, inclusions, excludes, product_highlights, product_summary, special_notes, product_type, airline, departure_airport, parsed_data, parsed_at, raw_text_hash')
    .eq('id', productId)
    .single();

  if (error || !pkg) {
    throw new Error(`상품 조회 실패: ${productId}`);
  }

  // 원문 조합 (파싱 대상)
  const rawText = buildRawText(pkg);
  const currentHash = createHash('sha256').update(rawText).digest('hex').slice(0, 16);

  // 캐시 확인: 7일 이내 + 해시 동일하면 기존 결과 반환
  if (pkg.parsed_data && pkg.parsed_at && pkg.raw_text_hash === currentHash) {
    const age = Date.now() - new Date(pkg.parsed_at).getTime();
    if (age < 7 * 24 * 60 * 60 * 1000) {
      return { ...pkg.parsed_data as ParsedProductData, product_id: productId };
    }
  }

  // Gemini AI 파싱
  let parsed: ParsedProductData;

  if (hasBlogApiKey()) {
    try {
      const prompt = PARSE_PROMPT.replace('{RAW_TEXT}', rawText);
      const text = await generateBlogJSON(prompt, { temperature: 0.2 });
      parsed = JSON.parse(text);
    } catch (err) {
      console.warn('[parseProduct] Gemini 파싱 실패, fallback 사용:', err instanceof Error ? err.message : err);
      parsed = buildFallbackParsed(pkg);
    }
  } else {
    parsed = buildFallbackParsed(pkg);
  }

  parsed.product_id = productId;

  // DB 저장 (캐시)
  await supabaseAdmin
    .from('travel_packages')
    .update({
      parsed_data: parsed,
      parsed_at: new Date().toISOString(),
      raw_text_hash: currentHash,
      country: parsed.country || null,
      nights: parsed.nights || null,
    })
    .eq('id', productId);

  return parsed;
}

// ── 원문 조합 ──────────────────────────────────────────────

function buildRawText(pkg: any): string {
  const parts: string[] = [];

  if (pkg.title) parts.push(`상품명: ${pkg.title}`);
  if (pkg.destination) parts.push(`목적지: ${pkg.destination}`);
  if (pkg.price) parts.push(`가격: ${pkg.price}원`);
  if (pkg.duration) parts.push(`기간: ${pkg.duration}일`);
  if (pkg.airline) parts.push(`항공사: ${pkg.airline}`);
  if (pkg.departure_airport) parts.push(`출발공항: ${pkg.departure_airport}`);
  if (pkg.product_type) parts.push(`상품유형: ${pkg.product_type}`);
  if (pkg.product_summary) parts.push(`요약: ${pkg.product_summary}`);
  if (pkg.special_notes) parts.push(`특이사항: ${pkg.special_notes}`);

  if (Array.isArray(pkg.inclusions) && pkg.inclusions.length > 0) {
    parts.push(`포함사항: ${pkg.inclusions.join(', ')}`);
  }
  if (Array.isArray(pkg.excludes) && pkg.excludes.length > 0) {
    parts.push(`불포함: ${pkg.excludes.join(', ')}`);
  }
  if (Array.isArray(pkg.product_highlights) && pkg.product_highlights.length > 0) {
    parts.push(`하이라이트: ${pkg.product_highlights.join(', ')}`);
  }
  if (Array.isArray(pkg.itinerary) && pkg.itinerary.length > 0) {
    parts.push(`일정: ${pkg.itinerary.join(' / ')}`);
  }

  return parts.join('\n');
}

// ── Fallback (AI 없을 때) ──────────────────────────────────

function buildFallbackParsed(pkg: any): ParsedProductData {
  const dest = pkg.destination || '여행지';
  const price = pkg.price || 0;
  const duration = pkg.duration || 0;
  const nights = duration > 0 ? duration - 1 : 0;
  const summary = [pkg.product_summary, pkg.special_notes, pkg.title].filter(Boolean).join(' ');
  const inclusions: string[] = pkg.inclusions || [];

  return {
    destination: dest,
    country: classifyCountry(dest),
    nights,
    days: duration,
    departure_date: null,
    deadline: null,
    seats_left: null,
    base_price: price,
    min_people: null,
    hotel_stars: /5성|5\*|파이브스타/i.test(summary) ? 5 : null,
    hotels: extractHotels(inclusions, summary),
    no_tip: /노팁|노 팁|no tip/i.test(summary),
    no_option: /노옵션|노 옵션|no option/i.test(summary),
    special_gifts: extractGifts(inclusions, summary),
    meals: {
      korean: inclusions.filter(s => /한식|쌈밥|삼겹|전골|불고기|제육/.test(s)),
      local: inclusions.filter(s => /분짜|반쎄오|쌀국수|팟타이|스시/.test(s)),
    },
    highlights: (pkg.product_highlights || []).map((h: string, i: number) => ({
      name: h.slice(0, 20),
      hook: h,
      day: i + 2,
      visual_score: 7,
    })),
    itinerary: [],
    urgency_level: 'low',
    destination_type: classifyDestinationType(classifyCountry(dest), nights),
    price_range: classifyPrice(price),
  };
}

// ── 유틸 ───────────────────────────────────────────────────

function classifyCountry(destination: string): string {
  const map: Record<string, string[]> = {
    '베트남': ['나트랑', '달랏', '다낭', '호이안', '하노이', '푸꾸옥', '호치민'],
    '태국': ['방콕', '파타야', '치앙마이', '푸켓', '끄라비'],
    '일본': ['오사카', '도쿄', '후쿠오카', '삿포로', '교토', '오키나와'],
    '중국': ['장가계', '청도', '상해', '서안', '연길', '백두산', '하얼빈'],
    '필리핀': ['세부', '보홀', '보라카이', '마닐라'],
    '인도네시아': ['발리', '자카르타'],
    '캄보디아': ['씨엠립', '앙코르왓'],
    '대만': ['타이베이', '가오슝'],
    '괌': ['괌'],
    '사이판': ['사이판'],
  };

  for (const [country, cities] of Object.entries(map)) {
    if (cities.some(c => destination.includes(c))) return country;
  }
  return '기타';
}

export function classifyDestinationType(country: string, nights: number): string {
  const SEA = ['베트남', '태국', '필리핀', '인도네시아', '말레이시아', '캄보디아', '라오스'];
  if (SEA.includes(country)) return nights <= 5 ? '동남아단거리' : '동남아장거리';
  if (country === '일본') return '일본';
  if (['프랑스', '이탈리아', '스페인', '영국', '독일'].includes(country)) return '유럽';
  return '기타';
}

export function classifyPrice(price: number): string {
  if (price < 500000) return '50만미만';
  if (price < 1000000) return '50-100만';
  return '100만이상';
}

export function classifyNights(nights: number): string {
  if (nights <= 3) return '1-3박';
  if (nights <= 5) return '4-5박';
  if (nights <= 7) return '6-7박';
  return '8박이상';
}

function extractHotels(inclusions: string[], summary: string): string[] {
  const hotels: string[] = [];
  const hotelPatterns = /호라이즌|멀펄|쉐라톤|인터컨|힐튼|메리어트|노보텔|풀만|하얏트|롯데|리조트/g;
  const all = [...inclusions, summary].join(' ');
  const matches = all.match(hotelPatterns);
  if (matches) hotels.push(...[...new Set(matches)]);
  return hotels;
}

function extractGifts(inclusions: string[], summary: string): string[] {
  const gifts: string[] = [];
  const all = [...inclusions, summary].join(' ');
  if (/과일도시락|과일 도시락/.test(all)) gifts.push('과일도시락 1팩/룸');
  if (/마사지|맛사지/.test(all)) gifts.push('마사지 체험');
  return gifts;
}
