export const CLARK_MULTIPRODUCT_RAW = `
클락 알뜰 3색 골프+단독행사
풀빌라 더비스타 2색 골프

선발권 6/29까지, 6.4배포

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

PKG
클락 알뜰 3색골프 + 단독차량 3박5일
2026.4.1
출 발 일
6/1~10/24 (수,목)
판 매 가
요금표 참조
불포함사항
개인경비, 주말골프 추가금 18홀/15,000원/인
일 자
제1일
HOTEL: 클로버호텔 또는 동급 (준4성급)
제2일
HOTEL: 클로버호텔 또는 동급 (준4성급)
제3일
HOTEL: 클로버호텔 또는 동급 (준4성급)
제4일
라운딩 후 클락 공항으로 이동
제5일
부산 도착

PKG
클락 알뜰 3색골프 + 단독차량 4박6일
2026.4.1
출 발 일
6/1~10/24 (토,일)
판 매 가
요금표 참조
불포함사항
개인경비, 주말골프 추가금 18홀/15,000원/인
일 자
제1일
HOTEL: 클로버호텔 또는 동급 (준4성급)
제2일
HOTEL: 클로버호텔 또는 동급 (준4성급)
제3일
HOTEL: 클로버호텔 또는 동급 (준4성급)
제4일
HOTEL: 클로버호텔 또는 동급 (준4성급)
제5일
라운딩 후 클락 공항으로 이동
제6일
부산 도착

PKG
클락 품격 풀빌라 더비스타 2색골프 + 단독차량 3박5일
2026.4.1
출 발 일
6/1~10/24 (수,목)
판 매 가
요금표 참조
불포함사항
개인경비, 주말골프추가금 18홀/10,000원/인, 전일정 주유비 (1일 약 2,000P~/팀당)
일 자
제1일
HOTEL: 신축 풀빌라 또는 동급 *1인1실
제2일
HOTEL: 신축 풀빌라 또는 동급 *1인1실
제3일
HOTEL: 신축 풀빌라 또는 동급 *1인1실
제4일
라운딩 후 클락 공항으로 이동
제5일
부산 도착

PKG
클락 품격 풀빌라 더비스타 2색골프 + 단독차량 4박6일
2026.4.1
출 발 일
6/1~10/24 (토,일)
판 매 가
요금표 참조
불포함사항
개인경비, 주말골프추가금 18홀/10,000원/인, 전일정 주유비 (1일 약 2,000P~/팀당)
일 자
제1일
HOTEL: 신축 풀빌라 또는 동급 *1인1실
제2일
HOTEL: 신축 풀빌라 또는 동급 *1인1실
제3일
HOTEL: 신축 풀빌라 또는 동급 *1인1실
제4일
HOTEL: 신축 풀빌라 또는 동급 *1인1실
제5일
라운딩 후 클락 공항으로 이동
제6일
부산 도착
`;

export type ClarkMultiproductExpected = {
  title: string;
  minPrice: number;
  count: number;
  departureDays: string;
  sampleDate: string;
  samplePrice: number;
  forbiddenDate: string;
  hotel: string;
  duration: number;
  forbiddenPrices: number[];
};

export const CLARK_MULTIPRODUCT_EXPECTED: ClarkMultiproductExpected[] = [
  {
    title: '클락 알뜰 3색골프 + 단독차량 3박5일',
    minPrice: 1139000,
    count: 32,
    departureDays: '수,목',
    sampleDate: '2026-07-02',
    samplePrice: 1139000,
    forbiddenDate: '2026-06-20',
    hotel: '클로버호텔 또는 동급 (준4성급)',
    duration: 5,
    forbiddenPrices: [15000],
  },
  {
    title: '클락 알뜰 3색골프 + 단독차량 4박6일',
    minPrice: 999000,
    count: 40,
    departureDays: '토,일',
    sampleDate: '2026-06-20',
    samplePrice: 999000,
    forbiddenDate: '2026-07-02',
    hotel: '클로버호텔 또는 동급 (준4성급)',
    duration: 6,
    forbiddenPrices: [15000],
  },
  {
    title: '클락 품격 풀빌라 더비스타 2색골프 + 단독차량 3박5일',
    minPrice: 1259000,
    count: 32,
    departureDays: '수,목',
    sampleDate: '2026-07-02',
    samplePrice: 1259000,
    forbiddenDate: '2026-06-20',
    hotel: '신축 풀빌라 또는 동급 *1인1실',
    duration: 5,
    forbiddenPrices: [10000, 2000],
  },
  {
    title: '클락 품격 풀빌라 더비스타 2색골프 + 단독차량 4박6일',
    minPrice: 1159000,
    count: 40,
    departureDays: '토,일',
    sampleDate: '2026-06-20',
    samplePrice: 1159000,
    forbiddenDate: '2026-07-02',
    hotel: '신축 풀빌라 또는 동급 *1인1실',
    duration: 6,
    forbiddenPrices: [10000, 2000],
  },
];
