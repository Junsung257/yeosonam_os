import { describe, expect, it } from 'vitest';
import { extractPriceMatrix } from './price-matrix';
import { extractPriceTable } from './price-table';
import { extractVerticalGradePriceTable, inferVerticalGradeFromText } from './vertical-grade-price-table';

const PHU_QUOC_VERTICAL_SPOT_TABLE = `
[부산출발] 26년 5월 ~ 7월
 푸꾸옥 실속&고품격 5/6일 패키지
★SPOT스팟특가★
출발일
 요일
실속
고품격(노옵션)
5/21

929,000
1,219,000
5/24
4박6일
829,000
1,119,000
5/31
3박5일
679,000
969,000
6/6,13,20

789,000
1,079,000
6/24

719,000
1,009,000
7/1,15,22

789,000
1,079,000
7/4,5
4박6일
859,000
1,139,000
7/8

769,000
1,049,000
7/11
4박6일
809,000
1,099,000
7/18,25
4박6일
829,000
1,119,000
7/29

1,039,000
1,329,000
※ 현재 적용된 항공요금은 특가요금이며, 5월 28일까지 발권하는 조건입니다.
비     고
`;

function priceForDate(tiers: ReturnType<typeof extractVerticalGradePriceTable>, date: string): number | null {
  const tier = tiers.find(t => t.departure_dates.includes(date));
  return tier?.adult_price ?? null;
}

describe('extractVerticalGradePriceTable', () => {
  it('recovers Phu Quoc economy spot prices missed by existing deterministic parsers', () => {
    expect(extractPriceMatrix(PHU_QUOC_VERTICAL_SPOT_TABLE, 2026)).toHaveLength(0);
    expect(extractPriceTable(PHU_QUOC_VERTICAL_SPOT_TABLE, 2026)).toHaveLength(0);

    const tiers = extractVerticalGradePriceTable(PHU_QUOC_VERTICAL_SPOT_TABLE, {
      grade: '실속',
    });
    const dates = tiers.flatMap(t => t.departure_dates);

    expect(dates).toHaveLength(17);
    expect(priceForDate(tiers, '2026-05-31')).toBe(679000);
    expect(priceForDate(tiers, '2026-07-04')).toBe(859000);
    expect(priceForDate(tiers, '2026-07-29')).toBe(1039000);
    expect(tiers.find(t => t.departure_dates.includes('2026-07-04'))?.note).toBe('4박6일');
  });

  it('selects premium/no-option prices from the same table', () => {
    const tiers = extractVerticalGradePriceTable(PHU_QUOC_VERTICAL_SPOT_TABLE, {
      grade: '고품격(노옵션)',
    });

    expect(priceForDate(tiers, '2026-05-31')).toBe(969000);
    expect(priceForDate(tiers, '2026-07-04')).toBe(1139000);
    expect(priceForDate(tiers, '2026-07-29')).toBe(1329000);
  });

  it('splits shared Phu Quoc spot table by 3n5d and 4n6d departure rules', () => {
    const threeNight = extractVerticalGradePriceTable(PHU_QUOC_VERTICAL_SPOT_TABLE, {
      grade: '?ㅼ냽',
      durationDays: 5,
      title: '부산출발 푸꾸옥 실속 PKG 3박5일',
    });
    const fourNight = extractVerticalGradePriceTable(PHU_QUOC_VERTICAL_SPOT_TABLE, {
      grade: '?ㅼ냽',
      durationDays: 6,
      title: '부산출발 푸꾸옥 실속 PKG 4박6일',
    });

    const threeDates = threeNight.flatMap(t => t.departure_dates).sort();
    const fourDates = fourNight.flatMap(t => t.departure_dates).sort();

    expect(threeDates).toEqual([
      '2026-05-21',
      '2026-05-31',
      '2026-06-24',
      '2026-07-01',
      '2026-07-08',
      '2026-07-15',
      '2026-07-22',
      '2026-07-29',
    ]);
    expect(fourDates).toEqual([
      '2026-05-24',
      '2026-06-06',
      '2026-06-13',
      '2026-06-20',
      '2026-07-04',
      '2026-07-05',
      '2026-07-11',
      '2026-07-18',
      '2026-07-25',
    ]);
    expect(priceForDate(threeNight, '2026-05-31')).toBe(679000);
    expect(priceForDate(fourNight, '2026-07-04')).toBe(859000);
  });

  it('infers the target grade from product section titles', () => {
    expect(inferVerticalGradeFromText('부산출발 푸꾸옥 실속 PKG 3박5일')).toBe('economy');
    expect(inferVerticalGradeFromText('부산출발 푸꾸옥 고품격 노옵션 PKG 4박6일')).toBe('premium');
  });
});
