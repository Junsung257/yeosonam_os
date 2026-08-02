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
  it('selects the matching column from three-grade shared catalog tables', () => {
    const rawText = `
다낭 / 호이안 / 바나힐
[세이브] 실속
[스탠다드] 노팁 노옵션
[프리미엄] 노팁 노옵션
7/23
목
529,000
649,000
729,000
7/24
금
629,000
749,000
829,000
7/27(BX773 정규편)
월
529,000
649,000
729,000
7/30
목
649,000
769,000
849,000
`;

    const save = extractVerticalGradePriceTable(rawText, {
      year: 2026,
      title: '[세이브] 다낭 / 호이안 / 바나산 실속 3박5일',
      durationDays: 5,
    });
    const standard = extractVerticalGradePriceTable(rawText, {
      year: 2026,
      title: '[스탠다드] 무엉탄 송한 다낭 / 호이안 노팁 노옵션 3박5일',
      durationDays: 5,
    });
    const premium = extractVerticalGradePriceTable(rawText, {
      year: 2026,
      title: '[프리미엄] 센터포인트 다낭 / 호이안 노팁 노옵션 3박5일',
      durationDays: 5,
    });

    expect(priceForDate(save, '2026-07-23')).toBe(529000);
    expect(priceForDate(standard, '2026-07-23')).toBe(649000);
    expect(priceForDate(premium, '2026-07-23')).toBe(729000);
    expect(priceForDate(premium, '2026-07-24')).toBe(829000);
    expect(priceForDate(premium, '2026-07-27')).toBe(729000);
    expect(priceForDate(premium, '2026-07-30')).toBe(849000);
  });

  it('maps six-product spot tables by product and keeps the explicit promotion for duplicate dates', () => {
    const rawText = `
♥ 7월 선발 특가 ♥
날짜
[수,금 출발 / 패턴 : 3박 5일]
[월,토 출발 / 패턴 : 4박 6일]
나달/나판달
실속
나트랑/달랏
라이트
노팁/노옵션
나트랑/달랏
품격
노팁/노옵션
나판달
노팁/노옵션
나트랑 3박
노팁/노쇼핑
1일자유+호핑
나나달달
라이트
노팁/노옵션
3박5일
4박6일
특가
3박
7/24,29
899,000
999,000
1,109,000
1,189,000
1,379,000
7/24,29
999,000
1,099,000
1,209,000
1,289,000
1,479,000
4박
7/25,27
949,000
`;

    const products = [
      ['나트랑/판랑/달랏 전일정 5성 실속 3박5일', 899000],
      ['나트랑/달랏 전일정 5성 Light 노팁/노옵션 3박5일', 999000],
      ['나트랑/달랏 전일정 5성 품격 노팁/노옵션 3박5일', 1109000],
      ['나트랑/판랑/달랏 전일정 5성 노팁/노옵션 3박5일', 1189000],
      ['나트랑/1일자유/호핑 나트랑3박 노팁/노쇼핑 3박5일', 1379000],
    ] as const;

    for (const [title, expectedPrice] of products) {
      const tiers = extractVerticalGradePriceTable(rawText, {
        year: 2026,
        title,
        durationDays: 5,
      });
      expect(priceForDate(tiers, '2026-07-24')).toBe(expectedPrice);
      expect(tiers.filter(tier => tier.departure_dates?.includes('2026-07-24'))).toHaveLength(1);
    }

    const fourNight = extractVerticalGradePriceTable(rawText, {
      year: 2026,
      title: '나트랑/달랏 전일정 5성 Light 노팁/노옵션 4박6일',
      durationDays: 6,
    });
    expect(priceForDate(fourNight, '2026-07-24')).toBeNull();
    expect(priceForDate(fourNight, '2026-07-25')).toBe(949000);
    expect(priceForDate(fourNight, '2026-07-27')).toBe(949000);
  });

  it('preserves conflicting same-date prices when the source has no explicit promotional evidence', () => {
    const rawText = `
일반 출발 요금
실속
라이트
품격
나판달
자유호핑
3박
7/24
899,000
999,000
1,109,000
1,189,000
1,379,000
7/24
999,000
1,099,000
1,209,000
1,289,000
1,479,000
`;

    const tiers = extractVerticalGradePriceTable(rawText, {
      year: 2026,
      title: '나트랑/판랑/달랏 전일정 5성 실속 3박5일',
      durationDays: 5,
    });
    const conflictingPrices = tiers
      .filter(tier => tier.departure_dates?.includes('2026-07-24'))
      .map(tier => tier.adult_price)
      .sort((a, b) => (a ?? 0) - (b ?? 0));

    expect(conflictingPrices).toEqual([899000, 999000]);
  });

  it('does not reuse the Nha Trang column mapping for an unrelated five-column table', () => {
    const rawText = `
일반 5열 등급표
7/24
899,000
999,000
1,109,000
1,189,000
1,379,000
`;

    const tiers = extractVerticalGradePriceTable(rawText, {
      year: 2026,
      title: '1일자유+호핑 노팁/노옵션 3박5일',
      durationDays: 5,
    });

    expect(priceForDate(tiers, '2026-07-24')).toBe(899000);
  });
});
