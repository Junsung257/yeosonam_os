/**
 * upload-validator 단위 테스트
 *
 * 상품 등록 게이트 — AI 파싱 결과를 검증/정제하고 product status 결정.
 * 회귀 위험:
 *   - net_price 0 / 비현실적 범위 → DRAFT 로 흘러가면 가격 0원 상품이 노출됨
 *   - 출발일 과거 → expired 로 차단 못 하면 검수 대기열에 무한 누적
 *   - 마진 역전 (판매가 < 원가) → buildPriceRow 가 selling_price 를 null 로 교정
 */

import { describe, it, expect } from 'vitest';
import type { ExtractedData } from '@/lib/parser';
import {
  ProductPriceRowSchema,
  ExtractedProductSchema,
  validateExtractedProduct,
  priceTiersToRows,
  determineProductStatus,
} from './upload-validator';

const ed = (overrides: Partial<ExtractedData> = {}): ExtractedData => ({
  title: '테스트 상품',
  destination: '나트랑',
  duration: 4,
  price: 1_500_000,
  ...overrides,
} as ExtractedData);

describe('ExtractedProductSchema — Zod 가드', () => {
  it('정상 입력 통과', () => {
    const r = ExtractedProductSchema.safeParse({
      title: '나트랑 4일',
      destination: '나트랑',
      duration: 4,
      net_price: 1_500_000,
      theme_tags: ['휴양', '가족'],
    });
    expect(r.success).toBe(true);
  });

  it('title 빈 문자열 → 실패', () => {
    const r = ExtractedProductSchema.safeParse({ title: '', net_price: 1_000_000 });
    expect(r.success).toBe(false);
  });

  it('net_price 음수 → 실패', () => {
    const r = ExtractedProductSchema.safeParse({ title: 'A', net_price: -100 });
    expect(r.success).toBe(false);
  });

  it('net_price 5천만원 초과 → 실패 (오파싱 차단)', () => {
    const r = ExtractedProductSchema.safeParse({ title: 'A', net_price: 100_000_000 });
    expect(r.success).toBe(false);
  });

  it('duration 0 → 실패 (최소 1일)', () => {
    const r = ExtractedProductSchema.safeParse({ title: 'A', net_price: 1_000_000, duration: 0 });
    expect(r.success).toBe(false);
  });

  it('duration 60일 초과 → 실패', () => {
    const r = ExtractedProductSchema.safeParse({ title: 'A', net_price: 1_000_000, duration: 100 });
    expect(r.success).toBe(false);
  });

  it('theme_tags 21개 이상 → 실패 (최대 20)', () => {
    const r = ExtractedProductSchema.safeParse({
      title: 'A', net_price: 1_000_000,
      theme_tags: Array.from({ length: 25 }, (_, i) => `tag${i}`),
    });
    expect(r.success).toBe(false);
  });

  it('flight_info HH:MM 포맷 검증', () => {
    const ok = ExtractedProductSchema.safeParse({
      title: 'A', net_price: 1_000_000,
      flight_info: { depart: '08:30', arrive: '12:45' },
    });
    expect(ok.success).toBe(true);

    const bad = ExtractedProductSchema.safeParse({
      title: 'A', net_price: 1_000_000,
      flight_info: { depart: '8시30분' },
    });
    expect(bad.success).toBe(false);
  });
});

describe('ProductPriceRowSchema — 행 검증', () => {
  it('target_date / day_of_week 둘 다 null → 실패', () => {
    const r = ProductPriceRowSchema.safeParse({
      target_date: null, day_of_week: null,
      net_price: 1_000_000, adult_selling_price: 1_500_000, child_price: null, note: null,
    });
    expect(r.success).toBe(false);
  });

  it('target_date 단독 → 통과', () => {
    const r = ProductPriceRowSchema.safeParse({
      target_date: '2026-04-01', day_of_week: null,
      net_price: 1_000_000, adult_selling_price: 1_500_000, child_price: null, note: null,
    });
    expect(r.success).toBe(true);
  });

  it('day_of_week 단독 → 통과', () => {
    const r = ProductPriceRowSchema.safeParse({
      target_date: null, day_of_week: 'MON',
      net_price: 1_000_000, adult_selling_price: 1_500_000, child_price: null, note: null,
    });
    expect(r.success).toBe(true);
  });

  it('마진 -33% (판매가 < 원가) 는 스키마에선 통과 — 추가 차단은 buildPriceRow 가 selling_price 를 null 로 교정', () => {
    // 스키마 레벨: MARGIN_MIN = -1.0 (-100%) 까지 허용
    const r = ProductPriceRowSchema.safeParse({
      target_date: '2026-04-01', day_of_week: null,
      net_price: 1_500_000, adult_selling_price: 1_000_000, child_price: null, note: null,
    });
    expect(r.success).toBe(true);
  });

  it('마진 -150% (판매가 음수 영역) → refine 차단 (MARGIN_MIN -100% 초과)', () => {
    const r = ProductPriceRowSchema.safeParse({
      target_date: '2026-04-01', day_of_week: null,
      // (- N - 1M) / 1M 가 -1.5 이려면 selling = -500K
      net_price: 1_000_000, adult_selling_price: -500_000, child_price: null, note: null,
    });
    expect(r.success).toBe(false);
  });

  it('비현실적 마진 +900% → refine 차단 (MARGIN_MAX +500% 초과)', () => {
    const r = ProductPriceRowSchema.safeParse({
      target_date: '2026-04-01', day_of_week: null,
      net_price: 1_000_000, adult_selling_price: 10_000_000, child_price: null, note: null,
    });
    expect(r.success).toBe(false);
  });

  it('정상 마진 +50% → 통과', () => {
    const r = ProductPriceRowSchema.safeParse({
      target_date: '2026-04-01', day_of_week: null,
      net_price: 1_000_000, adult_selling_price: 1_500_000, child_price: 1_000_000, note: '4월 행사',
    });
    expect(r.success).toBe(true);
  });
});

describe('validateExtractedProduct', () => {
  it('정상 데이터 → isValid = true', () => {
    const r = validateExtractedProduct(ed());
    expect(r.isValid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it('net_price 0 → 경고 출력 (실패는 아님 — REVIEW_NEEDED 분기 위함)', () => {
    const r = validateExtractedProduct(ed({ price: 0 }));
    expect(r.warnings.some(w => w.includes('net_price'))).toBe(true);
  });

  it('가격 테이블 없으면 경고', () => {
    const r = validateExtractedProduct(ed({ price_tiers: [], price_list: [] }));
    expect(r.warnings.some(w => w.includes('가격 테이블'))).toBe(true);
  });

  it('destination 없으면 경고', () => {
    const r = validateExtractedProduct(ed({ destination: undefined }));
    expect(r.warnings.some(w => w.includes('목적지'))).toBe(true);
  });

  it('title 너무 길면 errors 배열에 메시지', () => {
    const r = validateExtractedProduct(ed({ title: 'A'.repeat(300) }));
    expect(r.isValid).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });
});

describe('priceTiersToRows', () => {
  it('departure_dates 명시 → 각 날짜별 행', () => {
    const rows = priceTiersToRows({
      ...ed(),
      price_tiers: [
        { period_label: '4월', adult_price: 1_500_000, departure_dates: ['2026-04-01', '2026-04-08'] } as never,
      ],
    } as ExtractedData);
    expect(rows).toHaveLength(2);
    expect(rows[0].target_date).toBe('2026-04-01');
    expect(rows[1].target_date).toBe('2026-04-08');
  });

  it('departure_day_of_week → DOW 행 1개', () => {
    const rows = priceTiersToRows({
      ...ed(),
      price_tiers: [
        { period_label: '평일', adult_price: 1_500_000, departure_day_of_week: '월' } as never,
      ],
    } as ExtractedData);
    expect(rows).toHaveLength(1);
    expect(rows[0].day_of_week).toBe('MON');
    expect(rows[0].target_date).toBeNull();
  });

  it('잘못된 날짜 형식은 스킵', () => {
    const rows = priceTiersToRows({
      ...ed(),
      price_tiers: [
        { period_label: '4월', adult_price: 1_500_000, departure_dates: ['2026/04/01', '2026-04-08'] } as never,
      ],
    } as ExtractedData);
    // 첫 번째는 형식 오류로 스킵
    expect(rows).toHaveLength(1);
    expect(rows[0].target_date).toBe('2026-04-08');
  });

  it('영어 요일도 처리 (Tuesday → TUE)', () => {
    const rows = priceTiersToRows({
      ...ed(),
      price_tiers: [
        { period_label: 'Weekday', adult_price: 1_500_000, departure_day_of_week: 'Tuesday' } as never,
      ],
    } as ExtractedData);
    expect(rows[0].day_of_week).toBe('TUE');
  });

  it('price_list 의 별도문의(price=0) 는 스킵', () => {
    const rows = priceTiersToRows({
      ...ed(),
      price_tiers: [],
      price_list: [
        { period: '5월', rules: [{ condition: '성인', price: 0, price_text: '별도문의' }] } as never,
      ],
    } as ExtractedData);
    expect(rows).toHaveLength(0);
  });
});

describe('determineProductStatus', () => {
  it('정상 → DRAFT', () => {
    const s = determineProductStatus({ confidence: 0.85, netPrice: 1_500_000, priceRowCount: 5 });
    expect(s).toBe('DRAFT');
  });

  it('출발일 과거 → expired (최우선)', () => {
    const s = determineProductStatus({
      confidence: 0.9, netPrice: 1_500_000, priceRowCount: 5,
      departureDateStr: '2020-01-01',
    });
    expect(s).toBe('expired');
  });

  it('isTravel=false → REVIEW_NEEDED', () => {
    const s = determineProductStatus({
      confidence: 0.95, netPrice: 1_500_000, priceRowCount: 5, isTravel: false,
    });
    expect(s).toBe('REVIEW_NEEDED');
  });

  it('netPrice 0 → REVIEW_NEEDED', () => {
    const s = determineProductStatus({ confidence: 0.95, netPrice: 0, priceRowCount: 5 });
    expect(s).toBe('REVIEW_NEEDED');
  });

  it('netPrice 1만원 미만 → REVIEW_NEEDED', () => {
    const s = determineProductStatus({ confidence: 0.95, netPrice: 5_000, priceRowCount: 5 });
    expect(s).toBe('REVIEW_NEEDED');
  });

  it('netPrice 5천만원 초과 → REVIEW_NEEDED', () => {
    const s = determineProductStatus({ confidence: 0.95, netPrice: 100_000_000, priceRowCount: 5 });
    expect(s).toBe('REVIEW_NEEDED');
  });

  it('confidence < 0.60 → REVIEW_NEEDED', () => {
    const s = determineProductStatus({ confidence: 0.5, netPrice: 1_500_000, priceRowCount: 5 });
    expect(s).toBe('REVIEW_NEEDED');
  });

  it('priceRowCount 0 → REVIEW_NEEDED', () => {
    const s = determineProductStatus({ confidence: 0.9, netPrice: 1_500_000, priceRowCount: 0 });
    expect(s).toBe('REVIEW_NEEDED');
  });

  it('미래 출발일 + 정상 데이터 → DRAFT', () => {
    const s = determineProductStatus({
      confidence: 0.9, netPrice: 1_500_000, priceRowCount: 5,
      departureDateStr: '2099-12-31',
    });
    expect(s).toBe('DRAFT');
  });
});
