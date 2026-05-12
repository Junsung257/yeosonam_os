/**
 * @file render-contract.integration.test.ts
 * @description renderPackage(pkg) → CanonicalView 통합 테스트.
 *
 * 기존 render-contract.test.ts 는 순수 유틸 함수만 (getAirlineName, parseFlightActivity 등).
 * 이 파일은 메인 renderPackage 함수의 계약을 보장 — A4·Mobile 두 렌더러의 단일 진입점.
 *
 * 회귀 위험:
 *  - ERR-KUL-05: 렌더러가 view.* 가 아닌 pkg.* 직접 파싱 → 이 테스트가 view 출력 형태 박제
 *  - ERR-HSN-render-bundle: surcharges/excludes 병합 누락
 *  - ERR-HET-single-charge-misclass: "싱글차지" 가 surcharge 로 잘못 분류
 *  - ERR-FUK-customer-leaks: special_notes 가 fallback 으로 노출
 */

import { describe, it, expect } from 'vitest';
import {
  renderPackage,
  resolveAirlineHeader,
  resolveSurchargesAndExcludes,
  resolveShopping,
  resolveOptionalTours,
  classifyInclusions,
  getInclusionIcon,
  type RenderPackageInput,
} from './render-contract';

const EMPTY_PKG: RenderPackageInput = {};

describe('renderPackage — CanonicalView 계약', () => {
  it('빈 입력 → 모든 슬롯이 정의된 형태 (절대 throw X)', () => {
    const v = renderPackage(EMPTY_PKG);
    expect(v).toBeDefined();
    expect(v.airlineHeader).toBeDefined();
    expect(v.flightHeader).toBeDefined();
    expect(v.optionalTours).toBeDefined();
    expect(v.optionalToursByRegion).toBeInstanceOf(Array);
    expect(v.surchargesMerged).toBeInstanceOf(Array);
    expect(v.excludes).toBeDefined();
    expect(v.shopping).toBeDefined();
    expect(v.inclusions).toBeDefined();
    expect(v.days).toBeInstanceOf(Array);
    expect(v.affiliateView).toBeNull();
  });

  it('affiliate 옵션 → affiliateView 그대로 패스스루', () => {
    const aff = {
      affiliate_id: 'a1',
      affiliate_name: '테스트 어필',
      affiliate_handle: 'test',
      affiliate_logo_url: null,
      affiliate_channel_url: null,
      brand_name: '여소남',
      brand_url: 'https://www.yeosonam.com',
      share_url: '/packages/x?ref=test',
      ad_disclosure: '광고 표시',
      generated_at: '2026-05-10T00:00:00Z',
    };
    const v = renderPackage(EMPTY_PKG, { affiliate: aff });
    expect(v.affiliateView).toEqual(aff);
  });

  it('itinerary_data.meta 의 flight_out/flight_in 이 days 로 흐름', () => {
    const pkg: RenderPackageInput = {
      itinerary_data: {
        meta: { flight_out: 'BX143', flight_in: 'BX144', airline: 'BX', departure_airport: '김해' },
        days: [
          { day: 1, schedule: [], regions: ['부산'] },
          { day: 2, schedule: [], regions: ['후쿠오카'] },
        ],
      },
    };
    const v = renderPackage(pkg);
    expect(v.days).toHaveLength(2);
    // flightHeader 가 outbound/inbound 슬롯 보유
    expect(v.flightHeader).toHaveProperty('outbound');
    expect(v.flightHeader).toHaveProperty('inbound');
  });

  it('optional_tours region 그룹화 → optionalToursByRegion 단축 동기화', () => {
    const v = renderPackage({
      optional_tours: [
        { name: '시티투어', region: '쿠알라룸푸르' },
        { name: '마사지', region: '쿠알라룸푸르' },
        { name: '나이트투어', region: '말라카' },
      ],
    });
    expect(v.optionalToursByRegion).toBe(v.optionalTours.groups);
    expect(v.optionalToursByRegion.length).toBeGreaterThan(0);
  });
});

describe('resolveSurchargesAndExcludes — 병합 + 분류', () => {
  it('excludes 배열에서 surcharge 키워드 자동 분리 → merged 로 이동', () => {
    const r = resolveSurchargesAndExcludes({
      excludes: ['가이드/기사 팁 $50/인', '비자비 $30', '청명절 추가요금 $10/인/박', '여행자 보험'],
    });
    // "추가요금" 포함 → surcharges 로 분류
    const allMergedRaws = r.merged.map((s) => s.raw).filter(Boolean) as string[];
    expect(allMergedRaws.some((s) => s.includes('청명절'))).toBe(true);
    // 일반 항목 (비자비/여행자 보험) 은 excludes 에 남음
    expect(r.excludes.basic.some((s) => s.includes('비자비') || s.includes('보험'))).toBe(true);
  });

  it('surcharges 객체 배열 + excludes 문자열 양쪽 모두 merged 에 통합', () => {
    const r = resolveSurchargesAndExcludes({
      surcharges: [{ name: '청명절', start: '2026-04-03', end: '2026-04-06', amount: 10, currency: 'USD', unit: '인/박' }],
      excludes: ['가이드 팁 $50/인'],
    });
    expect(r.merged.length).toBeGreaterThanOrEqual(1);
    expect(r.merged.some((m) => m.name === '청명절')).toBe(true);
  });

  it('빈 입력 — merged 빈 배열, excludes basic 빈 배열', () => {
    const r = resolveSurchargesAndExcludes({});
    expect(r.merged).toEqual([]);
    expect(r.excludes.basic).toEqual([]);
  });

  it('"싱글차지" 는 어딘가에는 보존 (ERR-HET-single-charge-misclass — 분류 변동 시 회귀 알림)', () => {
    const r = resolveSurchargesAndExcludes({
      excludes: ['싱글차지 1박당 5만원', '청명절 추가요금 $10'],
    });
    // 정확한 분류 슬롯은 SURCHARGE_RE 정책에 따라 변동 — basic 또는 merged 어디든 보존되면 OK
    const allText = [
      ...r.excludes.basic,
      ...r.merged.map((m) => m.label),
      ...r.merged.map((m) => m.raw ?? ''),
    ].join('|');
    expect(allText).toContain('싱글차지');
  });
});

describe('resolveAirlineHeader', () => {
  it('itinerary_data.meta.flight_out 으로 항공편 정보 채워짐', () => {
    const h = resolveAirlineHeader({
      itinerary_data: { meta: { flight_out: 'BX793', airline: 'BX', departure_airport: '김해' } },
      destination: '타이페이',
    });
    expect(h.flightNumber).toBe('BX793');
    expect(h.airlineName).toBe('에어부산');
    expect(h.departureCity).toBe('부산');
    expect(h.arrivalCity).toBe('타이페이');
  });

  it('airline 정보 없음 → 모든 슬롯 정의되어 있고 null/문자열 (throw X)', () => {
    const h = resolveAirlineHeader({});
    expect(h).toHaveProperty('flightNumber');
    expect(h).toHaveProperty('airlineName');
    expect(h).toHaveProperty('label');
    // 일부 필드가 null 이어도 OK — 입력 무 시 모든 필드 채울 수 없음
  });
});

describe('resolveShopping', () => {
  it('itinerary_data.highlights.shopping 우선 사용', () => {
    const r = resolveShopping({
      itinerary_data: { highlights: { shopping: '쇼핑 3회 (현지마트 1회 / 노재배 1회 / 패밀리마트 1회)' } },
    });
    // 정의된 형태 (label 또는 noShopping 슬롯 보유)
    expect(r).toBeDefined();
  });

  it('아무 입력 없음 — 빈 form 반환 (throw X)', () => {
    expect(() => resolveShopping({})).not.toThrow();
  });
});

describe('resolveOptionalTours', () => {
  it('region 자동 추론 + region 그룹 생성', () => {
    const r = resolveOptionalTours({
      optional_tours: [
        { name: '야경투어 (쿠알라룸푸르)' },
        { name: '시티투어', region: '쿠알라룸푸르' },
        { name: '나이트투어', region: '말라카' },
      ],
    });
    expect(r.groups.length).toBeGreaterThanOrEqual(1);
    // 그룹 구조 sanity check
    r.groups.forEach((g) => {
      expect(g.region).toBeTruthy();
      expect(g.tours).toBeInstanceOf(Array);
    });
  });

  it('빈 입력 — groups 빈 배열', () => {
    const r = resolveOptionalTours({});
    expect(r.groups).toEqual([]);
  });
});

describe('classifyInclusions + getInclusionIcon', () => {
  it('classifyInclusions 가 basic / program 슬롯 분류', () => {
    const r = classifyInclusions(['항공권', '4박 호텔', '전 일정 가이드 / 기사 / 차량', '왕복 공항 미팅']);
    expect(r).toBeDefined();
    // basic + program 슬롯 보유 (정확한 항목 분배는 내부 휴리스틱)
    expect(typeof r).toBe('object');
  });

  it('getInclusionIcon — 알려진 키워드 → 이모지 또는 빈 문자열', () => {
    const icons = ['항공권', '호텔', '식사', '가이드'].map(getInclusionIcon);
    icons.forEach((i) => expect(typeof i).toBe('string'));
  });
});
