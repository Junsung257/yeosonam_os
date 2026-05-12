/**
 * package-schema 단위 테스트 — W30~W33 refine 회귀 방지
 *
 * 등록된 상품은 모바일 랜딩·A4 포스터·블로그·카드뉴스 4~7개 채널에 동시 노출되므로,
 * INSERT 전 Zod refine 게이트가 깨지면 잘못된 데이터가 모든 채널에 동시 송출.
 * 이 테스트는 그 게이트가 의도대로 동작하는지 보장.
 *
 * 커버:
 *   - W30 — Day 번호 정합성 (gap/중복/1부터 시작 안함)
 *   - W31 — Surcharge 기간 역전 (start > end)
 *   - W32 — Optional tours 중복 (name+region+day)
 *   - W33 — departure_days ↔ price_dates 요일 정합성
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import { PackageStrictSchema } from './package-schema';

// 모든 refine 통과하는 baseline pkg
const validPkg = {
  title: '나트랑 4박5일',
  destination: '나트랑',
  duration: 5,
  price_dates: [
    { date: '2026-05-04', price: 1290000 },  // 월
    { date: '2026-05-06', price: 1290000 },  // 수
  ],
  itinerary_data: {
    days: [
      { day: 1, regions: ['나트랑'], schedule: [{ activity: '인천 출발', type: 'flight' as const }] },
      { day: 2, regions: ['나트랑'], schedule: [{ activity: '시내투어' }] },
      { day: 3, regions: ['나트랑'], schedule: [{ activity: '자유시간' }] },
      { day: 4, regions: ['나트랑'], schedule: [{ activity: '바나힐' }] },
      { day: 5, regions: ['나트랑'], schedule: [{ activity: '인천 도착', type: 'flight' as const }] },
    ],
  },
  surcharges: [
    { name: '성수기', start: '2026-07-15', end: '2026-08-15', amount: 100000 },
  ],
  optional_tours: [
    { name: '나이트투어', region: '베트남' as const },
    { name: '머드온천', region: '베트남' as const },
  ],
  departure_days: '월/수',
};

const findIssue = (issues: z.ZodIssue[], code: string) =>
  issues.find(i => i.message.includes(code));

describe('PackageStrictSchema refines — 렌더링 정확도 게이트', () => {
  it('정상 pkg 는 모든 refine 통과', () => {
    const r = PackageStrictSchema.safeParse(validPkg);
    expect(r.success).toBe(true);
  });

  describe('W30 — Day 번호 정합성', () => {
    it('Day 번호에 gap (1,2,4,4,5) 차단', () => {
      const pkg = JSON.parse(JSON.stringify(validPkg));
      pkg.itinerary_data.days[2].day = 4;
      const r = PackageStrictSchema.safeParse(pkg);
      expect(r.success).toBe(false);
      if (!r.success) expect(findIssue(r.error.issues, 'W30')).toBeDefined();
    });

    it('Day 번호 1부터 시작 안 하면 차단', () => {
      const pkg = JSON.parse(JSON.stringify(validPkg));
      pkg.itinerary_data.days.forEach((d: { day: number }, i: number) => { d.day = i + 2; });
      const r = PackageStrictSchema.safeParse(pkg);
      expect(r.success).toBe(false);
    });
  });

  describe('W31 — Surcharge 기간 역전', () => {
    it('start > end 차단', () => {
      const pkg = JSON.parse(JSON.stringify(validPkg));
      pkg.surcharges[0].start = '2026-08-15';
      pkg.surcharges[0].end = '2026-07-15';
      const r = PackageStrictSchema.safeParse(pkg);
      expect(r.success).toBe(false);
      if (!r.success) expect(findIssue(r.error.issues, 'W31')).toBeDefined();
    });

    it('start = end 는 허용 (당일 단발 적용)', () => {
      const pkg = JSON.parse(JSON.stringify(validPkg));
      pkg.surcharges[0].start = '2026-07-15';
      pkg.surcharges[0].end = '2026-07-15';
      const r = PackageStrictSchema.safeParse(pkg);
      expect(r.success).toBe(true);
    });
  });

  describe('W32 — Optional tours 중복', () => {
    it('같은 name+region+day 이중 등록 차단', () => {
      const pkg = JSON.parse(JSON.stringify(validPkg));
      pkg.optional_tours.push({ name: '나이트투어', region: '베트남' });
      const r = PackageStrictSchema.safeParse(pkg);
      expect(r.success).toBe(false);
      if (!r.success) expect(findIssue(r.error.issues, 'W32')).toBeDefined();
    });

    it('day 다른 동일 투어 (같은 name+region, day 다름) 허용', () => {
      const pkg = JSON.parse(JSON.stringify(validPkg));
      pkg.optional_tours = [
        { name: '나이트투어', region: '베트남', day: 2 },
        { name: '나이트투어', region: '베트남', day: 4 },
      ];
      const r = PackageStrictSchema.safeParse(pkg);
      expect(r.success).toBe(true);
    });
  });

  describe('W33 — departure_days ↔ price_dates 요일 정합성', () => {
    it('"월/수" 인데 토요일 섞여 있으면 차단', () => {
      const pkg = JSON.parse(JSON.stringify(validPkg));
      pkg.price_dates = [
        { date: '2026-05-04', price: 1290000 }, // 월
        { date: '2026-05-09', price: 1290000 }, // 토 — 위반
      ];
      pkg.departure_days = '월/수';
      const r = PackageStrictSchema.safeParse(pkg);
      expect(r.success).toBe(false);
      if (!r.success) expect(findIssue(r.error.issues, 'W33')).toBeDefined();
    });

    it('"매일" 은 모든 요일 허용 — 스킵', () => {
      const pkg = JSON.parse(JSON.stringify(validPkg));
      pkg.price_dates = [
        { date: '2026-05-04', price: 1290000 }, // 월
        { date: '2026-05-09', price: 1290000 }, // 토
        { date: '2026-05-10', price: 1290000 }, // 일
      ];
      pkg.departure_days = '매일';
      const r = PackageStrictSchema.safeParse(pkg);
      expect(r.success).toBe(true);
    });

    it('숫자 포함 ("5/9, 5/26" 등 특정 날짜 나열) — 스킵', () => {
      const pkg = JSON.parse(JSON.stringify(validPkg));
      pkg.price_dates = [{ date: '2026-05-09', price: 1290000 }];
      pkg.departure_days = '5/9, 5/26';
      const r = PackageStrictSchema.safeParse(pkg);
      expect(r.success).toBe(true);
    });

    it('"매주 금요일" + 금요일만 — 통과', () => {
      const pkg = JSON.parse(JSON.stringify(validPkg));
      pkg.price_dates = [
        { date: '2026-05-08', price: 1290000 }, // 금
        { date: '2026-05-15', price: 1290000 }, // 금
      ];
      pkg.departure_days = '매주 금요일';
      const r = PackageStrictSchema.safeParse(pkg);
      expect(r.success).toBe(true);
    });

    it('departure_days 미정 (undefined) — 스킵', () => {
      const pkg = JSON.parse(JSON.stringify(validPkg));
      delete pkg.departure_days;
      pkg.price_dates = [{ date: '2026-05-09', price: 1290000 }]; // 토
      const r = PackageStrictSchema.safeParse(pkg);
      expect(r.success).toBe(true);
    });
  });
});
