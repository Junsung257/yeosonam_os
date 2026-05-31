/**
 * @file upload-verify.test.ts
 * @description registration 결정적 검증 (C1~C10) 회귀 차단.
 *
 * 박제 사유 (2026-05-22): /register 자동화 임계값 변경 시 결정적 룰이
 * 의도치 않게 깨지는 케이스를 CI 단계에서 잡는다. Active Learning 누적이
 * 다른 분기를 흔들 때 가장 먼저 회귀가 드러나는 표면.
 *
 * 결정적 룰만 — LLM judge 없음. Golden Set 의 가벼운 버전.
 */

import { describe, it, expect } from 'vitest';
import { evaluateVerifyChecks } from './upload-verify';
import { extractProductRawTextSection } from './parser/catalog-pre-split';

function findCheck(result: ReturnType<typeof evaluateVerifyChecks>, id: string) {
  return result.checks.find(c => c.id === id);
}

describe('evaluateVerifyChecks — clean baseline (3박 5일 정상 케이스)', () => {
  const result = evaluateVerifyChecks({
    id: 'pkg-clean',
    title: '나트랑 3박 5일',
    raw_text: `제1일: 인천 출발
제2일: 시내 관광
제3일: 자유시간
제4일: 호텔 휴식
제5일: 인천 도착
선택관광
- 머드스파 (\\$60)
- 보트투어 (\\$45)
특식 2회 포함
취항특가 1,290,000원부터`,
    itinerary_data: {
      days: [
        { hotel: { name: '롯데 LJ 호텔' }, schedule: [{ activity: '공항 도착' }, { activity: '호텔 체크인' }] },
        { hotel: { name: '롯데 LJ 호텔' }, schedule: [{ activity: '시내 관광' }] },
        { hotel: { name: '롯데 LJ 호텔' }, schedule: [{ activity: '자유시간' }] },
        { hotel: { name: '롯데 LJ 호텔' }, schedule: [{ activity: '호텔 휴식' }] },
        { hotel: null, schedule: [{ activity: '인천 도착' }] },
      ],
    },
    inclusions: ['항공권', '호텔', '특식 2회'],
    optional_tours: [
      { name: '머드스파', price: 60, price_currency: 'USD' },
      { name: '보트투어', price: 45, price_currency: 'USD' },
    ],
    price_dates: [
      { adult_selling_price: 1290000, currency: 'KRW' },
      { adult_selling_price: 1390000, currency: 'KRW' },
    ],
    departure_days: '월/수/금',
  });

  it('C1 일차 수 pass (원문 5일 vs DB days=5)', () => {
    expect(findCheck(result, 'C1')?.status).toBe('pass');
  });
  it('C2 선택관광 pass (원문 2건 vs DB 2건)', () => {
    expect(findCheck(result, 'C2')?.status).toBe('pass');
  });
  it('C2 표준 마크다운 빈 선택관광 섹션은 skip', () => {
    const r = evaluateVerifyChecks({
      id: 'pkg-standard-empty-options',
      raw_text: `YSN-PRODUCT-MD v1

## 선택관광

## 일정
### DAY 1 | 부산 | 호텔명(5성) | 조:X / 중:X / 석:X
- 09:00 | 호텔 휴식 | hotel`,
      optional_tours: [],
    });
    expect(findCheck(r, 'C2')?.status).toBe('skip');
  });
  it('C3 특식 포함 pass', () => {
    expect(findCheck(result, 'C3')?.status).toBe('pass');
  });
  it('C5 departure_days 형식 pass (평문)', () => {
    expect(findCheck(result, 'C5')?.status).toBe('pass');
  });
  it('C6 가격 행 pass', () => {
    expect(findCheck(result, 'C6')?.status).toBe('pass');
  });
  it('C7 호텔 채움 pass (3박 vs filled 4)', () => {
    // raw_text 에 박수 표기 없으면 skip — 명시적 fixture 추가 필요
    const r = evaluateVerifyChecks({
      id: 'pkg-with-nights',
      raw_text: '여소남 나트랑 5일 패키지 일정표 — 제1일 인천 출발 / 제2일 시내 / 제3일 자유시간 / 제4일 자유시간 / 제5일 도착 — 3박 5일 풀일정',
      itinerary_data: {
        days: [
          { hotel: { name: 'A호텔' } }, { hotel: { name: 'A호텔' } }, { hotel: { name: 'B호텔' } },
          { hotel: { name: 'B호텔' } }, { hotel: null },
        ],
      },
    });
    expect(findCheck(r, 'C7')?.status).toBe('pass');
  });
  it('C8 통화 단일 (USD opts + KRW prices = 2종 → warn)', () => {
    // 기본 fixture 는 USD/KRW 혼재 → warn 정상
    expect(findCheck(result, 'C8')?.status).toBe('warn');
  });
  it('C9 일정 중복 pass', () => {
    expect(findCheck(result, 'C9')?.status).toBe('pass');
  });
  it('C10 옵션 가격 유효성 pass', () => {
    expect(findCheck(result, 'C10')?.status).toBe('pass');
  });
});

describe('evaluateVerifyChecks — fail/warn 회귀 차단', () => {
  it('C1 일차 불일치 warn (원문 5일 vs DB 4일)', () => {
    const r = evaluateVerifyChecks({
      id: 'pkg-bad-days',
      raw_text: '여소남 나트랑 5일 일정 — 제1일 인천출발 / 제2일 시내 관광 / 제3일 자유시간 / 제4일 자유시간 / 제5일 도착 / 박수 4박 5일',
      itinerary_data: { days: [{}, {}, {}, {}] },   // 4일만
    });
    expect(findCheck(r, 'C1')?.status).toBe('warn');
    expect(findCheck(r, 'C1')?.detail).toMatch(/원문 5일/);
  });

  it('C4 최저가 5% 이상 차이 warn', () => {
    const r = evaluateVerifyChecks({
      id: 'pkg-price-drift',
      raw_text: '여소남 나트랑 패키지 일정표 — 최저가 1,290,000원 부터 / 부산 출발 / 5박 7일',
      price_dates: [{ adult_selling_price: 1500000 }],   // ~16% 차이
    });
    expect(findCheck(r, 'C4')?.status).toBe('warn');
  });

  it('C5 departure_days JSON 누출 warn', () => {
    const r = evaluateVerifyChecks({
      id: 'pkg-bad-dep',
      departure_days: '["월","수"]',
    });
    expect(findCheck(r, 'C5')?.status).toBe('warn');
  });

  it('C8 통화 혼재 warn (KRW + USD)', () => {
    const r = evaluateVerifyChecks({
      id: 'pkg-mixed-currency',
      price_dates: [{ adult_selling_price: 1290000, currency: 'KRW' }],
      surcharges: [{ amount: '50', currency: 'USD' }],
    });
    expect(findCheck(r, 'C8')?.status).toBe('warn');
    expect(findCheck(r, 'C8')?.detail).toMatch(/혼재/);
  });

  it('C9 같은 day 안 activity 중복 warn', () => {
    const r = evaluateVerifyChecks({
      id: 'pkg-dup-activity',
      itinerary_data: {
        days: [
          { schedule: [{ activity: '호텔 체크인' }, { activity: '시내 관광' }, { activity: '호텔 체크인' }] },
        ],
      },
    });
    expect(findCheck(r, 'C9')?.status).toBe('warn');
  });

  it('C10 옵션 가격 음수 warn', () => {
    const r = evaluateVerifyChecks({
      id: 'pkg-bad-opt-price',
      optional_tours: [{ name: '머드스파', price: -50 }],
    });
    expect(findCheck(r, 'C10')?.status).toBe('warn');
  });

  it('C10 옵션 가격 문자열 (NaN) warn', () => {
    const r = evaluateVerifyChecks({
      id: 'pkg-string-price',
      optional_tours: [{ name: '머드스파', price: 'TBD' }],
    });
    expect(findCheck(r, 'C10')?.status).toBe('warn');
  });

  it('C11 hero display_title 누락 warn', () => {
    const r = evaluateVerifyChecks({ id: 'pkg-no-hero' });
    expect(findCheck(r, 'C11')?.status).toBe('warn');
    expect(findCheck(r, 'C11')?.detail).toMatch(/누락/);
  });

  it('C11 display_title 너무 짧음 warn', () => {
    const r = evaluateVerifyChecks({ id: 'pkg-short-hero', display_title: '나트랑' });
    expect(findCheck(r, 'C11')?.status).toBe('warn');
  });

  it('C11 hero_tagline 짧음 warn', () => {
    const r = evaluateVerifyChecks({
      id: 'pkg-short-tagline',
      display_title: '나트랑 5성 3박5일',
      hero_tagline: '특가',
    });
    expect(findCheck(r, 'C11')?.status).toBe('warn');
  });

  it('C1 공유 raw_text 오탐 — 상품별 구간이면 pass (보홀 슬림팩)', () => {
    const shared = `${'랜드사 안내 및 공통 약관 '.repeat(3)}
PKG
보홀 슬림팩 3박5일
출 발 일 5/31 (일) 판 매 가 499,000/인
제1일 부산 출발
제2일 보홀 자유
제3일 보홀 자유
제4일 보홀 시내
제5일 부산 도착
PKG
보홀 슬림팩 4박6일
출 발 일 5/30 (토) 판 매 가 519,000/인
제1일 부산 출발
제2일 보홀
제3일 보홀
제4일 보홀
제5일 보홀
제6일 부산 도착
필리핀여행상품 취소규정 안내`;
    const section5 = extractProductRawTextSection(shared, '보홀 슬림팩 3박5일', 0, 2);
    const r = evaluateVerifyChecks({
      id: 'pkg-bohol-5d',
      title: '보홀 슬림팩 3박5일',
      display_title: '보홀 슬림팩 3박5일',
      raw_text: section5,
      itinerary_data: { days: [{}, {}, {}, {}, {}] },
    });
    expect(findCheck(r, 'C1')?.status).toBe('pass');
    expect(findCheck(r, 'C11')?.status).toBe('pass');
  });
});

describe('evaluateVerifyChecks — overall status 집계', () => {
  it('모든 룰 pass → clean', () => {
    const r = evaluateVerifyChecks({
      id: 'pkg-perfect',
      display_title: '나트랑 5성 1박2일',
      raw_text: '여소남 나트랑 1박2일 골든 패키지 일정표 — 제1일 인천 출발 / 제2일 인천 도착 — 최저가 500,000원부터',
      itinerary_data: { days: [{ hotel: { name: '호텔A' } }, { hotel: null }] },
      price_dates: [{ adult_selling_price: 500000, currency: 'KRW' }],
      departure_days: '월',
      optional_tours: [],
    });
    expect(r.status).toBe('clean');
    expect(r.failCount).toBe(0);
  });

  it('warn 1개 이상 → warnings', () => {
    const r = evaluateVerifyChecks({
      id: 'pkg-warn',
      raw_text: '제1일~제5일',
      itinerary_data: { days: [{}, {}, {}, {}] },     // C1 warn
    });
    expect(r.status).toBe('warnings');
    expect(r.warnCount).toBeGreaterThan(0);
  });
});
