/**
 * itinerary_data (고객용 일정표 JSON) 추출 전용 모듈
 * parser.ts 에서 분리 — 최소 의존성으로 Vercel Functions 용량 300MB 초과 방지
 */
import { GoogleGenerativeAI, SchemaType, type ResponseSchema } from '@google/generative-ai';
import { getSecret } from '@/lib/secret-registry';
import type { TravelItinerary } from '@/types/itinerary';

// ─── Gemini 헬퍼 ────────────────────────────────────────────

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

async function callGeminiVision(apiKey: string, base64Image: string, mimeType: string, prompt: string, schema?: ResponseSchema): Promise<string> {
  const model = getGeminiModel(apiKey, schema);
  const result = await model.generateContent([
    { inlineData: { mimeType, data: base64Image } },
    prompt,
  ]);
  return result.response.text();
}

// ─── ITINERARY_PROMPT ────────────────────────────────────────

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

// ─── extractItineraryData ────────────────────────────────────

/**
 * 문서에서 itinerary_data (고객용 일정표 JSON) 추출
 * Gemini API를 직접 호출 — pdf-parse/openai 등 불필요한 의존성 없음
 */
export async function extractItineraryData(
  rawText: string,
  base64Image?: string,
  mimeType?: string,
): Promise<TravelItinerary | null> {
  const apiKey = getSecret('GOOGLE_AI_API_KEY');
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
    let parsed = JSON.parse(jsonStr);
    // 배열로 반환된 경우 객체로 래핑 (정규화)
    if (Array.isArray(parsed)) {
      console.warn('[Parser] itinerary_data가 배열로 반환됨 → {days: [...]} 객체로 래핑');
      parsed = { meta: {}, highlights: {}, days: parsed, optional_tours: [] };
    }
    const itinerary = parsed as TravelItinerary;
    // brand 고정
    if (itinerary.meta) itinerary.meta.brand = '여소남';
    console.log('[Parser] itinerary_data 추출 완료 — days:', itinerary.days?.length);
    return itinerary;
  } catch (err) {
    console.warn('[Parser] itinerary_data 추출 실패:', err instanceof Error ? err.message : err);
    return null;
  }
}
