import { describe, expect, it } from 'vitest';
import type { ExtractedData } from '@/lib/parser';
import { inferDepartureDaysFromRawText } from './departure-days';
import { recoverUploadPriceData } from './price-recovery';

const CLARK_SHARED_TABLE = `
클락 알뜰 3색 골프+단독행사
풀빌라 더비스타 2색 골프

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
7/11,12
1,089,-
1,249,-
6/4~6/30
8/29~9/22
9/25~9/30
토,일(4박)
1,189,-
1,349,-
수
1,169,-
1,289,-
목
1,249,-
1,369,-
7/1~7/14
8/14~8/28
10/2~10/6
10/9~10/22
토,일(4박)
1,229,-
1,389,-
수
1,209,-
1,329,-
목
1,289,-
1,409,-
7/17~8/11
토,일(4박)
1,329,-
1,489,-
수
1,289,-
1,409,-
목
1,369,-
1,489,-
항공제외일 - 7/15,16, 8/12,13, 9/23,24, 10/1,7,8
`;

function productRaw(title: string, departureDays: string, hotel: string): string {
  return `${CLARK_SHARED_TABLE}

PKG
${title}
2026.4.1
출 발 일
6/1~10/24 (${departureDays})
판 매 가
요금표 참조
포함사항
왕복항공료, 유류할증료, 숙박, 식사(조식), 그린피, 여행자보험, 단독차량
불포함사항
개인경비, 주말골프 추가금 18홀/15,000원/인

일 자
제1일
HOTEL: ${hotel}
`;
}

async function recover(title: string, duration: number, departureDays: string, hotel: string) {
  const rawText = productRaw(title, departureDays, hotel);
  const ed: ExtractedData = {
    title,
    category: 'package',
    product_type: 'package',
    destination: '클락',
    duration,
    rawText,
    price_tiers: [],
  };
  return recoverUploadPriceData(ed, {
    rawText,
    title,
    durationDays: duration,
    departureDays: inferDepartureDaysFromRawText(rawText),
    accommodations: [hotel],
    year: 2026,
  });
}

describe('Clark multi-product shared spot weekday price table', () => {
  it('selects the economy column and weekday departures for 3-night products', async () => {
    const result = await recover('클락 알뜰 3색골프 + 단독차량 3박5일', 5, '수,목', '클로버호텔 또는 동급');

    expect(result.ok).toBe(true);
    expect(result.source).toBe('deterministic:spot_weekday_table');
    expect(result.minPrice).toBe(1139000);
    expect(result.priceDates.find(row => row.date === '2026-07-02')?.price).toBe(1139000);
    expect(result.priceDates.find(row => row.date === '2026-06-20')).toBeUndefined();
  });

  it('selects the premium villa column and weekday departures for premium 3-night products', async () => {
    const result = await recover('클락 품격 풀빌라 더비스타 2색골프 + 단독차량 3박5일', 5, '수,목', '휴젠 풀빌라 또는 동급 *1베드');

    expect(result.ok).toBe(true);
    expect(result.minPrice).toBe(1259000);
    expect(result.priceDates.find(row => row.date === '2026-07-02')?.price).toBe(1259000);
    expect(result.priceDates.find(row => row.date === '2026-06-20')).toBeUndefined();
  });

  it('keeps the 4-night weekend row and premium column for premium 4-night products', async () => {
    const result = await recover('클락 품격 풀빌라 더비스타 2색골프 + 단독차량 4박6일', 6, '토,일', '휴젠 풀빌라 또는 동급 *1베드');

    expect(result.ok).toBe(true);
    expect(result.minPrice).toBe(1159000);
    expect(result.priceDates.find(row => row.date === '2026-06-20')?.price).toBe(1159000);
    expect(result.priceDates.find(row => row.date === '2026-08-30')?.price).toBe(1349000);
    expect(result.priceDates.find(row => row.date === '2026-07-02')).toBeUndefined();
  });
});
