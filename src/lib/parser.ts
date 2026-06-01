import { GoogleGenerativeAI, SchemaType, type ResponseSchema } from '@google/generative-ai';
import type { TravelItinerary } from '@/types/itinerary';
import type { CorrectionRecord } from '@/lib/reflection-memory';
import { expandPriceTiersDateRanges, filterTiersByDepartureDays } from './expand-date-range';
import { formatDepartureDays } from './admin-utils';
import { classifyUploadDocumentComplexity } from './parser/document-router';
import {
  extractBalancedJsonArraySubstring,
  extractBalancedJsonObjectSubstring,
  splitCatalogByItineraryHeaders,
  splitCatalogSmart,
  extractProductRawTextSection,
} from './parser/catalog-pre-split';
import { judgeCatalogProductCountConsistency } from './parser/upload-consistency-judge';
import { getSecret } from '@/lib/secret-registry';
import { extractItineraryData } from '@/lib/parser/extract-itinerary';
import { lookupSemanticCache, storeSemanticCache } from '@/lib/semantic-cache';
import { buildFewShotPromptFragment, retrieveSimilarExamples, type SimilarExample } from '@/lib/few-shot-retriever';
import { buildProfilePromptFragment, type LandOperatorProfile } from '@/lib/land-operator-profile';

// ── Phase 2 Gemini 재시도용 Itinerary 스키마 (P1-3 2026-05-24: 함수 외부 상수화) ──
const itinSchema: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    meta: { type: SchemaType.OBJECT, properties: {
      title: { type: SchemaType.STRING },
      product_type: { type: SchemaType.STRING, nullable: true },
      destination: { type: SchemaType.STRING },
      nights: { type: SchemaType.INTEGER },
      days: { type: SchemaType.INTEGER },
      departure_airport: { type: SchemaType.STRING, nullable: true },
      airline: { type: SchemaType.STRING, nullable: true },
      flight_out: { type: SchemaType.STRING, nullable: true },
      flight_in: { type: SchemaType.STRING, nullable: true },
      departure_days: { type: SchemaType.STRING, nullable: true },
      min_participants: { type: SchemaType.INTEGER },
      room_type: { type: SchemaType.STRING, nullable: true },
      ticketing_deadline: { type: SchemaType.STRING, nullable: true },
      hashtags: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
      brand: { type: SchemaType.STRING },
    }},
    highlights: { type: SchemaType.OBJECT, properties: {
      inclusions: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
      excludes: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
      shopping: { type: SchemaType.STRING, nullable: true },
      remarks: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    }},
    days: { type: SchemaType.ARRAY, items: { type: SchemaType.OBJECT, properties: {
      day: { type: SchemaType.INTEGER },
      regions: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
      meals: { type: SchemaType.OBJECT, properties: {
        breakfast: { type: SchemaType.BOOLEAN },
        lunch: { type: SchemaType.BOOLEAN },
        dinner: { type: SchemaType.BOOLEAN },
        breakfast_note: { type: SchemaType.STRING, nullable: true },
        lunch_note: { type: SchemaType.STRING, nullable: true },
        dinner_note: { type: SchemaType.STRING, nullable: true },
      }},
      schedule: { type: SchemaType.ARRAY, items: { type: SchemaType.OBJECT, properties: {
        time: { type: SchemaType.STRING, nullable: true },
        activity: { type: SchemaType.STRING },
        transport: { type: SchemaType.STRING, nullable: true },
        note: { type: SchemaType.STRING, nullable: true },
        type: { type: SchemaType.STRING },
      }}},
      hotel: { type: SchemaType.OBJECT, properties: {
        name: { type: SchemaType.STRING },
        grade: { type: SchemaType.STRING, nullable: true },
        note: { type: SchemaType.STRING, nullable: true },
      }, nullable: true },
    }}},
    optional_tours: { type: SchemaType.ARRAY, items: { type: SchemaType.OBJECT, properties: {
      name: { type: SchemaType.STRING },
      price_usd: { type: SchemaType.NUMBER, nullable: true },
      price_krw: { type: SchemaType.NUMBER, nullable: true },
      note: { type: SchemaType.STRING, nullable: true },
    }}},
  },
};

export interface ParseOptions {
  reflections?: CorrectionRecord[];
  regionContext?: string;
  /**
   * EPR (Efficient Prompt Retrieval, NAACL 2022) few-shot 예시.
   * 호출자가 rawText 로 retrieveSimilarExamples() 미리 호출해서 주입.
   * 박제 사유 (2026-05-13): 같은 랜드사·지역 등록 누적 시 demo 풀이 풍부해져
   * 다음 추출이 compound 로 똑똑해짐 (sleep-time compute).
   */
  fewShotExamples?: SimilarExample[];
  /** Phase 5-2/6-2 박제 — 랜드사별 추출 프로파일 (마커, B2B 용어, 힌트). */
  landOperatorProfile?: LandOperatorProfile | null;
}

// ── optional_tours.region 자동 추론 (등록 시점 방어) ──────────────────────
// 이름에 "싱가포르", "쿠알라" 등 지역 키워드가 있으면 region 필드 자동 주입.
// 이유: AI가 region 누락해도 렌더러가 일관된 라벨 생성 가능.
const OT_REGION_KEYWORDS: Record<string, string> = {
  '말레이시아': '말레이시아', '쿠알라': '말레이시아', '말라카': '말레이시아', '겐팅': '말레이시아',
  '싱가포르': '싱가포르',
  '태국': '태국', '방콕': '태국', '파타야': '태국', '푸켓': '태국',
  '베트남': '베트남', '다낭': '베트남', '하노이': '베트남', '나트랑': '베트남',
  '대만': '대만', '타이페이': '대만', '타이베이': '대만',
  '일본': '일본', '후쿠오카': '일본', '오사카': '일본', '홋카이도': '일본',
  '중국': '중국', '서안': '중국', '북경': '중국', '상해': '중국', '장가계': '중국', '칭다오': '중국',
  '라오스': '라오스', '몽골': '몽골', '필리핀': '필리핀', '보홀': '필리핀', '세부': '필리핀',
  '인도네시아': '인도네시아', '발리': '인도네시아',
};

function inferOptionalTourRegion(name: string): string | null {
  if (!name) return null;
  const parenMatch = name.match(/\(([^)]+)\)/);
  if (parenMatch) {
    for (const [kw, region] of Object.entries(OT_REGION_KEYWORDS)) {
      if (parenMatch[1].includes(kw)) return region;
    }
  }
  for (const [kw, region] of Object.entries(OT_REGION_KEYWORDS)) {
    if (name.includes(kw)) return region;
  }
  return null;
}

function enrichOptionalToursRegion(tours: unknown): OptionalTour[] {
  if (!Array.isArray(tours)) return [];
  return tours.filter(Boolean).map((t) => {
    const tour = t as OptionalTour;
    if (!tour.name) return tour;
    if (!tour.region) {
      const inferred = inferOptionalTourRegion(tour.name);
      if (inferred) return { ...tour, region: inferred };
    }
    return tour;
  });
}

// ─── 항공사 코드 정규화 ────────────────────────────────────
const AIRLINE_NAME_TO_CODE: Record<string, string> = {
  '에어부산': 'BX', '진에어': 'LJ', '제주항공': '7C', '티웨이': 'TW', '티웨이항공': 'TW',
  '비엣젯': 'VJ', '비엣젯항공': 'VJ', '비엣젯 항공': 'VJ', '이스타': 'ZE', '이스타항공': 'ZE',
  '에어로K': 'RF', '대한항공': 'KE', '아시아나': 'OZ', '중국남방항공': 'CZ', '중국동방항공': 'MU',
  '산동항공': 'SC', '중국국제항공': 'CA', '라오항공': 'QV', '에어아시아': 'D7',
  '세부퍼시픽': '5J', '베트남항공': 'VN',
};
export function normalizeAirlineCode(raw?: string): string | undefined {
  if (!raw || raw.trim() === '') return undefined;
  const s = raw.trim();
  if (/^[A-Z0-9]{2}$/.test(s)) return s;
  const flightMatch = s.match(/^([A-Z]{2}|\d[A-Z])\d{2,4}/);
  if (flightMatch) return flightMatch[1];
  const parenCode = s.match(/\(([A-Z]{2}|\d[A-Z])\d{0,4}\)/);
  if (parenCode) return parenCode[1].replace(/\d+/, '');
  for (const [name, code] of Object.entries(AIRLINE_NAME_TO_CODE)) {
    if (s.includes(name)) return code;
  }
  const codeInText = s.match(/([A-Z]{2}|\d[A-Z])(?:\d{2,4})?/);
  if (codeInText) return codeInText[1];
  if (s.includes(',')) return normalizeAirlineCode(s.split(',')[0].trim());
  return s;
}

// ─── 타입 정의 ─────────────────────────────────────────────

export interface PriceTier {
  period_label: string;
  departure_dates?: string[];           // 특정 날짜 배열 (YYYY-MM-DD)
  date_range?: { start: string; end: string }; // 기간 범위
  departure_day_of_week?: string;       // 화 | 금 | 수 | 토
  excluded_dates?: string[];            // 해당 tier에서 제외할 날짜
  adult_price?: number;
  child_price?: number;
  infant_price?: number;
  status: 'available' | 'confirmed' | 'soldout';
  note?: string;
}

export interface PriceRule {
  condition:  string;        // "수요일" | "제외일 3/28(토)" | "전 출발일"
  price_text: string;        // "799,000원" | "별도문의"
  price:      number | null; // 799000 or null if 별도문의
  badge?:     string | null; // "특가♥" | "일반" | "호텔UP" | "별도문의" | "확정" | "마감" | null
}

export interface PriceListItem {
  period: string;           // "3/20~3/28" — 원문 그대로
  rules:  PriceRule[];
  notes?: string | null;    // "성인/아동 요금 동일, 싱글차지 8만원/인" 등 부가 조건
}

export interface Surcharge {
  period: string;
  amount_usd?: number;
  amount_krw?: number;
  note: string;
}

export interface OptionalTour {
  name: string;
  /** 지역 컨텍스트 — "말레이시아" | "싱가포르" 등. 원문의 "[X 선택관광]" 섹션 헤더에서 자동 주입. */
  region?: string | null;
  price?: string;          // ERR-20260418-04: 문자열 폼 ("$50/인") 지원
  price_usd?: number;
  price_krw?: number;
  note?: string | null;
}

export interface CancellationPolicy {
  period: string;
  rate: number;
  note?: string;
}

export interface NoticeItem {
  type: 'CRITICAL' | 'PAYMENT' | 'POLICY' | 'INFO';
  title: string;
  text: string;
}

export interface ExtractedData {
  // 기본 정보
  title?: string;
  category?: 'package' | 'golf' | 'honeymoon' | 'cruise' | 'theme';
  product_type?: string;           // 실속 | 품격 | 노팁노옵션 | 일반
  trip_style?: string;             // 3박5일 | 4박6일
  destination?: string;
  duration?: number;
  departure_days?: string;         // 매주 화요일 | 매주 금요일
  departure_airport?: string;
  airline?: string;
  min_participants?: number;
  ticketing_deadline?: string;     // YYYY-MM-DD

  // 가격 구조
  price?: number;                  // 최저가 (하위 호환)
  price_tiers?: PriceTier[];       // 날짜별 상세 가격 (단일 조건)
  price_list?: PriceListItem[];    // 다중 조건 구조화 가격표 (price_tiers 보완)

  // 요금 관련
  // @deprecated — 하위호환용. 신규 경로는 normalized_surcharges 사용
  guide_tip?: string;
  // @deprecated
  single_supplement?: string;
  // @deprecated
  small_group_surcharge?: string;
  surcharges?: Surcharge[];
  /** 정규화된 추가요금 (kind별 분류, string/number 통일) — Phase 2 신규 */
  normalized_surcharges?: import('@/types/pricing').Surcharge[];
  excluded_dates?: string[];

  // 포함/불포함
  inclusions?: string[];
  excludes?: string[];
  optional_tours?: OptionalTour[];

  // 일정/숙박
  itinerary?: string[];
  accommodations?: string[];
  specialNotes?: string;
  notices_parsed?: (string | NoticeItem)[];

  // 취소 규정
  cancellation_policy?: CancellationPolicy[];

  // 카테고리별 고유 속성
  category_attrs?: Record<string, unknown>;

  // 랜드사 & 자동 분류
  land_operator?: string;        // 랜드사/현지여행사명
  product_tags?: string[];       // AI 자동 추출: ['소규모', '노팁', '노옵션']
  product_highlights?: string[]; // 핵심 특전 3개 이내
  product_summary?: string;      // AI 자동 생성 2~3줄 요약 (Jarvis 추론용)

  // Phase 2 AI 확장 필드 (products_ai_expansion_v1.sql)
  theme_tags?: string[];         // 마케팅 테마 태그 배열 (예: ['노옵션', '가족여행', '허니문'])
  selling_points?: {             // 핵심 세일즈 포인트
    hotel?: string | null;
    airline?: string | null;
    unique?: string[];
    [key: string]: unknown;
  } | null;
  flight_info?: {                // 항공 편명/시간 정보
    airline?: string | null;
    flight_no?: string | null;
    depart?: string | null;      // HH:MM
    arrive?: string | null;      // HH:MM
    return_depart?: string | null;
    return_arrive?: string | null;
    [key: string]: unknown;
  } | null;

  rawText: string;

  // P11-4 박제 (2026-05-13): LLM 호출 메타 추적 (ai_quality_log 적재용, transient)
  _llm_meta?: {
    advisor_used?: boolean;        // confidence-gated escalation 발동 여부
    provider?: string;             // 'deepseek' | 'gemini' | 'claude'
    fallback_used?: boolean;       // 1차 실패 → fallback 발동
    cache_hit?: boolean;
    retry_count?: number;
    tokens_input?: number;
    tokens_output?: number;
    cost_usd?: number;
    section_cache_hit_count?: number;
    section_cache_reduced_chars?: number;
    section_cache_reduce_ready?: boolean;
    section_cache_replaced_labels?: string[];
  };
}

export interface ParsedDocument {
  filename: string;
  fileType: 'pdf' | 'image' | 'hwp' | 'hwpx';
  rawText: string;
  extractedData: ExtractedData;
  itineraryData?: TravelItinerary | null;  // 고객용 일정표 JSON
  parsedAt: Date;
  confidence: number;
  // 복수 상품 추출 결과 (PDF에 여러 상품이 있을 때)
  multiProducts?: MultiProductResult[];
  // AI 토큰 사용량 (provider별 비용 추적)
  _tokenUsage?: {
    provider: 'deepseek' | 'gemini';  // Phase 1 provider
    input: number;
    output: number;
    cache_hit: number;
    elapsed_ms?: number;
    phase2Provider?: 'deepseek' | 'gemini';  // Phase 2 일정표 추출 provider (text=deepseek, image=gemini)
    phase2Input?: number;
    phase2Output?: number;
    phase2CacheHit?: number;
  };
}

// ─── Gemini API 호출 ────────────────────────────────────────

/** 입력 텍스트 길이 기반 Gemini output 토큰 동적 추정. 한국어 ~1.5자/토큰, JSON 오버헤드 0.7배, 안전 버퍼 1.2배 */
function estimateRequiredOutputTokens(inputText: string): number {
  const est = Math.ceil((inputText.length / 1.5) * 0.7 * 1.2);
  return Math.min(65536, Math.max(16384, est));
}

// ── P1-4 (2026-05-24): 중요도 기반 텍스트 자르기 (가격 밀집도 우선) ──
// 앞 maxLen*0.85 자 + 뒤쪽 가격 키워드 밀집 구간 maxLen*0.15 자 를 결합.
function smartTruncateWithPricePriority(raw: string, maxLen: number): string {
  if (raw.length <= maxLen) return raw;
  const headLen = Math.floor(maxLen * 0.85);         // 앞 85%
  const tailBudget = maxLen - headLen;                // 가격 밀집 구간용 15%
  const head = raw.slice(0, headLen);

  // 가격 키워드 밀집도 스코어링: 뒤쪽 텍스트를 슬라이딩 윈도우로 검색
  const tailCandidate = raw.slice(headLen);           // 앞 85% 이후 전부
  if (tailCandidate.length === 0 || tailBudget === 0) return head;  // 안전장치

  const priceKeywords = ['￦', '가격', '요금', '금액', 'KRW',
    '성인', '어른', '소인', '아동', '유아', '1인', '1인당',
    '조식', '중식', '석식', '식비', '입장료'];
  let bestScore = 0;
  let bestStart = 0;
  const windowSize = Math.min(tailBudget, tailCandidate.length);
  const step = Math.max(1, Math.floor(tailCandidate.length / 200));  // 200 step sampling
  for (let i = 0; i <= tailCandidate.length - windowSize; i += step) {
    const window = tailCandidate.slice(i, i + windowSize);
    let score = 0;
    for (const kw of priceKeywords) {
      let idx = 0;
      while ((idx = window.indexOf(kw, idx)) !== -1) {
        score += kw.length;
        idx += kw.length;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestStart = i;
    }
  }

  // 가격 키워드가 전혀 없으면 앞부분만 반환
  if (bestScore === 0) return head;
  const tailSlice = tailCandidate.slice(bestStart, bestStart + windowSize);
  console.log(`[Parser] 중요도 기반 청크: head=${headLen} tail=+${tailSlice.length} (score=${bestScore}, offset=+${headLen + bestStart})`);
  return head + '\n\n=== 중요 구간 ===\n\n' + tailSlice;
}


async function lazyLlmCall(params: Parameters<typeof import('@/lib/llm-gateway')['llmCall']>[0]): ReturnType<typeof import('@/lib/llm-gateway')['llmCall']> {
  const { llmCall: call } = await import('@/lib/llm-gateway');
  return call(params);
}

function getGeminiModel(apiKey: string, schema?: ResponseSchema, maxOutputTokens = 8192) {
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens,
      ...(schema ? { responseMimeType: 'application/json', responseSchema: schema } : {}),
    },
  });
}

async function callGeminiVision(apiKey: string, base64Image: string, mimeType: string, prompt: string, schema?: ResponseSchema): Promise<string> {
  const model = getGeminiModel(apiKey, schema);
  const result = await model.generateContent([
    { inlineData: { mimeType, data: base64Image } },
    prompt,
  ]);
  return result.response.text();
}

async function callGeminiText(
  apiKey: string,
  text: string,
  prompt: string,
  schema?: ResponseSchema,
  maxOutputTokens?: number,
): Promise<string> {
  const model = getGeminiModel(apiKey, schema, maxOutputTokens ?? (schema ? 16384 : 8192));
  const result = await model.generateContent(`${prompt}\n\n---\n\n${text}`);
  return result.response.text();
}

async function callGeminiTextTracked(apiKey: string, text: string, prompt: string, maxOutputTokens?: number, schema?: ResponseSchema): Promise<{ text: string; input: number; output: number }> {
  const model = getGeminiModel(apiKey, schema, maxOutputTokens ?? (schema ? 24576 : 16384));
  const result = await model.generateContent(`${prompt}\n\n---\n\n${text}`);
  const meta = result.response.usageMetadata;
  const raw = result.response.text();
  // response_schema 모드면 코드펜스 없이 순수 JSON. strip하지 않아도 되지만 안전하게.
  return { text: raw, input: meta?.promptTokenCount ?? 0, output: meta?.candidatesTokenCount ?? 0 };
}

async function callGeminiVisionTracked(apiKey: string, base64Image: string, mimeType: string, prompt: string): Promise<{ text: string; input: number; output: number }> {
  const model = getGeminiModel(apiKey);
  const result = await model.generateContent([{ inlineData: { mimeType, data: base64Image } }, prompt]);
  const meta = result.response.usageMetadata;
  return { text: result.response.text(), input: meta?.promptTokenCount ?? 0, output: meta?.candidatesTokenCount ?? 0 };
}

// ─── ExtractedData용 Gemini 응답 스키마 ──────────────────────
// Gemini Structured Output으로 JSON 파싱 실패를 원천 차단
const EXTRACTED_DATA_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    title: { type: SchemaType.STRING, nullable: true },
    category: { type: SchemaType.STRING, nullable: true },
    product_type: { type: SchemaType.STRING, nullable: true },
    trip_style: { type: SchemaType.STRING, nullable: true },
    destination: { type: SchemaType.STRING, nullable: true },
    duration: { type: SchemaType.INTEGER, nullable: true },
    departure_days: { type: SchemaType.STRING, nullable: true },
    departure_airport: { type: SchemaType.STRING, nullable: true },
    airline: { type: SchemaType.STRING, nullable: true },
    min_participants: { type: SchemaType.INTEGER, nullable: true },
    ticketing_deadline: { type: SchemaType.STRING, nullable: true },
    guide_tip: { type: SchemaType.STRING, nullable: true },
    single_supplement: { type: SchemaType.STRING, nullable: true },
    small_group_surcharge: { type: SchemaType.STRING, nullable: true },
    price: { type: SchemaType.INTEGER, nullable: true },
    price_tiers: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          period_label: { type: SchemaType.STRING },
          departure_dates: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, nullable: true },
          date_range: {
            type: SchemaType.OBJECT,
            properties: { start: { type: SchemaType.STRING }, end: { type: SchemaType.STRING } },
            nullable: true,
          },
          departure_day_of_week: { type: SchemaType.STRING, nullable: true },
          adult_price: { type: SchemaType.INTEGER, nullable: true },
          child_price: { type: SchemaType.INTEGER, nullable: true },
          status: { type: SchemaType.STRING },
          note: { type: SchemaType.STRING, nullable: true },
        },
      },
    },
    price_list: { type: SchemaType.ARRAY, items: { type: SchemaType.OBJECT, properties: {
      period: { type: SchemaType.STRING },
      rules: { type: SchemaType.ARRAY, items: { type: SchemaType.OBJECT, properties: {
        condition: { type: SchemaType.STRING },
        price_text: { type: SchemaType.STRING },
        price: { type: SchemaType.INTEGER, nullable: true },
        badge: { type: SchemaType.STRING, nullable: true },
      }}},
      notes: { type: SchemaType.STRING, nullable: true },
    }}},
    surcharges: { type: SchemaType.ARRAY, items: { type: SchemaType.OBJECT, properties: {
      period: { type: SchemaType.STRING, nullable: true },
      amount_usd: { type: SchemaType.NUMBER, nullable: true },
      amount_krw: { type: SchemaType.NUMBER, nullable: true },
      note: { type: SchemaType.STRING },
    }}},
    excluded_dates: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    inclusions: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    excludes: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    optional_tours: { type: SchemaType.ARRAY, items: { type: SchemaType.OBJECT, properties: {
      name: { type: SchemaType.STRING },
      region: { type: SchemaType.STRING, nullable: true },    // "[말레이시아 선택관광]" 섹션 → "말레이시아"
      price: { type: SchemaType.STRING, nullable: true },     // "$50/인" 원문 그대로
      price_usd: { type: SchemaType.NUMBER, nullable: true },
      price_krw: { type: SchemaType.NUMBER, nullable: true },
      note: { type: SchemaType.STRING, nullable: true },
    }}},
    itinerary: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    accommodations: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    specialNotes: { type: SchemaType.STRING, nullable: true },
    notices_parsed: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    cancellation_policy: { type: SchemaType.ARRAY, items: { type: SchemaType.OBJECT, properties: {
      period: { type: SchemaType.STRING },
      rate: { type: SchemaType.NUMBER },
      note: { type: SchemaType.STRING, nullable: true },
    }}},
    land_operator: { type: SchemaType.STRING, nullable: true },
    product_tags: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    product_highlights: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    product_summary: { type: SchemaType.STRING, nullable: true },
    fullText: { type: SchemaType.STRING, nullable: true },
  },
};

// ─── 구조화 추출 프롬프트 ────────────────────────────────────
// Gemini implicit caching 활성화를 위한 버전 고정.
// 프롬프트 prefix가 호출마다 동일해야 자동 캐싱됨. 변경 시 버전 bump.
const EXTRACT_PROMPT_VERSION = 'v1.3.0';
void EXTRACT_PROMPT_VERSION;

/**
 * 프롬프트 내 {TODAY_ISO} placeholder 를 오늘 날짜(YYYY-MM-DD)로 치환.
 * 모든 추출 프롬프트는 호출 시점에 이 헬퍼를 통과해야 한다.
 * 박제 사유: 2026-05-13 등록 사고 — "5/27 출발"이 2025-05-27로 추출되어 캘린더 매칭 실패.
 */
export function injectToday(prompt: string): string {
  return prompt.replace(/\{TODAY_ISO\}/g, new Date().toISOString().slice(0, 10));
}

const EXTRACT_PROMPT = `이 여행상품 문서에서 정보를 추출해 정확히 아래 JSON 형식으로 반환하세요.
필드가 없으면 null로, 배열이 없으면 []로 반환하세요.
날짜는 항상 YYYY-MM-DD 형식.

★ 절대 규칙 — 연도 추론 (오늘: {TODAY_ISO}):
- 출발일에 연도가 명시되지 않으면 **오늘({TODAY_ISO}) 이후 가장 가까운 연도**를 사용한다.
- 예 (오늘이 2026-05-13 일 때): "5/27" → "2026-05-27", "12/24" → "2026-12-24", "1/15" → "2027-01-15".
- 발권 마감일·항공 제외일도 동일 규칙. 과거 연도로 절대 추론하지 말 것.
가격은 원화 숫자만 (쉼표 제거, "만원" 단위면 ×10000).

★ 절대 규칙 — duration(여행일수) 정확 추출:
- "3박4일" → duration: 4 (일수가 기준)
- "2박3일" → duration: 3
- 일정표의 "제1일"~"제N일" 개수로 교차 검증하라. 상품명의 "N박M일"과 일정표 일수가 다르면 일정표 일수를 우선하라.

★ 절대 규칙 — 포함/불포함 정확 분리:
- "기사/가이드 팁 포함" 또는 "기사/가이드팁 포함"이 포함사항에 있으면 → inclusions에 추가, guide_tip: "포함"
- "기사/가이드($40/인)" 또는 "기사/가이드 경비"가 불포함사항에 있으면 → excludes에 추가, guide_tip: "$40/인" (금액 원문)
- 반드시 해당 상품의 포함/불포함 섹션에서만 읽어라. 다른 상품의 데이터를 혼합하지 마라.

{
  "title": "상품명 전체 (예: 서안 실속 3박5일)",
  "category": "package 또는 golf 또는 honeymoon 또는 cruise 또는 theme",
  "product_type": "실속 또는 품격 또는 노팁노옵션 또는 일반 (없으면 null)",
  "trip_style": "3박5일 또는 4박6일 등 (없으면 null)",
  "destination": "목적지 도시/지역명",
  "duration": 여행일수 숫자 (★ "N박M일"의 M이 duration. 일정표 일수로 교차검증),
  "departure_days": "매주 화요일 또는 특정날짜 나열 (없으면 null)",
  "departure_airport": "출발공항명 (없으면 null)",
  "airline": "항공편명 (예: BX341/BX342, 없으면 null)",
  "min_participants": 최소출발인원 숫자 (없으면 4),
  "ticketing_deadline": "YYYY-MM-DD 또는 null",
  "guide_tip": "기사/가이드경비 원문 그대로 (예: '$50/인', 없으면 null)",
  "single_supplement": "싱글차지 원문 (예: '$60/인/박', 없으면 null)",
  "small_group_surcharge": "소규모 할증 원문 (예: '4~7명 $20/인 인상', 없으면 null)",
  "price_tiers": [
    {
      "period_label": "날짜/기간 표시 원문 그대로 (예: '4월 8, 22일' 또는 '4/28~5/15')",
      "departure_dates": ["YYYY-MM-DD"] 또는 null (특정 날짜 나열인 경우),
      "date_range": {"start":"YYYY-MM-DD","end":"YYYY-MM-DD"} 또는 null (기간 범위인 경우),
      "departure_day_of_week": "화 또는 금 또는 수 또는 토 등 (없으면 null)",
      "adult_price": 성인가격 숫자 또는 null,
      "child_price": 아동가격 숫자 또는 null,
      "status": "available 또는 confirmed 또는 soldout",
      "note": "비고 (예: '품격확정', 없으면 null)"
    }
  ],
  "price_list": [
    {
      "period": "기간 원문 그대로 (예: '3/20~3/28', '4/8·4/22', '매주 화')",
      "rules": [
        {
          "condition": "출발조건 원문 (예: '수요일', '제외일 3/28(토)', '전 출발일', '일반')",
          "price_text": "가격 원문 (예: '799,000원', '별도문의', '899,000원')",
          "price": 799000,
          "badge": "특가♥ 또는 일반 또는 호텔UP 또는 별도문의 또는 확정 또는 마감 또는 null"
        }
      ],
      "notes": "해당 기간 부가 조건 원문 (예: '성인/아동 요금 동일, 싱글차지 8만원/인') 또는 null"
    }
  ],
  "surcharges": [
    {"period": "기간 원문", "amount_usd": 달러금액 또는 null, "amount_krw": 원화금액 또는 null, "note": "나담축제 등"}
  ],
  "excluded_dates": ["YYYY-MM-DD"],
  "inclusions": ["항공료 및 텍스", "숙박", "한국어 가이드"],
  "excludes": ["기사/가이드 경비", "개인경비", "매너팁"],
  "optional_tours": [
    {"name": "발마사지", "region": "말레이시아", "price": "$30/인", "price_usd": 30, "price_krw": null, "note": null}
  ],
  "itinerary": ["제1일: 부산출발 → 서안도착", "제2일: 소안탑 → 회족거리"],
  "accommodations": ["천익호텔 또는 홀리데이인익스프레호텔(4성)"],
  "specialNotes": "주의사항, 여권유효기간, 취소규정 외 기타 안내 전체 (원문 보존용)",
  "notices_parsed": [
    {"type": "CRITICAL", "title": "중요 공지", "text": "• 여권 만기/필수 서류/일정 미참여 패널티 등\n• 쇼핑 횟수 표기 (예: '쇼핑 2회 [노니&침향, 커피&잡화]')"},
    {"type": "PAYMENT", "title": "결제 조건", "text": "• 발권 마감일/완납 조건 등 (단 랜드사 거래 용어 '파이널/실명단/투어비 N%' 금지 — 고객 표현으로 치환)"},
    {"type": "POLICY",  "title": "현장 규정", "text": "• 호텔 룸배정/조인행사/식당 운영 등 현장 정책"},
    {"type": "INFO",    "title": "안내 사항", "text": "• 가이드/이동/식사 변경 가능성 등 일반 안내"}
  ],
  "★ notices_parsed schema 절대 규칙": "정확히 4개 객체 (CRITICAL/PAYMENT/POLICY/INFO 각 1개). type/title/text 3 필드. text 는 '•' 불렛 줄바꿈. 문자열 배열 금지 — 반드시 객체 배열.",
  "cancellation_policy": [
    {"period": "출발일 14일~7일전", "rate": 30, "note": "30% 공제 후 환불"}
  ],
  "category_attrs": {},
  "land_operator": "랜드사/현지여행사명 (문서에 명시된 경우, 없으면 null)",
  "product_tags": ["아래 목록 중 해당하는 것만: 에어텔, 가족전용, 소규모, 노팁, 노옵션, 럭셔리, 프리미엄, 실속, 자유여행, 단체"],
  "product_highlights": ["고객에게 어필되는 핵심 특전 3개 이내. 예: '가이드팁 포함', '5성급 호텔', '소규모 12명 진행'"],
  "product_summary": "이 상품을 2~3줄로 요약. 상품특성+출발정보+주요특이사항 포함. 예: '소규모 노팁노옵션 몽골 3박5일. 매주 화요일 부산출발. 4~7명 소규모 할증 $20~40/인. 발권마감 3/30.'",
  "fullText": "문서 전체 텍스트를 그대로 복사"
}

★ optional_tours.region: 원문에 '[말레이시아 선택관광]'·'[싱가포르 선택관광]' 같은 섹션 헤더가 있으면 해당 섹션 선택관광마다 region을 주입한다. 섹션 없으면 이름 속 지역 키워드로 추론. '2층버스'·'리버보트' 등 모호한 이름은 섹션 헤더 region을 따른다.

★ price_list 작성 규칙 (price_tiers와 별도로 반드시 채울 것):
- 동일 기간 내 요일·날짜별 다른 가격 → rules[] 배열 분리 기재.
- 가격 조건 동일 시 rules 1개 (condition: "전 출발일").
- price: 숫자(원화), '별도문의'·'문의'·'$별도' 등 확정 불가 시 null.
- badge: 원문 특가♥/↑/★ → 가장 근접한 표준값 매핑. 원문 없으면 null.
- notes: 아동요금 동일 여부, 싱글차지, 대욕장UP, 가이드팁 포함 여부 반드시 포함.

반드시 JSON만 반환하세요. 마크다운 코드블록이나 다른 설명 없이 JSON 객체만.`;

// ─── 파싱 결과 처리 ─────────────────────────────────────────

import { toSurcharge, type Surcharge as NormalizedSurcharge } from '@/types/pricing';

/**
 * string/number 혼재 추가요금 필드를 Surcharge[] 배열로 통합 정규화
 * - guide_tip, single_supplement, small_group_surcharge 문자열 → Surcharge
 * - 기존 surcharges[] (amount_krw/amount_usd) → kind 추가하여 재구성
 */
function normalizeSurcharges(parsed: {
  guide_tip?: string;
  single_supplement?: string;
  small_group_surcharge?: string;
  surcharges?: Array<{ period?: string; amount_usd?: number | null; amount_krw?: number | null; note?: string }>;
}): NormalizedSurcharge[] {
  const result: NormalizedSurcharge[] = [];
  const seen = new Set<string>(); // 중복 제거 (note+kind 키)

  const push = (s: NormalizedSurcharge | null) => {
    if (!s) return;
    const key = `${s.kind}:${s.note}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push(s);
  };

  // 1) 기존 문자열 필드 → Surcharge
  if (parsed.guide_tip) push(toSurcharge(parsed.guide_tip, 'guide'));
  if (parsed.single_supplement) push(toSurcharge(parsed.single_supplement, 'single'));
  if (parsed.small_group_surcharge) push(toSurcharge(parsed.small_group_surcharge, 'small_group'));

  // 2) 기존 surcharges[] → kind 추정하여 재구성
  if (Array.isArray(parsed.surcharges)) {
    for (const s of parsed.surcharges) {
      if (!s || !s.note) continue;
      const note = String(s.note);
      let kind: NormalizedSurcharge['kind'] = 'other';
      if (/축제|나담|공휴일|성수기/.test(note)) kind = 'festival';
      else if (/싱글/.test(note)) kind = 'single';
      else if (/호텔|리조트|라사피네트|호라이즌/.test(note)) kind = 'hotel';
      else if (/디너|식사|의무/.test(note)) kind = 'meal';
      else if (/가이드|기사|tip|팁/i.test(note)) kind = 'guide';
      else if (/소규모|인원/.test(note)) kind = 'small_group';
      push({
        amount_krw: typeof s.amount_krw === 'number' ? s.amount_krw : null,
        amount_usd: typeof s.amount_usd === 'number' ? s.amount_usd : null,
        period: s.period ?? null,
        note,
        kind,
        unit: null,
      });
    }
  }

  return result;
}

function parseGeminiResponse(raw: string, fallbackText: string): ExtractedData {
  const jsonStr = stripCodeFences(raw);
  // Gemini/DeepSeek JSON 형이 필드마다 달라 any로 수용 후 필드별로 사용 (기존 동작 유지)
  let parsed: {
    fullText?: string;
    title?: string;
    category?: ExtractedData['category'];
    product_type?: string;
    trip_style?: string;
    destination?: string;
    duration?: number | string;
    departure_days?: string;
    departure_airport?: string;
    airline?: string;
    min_participants?: number;
    ticketing_deadline?: string;
    guide_tip?: string;
    single_supplement?: string;
    small_group_surcharge?: string;
    price?: number;
    price_tiers?: PriceTier[];
    price_list?: PriceListItem[];
    surcharges?: Surcharge[];
    excluded_dates?: string[];
    inclusions?: string[];
    excludes?: string[];
    optional_tours?: OptionalTour[];
    itinerary?: string[];
    accommodations?: string[];
    specialNotes?: string;
    notices_parsed?: (string | NoticeItem)[];
    cancellation_policy?: CancellationPolicy[];
    category_attrs?: Record<string, unknown>;
    land_operator?: string;
    product_tags?: string[];
    product_highlights?: string[];
    product_summary?: string;
  };
  try {
    parsed = JSON.parse(loosenJsonCommas(jsonStr));
  } catch {
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      throw e instanceof Error ? e : new Error(String(e));
    }
  }

  return {
    rawText: parsed.fullText || fallbackText,
    title: parsed.title || undefined,
    category: parsed.category || 'package',
    product_type: parsed.product_type || undefined,
    trip_style: parsed.trip_style || undefined,
    destination: parsed.destination || undefined,
    duration: typeof parsed.duration === 'number'
      ? parsed.duration
      : (parsed.duration ? parseInt(String(parsed.duration), 10) : undefined),
    // ERR-KUL-01 — JSON 배열 문자열(`["금"]`) 노출 방지: 저장 시점에 평문으로 정규화
    departure_days: formatDepartureDays(parsed.departure_days) || undefined,
    departure_airport: parsed.departure_airport || undefined,
    airline: normalizeAirlineCode(parsed.airline) || undefined,
    min_participants: parsed.min_participants || 4,
    ticketing_deadline: parsed.ticketing_deadline || undefined,
    guide_tip: parsed.guide_tip || undefined,
    single_supplement: parsed.single_supplement || undefined,
    small_group_surcharge: parsed.small_group_surcharge || undefined,
    normalized_surcharges: normalizeSurcharges(parsed as Parameters<typeof normalizeSurcharges>[0]),
    price: Array.isArray(parsed.price_tiers) && parsed.price_tiers.length > 0
      ? (parsed.price_tiers.find((t: PriceTier) => t.adult_price)?.adult_price ?? parsed.price ?? undefined)
      : (parsed.price ?? undefined),
    price_tiers: Array.isArray(parsed.price_tiers)
      ? filterTiersByDepartureDays(
          expandPriceTiersDateRanges(parsed.price_tiers, parsed.departure_days),
          parsed.departure_days,
        )
      : [],
    price_list: Array.isArray(parsed.price_list) ? parsed.price_list as PriceListItem[] : [],
    surcharges: Array.isArray(parsed.surcharges) ? parsed.surcharges : [],
    excluded_dates: Array.isArray(parsed.excluded_dates) ? parsed.excluded_dates : [],
    inclusions: Array.isArray(parsed.inclusions) ? parsed.inclusions.filter(Boolean) : [],
    excludes: Array.isArray(parsed.excludes) ? parsed.excludes.filter(Boolean) : [],
    // ERR-KUL-04 — optional_tours.region 자동 주입 (AI가 누락해도 라벨 일관성 보장)
    optional_tours: enrichOptionalToursRegion(parsed.optional_tours),
    itinerary: Array.isArray(parsed.itinerary) ? parsed.itinerary.filter(Boolean) : [],
    accommodations: Array.isArray(parsed.accommodations) ? parsed.accommodations.filter(Boolean) : [],
    specialNotes: parsed.specialNotes || undefined,
    notices_parsed: Array.isArray(parsed.notices_parsed) ? parsed.notices_parsed.filter(Boolean) : [],
    cancellation_policy: Array.isArray(parsed.cancellation_policy) ? parsed.cancellation_policy : [],
    category_attrs: parsed.category_attrs || {},
    land_operator: parsed.land_operator || undefined,
    product_tags: Array.isArray(parsed.product_tags) ? parsed.product_tags.filter(Boolean) : [],
    product_highlights: Array.isArray(parsed.product_highlights) ? parsed.product_highlights.filter(Boolean) : [],
    product_summary: parsed.product_summary || undefined,
  };
}

// ─── PDF 파싱 ───────────────────────────────────────────────

export async function parsePDF(buffer: Buffer): Promise<string> {
  try {
    console.log('[Parser] PDF 파싱 시작:', buffer.length, '바이트');
    const pdfParse = (await import('pdf-parse')).default;
    const data = await pdfParse(buffer);
    console.log('[Parser] PDF 파싱 완료:', data.text?.length || 0, '글자');
    return data.text || '';
  } catch (error) {
    throw new Error(`PDF 파싱 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
  }
}

// ─── 이미지 파싱 (Gemini Vision) ────────────────────────────

export async function parseImage(buffer: Buffer, mimeType = 'image/jpeg'): Promise<{ rawText: string; extractedData: ExtractedData }> {
  const apiKey = getSecret('GOOGLE_AI_API_KEY');
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY가 설정되지 않았습니다.');

  console.log('[Parser] 이미지 AI 파싱 시작:', buffer.length, '바이트');
  const base64 = buffer.toString('base64');

  try {
    const raw = await callGeminiVision(apiKey, base64, mimeType, injectToday(EXTRACT_PROMPT), EXTRACTED_DATA_SCHEMA);
    console.log('[Parser] Gemini Vision 응답:', raw.length, '글자');
    const extractedData = parseGeminiResponse(raw, raw);
    console.log('[Parser] 추출 완료 - 상품:', extractedData.title, '/ price_tiers:', extractedData.price_tiers?.length);
    return { rawText: extractedData.rawText, extractedData };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[Parser] Gemini Vision 오류:', errMsg);
    if (errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('limit: 0')) {
      throw new Error('Google AI API 쿼터/결제 오류. Google Cloud Console에서 결제를 활성화하세요. (console.cloud.google.com)');
    }
    throw new Error(`이미지 파싱 실패: ${errMsg}`);
  }
}

// ─── PDF/텍스트 AI 구조화 추출 (DeepSeek via llm-gateway) ──────

async function parseTextWithAI(text: string, options?: ParseOptions): Promise<ExtractedData> {
  // 너무 짧은 텍스트는 AI 호출 무의미 → regex fallback으로 토큰 절약
  if (text.trim().length < 300) {
    console.log('[Parser] 짧은 텍스트(<300자) → regex fallback');
    return extractTravelInfo(text);
  }

  // Reflexion few-shot 블록 (과거 정정 사례 주입)
  const reflectionBlock = options?.reflections?.length
    ? `\n\n## 과거 정정 사례 (반드시 반영)\n${options.reflections.map(r =>
        `- [${r.field_path}] "${r.before_value}" → "${r.after_value}": ${r.reflection ?? '정정 사항'}`
      ).join('\n')}`
    : '';
  const regionBlock = options?.regionContext ?? '';

  // EPR few-shot 자동 retrieve — 박제 2026-05-13
  // 호출자가 fewShotExamples 안 주입했으면 rawText 로 cosine top-3 자동 회수.
  // sleep-time compute: 등록 누적할수록 demo 풀 풍부해져 다음 추출이 compound 로 똑똑.
  let fewShotExamples: SimilarExample[] = options?.fewShotExamples ?? [];
  if (fewShotExamples.length === 0) {
    try {
      // 동적 import — parser 의 supabase 결합도 회피
      const supaMod = await import('@/lib/supabase');
      if (supaMod.isSupabaseConfigured) {
        const geminiKey = getSecret('GOOGLE_AI_API_KEY') ?? '';
        if (geminiKey) {
          // 타입 단순화 위해 unknown 캐스팅 — retrieveSimilarExamples 가 자체 검증
          fewShotExamples = await retrieveSimilarExamples(
            text,
            supaMod.supabaseAdmin as unknown as Parameters<typeof retrieveSimilarExamples>[1],
            geminiKey,
            { limit: 3, minSimilarity: 0.55 },
          ).catch(() => []);
          if (fewShotExamples.length > 0) {
            console.log(`[Parser] EPR retrieved ${fewShotExamples.length} demos (top sim: ${fewShotExamples[0]?.similarity.toFixed(3)})`);
          }
        }
      }
    } catch (e) {
      console.warn('[Parser] EPR retrieve 실패(무시):', (e as Error).message);
    }
  }
  const fewShotBlock = fewShotExamples.length
    ? '\n\n' + buildFewShotPromptFragment(fewShotExamples)
    : '';
  // Phase 5-2/6-2 박제 — 랜드사 프로파일 fragment
  const profileBlock = buildProfilePromptFragment(options?.landOperatorProfile);

  try {
    const systemPrompt = injectToday(EXTRACT_PROMPT + regionBlock + reflectionBlock + fewShotBlock + profileBlock + '\n\n반드시 JSON만 출력하고 다른 설명 텍스트는 절대 포함하지 마세요.');
    const cacheKey = `${systemPrompt}\n---USER---\n${text}`;

    // 의미 캐시 우선 시도 (parse_travel_doc 는 SAFE_CACHE_TASKS 화이트리스트)
    // 동일 원문 + 동일 region/reflection → 동일 결과 결정론적이므로 캐시 hit 시 토큰 비용 0
    const cached = await lookupSemanticCache('parse_travel_doc', cacheKey);
    if (cached.hit && cached.response) {
      console.log(`[Parser] 의미 캐시 hit (${cached.hitType}, sim=${cached.similarity?.toFixed(3) ?? 'n/a'})`);
      const extractedData = parseGeminiResponse(cached.response, text);
      extractedData.rawText = text;
      return extractedData;
    }

    const result = await lazyLlmCall({
      task: 'parse_travel_doc',
      systemPrompt,
      userPrompt: text,
      maxTokens: 4000,
      temperature: 0.1,
      enableCaching: true,
      // Confidence-gated escalation — Flash 추출 후 핵심 필드 누락이면 Pro advisor로 자동 재실행
      escalateIfLowConfidence: (raw) => {
        if (!raw || typeof raw !== 'object') return true;
        const arr = Array.isArray(raw) ? raw : [raw];
        const first = arr[0] as Partial<ExtractedData> | undefined;
        if (!first) return true;
        const noCore = !first.title || !first.destination || !first.duration;
        const noPrice = !first.price_tiers || (Array.isArray(first.price_tiers) && first.price_tiers.length === 0);
        return noCore || noPrice;
      },
    });

    if (result.success && result.rawText) {
      const provider = result.fallbackUsed ? 'Gemini(fallback)' : `DeepSeek${result.cacheHit ? '(캐시)' : ''}`;
      console.log(`[Parser] ${provider} 응답:`, result.rawText.length, '글자');
      // 캐시 저장 (fail-open)
      void storeSemanticCache('parse_travel_doc', cacheKey, result.rawText);
      const extractedData = parseGeminiResponse(result.rawText, text);
      extractedData.rawText = text;

      // P1-5: price_tiers 가 여전히 빈 배열이면 Gemini structured output 으로 1회 재시도
      const priceTiersEmpty = !extractedData.price_tiers || extractedData.price_tiers.length === 0;
      if (priceTiersEmpty && !result.advisorUsed) {
        const apiKey = getSecret('GOOGLE_AI_API_KEY');
        if (apiKey) {
          console.warn('[Parser] price_tiers 누락 — Gemini structured output 재시도');
          try {
            const geminiRaw = await callGeminiText(apiKey, text, injectToday(EXTRACT_PROMPT), EXTRACTED_DATA_SCHEMA);
            const geminiData = parseGeminiResponse(geminiRaw, text);
            if (geminiData.price_tiers && geminiData.price_tiers.length > 0) {
              console.log('[Parser] Gemini 재시도 성공 — price_tiers:', geminiData.price_tiers.length, '개');
              geminiData.rawText = text;
              geminiData._llm_meta = {
                ...extractedData._llm_meta,
                provider: 'gemini(structured)',
                retry_count: (extractedData._llm_meta?.retry_count ?? 0) + 1,
              };
              return geminiData;
            }
          } catch {
            console.warn('[Parser] Gemini price_tiers 재시도 실패 — 기존 결과 유지');
          }
        }
      }

      // P11-4 박제: LLM 호출 메타 attach (upload route 가 ai_quality_log 에 적재)
      const usage = result._usage;
      extractedData._llm_meta = {
        advisor_used:  Boolean(result.advisorUsed),
        provider:      result.provider,
        fallback_used: Boolean(result.fallbackUsed),
        cache_hit:     Boolean(result.cacheHit),
        retry_count:   result.retryCount,
        tokens_input:  usage?.input,
        tokens_output: usage?.output,
      };
      console.log('[Parser] 추출 완료 - 상품:', extractedData.title, '/ price_tiers:', extractedData.price_tiers?.length, '/ advisor:', extractedData._llm_meta.advisor_used);
      return extractedData;
    }

    // llm-gateway 전체 실패 → Gemini 직접 fallback
    const apiKey = getSecret('GOOGLE_AI_API_KEY');
    if (apiKey) {
      console.warn('[Parser] llm-gateway 실패, Gemini 직접 fallback');
      const raw = await callGeminiText(apiKey, text, injectToday(EXTRACT_PROMPT), EXTRACTED_DATA_SCHEMA);
      const extractedData = parseGeminiResponse(raw, text);
      extractedData.rawText = text;
      return extractedData;
    }

    console.warn('[Parser] AI 전체 실패, regex fallback');
    return extractTravelInfo(text);
  } catch (err) {
    console.warn('[Parser] AI 텍스트 추출 실패, regex fallback:', err);
    return extractTravelInfo(text);
  }
}

// ─── HWP / HWPX 파싱 (kordoc 제거됨 → PDF 변환 안내) ──────

export async function parseHWP(_buffer: Buffer, filename: string): Promise<string> {
  const name = filename.replace(/\.hwp$/i, '').trim();
  throw new Error(`HWP 파일(.hwp)은 더 이상 지원되지 않습니다. PDF로 변환 후 업로드해 주세요. (파일명: ${name})`);
}

export async function parseHWPX(_buffer: Buffer, filename: string): Promise<string> {
  const name = filename.replace(/\.hwpx$/i, '').trim();
  throw new Error(`HWPX 파일(.hwpx)은 더 이상 지원되지 않습니다. PDF로 변환 후 업로드해 주세요. (파일명: ${name})`);
}
// ─── Regex fallback 파싱 (PDF/HWP AI 실패 시) ───────────────

export function extractTravelInfo(text: string, filename?: string): ExtractedData {
  const data: ExtractedData = {
    rawText: text,
    category: 'package',
    itinerary: [],
    inclusions: [],
    excludes: [],
    accommodations: [],
    price_tiers: [],
    price_list: [],
    surcharges: [],
    excluded_dates: [],
    optional_tours: [],
    cancellation_policy: [],
    category_attrs: {},
    product_tags: [],
    product_highlights: [],
  };

  if (filename) {
    let titleFromFilename = filename.replace(/\.(hwp|jpg|jpeg|png|pdf)$/i, '').trim();
    titleFromFilename = titleFromFilename.replace(/^(수정완료|최종|확인|검토|수정|완료|임시|draft)[_\s]*/i, '').trim();
    if (!data.title) data.title = titleFromFilename;

    const bracketDestMatch = titleFromFilename.match(/\]\s*([가-힣]+(?:\s+[가-힣]+)*)/);
    if (bracketDestMatch && !data.destination) data.destination = bracketDestMatch[1].trim().slice(0, 50);
    else if (!data.destination) {
      const simpleDestMatch = titleFromFilename.match(/^([가-힣]+(?:\s+[가-힣]+)*)/);
      if (simpleDestMatch) data.destination = simpleDestMatch[1].trim().slice(0, 50);
    }

    const durationMatch = titleFromFilename.match(/(\d+)\s*박\s*(\d+)\s*일|(\d+)\s*일/i);
    if (durationMatch && !data.duration) data.duration = parseInt(durationMatch[2] || durationMatch[3]);

    const tripStyleMatch = titleFromFilename.match(/(\d+박\d+일)/);
    if (tripStyleMatch) data.trip_style = tripStyleMatch[1];
  }

  const titleMatch = text.match(/^([^\n]{5,100})/m);
  if (titleMatch && !data.title) data.title = titleMatch[1].trim();

  const destMatch = text.match(/(목적지|여행지|도시|지역|장소)[\s:]*([^,\n]+)/i);
  if (destMatch && !data.destination) data.destination = destMatch[2].trim();

  const durationMatch = text.match(/(\d+)\s*박\s*(\d+)\s*일|(\d+)\s*일간?/i);
  if (durationMatch && !data.duration) data.duration = parseInt(durationMatch[2] || durationMatch[3]);

  const priceMatch = text.match(/([0-9,]+)\s*원/);
  if (priceMatch && !data.price) data.price = parseInt(priceMatch[1].replace(/,/g, ''));

  const itineraryMatches = text.match(/(?:제?\d+일차?|Day\s*\d+)[\s:]*([^\n]+)/gi);
  if (itineraryMatches) data.itinerary = itineraryMatches.map(m => m.trim());

  // inclusions/excludes SSOT: extractBullets (deterministic/bullets.ts) — upload/route.ts G2.
  // 옛 regex split(콤마) 경로 삭제 (RC1, 2026-05-20). 공존 시 EOF까지 매치 + 커미션 누출.

  const minParticipantsMatch = text.match(/(\d+)\s*명\s*이상/);
  if (minParticipantsMatch) data.min_participants = parseInt(minParticipantsMatch[1]);

  return data;
}

// ─── 일정표 구조화 추출 (itinerary_data) ────────────────────

// (extractItineraryData는 src/lib/parser/extract-itinerary.ts 로 이동)

// ─── 복수 상품 통합 추출 ─────────────────────────────────────

/**
 * PDF 1장에 여러 상품이 담긴 경우 전체를 배열로 추출.
 * EXTRACT_PROMPT + ITINERARY_PROMPT를 하나로 합쳐 AI 호출 1회로 처리.
 */
// ── Phase 1: 기본 정보 + 가격 추출 (itinerary_data 제외 → 빠름) ──
const MULTI_PRODUCT_PHASE1_PROMPT = `여행상품 문서에서 모든 상품의 기본 정보와 가격을 JSON 배열로 추출하세요.
일정표(itinerary_data/days)는 추출하지 마세요. 상품이 1개여도 배열로 감싸세요.

★★★ 복수 상품 분리 (필수) ★★★
- 원문에 "[ZE]", "【BX】" 등(반각·전각 대괄호) 랜드 코드로 시작하고 같은 줄에 "일정표" 또는 "일정 표"가 붙은 헤더가 여러 번 나오면, 각 헤더와 그 아래의 포함/불포함/REMARK/일정·식사·호텔 블록을 하나의 상품으로 묶어 JSON 배열에 별도 객체로 넣을 것.
- 상단 공통 가격표(목·일 5일/6일 요금)가 있으면 각 상품 객체의 price_tiers·price_list에 동일하게 반영해도 됨. 절대 4개 일정을 하나의 title로 합치지 말 것.
- 출력은 반드시 유효한 JSON 배열만. 주석·설명·마크다운 코드펜스 금지.

★★★ 절대 규칙 ★★★
- 연도 추론 (오늘: {TODAY_ISO}): 출발일·발권일에 연도가 없으면 오늘 이후 가장 가까운 연도를 사용. 절대 과거 연도 추론 금지. 예: 오늘 {TODAY_ISO} 일 때 "5/27"→가장 가까운 5/27 (오늘 이후).
- 상품 간 데이터 오염 금지: 각 상품의 inclusions/excludes/guide_tip/price_tiers는 해당 상품 섹션에서만 추출.
- price_tiers 요일 정합성: 각 상품의 price_tiers 내 departure_day_of_week는 해당 상품의 departure_days와 반드시 일치해야 한다. 예: departure_days가 "일,월"인 상품에 "목","금" tier 포함 금지. 제외일 tier도 동일 규칙 적용.
- [엄격한 경고] inclusions/excludes/specialNotes는 원문 텍스트를 1글자도 변경/요약/삭제/역산하지 말 것. 원본 그대로 복사.
- 원본에 없는 데이터는 절대 생성하지 말 것 (null 처리).
- duration: "3박4일" → 4 (일수). departure_day_of_week: "토 출발" → "토".
- 가격: "849,-" → 849000 (×1000). price_tiers와 price_list 둘 다 반드시 채울 것.
- 복수 상품이면 각 상품별 해당 열(Column)의 가격만 추출.
- excluded_dates: 항공제외일을 YYYY-MM-DD 배열로 반드시 추출.

★★★ 카탈로그 월·요일별 가격표 강제 추출 (2026-05-14 박제) ★★★
원문에 "5월/6월/7월" 같은 월 헤더 + 요일(일-수, 목, 금, 토) + 날짜 리스트 + 가격이 표 형태로 나오면
**반드시 모든 행을 price_tiers 로 풀어서** 추출. 예시:
  원문: "5월 일-수 19,25,31 159,000 / 목 7,14,21,28 219,000"
  → price_tiers: [
      {"period_label":"5월 일-수","departure_dates":["YYYY-05-19","YYYY-05-25","YYYY-05-31"],"departure_day_of_week":"일,월,화,수","adult_price":159000},
      {"period_label":"5월 목","departure_dates":["YYYY-05-07","YYYY-05-14","YYYY-05-21","YYYY-05-28"],"departure_day_of_week":"목","adult_price":219000}
    ]
빈 price_tiers 절대 금지. 가격표가 명시되어 있으면 단 한 행도 누락하지 말 것.

★★★ Ferry/Cruise 상품 분류 (2026-05-14 박제) ★★★
title 또는 본문에 "부관훼리", "뉴카멜리아", "카멜리아", "훼리", "페리", "선박", "크루즈" 키워드가 있으면:
  - category: "cruise"
  - product_type: "cruise"
  - airline: 페리사명 (예: "부관훼리"). 항공편 표기 절대 금지.
  - excluded_dates: 선박 운항 제외일.

[
  {
    "title":"상품명","category":"package|golf|honeymoon|cruise|theme","product_type":"실속|품격|노팁노옵션|null",
    "trip_style":"3박4일|null","destination":"목적지","duration":일수,"departure_days":"출발요일|null",
    "departure_airport":"출발공항|null","airline":"항공사/편명|null","min_participants":최소인원,
    "ticketing_deadline":"YYYY-MM-DD|null","guide_tip":"원문|null","single_supplement":"원문|null",
    "small_group_surcharge":"원문|null",
    "price_tiers":[{"period_label":"기간원문","departure_dates":["YYYY-MM-DD"],"date_range":{"start":"","end":""},
      "departure_day_of_week":"목|금|화,수,토|null","adult_price":숫자,"child_price":숫자,"status":"available","note":"비고원문|null"}],
    "price_list":[{"period":"기간원문","rules":[{"condition":"조건","price_text":"가격원문","price":숫자,"badge":null}],"notes":"부가조건|null"}],
    "surcharges":[{"period":"","amount_usd":null,"amount_krw":null,"note":""}],
    "excluded_dates":["YYYY-MM-DD"],
    "inclusions":["포함항목 원문 그대로"],"excludes":["불포함항목 원문 그대로"],
    "optional_tours":[{"name":"","region":null,"price":null,"price_usd":null,"price_krw":null}],
    "accommodations":["호텔명"],
    "specialNotes":"주의사항+비고 전체 원문",
    "notices_parsed":[{"type":"CRITICAL|PAYMENT|POLICY|INFO","title":"제목","text":"• 항목1\n• 항목2\n• 항목3"}],
    "cancellation_policy":[{"period":"","rate":0,"note":""}],
    "land_operator":"랜드사|null","product_tags":["태그"],"product_highlights":["특전3개이내"],"product_summary":"2줄요약"
  }
]

★ notices_parsed: 정확히 4개(CRITICAL/PAYMENT/POLICY/INFO 각 1개). text는 "•" 불렛 포인트 형식.
  CRITICAL: 취소/환불/여권/쇼핑횟수. PAYMENT: 추가요금/할증. POLICY: 현장규정. INFO: 이동/안내.
★ note: 비고는 해당 기간 price_tiers에만 기재. 다른 기간에 적용 금지.
반드시 JSON 배열만 반환.`;

// ── Phase 2: 특정 상품의 일정표만 추출 ──
const MULTI_PRODUCT_PHASE2_PROMPT = `"{{PRODUCT_TITLE}}" 상품의 일정표만 JSON 객체로 추출하세요. 다른 상품 혼합 금지.

★★★ 절대 규칙: 원본 일정 텍스트를 1글자도 변경/요약/삭제하지 말 것. 선택관광/미팅위치/수하물안내는 해당 일차 schedule에 그대로 넣을 것. ★★★
★ 연도 (오늘: {TODAY_ISO}): 일정 내 날짜에 연도가 없으면 오늘 이후 가장 가까운 연도 사용. 과거 연도 금지.

{
  "meta":{"title":"상품명","destination":"목적지","nights":박수,"days":일수,"departure_airport":"출발공항|null","airline":"항공사|null","flight_out":"출발편|null","flight_in":"귀국편|null","departure_days":"출발요일|null","min_participants":최소인원,"brand":"여소남"},
  "highlights":{"inclusions":["포함 원문 그대로"],"excludes":["불포함 원문 그대로"],"shopping":"쇼핑원문|null","remarks":["비고 원문 그대로"]},
  "days":[{"day":1,"regions":["지역"],"meals":{"breakfast":false,"lunch":true,"dinner":true,"breakfast_note":null,"lunch_note":"식사명","dinner_note":"식사명"},
    "schedule":[{"time":"09:05","activity":"원문 그대로","transport":"BX1385","note":null,"type":"flight|normal|golf|optional|shopping|cruise|spa","badge":"⛳ 18홀|null"}],
    "hotel":{"name":"호텔명","grade":"4성","note":"또는 동급"}}],
  "optional_tours":[{"name":"","region":null,"price":null,"price_usd":null,"price_krw":null,"note":null}]
}

★ 항공편: 출발/도착 각각 별도 항목. type:"flight", time에 시간 정확히 기입.
★ 선택관광: type:"optional", 할인/포함 정보 activity에 반드시 포함.
★ 일정 변형 조건: note에 표기 (예: "4박6일 시 자유시간").
★ 식사: 불포함/X → false,null. 식사명 → true,식사명. "불포함(클럽식)" → false,"클럽식(불포함)".
반드시 JSON 객체만 반환.`;

export interface MultiProductResult {
  extractedData: ExtractedData;
  itineraryData: TravelItinerary | null;
  /** 카탈로그 N분할 시 이 상품만의 원문 (없으면 full rawText) */
  sectionRawText?: string;
}

/** LLM이 흔히 내는 비표준 JSON(후행 쉼표 등)만 최소한으로 완화 — 문자열 내부는 건드리지 않음 */
function stripCodeFences(s: string): string {
  return s.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').replace(/^\uFEFF/, '').trim();
}

function loosenJsonCommas(jsonStr: string): string {
  let out = '';
  let inString = false;
  let escape = false;
  for (let i = 0; i < jsonStr.length; i++) {
    const c = jsonStr[i];
    if (escape) {
      out += c;
      escape = false;
      continue;
    }
    if (c === '\\' && inString) {
      out += c;
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      out += c;
      continue;
    }
    if (!inString && c === ',' && (jsonStr[i + 1] === '}' || jsonStr[i + 1] === ']')) {
      continue;
    }
    out += c;
  }
  return out;
}

function coerceTopLevelArray(result: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  if (result && typeof result === 'object') {
    const o = result as Record<string, unknown>;
    const nested = o.products ?? o.items ?? o.data ?? o.packages;
    if (Array.isArray(nested) && nested.length > 0 && typeof nested[0] === 'object') {
      return nested as Record<string, unknown>[];
    }
  }
  return null;
}

/** Unterminated string 특화 복구: 문자열 내부/외부를 구분하여 마지막 "문자열 밖의 }"를 찾아 배열 닫기 */
function repairUnterminatedJson(raw: string): string | null {
  const isInsideString: boolean[] = new Array(raw.length).fill(false);
  let inStr = false;
  let esc = false;
  for (let i = 0; i < raw.length; i++) {
    if (esc) { isInsideString[i] = inStr; esc = false; continue; }
    if (raw[i] === '\\' && inStr) { isInsideString[i] = true; esc = true; continue; }
    if (raw[i] === '"') { isInsideString[i] = inStr; inStr = !inStr; continue; }
    isInsideString[i] = inStr;
  }
  for (let i = raw.length - 1; i >= 0; i--) {
    if (raw[i] === '}' && !isInsideString[i]) {
      let candidate = raw.slice(0, i + 1);
      if (!candidate.trimStart().startsWith('[')) candidate = '[' + candidate;
      if (!candidate.trimEnd().endsWith(']')) candidate += ']';
      return candidate;
    }
  }
  return null;
}

function tryParseJsonArray(jsonStr: string): Record<string, unknown>[] | null {
  const loosened = loosenJsonCommas(jsonStr);
  try {
    const result = JSON.parse(loosened);
    return coerceTopLevelArray(result);
  } catch {
    try {
      const result = JSON.parse(jsonStr);
      return coerceTopLevelArray(result);
    } catch {
      return null;
    }
  }
}

// JSON 파싱 헬퍼 (잘린 JSON 복구 포함)
function safeParseJsonArray(raw: string): Record<string, unknown>[] | null {
  const strippedRaw = stripCodeFences(raw);
  const jsonStr = strippedRaw;
  const direct = tryParseJsonArray(jsonStr);
  if (direct) return direct;

  const balanced = extractBalancedJsonArraySubstring(jsonStr);
  if (balanced) {
    const fromBal = tryParseJsonArray(balanced);
    if (fromBal) {
      console.log('[Parser] 균형 잡힌 JSON 배열 슬라이스 파싱 성공');
      return fromBal;
    }
  }

  const lastCloseBrace = jsonStr.lastIndexOf('}');
  if (lastCloseBrace >= 0) {
    const sliced = jsonStr.slice(0, lastCloseBrace + 1);
    const slicedArr = !sliced.endsWith(']') ? sliced + ']' : sliced;
    const slicedFull = !slicedArr.startsWith('[') ? '[' + slicedArr : slicedArr;
    const repaired = tryParseJsonArray(slicedFull);
    if (repaired) {
      console.log('[Parser] 잘린 JSON 복구 성공');
      return repaired;
    }
  }

  // 4단계: Unterminated string 특화 repair — 원본(strippedRaw) 기준으로 안전한 } 탐색
  const unterm = repairUnterminatedJson(strippedRaw);
  if (unterm) {
    const fromUnterm = tryParseJsonArray(unterm);
    if (fromUnterm) {
      console.log(`[Parser] Unterminated string repair 성공 — 원본 ${strippedRaw.length}자 중 ${unterm.length}자 보존, ${fromUnterm.length}개 객체 복구`);
      return fromUnterm;
    }
  }
  return null;
}

function safeParseJsonObject(raw: string): Record<string, unknown> | null {
  const jsonStr = stripCodeFences(raw);
  const tryObj = (s: string): Record<string, unknown> | null => {
    const loosened = loosenJsonCommas(s);
    try {
      return JSON.parse(loosened) as Record<string, unknown>;
    } catch {
      try {
        return JSON.parse(s) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
  };
  const first = tryObj(jsonStr);
  if (first) return first;
  const balanced = extractBalancedJsonObjectSubstring(jsonStr);
  if (balanced) {
    const fromBal = tryObj(balanced);
    if (fromBal) {
      console.log('[Parser] 균형 잡힌 JSON 객체 슬라이스 파싱 성공');
      return fromBal;
    }
  }
  const start = jsonStr.indexOf('{');
  const end = jsonStr.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return tryObj(jsonStr.slice(start, end + 1));
  }
  return null;
}

// Phase 1 결과 → ExtractedData 변환
function phase1ItemToExtractedData(item: Record<string, unknown>, rawText: string): ExtractedData {
  return {
    rawText,
    title: (item.title as string) || undefined,
    category: (item.category as ExtractedData['category']) || 'package',
    product_type: (item.product_type as string) || undefined,
    trip_style: (item.trip_style as string) || undefined,
    destination: (item.destination as string) || undefined,
    duration: typeof item.duration === 'number' ? item.duration : undefined,
    departure_days: formatDepartureDays(item.departure_days) || undefined,
    departure_airport: (item.departure_airport as string) || undefined,
    airline: (item.airline as string) || undefined,
    min_participants: typeof item.min_participants === 'number' ? item.min_participants : 4,
    ticketing_deadline: (item.ticketing_deadline as string) || undefined,
    guide_tip: (item.guide_tip as string) || undefined,
    single_supplement: (item.single_supplement as string) || undefined,
    small_group_surcharge: (item.small_group_surcharge as string) || undefined,
    price: Array.isArray(item.price_tiers) && (item.price_tiers as PriceTier[]).length > 0
      ? ((item.price_tiers as PriceTier[]).find(t => t.adult_price)?.adult_price ?? undefined)
      : undefined,
    price_tiers: Array.isArray(item.price_tiers)
      ? filterTiersByDepartureDays(
          expandPriceTiersDateRanges(item.price_tiers as PriceTier[], item.departure_days as string | undefined),
          item.departure_days as string | undefined,
        )
      : [],
    price_list: Array.isArray(item.price_list) ? (item.price_list as PriceListItem[]) : [],
    surcharges: Array.isArray(item.surcharges) ? (item.surcharges as Surcharge[]) : [],
    excluded_dates: Array.isArray(item.excluded_dates) ? (item.excluded_dates as string[]) : [],
    inclusions: Array.isArray(item.inclusions) ? (item.inclusions as string[]).filter(Boolean) : [],
    excludes: Array.isArray(item.excludes) ? (item.excludes as string[]).filter(Boolean) : [],
    optional_tours: enrichOptionalToursRegion(item.optional_tours),
    itinerary: Array.isArray(item.itinerary) ? (item.itinerary as string[]).filter(Boolean) : [],
    accommodations: Array.isArray(item.accommodations) ? (item.accommodations as string[]).filter(Boolean) : [],
    specialNotes: (item.specialNotes as string) || undefined,
    notices_parsed: Array.isArray(item.notices_parsed) ? (item.notices_parsed as string[]).filter(Boolean) : [],
    cancellation_policy: Array.isArray(item.cancellation_policy) ? (item.cancellation_policy as CancellationPolicy[]) : [],
    category_attrs: (item.category_attrs as Record<string, unknown>) || {},
    land_operator: (item.land_operator as string) || undefined,
    product_tags: Array.isArray(item.product_tags) ? (item.product_tags as string[]).filter(Boolean) : [],
    product_highlights: Array.isArray(item.product_highlights) ? (item.product_highlights as string[]).filter(Boolean) : [],
    product_summary: (item.product_summary as string) || undefined,
    theme_tags: Array.isArray(item.theme_tags) ? (item.theme_tags as string[]).filter(Boolean) : [],
    selling_points: (item.selling_points && typeof item.selling_points === 'object')
      ? (item.selling_points as ExtractedData['selling_points']) : null,
    flight_info: (item.flight_info && typeof item.flight_info === 'object')
      ? (item.flight_info as ExtractedData['flight_info']) : null,
  };
}

export async function extractMultipleProducts(
  rawText: string,
  base64Image?: string,
  mimeType?: string,
  options?: ParseOptions,
): Promise<MultiProductResult[]> {
  const apiKey = getSecret('GOOGLE_AI_API_KEY');
  if (!apiKey) return [];

  // ── P1-4 (2026-05-24): 중요도 기반 텍스트 선택 ──
  // 앞 30000자 + 가격 키워드 밀집 구간 포함 (가격 정보가 뒤쪽에 있을 때)
  const truncatedText = smartTruncateWithPricePriority(rawText, 30000);
  // Product-boundary detection must use the full raw text. Long supplier catalogs
  // often place the itinerary/grade blocks after large price tables; truncating
  // before splitting can collapse an 8-product catalog into one blocked upload.
  const splitSourceText = rawText;


  // Reflexion + 지역 컨텍스트 prefix
  const reflectionBlock = options?.reflections?.length
    ? `## 과거 정정 사례 (반드시 반영)\n${options.reflections.map(r =>
        `- [${r.field_path}] "${r.before_value}" → "${r.after_value}": ${r.reflection ?? '정정 사항'}`
      ).join('\n')}\n\n`
    : '';
  const regionBlock = options?.regionContext ? options.regionContext + '\n\n' : '';
  const contextPrefix = regionBlock + reflectionBlock;

  try {
    // ── Phase 1: 기본 정보 + 가격 추출 ──────────────────────────────────────
    // DeepSeek primary (prefix 캐싱 → 2번째 파일부터 input 90% 할인)
    // 이미지/Vision 경로는 Gemini 유지 (Vision 필수)
    const MULTI_PRODUCT_SCHEMA: ResponseSchema = {
      type: SchemaType.ARRAY,
      items: EXTRACTED_DATA_SCHEMA,
    };
    // ── Phase 2 Gemini 재시도용 Itinerary 스키마 (P1-3 2026-05-24) ──
    const ITINERARY_RESPONSE_SCHEMA: ResponseSchema = itinSchema;
    const phase1Prompt = injectToday(contextPrefix + MULTI_PRODUCT_PHASE1_PROMPT);
    const singleProductPhase1Prompt = injectToday(`${contextPrefix}${MULTI_PRODUCT_PHASE1_PROMPT}\n\n★★★ 이 사용자 메시지 구간에는 여행상품이 정확히 1개만 있습니다. JSON 배열 길이는 반드시 1이어야 합니다. ★★★\n`);

    const route = classifyUploadDocumentComplexity(truncatedText);
    // 2026-05-19 박제 (P1-B): splitCatalogSmart 통합.
    //   regex 가 매칭 0/1건이면 LLM (Gemini Flash, ~$0.0001) 으로 boundary 결정.
    //   image upload 는 LLM split 우회 (base64 일 때 텍스트 분리 의미 없음).
    let sharedPrefix = '';
    let sections: string[] = [];
    let splitSource: 'regex' | 'llm-fallback' | 'single' = 'single';
    if (base64Image) {
      const r = splitCatalogByItineraryHeaders(splitSourceText);
      sharedPrefix = r.sharedPrefix;
      sections = r.sections;
      splitSource = sections.length >= 2 ? 'regex' : 'single';
    } else {
      const r = await splitCatalogSmart(splitSourceText);
      sharedPrefix = r.sharedPrefix;
      sections = r.sections;
      splitSource = r.source;
      if (splitSource === 'llm-fallback') {
        console.log('[Parser] LLM split fallback → 헤더 ' + sections.length + '개 감지 (regex miss)');
      }
    }
    // 2026-05-14 박제: tier 무관, 헤더가 2개 이상이면 무조건 Map-Reduce.
    //   - DeepSeek system prompt 가 같아 prefix cache 90% 적중 → 비용 절감
    //   - 청크별 maxTokens 6000 으로 응답 잘림 위험 ↓ → 정확도 ↑
    //   - 한 청크 실패해도 나머지는 살아남음 (graceful degradation)
    //   - 회귀 사례: tier='simple' 로 잘못 분류되어 monolithic 64초 빈 배열로 빠지던 베트남 [VJ]/[VN] 케이스
    const mapReduceOn = !base64Image
      && process.env.UPLOAD_MAP_REDUCE !== '0'
      && sections.length >= 2;
    if (mapReduceOn && route.tier !== 'catalog' && route.tier !== 'risky') {
      console.log('[Parser] tier=' + route.tier + ' 이지만 헤더 ' + sections.length + '개 → Map-Reduce 강제 (정확도+캐시 우선)');
    }

    let phase1Parsed: Record<string, unknown>[] | null = null;
    let phase1Usage: { provider: 'deepseek' | 'gemini'; input: number; output: number; cache_hit: number; elapsed_ms?: number } | undefined;
    let phase1Raw = '';

    // ── Map-Reduce: 블록별 Phase 1 (카탈로그·복수 일정표) ─────────────────
    if (mapReduceOn) {
      console.log('[Parser] Map-Reduce Phase 1 — 블록', sections.length, '개, 라우트:', route.tier, `(항공프리픽스 ${route.distinctFlightPrefixes})`);
      const CHUNK_CONCURRENCY = Math.min(
        6,
        Math.max(1, parseInt(process.env.UPLOAD_PHASE1_CONCURRENCY ?? '4', 10) || 4),
      );
      let aggIn = 0;
      let aggOut = 0;
      let aggCache = 0;
      let usedGemini = false;

      const tryMonolithicPhase1 = async (): Promise<Record<string, unknown>[] | null> => {
        if (!apiKey) return null;
        try {
          const recoverRaw = await callGeminiText(apiKey, truncatedText, phase1Prompt, MULTI_PRODUCT_SCHEMA, 16384);
          return safeParseJsonArray(recoverRaw);
        } catch {
          return null;
        }
      };

      const runChunk = async (section: string, geminiOnly: boolean): Promise<Record<string, unknown> | null> => {
        const userChunk = (sharedPrefix ? `${sharedPrefix}\n\n---\n\n` : '') + section;
        const slice = userChunk.slice(0, 30000);
        let raw: string | undefined;
        if (!geminiOnly) {
          const dsResult = await lazyLlmCall({
            task: 'parse_travel_doc',
            systemPrompt: singleProductPhase1Prompt,
            userPrompt: slice,
            maxTokens: 6000,
            temperature: 0.1,
            enableCaching: true,
          });
          if (dsResult.success && dsResult.rawText) {
            raw = dsResult.rawText;
            aggIn += dsResult._usage?.input ?? 0;
            aggOut += dsResult._usage?.output ?? 0;
            aggCache += dsResult._usage?.cache_hit ?? 0;
            if (dsResult.fallbackUsed) usedGemini = true;
          } else if (apiKey) {
            raw = await callGeminiText(apiKey, slice, singleProductPhase1Prompt, MULTI_PRODUCT_SCHEMA, estimateRequiredOutputTokens(slice));
            usedGemini = true;
          }
        } else if (apiKey) {
          raw = await callGeminiText(apiKey, slice, singleProductPhase1Prompt, MULTI_PRODUCT_SCHEMA, 8192);
          usedGemini = true;
        }
        if (!raw) return null;
        let arr = safeParseJsonArray(raw);
        if ((!arr || arr.length === 0) && apiKey) {
          raw = await callGeminiText(apiKey, slice, singleProductPhase1Prompt, MULTI_PRODUCT_SCHEMA, 8192);
          usedGemini = true;
          arr = safeParseJsonArray(raw);
        }
        if (!arr?.length) return null;
        if (arr.length > 1) {
          console.warn('[Parser] Map-Reduce 청크가 복수 객체 반환 — 첫 항목만 사용');
        }
        return arr[0] as Record<string, unknown>;
      };

      const results: (Record<string, unknown> | null)[] = new Array(sections.length).fill(null);

      for (let i = 0; i < sections.length; i += CHUNK_CONCURRENCY) {
        const batch = sections.slice(i, i + CHUNK_CONCURRENCY);
        await Promise.all(
          batch.map(async (section, j) => {
            const idx = i + j;
            results[idx] = await runChunk(section, false);
          }),
        );
      }

      for (let idx = 0; idx < sections.length; idx++) {
        if (results[idx]) continue;
        console.warn(`[Parser] Map-Reduce 청크 ${idx + 1}/${sections.length} 재시도 (Gemini 전용)`);
        results[idx] = await runChunk(sections[idx], true);
      }

      const partial = results.filter((x): x is Record<string, unknown> => x != null);
      const allChunksOk = results.every(x => x != null);

      let phase1Candidate: Record<string, unknown>[] | null = null;
      if (allChunksOk) {
        phase1Candidate = results as Record<string, unknown>[];
      } else if (usedGemini) {
        // ── 이미 Gemini 청크 재시도를 했다면 중복 호출 방지 (P0-1 2026-05-24) ──
        console.warn('[Parser] Map-Reduce 일부 실패 — 이미 Gemini 청크 재시도 완료, partial로 fallback');
        if (partial.length >= 2) phase1Candidate = partial;
      } else {
        console.warn('[Parser] Map-Reduce 일부 실패 — 전체 문서 Phase 1 복구 시도');
        const recovered = await tryMonolithicPhase1();
        if (recovered && recovered.length >= sections.length) {
          phase1Candidate = recovered;
          usedGemini = true;
        } else if (recovered && recovered.length > partial.length) {
          phase1Candidate = recovered;
          usedGemini = true;
        } else if (partial.length >= 2) {
          phase1Candidate = partial;
        }
      }

      if (phase1Candidate && phase1Candidate.length >= 2) {
        phase1Parsed = phase1Candidate;
        phase1Usage = {
          provider: usedGemini ? 'gemini' : 'deepseek',
          input: aggIn,
          output: aggOut,
          cache_hit: aggCache,
        };
        const judge = await judgeCatalogProductCountConsistency(truncatedText, phase1Parsed.length);
        if (!judge.skipped && !judge.consistent) {
          console.warn('[Parser] 카탈로그 개수 Judge: 원문 헤더 수와 불일치 가능');
          if (apiKey && process.env.UPLOAD_JUDGE_REPAIR !== '0') {
            const repaired = await tryMonolithicPhase1();
            if (repaired && repaired.length > phase1Parsed.length) {
              console.log('[Parser] Judge 불일치 — 전체 문서 재파싱으로 상품 수 보정:', repaired.length);
              phase1Parsed = repaired;
              phase1Usage = { provider: 'gemini', input: 0, output: 0, cache_hit: 0 };
            }
          } else {
            console.warn('[Parser] 수동 검토 권장 (UPLOAD_JUDGE_REPAIR=0 이면 자동 보정 생략)');
          }
        }
      } else {
        console.warn('[Parser] Map-Reduce Phase 1 — 유효 블록 < 2, 단일 경로로 폴백');
        phase1Parsed = null;
      }
    }

    if (!phase1Parsed) {
      console.log('[Parser] Phase 1 단일 경로: 기본 정보 + 가격 추출 (DeepSeek primary)');
      if (base64Image && mimeType) {
        // 이미지: Vision 필수 → Gemini 유지
        phase1Raw = await callGeminiVision(apiKey, base64Image, mimeType, phase1Prompt, MULTI_PRODUCT_SCHEMA);
        phase1Usage = { provider: 'gemini', input: 0, output: 0, cache_hit: 0 };
      } else {
        // 텍스트: DeepSeek primary (prefix 캐싱), Gemini fallback
        const dsResult = await lazyLlmCall({
          task: 'parse_travel_doc',
          systemPrompt: phase1Prompt,
          userPrompt: truncatedText,
          maxTokens: 8000,
          temperature: 0.1,
          enableCaching: true,
        });
        if (dsResult.success && dsResult.rawText) {
          phase1Raw = dsResult.rawText;
          phase1Usage = {
            provider: dsResult.fallbackUsed ? 'gemini' : 'deepseek',
            input:     dsResult._usage?.input ?? 0,
            output:    dsResult._usage?.output ?? 0,
            cache_hit: dsResult._usage?.cache_hit ?? 0,
            elapsed_ms: dsResult.elapsed_ms,
          };
          const hit = dsResult._usage?.cache_hit ?? 0;
          console.log(`[Parser] Phase 1 DeepSeek 완료 (${dsResult.fallbackUsed ? 'fallback→Gemini' : 'primary'}) — 캐시 히트: ${hit} 토큰, 소요: ${dsResult.elapsed_ms}ms`);
        } else {
          // DeepSeek 완전 실패 → Gemini fallback
          const dsFailReason = dsResult.errors?.join(' | ') ?? '응답 없음';
          console.warn(`[Parser] DeepSeek Phase 1 실패 (${dsFailReason.includes('DEEPSEEK_API_KEY') ? 'API키 미설정' : dsFailReason.slice(0, 80)}), Gemini fallback`);
          const fallbackTokens = estimateRequiredOutputTokens(truncatedText);
          phase1Raw = await callGeminiText(apiKey, truncatedText, phase1Prompt, MULTI_PRODUCT_SCHEMA, fallbackTokens);
          phase1Usage = { provider: 'gemini', input: 0, output: 0, cache_hit: 0 };
        }
      }

      phase1Parsed = safeParseJsonArray(phase1Raw);
      // DeepSeek/Gemini 텍스트가 success여도 본문이 깨진 JSON인 경우가 많음 → 구조화 출력으로 1회 재시도
      if ((!phase1Parsed || phase1Parsed.length === 0) && apiKey && !base64Image) {
        // 디버그 가시성: DeepSeek/Gemini 가 무엇을 뱉었는지 확인 (2026-05-14 박제)
        const previewLen = phase1Raw?.length ?? 0;
        const head = (phase1Raw ?? '').slice(0, 200).replace(/\s+/g, ' ');
        const tail = previewLen > 300 ? (phase1Raw ?? '').slice(-100).replace(/\s+/g, ' ') : '';
        console.warn(`[Parser] Phase 1 JSON 비정상/빈 배열 — Gemini structured output 재시도 (raw ${previewLen}자, head="${head}"${tail ? `, tail="${tail}"` : ''})`);
        try {
          const retryTokens = estimateRequiredOutputTokens(truncatedText);
          phase1Raw = await callGeminiText(apiKey, truncatedText, phase1Prompt, MULTI_PRODUCT_SCHEMA, retryTokens);
          phase1Parsed = safeParseJsonArray(phase1Raw);
          phase1Usage = { provider: 'gemini', input: 0, output: 0, cache_hit: 0 };
          if (!phase1Parsed || phase1Parsed.length === 0) {
            const retryLen = phase1Raw?.length ?? 0;
            console.warn(`[Parser] Phase 1 Gemini 재시도도 실패 (raw ${retryLen}자, head="${(phase1Raw ?? '').slice(0, 200).replace(/\s+/g, ' ')}")`);
          }
        } catch (e) {
          console.warn('[Parser] Gemini structured Phase 1 재시도 실패:', e instanceof Error ? e.message : e);
        }
      }
    }
    if (!phase1Parsed || phase1Parsed.length === 0) {
      console.warn('[Parser] Phase 1 파싱 실패 — fallback');
      return [];
    }

    // 2026-05-19 박제 (P1-A): 단일 상품 경로에서도 judge 호출.
    //   사장님 5 카탈로그 사고 패턴: sections=1 로 처리됐는데 사장님 모르게 1상품 INSERT.
    //   regex 가 매칭 못 잡으면 mapReduceOn=false → judge 호출 안 됨 → silent fallback.
    //   판단 기준: phase1Parsed.length === 1 + 원문 길이 >= 3000자 (충분히 카탈로그 의심)
    //   → judge LLM 이 "진짜 1개?" 검증 → 불일치 시 Gemini structured 재파싱.
    //   비용: ~$0.0001/카탈로그. mapReduceOn 분기와 동일한 자동 보정 패턴.
    if (
      phase1Parsed.length === 1
      && !mapReduceOn
      && truncatedText.length >= 3000
      && !base64Image
      && process.env.UPLOAD_JUDGE_SINGLE !== '0'
    ) {
      try {
        const judge = await judgeCatalogProductCountConsistency(truncatedText, 1);
        if (!judge.skipped && !judge.consistent) {
          console.warn(`[Parser] P1-A judge: 단일상품으로 처리됐으나 원문에 진짜 여러 상품 의심 (reason=${judge.reason ?? 'mismatch'})`);
          if (apiKey && process.env.UPLOAD_JUDGE_REPAIR !== '0') {
            try {
              const retryTokens = estimateRequiredOutputTokens(truncatedText);
              const repairedRaw = await callGeminiText(apiKey, truncatedText, phase1Prompt, MULTI_PRODUCT_SCHEMA, retryTokens);
              const repaired = safeParseJsonArray(repairedRaw);
              if (repaired && repaired.length > 1) {
                console.log('[Parser] P1-A judge 불일치 보정: 단일 →', repaired.length, '개 상품');
                phase1Parsed = repaired;
                phase1Usage = { provider: 'gemini', input: 0, output: 0, cache_hit: 0 };
              } else {
                console.warn('[Parser] P1-A judge 보정 시도했으나 여전히 1개 — judge false positive 가능');
              }
            } catch (e) {
              console.warn('[Parser] P1-A judge 보정 호출 실패:', e instanceof Error ? e.message : e);
            }
          }
        }
      } catch (e) {
        console.warn('[Parser] P1-A judge 호출 실패(무시):', e instanceof Error ? e.message : e);
      }
    }

    console.log('[Parser] Phase 1 완료 —', phase1Parsed.length, '개 상품', phase1Usage ? `(input:${phase1Usage.input} out:${phase1Usage.output} cache:${phase1Usage.cache_hit})` : '');

    // ── Phase 2: 각 상품별 일정표 병렬 추출 (텍스트=DeepSeek, 이미지=Gemini Vision) ──
    console.log('[Parser] Phase 2 시작: 일정표 병렬 추출 (텍스트: DeepSeek, 이미지: Gemini Vision)');
    let phase2Input = 0;
    let phase2Output = 0;
    let phase2CacheHit = 0;
    let phase2ProviderFinal: 'deepseek' | 'gemini' = base64Image ? 'gemini' : 'deepseek';

    const productSectionTexts = phase1Parsed.map((item, idx) =>
      extractProductRawTextSection(
        rawText,
        (item.title as string) || undefined,
        idx,
        phase1Parsed.length,
      ),
    );

    const phase2Promises = phase1Parsed.map(async (item, idx) => {
      const title = (item.title as string) || '상품명 미상';
      const sectionText = productSectionTexts[idx].slice(0, 30000);
      const prompt = injectToday(MULTI_PRODUCT_PHASE2_PROMPT.replace(/\{\{PRODUCT_TITLE\}\}/g, title));
      try {
        let itinRaw: string;
        /** DeepSeek 실패 직후 이미 Gemini로 본문을 받았으면 JSON 재시도 블록 스킵 (중복 호출 방지) */
        let alreadyUsedGeminiText = false;
        if (base64Image && mimeType) {
          // 이미지: Vision 필수 → Gemini 유지
          const tracked = await callGeminiVisionTracked(apiKey, base64Image, mimeType, prompt);
          itinRaw = tracked.text; phase2Input += tracked.input; phase2Output += tracked.output;
        } else {
          // 텍스트: DeepSeek primary — 실패·JSON깨짐 시 Phase 1과 동일하게 Gemini 폴백
          const dsResult = await lazyLlmCall({
            task: 'parse_travel_doc',
            systemPrompt: '여행 일정표를 정확히 JSON으로 추출하세요. 원문 텍스트를 1글자도 변경하지 마세요.',
            userPrompt: `${prompt}\n\n---\n\n${sectionText}`,
            maxTokens: 8192,
            temperature: 0.1,
            enableCaching: true,
          });
          if (dsResult.success && dsResult.rawText) {
            itinRaw = dsResult.rawText;
            phase2Input += dsResult._usage?.input ?? 0;
            phase2Output += dsResult._usage?.output ?? 0;
            phase2CacheHit += dsResult._usage?.cache_hit ?? 0;
          } else if (apiKey) {
            console.warn(`[Parser] Phase 2 DeepSeek 실패 (${title}) — Gemini fallback`);
            const tracked = await callGeminiTextTracked(apiKey, sectionText, prompt, estimateRequiredOutputTokens(sectionText));
            itinRaw = tracked.text;
            phase2Input += tracked.input;
            phase2Output += tracked.output;
            phase2ProviderFinal = 'gemini';
            alreadyUsedGeminiText = true;
          } else {
            console.warn(`[Parser] Phase 2 DeepSeek 실패 (${title}) — GOOGLE_AI 없어 일정표 스킵`);
            return null;
          }
        }
        let parsed = safeParseJsonObject(itinRaw);
        // 텍스트 모드: DeepSeek 출력이 잘리거나 비 JSON이면 Gemini로 1회 재시도 (P1-3: response_schema 적용)
        if (!parsed && !base64Image && apiKey && !alreadyUsedGeminiText) {
          console.warn(`[Parser] Phase 2 JSON 파싱 실패 (${title}) — Gemini 재시도 (response_schema)`);
          try {
            const tracked = await callGeminiTextTracked(apiKey, sectionText, prompt, estimateRequiredOutputTokens(sectionText), ITINERARY_RESPONSE_SCHEMA);
            itinRaw = tracked.text;
            phase2Input += tracked.input;
            phase2Output += tracked.output;
            phase2ProviderFinal = 'gemini';
            parsed = safeParseJsonObject(itinRaw);
          } catch {
            /* noop */
          }
        }
        if (parsed) {
          const itin = parsed as unknown as TravelItinerary;
          if (itin.meta) itin.meta.brand = '여소남';
          return itin;
        }
        return null;
      } catch (err) {
        console.warn(`[Parser] Phase 2 일정표 추출 실패 (${title}):`, err instanceof Error ? err.message : err);
        return null;
      }
    });

    const itineraries = await Promise.all(phase2Promises);
    console.log(`[Parser] Phase 2 완료 — 일정표 ${itineraries.filter(Boolean).length}개 성공 (${phase2ProviderFinal} in:${phase2Input} out:${phase2Output} cache:${phase2CacheHit})`);

    // ── 결합: Phase 1 기본정보 + Phase 2 일정표 ──
    const products = phase1Parsed.map((item, idx) => ({
      extractedData: phase1ItemToExtractedData(item, productSectionTexts[idx]),
      itineraryData: itineraries[idx] ?? null,
      sectionRawText: productSectionTexts[idx],
    }));
    // phase1Usage + phase2 토큰을 첫 번째 product에 숨겨서 parseDocument로 전달
    if (products.length > 0 && (phase1Usage || phase2Input > 0)) {
      const mergedUsage = {
        ...(phase1Usage ?? { provider: 'deepseek' as const, input: 0, output: 0, cache_hit: 0 }),
        phase2Provider: phase2ProviderFinal,
        phase2Input,
        phase2Output,
        phase2CacheHit,
      };
      (products[0] as MultiProductResult & { _phase1Usage?: typeof mergedUsage })._phase1Usage = mergedUsage;
    }
    return products;
  } catch (err) {
    console.warn('[Parser] 복수 상품 추출 실패:', err instanceof Error ? err.message : err);
    return [];
  }
}

// ─── 메인 파싱 함수 ─────────────────────────────────────────

export async function parseDocument(buffer: Buffer, filename: string, options?: ParseOptions): Promise<ParsedDocument> {
  const ext = filename.split('.').pop()?.toLowerCase();
  let fileType: 'pdf' | 'image' | 'hwp' | 'hwpx' = 'pdf';

  try {
    if (ext === 'jpg' || ext === 'jpeg' || ext === 'png') {
      fileType = 'image';
      const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
      const base64 = buffer.toString('base64');
      // 두 추출을 병렬 실행
      const [imageResult, itineraryData] = await Promise.all([
        parseImage(buffer, mimeType),
        extractItineraryData('', base64, mimeType),
      ]);
      return {
        filename, fileType,
        rawText: imageResult.rawText,
        extractedData: imageResult.extractedData,
        itineraryData,
        parsedAt: new Date(),
        confidence: calculateConfidence(imageResult.extractedData),
      };
    }

    let rawText = '';
    if (ext === 'txt') {
      // 텍스트 직접 입력 모드: buffer가 이미 텍스트
      fileType = 'pdf'; // 타입은 pdf로 통일 (내부 분류용)
      rawText = buffer.toString('utf-8');
    } else if (ext === 'pdf') {
      fileType = 'pdf';
      rawText = await parsePDF(buffer);
    } else if (ext === 'hwp') {
      fileType = 'hwp';
      rawText = await parseHWP(buffer, filename);
    } else if (ext === 'hwpx') {
      fileType = 'hwpx';
      rawText = await parseHWPX(buffer, filename);
    } else {
      throw new Error(`지원하지 않는 파일 형식: ${ext}`);
    }

    if (!rawText) throw new Error('파일에서 텍스트를 추출할 수 없습니다.');

    // 복수 상품 통합 추출 (DeepSeek primary + Gemini fallback)
    const multiProducts = await extractMultipleProducts(rawText, undefined, undefined, options);
    // Phase 1 토큰 사용량 수집
    const phase1Usage = multiProducts.length > 0
      ? (multiProducts[0] as MultiProductResult & { _phase1Usage?: ParsedDocument['_tokenUsage'] })._phase1Usage
      : undefined;

    if (multiProducts.length > 1) {
      // 복수 상품: 첫 번째를 대표 extractedData로, 전체를 multiProducts에 담아 반환
      console.log('[Parser] 복수 상품 감지:', multiProducts.length, '개');
      return {
        filename, fileType, rawText,
        extractedData: multiProducts[0].extractedData,
        itineraryData: multiProducts[0].itineraryData,
        multiProducts,
        parsedAt: new Date(),
        confidence: calculateConfidence(multiProducts[0].extractedData),
        _tokenUsage: phase1Usage,
      };
    }

    // 단일 상품: 기존 방식 유지 (multiProducts가 0개면 AI fallback)
    let extractedData: ExtractedData;
    let itineraryData: TravelItinerary | null = null;
    if (multiProducts.length === 1) {
      extractedData = multiProducts[0].extractedData;
      itineraryData = multiProducts[0].itineraryData;
    } else {
      // AI 실패 시 기존 fallback
      [extractedData, itineraryData] = await Promise.all([
        parseTextWithAI(rawText, options),
        extractItineraryData(rawText),
      ]);
    }

    return {
      filename, fileType, rawText,
      extractedData,
      itineraryData,
      parsedAt: new Date(),
      confidence: calculateConfidence(extractedData),
      _tokenUsage: phase1Usage,
    };
  } catch (error) {
    throw new Error(`문서 파싱 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
  }
}

// ─── Step 1: 문서 분류 (저비용 사전 분류) ─────────────────────

export interface ClassificationResult {
  /** 상품 개수 추정 (1~N) */
  productCount: number;
  /** 여행 문서 여부 */
  isTravel: boolean;
  /** 문서 유형 */
  documentType: 'package' | 'flyer' | 'itinerary' | 'unknown';
  /** 초기 추정 신뢰도 (0~1) */
  estimatedConfidence: number;
}

const CLASSIFY_PROMPT = `이 문서의 앞부분을 보고 아래 JSON만 반환하세요. 다른 텍스트 없이 JSON만.

{
  "productCount": 상품 개수 추정 숫자 (1~10),
  "isTravel": true 또는 false (여행 관련 문서 여부),
  "documentType": "package" 또는 "flyer" 또는 "itinerary" 또는 "unknown",
  "estimatedConfidence": 0~1 사이 숫자 (파싱 가능할 것 같은 신뢰도)
}

- productCount: "2박3일 실속", "3박4일 품격" 처럼 별개 상품이면 2, 단일 상품이면 1
- isTravel: 여행사/투어/패키지 문서이면 true, 기타이면 false
- documentType: 가격표+일정 포함 패키지면 "package", 가격표만 있으면 "flyer", 일정표만이면 "itinerary"`;

/**
 * 문서 사전 분류 — 첫 2,000자만 사용하여 저비용으로 구조 파악.
 * API 키 미설정 또는 실패 시 안전한 기본값 반환.
 */
export async function classifyDocument(rawText: string): Promise<ClassificationResult> {
  const DEFAULT: ClassificationResult = {
    productCount: 1, isTravel: true, documentType: 'package', estimatedConfidence: 0.7,
  };

  // 정규식 사전 분류 — AI 실패해도 여행 문서 감지
  const travelKeywords = ['출발', '도착', '호텔', '숙박', '항공', '일정', '포함', '불포함',
    '패키지', '투어', '여행', '관광', '가이드', '공항', '비자', '여권', '인솔', '미팅',
    '석식', '중식', '조식', '마사지', '쇼핑', '선택관광', '자유시간', '케이블카',
    '노팁', '노옵션', '노쇼핑', '박', '일', '성인', '아동', '싱글차지', '유류할증'];
  const matchCount = travelKeywords.filter(kw => rawText.includes(kw)).length;
  const regexIsTravel = matchCount >= 3;

  if (regexIsTravel && !rawText.trim()) {
    return { ...DEFAULT, estimatedConfidence: 0.5 };
  }

  const apiKey = getSecret('GOOGLE_AI_API_KEY');
  if (!apiKey) return regexIsTravel ? DEFAULT : { ...DEFAULT, isTravel: false, estimatedConfidence: 0.3 };

  try {
    const snippet = rawText.slice(0, 2000);
    const raw = await callGeminiText(apiKey, snippet, CLASSIFY_PROMPT);
    const jsonStr = raw
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(jsonStr) as Partial<ClassificationResult>;

    const aiResult = {
      productCount:        typeof parsed.productCount === 'number' ? Math.max(1, parsed.productCount) : 1,
      isTravel:            typeof parsed.isTravel === 'boolean' ? parsed.isTravel : true,
      documentType:        (['package','flyer','itinerary','unknown'] as const).includes(parsed.documentType as never)
                             ? (parsed.documentType as ClassificationResult['documentType'])
                             : 'package',
      estimatedConfidence: typeof parsed.estimatedConfidence === 'number'
                             ? Math.min(1, Math.max(0, parsed.estimatedConfidence))
                             : 0.7,
    };

    // 정규식이 여행 문서라고 판단했는데 AI가 아니라고 하면 → 정규식 우선
    if (regexIsTravel && !aiResult.isTravel) {
      console.log('[Parser] AI가 여행문서 아니라고 했지만 정규식이 감지 — 여행문서로 보정');
      aiResult.isTravel = true;
      aiResult.estimatedConfidence = Math.max(aiResult.estimatedConfidence, 0.5);
      if (aiResult.documentType === 'unknown') aiResult.documentType = 'package';
    }

    return aiResult;
  } catch (err) {
    console.warn('[Parser] classifyDocument 실패 (정규식 fallback):', err instanceof Error ? err.message : err);
    return regexIsTravel ? DEFAULT : { ...DEFAULT, isTravel: false, estimatedConfidence: 0.3 };
  }
}

// ─── 신뢰도 계산 V1 (legacy — backward compat) ──────────────

/**
 * @deprecated 2026-05-13 — V2 사용. 필드 채움률만 보는 산식으로 실제 결함을 못 잡음.
 * 호출처가 옵션 인자 없이 부르는 곳을 위해 유지. 신규 코드는 V2.
 */
export function calculateConfidence(data: ExtractedData): number {
  let score = 0;
  if (data.title) score += 15;
  if (data.destination) score += 15;
  if (data.duration) score += 10;
  if (data.price_tiers && data.price_tiers.length > 0) score += 30;
  else if (data.price) score += 15;
  if (data.itinerary && data.itinerary.length > 0) score += 15;
  if (data.inclusions && data.inclusions.length > 0) score += 10;
  if (data.product_type) score += 5;
  return Math.min(score / 100, 1);
}

// ─── 신뢰도 계산 V2 — 3축 (채움률 30% + 정합성 40% + 누출안전 30%) ──────────
//
// 박제 사유 (2026-05-13): V1 가중치는 단순 필드 채움률만 봐서 진짜 결함 (연도 오류,
// 커미션 누출, 항공편 깨짐) 4건이 confidence 0.85로 통과. V2 는 세 축을 곱해
// 한 축이라도 망가지면 점수가 결정적으로 떨어지게 박음.

export interface ValidationCheck {
  id: string;
  severity: 'critical' | 'high' | 'medium';
  passed: boolean;
  message: string;
}

export interface ConfidenceV2Result {
  confidence: number;             // 0~1
  fillScore: number;              // 0~1 — 필드 채움률
  crossValidationScore: number;   // 0~1 — 원문↔DB 정합성
  leakScore: number;              // 0~1 — leak severity (0=clean, 1=catastrophic)
  cleanScore: number;             // 1 - leakScore
  checks: ValidationCheck[];      // 어떤 룰이 통과/실패했는지 상세
  autoGate: 'auto_publish' | 'confirm_queue' | 'pending_review' | 'rejected';
}

interface XValidInput {
  itineraryData?: { days?: Array<{ schedule?: Array<{ type?: string }>; hotel?: { name?: string | null } }>; meta?: { airline?: string | null; flight_out?: string | null; flight_in?: string | null } };
  /** 매칭 통계 (enrichItineraryWithAttractionReferences 결과) — C41/C42 룰 평가용. 호출자가 enrichment 후 별도로 전달. */
  attractionStats?: {
    matchedCount: number;
    unmatchedCount: number;
    scheduleItemCount: number;
  };
}

/**
 * Cross-validation 룰 set — 원문↔DB 의미 정합성 체크.
 * 신규 룰은 한 줄로 push 만 하면 됨. ConfidenceV2 산식이 자동으로 점수에 반영.
 */
export function runCrossValidation(data: ExtractedData, xv: XValidInput = {}): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  const todayISO = new Date().toISOString().slice(0, 10);

  // C1 (critical): duration 과 itinerary days 길이 일치
  if (data.duration && xv.itineraryData?.days) {
    const dlen = xv.itineraryData.days.length;
    checks.push({
      id: 'C1_duration_days_match',
      severity: 'critical',
      passed: data.duration === dlen,
      message: `duration=${data.duration} vs itinerary.days.length=${dlen}`,
    });
  }

  // C2 (critical): 모든 price_tiers 출발일이 오늘 이후 ← 이번 사고 핵심
  if (data.price_tiers?.length) {
    let allFuture = true;
    let badDate: string | null = null;
    for (const t of data.price_tiers) {
      const dates: string[] = [
        ...(t.departure_dates ?? []),
        ...(t.date_range?.start ? [t.date_range.start] : []),
        ...(t.date_range?.end ? [t.date_range.end] : []),
      ].filter(Boolean);
      for (const d of dates) {
        if (d < todayISO) { allFuture = false; badDate = d; break; }
      }
      if (!allFuture) break;
    }
    checks.push({
      id: 'C2_dates_in_future',
      severity: 'critical',
      passed: allFuture,
      message: allFuture ? `모든 출발일 ${todayISO} 이후` : `과거 출발일 발견: ${badDate}`,
    });
  }

  // C3 (high): notices_parsed 4 타입(CRITICAL/PAYMENT/POLICY/INFO) 모두 존재
  if (data.notices_parsed && Array.isArray(data.notices_parsed)) {
    const types = new Set(
      (data.notices_parsed as unknown as Array<{ type?: string }>).map(n => n.type).filter((t): t is string => Boolean(t))
    );
    const required = ['CRITICAL', 'PAYMENT', 'POLICY', 'INFO'];
    const missing = required.filter(t => !types.has(t));
    checks.push({
      id: 'C3_notices_four_types',
      severity: 'high',
      passed: missing.length === 0,
      message: missing.length ? `누락 타입: ${missing.join(', ')}` : '4타입 모두 채움',
    });
  }

  // C4 (high): 가는편/오는편 항공편 모두 채움
  const flightOut = xv.itineraryData?.meta?.flight_out;
  const flightIn  = xv.itineraryData?.meta?.flight_in;
  checks.push({
    id: 'C4_flights_both_legs',
    severity: 'high',
    passed: Boolean(flightOut && flightIn),
    message: `flight_out=${flightOut ?? '∅'}, flight_in=${flightIn ?? '∅'}`,
  });

  // C5 (medium): min_participants 1~50 범위
  if (data.min_participants !== undefined && data.min_participants !== null) {
    const m = data.min_participants;
    checks.push({
      id: 'C5_min_participants_range',
      severity: 'medium',
      passed: m >= 1 && m <= 50,
      message: `min_participants=${m}`,
    });
  }

  // C6 (high): adult_price > 0
  if (data.price_tiers?.length) {
    const validPrices = data.price_tiers.every(t => (t.adult_price ?? 0) > 0);
    checks.push({
      id: 'C6_adult_price_positive',
      severity: 'high',
      passed: validPrices,
      message: validPrices ? '모든 tier adult_price > 0' : 'adult_price 0 또는 null 존재',
    });
  }

  // C7 (medium): inclusions 최소 2건 (정상 패키지면 항공+호텔 최소)
  checks.push({
    id: 'C7_inclusions_min',
    severity: 'medium',
    passed: (data.inclusions?.length ?? 0) >= 2,
    message: `inclusions.length=${data.inclusions?.length ?? 0}`,
  });

  // C8 (medium): 중간 일자에 호텔 존재 (DAY 1, 마지막 제외하고 hotel.name 있어야)
  if (xv.itineraryData?.days && xv.itineraryData.days.length >= 3) {
    const middle = xv.itineraryData.days.slice(1, -1);
    const allHaveHotel = middle.every(d => Boolean(d.hotel?.name));
    checks.push({
      id: 'C8_middle_days_hotel',
      severity: 'medium',
      passed: allHaveHotel,
      message: allHaveHotel ? '중간 일자 모두 호텔 있음' : '일부 중간 일자 호텔 누락',
    });
  }

  // C9 (high): DAY 1, 마지막 DAY 에 flight type schedule 존재
  if (xv.itineraryData?.days && xv.itineraryData.days.length >= 2) {
    const first = xv.itineraryData.days[0];
    const last = xv.itineraryData.days[xv.itineraryData.days.length - 1];
    const firstHasFlight = (first.schedule ?? []).some(s => s.type === 'flight');
    const lastHasFlight = (last.schedule ?? []).some(s => s.type === 'flight');
    checks.push({
      id: 'C9_first_last_day_flight',
      severity: 'high',
      passed: firstHasFlight && lastHasFlight,
      message: `DAY1 flight=${firstHasFlight}, DAYn flight=${lastHasFlight}`,
    });
  }

  // C10 (critical): airline 추출됨
  checks.push({
    id: 'C10_airline_extracted',
    severity: 'critical',
    passed: Boolean(data.airline ?? xv.itineraryData?.meta?.airline),
    message: `airline=${data.airline ?? xv.itineraryData?.meta?.airline ?? '∅'}`,
  });

  // C11 (critical): surcharges note 에 leak 패턴 매치 금지 — 2026-05-13 박제 (푸꾸옥 "투어비 9%" 사고)
  if (Array.isArray(data.surcharges) && data.surcharges.length > 0) {
    const leakRe = /(투어비|컴|커미션|마진)\s*\d{1,2}\s*%|원가\s*[:：]?\s*[\d,]+/;
    const dirty = data.surcharges.find(s => {
      const note = (s as { note?: string }).note;
      return typeof note === 'string' && leakRe.test(note);
    });
    checks.push({
      id: 'C11_surcharges_no_commission',
      severity: 'critical',
      passed: !dirty,
      message: dirty ? `surcharges 에 커미션/원가 패턴: "${(dirty as { note?: string }).note}"` : 'surcharges clean',
    });
  }

  // C12 (high): notices_parsed 가 객체 배열 형식 (문자열 배열 금지) — 2026-05-13 박제
  if (Array.isArray(data.notices_parsed) && data.notices_parsed.length > 0) {
    const firstItem = data.notices_parsed[0] as unknown;
    const isObjectArray = typeof firstItem === 'object' && firstItem !== null && 'type' in firstItem && 'text' in firstItem;
    checks.push({
      id: 'C12_notices_object_array',
      severity: 'high',
      passed: isObjectArray,
      message: isObjectArray ? '객체 배열 OK' : `문자열 배열 — LLM schema 오추론 (첫 항목: ${JSON.stringify(firstItem).slice(0,60)})`,
    });
  }

  // ── Phase 5-4 Programmatic Verifier — 결정적 룰 확장 (2026-05-13 박제) ──

  // C13 (high): destination 토큰이 itinerary regions 와 교집합
  if (data.destination && xv.itineraryData?.days) {
    const dests = data.destination.split(/[\/\s,·]/).map(s => s.trim()).filter(Boolean);
    const allRegions = new Set<string>();
    for (const d of xv.itineraryData.days) {
      for (const r of (d as { regions?: string[] }).regions ?? []) allRegions.add(r);
    }
    const intersect = dests.some(dt => Array.from(allRegions).some(r => r.includes(dt) || dt.includes(r)));
    checks.push({
      id: 'C13_destination_in_itinerary',
      severity: 'high',
      passed: intersect || allRegions.size === 0,
      message: intersect ? '교집합 OK' : `destination=${data.destination} ↔ regions=[${Array.from(allRegions).join(',')}] 매치 실패`,
    });
  }

  // C14 (medium): duration 5일 이상이면 최소 1개 식사 정보 (조/중/석 중 하나)
  if (data.duration && data.duration >= 3 && xv.itineraryData?.days) {
    const hasAnyMeal = xv.itineraryData.days.some(d => {
      const meals = (d as { meals?: Record<string, unknown> }).meals;
      return meals && (meals.breakfast || meals.lunch || meals.dinner);
    });
    checks.push({
      id: 'C14_has_meal_info',
      severity: 'medium',
      passed: hasAnyMeal,
      message: hasAnyMeal ? '식사 정보 OK' : '전 일정 식사 정보 없음 (조/중/석)',
    });
  }

  // C15 (medium): IATA 항공코드 형식 (2글자 + 숫자) — flight_out/flight_in
  const flightCodes = [
    xv.itineraryData?.meta?.flight_out,
    xv.itineraryData?.meta?.flight_in,
  ].filter((c): c is string => Boolean(c));
  if (flightCodes.length > 0) {
    const iataRe = /^[A-Z]{2}\s*\d{1,4}$/;
    const allValid = flightCodes.every(c => iataRe.test(c));
    checks.push({
      id: 'C15_iata_code_format',
      severity: 'medium',
      passed: allValid,
      message: allValid ? `${flightCodes.length}개 모두 IATA 형식` : `잘못된 형식: ${flightCodes.filter(c => !iataRe.test(c)).join(', ')}`,
    });
  }

  // C16 (high): 가격이 정상 범위 (1만원 ~ 5천만원)
  if (data.price_tiers?.length) {
    const prices = data.price_tiers.map(t => t.adult_price).filter((p): p is number => typeof p === 'number');
    const allInRange = prices.length > 0 && prices.every(p => p >= 10_000 && p <= 50_000_000);
    checks.push({
      id: 'C16_price_in_range',
      severity: 'high',
      passed: allInRange,
      message: allInRange ? `${prices.length}개 가격 정상 (${Math.min(...prices)}원~${Math.max(...prices)}원)` : '가격 범위 이상',
    });
  }

  // C17 (medium): inclusions 안에 "항공" 키워드 (정상 패키지 = 항공 포함)
  const incText = (data.inclusions ?? []).join(' ');
  checks.push({
    id: 'C17_inclusions_has_flight',
    severity: 'medium',
    passed: /항공|국제선|왕복/.test(incText),
    message: /항공|국제선|왕복/.test(incText) ? '항공 포함 명시 OK' : 'inclusions 에 항공 명시 누락',
  });

  // ── 2026-05-13 박제 — Phase 9 Programmatic Verifier 8 신규 룰 (C18~C25, LLM 토큰 0) ──

  // C18 (critical): 모든 출발일이 365일 이내 (너무 먼 미래는 LLM 오추론 의심)
  if (data.price_tiers?.length) {
    const maxFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const allDates: string[] = [];
    for (const t of data.price_tiers) {
      if (t.departure_dates) allDates.push(...t.departure_dates);
      if (t.date_range?.start) allDates.push(t.date_range.start);
      if (t.date_range?.end) allDates.push(t.date_range.end);
    }
    const badDate = allDates.find(d => d > maxFuture);
    checks.push({
      id: 'C18_dates_within_365d',
      severity: 'critical',
      passed: !badDate,
      message: badDate ? `1년 초과 미래 출발일: ${badDate}` : `모든 출발일 365일 이내`,
    });
  }

  // C19 (high): 가격 일관성 — 같은 tier 내 adult_price 들 ±50% 이내
  if (data.price_tiers && data.price_tiers.length >= 2) {
    const prices = data.price_tiers.map(t => t.adult_price).filter((p): p is number => typeof p === 'number' && p > 0);
    if (prices.length >= 2) {
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      const ratio = max / min;
      checks.push({
        id: 'C19_price_consistency',
        severity: 'high',
        passed: ratio <= 1.5,
        message: ratio <= 1.5 ? `가격 일관성 OK (${min}~${max})` : `tier 간 가격 차 ${ratio.toFixed(1)}배 (${min}~${max})`,
      });
    }
  }

  // C20 (high): 호텔 grade 정상 값 (1~5성 또는 null)
  if (xv.itineraryData?.days) {
    const hotelGrades = xv.itineraryData.days
      .map(d => (d as { hotel?: { grade?: string | null } }).hotel?.grade)
      .filter((g): g is string => typeof g === 'string' && g.trim() !== '');
    const validGradeRe = /^[1-5](?:성|star|준\d성)?$/i;
    const allValid = hotelGrades.every(g => validGradeRe.test(g.trim()));
    checks.push({
      id: 'C20_hotel_grade_valid',
      severity: 'high',
      passed: allValid || hotelGrades.length === 0,
      message: allValid ? `${hotelGrades.length}개 호텔 등급 정상` : `이상 등급: ${hotelGrades.filter(g => !validGradeRe.test(g.trim())).join(', ')}`,
    });
  }

  // C21 (medium): 식사 정보 ≥ duration - 1 (마지막 날 제외하면 매일 조식 정도는 있어야)
  if (data.duration && data.duration >= 3 && xv.itineraryData?.days) {
    const mealCount = xv.itineraryData.days.reduce((sum, d) => {
      const meals = (d as { meals?: Record<string, unknown> }).meals;
      if (!meals) return sum;
      return sum + (meals.breakfast ? 1 : 0) + (meals.lunch ? 1 : 0) + (meals.dinner ? 1 : 0);
    }, 0);
    checks.push({
      id: 'C21_meal_count_min',
      severity: 'medium',
      passed: mealCount >= (data.duration - 1),
      message: `식사 카운트 ${mealCount} (최소 ${data.duration - 1})`,
    });
  }

  // C22 (high): inclusions 단일 항목 최대 길이 200자 (너무 길면 LLM 이 합쳐 추출)
  if (data.inclusions?.length) {
    const tooLong = data.inclusions.find(s => s.length > 200);
    checks.push({
      id: 'C22_inclusion_item_length',
      severity: 'high',
      passed: !tooLong,
      message: tooLong ? `inclusions 항목 ${tooLong.length}자 초과 (${tooLong.slice(0,50)}...)` : '모든 inclusions 항목 길이 정상',
    });
  }

  // C23 (high): notices_parsed 각 text ≥ 20자 (너무 짧은 안내문은 의미 없음)
  if (Array.isArray(data.notices_parsed) && data.notices_parsed.length > 0) {
    const tooShort = (data.notices_parsed as unknown as Array<{ text?: string; type?: string }>).find(n => {
      const t = typeof n === 'object' ? n.text ?? '' : String(n);
      return t.length < 20;
    });
    checks.push({
      id: 'C23_notice_min_length',
      severity: 'high',
      passed: !tooShort,
      message: tooShort ? `notices 항목 짧음 (${(tooShort.text ?? '').length}자)` : 'notices 모두 20자+',
    });
  }

  // C24 (medium): 항공편 시간 형식 HH:MM 검증
  if (xv.itineraryData?.days) {
    const flightTimes: string[] = [];
    for (const d of xv.itineraryData.days) {
      for (const s of (d as { schedule?: Array<{ type?: string; time?: string | null }> }).schedule ?? []) {
        if (s.type === 'flight' && s.time) flightTimes.push(s.time);
      }
    }
    if (flightTimes.length > 0) {
      const timeRe = /^([01]?\d|2[0-3]):[0-5]\d$/;
      const allValid = flightTimes.every(t => timeRe.test(t));
      checks.push({
        id: 'C24_flight_time_format',
        severity: 'medium',
        passed: allValid,
        message: allValid ? `${flightTimes.length}개 시간 HH:MM` : `잘못된 형식: ${flightTimes.filter(t => !timeRe.test(t)).join(', ')}`,
      });
    }
  }

  // C25 (medium): 가격이 1,000원 단위로 끝남 (799,000 같은 패턴 — 1원 단위는 LLM 오추출 가능성)
  if (data.price_tiers?.length) {
    const prices = data.price_tiers.map(t => t.adult_price).filter((p): p is number => typeof p === 'number');
    const oddPrice = prices.find(p => p % 1000 !== 0);
    checks.push({
      id: 'C25_price_unit_1000',
      severity: 'medium',
      passed: !oddPrice,
      message: oddPrice ? `1000원 단위 아님: ${oddPrice}원` : `${prices.length}개 가격 모두 1000원 단위`,
    });
  }

  // ── 2026-05-13 박제 — Phase 9 Final Programmatic Verifier 7 신규 룰 (C26~C32) ──

  // C26 (critical): destination 한국어 도시명 (영어/숫자만 있으면 LLM 오추론)
  if (data.destination) {
    const hasKorean = /[가-힣]/.test(data.destination);
    checks.push({
      id: 'C26_destination_korean',
      severity: 'critical',
      passed: hasKorean,
      message: hasKorean ? '한국어 destination OK' : `한국어 누락: ${data.destination}`,
    });
  }

  // C27 (high): min_participants 합리적 (1~50, 일반적 4)
  if (data.min_participants !== null && data.min_participants !== undefined) {
    const m = data.min_participants;
    checks.push({
      id: 'C27_min_participants_reasonable',
      severity: 'high',
      passed: m >= 1 && m <= 50,
      message: `min_participants=${m} ${m >= 1 && m <= 50 ? 'OK' : '범위 초과'}`,
    });
  }

  // C28 (high): inclusions vs excludes 중복 차단 (같은 항목 양쪽에 있으면 안 됨)
  if (data.inclusions?.length && data.excludes?.length) {
    const incSet = new Set(data.inclusions.map(s => s.replace(/[▶•★·\s]/g, '').toLowerCase()));
    const dupExc = data.excludes.find(s => {
      const norm = s.replace(/[▶•★·\s]/g, '').toLowerCase();
      return incSet.has(norm);
    });
    checks.push({
      id: 'C28_no_inc_exc_overlap',
      severity: 'high',
      passed: !dupExc,
      message: dupExc ? `중복: "${dupExc}"` : 'inclusions/excludes 중복 없음',
    });
  }

  // C29 (medium): duration 3~30일 (합리적 패키지 길이)
  if (data.duration !== undefined && data.duration !== null) {
    checks.push({
      id: 'C29_duration_reasonable',
      severity: 'medium',
      passed: data.duration >= 2 && data.duration <= 30,
      message: `duration=${data.duration}${data.duration >= 2 && data.duration <= 30 ? ' OK' : ' 비정상'}`,
    });
  }

  // C30 (medium): special_notes 길이 (너무 짧으면 의심, 50자 이상)
  if (data.specialNotes !== undefined) {
    const len = (data.specialNotes ?? '').length;
    checks.push({
      id: 'C30_special_notes_length',
      severity: 'medium',
      passed: len === 0 || len >= 50,
      message: len === 0 ? 'special_notes 빈값' : `${len}자 ${len >= 50 ? 'OK' : '너무 짧음'}`,
    });
  }

  // C31 (high): departure_airport 한국 공항 (인천/김해/김포/제주 등)
  const dep = data.departure_airport;
  if (dep) {
    const krAirports = /인천|김해|김포|제주|청주|대구|부산|광주|무안|양양|울산|여수|군산/;
    checks.push({
      id: 'C31_departure_airport_kr',
      severity: 'high',
      passed: krAirports.test(dep),
      message: krAirports.test(dep) ? `한국 공항: ${dep}` : `한국 공항 아님: ${dep}`,
    });
  }

  // C32 (critical): airline 코드 ↔ flight_out/in prefix 일치 (LJ airline ↔ LJ 119)
  const airline = data.airline ?? xv.itineraryData?.meta?.airline;
  const fOut = xv.itineraryData?.meta?.flight_out;
  if (airline && fOut) {
    const iataPrefix = airline.match(/\b([A-Z]{2})\b/)?.[1];
    const flightPrefix = fOut.match(/^([A-Z]{2})/)?.[1];
    if (iataPrefix && flightPrefix) {
      checks.push({
        id: 'C32_airline_flight_prefix_match',
        severity: 'critical',
        passed: iataPrefix === flightPrefix,
        message: iataPrefix === flightPrefix ? `${iataPrefix} 일치` : `airline=${iataPrefix} ↔ flight=${flightPrefix} 불일치`,
      });
    }
  }

  // ── 2026-05-13 박제 — Phase 14 Programmatic Verifier 8 신규 룰 (C33~C40, LLM 0) ──

  // C33 (high): title 에 destination 키워드 포함 (LLM 오추론 차단)
  if (data.title && data.destination) {
    const destTokens = data.destination.split(/[\/\s,·]/).filter(t => t.length >= 2);
    const titleLower = data.title.toLowerCase();
    const hasMatch = destTokens.some(t => titleLower.includes(t.toLowerCase()));
    checks.push({
      id: 'C33_title_destination_match',
      severity: 'high',
      passed: hasMatch || destTokens.length === 0,
      message: hasMatch ? 'title↔dest 매치' : `title="${data.title}" 에 destination=${data.destination} 부재`,
    });
  }

  // C34 (medium): inclusions 항목 수 (5건 미만이면 빈약)
  checks.push({
    id: 'C34_inclusions_count_min',
    severity: 'medium',
    passed: (data.inclusions?.length ?? 0) >= 3,
    message: `inclusions ${data.inclusions?.length ?? 0}건`,
  });

  // C35 (high): excludes 에 "팁" 또는 "가이드" 키워드 (정상 패키지)
  const excText = (data.excludes ?? []).join(' ');
  checks.push({
    id: 'C35_excludes_has_tip',
    severity: 'medium',
    passed: /팁|가이드|기사|에티켓/.test(excText),
    message: /팁|가이드|기사|에티켓/.test(excText) ? '팁/가이드 명시 OK' : 'excludes 에 팁/가이드 미명시',
  });

  // C36 (critical): price_tiers 모든 tier 가 같은 통화 (KRW 가정)
  if (data.price_tiers && data.price_tiers.length >= 2) {
    const prices = data.price_tiers.map(t => t.adult_price).filter((p): p is number => typeof p === 'number');
    if (prices.length >= 2) {
      const max = Math.max(...prices);
      const min = Math.min(...prices);
      // 통화 불일치 의심: max/min > 100배 (1000원 vs 100만원)
      checks.push({
        id: 'C36_currency_consistency',
        severity: 'critical',
        passed: max / min < 100,
        message: max / min < 100 ? '통화 일관성 OK' : `tier 간 가격 ${max/min}배 차이 (통화 불일치 의심)`,
      });
    }
  }

  // C37 (high): itinerary_data.days 첫 day 가 출발지 (한국)
  if (xv.itineraryData?.days?.[0]) {
    const day0 = xv.itineraryData.days[0] as { regions?: string[] };
    const firstRegions = Array.isArray(day0.regions) ? day0.regions : [];
    const krKeywords = /한국|서울|부산|인천|김해|김포|제주/;
    const hasKr = firstRegions.some((r: string) => krKeywords.test(r));
    checks.push({
      id: 'C37_first_day_korea',
      severity: 'high',
      passed: hasKr || firstRegions.length === 0,
      message: hasKr ? 'DAY1 한국 출발' : `DAY1 regions=[${firstRegions.join(',')}] 한국 미명시`,
    });
  }

  // C38 (medium): optional_tours name 모두 8자 이상 (너무 짧으면 LLM 오추출)
  if (data.optional_tours && data.optional_tours.length > 0) {
    const tooShort = (data.optional_tours as Array<{ name?: string }>).find(t => (t.name ?? '').length < 4);
    checks.push({
      id: 'C38_optional_tours_name_min',
      severity: 'medium',
      passed: !tooShort,
      message: tooShort ? `선택관광 이름 짧음: "${tooShort.name}"` : `${data.optional_tours.length}개 모두 적정 길이`,
    });
  }

  // C39 (high): cancellation_policy 존재 (필수 정책 누락 차단)
  if (data.cancellation_policy !== undefined) {
    const len = Array.isArray(data.cancellation_policy) ? data.cancellation_policy.length : 0;
    checks.push({
      id: 'C39_cancellation_policy_present',
      severity: 'medium',
      passed: len > 0,
      message: len > 0 ? `취소규정 ${len}건` : '취소규정 누락 (standard-terms fallback 권장)',
    });
  }

  // C40 (critical): itinerary_data.days 모두 day 번호 1..N 순서
  if (xv.itineraryData?.days && xv.itineraryData.days.length > 1) {
    const dayNums = xv.itineraryData.days.map((d, i) => ((d as { day?: number }).day ?? i + 1));
    const expected = Array.from({ length: dayNums.length }, (_, i) => i + 1);
    const matches = dayNums.every((n, i) => n === expected[i]);
    checks.push({
      id: 'C40_day_sequence_continuous',
      severity: 'critical',
      passed: matches,
      message: matches ? `${dayNums.length}일 순서 OK` : `day 순서 깨짐: [${dayNums.join(',')}]`,
    });
  }

  // ── 2026-05-15 박제 — C41~C42 관광지 매칭률 룰 ──
  //   enrichItineraryWithAttractionReferences 결과를 호출자가 전달했을 때만 평가.
  //   사장님 비전 "키워드 솔팅" 성공률을 confidence 에 반영.

  // C41 (high): schedule item 매칭률 ≥ 60%
  //   분모: schedule 안의 flight/hotel/shopping 제외한 활동 item 수
  //   분자: enrichment 가 attraction 매칭한 canonical 개수
  //   2026-05-15 회귀 차단: 콤마 split 다중 매칭 시 matched > denom 가능 → cap 1.0
  if (xv.attractionStats && xv.attractionStats.scheduleItemCount > 0) {
    const stats = xv.attractionStats;
    const denom = stats.scheduleItemCount;
    const matchRate = Math.min(1, stats.matchedCount / denom);
    checks.push({
      id: 'C41_attraction_match_rate',
      severity: 'high',
      passed: matchRate >= 0.6,
      message: `매칭률 ${(matchRate * 100).toFixed(0)}% (${stats.matchedCount}/${denom}) — 미매칭 ${stats.unmatchedCount}개 검수 큐로`,
    });
  }

  // C42 (medium): 매칭 0건이면 (외부 source 시드 의존) 경고
  if (xv.attractionStats && xv.attractionStats.scheduleItemCount >= 3 && xv.attractionStats.matchedCount === 0) {
    checks.push({
      id: 'C42_attraction_match_zero',
      severity: 'medium',
      passed: false,
      message: `schedule ${xv.attractionStats.scheduleItemCount}개 모두 매칭 0 — destination 토큰/aliases 점검 필요`,
    });
  }

  return checks;
}

function computeFillScore(data: ExtractedData): number {
  let s = 0;
  if (data.title)                                   s += 0.15;
  if (data.destination)                             s += 0.15;
  if (data.duration)                                s += 0.10;
  if (data.price_tiers && data.price_tiers.length)  s += 0.25;
  if (data.itinerary && data.itinerary.length)      s += 0.15;
  if (data.inclusions && data.inclusions.length)    s += 0.10;
  if (data.airline)                                 s += 0.05;
  if (data.product_type)                            s += 0.05;
  return Math.min(1, s);
}

function computeCrossValidationScore(checks: ValidationCheck[]): number {
  if (!checks.length) return 0;
  const weight = { critical: 1.0, high: 0.5, medium: 0.2 };
  let total = 0;
  let achieved = 0;
  for (const c of checks) {
    const w = weight[c.severity];
    total += w;
    if (c.passed) achieved += w;
  }
  return total > 0 ? achieved / total : 0;
}

interface AutoGatePolicy {
  auto_publish_above:       number;
  confirm_queue_above:      number;
  pending_review_above:     number;
  reject_leak_score_above:  number;
  full_auto_enabled:        boolean;
}

const DEFAULT_AUTO_GATE_POLICY: AutoGatePolicy = {
  auto_publish_above:      0.95,
  confirm_queue_above:     0.70,
  pending_review_above:    0.50,
  reject_leak_score_above: 0.40,
  full_auto_enabled:       false,
};

function decideAutoGate(
  confidence: number,
  leakScore: number,
  criticalFails: number,
  policy: AutoGatePolicy = DEFAULT_AUTO_GATE_POLICY,
): ConfidenceV2Result['autoGate'] {
  if (criticalFails > 0)                              return 'rejected';
  if (leakScore >= policy.reject_leak_score_above)    return 'rejected';
  if (confidence < policy.pending_review_above)       return 'rejected';
  if (confidence < policy.confirm_queue_above)        return 'pending_review';
  if (confidence < policy.auto_publish_above)         return 'confirm_queue';
  // full_auto_enabled=false 면 95% 이상도 confirm_queue 로 (사장님 1-click)
  return policy.full_auto_enabled ? 'auto_publish' : 'confirm_queue';
}

/**
 * 신뢰도 V2 산출.
 * @param data 추출된 ExtractedData
 * @param ctx  leakScore (customer-leak-sanitizer 결과) + itineraryData (TravelItinerary)
 */
export function calculateConfidenceV2(
  data: ExtractedData,
  ctx: { leakScore?: number; itineraryData?: XValidInput['itineraryData']; policy?: AutoGatePolicy; attractionStats?: XValidInput['attractionStats'] } = {},
): ConfidenceV2Result {
  const fillScore = computeFillScore(data);
  const checks = runCrossValidation(data, { itineraryData: ctx.itineraryData, attractionStats: ctx.attractionStats });
  const crossValidationScore = computeCrossValidationScore(checks);
  const leakScore = Math.min(1, Math.max(0, ctx.leakScore ?? 0));
  const cleanScore = 1 - leakScore;

  // 가중 평균. 하지만 critical 룰 1개라도 실패하면 cleanScore 처럼 다축 곱셈에 가깝게 작동.
  const confidence = Math.max(0, Math.min(1,
    fillScore * 0.30 +
    crossValidationScore * 0.40 +
    cleanScore * 0.30,
  ));

  const criticalFails = checks.filter(c => !c.passed && c.severity === 'critical').length;
  const autoGate = decideAutoGate(confidence, leakScore, criticalFails, ctx.policy);

  return { confidence, fillScore, crossValidationScore, leakScore, cleanScore, checks, autoGate };
}
