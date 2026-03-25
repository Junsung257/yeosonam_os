import pdfParse from 'pdf-parse';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { TravelItinerary } from '@/types/itinerary';

// ─── 타입 정의 ─────────────────────────────────────────────

export interface PriceTier {
  period_label: string;
  departure_dates?: string[];           // 특정 날짜 배열 (YYYY-MM-DD)
  date_range?: { start: string; end: string }; // 기간 범위
  departure_day_of_week?: string;       // 화 | 금 | 수 | 토
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
  price_usd?: number;
  price_krw?: number;
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
  guide_tip?: string;
  single_supplement?: string;
  small_group_surcharge?: string;
  surcharges?: Surcharge[];
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
}

export interface ParsedDocument {
  filename: string;
  fileType: 'pdf' | 'image' | 'hwp';
  rawText: string;
  extractedData: ExtractedData;
  itineraryData?: TravelItinerary | null;  // 고객용 일정표 JSON
  parsedAt: Date;
  confidence: number;
  // 복수 상품 추출 결과 (PDF에 여러 상품이 있을 때)
  multiProducts?: MultiProductResult[];
}

// ─── Gemini API 호출 ────────────────────────────────────────

function getGeminiModel(apiKey: string) {
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { temperature: 0.1 },
  });
}

async function callGeminiVision(apiKey: string, base64Image: string, mimeType: string, prompt: string): Promise<string> {
  const model = getGeminiModel(apiKey);
  const result = await model.generateContent([
    { inlineData: { mimeType, data: base64Image } },
    prompt,
  ]);
  return result.response.text();
}

async function callGeminiText(apiKey: string, text: string, prompt: string): Promise<string> {
  const model = getGeminiModel(apiKey);
  const result = await model.generateContent(`${prompt}\n\n---\n\n${text}`);
  return result.response.text();
}

// ─── 구조화 추출 프롬프트 ────────────────────────────────────

const EXTRACT_PROMPT = `이 여행상품 문서에서 정보를 추출해 정확히 아래 JSON 형식으로 반환하세요.
필드가 없으면 null로, 배열이 없으면 []로 반환하세요.
날짜는 항상 YYYY-MM-DD 형식. 연도가 없으면 2026년으로 가정.
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
    {"name": "발마사지", "price_usd": 30, "price_krw": null}
  ],
  "itinerary": ["제1일: 부산출발 → 서안도착", "제2일: 소안탑 → 회족거리"],
  "accommodations": ["천익호텔 또는 홀리데이인익스프레호텔(4성)"],
  "specialNotes": "주의사항, 여권유효기간, 취소규정 외 기타 안내 전체 (원문 보존용)",
  "notices_parsed": ["원문의 유의사항을 1건=1문장 배열로 정제. 규칙: ① 번호접두사(1. 2. 등) 제거하고 완전한 문장만 ② 동일 내용 중복 제거 ③ 금액·날짜·조건 등 구체적 수치는 반드시 보존 ④ 빈 문자열이나 번호만 있는 항목 제거"],
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

★ price_list 작성 규칙 (price_tiers와 별도로 반드시 채울 것):
- 동일 기간 내 요일·날짜별 다른 가격 → rules[] 배열 분리 기재.
- 가격 조건 동일 시 rules 1개 (condition: "전 출발일").
- price: 숫자(원화), '별도문의'·'문의'·'$별도' 등 확정 불가 시 null.
- badge: 원문 특가♥/↑/★ → 가장 근접한 표준값 매핑. 원문 없으면 null.
- notes: 아동요금 동일 여부, 싱글차지, 대욕장UP, 가이드팁 포함 여부 반드시 포함.

반드시 JSON만 반환하세요. 마크다운 코드블록이나 다른 설명 없이 JSON 객체만.`;

// ─── 파싱 결과 처리 ─────────────────────────────────────────

function parseGeminiResponse(raw: string, fallbackText: string): ExtractedData {
  const jsonStr = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  const parsed = JSON.parse(jsonStr);

  return {
    rawText: parsed.fullText || fallbackText,
    title: parsed.title || undefined,
    category: parsed.category || 'package',
    product_type: parsed.product_type || undefined,
    trip_style: parsed.trip_style || undefined,
    destination: parsed.destination || undefined,
    duration: typeof parsed.duration === 'number' ? parsed.duration : (parsed.duration ? parseInt(parsed.duration) : undefined),
    departure_days: parsed.departure_days || undefined,
    departure_airport: parsed.departure_airport || undefined,
    airline: parsed.airline || undefined,
    min_participants: parsed.min_participants || 4,
    ticketing_deadline: parsed.ticketing_deadline || undefined,
    guide_tip: parsed.guide_tip || undefined,
    single_supplement: parsed.single_supplement || undefined,
    small_group_surcharge: parsed.small_group_surcharge || undefined,
    price: Array.isArray(parsed.price_tiers) && parsed.price_tiers.length > 0
      ? (parsed.price_tiers.find((t: PriceTier) => t.adult_price)?.adult_price ?? parsed.price ?? undefined)
      : (parsed.price ?? undefined),
    price_tiers: Array.isArray(parsed.price_tiers) ? parsed.price_tiers : [],
    price_list: Array.isArray(parsed.price_list) ? parsed.price_list as PriceListItem[] : [],
    surcharges: Array.isArray(parsed.surcharges) ? parsed.surcharges : [],
    excluded_dates: Array.isArray(parsed.excluded_dates) ? parsed.excluded_dates : [],
    inclusions: Array.isArray(parsed.inclusions) ? parsed.inclusions.filter(Boolean) : [],
    excludes: Array.isArray(parsed.excludes) ? parsed.excludes.filter(Boolean) : [],
    optional_tours: Array.isArray(parsed.optional_tours) ? parsed.optional_tours : [],
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
    const data = await pdfParse(buffer);
    console.log('[Parser] PDF 파싱 완료:', data.text?.length || 0, '글자');
    return data.text || '';
  } catch (error) {
    throw new Error(`PDF 파싱 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
  }
}

// ─── 이미지 파싱 (Gemini Vision) ────────────────────────────

export async function parseImage(buffer: Buffer, mimeType = 'image/jpeg'): Promise<{ rawText: string; extractedData: ExtractedData }> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY가 설정되지 않았습니다.');

  console.log('[Parser] 이미지 AI 파싱 시작:', buffer.length, '바이트');
  const base64 = buffer.toString('base64');

  try {
    const raw = await callGeminiVision(apiKey, base64, mimeType, EXTRACT_PROMPT);
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

// ─── PDF/텍스트 AI 구조화 추출 ──────────────────────────────

async function parseTextWithAI(text: string): Promise<ExtractedData> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) return extractTravelInfo(text);

  // Gemini 2.5 Flash는 100만 토큰 지원 — 전체 텍스트 사용 (Jarvis 답변 품질 확보)
  const truncated = text;

  try {
    const raw = await callGeminiText(apiKey, truncated, EXTRACT_PROMPT);
    console.log('[Parser] Gemini Text 응답:', raw.length, '글자');
    const extractedData = parseGeminiResponse(raw, text);
    extractedData.rawText = text; // 원본 전체 텍스트 보존
    console.log('[Parser] 추출 완료 - 상품:', extractedData.title, '/ price_tiers:', extractedData.price_tiers?.length);
    return extractedData;
  } catch (err) {
    console.warn('[Parser] AI 텍스트 추출 실패, regex fallback:', err);
    return extractTravelInfo(text);
  }
}

// ─── HWP 파싱 ───────────────────────────────────────────────

export async function parseHWP(buffer: Buffer, filename: string): Promise<string> {
  // HWP는 OLE 바이너리 포맷 - 전용 라이브러리 없이 완전 파싱 불가
  // UTF-16LE로 디코드해 한글/숫자/영문 문자열 최대한 추출
  try {
    const utf16Text = buffer.toString('utf16le');
    // 한글+숫자+영문+공백+특수문자가 3자 이상 연속된 문자열 추출
    const matches = utf16Text.match(/[\uAC00-\uD7A3\u0020-\u007E]{3,}/g) || [];
    const extracted = matches
      .map(s => s.trim())
      .filter(s => s.length >= 3 && /[\uAC00-\uD7A3]/.test(s)) // 한글 포함된 것만
      .join('\n');

    if (extracted.length >= 50) {
      console.log('[Parser] HWP UTF-16LE 추출 성공:', extracted.length, '글자');
      return extracted;
    }

    // UTF-16LE 실패 시 Latin-1로 시도 (일부 HWP 구조)
    const latin1Text = buffer.toString('latin1');
    const latin1Matches = latin1Text.match(/[\uAC00-\uD7A3\u0020-\u007E]{3,}/g) || [];
    const latin1Extracted = latin1Matches
      .map(s => s.trim())
      .filter(s => s.length >= 3)
      .join('\n');

    if (latin1Extracted.length >= 50) {
      console.log('[Parser] HWP latin1 추출 성공:', latin1Extracted.length, '글자');
      return latin1Extracted;
    }

    // 텍스트 추출 실패 - 파일명 기반 최소 정보 + 명확한 안내
    const titleFromFilename = filename.replace(/\.hwp$/i, '').trim();
    throw new Error(
      `HWP 파일에서 텍스트를 추출할 수 없습니다. 파일을 PDF 또는 JPG로 변환 후 업로드해 주세요. (파일명: ${titleFromFilename})`
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes('PDF 또는 JPG')) throw error;
    throw new Error(`HWP 파싱 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
  }
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

  const inclusionsSection = text.match(/포함.*?(?=불포함|$)/is);
  if (inclusionsSection) {
    data.inclusions = inclusionsSection[0].split(/[,\n]/).map(s => s.trim()).filter(s => s.length > 2 && !s.includes('포함'));
  }

  const excludesSection = text.match(/불포함.*?(?=선택관광|$)/is);
  if (excludesSection) {
    data.excludes = excludesSection[0].split(/[,\n]/).map(s => s.trim()).filter(s => s.length > 2 && !s.includes('불포함'));
  }

  const minParticipantsMatch = text.match(/(\d+)\s*명\s*이상/);
  if (minParticipantsMatch) data.min_participants = parseInt(minParticipantsMatch[1]);

  return data;
}

// ─── 일정표 구조화 추출 (itinerary_data) ────────────────────

const ITINERARY_PROMPT = `이 여행상품 문서에서 고객용 일정표 정보를 추출해 정확히 아래 JSON 형식으로 반환하세요.
포함/불포함/비고(RMK)는 원문 그대로 보존하세요 (절대 편집/요약 금지 — 법적 분쟁 방지).
없는 필드는 null, 배열은 [].

★ 절대 규칙 — nights/days 정확 추출:
- "3박4일" → nights: 3, days: 4
- "2박3일" → nights: 2, days: 3
- 일정표의 "제1일"~"제N일" 개수로 교차 검증. 상품명 표기와 일정표 일수가 다르면 일정표 일수를 우선.

★ 절대 규칙 — 포함/불포함은 해당 상품 섹션에서만 추출:
- "기사/가이드 팁 포함"이 포함사항에 있으면 inclusions에 추가.
- "기사/가이드($40/인)"가 불포함사항에 있으면 excludes에 추가.
- 다른 상품의 포함/불포함을 혼합하지 마라.

{
  "meta": {
    "title": "상품명 (예: 노팁 노옵션 장가계 3박4일)",
    "product_type": "실속 또는 품격 또는 노팁노옵션 또는 null",
    "destination": "목적지 (예: 장가계)",
    "nights": 박수 숫자 (★ "N박M일"의 N),
    "days": 일수 숫자 (★ "N박M일"의 M. 일정표 일수로 교차검증),
    "departure_airport": "출발공항 (예: 부산(김해), 없으면 null)",
    "airline": "항공사명 (예: 에어부산, 없으면 null)",
    "flight_out": "출발 항공편 코드 (예: BX371, 없으면 null)",
    "flight_in": "귀국 항공편 코드 (예: BX372, 없으면 null)",
    "departure_days": "출발 요일 원문 (예: 매주 월/화/수, 없으면 null)",
    "min_participants": 최소인원 숫자 (없으면 4),
    "room_type": "2인 1실 등 (없으면 null)",
    "ticketing_deadline": "발권마감 원문 그대로 (예: 3/27(금)까지, 없으면 null)",
    "hashtags": ["#질성산", "#리무진차량"],
    "brand": "여소남"
  },
  "highlights": {
    "inclusions": ["포함내역 각 항목 원문 그대로 (절대 편집 금지)"],
    "excludes": ["불포함내역 각 항목 원문 그대로 (금액 포함, 절대 편집 금지)"],
    "shopping": "쇼핑 원문 그대로 (없으면 null)",
    "remarks": ["RMK/비고 각 항목 원문 그대로 (절대 편집 금지)"]
  },
  "days": [
    {
      "day": 1,
      "regions": ["부산", "장가계"],
      "meals": {
        "breakfast": false,
        "lunch": true,
        "dinner": true,
        "breakfast_note": null,
        "lunch_note": "누룽지백숙",
        "dinner_note": "원탁요리"
      },
      "schedule": [
        {
          "time": "09:00",
          "activity": "부산 출발",
          "transport": "BX371",
          "note": null,
          "type": "flight"
        }
      ],
      "hotel": {
        "name": "장가계 국제호텔",
        "grade": "4성",
        "note": "또는 동급"
      }
    }
  ],
  "optional_tours": [
    {
      "name": "발마사지(50분)",
      "price_usd": 30,
      "price_krw": null,
      "note": "팁별도"
    }
  ]
}

type 값: "normal"(일반관광/이동), "optional"(선택관광), "shopping"(쇼핑), "flight"(항공), "train"(기차), "meal"(특별식사), "hotel"(체크인)
hotel이 null이면 hotel 필드를 null로 설정.

★ 규칙1 — 호텔 일자 귀속 (절대 원칙):
- 원본 문서의 각 일자 블록에서 'HOTEL', '호텔 :', '숙소' 키워드를 직접 찾아라.
- 해당 키워드가 있는 일자 블록 → 그 호텔명을 해당 일자 hotel 필드에 그대로 귀속.
- 해당 키워드가 없는 일자 블록 → hotel = null.
- 원본에 적힌 그대로만 처리하라. 임의로 추론하거나 다른 일자 데이터를 복사하지 마라.

★ 규칙2 — 선택관광과 메인 일정 완벽 분리:
- '↓추천선택관광', '선택관광', '옵션' 키워드 하위에 적힌 모든 동선·상세 내용은 해당 일자 schedule[]의 activity에 절대 포함시키지 마라.
- 선택관광은 이름과 가격($) 정보만 추출해 루트 레벨 optional_tours[] 배열에만 저장하라.
- 선택관광이 있는 날의 메인 일정은 '전일 자유시간' 또는 공식 일정만 깔끔하게 표기하라.
- schedule 내 선택관광 항목은 type: "optional"로 마킹하되, activity는 '선택관광명(가격)'으로만 단순 표기하라.

★ 규칙3 — 식사 항목 표준화:
- '불포함', '자유식', 'X', '-', '없음', '미포함' 등 식사가 제공되지 않음을 뜻하는 모든 표기 → false (boolean), note는 null로 통일하라.
- 특정 식사명(예: '원탁요리', '누룽지백숙', '기내식')이 있으면 → true, note에 식사명 기입.
- 혼재 표기(예: '중식 자유식') → false, null로 처리. 불확실하면 false를 기본값으로 사용하라.

★ highlights 항목의 Bold 처리 규칙:
고객이 반드시 인지해야 할 핵심 정보는 **텍스트** 형식으로 감싸 주세요 (마크다운 bold).
- 금액·비용: 예) "기사/가이드 경비: **1인 $50** (현지 지불)"
- 기간·데드라인: 예) "유효기간 **6개월 이상** 필수"
- 페널티·위약금: 예) "1인 1일 **$100 페널티** 발생"
- 여권·비자·입국 주의사항 키워드: 예) "**여권:** 출발일 기준..."
전체 문장이 아닌 핵심 키워드/숫자만 bold 처리하세요.

반드시 JSON만 반환하세요. 마크다운 코드블록 없이 JSON 객체만.`;

/**
 * 문서에서 itinerary_data (고객용 일정표 JSON) 추출
 * EXTRACT_PROMPT와 별도 호출 — 더 정교한 일정 구조화에 집중
 */
export async function extractItineraryData(
  rawText: string,
  base64Image?: string,
  mimeType?: string,
): Promise<TravelItinerary | null> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) return null;

  try {
    let raw: string;
    if (base64Image && mimeType) {
      raw = await callGeminiVision(apiKey, base64Image, mimeType, ITINERARY_PROMPT);
    } else {
      raw = await callGeminiText(apiKey, rawText, ITINERARY_PROMPT);
    }
    const jsonStr = raw
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(jsonStr) as TravelItinerary;
    // brand 고정
    if (parsed.meta) parsed.meta.brand = '여소남';
    console.log('[Parser] itinerary_data 추출 완료 — days:', parsed.days?.length);
    return parsed;
  } catch (err) {
    console.warn('[Parser] itinerary_data 추출 실패:', err instanceof Error ? err.message : err);
    return null;
  }
}

// ─── 복수 상품 통합 추출 ─────────────────────────────────────

/**
 * PDF 1장에 여러 상품이 담긴 경우 전체를 배열로 추출.
 * EXTRACT_PROMPT + ITINERARY_PROMPT를 하나로 합쳐 AI 호출 1회로 처리.
 */
// ── Phase 1: 기본 정보 + 가격 추출 (itinerary_data 제외 → 빠름) ──
const MULTI_PRODUCT_PHASE1_PROMPT = `이 여행상품 문서에서 **모든 상품**의 기본 정보와 가격을 추출해 JSON 배열로 반환하세요.
★ 일정표(itinerary_data, days)는 이 단계에서 추출하지 마세요. 기본 정보와 가격만 추출.
상품이 1개여도 반드시 배열([ ])로 감싸세요.

★★ UI 렌더링 컨텍스트 ★★
이 JSON은 A4 규격(800px) 2단 그리드에 렌더링됩니다.
notices_parsed의 text는 "• 항목\n• 항목" 불렛 포인트 형식으로 작성하세요. 1줄 압축 금지.

★★ 처리 순서 (Chain of Thought) ★★
다음 4단계를 반드시 순서대로 거쳐라:
① De-noise: 엑셀용 빈칸, 비고/주의사항 중복 문구, 직원 메모("수배불가","차지나옴") 완벽 제거
② Translate: 여행사 은어(수배→예약확정, 샌딩→미팅, 차지→추가금, 인폼→안내)를 B2C 용어로 번역
③ Summarize: notices_parsed text를 "• 항목1\n• 항목2\n• 항목3" 불렛 포인트 2~3줄로 정리 (1줄 압축 금지, 맥락 보존)
④ Validate: 원본에 없는 데이터는 null 처리 (할루시네이션 원천 차단)

★★★ 최우선 규칙 — 상품 간 데이터 오염 절대 금지 ★★★
- 각 상품의 inclusions/excludes/guide_tip/optional_tours는 해당 상품 섹션에서만 추출.
- 상품A의 "기사/가이드 팁 포함"을 상품B에 적용하면 절대 안 된다.
- 요금표도 해당 상품 열(Column)의 가격만 추출.

★ duration: "3박4일" → duration: 4 (일수 기준). "2박3일" → duration: 3.
★ 가이드팁: "팁 포함" → inclusions + guide_tip:"포함" / "$40/인" → excludes + guide_tip:"$40/인"
★ departure_day_of_week: "3/29~4/22 (토 출발)" → departure_day_of_week:"토". 출발 요일이 명시되면 반드시 추출.

[
  {
    "title": "상품명 전체",
    "category": "package|golf|honeymoon|cruise|theme",
    "product_type": "실속|품격|노팁노옵션|일반|null",
    "trip_style": "3박4일 등|null",
    "destination": "목적지",
    "duration": 여행일수(★N박M일의 M),
    "departure_days": "매주 화요일 등|null",
    "departure_airport": "출발공항|null",
    "airline": "항공사명/편명|null",
    "min_participants": 최소인원(없으면 4),
    "ticketing_deadline": "YYYY-MM-DD|null (연도없으면 2026)",
    "guide_tip": "원문|null",
    "single_supplement": "원문|null",
    "small_group_surcharge": "원문|null",
    "price_tiers": [
      {
        "period_label": "날짜/기간 표시 원문 그대로 (예: '4/1~4/30')",
        "departure_dates": ["YYYY-MM-DD"] 또는 null,
        "date_range": {"start":"YYYY-MM-DD","end":"YYYY-MM-DD"} 또는 null,
        "departure_day_of_week": "목 또는 금 또는 화,수,토 또는 일,월 등 (없으면 null)",
        "adult_price": 성인가격 숫자 (예: 849000. 849,- → 849000으로 변환),
        "child_price": 아동가격 숫자 또는 null,
        "status": "available 또는 confirmed 또는 soldout",
        "note": "비고 원문 그대로 (예: '*2명부터 출발확정', '특가', '마감임박' 등. 없으면 null)"
      }
    ],
    "price_list": [
      {
        "period": "기간 원문 (예: '4/1~4/30')",
        "rules": [
          {
            "condition": "출발 조건 (예: '목', '금', '화,수,토', '일,월', '전 출발일')",
            "price_text": "가격 원문 (예: '849,000원')",
            "price": 849000,
            "badge": null
          }
        ],
        "notes": "성인/아동 동일, 싱글차지 등 부가 조건 또는 null"
      }
    ],
    "surcharges": [{"period":"기간","amount_usd":null,"amount_krw":null,"note":""}],
    "excluded_dates": ["YYYY-MM-DD (항공제외일/운휴일 반드시 추출. 예: 4/30, 5/1~5 → 2026-04-30, 2026-05-01~05)"],
    "inclusions": ["포함항목 원문 그대로"],
    "excludes": ["불포함항목 원문 그대로"],
    "optional_tours": [{"name":"","price_usd":null,"price_krw":null}],
    "accommodations": ["호텔명"],
    "specialNotes": "주의사항+비고 전체 원문 (원본 보존용)",
    "notices_parsed": [
      {"type":"CRITICAL","title":"취소/환불 규정","text":"• 전세기 특별약관: 예약금 입금 후 취소/환불 절대 불가\n• 출발 14일 전 전체 금액 완납 필수 (미납 시 자동 취소)\n• 여권 유효기간 출발일 기준 6개월 이상 필수"},
      {"type":"PAYMENT","title":"각종 추가 요금","text":"• 2B 추가: 평일 1100엔, 주말 2200엔\n• 3B 추가: 주말/공휴일 550엔\n• 본관 2000엔/박, 1인실 3000엔/박 추가"},
      {"type":"POLICY","title":"골프장 이용 규정","text":"• 완전 셀프제 운영 (골프백 상하차 서비스 미제공)\n• 골프장 선택/업그레이드 불가, 중복 플레이 가능\n• 문신 시 골프장 및 목욕탕 입장 불가"},
      {"type":"INFO","title":"현지 이용 안내","text":"• 호텔→골프장 이동 약 30분 (택시 송영 가능)\n• 출발 시간은 전날 기사님이 안내\n• 석식 불포함, 호텔 1층 식당 이용 가능"}
    ],
    "cancellation_policy": [{"period":"","rate":0,"note":""}],
    "land_operator": "랜드사명|null",
    "product_tags": ["해당태그만"],
    "product_highlights": ["핵심특전 3개이내"],
    "product_summary": "2~3줄 요약",
    "theme_tags": ["해당태그만"],
    "selling_points": {"hotel":"호텔명|null","airline":"항공사|null","unique":["특전2~3개"]},
    "flight_info": {"airline":"null","flight_no":"null","depart":"HH:MM|null","arrive":"HH:MM|null","return_depart":"null","return_arrive":"null"}
  }
]

★★ price_tiers/price_list 작성 규칙 (가장 중요 — 반드시 채울 것):
- 요금표가 있으면 price_tiers와 price_list 둘 다 반드시 채워라. 비어있으면 안 된다.
- 가격 변환: "849,-" → 849000, "1,059,-" → 1059000 (천원 단위 표기 → ×1000)
- 동일 기간 내 요일별 다른 가격 → price_tiers에는 각 행, price_list에는 rules[] 배열로 분리.
- 복수 상품(실속/품격/노팁노옵션)이면 각 상품별 해당 열(Column)의 가격만 추출.
- 예시: "4/1~4/30 목 849,-" → price_tiers: [{period_label:"4/1~4/30", departure_day_of_week:"목", adult_price:849000}]
- ★ note 필드: "*2명부터 출발확정" 같은 비고는 해당 기간의 price_tiers에만 note로 기재. 다른 기간에 적용하지 마라.
  예: 3/29~6/5에 "*2명부터 출발확정" → 3/29~6/5 행의 note:"출발확정". 3/19~3/28에는 note:null.
- ★ excluded_dates: "항공제외일 4/30, 5/1~5, 5/23, 24" 같은 제외일은 반드시 YYYY-MM-DD 배열로 추출. 빈 배열이면 안 된다.
- ★ 일본공휴일/연휴기간 지상비 추가 정보도 notices_parsed PAYMENT에 포함할 것.

★ 포함/불포함은 원문 그대로 (편집/요약 금지).
★★★ notices_parsed 절대 규칙 (위 예시를 정확히 따를 것):
- 반드시 {"type","title","text"} 객체 배열. 문자열 배열 금지.
- 전체 notices 개수: 정확히 4개 (CRITICAL 1개, PAYMENT 1개, POLICY 1개, INFO 1개).
- 같은 type의 항목은 절대 2개 이상 만들지 마라. 반드시 1개로 병합.
- ★ 각 카드의 불렛(•) 개수: 최대 3~4개. 5개 이상 절대 금지. 비슷한 내용은 1줄로 합쳐라.
- text는 반드시 "• 첫줄\n• 둘째줄\n• 셋째줄" 불렛 포인트 형식. 1줄 압축 금지.
- 분류 기준 엄수:
  CRITICAL: 취소/환불/여권 등 여행 성사 여부에 영향을 미치는 것만. 좌석확인/수화물 구매 같은 안내 사항은 INFO.
  PAYMENT: 추가 요금/할증만. 현금영수증 발급 같은 안내는 INFO.
  POLICY: 골프장/호텔/크루즈 현장 규정만.
  INFO: 이동/차량/식사 등 일반 안내.
- 주의사항 + 비고 + 불포함의 제약조건을 모두 통합하여 중복 없이 4개로 분류.
- 직원 말투("부탁드립니다")는 고객용("~불가", "~필수")으로 수정.
- 원본에 없는 내용은 생성하지 마라.
반드시 JSON 배열만 반환. 마크다운 코드블록 없이.`;

// ── Phase 2: 특정 상품의 일정표만 추출 ──
const MULTI_PRODUCT_PHASE2_PROMPT = `이 여행상품 문서에서 아래 상품의 **일정표(itinerary_data)**만 추출해 JSON 객체로 반환하세요.

★ 대상 상품: "{{PRODUCT_TITLE}}"

{
  "meta": {
    "title": "상품명",
    "product_type": "실속 등|null",
    "destination": "목적지",
    "nights": 박수(★N박M일의 N),
    "days": 일수(★N박M일의 M),
    "departure_airport": "출발공항|null",
    "airline": "항공사|null",
    "flight_out": "출발편 코드|null",
    "flight_in": "귀국편 코드|null",
    "departure_days": "출발요일 원문|null",
    "min_participants": 최소인원,
    "room_type": "2인1실 등|null",
    "ticketing_deadline": "발권마감 원문|null",
    "hashtags": ["#관광지명"],
    "brand": "여소남"
  },
  "highlights": {
    "inclusions": ["포함내역 원문 그대로 (절대 편집 금지)"],
    "excludes": ["불포함내역 원문 그대로 (절대 편집 금지)"],
    "shopping": "쇼핑 원문|null",
    "remarks": ["RMK/비고 원문 그대로"]
  },
  "days": [
    {
      "day": 1,
      "regions": ["지역명"],
      "meals": {"breakfast":false,"lunch":true,"dinner":true,"breakfast_note":null,"lunch_note":"식사명","dinner_note":"식사명"},
      "schedule": [
        {"time":"09:05","activity":"김해 국제공항 출발","transport":"BX1385","note":null,"type":"flight","badge":"✈️ BX1385"},
        {"time":"10:00","activity":"나가사키 국제공항 도착","transport":"BX1385","note":null,"type":"flight","badge":null},
        {"time":null,"activity":"골프 라운딩 (18홀 / 셀프)","transport":null,"note":null,"type":"golf","badge":"⛳ 18홀 셀프라운딩"},
        {"time":null,"activity":"호텔 체크인 후 휴식","transport":null,"note":null,"type":"normal","badge":null}
      ],
      "hotel": {"name":"호텔명","grade":"4성","note":"또는 동급"}
    }
  ],
  "optional_tours": [{"name":"선택관광명","price_usd":30,"price_krw":null,"note":null}]
}

★ 규칙:
- 해당 상품("{{PRODUCT_TITLE}}")의 일정 섹션에서만 추출. 다른 상품 일정 혼합 금지.
- type: normal|optional|shopping|flight|train|meal|hotel|golf|cruise|spa|excursion
- ★ badge 필드: 골프라운딩이면 badge:"⛳ 18홀 셀프라운딩", 크루즈 승선이면 badge:"🚢 승선", 스파이면 badge:"💆 커플 스파" 등. 일반 활동이면 badge:null.
- ★ 항공편(type:"flight"): 출발편과 도착편을 각각 별도 schedule 항목으로 추출. time에 출발/도착 시간 정확히 기입.
  예: "BX1385 09:05/10:00" → [{time:"09:05",activity:"김해 국제공항 출발",transport:"BX1385",type:"flight"}, {time:"10:00",activity:"나가사키 국제공항 도착",transport:"BX1385",type:"flight"}]
- 호텔: 해당 일자 블록에 HOTEL/호텔/숙소 키워드 있을 때만 귀속. 없으면 null.
- 선택관광: optional_tours[]에 이름+가격 저장하고, 해당 일자 schedule에도 type:"optional"로 간략 표기 (예: activity:"추천 선택관광: 호핑투어 ($80/인)", type:"optional").
- 식사: 불포함/자유식/X/- → false,null. 식사명 있으면 → true,식사명. "불포함(클럽식)" → false, note:"클럽식(불포함)". 불확실 → false,null.
- highlights의 inclusions/excludes는 해당 상품 전용 섹션에서만 추출 (다른 상품 데이터 혼합 금지).
- ★ highlights.remarks: 원문의 "비고" 섹션 전체를 각 항목별 배열로 추출. 골프장 규칙, 추가요금, 주의사항 등 모든 비고 내용을 포함. (Phase 1의 notices_parsed에 통합되지만, 원문 보존용으로 여기도 유지)
- 핵심 금액/기간은 **bold** 처리.
반드시 JSON 객체만 반환.`;

export interface MultiProductResult {
  extractedData: ExtractedData;
  itineraryData: TravelItinerary | null;
}

// JSON 파싱 헬퍼 (잘린 JSON 복구 포함)
function safeParseJsonArray(raw: string): Record<string, unknown>[] | null {
  let jsonStr = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    const result = JSON.parse(jsonStr);
    return Array.isArray(result) ? result : null;
  } catch {
    const lastCloseBrace = jsonStr.lastIndexOf('}');
    if (lastCloseBrace > 0) {
      jsonStr = jsonStr.slice(0, lastCloseBrace + 1);
      if (!jsonStr.endsWith(']')) jsonStr += ']';
      if (!jsonStr.startsWith('[')) jsonStr = '[' + jsonStr;
      try {
        const result = JSON.parse(jsonStr);
        console.log('[Parser] 잘린 JSON 복구 성공');
        return Array.isArray(result) ? result : null;
      } catch { return null; }
    }
    return null;
  }
}

function safeParseJsonObject(raw: string): Record<string, unknown> | null {
  const jsonStr = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(jsonStr); } catch { return null; }
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
    departure_days: (item.departure_days as string) || undefined,
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
    price_tiers: Array.isArray(item.price_tiers) ? (item.price_tiers as PriceTier[]) : [],
    price_list: Array.isArray(item.price_list) ? (item.price_list as PriceListItem[]) : [],
    surcharges: Array.isArray(item.surcharges) ? (item.surcharges as Surcharge[]) : [],
    excluded_dates: Array.isArray(item.excluded_dates) ? (item.excluded_dates as string[]) : [],
    inclusions: Array.isArray(item.inclusions) ? (item.inclusions as string[]).filter(Boolean) : [],
    excludes: Array.isArray(item.excludes) ? (item.excludes as string[]).filter(Boolean) : [],
    optional_tours: Array.isArray(item.optional_tours) ? (item.optional_tours as OptionalTour[]) : [],
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
): Promise<MultiProductResult[]> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) return [];

  const truncatedText = rawText.slice(0, 30000);

  try {
    // ── Phase 1: 기본 정보 + 가격 추출 (일정표 제외 → 빠름) ──
    console.log('[Parser] Phase 1 시작: 기본 정보 + 가격 추출');
    let phase1Raw: string;
    if (base64Image && mimeType) {
      phase1Raw = await callGeminiVision(apiKey, base64Image, mimeType, MULTI_PRODUCT_PHASE1_PROMPT);
    } else {
      phase1Raw = await callGeminiText(apiKey, truncatedText, MULTI_PRODUCT_PHASE1_PROMPT);
    }

    const phase1Parsed = safeParseJsonArray(phase1Raw);
    if (!phase1Parsed || phase1Parsed.length === 0) {
      console.warn('[Parser] Phase 1 파싱 실패 — fallback');
      return [];
    }
    console.log('[Parser] Phase 1 완료 —', phase1Parsed.length, '개 상품');

    // ── Phase 2: 각 상품별 일정표 병렬 추출 ──
    console.log('[Parser] Phase 2 시작: 일정표 병렬 추출');
    const phase2Promises = phase1Parsed.map(async (item) => {
      const title = (item.title as string) || '상품명 미상';
      const prompt = MULTI_PRODUCT_PHASE2_PROMPT.replace(/\{\{PRODUCT_TITLE\}\}/g, title);
      try {
        let itinRaw: string;
        if (base64Image && mimeType) {
          itinRaw = await callGeminiVision(apiKey, base64Image, mimeType, prompt);
        } else {
          itinRaw = await callGeminiText(apiKey, truncatedText, prompt);
        }
        const parsed = safeParseJsonObject(itinRaw);
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
    console.log('[Parser] Phase 2 완료 — 일정표', itineraries.filter(Boolean).length, '개 성공');

    // ── 결합: Phase 1 기본정보 + Phase 2 일정표 ──
    return phase1Parsed.map((item, idx) => ({
      extractedData: phase1ItemToExtractedData(item, rawText),
      itineraryData: itineraries[idx] ?? null,
    }));
  } catch (err) {
    console.warn('[Parser] 복수 상품 추출 실패:', err instanceof Error ? err.message : err);
    return [];
  }
}

// ─── 메인 파싱 함수 ─────────────────────────────────────────

export async function parseDocument(buffer: Buffer, filename: string): Promise<ParsedDocument> {
  const ext = filename.split('.').pop()?.toLowerCase();
  let fileType: 'pdf' | 'image' | 'hwp' = 'pdf';

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
    } else {
      throw new Error(`지원하지 않는 파일 형식: ${ext}`);
    }

    if (!rawText) throw new Error('파일에서 텍스트를 추출할 수 없습니다.');

    // 복수 상품 통합 추출 (1회 AI 호출로 모든 상품 + 일정표 추출)
    const multiProducts = await extractMultipleProducts(rawText);

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
        parseTextWithAI(rawText),
        extractItineraryData(rawText),
      ]);
    }

    return {
      filename, fileType, rawText,
      extractedData,
      itineraryData,
      parsedAt: new Date(),
      confidence: calculateConfidence(extractedData),
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

  const apiKey = process.env.GOOGLE_AI_API_KEY;
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

// ─── 신뢰도 계산 ────────────────────────────────────────────

export function calculateConfidence(data: ExtractedData): number {
  let score = 0;
  if (data.title) score += 15;
  if (data.destination) score += 15;
  if (data.duration) score += 10;
  if (data.price_tiers && data.price_tiers.length > 0) score += 30; // price_tiers가 핵심
  else if (data.price) score += 15;
  if (data.itinerary && data.itinerary.length > 0) score += 15;
  if (data.inclusions && data.inclusions.length > 0) score += 10;
  if (data.product_type) score += 5;
  return Math.min(score / 100, 1);
}
