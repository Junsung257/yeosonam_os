import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractPriceIR } from './index';

afterEach(() => {
  vi.useRealTimers();
});

describe('extractPriceIR Korean vertical supplier price tables', () => {
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

describe('extractPriceIR labeled departure date list price', () => {
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
});
