import { describe, expect, it } from 'vitest';
import { extractPriceIR } from './index';

const HOTEL_COLUMN_MATRIX = `
부산出 세부 세미 PKG 3박 5일 진에어(LJ)
출발일
요일
솔레아[준특급]
두짓타니[특급]
제이파크[특급]
7/24~8/7
토일월화
859,000
1,029,000
1,079,000
포 함 사 항
항공요금
제1일
부산
`;

const PERIOD_DOW_MATRIX = `
후쿠오카 도스 다색골프 54H 2박3일
5/1~8/31
월~금
1,209,000
토~일
1,309,000
포함 사항
왕복항공료
제1일
후쿠오카 도착
`;

describe('extractPriceIR', () => {
  it('provides the new price IR entrypoint for existing deterministic parsers', () => {
    const result = extractPriceIR(`
부산 대만 3박4일
5월
일-수
19, 25, 31
159,000
포함사항
항공료
`, { year: 2026 });

    expect(result.source).toBe('month_dow_table');
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.tiers.length).toBeGreaterThan(0);
  });

  it('classifies hotel-column and period-DOW matrices separately', () => {
    const hotel = extractPriceIR(HOTEL_COLUMN_MATRIX, {
      year: 2026,
      title: '준특급 세부',
      accommodations: ['솔레아[준특급]'],
    });
    const period = extractPriceIR(PERIOD_DOW_MATRIX, { year: 2026 });

    expect(hotel.source).toBe('hotel_column_matrix');
    expect(hotel.rows.length).toBeGreaterThan(0);
    expect(period.source).toBe('period_dow_matrix');
    expect(period.rows.length).toBeGreaterThan(0);
  });
});

describe('extractPriceIR Fukuoka spot weekday table', () => {
  it('recovers spot specials plus shorthand weekday prices', () => {
    const rawText = `
26.5.19배포
PKG
BX후쿠오카 파라다이스 골프 패키지 54H 초석 2박3일
출 발 일
매일출발
판 매 가
요금표참조
스팟특가
*실시간항공기준
6/16
999,-
7/14
969,-
5/1~6/5
일
1,209,-
월,화,수
1,279,-
목
1,379,-
금
1,439,-
토
1,329,-
6/6~7/16
일
1,179,-
월,화,수
1,249,-
목
1,349,-
금
1,409,-
토
1,299,-
7/17~8/7
일
1,189,-
월,화,수
1,259,-
목
1,369,-
금
1,429,-
토
1,319,-
8/8~8/31
일
1,169,-
월,화,수
1,239,-
목
1,349,-
금
1,409,-
토
1,299,-
● 항공제외일 – 5/23,24 7/17, 8/15,16
● 현지지상비 추가일자 – 일본 공휴일은 8만원/회/인당 추가 요금 있습니다.

일본골프상품 취소규정 안내
* 예약 후 취소 시
 1인 200,000원씩 공제 후 환불

[현금영수증 발급 안내 드립니다]
현금영수증은 항공요금(항공사)+행사비(랜드사)로 나눠서 발급해드립니다.
`;

    const result = extractPriceIR(rawText, {
      year: 2026,
      title: 'BX후쿠오카 파라다이스 골프 패키지 54H 초석 2박3일',
      durationDays: 3,
      departureDays: '매일출발',
    });

    expect(result.source).toBe('spot_weekday_table');
    expect(result.rows.length).toBeGreaterThan(90);
    expect(Math.min(...result.rows.map(row => row.adult_price))).toBe(969000);
    expect(result.rows.find(row => row.date === '2026-06-16')?.adult_price).toBe(999000);
    expect(result.rows.find(row => row.date === '2026-07-14')?.adult_price).toBe(969000);
    expect(result.rows.find(row => row.date === '2026-05-01')?.adult_price).toBe(1439000);
    expect(result.rows.find(row => row.date === '2026-05-03')?.adult_price).toBe(1209000);
    expect(result.rows.find(row => row.date === '2026-05-23')).toBeUndefined();
    expect(result.rows.find(row => row.date === '2026-08-15')).toBeUndefined();
    expect(result.rows.some(row => row.adult_price === 200000)).toBe(false);
    expect(result.tiers.length).toBeGreaterThan(0);
  });
});

describe('extractPriceIR multi-column spot weekday table', () => {
  it('recovers comma-separated spot dates and the first product price column', () => {
    const rawText = `
출발일
요일
이라크 펄 3색골프
데빌라 디비스타 2색골프
스팟특가
6/20,21,28
999,-
1,159,-
7/2,9
1,139,-
1,259,-
6/4~6/30
8/29~9/22
목
1,249,-
1,369,-
`;

    const result = extractPriceIR(rawText, { year: 2026 });

    expect(result.source).toBe('spot_weekday_table');
    expect(result.rows.find(row => row.date === '2026-06-20')?.adult_price).toBe(999000);
    expect(result.rows.find(row => row.date === '2026-06-21')?.adult_price).toBe(999000);
    expect(result.rows.find(row => row.date === '2026-06-28')?.adult_price).toBe(999000);
    expect(result.rows.find(row => row.date === '2026-07-02')?.adult_price).toBe(1139000);
    expect(result.rows.find(row => row.date === '2026-06-04')?.adult_price).toBe(1249000);
    expect(result.rows.some(row => row.adult_price === 1159000 || row.adult_price === 1369000)).toBe(false);
  });
});
