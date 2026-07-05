import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildSourceBackedPriceDateRepair,
  extractExcludedPriceCandidatesFromRawText,
  selectSourceBackedPriceRows,
  selectSourceBackedPriceRowsWithExclusions,
} from './source-price-date-repair';

const BAEKDU_GRADE_PATTERN_MATRIX = `
★연길/백두산 7-8월 목/일 출발 증편★
2명부터 출발확정 목3박4일 / 일4박5일
출발일
패턴
세이브
스탠다드
프리미엄
크라운
7월
목요일
3박4일
7월2일 (목)
859,000
1,129,000
1,299,000
1,429,000
7월9일 (목)
7월16일 (목)
1,099,000
1,359,000
1,529,000
1,649,000
7월23일 (목)
859,000
1,129,000
1,299,000
1,429,000
7월30일 (목)
7월
일요일
4박5일
7월5일 (일)
799,000
1,149,000
1,339,000
1,429,000
7월12일 (일)
7월19일 (일)
7월26일 (일)
8월
목요일
3박4일
8월6일 (목)
859,000
1,129,000
1,299,000
1,429,000
8월13일 (목)
979,000
1,259,000
1,429,000
1,539,000
8월20일 (목)
859,000
1,129,000
1,299,000
1,429,000
8월
일요일
4박5일
8월2일 (일)
799,000
1,149,000
1,339,000
1,429,000
8월9일 (일)
8월16일 (일)
---
크라운노노노
연길/백두산(북+남파) 3박4일
`;

describe('buildSourceBackedPriceDateRepair', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T00:00:00+09:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fills missing source-backed Baekdu departure dates without changing matching rows', () => {
    const result = buildSourceBackedPriceDateRepair({
      title: '연길/백두산(북+남파) 3박4일',
      duration: 4,
      raw_text: BAEKDU_GRADE_PATTERN_MATRIX,
      price_dates: [
        { date: '2026-07-02', price: 1429000, confirmed: false },
        { date: '2026-07-16', price: 1649000, confirmed: false },
        { date: '2026-07-23', price: 1429000, confirmed: false },
        { date: '2026-08-06', price: 1429000, confirmed: false },
        { date: '2026-08-13', price: 1539000, confirmed: false },
        { date: '2026-08-20', price: 1429000, confirmed: false },
      ],
      departure_days: '목요일',
    });

    expect(result.status).toBe('repaired');
    expect(result).toMatchObject({
      source: 'grade_pattern_date_matrix',
      expectedCount: 8,
      existingCount: 6,
      addedCount: 2,
    });
    if (result.status !== 'repaired') throw new Error('expected repair');
    expect(result.priceDates).toContainEqual(expect.objectContaining({ date: '2026-07-09', price: 1649000 }));
    expect(result.priceDates).toContainEqual(expect.objectContaining({ date: '2026-07-30', price: 1429000 }));
    expect(result.priceDates).toHaveLength(8);
  });

  it('repairs when an existing date conflicts with the deterministic source price', () => {
    const result = buildSourceBackedPriceDateRepair({
      title: '연길/백두산(북+남파) 3박4일',
      duration: 4,
      raw_text: BAEKDU_GRADE_PATTERN_MATRIX,
      price_dates: [
        { date: '2026-07-02', price: 1129000, confirmed: false },
      ],
      departure_days: '목요일',
    });

    expect(result.status).toBe('repaired');
    expect(result.reason).toContain('differs from source');
    if (result.status !== 'repaired') throw new Error('expected repair');
    expect(result.priceDates.find(row => row.date === '2026-07-02')?.price).toBe(1429000);
  });

  it('replaces phantom day-one departures with the source-backed price table', () => {
    const rawText = [
      '[LJ] Da Nang Hoi An 3N5D',
      '\uAE30    \uAC04',
      '\uC0C1 \uD488 \uAC00',
      '7/19',
      '8/31',
      '1\uC778 599,000\uC6D0',
      '*6/26\uAE4C\uC9C0 \uBC1C\uAD8C',
      '8/18, 25',
      '1\uC778 639,000\uC6D0',
      '7/28, 29',
      '1\uC778 799,000\uC6D0',
      '\uB8F8 \uD0C0 \uC785',
    ].join('\n');

    const result = buildSourceBackedPriceDateRepair({
      title: '[LJ] Da Nang Hoi An 3N5D',
      duration: 5,
      raw_text: rawText,
      price_dates: [
        { date: '2026-07-01', price: 799000, confirmed: false },
        { date: '2026-07-28', price: 799000, confirmed: false },
        { date: '2026-07-29', price: 799000, confirmed: false },
        { date: '2026-08-01', price: 599000, confirmed: false },
        { date: '2026-08-18', price: 639000, confirmed: false },
        { date: '2026-08-25', price: 639000, confirmed: false },
        { date: '2026-08-31', price: 599000, confirmed: false },
      ],
    });

    expect(result.status).toBe('repaired');
    if (result.status !== 'repaired') throw new Error('expected repair');
    expect(result.priceDates.map(row => row.date)).toEqual([
      '2026-07-19',
      '2026-07-28',
      '2026-07-29',
      '2026-08-18',
      '2026-08-25',
      '2026-08-31',
    ]);
    expect(result.priceDates.some(row => row.date === '2026-07-01' || row.date === '2026-08-01')).toBe(false);
  });

  it('keeps future DB departure year when the raw year is only a document date', () => {
    const rawText = [
      'PKG ZE Phu Quoc golf 4N6D',
      '2026.2.1',
      '3/29~4/30',
      '토',
      '1,319,-',
      '일,월,화',
      '1,459,-',
    ].join('\n');

    const result = buildSourceBackedPriceDateRepair({
      title: 'PKG ZE Phu Quoc golf 4N6D',
      duration: 6,
      raw_text: rawText,
      departure_days: '토',
      price_dates: [
        { date: '2027-03-06', price: 1319000, confirmed: false },
        { date: '2027-03-13', price: 1319000, confirmed: false },
      ],
    });

    expect(JSON.stringify(result)).not.toContain('2026-03');
    if (result.status === 'repaired') {
      expect(result.priceDates.every(row => row.date.startsWith('2027-'))).toBe(true);
    }
  });

  it('selects duplicate same-date transport prices from the structured variant, not raw table order', () => {
    const rows = [
      { date: '2026-09-02', adult_price: 1179000, child_price: null, status: 'available' },
      { date: '2026-09-02', adult_price: 1369000, child_price: null, status: 'available' },
      { date: '2026-09-16', adult_price: 1199000, child_price: null, status: 'available' },
      { date: '2026-09-16', adult_price: 1399000, child_price: null, status: 'available' },
    ];

    const bus = selectSourceBackedPriceRows({
      title: '\uad11\uc800\uc6b0, \ucc9c\uc800\uc6b0 5\uc77c',
      hero_tagline: '\ub9ac\ubb34\uc9c4\ubc84\uc2a4+\ub178\ud301\ub178\uc635\uc158',
      itinerary_data: {
        days: [
          { schedule: [{ activity: '\ub9ac\ubb34\uc9c4 \ubc84\uc2a4\uc774\ub3d9' }, { activity: '\uc18c\uacc4\ub9bc \uaf2c\ub9c8\uc5f4\ucc28 \uad00\uad11' }] },
        ],
      },
    }, rows);
    expect(bus.map(row => row.adult_price)).toEqual([1179000, 1199000]);

    const rail = selectSourceBackedPriceRows({
      title: '\uad11\uc800\uc6b0, \ucc9c\uc800\uc6b0 5\uc77c',
      itinerary_data: {
        days: [
          { schedule: [{ activity: 'G6080 \uace0\uc18d\uc5f4\ucc28 \uc774\ub3d9' }] },
        ],
      },
    }, rows);
    expect(rail.map(row => row.adult_price)).toEqual([1369000, 1399000]);
  });

  it('selects duplicate same-date package prices from title grade cues', () => {
    const rows = [
      { date: '2026-07-01', adult_price: 779000, child_price: null, status: 'available' },
      { date: '2026-07-01', adult_price: 869000, child_price: null, status: 'available' },
      { date: '2026-07-02', adult_price: 779000, child_price: null, status: 'available' },
      { date: '2026-07-02', adult_price: 869000, child_price: null, status: 'available' },
    ];

    const light = selectSourceBackedPriceRows({
      title: '[나트랑+달랏] 라이트PKG 3박5일',
      duration: 5,
    }, rows);
    expect(light.map(row => row.adult_price)).toEqual([779000, 779000]);

    const premium = selectSourceBackedPriceRows({
      title: '[나트랑+달랏] 품격PKG 3박5일',
      duration: 5,
    }, rows);
    expect(premium.map(row => row.adult_price)).toEqual([869000, 869000]);
  });

  it('drops option-sized same-date prices when package-sized rows are present', () => {
    const rows = [
      { date: '2026-09-01', adult_price: 30000, child_price: null, status: 'available' },
      { date: '2026-09-01', adult_price: 729000, child_price: null, status: 'available' },
      { date: '2026-09-02', adult_price: 50000, child_price: null, status: 'available' },
      { date: '2026-09-02', adult_price: 739000, child_price: null, status: 'available' },
    ];

    const selected = selectSourceBackedPriceRows({
      title: 'Da Nang Hoi An 3N5D package',
      duration: 5,
    }, rows);

    expect(selected.map(row => row.adult_price)).toEqual([729000, 739000]);
  });

  it('preserves dropped option-sized rows as excluded price candidates', () => {
    const rows = [
      { date: '2026-09-01', adult_price: 30000, child_price: null, status: 'available' },
      { date: '2026-09-01', adult_price: 729000, child_price: null, status: 'available' },
      { date: '2026-09-02', adult_price: 50000, child_price: null, status: 'available' },
      { date: '2026-09-02', adult_price: 739000, child_price: null, status: 'available' },
    ];

    const result = selectSourceBackedPriceRowsWithExclusions({
      title: 'Da Nang Hoi An 3N5D package',
      duration: 5,
    }, rows);

    expect(result.selected.map(row => row.adult_price)).toEqual([729000, 739000]);
    expect(result.excludedPriceCandidates).toEqual([
      expect.objectContaining({ date: '2026-09-01', amount: 30000, reason: 'option_sized_price_candidate' }),
      expect.objectContaining({ date: '2026-09-02', amount: 50000, reason: 'option_sized_price_candidate' }),
    ]);
  });

  it('preserves USD optional tour prices as excluded price candidates', () => {
    const result = extractExcludedPriceCandidatesFromRawText([
      'Optional tour: massage USD30 per person',
      'Optional tour: river cruise $50 per person',
      'Package adult price KRW 699,000',
    ].join('\n'));

    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ amount: 30, currency: 'USD', reason: 'optional_tour_candidate' }),
      expect.objectContaining({ amount: 50, currency: 'USD', reason: 'optional_tour_candidate' }),
    ]));
  });
});
