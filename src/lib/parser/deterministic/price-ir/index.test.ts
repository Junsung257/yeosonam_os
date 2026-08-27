import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractPriceIR } from './index.ts';

afterEach(() => {
  vi.useRealTimers();
});

const WON = '\uC6D0';
const MONTH_KO = '\uC6D4';
const MONTH_CJK = '\u6708';

describe('extractPriceIR PDF date price tables', () => {
  it('binds one product price to date cells split around HWP table labels', () => {
    const rawText = [
      '[LJ] \uB2E4\uB0AD 3\uBC155\uC77C',
      '3/14, 24',
      '12% COMM',
      '\uAE30    \uAC04',
      '1\uC778 399,000\uC6D0',
      '/',
      '*2/25\uAE4C\uC9C0 \uBC1C\uAD8C',
      '\uC0C1 \uD488 \uAC00',
      '4/5, 26',
      '\uD3EC\uD568 \uC655\uBCF5\uD56D\uACF5\uB8CC',
      '\uBD88\uD3EC\uD568 \uAC1C\uC778\uACBD\uBE44',
    ].join('\n');

    const result = extractPriceIR(rawText, { year: 2026 });
    expect(result.source).toBe('labeled_date_list_price');
    expect(result.rows.map(row => [row.date, row.adult_price])).toEqual([
      ['2026-03-14', 399000],
      ['2026-03-24', 399000],
      ['2026-04-05', 399000],
      ['2026-04-26', 399000],
    ]);
  });

  it('does not use an excluded adult guide or fuel fee as the package price', () => {
    const rawText = [
      '출발일& 상품가',
      '4/30(목)',
      '1,089,000원',
      '5/1(금)',
      '1,289,000원',
      '5/2(토)',
      '1,199,000원',
      '5/3(일)',
      '1,199,000원',
      '포함 사항',
      '왕복항공료, 호텔, 식사',
      '불포함 사항',
      '유류 26,500원, 가이드경비 3만원 성인/아동 동일',
    ].join('\n');

    const result = extractPriceIR(rawText, { year: 2026 });
    expect(result.source).toBe('pdf_date_price_table');
    expect(result.rows.map(row => [row.date, row.adult_price])).toEqual([
      ['2026-04-30', 1_089_000],
      ['2026-05-01', 1_289_000],
      ['2026-05-02', 1_199_000],
      ['2026-05-03', 1_199_000],
    ]);
  });

  it('recovers departure ranges and prices from compact PDF text', () => {
    const rawText = `
5/6~5/17 , 409,000 5/24~5/28 , 429,000
5/6~5/17 , 399,000 5/24~5/28 , 419,000
PKG Bohol direct slim package 5 days / 6 days
`;

    const result = extractPriceIR(rawText, { year: 2026 });

    expect(result.source).toBe('pdf_date_price_table');
    expect(result.rows).toContainEqual(expect.objectContaining({ date: '2026-05-06', adult_price: 409000 }));
    expect(result.rows).toContainEqual(expect.objectContaining({ date: '2026-05-17', adult_price: 409000 }));
    expect(result.rows).toContainEqual(expect.objectContaining({ date: '2026-05-24', adult_price: 429000 }));
    expect(result.rows).toContainEqual(expect.objectContaining({ date: '2026-05-28', adult_price: 419000 }));
  });

  it('recovers concatenated day and price tails from month sections', () => {
    const rawText = `
5${MONTH_CJK}
5/12, 19769,000${WON}
5/10, 17, 26829,000${WON}
5/5, 31869,000${WON}
5/241,049,000${WON}
5/31,149,000${WON}
6${MONTH_CJK}
6/2, 9, 16859,000${WON}
6/21, 28, 29989,000${WON}
`;

    const result = extractPriceIR(rawText, { year: 2026 });

    expect(result.source).toBe('pdf_date_price_table');
    expect(result.rows).toContainEqual(expect.objectContaining({ date: '2026-05-19', adult_price: 769000 }));
    expect(result.rows).toContainEqual(expect.objectContaining({ date: '2026-05-26', adult_price: 829000 }));
    expect(result.rows).toContainEqual(expect.objectContaining({ date: '2026-05-31', adult_price: 869000 }));
    expect(result.rows).toContainEqual(expect.objectContaining({ date: '2026-05-24', adult_price: 1049000 }));
    expect(result.rows).toContainEqual(expect.objectContaining({ date: '2026-05-31', adult_price: 1149000 }));
    expect(result.rows).toContainEqual(expect.objectContaining({ date: '2026-06-16', adult_price: 859000 }));
    expect(result.rows).toContainEqual(expect.objectContaining({ date: '2026-06-29', adult_price: 989000 }));
  });

  it('recovers split price fragments and date-line price-line pairs', () => {
    const rawText = `
4/2, 4/16 969, ${WON}
000
5${MONTH_KO}
5/7, 5/28 999, ${WON}
000
${MONTH_KO}7
7/1, 6, 12, 14
1,249,${WON}000
7/16, 17, 18, 24, 25
1,649,${WON}000
`;

    const result = extractPriceIR(rawText, { year: 2026 });

    expect(result.source).toBe('pdf_date_price_table');
    expect(result.rows).toContainEqual(expect.objectContaining({ date: '2026-04-02', adult_price: 969000 }));
    expect(result.rows).toContainEqual(expect.objectContaining({ date: '2026-05-28', adult_price: 999000 }));
    expect(result.rows).toContainEqual(expect.objectContaining({ date: '2026-07-14', adult_price: 1249000 }));
    expect(result.rows).toContainEqual(expect.objectContaining({ date: '2026-07-25', adult_price: 1649000 }));
  });

  it('recovers HWP table cells flattened as price before departure dates', () => {
    const rawText = [
      '\u2605\uCDE8\uD56D\uD2B9\uAC00\u2605',
      '999,000',
      '4/7',
      '1,069,000',
      '4/14, 21',
      '1,129,000',
      '4/28, 5/5',
      '1,069,000',
      '5/12, 19, 26',
    ].join('\n');

    const result = extractPriceIR(rawText, { year: 2026 });
    const pricesByDate = new Map(result.rows.map(row => [row.date, row.adult_price]));

    expect(pricesByDate).toEqual(new Map([
      ['2026-04-07', 999000],
      ['2026-04-14', 1069000],
      ['2026-04-21', 1069000],
      ['2026-04-28', 1129000],
      ['2026-05-05', 1129000],
      ['2026-05-12', 1069000],
      ['2026-05-19', 1069000],
      ['2026-05-26', 1069000],
    ]));
  });

  it('binds a Korean month/day roster on the line above its sale price', () => {
    const rawText = [
      'PIC 호텔 괌 노쇼핑 패키지 4박5일',
      '7월20일, 23일, 8월21일',
      '859,000원',
      '8월24일, 31일',
      '799,000원',
      '상품가 및 출발일',
      '포함사항 왕복항공료 호텔 조식',
    ].join('\n');

    const result = extractPriceIR(rawText, { year: 2026, durationDays: 5 });
    const pricesByDate = new Map(result.rows.map(row => [row.date, row.adult_price]));

    expect(['pdf_date_price_table', 'product_price_vertical_date_table']).toContain(result.source);
    expect(pricesByDate).toEqual(new Map([
      ['2026-07-20', 859000],
      ['2026-07-23', 859000],
      ['2026-08-21', 859000],
      ['2026-08-24', 799000],
      ['2026-08-31', 799000],
    ]));
  });

  it('recovers a vertical HWP price followed by multiple month/day groups', () => {
    const rawText = [
      '상품명 오사카 3박4일',
      '판매가',
      '★900,000★',
      '4월 20,22,27,29',
      '4월 21,26,28',
      '5월 6,11,13,18,20',
      '950,000',
      '6월 10,17,24',
      '7월 1,8',
      '포함사항 왕복항공료 호텔 식사',
    ].join('\n');

    const result = extractPriceIR(rawText, { year: 2026, durationDays: 4 });
    const pricesByDate = new Map(result.rows.map(row => [row.date, row.adult_price]));

    expect(result.source).toBe('product_price_vertical_date_table');
    expect(pricesByDate.get('2026-04-20')).toBe(900_000);
    expect(pricesByDate.get('2026-05-20')).toBe(900_000);
    expect(pricesByDate.get('2026-06-17')).toBe(950_000);
    expect(pricesByDate.get('2026-07-08')).toBe(950_000);
  });

  it('does not turn per-person labels into phantom day-one departures', () => {
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

    const result = extractPriceIR(rawText, { year: 2026, durationDays: 5 });
    const byDate = new Map(result.rows.map(row => [row.date, row.adult_price]));

    expect(result.source).toBe('pdf_date_price_table');
    expect(byDate).toEqual(new Map([
      ['2026-07-19', 599000],
      ['2026-07-28', 799000],
      ['2026-07-29', 799000],
      ['2026-08-18', 639000],
      ['2026-08-25', 639000],
      ['2026-08-31', 599000],
    ]));
    expect(byDate.has('2026-07-01')).toBe(false);
    expect(byDate.has('2026-08-01')).toBe(false);
  });

  it('does not turn cruise vessel specifications into a selling price', () => {
    const rawText = [
      '2026\uB144 5\uC6D4 14\uC77C \uB3D9\uACBD \uD06C\uB8E8\uC988 4\uBC15 5\uC77C',
      '\uD06C\uB8E8\uC988 \uC81C\uC6D0',
      '\u25C6 \uCD1D \uD1A4\uC218 171.598\uD1A4 \u25C6 \uC804\uC7A5/\uC804\uD3ED/\uC804\uACE0 316m/43m/76M \u25C6 \uCD1D \uD0D1\uC2B9\uAC1D 5,655\uBA85 \u25C6 \uC2B9\uBB34\uC6D0\uC218 1,595\uBA85',
    ].join('\n');

    expect(extractPriceIR(rawText, { year: 2026 }).rows).toEqual([]);
  });

  it('recovers spaced month day price rows without slash separators', () => {
    const rawText = [
      '\uAD6C\uCC44\uAD6C \uC2E0\uC120\uC9C0 \uD669\uB8E1',
      '4 22 1,349,000',
      '4 29 1,379,000',
      '5 6, 13, 20, 27 1,179,000',
      '6 10, 17, 24 1,149,000',
      '\uC11C\uC548 \uC18C\uB9BC\uC0AC',
      '4\uC6D4 8, 15, 29\uC77C 1,029,000',
      '5\uC6D4 6, 13, 20, 27\uC77C 879,000',
      '6\uC6D4 10, 17, 24\uC77C 829,000',
    ].join('\n');

    const result = extractPriceIR(rawText, { year: 2026 });

    expect(result.source).toBe('pdf_date_price_table');
    expect(result.rows).toContainEqual(expect.objectContaining({ date: '2026-04-22', adult_price: 1349000 }));
    expect(result.rows).toContainEqual(expect.objectContaining({ date: '2026-05-27', adult_price: 1179000 }));
    expect(result.rows).toContainEqual(expect.objectContaining({ date: '2026-06-24', adult_price: 1149000 }));
    expect(result.rows).toContainEqual(expect.objectContaining({ date: '2026-04-08', adult_price: 1029000 }));
    expect(result.rows).toContainEqual(expect.objectContaining({ date: '2026-05-20', adult_price: 879000 }));
    expect(result.rows).toContainEqual(expect.objectContaining({ date: '2026-06-17', adult_price: 829000 }));
  });

  it('treats a dot as a Korean thousands separator in a date-price context', () => {
    const rawText = [
      '8월 25일, 30일, 31일 : 299.000원',
      '9월 14일, 20일, 29일 : 269.000원',
      '10월 5일, 12일, 19일 : 339.000원',
      '11월 5일, 12일, 19일 : 339.000원',
    ].join('\n');

    const result = extractPriceIR(rawText, { year: 2026 });
    const pricesByDate = new Map(result.rows.map(row => [row.date, row.adult_price]));

    expect(result.source).toBe('pdf_date_price_table');
    expect(pricesByDate.get('2026-08-25')).toBe(299000);
    expect(pricesByDate.get('2026-09-29')).toBe(269000);
    expect(pricesByDate.get('2026-10-12')).toBe(339000);
    expect(pricesByDate.get('2026-11-19')).toBe(339000);
    expect(extractPriceIR([
      '다낭 3박5일 상품 요금표',
      '출발일 및 성인 판매가',
      '8월 25일 : 299.000',
      '포함사항 왕복항공 호텔 조식',
    ].join('\n'), { year: 2026 }).rows).toEqual([
      expect.objectContaining({ date: '2026-08-25', adult_price: 299_000 }),
    ]);
  });

  it('uses later monthly rows as corrections and repairs one missing trailing zero', () => {
    const rawText = [
      '7\uC6D4',
      '\u26057/24\uAE4C\uC9C0 \uC120\uBC1C\uAD8C \uC870\uAC74\u2605',
      '7/19, 24',
      '1,099,000\uC6D0',
      '8\uC6D4',
      '8/2,7,8,12,16,20,27',
      '1,069,000\uC6D0',
      '8/7,8,16,20',
      '1,099,000\uC6D0',
      '8/15',
      '1,199,00\uC6D0',
      '9\uC6D4',
      '9/4,5,10,11,12,17,21',
      '1,019,000\uC6D0',
      '9/3,18,20,21',
      '1,049,000\uC6D0',
    ].join('\n');

    const result = extractPriceIR(rawText, { year: 2026, durationDays: 4 });
    const pricesByDate = new Map(result.rows.map(row => [row.date, row.adult_price]));

    expect(result.source).toBe('pdf_date_price_table');
    expect(pricesByDate.get('2026-07-24')).toBe(1_099_000);
    expect(pricesByDate.get('2026-08-07')).toBe(1_099_000);
    expect(pricesByDate.get('2026-08-08')).toBe(1_099_000);
    expect(pricesByDate.get('2026-08-16')).toBe(1_099_000);
    expect(pricesByDate.get('2026-08-20')).toBe(1_099_000);
    expect(pricesByDate.get('2026-08-15')).toBe(1_199_000);
    expect(pricesByDate.get('2026-09-21')).toBe(1_049_000);
    expect(result.rows.filter(row => row.date === '2026-08-07')).toHaveLength(1);
    expect(result.rows.filter(row => row.date === '2026-09-21')).toHaveLength(1);
  });

  it('lets an explicitly labeled special-date price override a general period price', () => {
    const rawText = [
      '8/1~8/31 1,039,000\uC6D0',
      '\uD2B9\uC1A1\uC77C\uC790',
      '8/14, 15',
      '1,149,000\uC6D0',
    ].join('\n');

    const result = extractPriceIR(rawText, { year: 2026 });
    const august14 = result.rows.filter(row => row.date === '2026-08-14');
    const august13 = result.rows.filter(row => row.date === '2026-08-13');

    expect(august13).toEqual([expect.objectContaining({ adult_price: 1_039_000 })]);
    expect(august14).toEqual([expect.objectContaining({
      adult_price: 1_149_000,
      note: 'pdf_exact_date_override_price',
    })]);
  });

  it('removes exact and same-month range dates listed under the departure exclusion heading', () => {
    const rawText = [
      '\uC778\uCC9C \uCD9C\uBC1C \uC7A5\uAC00\uACC4 \uD328\uD0A4\uC9C0 \uC0C1\uD488 \uCD9C\uBC1C\uC77C \uAC00\uACA9\uD45C',
      '9/1~9/30 1,429,000\uC6D0',
      '\uC81C\uC678\uC77C\uC790: 9/3~4, 23, 24',
    ].join('\n');

    const result = extractPriceIR(rawText, { year: 2026 });
    const dates = new Set(result.rows.map(row => row.date));

    expect(dates.has('2026-09-02')).toBe(true);
    expect(dates.has('2026-09-03')).toBe(false);
    expect(dates.has('2026-09-04')).toBe(false);
    expect(dates.has('2026-09-23')).toBe(false);
    expect(dates.has('2026-09-24')).toBe(false);
  });
});

describe('extractPriceIR cruise cabin price tables', () => {
  it('recovers one departure date with cabin grade prices', () => {
    const rawText = `
인천 출발 일본/중국 크루즈 12일
2026년 6월 01일(월) ~ 6월 12일(금)
요 금
등 급
1인 요금
만18세 이상 만 4세~17세 6개월~4세 미만
인사이드 2,890,000 1,990,000 1.450,000 350,000
오션뷰 3,480,000 1,990,000 1.450,000 350,000
발코니 4,180,000 1,990,000 1.450,000 350,000
`;

    const result = extractPriceIR(rawText, { year: 2026 });

    expect(result.source).toBe('cruise_cabin_price_table');
    expect(result.rows).toHaveLength(3);
    expect(result.rows.map(row => [row.date, row.option_label, row.adult_price])).toEqual([
      ['2026-06-01', '인사이드', 2_890_000],
      ['2026-06-01', '오션뷰', 3_480_000],
      ['2026-06-01', '발코니', 4_180_000],
    ]);
  });
});

describe('extractPriceIR Korean vertical supplier price tables', () => {
  it('binds an exact 여행일 row to the following single 상품가 row', () => {
    const rawText = `
[청주공항-청도 3일]
여행일
3월 23일, 24일
2026년
6명 이상 출발
[특가] 299,000원/인
상품가
(현금결재)
포함 내역
왕복항공료`;

    const result = extractPriceIR(rawText, { year: 2026, durationDays: 3 });

    expect(result.source).toBe('product_price_vertical_date_table');
    expect(result.rows).toEqual([
      expect.objectContaining({ date: '2026-03-23', adult_price: 299000 }),
      expect.objectContaining({ date: '2026-03-24', adult_price: 299000 }),
    ]);
  });

  it('recovers departure-date blocks followed by multiple package prices', () => {
    const rawText = `
부산출발 장가계 3박4일 실속특가 PKG
출발날짜
6월8일 월요일,
6월27일 토요일
7월11일 토요일,
8월8일 토요일
출발인원
성인 6명 이상
상 품 가
499,000/인
599,000/인
포   함
왕복항공료`;

    const result = extractPriceIR(rawText, { year: 2026, durationDays: 4 });

    expect(result.source).toBe('product_price_vertical_date_table');
    expect(result.rows).toEqual([
      expect.objectContaining({ date: '2026-06-08', adult_price: 499000 }),
      expect.objectContaining({ date: '2026-06-27', adult_price: 499000 }),
      expect.objectContaining({ date: '2026-07-11', adult_price: 599000 }),
      expect.objectContaining({ date: '2026-08-08', adult_price: 599000 }),
    ]);
  });

  it('recovers month/day duration rows and filters by product duration', () => {
    const rawText = `
출 발 일
칠채산+황하석림+바단지린사막
7월
(수) 1, 8
3박5일
1,099,000
(토) 4, 18
4박6일
1,129,000
8월
(수) 5
3박5일
1,119,000
(토) 1
4박6일
1,139,000부산-서안 칠채산 3박5일 PKG`;

    const result = extractPriceIR(rawText, { year: 2026, durationDays: 5 });

    expect(result.source).toBe('month_duration_price_table');
    expect(result.rows).toEqual([
      expect.objectContaining({ date: '2026-07-01', adult_price: 1099000 }),
      expect.objectContaining({ date: '2026-07-08', adult_price: 1099000 }),
      expect.objectContaining({ date: '2026-08-05', adult_price: 1119000 }),
    ]);
    expect(result.rows.some(row => row.date === '2026-07-04')).toBe(false);
    expect(result.rows.some(row => row.adult_price === 1139000)).toBe(false);
  });

  it('recovers same-line Korean departure dates with selling price', () => {
    const rawText = `
서안(병마용.화청지), 화산 3박5일 [수出]
2026년 04월~10월 (수요일)
7월 1,8,15,22 (수)출발 판매가 ₩899,000/인 (7/1까지발권)
기타개인비용, 유류할증료 변동 분, 싱글차지($90/전일정)
제1일
BX341 21:55 01:25
`;

    const result = extractPriceIR(rawText, { year: 2026, durationDays: 5 });

    expect(result.source).toBe('product_price_vertical_date_table');
    expect(result.rows).toEqual([
      expect.objectContaining({ date: '2026-07-01', adult_price: 899000 }),
      expect.objectContaining({ date: '2026-07-08', adult_price: 899000 }),
      expect.objectContaining({ date: '2026-07-15', adult_price: 899000 }),
      expect.objectContaining({ date: '2026-07-22', adult_price: 899000 }),
    ]);
  });

  it('filters shared duration-section supplier price tables by product duration', () => {
    const rawText = [
      '신선이 된 것 같은 곳,',
      '구름 위의 절경',
      '张家界장가계',
      '월토일 3박4일 / 화수목 4박5일',
      '출발일',
      '판매가',
      '3박4일',
      '8월',
      '30일',
      '829,000',
      '31일',
      '799,000',
      '9월',
      '19, 20, 21',
      '899,000',
      '4박5일',
      '9월',
      '1일',
      '799,000',
      '월드체인 풀만 호텔 장가계 특가',
      '장가계 4박 5일',
    ].join('\n');

    const result = extractPriceIR(rawText, {
      year: 2026,
      durationDays: 5,
      title: '장가계 4박 5일',
    });

    expect(result.source).toBe('product_price_vertical_date_table');
    expect(result.rows).toEqual([
      expect.objectContaining({
        date: '2026-09-01',
        adult_price: 799000,
        note: 'source_korean_duration_section_price',
      }),
    ]);
    expect(result.rows.some(row => row.date === '2026-08-30' || row.date === '2026-09-19')).toBe(false);
  });

  it('binds an HWP amount-before-date table to the matching duration only', () => {
    const rawText = [
      '날 짜',
      '3N5D',
      '금 액',
      '499,000',
      '9월 9일',
      '599,000',
      '9월 16일',
      '799,000',
      '9월 23일 추석연휴',
      '날 짜',
      '4N6D',
      '금 액',
      '599,000',
      '9월 5일',
      '699,000',
      '9월 12, 19, 26일',
      '불포함 내역',
      '싱글비용($55 / 9월 30일 출발시 $125)',
    ].join('\n');

    const result = extractPriceIR(rawText, { year: 2026, durationDays: 5 });

    expect(result.source).toBe('product_price_vertical_date_table');
    expect(result.rows.map(row => [row.date, row.adult_price])).toEqual([
      ['2026-09-09', 499000],
      ['2026-09-16', 599000],
      ['2026-09-23', 799000],
    ]);
    expect(result.rows.some(row => row.date === '2026-09-30' || row.adult_price === 125000)).toBe(false);
  });

  it('binds grouped Korean dates to the following amount and leaves inquiry dates unpriced', () => {
    const rawText = [
      '수요일【3박5일】',
      '광저우,천저우 5일',
      '9월 2일',
      '1,179,000',
      '9월 9일',
      '9월 16일',
      '1,199,000',
      '9월 23일',
      '[추석 연휴]',
      '1,449,000',
      '9월 30일',
      '별도문의',
      '10월 7일',
      '[한글날 연휴]',
      '1,399,000',
      '---',
      '불포함 내역',
      '싱글비용 $80',
    ].join('\n');

    const result = extractPriceIR(rawText, { year: 2026, durationDays: 5 });

    expect(result.source).toBe('product_price_vertical_date_table');
    expect(result.rows.map(row => [row.date, row.adult_price])).toEqual([
      ['2026-09-02', 1179000],
      ['2026-09-09', 1199000],
      ['2026-09-16', 1199000],
      ['2026-09-23', 1449000],
      ['2026-10-07', 1399000],
    ]);
    expect(result.rows.some(row => row.date === '2026-09-30')).toBe(false);
  });

  it('binds a scalar price to a departure roster when the price label follows it', () => {
    const result = extractPriceIR(`출 발 일 자
2026년 9월 23일, 24일 예정
▶ \\1,499,000
예상판매가격
날 짜
제1일`, { year: 2026 });
    expect(result.rows).toEqual([
      expect.objectContaining({ date: '2026-09-23', adult_price: 1_499_000 }),
      expect.objectContaining({ date: '2026-09-24', adult_price: 1_499_000 }),
    ]);
  });
});

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
프리미엄노노노
연길/백두산(북+서파) 3박4일
`;

const XIAN_MONTH_DURATION_PRICE_TABLE = `
5. 부산출발 :양방향_화살표: 서안 칠채산 PKG
(황하석림/바단지린사막)
항공 스케줄
부산-서안 BX341 22:00/00:35+1
서안-부산 BX342 02:10/06:30
주 2회 운항 -- 수 3박5일 / 토 4박6일

출 발 일
칠채산+황하석림+바단지린사막
7월
(수) 1, 8
3박5일
1,099,000
(수) 15, 22
3박5일
1,099,000
(토) 4, 18
4박6일
1,129,000
8월
(수) 5
3박5일
1,119,000
(토) 1
4박6일
1,139,000
9월
(수) 16
3박5일
999,000
(토) 19
4박6일
1,039,000
10월
(수) 7
3박5일
1,429,000
(토) 17
4박6일
1,299,000부산-서안 칠채산(황하석림/바단지린사막) 3박5일 PKG
출발날짜
2026년 수요일출발
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

  it('recovers month + weekday + duration + price vertical tables and filters by product duration', () => {
    const threeNight = extractPriceIR(XIAN_MONTH_DURATION_PRICE_TABLE, {
      year: 2026,
      title: '부산-서안 칠채산(황하석림/바단지린사막) 3박5일 PKG',
      durationDays: 5,
    });
    const fourNight = extractPriceIR(XIAN_MONTH_DURATION_PRICE_TABLE, {
      year: 2026,
      title: '부산-서안 칠채산(황하석림/바단지린사막) 4박6일 PKG',
      durationDays: 6,
    });

    expect(threeNight.source).toBe('month_duration_price_table');
    expect(threeNight.rows.map(row => row.date)).toEqual([
      '2026-07-01',
      '2026-07-08',
      '2026-07-15',
      '2026-07-22',
      '2026-08-05',
      '2026-09-16',
      '2026-10-07',
    ]);
    expect(threeNight.rows.find(row => row.date === '2026-09-16')?.adult_price).toBe(999000);
    expect(threeNight.rows.find(row => row.date === '2026-07-04')).toBeUndefined();

    expect(fourNight.source).toBe('month_duration_price_table');
    expect(fourNight.rows.map(row => row.date)).toEqual([
      '2026-07-04',
      '2026-07-18',
      '2026-08-01',
      '2026-09-19',
      '2026-10-17',
    ]);
    expect(fourNight.rows.find(row => row.date === '2026-10-17')?.adult_price).toBe(1299000);
    expect(fourNight.rows.find(row => row.date === '2026-07-01')).toBeUndefined();
  });
});

describe('extractPriceIR Baekdu grade pattern date matrix', () => {
  it('recovers the selected product grade and 3-night pattern from the shared matrix', () => {
    const result = extractPriceIR(BAEKDU_GRADE_PATTERN_MATRIX, {
      year: 2026,
      title: '연길/백두산(북+서파) 3박4일',
      durationDays: 4,
    });

    expect(result.source).toBe('grade_pattern_date_matrix');
    expect(result.rows.find(row => row.date === '2026-07-02')?.adult_price).toBe(1299000);
    expect(result.rows.find(row => row.date === '2026-07-16')?.adult_price).toBe(1529000);
    expect(result.rows.find(row => row.date === '2026-07-30')?.adult_price).toBe(1299000);
    expect(result.rows.find(row => row.date === '2026-08-13')?.adult_price).toBe(1429000);
    expect(result.rows.find(row => row.date === '2026-07-05')).toBeUndefined();
    expect(result.rows.length).toBeGreaterThanOrEqual(7);
    expect(result.tiers.length).toBeGreaterThan(0);
  });

  it('keeps 4-night crown prices separate from the 3-night Thursday rows', () => {
    const result = extractPriceIR(`${BAEKDU_GRADE_PATTERN_MATRIX}
---
크라운노노노
연길/백두산(남+서+북파) 4박5일
`, {
      year: 2026,
      title: '연길/백두산(남+서+북파) 4박5일',
      durationDays: 5,
    });

    expect(result.source).toBe('grade_pattern_date_matrix');
    expect(result.rows.find(row => row.date === '2026-07-05')?.adult_price).toBe(1429000);
    expect(result.rows.find(row => row.date === '2026-07-12')?.adult_price).toBe(1429000);
    expect(result.rows.find(row => row.date === '2026-08-16')?.adult_price).toBe(1429000);
    expect(result.rows.find(row => row.date === '2026-07-02')).toBeUndefined();
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

describe('extractPriceIR product price vertical date table', () => {
  it('recovers Korean HWP departure lines followed by a per-person price', () => {
    const rawText = [
      '증편특가',
      '연길/백두산(북+서파) 3박4일',
      '7월 9, 23일 [목요일] 출발',
      '629,000원/인',
      '포 함 내 역',
      '왕복 항공료 및 텍스',
      '선택관광',
      '노옵션',
    ].join('\n');

    const result = extractPriceIR(rawText, { year: 2026, durationDays: 4 });

    expect(result.source).toBe('product_price_vertical_date_table');
    expect(result.rows).toEqual([
      expect.objectContaining({ date: '2026-07-09', adult_price: 629000 }),
      expect.objectContaining({ date: '2026-07-23', adult_price: 629000 }),
    ]);
    expect(result.rows.some(row => row.adult_price === 40000)).toBe(false);
  });

  it('recovers Korean HWP grade date tables and selects the matching product grade', () => {
    const rawText = [
      '일요일【3박4일】',
      '호화호특,시나무런초원',
      '실속',
      '품격',
      '7월 26일',
      '599,000',
      '1,199,000',
      '8월 23일',
      '549,000',
      '999,000',
      '수요일【4박5일】',
      '실속',
      '품격',
      '8월 26일',
      '629,000',
      '1,149,000',
      'BX3455 PUS 08:30 → HET 10:55',
    ].join('\n');

    const result = extractPriceIR(rawText, {
      year: 2026,
      title: '품격 내몽고 호화호특 3박 4일',
      durationDays: 4,
    });

    expect(result.source).toBe('product_price_vertical_date_table');
    expect(result.rows.map(row => [row.date, row.adult_price])).toEqual([
      ['2026-07-26', 1199000],
      ['2026-08-23', 999000],
    ]);
    expect(result.rows.find(row => row.date === '2026-08-26')).toBeUndefined();
  });

  it('recovers Korean HWP hotel month/day matrices with sale-arrow prices', () => {
    const rawText = [
      '★부산-보홀 헤난리조트 삼총사 세미패키지 여름휴가특가 [7C]★',
      '날짜',
      '헤난 타왈라',
      '헤난 알로나비치',
      '헤난 프리미어코스트',
      '7월',
      '19,20,21',
      '3박',
      '839,000 → 599,000',
      '879,000 → 659,000',
      '23,24',
      '779,000',
      '799,000',
      '실시간 기준으로 예약 진행 시 좌석 및 호텔 리체크 필수',
      'PKG',
    ].join('\n');

    const result = extractPriceIR(rawText, { year: 2026, durationDays: 5 });

    expect(result.source).toBe('product_price_vertical_date_table');
    expect(result.rows).toContainEqual(expect.objectContaining({
      date: '2026-07-19',
      adult_price: 599000,
      option_label: '헤난 타왈라',
    }));
    expect(result.rows).toContainEqual(expect.objectContaining({
      date: '2026-07-24',
      adult_price: 799000,
      option_label: '헤난 알로나비치',
    }));
    expect(result.rows.some(row => row.adult_price === 839000)).toBe(false);
  });

  it('recovers 상품가 date lists followed by full KRW prices', () => {
    const rawText = `
[크라운] 큐슈 BX조석 스기노이 2박 3일
상품가
7/1, 6, 8, 13, 15
1,299,000원
7/20, 22, 27, 29
1,399,000원
8/3, 5
1,499,000원
포함 내역
왕복항공권
`;

    const result = extractPriceIR(rawText, { year: 2026, durationDays: 3 });

    expect(result.source).toBe('product_price_vertical_date_table');
    expect(result.rows).toHaveLength(11);
    expect(result.rows.find(row => row.date === '2026-07-01')?.adult_price).toBe(1299000);
    expect(result.rows.find(row => row.date === '2026-07-29')?.adult_price).toBe(1399000);
    expect(result.rows.find(row => row.date === '2026-08-05')?.adult_price).toBe(1499000);
    expect(result.rows.some(row => row.date === '1,299,000원')).toBe(false);
    expect(result.tiers.length).toBe(3);
  });

  it('recovers Shizuoka departure price tables with ticketing notes and month headings', () => {
    const rawText = `
[시즈오카] 후지산 핵심일주
출발일 &상품가

월, 수
출발
▶5/26까지 발권조건
6월
6/1, 8, 15, 22, 29
529,000원
6/29
499,000원
6/3, 10, 17, 24
629,000원
7월
7/1, 8, 15, 22, 29
729,000원
7/6, 13, 20, 27
629,000원
8월
8/10
859,000원
8/3, 17, 24, 31
799,000원
8/5, 12, 19, 26
899,000원
포 함 사 항
왕복항공권
`;

    const result = extractPriceIR(rawText, { year: 2026, durationDays: 3 });

    expect(result.source).toBe('product_price_vertical_date_table');
    expect(result.rows.find(row => row.date === '2026-06-29')?.adult_price).toBe(499000);
    expect(result.rows.find(row => row.date === '2026-07-06')?.adult_price).toBe(629000);
    expect(result.rows.find(row => row.date === '2026-08-26')?.adult_price).toBe(899000);
    expect(result.rows.some(row => row.date.startsWith('2024-'))).toBe(false);
  });

  it('treats January departures uploaded in December as next year when no explicit year exists', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-12-10T09:00:00+09:00'));
    const rawText = `
출발일 &상품가
1월
1/5, 12, 19
899,000원
포함 사항
왕복항공권
`;

    const result = extractPriceIR(rawText, { durationDays: 3 });

    expect(result.source).toBe('product_price_vertical_date_table');
    expect(result.rows.map(row => row.date)).toEqual([
      '2027-01-05',
      '2027-01-12',
      '2027-01-19',
    ]);
  });

  it('selects the matching grade column for vertical date rows with multiple package prices', () => {
    const rawText = [
      '상품가',
      '9/30',
      '799,000',
      '1,269,000',
      '1,429,000',
      '10/7',
      '799,000',
      '1,269,000',
      '1,429,000',
    ].join('\n');

    const economy = extractPriceIR(rawText, { year: 2026, title: '부산-계림 3박5일 실속PKG' });
    const premium = extractPriceIR(rawText, { year: 2026, title: '부산-계림 3박5일 품격PKG' });
    const deluxe = extractPriceIR(rawText, { year: 2026, title: '부산-계림 3박5일 고품격PKG' });

    expect(economy.rows.find(row => row.date === '2026-09-30')?.adult_price).toBe(799000);
    expect(premium.rows.find(row => row.date === '2026-09-30')?.adult_price).toBe(1269000);
    expect(deluxe.rows.find(row => row.date === '2026-09-30')?.adult_price).toBe(1429000);
  });

  it('does not attach unlabeled grade columns when the product grade axis is unknown', () => {
    const rawText = [
      '상품가',
      '9월 30일',
      '799,000',
      '1,269,000',
      '1,429,000',
    ].join('\n');

    expect(extractPriceIR(rawText, { year: 2026, title: '부산-계림 3박5일' }).rows).toEqual([]);
  });
});

const TAIPEI_COMPACT_GRADE_PERIOD_TABLE = `
BX타이페이/ 3색 패키지

선발특가 3/27일까지 3.3 배포 4/1~4/30
목
실속패키지
베이토우♨+미식
노팁노옵션

849,-
989,-
1,059,-

금
809,-
939,-
1,019,-

화,수,토
769,-
899,-
969,-

일,월
719,-
849,-
929,-

5/1~6/30
9/1~9/25
목
789,-
919,-
989,-

금
749,-
879,-
949,-

화,수,토
699,-
829,-
899,-

일,월
659,-
789,-
859,-

7/1~8/7
목
829,-
959,-
1,039,-

금
789,-
919,-
989,-

화,수,토
749,-
879,-
949,-

일,월
699,-
829,-
899,-

8/8~8/31
목
809,-
939,-
1,019,-

금
769,-
899,-
969,-

화,수,토
719,-
849,-
929,-

일,월
679,-
809,-
879,-

⚫제외일 4/30, 5/1~3,22~24, 6/3, 7/16,17, 8/14,15, 9/22~25 10/2,3,4,7,8,9

PKG
BX타이페이/예스지+단수이 실속 3박4일
`;

describe('extractPriceIR compact grade period table', () => {
  it('selects the matching product grade column instead of treating it as a hotel matrix', () => {
    const economy = extractPriceIR(TAIPEI_COMPACT_GRADE_PERIOD_TABLE, {
      year: 2026,
      title: 'BX타이페이/예스지+단수이 실속 3박4일',
      durationDays: 4,
    });
    const beitou = extractPriceIR(TAIPEI_COMPACT_GRADE_PERIOD_TABLE, {
      year: 2026,
      title: 'BX타이페이/야류+베이토우♨ +미식투어 3박4일',
      durationDays: 4,
    });
    const noTipNoOption = extractPriceIR(TAIPEI_COMPACT_GRADE_PERIOD_TABLE, {
      year: 2026,
      title: 'BX타이페이/예스지+단수이 노팁/노옵션 3박4일',
      durationDays: 4,
    });

    expect(economy.source).toBe('compact_grade_period_table');
    expect(economy.rows.find(row => row.date === '2026-07-02')?.adult_price).toBe(829000);
    expect(beitou.rows.find(row => row.date === '2026-07-02')?.adult_price).toBe(959000);
    expect(noTipNoOption.rows.find(row => row.date === '2026-07-02')?.adult_price).toBe(1039000);
    expect(economy.rows.find(row => row.date === '2026-07-16')).toBeUndefined();
    expect(economy.rows.find(row => row.date === '2026-05-22')).toBeUndefined();
    expect(economy.rows.some(row => row.adult_price < 100000)).toBe(false);
  });
});

describe('extractPriceIR single travel-period product price', () => {
  it('recovers a source-backed package price from travel period plus product price labels', () => {
    const rawText = `
품격
♡TW항공 부산출발♡ 나트랑/달랏 3박5일
여행기간 2026년 5월 4일 ~ 5월 8일 까지 ★노팁+노옵션★
상품가 ₩399,000원/인 (*성인/아동 동일)
포함 사항
왕복 항공료, TAX, 유류할증료(2월기준), 호텔(2인1실), 식사
불포함 사항
유류할증료 변동분, 매너팁, 싱글룸 사용 시 1인 전일정 15만원 추가됩니다.
날짜|지역|교통편|시간|여행 일정|식사
제1일|부산|TW 041|21:10|부산 김해 국제공항 출발|기내식 불포함
|나트랑|전용차량|00:10+1|나트랑 깜란 국제공항 도착 후 입국 수속 및 가이드 미팅
`;

    const result = extractPriceIR(rawText, { year: 2026, durationDays: 5 });

    expect(result.source).toBe('single_period_product_price');
    expect(result.rows).toEqual([
      expect.objectContaining({
        date: '2026-05-04',
        adult_price: 399000,
        child_price: null,
        status: 'available',
      }),
    ]);
    expect(result.rows.some(row => row.adult_price === 150000)).toBe(false);
  });
});

describe('extractPriceIR explicit year handling', () => {
  it('does not roll past-month supplier periods into the next year when year is provided', () => {
    const rawText = `
ZE 푸꾸옥 2색골프
정규요금 2.12배포
1,359,-
일,월,화
1,459,-
수,목
3/1~3/31
1,419,-
금
1,379,-
토
출발확정
1,319,-
수,목
3/29~4/30
1,489,-
토
(4박)
1,459,-
일
(4박)

PKG ZE 푸꾸옥 2색골프 에스츄리+빈펄 3박5일
2026.2.1
매일출발 판 매 가 요금표참조
출 발 일
(성인/아동 동일)
`;

    const result = extractPriceIR(rawText, {
      year: 2026,
      title: 'PKG ZE 푸꾸옥 2색골프 에스츄리+빈펄 3박5일',
      durationDays: 5,
    });

    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows.some(row => row.date.startsWith('2027-'))).toBe(false);
    expect(result.rows.some(row => row.date.startsWith('2026-03-'))).toBe(true);
  });
});

describe('extractPriceIR labeled departure date list price', () => {
  it('keeps flattened HWP price blocks attached to their own date roster', () => {
    const rawText = [
      '[KE] 다낭/호이안 3박4일 노팁노옵션',
      '499,000원',
      '9/13, 14, 15, 16, 17',
      '기    간',
      '*8월 발권 조건',
      '/',
      '상 품 가',
      '579,000원',
      '9/21, 22',
      '전일정 5성 (2인1실 기준)',
      '날 짜',
      '제1일 부산 → 다낭',
    ].join('\n');

    const result = extractPriceIR(rawText, { year: 2026, durationDays: 4 });
    const pricesByDate = new Map(result.rows.map(row => [row.date, row.adult_price]));

    expect(result.source).toBe('labeled_date_list_price');
    expect(pricesByDate).toEqual(new Map([
      ['2026-09-13', 499000],
      ['2026-09-14', 499000],
      ['2026-09-15', 499000],
      ['2026-09-16', 499000],
      ['2026-09-17', 499000],
      ['2026-09-21', 579000],
      ['2026-09-22', 579000],
    ]));
    expect(pricesByDate.has('2026-09-18')).toBe(false);
  });

  it('keeps native-rhwp date-before-price cell order attached to each roster', () => {
    const rawText = [
      '[KE] 다낭/호이안 3박4일 노팁노옵션',
      '기    간',
      '/',
      '상 품 가',
      '9/13, 14, 15, 16, 17',
      '499,000원',
      '*8월 발권 조건',
      '9/21, 22',
      '579,000원',
      '룸 타 입',
      '전일정 5성 (2인1실 기준)',
      '날 짜',
      '제1일 부산 → 다낭',
    ].join('\n');

    const result = extractPriceIR(rawText, { year: 2026, durationDays: 4 });
    const pricesByDate = new Map(result.rows.map(row => [row.date, row.adult_price]));

    expect(result.source).toBe('labeled_date_list_price');
    expect(pricesByDate.get('2026-09-13')).toBe(499000);
    expect(pricesByDate.get('2026-09-17')).toBe(499000);
    expect(pricesByDate.get('2026-09-21')).toBe(579000);
    expect(pricesByDate.get('2026-09-22')).toBe(579000);
  });

  it('recovers source-backed prices from 출발일 list plus 요금표 adult child line', () => {
    const rawText = `
투어코코넛 나트랑/달랏 5성 3박5일 상품 안내
상품명: [RAW-E2E3P] 나트랑/달랏 5성 3박5일
출발공항 부산 / 항공 LJ 진에어
출발일: 2027-02-04, 2027-02-11
최소출발 6명 이상
발권마감 출발 7일 전

요금표
성인 889,000원 / 아동 889,000원

불포함사항
가이드/기사 경비, 개인경비 및 매너팁
`;

    const result = extractPriceIR(rawText, { year: 2027 });

    expect(result.source).toBe('labeled_date_list_price');
    expect(result.rows).toEqual([
      expect.objectContaining({
        date: '2027-02-04',
        adult_price: 889000,
        child_price: 889000,
      }),
      expect.objectContaining({
        date: '2027-02-11',
        adult_price: 889000,
        child_price: 889000,
      }),
    ]);
    expect(result.rows.some(row => row.adult_price === 7)).toBe(false);
  });

  it('binds arrow-formatted date and sale-price rows in one flattened cell', () => {
    const rawText = [
      '방콕 파타야 LIGHT 3박5일',
      '행사일자',
      '7/19, 23, 30 단 3날짜 선착순',
      '상품가',
      '7/19 → 499,900원',
      '7/23 → 629,900원',
      '7/30 → 699,900원',
      '일자',
      '제1일 부산 방콕',
    ].join('\n');

    const result = extractPriceIR(rawText, { year: 2026, durationDays: 5 });
    expect(result.source).toBe('labeled_date_list_price');
    expect(result.rows.map(row => [row.date, row.adult_price])).toEqual([
      ['2026-07-19', 499900],
      ['2026-07-23', 629900],
      ['2026-07-30', 699900],
    ]);
  });
});
