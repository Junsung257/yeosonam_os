import { describe, expect, it } from 'vitest';
import { tiersToDatePrices } from '@/lib/price-dates';
import { priceTiersToRows } from '@/lib/upload-validator';
import { extractDeterministicPriceTiers } from './price-table-ir';

const CEBU_THREE_HOTEL_MATRIX = `
부산出 세부 세미 PKG 3박 5일 진에어(LJ)
★ 여름휴가 ★
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
수목금
889,000
1,079,000
1,119,000
포 함 사 항
 항공요금+유류/텍스, 여행자보험, 전 일정 호텔(2인1실), 조식 및 일정상 식사
제1일
부산
세부
`;

const GOLF_PERIOD_DOW_MATRIX = `
후쿠오카 도스 다색골프 54H 2박3일

5/1~8/31
월~금
1,209,000
토~일
1,309,000

포함 사항
왕복항공료, 골프비용
제1일
후쿠오카 도착
`;

const MONTH_DOW_TABLE = `
부산 대만 3박4일
5월
일-수
19, 25, 31
159,000
목
7, 14, 21, 28
219,000
포함사항
항공료
`;

const PHU_QUOC_SPOT_AND_WEEKDAY_TABLE = `
[부산출발][가족여행] 푸꾸옥 뉴월드 풀빌라 자유여행 5일
#가족여행 #호캉스 #풀빌라
스 팟 특 가
출 발 일
1인 상품가
7/1
959,000 원
6/24 & 7/8 & 9/2
969,000 원
출 발 요 일
출 발 일
1인 상품가
수요일 / 목요일 출발

● 비운항 상세 날짜
6/7, 11, 14, 18, 21, 25, 28

● 써챠지
7/1 출발~ 8/30출발
1인 5만원추가
6/7-6/30
9/1-9/22
1,199,000 원
7/1-7/24
10/9-10/24
1,249,000 원
8/1-8/11
1,329,000 원
8/17-8/31
1,599,000 원
7/25-7/31
1,699,000 원
10/1-10/8
1,899,000 원
9/23-9/30
2,029,000 원

일 자
지 역
교 통
`;

const PHU_QUOC_SAME_LINE_PRICE_TABLE = `
[부산출발][가족여행] 푸꾸옥 뉴월드 풀빌라 자유여행 5일
스 팟 특 가
출 발 일
1인 상품가
7/1 959,000 원
6/24 & 7/8 & 9/2 969,000 원
출 발 요 일
수요일 / 목요일 출발
● 써챠지
7/1 출발~ 8/30출발
1인 5만원추가
6/7-6/30 1,199,000 원
7/1-7/24 1,249,000 원
일 자
제1일
부산
`;

const PHU_QUOC_FULL_UPLOAD_TEXT = `
[부산출발][가족여행] 푸꾸옥 뉴월드 풀빌라 자유여행 5일
#가족여행 #호캉스 #풀빌라 #골프,빈원더스,사파리 추가선택가능

포 함 사 항
■ 왕복항공권, 유류할증료 및 텍스
■ 뉴월드푸꾸옥 - 가든풀빌라 2BED룸 (조식포함)
■ 푸꾸옥 공항 - 리조트 왕복 픽업
■ 여행자 보험
불포함 사항
■ 기타 개인경비 및 매너 팁
■ 써챠지 7월1일 출발~ 8월30일출발 1인 5만원추가

★선택★
추천관광 (3) 푸꾸옥 빈원더스 푸꾸옥 티켓 입장권
* 성인 : 50,000원/인 * 소아 : 40,000원/인
추천관광 (4) 푸꾸옥 빈펄 사파리 입장 티켓
* 성인 : 50,000원/인 * 소아 : 40,000원/인

[부산출발][가족여행] 푸꾸옥 뉴월드 풀빌라 자유여행 5일
스 팟 특 가
출 발 일
1인 상품가
7/1
959,000 원
6/24 & 7/8 & 9/2
969,000 원
출 발 요 일
출 발 일
1인 상품가
수요일 / 목요일 출발

● 비운항 상세 날짜
6/7, 11, 14, 18, 21, 25, 28

● 써챠지
7/1 출발~ 8/30출발
1인 5만원추가
6/7-6/30
9/1-9/22
1,199,000 원
7/1-7/24
10/9-10/24
1,249,000 원
8/1-8/11
1,329,000 원
8/17-8/31
1,599,000 원
7/25-7/31
1,699,000 원
10/1-10/8
1,899,000 원
9/23-9/30
2,029,000 원

일 자
지 역
교 통
시 간
행 사 일 정
제1일
부산
푸꾸옥
ZE981
18:55
22:25
김해 국제공항 출발
푸꾸옥 국제공항 도착 후 기사 미팅하여 호텔 이동
`;

const PHU_QUOC_KOREAN_MONTH_SURCHARGE_TABLE = `
[부산출발][가족여행] 푸꾸옥 뉴월드 풀빌라 자유여행 5일
스 팟 특 가
출 발 일
1인 상품가
7/1
959,000 원
6/24 & 7/8 & 9/2
969,000 원
출 발 요 일
수요일 / 목요일 출발
● 써챠지 7월1일 출발~ 8월30일출발 1인 5만원추가
6월7일-6월30일 1,199,000 원
7월1일-7월24일 1,249,000 원
일 자
제1일
부산
`;

function assertUploadGatePriceReady(tiers: ReturnType<typeof extractDeterministicPriceTiers>['tiers']) {
  const priceRows = priceTiersToRows({ title: 'fixture', price_tiers: tiers } as never);
  const priceDates = tiersToDatePrices(tiers as never);
  expect(priceRows.length).toBeGreaterThan(0);
  expect(priceDates.length).toBeGreaterThan(0);
}

describe('extractDeterministicPriceTiers', () => {
  it('keeps the upload gate open for Cebu horizontal hotel-column matrices', () => {
    const result = extractDeterministicPriceTiers(CEBU_THREE_HOTEL_MATRIX, {
      year: 2026,
      title: '준특급 · 세부 · 3박 5일 · 진에어',
      accommodations: ['솔레아[준특급]'],
    });

    expect(result.source).toBe('hotel_column_matrix');
    expect(result.rows).toHaveLength(45);
    expect(result.tiers).toHaveLength(6);
    expect(Math.min(...result.rows.map(row => row.adult_price))).toBe(859000);
    expect(result.rows.filter(row => row.date === '2026-07-25').map(row => row.adult_price).sort((a, b) => a - b)).toEqual([
      859000,
      1029000,
      1079000,
    ]);
    expect(new Set(result.rows.filter(row => row.date === '2026-07-25').map(row => row.option_label))).toEqual(new Set([
      '솔레아[준특급]',
      '두짓타니[특급]',
      '제이파크[특급]',
    ]));
    assertUploadGatePriceReady(result.tiers);
  });

  it('keeps existing period and DOW matrix extraction in the same path', () => {
    const result = extractDeterministicPriceTiers(GOLF_PERIOD_DOW_MATRIX, { year: 2026 });

    expect(result.source).toBe('period_dow_matrix');
    expect(result.rows.length).toBeGreaterThan(50);
    expect(result.tiers.length).toBeGreaterThan(0);
    assertUploadGatePriceReady(result.tiers);
  });

  it('keeps month/DOW/date-list tables in the same path', () => {
    const result = extractDeterministicPriceTiers(MONTH_DOW_TABLE, { year: 2026 });

    expect(result.source).toBe('month_dow_table');
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.tiers.length).toBeGreaterThan(0);
    assertUploadGatePriceReady(result.tiers);
  });

  it('keeps spot specials plus weekday period tables upload-ready', () => {
    const result = extractDeterministicPriceTiers(PHU_QUOC_SPOT_AND_WEEKDAY_TABLE, {
      year: 2026,
      title: '[부산출발][가족여행] 푸꾸옥 뉴월드 풀빌라 자유여행 5일',
      accommodations: ['뉴월드푸꾸옥 - 가든풀빌라 2BED룸'],
    });

    expect(result.source).toBe('weekday_period_table');
    expect(result.rows.length).toBeGreaterThan(35);
    expect(result.rows.find(row => row.date === '2026-07-01')?.adult_price).toBe(1009000);
    expect(result.rows.find(row => row.date === '2026-07-02')?.adult_price).toBe(1299000);
    expect(result.rows.find(row => row.date === '2026-06-24')?.adult_price).toBe(969000);
    expect(result.rows.find(row => row.date === '2026-09-03')?.adult_price).toBe(1199000);
    expect(result.rows.find(row => row.date === '2026-06-11')).toBeUndefined();
    expect(result.rows.some(row => row.adult_price === 50000)).toBe(false);
    assertUploadGatePriceReady(result.tiers);
  });

  it('keeps same-line spot and period prices upload-ready', () => {
    const result = extractDeterministicPriceTiers(PHU_QUOC_SAME_LINE_PRICE_TABLE, { year: 2026 });

    expect(result.source).toBe('weekday_period_table');
    expect(result.rows.find(row => row.date === '2026-07-01')?.adult_price).toBe(1009000);
    expect(result.rows.find(row => row.date === '2026-07-02')?.adult_price).toBe(1299000);
    expect(result.rows.find(row => row.date === '2026-06-24')?.adult_price).toBe(969000);
    assertUploadGatePriceReady(result.tiers);
  });

  it('keeps the full Phu Quoc upload text deliverable-ready without optional-tour price pollution', () => {
    const result = extractDeterministicPriceTiers(PHU_QUOC_FULL_UPLOAD_TEXT, {
      year: 2026,
      title: '[부산출발][가족여행] 푸꾸옥 뉴월드 풀빌라 자유여행 5일',
      accommodations: ['뉴월드푸꾸옥 - 가든풀빌라 2BED룸'],
    });

    expect(result.source).toBe('weekday_period_table');
    expect(result.rows.length).toBeGreaterThan(35);
    expect(result.rows.find(row => row.date === '2026-07-01')?.adult_price).toBe(1009000);
    expect(result.rows.find(row => row.date === '2026-07-02')?.adult_price).toBe(1299000);
    expect(result.rows.find(row => row.date === '2026-06-24')?.adult_price).toBe(969000);
    expect(result.rows.find(row => row.date === '2026-06-11')).toBeUndefined();
    expect(result.rows.some(row => row.adult_price === 50000 || row.adult_price === 40000)).toBe(false);
    assertUploadGatePriceReady(result.tiers);
  });

  it('applies same-line Korean month/day surcharges and period ranges', () => {
    const result = extractDeterministicPriceTiers(PHU_QUOC_KOREAN_MONTH_SURCHARGE_TABLE, { year: 2026 });

    expect(result.source).toBe('weekday_period_table');
    expect(result.rows.find(row => row.date === '2026-07-01')?.adult_price).toBe(1009000);
    expect(result.rows.find(row => row.date === '2026-07-02')?.adult_price).toBe(1299000);
    expect(result.rows.find(row => row.date === '2026-06-24')?.adult_price).toBe(969000);
    expect(result.rows.find(row => row.date === '2026-06-10')?.adult_price).toBe(1199000);
    expect(result.rows.some(row => row.adult_price === 50000)).toBe(false);
    assertUploadGatePriceReady(result.tiers);
  });
});
