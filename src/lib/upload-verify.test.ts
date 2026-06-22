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
import { evaluateEntityQueueChecks, evaluateVerifyChecks } from './upload-verify';
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

describe('evaluateVerifyChecks customer visibility gate', () => {
  it('blocks review-only packages from being reported as clean', () => {
    const result = evaluateVerifyChecks({
      id: 'pkg-review',
      title: 'Shizuoka 3 days',
      status: 'REVIEW_NEEDED',
      audit_status: null,
      raw_text: 'DAY 1 airport transfer\nDAY 2 sightseeing\nDAY 3 return',
      itinerary_data: {
        days: [
          { schedule: [{ activity: 'airport transfer' }] },
          { schedule: [{ activity: 'sightseeing' }] },
          { schedule: [{ activity: 'return' }] },
        ],
      },
      price_dates: [{ date: '2026-07-01', price: 599000 }],
      display_title: 'Shizuoka charter tour',
    } as never);

    expect(result.status).toBe('blocked');
    expect(findCheck(result, 'C13')).toEqual(expect.objectContaining({
      status: 'fail',
    }));
  });

  it('does not self-lock on stale blocked audit_status after deterministic issues are fixed', () => {
    const result = evaluateVerifyChecks({
      id: 'pkg-stale-blocked-audit',
      title: 'Phu Quoc option price recovery',
      status: 'active',
      audit_status: 'blocked',
      raw_text: 'DAY 1 arrival\nDAY 2 free time\nDAY 3 return\n2099.7.1\n459,000',
      itinerary_data: {
        days: [
          { schedule: [{ activity: 'arrival' }] },
          { schedule: [{ activity: 'free time' }] },
          { schedule: [{ activity: 'return' }] },
        ],
      },
      optional_tours: [{ name: '△ 혼똠섬 케이블카 &워터파크', price: '$60/인' }],
      price_dates: [{ date: '2099-07-01', price: 459000 }],
      display_title: 'Phu Quoc standard package',
    } as never);

    expect(result.status).not.toBe('blocked');
    expect(findCheck(result, 'C10')).toEqual(expect.objectContaining({
      status: 'pass',
    }));
    expect(findCheck(result, 'C13')).toEqual(expect.objectContaining({
      status: 'pass',
    }));
  });

  it('blocks packages whose price dates are all expired even when price rows exist', () => {
    const result = evaluateVerifyChecks({
      id: 'pkg-expired-price-dates',
      title: 'Expired package',
      status: 'active',
      audit_status: 'clean',
      raw_text: 'PKG expired package\n2020.1.1\n3/1\n1,000,-\nDAY 1 arrival\nDAY 2 return',
      itinerary_data: { days: [{ schedule: [{ activity: 'arrival' }] }, { schedule: [{ activity: 'return' }] }] },
      price_dates: [{ date: '2020-03-01', price: 1000000 }],
      display_title: 'Expired package sample',
    } as never);

    expect(result.status).toBe('blocked');
    expect(findCheck(result, 'C14')).toEqual(expect.objectContaining({
      status: 'fail',
    }));
  });

  it('passes date freshness when at least one future departure remains', () => {
    const result = evaluateVerifyChecks({
      id: 'pkg-future-price-dates',
      title: 'Future package',
      status: 'active',
      audit_status: 'clean',
      raw_text: 'PKG future package\n2099.1.1\n3/1\n1,000,-\nDAY 1 arrival\nDAY 2 return',
      itinerary_data: { days: [{ schedule: [{ activity: 'arrival' }] }, { schedule: [{ activity: 'return' }] }] },
      price_dates: [{ date: '2099-03-01', price: 1000000 }],
      display_title: 'Future package sample',
    } as never);

    expect(findCheck(result, 'C14')).toEqual(expect.objectContaining({
      status: 'pass',
    }));
  });
});

describe('evaluateEntityQueueChecks customer landing blockers', () => {
  it('blocks pending attraction, shopping, option, notice, and unknown entity rows', () => {
    const checks = evaluateEntityQueueChecks([
      {
        id: 'u1',
        activity: '흰수염 폭포 시라이토폭포',
        status: 'pending',
        segment_kind_guess: 'attraction',
        suggested_action: 'needs_review',
      },
      {
        id: 'u2',
        activity: '면세점 1곳 방문입니다.',
        status: 'pending',
        segment_kind_guess: 'shopping',
        suggested_action: 'needs_review',
      },
    ]);

    expect(checks).toEqual([
      expect.objectContaining({
        id: 'C15',
        status: 'fail',
      }),
    ]);
    expect(checks[0]?.detail).toContain('attraction:1');
    expect(checks[0]?.detail).toContain('shopping:1');
  });

  it('allows resolved or non-blocking meal and transfer rows', () => {
    const checks = evaluateEntityQueueChecks([
      { activity: '꿔바로우', status: 'pending', segment_kind_guess: 'meal' },
      { activity: '카와구치 이동', status: 'pending', segment_kind_guess: 'transfer' },
      { activity: '오시노핫카이', status: 'resolved', segment_kind_guess: 'attraction', resolved_at: '2026-06-22T00:00:00Z' },
    ]);

    expect(checks).toEqual([
      expect.objectContaining({
        id: 'C15',
        status: 'pass',
      }),
    ]);
  });
});

describe('evaluateVerifyChecks — fail/warn 회귀 차단', () => {
  it('C12 blocks shared price-table column mismatches', () => {
    const rawText = `
출발일
요일
실속 알뜰3색
단독골프
더비스타 품격2색
풀빌라 / 단독골프
스팟특가
6/20,21,28
999,-
1,159,-
7/2,9
1,139,-
1,259,-
6/4~6/30
토,일(4박)
1,189,-
1,349,-
수
1,169,-
1,289,-
목
1,249,-
1,369,-

PKG
클락 품격 풀빌라 더비스타 2색골프 + 단독차량 3박5일
출 발 일
6/1~10/24 (수,목)
`;
    const r = evaluateVerifyChecks({
      id: 'pkg-clark-wrong-column',
      title: '클락 품격 풀빌라 더비스타 2색골프 + 단독차량 3박5일',
      duration: 5,
      raw_text: rawText,
      accommodations: ['신축 풀빌라 또는 동급 *1인1실'],
      departure_days: '수,목',
      price_dates: [
        { date: '2026-07-02', price: 1139000 },
        { date: '2026-07-09', price: 1139000 },
      ],
    });

    expect(findCheck(r, 'C12')?.status).toBe('fail');
    expect(findCheck(r, 'C12')?.detail).toMatch(/불일치/);
  });

  it('C12 blocks extra departure dates not present in the selected product table', () => {
    const rawText = `
출발일
요일
실속 알뜰3색
단독골프
더비스타 품격2색
풀빌라 / 단독골프
스팟특가
7/2,9
1,139,-
1,259,-

PKG
클락 품격 풀빌라 더비스타 2색골프 + 단독차량 3박5일
출 발 일
6/1~10/24 (수,목)
`;
    const r = evaluateVerifyChecks({
      id: 'pkg-clark-extra-date',
      title: '클락 품격 풀빌라 더비스타 2색골프 + 단독차량 3박5일',
      duration: 5,
      raw_text: rawText,
      accommodations: ['신축 풀빌라 또는 동급 *1인1실'],
      departure_days: '수,목',
      price_dates: [
        { date: '2026-07-02', price: 1259000 },
        { date: '2026-07-09', price: 1259000 },
        { date: '2026-06-20', price: 1259000 },
      ],
    });

    expect(findCheck(r, 'C12')?.status).toBe('fail');
    expect(findCheck(r, 'C12')?.detail).toMatch(/원문에 없는 출발일/);
  });

  it('C12 expands month/day raw prices using the DB price_date year', () => {
    const rawText = `
spot
7/2,9
999,-
1,159,-

PKG
premium villa golf package 3n5d
`;
    const r = evaluateVerifyChecks({
      id: 'pkg-future-year',
      title: 'premium villa golf package 3n5d',
      duration: 5,
      raw_text: rawText,
      accommodations: ['villa'],
      price_dates: [
        { date: '2027-07-02', price: 1159000 },
        { date: '2027-07-09', price: 1159000 },
      ],
    });

    expect(findCheck(r, 'C12')?.status).toBe('pass');
  });

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

  it('C9 ignores duplicated optional golf detail headings', () => {
    const r = evaluateVerifyChecks({
      id: 'pkg-option-detail-dup',
      itinerary_data: {
        days: [
          {
            schedule: [
              { activity: '\uD638\uD154 \uC870\uC2DD \uD6C4 \uC804\uC77C \uC790\uC720\uC77C\uC815' },
              { activity: '1. \uACE8\uD504\uC7A5 \uC815\uBCF4' },
              { activity: '\uCF54\uC2A4\uC815\uBCF4: 18\uD640/72\uD30C/7224\uC57C\uB4DC' },
              { activity: '1. \uACE8\uD504\uC7A5 \uC815\uBCF4' },
              { activity: '\uD734\uC2DD \uBC0F \uC790\uC720\uC77C\uC815' },
            ],
          },
        ],
      },
    });
    expect(findCheck(r, 'C9')?.status).toBe('pass');
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

  it('C10 accepts supplier option price labels with currency and per-person suffixes', () => {
    const r = evaluateVerifyChecks({
      id: 'pkg-phu-quoc-option-prices',
      optional_tours: [
        { name: '△ 혼똠섬 케이블카 &워터파크', price: '$60/인' },
        { name: '△ 키스 오브 더 씨 쇼', price: '$50/인' },
        { name: '마사지 팁 [60분-', price: '$3/인' },
        { name: '90분-', price: '$4/인' },
        { name: '발마사지30분', price: 'USD30' },
        { name: '전신마사지60분', price: '30불' },
      ],
    });
    expect(findCheck(r, 'C10')).toEqual(expect.objectContaining({
      status: 'pass',
    }));
  });

  it('C10 keeps non-price duration strings as warnings', () => {
    const r = evaluateVerifyChecks({
      id: 'pkg-duration-as-price',
      optional_tours: [{ name: '마사지', price: '60분' }],
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
