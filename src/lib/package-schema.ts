/**
 * @file package-schema.ts
 * @description travel_packages 테이블의 **정규 Zod 스키마** (Single Source of Truth).
 *
 * 목적:
 * - DB/AI 파싱 결과/UI 렌더링이 이 스키마 하나만 공유하도록 만든다.
 * - INSERT 전에 `PackageStrictSchema.parse()`로 강제 검증 → 통과 못하면 draft 격리.
 * - 레거시 레코드는 `package-acl.ts`의 `normalizePackage()`로 먼저 정규화 후 검증.
 *
 * 원칙:
 * - 새 필드 추가 시 여기서 먼저 정의 → `database.ts`/UI 타입이 자동 일치 (z.infer)
 * - 렌더러는 `z.infer<typeof PackageStrictSchema>` 타입만 받도록 변경 권장
 */

import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════════
//  Sub-schemas — 작은 단위부터 정의
// ═══════════════════════════════════════════════════════════════════════════

/** 사진 신형식 — 렌더러가 실제로 소비하는 필드 */
export const PhotoSchema = z.object({
  src_medium: z.string().url('src_medium은 http(s) URL'),
  src_large: z.string().url('src_large는 http(s) URL'),
  photographer: z.string().default(''),
  pexels_id: z.number().int().nonnegative().default(0),
  alt: z.string().optional(),
});
export type Photo = z.infer<typeof PhotoSchema>;

/** 지역 enum — itinerary-render.ts의 REGION_ALIAS와 동기화 */
export const RegionEnum = z.enum([
  '말레이시아', '싱가포르', '태국', '베트남', '대만', '일본',
  '중국', '라오스', '몽골', '필리핀', '인도네시아',
]);
export type Region = z.infer<typeof RegionEnum>;

/** 선택관광 — region 필수 (단, "쿠알라 야경투어"처럼 이름에 지역 있으면 ACL이 자동 주입) */
export const OptionalTourSchema = z.object({
  name: z.string().min(1, 'name 필수'),
  region: RegionEnum.nullable(),
  price: z.string().nullable().optional(),          // "$50/인" 등 원문 폼
  price_usd: z.number().nullable().optional(),
  price_krw: z.number().nullable().optional(),
  note: z.string().nullable().optional(),
  day: z.number().int().nullable().optional(),      // 투어가 가능한 일차
});
export type OptionalTour = z.infer<typeof OptionalTourSchema>;

/** 식사 정보 — 기존 호환 */
export const MealsSchema = z.object({
  breakfast: z.boolean().optional(),
  lunch: z.boolean().optional(),
  dinner: z.boolean().optional(),
  breakfast_note: z.string().nullable().optional(),
  lunch_note: z.string().nullable().optional(),
  dinner_note: z.string().nullable().optional(),
}).partial();

/** 호텔 정보 */
export const HotelSchema = z.object({
  name: z.string().nullable(),                      // null = 당일 이동 등
  grade: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
}).nullable();

/** 스케줄 아이템 타입 enum */
export const ScheduleItemTypeEnum = z.enum([
  'normal', 'optional', 'shopping', 'flight', 'train', 'meal', 'hotel',
]);

/** 스케줄 아이템 */
export const ScheduleItemSchema = z.object({
  time: z.string().nullable().optional(),
  activity: z.string().min(1, 'activity는 빈 문자열 금지'),
  transport: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  type: ScheduleItemTypeEnum.optional().default('normal'),
  badge: z.string().nullable().optional(),
});
export type ScheduleItem = z.infer<typeof ScheduleItemSchema>;

/** 일정 하루 */
export const DayScheduleSchema = z.object({
  day: z.number().int().min(1, 'day는 1 이상'),
  regions: z.array(z.string()).default([]),
  meals: MealsSchema.optional(),
  schedule: z.array(ScheduleItemSchema).default([]),
  hotel: HotelSchema.optional(),
});
export type DaySchedule = z.infer<typeof DayScheduleSchema>;

/** 써차지 객체 — ERR-20260418-03 구조 */
export const SurchargeSchema = z.object({
  name: z.string().optional(),
  start: z.string().optional(),       // "YYYY-MM-DD"
  end: z.string().optional(),
  amount: z.number().optional(),
  currency: z.enum(['KRW', 'USD']).optional(),
  unit: z.string().optional(),         // "인/박" 등
});

/** 가격 날짜 (확정일 포함) */
export const PriceDateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 형식'),
  price: z.number().positive('price는 양수'),
  child_price: z.number().nonnegative().optional(),
  confirmed: z.boolean().default(false),
});

/** 가격 티어 (레거시 + 기간형) */
export const PriceTierSchema = z.object({
  period_label: z.string().optional(),
  departure_dates: z.array(z.string()).optional(),
  departure_day_of_week: z.string().optional(),
  date_range: z.object({ start: z.string(), end: z.string() }).optional(),
  adult_price: z.number().nonnegative().optional(),
  child_price: z.number().nonnegative().optional(),
  status: z.enum(['available', 'soldout', 'confirmed']).optional(),
  note: z.string().optional(),
});

/** 유의사항 구조화 타입 */
export const NoticeItemSchema = z.object({
  type: z.enum(['CRITICAL', 'PAYMENT', 'POLICY', 'INFO']),
  title: z.string(),
  text: z.string(),
});

// ═══════════════════════════════════════════════════════════════════════════
//  departure_days — JSON 배열 문자열 방어
// ═══════════════════════════════════════════════════════════════════════════

/**
 * departure_days 포맷 — 두 버전으로 나눔:
 *
 * **Strict (LLM Structured Output용)**: 정규 평문만 허용. AI 파서에 이 regex를 주입.
 * **Loose (기존 DB 레거시 허용)**: JSON 배열 문자열만 거부, 나머지 자연어 허용.
 *
 * `.refine()`은 zod-to-json-schema에서 누락되므로 regex 방식.
 */
export const DepartureDaysStrictSchema = z.string()
  .regex(
    /^(매일|[월화수목금토일](?:[\/,\s][월화수목금토일])*|매주\s*[월화수목금토일][월화수목금토일\/요일,\s]*)$/,
    'departure_days는 정규 평문 ("월/수", "매주 금요일", "매일"). JSON 배열 금지.',
  );

/**
 * Loose — 기존 DB 데이터 수용.
 * - JSON 배열 문자열(`["금"]`)만 거부 (UI 누출 위험)
 * - 그 외: "매일출발", "월, 화, 수", "5/9, 5/26" 등 자연어 모두 허용
 */
export const DepartureDaysLooseSchema = z.string()
  .regex(
    /^(?!\[).+(?<!\])$/,
    'departure_days는 JSON 배열 문자열이 아닌 평문이어야 함',
  )
  .nullable();

// 기본 export는 Loose (DB 호환) — Strict는 LLM/신규 파싱 전용
export const DepartureDaysSchema = DepartureDaysLooseSchema;

// ═══════════════════════════════════════════════════════════════════════════
//  Top-level Package schema
// ═══════════════════════════════════════════════════════════════════════════

/** Package 핵심 필드 (INSERT/UPDATE 시 검증) */
export const PackageCoreSchema = z.object({
  title: z.string().min(1, 'title 필수'),
  destination: z.string().min(1, 'destination 필수'),
  duration: z.number().int().positive().optional(),
  airline: z.string().nullable().optional(),
  departure_airport: z.string().nullable().optional(),
  departure_days: DepartureDaysSchema.optional(),
  min_participants: z.number().int().positive().nullable().optional(),
  ticketing_deadline: z.string().nullable().optional(),

  // 가격
  price_tiers: z.array(PriceTierSchema).default([]),
  price_dates: z.array(PriceDateSchema).default([]),
  excluded_dates: z.array(z.string()).default([]),
  confirmed_dates: z.array(z.string()).default([]),

  // 포함/불포함/추가요금
  inclusions: z.array(z.string()).default([]),
  excludes: z.array(z.string()).default([]),
  surcharges: z.array(SurchargeSchema).default([]),
  optional_tours: z.array(OptionalTourSchema).default([]),

  // 일정
  itinerary_data: z.union([
    z.array(DayScheduleSchema),
    z.object({ days: z.array(DayScheduleSchema) }),
    z.null(),
  ]).optional(),

  // 유의사항
  notices_parsed: z.array(z.union([z.string(), NoticeItemSchema])).default([]),
  special_notes: z.string().nullable().optional(),
  product_highlights: z.array(z.string()).default([]),

  // 메타
  product_type: z.string().nullable().optional(),
  // 실제 운영 중인 status 값 전체 (레거시 + 신규 워크플로우 모두 수용)
  status: z.enum([
    'draft',            // Zod 검증 실패 또는 사람 검수 대기
    'validated',        // Zod 통과, 아직 공개 전
    'published',        // 고객 노출 중 (신규 워크플로우)
    'pending',          // 검토 대기 (레거시)
    'pending_review',   // 검토 대기 (레거시 변형)
    'pending_replace',  // 🆕 기존 상품 라이브 유지 + 신규는 완전성 부족으로 보류 (ERR-KUL-safe-replace)
    'approved',         // 승인 (레거시 → published 전환 대상)
    'active',           // 활성 (레거시 → published 전환 대상)
    'available',        // 구매 가능 (레거시)
    'archived',         // 소프트 삭제
  ]).default('draft'),
});

/** 전체 Package (validated 상태에서 써야 하는 최소 요구) */
export const PackageStrictSchema = PackageCoreSchema.extend({
  // validated 상태에서는 더 엄격한 조건
  itinerary_data: z.union([
    z.array(DayScheduleSchema).min(1, '최소 1일 일정 필수'),
    z.object({ days: z.array(DayScheduleSchema).min(1) }),
  ]),
  // 적어도 price_tiers나 price_dates 중 하나는 있어야 함
}).superRefine((pkg, ctx) => {
  const hasTiers = (pkg.price_tiers?.length ?? 0) > 0;
  const hasDates = (pkg.price_dates?.length ?? 0) > 0;
  if (!hasTiers && !hasDates) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'price_tiers 또는 price_dates 중 최소 하나는 필수',
      path: ['price_tiers'],
    });
  }

  // duration vs itinerary_data.days.length 일치 (W19)
  if (pkg.duration && pkg.itinerary_data) {
    const days = Array.isArray(pkg.itinerary_data)
      ? pkg.itinerary_data
      : pkg.itinerary_data.days;
    if (days.length > 0 && days.length !== pkg.duration) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `일차 수 불일치: duration=${pkg.duration} vs days.length=${days.length} (W19)`,
        path: ['itinerary_data'],
      });
    }
  }
});

export type PackageCore = z.infer<typeof PackageCoreSchema>;
export type PackageStrict = z.infer<typeof PackageStrictSchema>;

// ═══════════════════════════════════════════════════════════════════════════
//  Validation helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 느슨한 검증 — draft 상태로 저장할 때 사용 (최소 기본 필드만)
 * ACL로 미리 정규화 후 호출 권장.
 */
export function validatePackageLoose(input: unknown): {
  success: boolean;
  data?: PackageCore;
  errors?: z.ZodIssue[];
} {
  const result = PackageCoreSchema.safeParse(input);
  if (result.success) return { success: true, data: result.data };
  return { success: false, errors: result.error.issues };
}

/**
 * 엄격 검증 — published/validated 상태로 올릴 때 사용
 */
export function validatePackageStrict(input: unknown): {
  success: boolean;
  data?: PackageStrict;
  errors?: z.ZodIssue[];
} {
  const result = PackageStrictSchema.safeParse(input);
  if (result.success) return { success: true, data: result.data };
  return { success: false, errors: result.error.issues };
}

/** 친화적 에러 메시지 생성 (디버깅/어드민 UI용) */
export function formatZodErrors(errors: z.ZodIssue[]): string[] {
  return errors.map(issue => {
    const path = issue.path.length > 0 ? `[${issue.path.join('.')}] ` : '';
    return `${path}${issue.message}`;
  });
}
