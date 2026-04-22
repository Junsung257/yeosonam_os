/**
 * @file intake-normalizer.ts — Phase 1.5 Intake Normalizer (IR) 스키마
 *
 * 원문 → NormalizedIntake(IR) → pkg 3단 파이프라인의 중간 규격.
 *
 * 원칙:
 *   1. Zod 로 구조 강제 (LLM 구조 환각 차단)
 *   2. 원문 보존 (rawTextHash + 각 segment 의 rawLabel)
 *   3. 관광지는 이름만 저장 (UUID 매핑은 ir-to-package.ts 에서 DB lookup)
 *   4. 상수(관광지 설명·사진)와 변수(특전·이동·부대설명)를 segment kind 로 분리
 *
 * 관련:
 *   - ERR-HSN-render-bundle (IR 도입 근본 해결)
 *   - project_block_master_system (tour_blocks/course_templates 와 연동)
 *   - feedback_register_full_autocomplete (자동 완수 원칙)
 */

import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════════
//  Flight / Meal / Segment 하위 스키마
// ═══════════════════════════════════════════════════════════════════════════

export const FlightEndpointSchema = z.object({
  airport: z.string().describe('공항 이름 (예: 인천, 김해, 황산 툰시)'),
  time: z.string().describe('시간 HH:MM (예: 10:30)'),
});

export const FlightSegmentSchema = z.object({
  code: z.string().describe('항공편명 (예: BX3615)'),
  departure: FlightEndpointSchema,
  arrival: FlightEndpointSchema,
});

export const MealBlockSchema = z.object({
  breakfast: z.boolean(),
  breakfastNote: z.string().nullable(),
  lunch: z.boolean(),
  lunchNote: z.string().nullable(),
  dinner: z.boolean(),
  dinnerNote: z.string().nullable(),
});

export const SegmentKindSchema = z.enum([
  'attraction',    // 관광지 (DB lookup 대상)
  'transit',       // 이동
  'note',          // 부대 설명 (앞 attraction 에 attachedToIndex 로 연결)
  'special',       // 특전 (♡, ♦ 등 강조 마커)
  'meal',          // 일정 흐름 중 식사 안내 (day.meals 는 summary, 이건 위치 기반 텍스트)
  'hotel-check',   // 호텔 체크인/아웃 동작 표기 (hotelName 은 day 레벨)
  'misc',          // 분류 실패 — unmatched_activities 에 큐잉
]);

/**
 * Segment — 일정 안의 한 블록.
 *
 * ★ day.meals (MealBlockSchema) vs segments[kind='meal'] 역할 분리:
 *    - day.meals  = bool 요약 (식사 아이콘·DB 필드용, Zod 강제)
 *    - segment    = 위치 기반 텍스트 ("호텔 조식 후..." 순서 보존용)
 *    중복 아니고 **보완 관계**. ir-to-package 가 둘을 동기화.
 */
export const SegmentSchema = z.object({
  kind: SegmentKindSchema,

  // For 'attraction' (관광지 매칭 실패 허용 — rawLabel + rawDescription 으로 원문 카드 렌더 가능)
  attractionNames: z.array(z.string()).optional().describe('관광지 이름 배열 (DB 의 name 이나 alias 와 매칭용). & 로 묶인 것도 개별 분리'),
  rawLabel: z.string().optional().describe('원문 그대로의 제목 토큰 — 블로그·카드뉴스 등 판매력 콘텐츠 원천'),
  rawDescription: z.string().optional().describe('원문 마케팅 설명 (예: "뾰족하게 솟은 바위의 양쪽으로 떨어지는..."). DB 매칭 실패 시 fallback 카드로 사용'),
  canonicalLabel: z.string().optional().describe('통제 어휘 라벨 (A4·모바일 렌더용). 미지정 시 attractionNames[0] 또는 rawLabel 사용'),
  subItems: z.array(z.string()).optional().describe('관광지 하위 세부 볼거리 (예: 패치워크 내 개별 나무)'),

  // For 'transit'
  to: z.string().optional().describe('이동 목적지'),
  durationText: z.string().optional().describe('이동 소요 시간 텍스트 (예: 약 2시간 10분)'),

  // For 'note' / 'special'
  text: z.string().optional(),
  icon: z.string().optional().describe('특전 배지용 아이콘 (♡, ♦, ★ 등)'),

  // For 'note' — 앞쪽 attraction 에 연결
  attachedToIndex: z.number().optional().describe('같은 day.segments 배열의 index 참조. 재배열 시 ir-to-package 가 재검증.'),

  // For 'meal'
  mealType: z.enum(['breakfast', 'lunch', 'dinner']).optional(),

  // For 'hotel-check'
  note: z.string().optional(),
});

// ═══════════════════════════════════════════════════════════════════════════
//  Surcharge / OptionalTour / Notice
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Surcharge — 추가요금 기간·단가 (pkg.surcharges 와 lossless 매핑)
 * ERR-20260418-03/14 — start/end/currency/unit 누락 방지
 */
export const SurchargeSchema = z.object({
  name: z.string().describe('써차지 이름 (예: 청명절, 노동절)'),
  start: z.string().nullable().describe('YYYY-MM-DD. 단일 이벤트면 start 만'),
  end: z.string().nullable().describe('YYYY-MM-DD. end 없으면 start 당일'),
  amount: z.number().describe('금액 (숫자만, 부호·통화기호 제외)'),
  currency: z.enum(['KRW', 'USD', 'CNY', 'JPY', 'EUR']).default('KRW'),
  unit: z.string().nullable().describe('단위 (인/박, 인, 룸당 등)'),
});

export const OptionalTourSchema = z.object({
  name: z.string(),
  region: z.string().describe('(싱가포르)/(말레이시아) 등 지역 라벨 — ERR-KUL-04 방어'),
  priceLabel: z.string().describe('표시용 가격 문자열 (예: "$45/인", "CNY 580/인")'),
  note: z.string().nullable(),
});

export const NoticeBlockSchema = z.object({
  type: z.enum(['INFO', 'CRITICAL', 'PAYMENT', 'POLICY', 'FLIGHT']),
  title: z.string(),
  text: z.string(),
});

// ═══════════════════════════════════════════════════════════════════════════
//  Price Groups — dateRange·dayOfWeek·departureDates 3가지 생성 방식
// ═══════════════════════════════════════════════════════════════════════════

export const PriceGroupSchema = z.object({
  label: z.string().describe('"5월 화 (19,26일)" 등 UI 라벨'),

  // 방식 A: 명시적 날짜 배열 (어셈블러·단일 특가용)
  dates: z.array(z.string()).nullable().describe('YYYY-MM-DD 배열. null 이면 dateRange+dayOfWeek 필수'),

  // 방식 B: 기간 + 요일 (주간 반복용, 예: "4월10일~5월29일 매주 화")
  dateRange: z.object({
    start: z.string(),
    end: z.string(),
  }).nullable().describe('YYYY-MM-DD'),
  dayOfWeek: z.enum(['월','화','수','목','금','토','일']).nullable(),

  adultPrice: z.number(),
  childPrice: z.number().nullable(),
  confirmed: z.boolean().describe('출발 확정 여부 — 원문에 "출확/출발확정" 있으면 true'),
  surchargeIncluded: z.boolean().default(false).describe('가격에 써차지 포함 여부 (예: "중국연휴 서차지 포함")'),
  surchargeNote: z.string().nullable().describe('써차지 포함 설명 (예: "중국 노동절 연휴 반영가")'),
});

// ═══════════════════════════════════════════════════════════════════════════
//  NormalizedIntake (IR) — 최상위 스키마
// ═══════════════════════════════════════════════════════════════════════════

export const NormalizedIntakeSchema = z.object({
  meta: z.object({
    landOperator: z.string().describe('랜드사 이름 (예: 베스트아시아, 투어폰, 랜드부산)'),
    region: z.string().describe('메인 여행지역 (예: 황산, 북해도, 다낭)'),
    country: z.string(),
    tripStyle: z.string().describe('예: 3박4일, 4박5일'),
    productType: z.enum(['실속','품격','고품격','노팁노옵션','노쇼핑','노팁풀옵션','골프','패키지']).describe('상품 타입'),
    commissionRate: z.number().describe('마진율 (%)'),
    ticketingDeadline: z.string().nullable().describe('YYYY-MM-DD. 원문에 "발권/예약 마감" 키워드 없으면 null (ERR-date-confusion)'),
    minParticipants: z.number().describe('최소 출발 인원 (원문 "N명 이상" 1:1 매핑, 템플릿 기본값 금지)'),
    departureAirport: z.string(),
    airline: z.string().describe('원문 표기 그대로 (예: BX(에어부산))'),
    departureDays: z.string().nullable().describe('출발 요일 평문 ("화", "월/수") — JSON 배열 금지 (ERR-KUL-01)'),
  }),

  flights: z.object({
    outbound: z.array(FlightSegmentSchema).describe('출발편 (경유 있을 수 있으므로 배열)'),
    inbound: z.array(FlightSegmentSchema).describe('귀국편'),
  }),

  priceGroups: z.array(PriceGroupSchema),

  hotels: z.array(z.object({
    name: z.string(),
    grade: z.string(),
    nights: z.number(),
  })),

  inclusions: z.array(z.string()).describe('포함 사항 — ★ 콤마 없는 개별 단일 토큰 (ERR-HSN W26)'),
  excludes: z.array(z.string()).describe('불포함 사항'),
  surcharges: z.array(SurchargeSchema),
  optionalTours: z.array(OptionalTourSchema),

  days: z.array(z.object({
    day: z.number(),
    regions: z.array(z.string()).describe('원문 "지역" 컬럼 1:1 매핑 (ERR-FUK-regions-copy 방어)'),
    flight: FlightSegmentSchema.nullable().describe('해당 일차의 항공 이동. 하루 최대 1개 (ERR-HSN W27)'),
    hotelName: z.string().nullable().describe('투숙 호텔 이름. root.hotels[].name 과 일치. 귀국일은 null'),
    meals: MealBlockSchema,
    segments: z.array(SegmentSchema).describe('7-kind segment 스트림 — 순서대로 렌더링'),
  })),

  notices: z.object({
    manual: z.array(NoticeBlockSchema).describe('원문 특약 (랜드사 작성)'),
    auto: z.array(NoticeBlockSchema).default([]).describe('terms-library resolver 가 meta 기반 자동 조립'),
  }),

  rawText: z.string().describe('원문 원본 (Rule Zero — 불변 보존)'),
  rawTextHash: z.string().describe('sha256(rawText) — 사후 변조 탐지'),
  normalizerVersion: z.string().describe('예: ir-normalizer-v1.0-sonnet-4.6'),
  extractedAt: z.string().describe('ISO timestamp'),
});

export type NormalizedIntake = z.infer<typeof NormalizedIntakeSchema>;
export type IntakeSegment = z.infer<typeof SegmentSchema>;
export type IntakePriceGroup = z.infer<typeof PriceGroupSchema>;
export type IntakeSurcharge = z.infer<typeof SurchargeSchema>;
export type IntakeNoticeBlock = z.infer<typeof NoticeBlockSchema>;
export type IntakeFlightSegment = z.infer<typeof FlightSegmentSchema>;

// ═══════════════════════════════════════════════════════════════════════════
//  검증 헬퍼
// ═══════════════════════════════════════════════════════════════════════════

export function validateIntake(input: unknown): {
  success: boolean;
  data?: NormalizedIntake;
  errors?: z.ZodIssue[];
} {
  const result = NormalizedIntakeSchema.safeParse(input);
  if (result.success) return { success: true, data: result.data };
  return { success: false, errors: result.error.issues };
}

/** 현재 Normalizer 버전 상수 — 프롬프트/LLM 변경 시 bump */
export const NORMALIZER_VERSION = 'ir-normalizer-v1.0-sonnet-4.6';
