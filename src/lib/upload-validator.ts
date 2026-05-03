/**
 * @file upload-validator.ts
 * @description Phase 2: Zod 기반 AI 파싱 결과 검증 + 가격 변환 유틸
 *
 * - ExtractedData Zod 검증 (AI 환각 방어)
 * - price_tiers / price_list → product_prices 행 변환
 * - 상태 결정 로직 (DRAFT vs REVIEW_NEEDED)
 */

import { z } from 'zod';
import type { ExtractedData, PriceTier, PriceListItem } from '@/lib/parser';
import type { ProductStatus } from '@/types/database';

// ─── 요일 매핑 ────────────────────────────────────────────────────────────────
const DOW_MAP: Record<string, 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN'> = {
  '월': 'MON', '화': 'TUE', '수': 'WED', '목': 'THU', '금': 'FRI', '토': 'SAT', '일': 'SUN',
  'mon': 'MON', 'tue': 'TUE', 'wed': 'WED', 'thu': 'THU', 'fri': 'FRI', 'sat': 'SAT', 'sun': 'SUN',
  'monday': 'MON', 'tuesday': 'TUE', 'wednesday': 'WED', 'thursday': 'THU',
  'friday': 'FRI', 'saturday': 'SAT', 'sunday': 'SUN',
};

// ─── Zod 스키마 ───────────────────────────────────────────────────────────────

/** 날짜 형식 검증 (YYYY-MM-DD) */
const DateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 형식이어야 합니다');

// 가격 범위 상수: 1만원 ~ 5천만원 (여행상품 현실적 범위)
const PRICE_MIN = 10_000;
const PRICE_MAX = 50_000_000;
// 마진율 허용 범위: -100% ~ +500% (판매가/원가 기준)
const MARGIN_MIN = -1.0;
const MARGIN_MAX = 5.0;

/** product_prices 단일 행 검증 스키마 */
export const ProductPriceRowSchema = z.object({
  target_date:          DateStringSchema.nullable(),
  day_of_week:          z.enum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']).nullable(),
  net_price:            z.number().int().min(PRICE_MIN).max(PRICE_MAX),
  adult_selling_price:  z.number().int().min(PRICE_MIN).max(PRICE_MAX).nullable(),
  child_price:          z.number().int().min(0).max(PRICE_MAX).nullable(),
  note:                 z.string().max(500).nullable(),
}).refine(
  (row) => row.target_date !== null || row.day_of_week !== null,
  { message: 'target_date 또는 day_of_week 중 하나는 반드시 존재해야 합니다.' }
).refine(
  (row) => {
    // 마진율 검증: (판매가 - 원가) / 원가
    if (row.adult_selling_price == null || row.net_price === 0) return true;
    const margin = (row.adult_selling_price - row.net_price) / row.net_price;
    return margin >= MARGIN_MIN && margin <= MARGIN_MAX;
  },
  { message: '마진율이 비현실적 범위입니다 (-100% ~ +500% 내여야 함).' }
);

export type ProductPriceRowInput = z.infer<typeof ProductPriceRowSchema>;

/** AI 추출 상품 핵심 필드 검증 스키마 */
export const ExtractedProductSchema = z.object({
  title:       z.string().min(1).max(200),
  destination: z.string().max(100).optional(),
  duration:    z.number().int().min(1).max(60).optional(),
  // 최저가는 0 허용(파싱 실패 케이스) — REVIEW_NEEDED로 강등됨
  // 단, 상한은 현실적 범위로 차단 (100억 원 상품 방지)
  net_price:   z.number().int().min(0).max(PRICE_MAX),
  theme_tags:  z.array(z.string().max(30)).max(20).default([]),
  selling_points: z.object({
    hotel:   z.string().nullable().optional(),
    airline: z.string().nullable().optional(),
    unique:  z.array(z.string()).max(5).optional(),
  }).nullable().optional(),
  flight_info: z.object({
    airline:       z.string().nullable().optional(),
    flight_no:     z.string().nullable().optional(),
    depart:        z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
    arrive:        z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
    return_depart: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
    return_arrive: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  }).nullable().optional(),
});

export type ExtractedProductInput = z.infer<typeof ExtractedProductSchema>;

function padFlightInfoHHMM(fi: ExtractedData['flight_info']): void {
  if (!fi || typeof fi !== 'object') return;
  const keys = ['depart', 'arrive', 'return_depart', 'return_arrive'] as const;
  for (const k of keys) {
    const v = fi[k];
    if (typeof v !== 'string') continue;
    const m = v.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (m) fi[k] = `${m[1].padStart(2, '0')}:${m[2]}`;
  }
}

/**
 * Zod/LLM 보정 전에 규칙 기반으로 고칠 수 있는 값만 정리 (비용 0).
 * - 항공 시각 9:05 → 09:05
 * - duration 범위·정수화
 * - title 비었을 때 원문 첫 유효 줄에서 제목 후보
 */
export function applyDeterministicExtractedDataFixes(ed: ExtractedData): void {
  padFlightInfoHHMM(ed.flight_info);

  if (ed.duration != null) {
    if (!Number.isFinite(ed.duration)) {
      ed.duration = undefined;
    } else {
      const n = Math.round(ed.duration);
      if (n < 1) ed.duration = undefined;
      else ed.duration = Math.min(60, n);
    }
  }

  if (!ed.title?.trim() && ed.rawText?.trim()) {
    const line = ed.rawText
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map(l => l.trim())
      .find(l => l.length >= 4 && !/^[\d\s.,\-–—%]+$/.test(l));
    if (line) ed.title = line.slice(0, 200);
  }

  if (ed.title && ed.title.length > 200) ed.title = ed.title.slice(0, 200);

  if (ed.theme_tags && ed.theme_tags.length > 20) {
    ed.theme_tags = ed.theme_tags.slice(0, 20);
  }
  if (ed.selling_points?.unique && ed.selling_points.unique.length > 5) {
    ed.selling_points = { ...ed.selling_points, unique: ed.selling_points.unique.slice(0, 5) };
  }
}

// ─── 검증 함수 ────────────────────────────────────────────────────────────────

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  sanitized: Partial<ExtractedProductInput>;
}

/**
 * AI 추출 결과를 검증하고 정제합니다.
 * 검증 실패 시 isValid=false를 반환하지만 최대한 데이터를 복구합니다.
 */
export function validateExtractedProduct(ed: ExtractedData): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const raw = {
    title:          ed.title ?? '',
    destination:    ed.destination,
    duration:       ed.duration,
    net_price:      ed.price ?? 0,
    theme_tags:     ed.theme_tags ?? [],
    selling_points: ed.selling_points ?? null,
    flight_info:    ed.flight_info ?? null,
  };

  const result = ExtractedProductSchema.safeParse(raw);

  if (!result.success) {
    for (const issue of result.error.issues) {
      errors.push(`[${issue.path.join('.')}] ${issue.message}`);
    }
  }

  // 추가 비즈니스 규칙 경고
  if (raw.net_price === 0) {
    warnings.push('net_price가 0입니다. AI가 가격을 파싱하지 못했을 수 있습니다.');
  }
  if (!ed.price_tiers?.length && !ed.price_list?.length) {
    warnings.push('가격 테이블(price_tiers/price_list)이 없습니다. REVIEW_NEEDED 처리됩니다.');
  }
  if (!ed.destination) {
    warnings.push('목적지(destination)가 추출되지 않았습니다.');
  }

  // 포함/불포함 항목 충돌 감지
  if (ed.inclusions?.length && ed.excludes?.length) {
    // 주의사항·법규 텍스트는 AI가 양쪽에 중복 추출하는 false positive 패턴 — 필터 제외
    const NOTICE_PATTERN = /금지|주의|반입|규정|벌금|환불|불가|위험|면세|세관|비자|여권|취소|압수/;
    const MIN_LEN = 15;
    const normalize = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
    const filteredInclusions = ed.inclusions.filter(s => s.length >= MIN_LEN && !NOTICE_PATTERN.test(s));
    const inclSet = new Set(filteredInclusions.map(normalize));
    const conflicts = ed.excludes.filter(ex =>
      ex.length >= MIN_LEN && !NOTICE_PATTERN.test(ex) && inclSet.has(normalize(ex))
    );
    if (conflicts.length > 0) {
      warnings.push(`포함/불포함 항목 충돌 (${conflicts.length}건): ${conflicts.slice(0, 3).join(', ')}`);
    }
  }

  // ── C 파서 정제 레이어 연동 (text-sanitizer.ts) ──
  // 참고: 실제 텍스트 정제(sanitizeText)와 불포함 가드레일(validateExclusions)은
  // API 라우트에서 DB 룰 로드 후 실행됨. 여기서는 동기적 검증만 수행.
  // 비동기 정제 결과는 sanitize_warnings 필드로 travel_packages에 별도 저장.

  return {
    isValid:   result.success,
    errors,
    warnings,
    sanitized: result.success ? result.data : raw,
  };
}

// ─── 가격 데이터 변환 ─────────────────────────────────────────────────────────

/**
 * ExtractedData의 price_tiers + price_list를 product_prices 행으로 변환합니다.
 * 유효하지 않은 행(날짜 형식 오류, net_price ≤ 0 등)은 경고 로그와 함께 제외됩니다.
 */
export function priceTiersToRows(ed: ExtractedData): ProductPriceRowInput[] {
  const rows: ProductPriceRowInput[] = [];

  // ── price_tiers → target_date 행 + day_of_week 행 ─────────────────────────
  for (const tier of ed.price_tiers ?? []) {
    const adultPrice = tier.adult_price ?? 0;

    // 특정 날짜 배열
    if (Array.isArray(tier.departure_dates) && tier.departure_dates.length > 0) {
      for (const dateStr of tier.departure_dates) {
        const parsed = DateStringSchema.safeParse(dateStr);
        if (!parsed.success) {
          console.warn(`[Validator] 날짜 형식 오류 (스킵): ${dateStr}`);
          continue;
        }
        const row = buildPriceRow({
          target_date:         dateStr,
          day_of_week:         null,
          net_price:           adultPrice,
          adult_selling_price: null,
          child_price:         tier.child_price ?? null,
          note:                tier.note ?? null,
        });
        if (row) rows.push(row);
      }
    }
    // 요일별 가격
    else if (tier.departure_day_of_week) {
      const dow = resolveDayOfWeek(tier.departure_day_of_week);
      const row = buildPriceRow({
        target_date:         null,
        day_of_week:         dow,
        net_price:           adultPrice,
        adult_selling_price: null,
        child_price:         tier.child_price ?? null,
        note:                tier.note ?? null,
      });
      if (row) rows.push(row);
    }
    // 날짜/요일 없이 성인가만 있는 경우 (대표 가격)
    else if (adultPrice > 0) {
      const row = buildPriceRow({
        target_date:         null,
        day_of_week:         null,
        net_price:           adultPrice,
        adult_selling_price: null,
        child_price:         tier.child_price ?? null,
        note:                tier.period_label ?? null,
      });
      if (row) rows.push(row);
    }
  }

  // ── price_list → rules별 행 ───────────────────────────────────────────────
  for (const item of ed.price_list ?? []) {
    for (const rule of item.rules ?? []) {
      if (!rule.price || rule.price <= 0) continue; // '별도문의' 등 확정 불가 스킵

      const note = [item.period, rule.condition, item.notes]
        .filter(Boolean)
        .join(' | ')
        .slice(0, 500);

      const row = buildPriceRow({
        target_date:         null,
        day_of_week:         null,
        net_price:           rule.price,
        adult_selling_price: null,
        child_price:         null,
        note:                note || null,
      });
      if (row) rows.push(row);
    }
  }

  return rows;
}

/** 단일 행 생성 (Zod 검증 + 비정상 가격 차단) */
function buildPriceRow(input: ProductPriceRowInput): ProductPriceRowInput | null {
  // 판매가 < 원가 방어 (비정상 마진 역전)
  if (
    input.adult_selling_price !== null &&
    input.adult_selling_price < input.net_price
  ) {
    console.warn(
      `[Validator] 판매가(${input.adult_selling_price}) < 원가(${input.net_price}) — adult_selling_price를 null로 교정`
    );
    input = { ...input, adult_selling_price: null };
  }

  const result = ProductPriceRowSchema.safeParse(input);
  if (!result.success) {
    console.warn('[Validator] product_prices 행 검증 실패 (스킵):', result.error.issues[0]?.message);
    return null;
  }
  return result.data;
}

/** 요일 한국어/영어 → DB enum 변환 */
function resolveDayOfWeek(raw: string): 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN' | null {
  const normalized = raw.trim().toLowerCase();
  return DOW_MAP[normalized] ?? DOW_MAP[raw.trim()] ?? null;
}

// ─── 상태 결정 로직 ───────────────────────────────────────────────────────────

/**
 * AI 파싱 결과를 바탕으로 products.status를 결정합니다.
 *
 * expired 조건 (최우선):
 * - departureDateStr이 있고 오늘보다 과거 → 검수 불필요, 크레딧 낭비 방지
 *
 * REVIEW_NEEDED 조건 (하나라도 해당 시):
 * - net_price === 0 (가격 파싱 실패)
 * - confidence < 0.60 (AI 확신도 낮음)
 * - priceRowCount === 0 (가격 테이블 파싱 실패)
 * - isTravel === false (여행 문서가 아님)
 *
 * DRAFT: 파싱 완료, 검토 전 정상 상태
 */
// ─── 4단계 업로드 게이트 ───────────────────────────────────────────────────────

export type UploadGate = 'BLOCKED' | 'REVIEW_NEEDED' | 'WARNING' | 'CLEAN';

/**
 * 4단계 게이트 분류:
 *   BLOCKED       — 핵심 필드(title/destination) 누락 → DB 저장 차단
 *   REVIEW_NEEDED — confidence 낮음 or 가격 없음 → 수동 검토 대기
 *   WARNING       — 경고 3개 이상 → 저장하되 낮은 신뢰도 플래그
 *   CLEAN         — 정상 → DRAFT 자동 저장
 */
export function classifyUploadGate(
  validation: ValidationResult,
  confidence: number,
  priceRowCount: number,
): UploadGate {
  const criticalMissing = validation.errors.some(e =>
    e.includes('title') || e.includes('destination')
  );
  if (criticalMissing) return 'BLOCKED';
  if (confidence < 0.5 || priceRowCount === 0) return 'REVIEW_NEEDED';
  if (validation.warnings.length >= 3) return 'WARNING';
  return 'CLEAN';
}

export function determineProductStatus(opts: {
  confidence: number;
  netPrice: number;
  priceRowCount: number;
  isTravel?: boolean;
  departureDateStr?: string | null;
}): ProductStatus {
  const { confidence, netPrice, priceRowCount, isTravel = true, departureDateStr } = opts;

  // 출발일이 과거이면 즉시 expired — 검수 대기열 진입 차단
  if (departureDateStr) {
    const dep = new Date(departureDateStr);
    if (!isNaN(dep.getTime()) && dep < new Date()) {
      return 'expired';
    }
  }

  if (!isTravel)                 return 'REVIEW_NEEDED';
  if (netPrice === 0)            return 'REVIEW_NEEDED';
  // 가격 범위 강제: 1만원 미만 또는 5천만원 초과는 오파싱 가능성 높음
  if (netPrice > 0 && netPrice < PRICE_MIN) return 'REVIEW_NEEDED';
  if (netPrice > PRICE_MAX)      return 'REVIEW_NEEDED';
  if (confidence < 0.70)         return 'REVIEW_NEEDED';
  if (priceRowCount === 0)       return 'REVIEW_NEEDED';

  return 'DRAFT';
}
