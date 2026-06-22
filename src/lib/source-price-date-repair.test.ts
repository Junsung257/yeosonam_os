import { describe, expect, it } from 'vitest';

import { buildSourceBackedPriceDateRepair } from './source-price-date-repair';

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

  it('does not repair when an existing date conflicts with the source price', () => {
    const result = buildSourceBackedPriceDateRepair({
      title: '연길/백두산(북+남파) 3박4일',
      duration: 4,
      raw_text: BAEKDU_GRADE_PATTERN_MATRIX,
      price_dates: [
        { date: '2026-07-02', price: 1129000, confirmed: false },
      ],
      departure_days: '목요일',
    });

    expect(result.status).toBe('unsafe');
    expect(result.reason).toContain('differs from source');
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
});
