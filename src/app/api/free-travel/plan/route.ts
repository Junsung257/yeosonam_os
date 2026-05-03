/**
 * POST /api/free-travel/plan  — SSE 스트리밍 버전
 *
 * 각 단계 완료 시 즉시 클라이언트에 push:
 *   status   → 진행 메시지 (실제 진행 중계, 가짜 아님)
 *   params   → AI 추출 파라미터
 *   flights  → 항공 결과
 *   hotels   → 숙박 결과
 *   activities → 액티비티 결과
 *   comparison → Decoy 패키지 비교
 *   summary  → AI 코멘트
 *   done     → 세션 ID + 만료 시각 (공유 링크 복원용 TTL 7일)
 *   error    → 오류 메시지
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { llmCall } from '@/lib/llm-gateway';
import { aggregator } from '@/lib/travel-providers';
import { buildMylinkUrl } from '@/lib/travel-providers/mrt';
import type { FlightResult, StayResult, ActivityResult } from '@/lib/travel-providers/types';
import { computeActivityEstimateFromDayPlans } from '@/lib/free-travel/itinerary-schema';
import { loadReferenceAndScore } from '@/lib/free-travel/itinerary-composition-score';
import { generateDayPlansWithLlmOrFallback } from '@/lib/free-travel/itinerary-llm';

/** 견적 세션·공유 링크 유효 기간 (기존 15분 → 링크 복원·CS 대응용 7일) */
const PLAN_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ─── 요청 스키마 ──────────────────────────────────────────────────────────────

const RequestSchema = z.object({
  message:       z.string().min(1),
  sessionId:     z.string().uuid().optional(),
  requestId:     z.string().uuid().optional(),
  customerPhone: z.string().optional(),
  customerName:  z.string().optional(),
  /** 플래너 화면에서 고른 값(추출값보다 우선 저장·일정에 반영) */
  plannerPreferences: z
    .object({
      companionType:   z.string().optional(),
      hotelBudgetBand: z.string().optional(),
      travelPace:      z.string().optional(),
    })
    .optional(),
});

// ─── AI 추출 스키마 ───────────────────────────────────────────────────────────

const ExtractSchema = z.object({
  departure:       z.string().default('PUS'),
  destination:     z.string(),
  destinationIata: z.string().optional(),
  dateFrom:        z.string(),
  dateTo:          z.string(),
  nights:          z.number().int().positive(),
  adults:          z.number().int().min(1).default(2),
  children:        z.number().int().min(0).default(0),
  skipFlights:     z.boolean().default(false),
  companionType:   z.string().optional(),
  hotelBudgetBand: z.string().optional(),
  travelPace:      z.string().optional(),
});

const ExtractJsonSchema = {
  type: 'object',
  properties: {
    departure: { type: 'string' },
    destination: { type: 'string' },
    destinationIata: { type: 'string' },
    dateFrom: { type: 'string' },
    dateTo: { type: 'string' },
    nights: { type: 'number' },
    adults: { type: 'number' },
    children: { type: 'number' },
    skipFlights: { type: 'boolean' },
    companionType: { type: 'string' },
    hotelBudgetBand: { type: 'string' },
    travelPace: { type: 'string' },
  },
  required: ['destination', 'dateFrom', 'dateTo', 'nights'],
} as const;

// ─── IATA 매핑 ───────────────────────────────────────────────────────────────

const DEPARTURE_MAP: Record<string, string> = {
  '부산': 'PUS', '김해': 'PUS', '인천': 'ICN', '서울': 'ICN',
  '김포': 'GMP', '제주': 'CJU', '대구': 'TAE', '청주': 'CJJ',
};

const DESTINATION_MAP: Record<string, string> = {
  '다낭': 'DAD', '베트남': 'DAD', '하노이': 'HAN', '호치민': 'SGN',
  '방콕': 'BKK', '태국': 'BKK', '푸켓': 'HKT',
  '도쿄': 'NRT', '일본': 'NRT', '오사카': 'KIX', '후쿠오카': 'FUK',
  '나고야': 'NGO', '삿포로': 'CTS', '오키나와': 'OKA',
  '도야마': 'TOY', '가나자와': 'KMQ', '히로시마': 'HIJ',
  '싱가포르': 'SIN', '발리': 'DPS', '홍콩': 'HKG',
  '대만': 'TPE', '타이페이': 'TPE', '괌': 'GUM', '사이판': 'SPN',
  '세부': 'CEB', '필리핀': 'CEB', '코타키나발루': 'BKI',
};

const FLIGHT_SKIP_KEYWORDS = ['항공권 구매완료', '항공 구매완료', '비행기 예약 완료', '항공권 이미', '항공 이미', '전세기 항공권은 구매완료'];

function toIsoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseMessageFallback(message: string) {
  const now = new Date();
  const year = now.getFullYear();
  const compact = message.replace(/\s+/g, ' ').trim();

  let destination: string | null = null;
  for (const key of Object.keys(DESTINATION_MAP).sort((a, b) => b.length - a.length)) {
    if (compact.includes(key)) {
      destination = key;
      break;
    }
  }

  const departureMatch = Object.keys(DEPARTURE_MAP).find(k => compact.includes(k));
  const departure = departureMatch ?? '부산';

  const adultsMatch = compact.match(/성인\s*(\d+)/);
  const childrenMatch = compact.match(/(?:아동|소아|아이|어린이)\s*(\d+)/);
  const adults = adultsMatch ? Math.max(1, parseInt(adultsMatch[1], 10)) : 2;
  const children = childrenMatch ? Math.max(0, parseInt(childrenMatch[1], 10)) : 0;

  let dateFrom: string | null = null;
  let dateTo: string | null = null;
  const m1 = compact.match(/(\d{1,2})\s*\/\s*(\d{1,2})\s*[~\-]\s*(\d{1,2})\s*\/\s*(\d{1,2})/);
  if (m1) {
    dateFrom = toIsoDate(year, parseInt(m1[1], 10), parseInt(m1[2], 10));
    dateTo = toIsoDate(year, parseInt(m1[3], 10), parseInt(m1[4], 10));
  } else {
    const m2 = compact.match(/(\d{1,2})\s*\/\s*(\d{1,2})\s*[~\-]\s*(\d{1,2})/);
    if (m2) {
      dateFrom = toIsoDate(year, parseInt(m2[1], 10), parseInt(m2[2], 10));
      dateTo = toIsoDate(year, parseInt(m2[1], 10), parseInt(m2[3], 10));
    }
  }

  const skipFlights = FLIGHT_SKIP_KEYWORDS.some(k => compact.includes(k));
  const roomPlanMatch = compact.match(/(성인\s*\d+\s*(?:\+\s*(?:아동|소아|아이|어린이)\s*\d+)?(?:\s*,\s*성인\s*\d+\s*(?:\+\s*(?:아동|소아|아이|어린이)\s*\d+)?)*)/);
  const roomPlan = roomPlanMatch?.[1]?.replace(/\s+/g, ' ').trim() ?? null;

  return { destination, departure, adults, children, dateFrom, dateTo, skipFlights, roomPlan };
}

function fallbackHotels(destination: string): StayResult[] {
  const map: Record<string, Array<{ name: string; location: string; price: number }>> = {
    도야마: [
      { name: 'ANA 크라운 플라자 도야마', location: '도야마역 인근', price: 180000 },
      { name: '도야마 엑셀 호텔 도큐', location: '시내 중심', price: 150000 },
      { name: '오야도 노노 도야마', location: '온천형 비즈니스 호텔', price: 170000 },
      { name: '더블트리 바이 힐튼 도야마', location: '역세권', price: 220000 },
    ],
  };

  const picks = map[destination] ?? [
    { name: `${destination} 시내 패밀리 호텔`, location: `${destination} 중심`, price: 160000 },
    { name: `${destination} 온천 리조트`, location: `${destination} 외곽`, price: 210000 },
    { name: `${destination} 역세권 비즈니스 호텔`, location: `${destination}역 인근`, price: 140000 },
  ];

  return picks.map((h, idx) => ({
    providerId: `fallback-hotel-${idx}`,
    provider: 'yeosonam',
    providerUrl: '',
    name: h.name,
    pricePerNight: h.price,
    currency: 'KRW',
    location: h.location,
    bookableViaYeosonam: false,
  }));
}

function fallbackActivities(destination: string): ActivityResult[] {
  const map: Record<string, Array<{ name: string; category: string; price: number; duration: string }>> = {
    도야마: [
      { name: '도야마성 공원 & 유리미술관 투어', category: 'culture', price: 39000, duration: '반일' },
      { name: '우오즈 수족관 + 바다전망 산책', category: 'family', price: 29000, duration: '반일' },
      { name: '다카야마 구시가지 당일치기', category: 'culture', price: 79000, duration: '종일' },
      { name: '도야마만 해산물 시장 미식 투어', category: 'food', price: 49000, duration: '3시간' },
    ],
  };

  const picks = map[destination] ?? [
    { name: `${destination} 시내 워킹 투어`, category: 'culture', price: 35000, duration: '3시간' },
    { name: `${destination} 가족형 테마 액티비티`, category: 'family', price: 42000, duration: '반일' },
    { name: `${destination} 근교 당일치기`, category: 'culture', price: 76000, duration: '종일' },
  ];

  return picks.map((a, idx) => ({
    providerId: `fallback-activity-${idx}`,
    provider: 'yeosonam',
    providerUrl: '',
    name: a.name,
    category: a.category,
    price: a.price,
    currency: 'KRW',
    duration: a.duration,
    bookableViaYeosonam: false,
  }));
}

// ─── SSE 헬퍼 ────────────────────────────────────────────────────────────────

function makeEncoder(controller: ReadableStreamDefaultController) {
  const enc = new TextEncoder();
  return function send(event: string, data: unknown) {
    controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  };
}

// ─── 핸들러 ──────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const body = await request.json();
  const reqParsed = RequestSchema.safeParse(body);
  if (!reqParsed.success) {
    const rid = crypto.randomUUID();
    return new Response(
      `event: error\ndata: ${JSON.stringify({ requestId: rid, code: 'VALIDATION_ERROR', message: '요청 형식 오류' })}\n\n`,
      { status: 400, headers: { 'Content-Type': 'text/event-stream' } },
    );
  }
  const req = reqParsed.data;
  const requestId = req.requestId ?? crypto.randomUUID();

  const stream = new ReadableStream({
    async start(controller) {
      const send = makeEncoder(controller);
      const sendWithRequestId = (event: string, data: Record<string, unknown>) => {
        send(event, { requestId, ...data });
      };
      const heartbeat = setInterval(() => {
        sendWithRequestId('status', { step: 'heartbeat', message: '실시간 검색 상태를 확인하는 중...' });
      }, 5000);

      try {
        // ── Step 1: AI 파라미터 추출 ─────────────────────────────────────────
        sendWithRequestId('status', { step: 'params', message: '여행 정보를 분석하는 중...' });

        const extractResult = await llmCall<z.infer<typeof ExtractSchema>>({
          task: 'free-travel-extract',
          systemPrompt: `당신은 여행 검색 파라미터 추출 전문가입니다.
사용자의 자연어 메시지에서 여행 파라미터를 추출하여 아래 JSON 형식으로만 반환하세요. 마크다운·설명 금지.
오늘 날짜: ${new Date().toISOString().slice(0, 10)}

JSON 필드:
- departure: 출발지 한글 도시명 (기본값: "부산"). 예) "부산", "서울", "인천"
- destination: 목적지 한글 도시명 (필수)
- dateFrom: 출발일 YYYY-MM-DD (상대일자 → 오늘 기준 계산)
- dateTo: 귀국일 YYYY-MM-DD
- nights: dateTo - dateFrom 일수 (정수)
- adults: 성인 수 (기본값: 2). 인원 미기재 시 2
- children: 어린이 수 (기본값: 0)
- skipFlights: 사용자가 "항공 이미 결제", "비행기 예약 완료" 등 항공권 구매 완료를 언급하면 true, 아니면 false
- companionType: 동반 유형(예: 커플/아이동반/부모님/친구)
- hotelBudgetBand: 호텔 예산 밴드(예: 10만원대/20-30만원대/럭셔리)
- travelPace: 여행 속도(여유/보통/빡빡)

날짜 형식 예시: "5/7~10" → dateFrom: "${new Date().getFullYear()}-05-07", dateTo: "${new Date().getFullYear()}-05-10", nights: 3`,
          userPrompt: req.message,
          jsonSchema: ExtractJsonSchema,
          maxTokens: 500,
          temperature: 0.1,
        });

        // llmCall은 jsonSchema 미전달 시 rawText만 반환하므로 JSON 파싱 fallback 적용
        let extractedData: unknown = extractResult.data;
        if (!extractedData && extractResult.rawText) {
          const match = extractResult.rawText.match(/\{[\s\S]*\}/);
          if (match) {
            try { extractedData = JSON.parse(match[0]); } catch { /* fall through */ }
          }
        }

        if (!extractResult.success || !extractedData) {
          sendWithRequestId('error', { code: 'PARSING_FAILED', message: '여행 일정 파싱 실패. 날짜·출발지·목적지·인원을 포함해 다시 입력해주세요.' });
          controller.close();
          return;
        }

        const paramsParsed = ExtractSchema.safeParse(extractedData);
        if (!paramsParsed.success) {
          sendWithRequestId('error', { code: 'PARAMS_INVALID', message: '파라미터 추출 실패. 날짜·출발지·목적지·인원을 명시해주세요.' });
          controller.close();
          return;
        }

        const params = paramsParsed.data;
        const clientPref = req.plannerPreferences;
        const effectiveCompanion =
          clientPref?.companionType?.trim() || params.companionType || null;
        const effectiveBudget =
          clientPref?.hotelBudgetBand?.trim() || params.hotelBudgetBand || null;
        const effectivePace =
          clientPref?.travelPace?.trim() || params.travelPace || null;
        const fallback = parseMessageFallback(req.message);
        const normalizedDestination = fallback.destination ?? params.destination;
        const normalizedDateFrom = fallback.dateFrom ?? params.dateFrom;
        const normalizedDateTo = fallback.dateTo ?? params.dateTo;
        const fromMs = new Date(normalizedDateFrom).getTime();
        const toMs = new Date(normalizedDateTo).getTime();
        const diffNights = Math.round((toMs - fromMs) / 86400_000);
        const normalizedNights =
          Number.isFinite(diffNights) && diffNights > 0
            ? diffNights
            : Math.max(1, params.nights);
        const normalizedAdults = fallback.adults || params.adults;
        const normalizedChildren = fallback.children ?? params.children;
        const normalizedSkipFlights = params.skipFlights || fallback.skipFlights;
        const departureIata    = DEPARTURE_MAP[params.departure] ?? params.departure;
        const destinationIata  = params.destinationIata ?? DESTINATION_MAP[normalizedDestination] ?? normalizedDestination;

        sendWithRequestId('params', {
          departure:       departureIata,
          destination:     normalizedDestination,
          destinationIata,
          dateFrom:        normalizedDateFrom,
          dateTo:          normalizedDateTo,
          nights:          normalizedNights,
          adults:          normalizedAdults,
          children:        normalizedChildren,
          skipFlights:     normalizedSkipFlights,
          companionType:   effectiveCompanion,
          hotelBudgetBand: effectiveBudget,
          travelPace:      effectivePace,
        });

        // ── Step 2: 병렬 OTA 검색 (결과마다 즉시 push) ───────────────────────
        sendWithRequestId('status', { step: 'search', message: normalizedSkipFlights ? '호텔·액티비티 검색 중...' : '실시간 항공권·호텔·액티비티 검색 중...' });

        const sessionId = req.sessionId ?? crypto.randomUUID();
        let flights:    FlightResult[]   = [];
        let hotels:     StayResult[]     = [];
        let activities: ActivityResult[] = [];

        const searchTasks: Promise<void>[] = [];

        // 항공 이미 결제된 경우 항공 검색 스킵
        if (!normalizedSkipFlights) {
          searchTasks.push(
            aggregator.searchFlights({
              departure:   departureIata,
              destination: destinationIata,
              dateFrom:    normalizedDateFrom,
              dateTo:      normalizedDateTo,
              adults:      normalizedAdults,
              children:    normalizedChildren,
              tripType:    'RT',
            }).then(r => {
              flights = r.results.slice(0, 5);
              flights = flights.map(f => ({
                ...f,
                affiliateLink: f.providerUrl ? buildMylinkUrl(f.providerUrl, sessionId) : undefined,
              }));
              sendWithRequestId('flights', { items: flights, providerErrors: r.errors ?? [] });
            }),
          );
        } else {
          sendWithRequestId('flights', { items: [], providerErrors: [] });
        }

        // Promise.allSettled: 한 카테고리 실패해도 나머지 결과는 정상 push
        await Promise.allSettled([
          ...searchTasks,
          aggregator.searchStays({
            destination: normalizedDestination,
            checkIn:     normalizedDateFrom,
            checkOut:    normalizedDateTo,
            adults:      normalizedAdults,
            children:    normalizedChildren,
          }).then(r => {
            hotels = r.results.slice(0, 5);
            hotels = hotels.map(h => ({
              ...h,
              affiliateLink: h.providerUrl ? buildMylinkUrl(h.providerUrl, sessionId) : undefined,
            }));
            sendWithRequestId('hotels', { items: hotels, providerErrors: r.errors ?? [] });
          }),

          aggregator.searchActivities({
            destination: normalizedDestination,
            limit:       10,
          }).then(r => {
            activities = r.results.slice(0, 8).map(a => ({
              ...a,
              affiliateLink: a.providerUrl ? buildMylinkUrl(a.providerUrl, sessionId) : undefined,
            }));
            sendWithRequestId('activities', { items: activities, providerErrors: r.errors ?? [] });
          }),
        ]);

        if (hotels.length === 0) {
          hotels = fallbackHotels(normalizedDestination);
          sendWithRequestId('hotels', { items: hotels, providerErrors: [], estimated: true, generatedAt: new Date().toISOString() });
        }
        if (activities.length === 0) {
          activities = fallbackActivities(normalizedDestination);
          sendWithRequestId('activities', { items: activities, providerErrors: [], estimated: true, generatedAt: new Date().toISOString() });
        }

        // ── Step 3: Decoy 패키지 비교 ────────────────────────────────────────
        sendWithRequestId('status', { step: 'comparison', message: '여소남 패키지와 비교 중...' });

        const fallbackPkgs = await aggregator.getFallbackPackages(normalizedDestination);

        const hasAnyResults = flights.length > 0 || hotels.length > 0 || activities.length > 0;

        type FallbackPkg = { id: string; title: string; price_adult: number | null; product_highlights: unknown };
        const pkgs = fallbackPkgs as FallbackPkg[];

        sendWithRequestId('status', { step: 'itinerary', message: 'DeepSeek로 일정표를 구성하는 중...' });
        const itineraryBuilt = await generateDayPlansWithLlmOrFallback({
          destination:       normalizedDestination,
          dateFrom:          normalizedDateFrom,
          nights:            normalizedNights,
          hotels,
          activities,
          hotelBudgetBand: effectiveBudget,
          travelPace:      effectivePace,
          companionType:   effectiveCompanion,
          userMessage:     req.message,
        });
        const dayPlans          = itineraryBuilt.dayPlans;
        const itinerarySource   = itineraryBuilt.source;
        const itineraryLlmError = itineraryBuilt.error;

        const itineraryScore = await loadReferenceAndScore(
          normalizedDestination,
          dayPlans,
          effectivePace,
        );

        const actEst     = computeActivityEstimateFromDayPlans(dayPlans, normalizedAdults);
        const flightMin  = (flights[0]?.price ?? 0) * (normalizedAdults + normalizedChildren);
        const hotelMin   = (hotels[0]?.pricePerNight ?? 0) * normalizedNights * Math.ceil((normalizedAdults + normalizedChildren) / 2);
        const totalMin   = flightMin + hotelMin + actEst;
        const totalMax   = ((flights[4]?.price ?? flights[0]?.price ?? 0) * (normalizedAdults + normalizedChildren))
                         + ((hotels[4]?.pricePerNight ?? hotels[0]?.pricePerNight ?? 0) * normalizedNights * Math.ceil((normalizedAdults + normalizedChildren) / 2))
                         + actEst * 1.5;

        const comparison = !hasAnyResults
          ? { totalMin: 0, totalMax: 0, available: false, packages: [], message: '검색 결과가 없어 비교를 표시할 수 없습니다.' }
          : {
              totalMin,
              totalMax,
              available: pkgs.length > 0,
              packages: pkgs.map(p => ({
                id:        p.id,
                title:     p.title,
                price:     (p.price_adult ?? 0) * normalizedAdults,
                highlights: (p.product_highlights as string[] | null) ?? [],
                savings:   Math.max(0, totalMin - (p.price_adult ?? 0) * normalizedAdults),
              })),
              message: pkgs.length > 0
                ? `여소남 패키지로 예약하면 최대 ${Math.max(0, ...pkgs.map(p => totalMin - (p.price_adult ?? 0) * normalizedAdults)).toLocaleString()}원 절약!`
                : '자유여행 최저가로 구성해드렸습니다.',
              quoteBreakdown: {
                flights: flightMin,
                hotels: hotelMin,
                activities: actEst,
                hotelNightlyAverage: hotels[0]?.pricePerNight ?? 0,
                occupancyRooms: Math.ceil((normalizedAdults + normalizedChildren) / 2),
              },
            };
        sendWithRequestId('comparison', comparison as unknown as Record<string, unknown>);
        sendWithRequestId('itinerary', {
          dayPlans,
          itineraryScore,
          itinerarySource,
          ...(itineraryLlmError ? { itineraryLlmError } : {}),
        });

        // ── Step 4: AI 코멘트 ─────────────────────────────────────────────────
        sendWithRequestId('status', { step: 'ai', message: 'AI 맞춤 코멘트 작성 중...' });

        const composeResult = await llmCall<{ summary: string }>({
          task: 'free-travel-compose',
          systemPrompt: `당신은 여소남의 자유여행 플래너입니다.
검색 결과를 바탕으로 고객에게 친근하고 구체적인 한국어 여행 추천 코멘트를 작성하세요.
- 4~6문장, 이모지 1~2개 사용 가능
- skipFlights가 true면 "항공권은 이미 확보하셨군요!"로 시작, 호텔·액티비티 위주로 추천
- 항공편(skipFlights=false일 때)·호텔·액티비티 하이라이트 포함
- 최소 1개의 "추천 일정(일자별 코스·시장·랜드마크)"을 포함 — 투어 판매보다 일정 구성 조언이 우선
- 여소남 패키지가 있으면 마지막에 자연스럽게 언급
- 날씨·기후 이야기는 하지 마세요. 대신 일정 구성 만족도(itineraryComposition)가 있으면 한 문장으로만 언급 가능`,
          userPrompt: JSON.stringify({
            destination:      normalizedDestination,
            nights:           normalizedNights,
            adults:           normalizedAdults,
            children:         normalizedChildren,
            roomPlan:         fallback.roomPlan,
            skipFlights:      normalizedSkipFlights,
            topFlight:        !normalizedSkipFlights && flights[0] ? `${flights[0].airline} ${flights[0].price.toLocaleString()}원` : null,
            topHotel:         hotels[0]  ? `${hotels[0].name} 1박 ${hotels[0].pricePerNight.toLocaleString()}원` : null,
            activities:       activities.slice(0, 3).map(a => a.name),
            totalMin,
            packageAvailable: comparison.available,
            itineraryComposition: {
              score: itineraryScore.score,
              label: itineraryScore.label,
              referencePackagesUsed: itineraryScore.referencePackagesUsed,
            },
          }),
          maxTokens: 400,
          temperature: 0.7,
        });

        const aiSummary = composeResult.success
          ? (composeResult.data?.summary ?? composeResult.rawText ?? '')
          : `${normalizedDestination} ${normalizedNights}박 자유여행 견적을 준비했습니다.`;

        sendWithRequestId('summary', { text: aiSummary });

        // ── Step 5: 세션 저장 ─────────────────────────────────────────────────
        const expiresAt = new Date(Date.now() + PLAN_SESSION_TTL_MS).toISOString();

        if (isSupabaseConfigured && supabaseAdmin) {
          await supabaseAdmin.from('free_travel_sessions').upsert({
            id:              sessionId,
            customer_phone:  req.customerPhone ?? null,
            customer_name:   req.customerName  ?? null,
            destination:     normalizedDestination,
            departure:       departureIata,
            date_from:       normalizedDateFrom,
            date_to:         normalizedDateTo,
            pax_adults:      normalizedAdults,
            pax_children:    normalizedChildren,
            plan_json:       {
              flights,
              hotels,
              activities,
              comparison,
              dayPlans,
              aiSummary,
              itineraryScore,
              itinerarySource,
              plannerPreferences: {
                companionType:   effectiveCompanion,
                hotelBudgetBand: effectiveBudget,
                travelPace:      effectivePace,
              },
              ...(itineraryLlmError ? { itineraryLlmError } : {}),
            },
            plan_expires_at: expiresAt,
            source:          'web',
          }, { onConflict: 'id' });
        }

        sendWithRequestId('done', {
          sessionId,
          expiresAt,
          persisted: Boolean(isSupabaseConfigured && supabaseAdmin),
        });

      } catch (err) {
        sendWithRequestId('error', {
          code: 'PLAN_FAILED',
          message: err instanceof Error ? err.message : '처리 실패',
        });
      } finally {
        clearInterval(heartbeat);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection':    'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
