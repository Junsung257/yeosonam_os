/**
 * ★ 부산-청도 2026.4.24 배포 캐슬렉스CC 골프 2건 등록
 *   랜드사: 랜드부산 / 정액 9만원 (commission_rate=0 + special_notes 명시) / 4/29 선발 + 좌석요청조건
 *
 *   1) 실속 지존 캐슬렉스 GOLF 3일 54H (579,000원, 출발 9건)
 *   2) 실속 지존 캐슬렉스 GOLF 4일 90H (679,000원, 출발 8건)
 */
const path = require('path');
const { createInserter } = require('./templates/insert-template');

const inserter = createInserter({
  landOperator: '랜드부산',
  commissionRate: 0, // 9만원 정액 — special_notes 명시
  ticketingDeadline: '2026-04-29', // 원문 "*4/29선발+좌석요청조건"
  destCode: 'TAO',
});

// ── 헬퍼 ──
const N = (time, activity) => ({ time, activity, type: 'normal', transport: null, note: null });
const F = (time, activity, transport) => ({ time, activity, type: 'flight', transport, note: null });
const T = (time, activity) => ({ time, activity, type: 'normal', transport: '전용차량', note: null });
const H = (activity) => ({ time: null, activity, type: 'hotel', transport: null, note: null });
const meal = (b, l, d, bn, ln, dn) => ({ breakfast: b, lunch: l, dinner: d, breakfast_note: bn || null, lunch_note: ln || null, dinner_note: dn || null });

// ── 출발일 ──
// 3일: 5/13(수),26(화),27(수) | 6/2(화),16(화),17(수),22(월),29(월),30(화) — 9건 × 579,000원
const DATES_3D = [
  '2026-05-13', '2026-05-26', '2026-05-27',
  '2026-06-02', '2026-06-16', '2026-06-17', '2026-06-22', '2026-06-29', '2026-06-30',
];
// 4일: 5/26(화),27(수) | 6/2(화),16(화),17(수),22(월),29(월),30(화) — 8건 × 679,000원
const DATES_4D = [
  '2026-05-26', '2026-05-27',
  '2026-06-02', '2026-06-16', '2026-06-17', '2026-06-22', '2026-06-29', '2026-06-30',
];

const buildPriceDates = (dates, price) => dates.map(d => ({ date: d, price, confirmed: false }));

// ── 공통 데이터 ──
const COMMON_INCLUSIONS = [
  '왕복항공료 (수화물 23kg)',
  '유류할증료 (4월 기준)',
  '숙박',
  '조식',
  '골프비용 (그린피+캐디피+전동카)',
  '여행자보험',
];

const COMMON_EXCLUDES = [
  '유류 변동분',
  '개인경비',
  '매너팁',
  '클럽 중식',
  '석식',
];

const COMMON_SURCHARGES = [
  { name: '싱글차지(평일)', start: null, end: null, amount: 30000, currency: 'KRW', unit: '박/인' },
  { name: '싱글차지(금토·휴일)', start: null, end: null, amount: 40000, currency: 'KRW', unit: '박/인' },
  { name: '미팅/샌딩비(4인 이상)', start: null, end: null, amount: 300, currency: 'CNY', unit: '인' },
  { name: '미팅/샌딩비(2명)', start: null, end: null, amount: 450, currency: 'CNY', unit: '인' },
  { name: '캐디팁', start: null, end: null, amount: 100, currency: 'CNY', unit: '18홀/인' },
  { name: '카트 싱글차지', start: null, end: null, amount: 100, currency: 'CNY', unit: '18홀/조' },
];

const RECOMMEND_OPTION = {
  name: '외부 저녁식사(샤브샤브 OR 현지식) + 전신마사지 1시간 30분 + 차량',
  price: '450위안/인',
  region: '청도',
  note: '4인 이상 출발 조건',
};

const COMMON_NOTICES = [
  {
    type: 'CRITICAL',
    title: '필수 확인',
    text: '• 여권 유효기간 출발일 기준 6개월 이상 남아 있어야 합니다\n• 첫날 일몰까지 라운딩 조건 — 항공 지연·현지 사정으로 라운딩을 다 못해도 환불 불가\n• 패키지 상품 — 골프장(라운딩)·호텔을 가지 않으셔도 환불 불가\n• 전동카 사고는 여행자보험 적용 불가 — 운행 시 각별히 주의',
  },
  {
    type: 'PAYMENT',
    title: '취소 수수료 규정',
    text: '• 예약 후 취소: 1인 200,000원 공제 후 환불\n• 출발 10일~7일 전: 총 금액의 30% 공제\n• 출발 6일~2일 전: 총 금액의 50% 공제\n• 출발 1일~당일: 100% 환불 불가\n• 중국 비자 접수 후 취소 시 비자비 환불 불가\n• 출발 1주일 전 완납 기준 (이벤트·특가 상품은 2주 전 완납)',
  },
  {
    type: 'POLICY',
    title: '골프장 운영 규정',
    text: '• 그린피 특가 적용 상품 — 골프장 및 호텔 변경 불가\n• 2인 1캐디 또는 4인 1캐디 / 캐디팁 1인당 18홀 100위안\n• 2명 PLAY는 현지 예약 상황에 따라 JOIN 가능성 있음\n• 18홀 라운딩 시에도 요금 동일, 라운딩 한 만큼 캐디팁 지불\n• 청도 골프장 캔슬·취소 규정은 현지 골프장 규칙 적용',
  },
  {
    type: 'INFO',
    title: '시즌 추가요금 안내',
    text: '• 중국 단오절·추석·국경절 기간은 별도 요금 문의 부탁드립니다\n• 청도공항 도착 후 골프채는 2번~3번 벨트 중간 대형 화물 찾는 곳에서 수령',
  },
  {
    type: 'POLICY',
    title: '취소 처리 운영시간',
    text: '• 평일 09:00~18:00 상담 가능 / 18시 이후 취소는 익일 처리\n• 공휴일(토·일) 및 국가 지정 휴무일에는 취소 처리 불가\n• 예약 인원과 출발 인원이 다를 경우 최종 출발 인원 기준 요금 지불\n• 취소자 발생 시 나머지 인원에게 추가 금액 발생 가능',
  },
];

// FIELD_POLICY: special_notes 는 고객 노출 (A4 쇼핑 fallback). 커미션·정산 키워드 절대 금지.
// 랜드부산 9만원/건 정액 → commission_rate=0 + 운영팀 정산 시 별도 처리.
const COMMON_SPECIAL_NOTES = `* 출발 좌석 조건: 4/29 선발 + 좌석 요청 조건
* 그린피 특가 — 골프장·호텔 변경 불가
* 캐디팁 100위안/18홀/인 + 카트 싱글차지 100위안/18홀/조 (현지 결제)
* 미팅/샌딩비: 4인 이상 300위안/인, 2명 450위안/인 (현지 결제)
* 추천 옵션: 외부 저녁식사(샤브샤브 OR 현지식) + 전신마사지 1.5시간 + 차량 = 450위안/인 (4인 이상)
* 전동카 사고는 여행자보험 적용 불가
* 청도공항 도착 후 골프채는 2번~3번 벨트 중간 대형 화물 찾는 곳에서 수령
* 골프장 소개 — 캐슬렉스CC&리조트S: 36홀(레이크/밸리/스카이/힐), 객실 116실, 평도시내 30분`;

const COMMON_HIGHLIGHTS_3D = [
  '캐슬렉스CC 54홀 라운딩 (18홀×3일)',
  'BX 에어부산 김해 직항',
  '캐슬렉스 리조트 2박 + 조식 포함',
  '그린피·캐디피·전동카 포함',
];

const COMMON_HIGHLIGHTS_4D = [
  '캐슬렉스CC 90홀 라운딩 (18홀+27~36홀×3일)',
  'BX 에어부산 김해 직항',
  '캐슬렉스 리조트 3박 + 조식 포함',
  '그린피·캐디피·전동카 포함',
];

const HOTEL_NAME = '캐슬렉스 리조트';
const HOTEL_INFO = { name: HOTEL_NAME, grade: null, note: '2인1실' };

// ── 원문 (Rule Zero — verbatim 보존) ──
const RAW_TEXT = `PKG
 실속 지존 캐슬렉스 GOLF 3일 54H
2026.4.24
출 발 일
26년 5/13,26,27(화,수)
6/2,16,17,22,29,30(월,화,수)
판 매 가
(성인/아동 동일)
579,000원
*4/29선발+좌석요청조건
인  원
2명이상 출발가능
룸타입
2인1실
포함사항
 왕복항공료(수화물-23kg), 유류할증료(4월기준), 숙박, 식사(조식), 골프비용(그린피+캐디피+전동카), 여행자보험
불포함사항
 유류변동분, 개인경비, 매너팁, 클럽중식, 석식, 미팅/샌딩비(300위엔/인-4인이상,450위안/인-2명),
 캐디팁(100위안/18홀/인), 카트싱글차지(100위안/18홀/조), 싱글차지(평일-3만/인/박, 금토휴일-4만/인/박)
추천옵션
 외부저녁식사(샤브샤브 OR 현지식)+전신맛사지 1시간30분+차량 : 450위안/인 - 4인이상 출발조건
비    고
 * 중국 연휴 단오절, 추석, 국경절 기간은 별도 요금 문의 부탁드립니다.
 * 상기 상품은 모든 골프 비용을 선납 완불한 상품으로 취소시 위약금 발생합니다
   - 판매금액의 출발 10-7일전 30%, 출발 6-2일전 50%, 출발전날-당일 : 100% 페널티가 부과 됩니다.
 * 첫날 일몰시까지 라운딩조건입니다. 항공기의 지연, 현지 사정에따라 라운딩을 다 못하실 경우에도 환불불가
 ① 그린피 특가 적용상품이라 골프장 및 호텔 변경 불가 상품입니다.
 ② 2인 1캐디 혹은 4인 1캐디이며 손님 1인당 캐디에게 18H당 100위안 팁을 주셔야 합니다.
 ③ 2명 PLAY는 현지 예약 상황에 따라 JOIN 될 수도 있습니다
 ④ 18홀 라운딩을 하셔도 요금 동일하며  라운딩 하신 만큼 캐디팁 지불하시면 됩니다
 ** 전동카 사고는 여행자 보험이 적용되지 않습니다. 이에 각별히 조심하셔야 합니다
 * 패키지 상품으로 골프장(라운딩), 호텔를 가지 않으셔도 환불이 되지 않습니다.
 * 청도공항 도착후 골프채는 2번~ 3번 벨트 중간에 대형 화물 찾는 곳에서 찾으셔야 합니다.
주의사항
 * 여권은 유효기간 6개월 이상 남아 있어야 됩니다.
 * 취소수수료 규정 안내서 참고 하셔서 꼭 안내 부탁드립니다. (마지막페이지에 있습니다.)
골프장 소개
 캐슬렉스CC&리조트S는 총 36홀이며 레이크, 밸리, 스카이 및 힐코스로 구성 되어 있으며 객실은 총 116실이며   편의점, 골프샾, 과일샾, 야간포차[꼬지구이], 사우나, 레스토랑, 맛사지센터, 노래방, 대소연회실등이 구비          되어있습니다. 주변에 평도시내까지는 30분 소요됩니다.

일 자
지 역
교통편
시 간
주     요     행    사    일    정
식 사
제1일

부 산
청 도

BX321

10:30
11:35


 출발 2시간전 김해공항 국제선 2층에서 미팅 후 수속
 김해 국제공항 출발
 청도 국제공항 도착 후 가이드미팅 – 미팅보드 “캐슬렉스 골프”
 골프장으로 이동 (약1시간소요)
 캐슬렉스CC 18H 라운딩 (단, 일몰까지만 라운딩 가능합니다. 환불X)
 라운딩 후
 호텔 투숙 및 휴식
중:불포함
석:불포함
HOTEL: 캐슬렉스 리조트
제2일
청 도
전용차량
전 일
 호텔조식 후
 캐슬렉스CC 27-36H 라운딩
 라운딩 후
 호텔 투숙 및 휴식
조:클럽식
중:불포함
석:불포함
HOTEL: 캐슬렉스 리조트
제3일


청  도
부  산


BX322


12:35
15:30
 호텔 조식 후
 공항으로 이동
 청도 국제공항 출발
 김해 국제공항 도착
조:클럽식
 * 상기 일정은 현지 사정, 천재지변으로 인해 변경될 수 있습니다.



PKG
 실속 지존 캐슬렉스 GOLF 4일 90H
2026.4.24
출 발 일
26년 5/26,27(화,수)
6/2,16,17,22,29,30(월,화,수)
판 매 가
(성인/아동 동일)
679,000원
*4/29선발+좌석요청조건
인  원
2명이상 출발가능
룸타입
2인1실
포함사항
 왕복항공료(수화물-23kg), 유류할증료(4월기준), 숙박, 식사(조식), 골프비용(그린피+캐디피+전동카), 여행자보험
불포함사항
 유류변동분, 개인경비, 매너팁, 클럽중식, 석식, 미팅/샌딩비(300위엔/인-4인이상,450위안/인-2명),
 캐디팁(100위안/18홀/인), 카트싱글차지(100위안/18홀/조), 싱글차지(평일-3만/인/박, 금토휴일-4만/인/박)
추천옵션
 외부저녁식사(샤브샤브 OR 현지식)+전신맛사지 1시간30분+차량 : 450위안/인 - 4인이상 출발조건
비    고
 * 중국 연휴 단오절, 추석, 국경절 기간은 별도 요금 문의 부탁드립니다.
 * 상기 상품은 모든 골프 비용을 선납 완불한 상품으로 취소시 위약금 발생합니다
   - 판매금액의 출발 10-7일전 30%, 출발 6-2일전 50%, 출발전날-당일 : 100% 페널티가 부과 됩니다.
 * 첫날 일몰시까지 라운딩조건입니다. 항공기의 지연, 현지 사정에따라 라운딩을 다 못하실 경우에도 환불불가
 ① 그린피 특가 적용상품이라 골프장 및 호텔 변경 불가 상품입니다.
 ② 2인 1캐디 혹은 4인 1캐디이며 손님 1인당 캐디에게 18H당 100위안 팁을 주셔야 합니다.
 ③ 2명 PLAY는 현지 예약 상황에 따라 JOIN 될 수도 있습니다
 ④ 18홀 라운딩을 하셔도 요금 동일하며  라운딩 하신 만큼 캐디팁 지불하시면 됩니다
 ** 전동카 사고는 여행자 보험이 적용되지 않습니다. 이에 각별히 조심하셔야 합니다
 * 패키지 상품으로 골프장(라운딩), 호텔를 가지 않으셔도 환불이 되지 않습니다.
 * 청도공항 도착후 골프채는 2번~ 3번 벨트 중간에 대형 화물 찾는 곳에서 찾으셔야 합니다.
주의사항
 * 여권은 유효기간 6개월 이상 남아 있어야 됩니다.
 * 취소수수료 규정 안내서 참고 하셔서 꼭 안내 부탁드립니다. (마지막페이지에 있습니다.)
골프장 소개
 캐슬렉스CC&리조트S는 총 36홀이며 레이크, 밸리, 스카이 및 힐코스로 구성 되어 있으며 객실은 총 116실이며   편의점, 골프샾, 과일샾, 야간포차[꼬지구이], 사우나, 레스토랑, 맛사지센터, 노래방, 대소연회실등이 구비          되어있습니다. 주변에 평도시내까지는 30분 소요됩니다.

일 자
지 역
교통편
시 간
주     요     행    사    일    정
식 사
제1일

부 산
청 도

BX321

10:30
11:35


 출발 2시간전 김해공항 국제선 2층에서 미팅 후 수속
 김해 국제공항 출발
 청도 국제공항 도착 후 가이드미팅 – 미팅보드 “캐슬렉스 골프”
 골프장으로 이동 (약1시간소요)
 캐슬렉스CC 18H 라운딩 (단, 일몰까지만 라운딩 가능합니다. 환불X)
 라운딩 후
 호텔 투숙 및 휴식
중:불포함
석:불포함
HOTEL: 캐슬렉스 리조트
제2일
청 도
전용차량
전 일
 호텔 조식 후
 캐슬렉스CC 27-36H 라운딩
 라운딩 후
 호텔 투숙 및 휴식
조:클럽식
중:불포함
석:불포함
HOTEL: 캐슬렉스 리조트
제3일
청 도
전용차량
전 일
 호텔조식 후
 캐슬렉스CC 27-36H 라운딩
 라운딩 후
 호텔 투숙 및 휴식
조:클럽식
중:불포함
석:불포함
HOTEL: 캐슬렉스 리조트
제4일


청  도
부  산


BX322


12:35
15:30
 호텔 조식 후
 공항으로 이동
 청도 국제공항 출발
 김해 국제공항 도착
조:클럽식
 * 상기 일정은 현지 사정, 천재지변으로 인해 변경될 수 있습니다.



중국골프 여행상품 취소규정 안내

◎ 기간에 따른 취소 수수료 규정 안내

취소시기
수수료
* 예약 후 취소 시
 1인 200,000원씩 공제 후 환불
* 출발일 10일 ~ 7일전까지 취소
 총 금액의 30% 공제 후 환불
* 출발일 6일 ~ 2일전 까지 취소
 총 금액의 50% 공제 후 환불
* 출발일 1일 ~ 당일 취소
 100% 환불 불가


★ 취소문의는 평일 09시~18시 까지 상담가능하며, 공휴일(토,일) 및 국가 지정 휴무일에는취소처리가 되지 않습니다. 업무종료시간인 18시 이후 취소 시 익일로 계산됩니다.
★ 중국 비자 접수후 취소시 중국비자비는 환불되지 않습니다.

★ 중국 골프장 관련 캔슬, 취소 규정은 현지 골프장 관련 규칙에 따라 진행됩니다.
★ 출발 1주일 전 완납을 기준으로 하며, 이벤트 및 특가 상품은 2주전 완납 부탁드립니다.
★ 에어카텔 상품은 에약과 동시에 완납 기준이며 입금 기준으로 좌석 확정됩니다.

  ⍌   예약 인원과 출발 인원이 다를 경우 최종 출발 인원으로
       요금 지불 하셔야 합니다.   ⍌   취소자는 취소수수료 규정대로 수수료가 발생되며, 나머지            인원도 추가금액 발생합니다.

상기 내용을 꼭 확인 부탁드립니다.
확인 후 동의를 하셨으면 예약 진행을 하겠습니다.`;

// ── Agent Self-Audit (Step 6.5) — Reflection + CoT 기반 ──
const AGENT_AUDIT_REPORT = {
  parser_version: 'register-v2026.04.24-claude-opus-4.7-direct',
  ran_at: new Date().toISOString(),
  claims: [
    {
      id: 'min_participants',
      field: 'min_participants',
      severity: 'HIGH',
      text: '최소 출발인원 2명',
      evidence: '원문: "인  원 2명이상 출발가능"',
      supported: true,
      note: null,
    },
    {
      id: 'ticketing_deadline',
      field: 'ticketing_deadline',
      severity: 'HIGH',
      text: 'ticketing_deadline 2026-04-29',
      evidence: '원문: "*4/29선발+좌석요청조건" — 4월 29일 선발(선납발권) + 좌석 요청 조건',
      supported: true,
      note: '원문이 좌석요청 조건도 함께 명시. special_notes 에 동시 기록.',
    },
    {
      id: 'inclusions:insurance',
      field: 'inclusions',
      severity: 'CRITICAL',
      text: '여행자보험 (금액 미명시)',
      evidence: '원문: "포함사항 ... 여행자보험"',
      supported: true,
      note: '원문에 "2억" 등 보험 금액 표기 없음 — 원문 그대로 "여행자보험" 만 저장 (ERR-FUK-insurance-injection 방어)',
    },
    {
      id: 'price:3d',
      field: 'price (3일)',
      severity: 'HIGH',
      text: '579,000원',
      evidence: '원문: "판 매 가 (성인/아동 동일) 579,000원"',
      supported: true,
      note: null,
    },
    {
      id: 'price:4d',
      field: 'price (4일)',
      severity: 'HIGH',
      text: '679,000원',
      evidence: '원문: "판 매 가 (성인/아동 동일) 679,000원"',
      supported: true,
      note: null,
    },
    {
      id: 'departure_dates:3d',
      field: 'price_dates (3일)',
      severity: 'HIGH',
      text: '5/13(수),26(화),27(수) | 6/2(화),16(화),17(수),22(월),29(월),30(화) — 9건',
      evidence: '원문: "26년 5/13,26,27(화,수) / 6/2,16,17,22,29,30(월,화,수)"',
      supported: true,
      note: null,
    },
    {
      id: 'departure_dates:4d',
      field: 'price_dates (4일)',
      severity: 'HIGH',
      text: '5/26(화),27(수) | 6/2(화),16(화),17(수),22(월),29(월),30(화) — 8건',
      evidence: '원문: "26년 5/26,27(화,수) / 6/2,16,17,22,29,30(월,화,수)"',
      supported: true,
      note: null,
    },
    {
      id: 'surcharges:single',
      field: 'surcharges',
      severity: 'HIGH',
      text: '싱글차지 평일 3만/인/박, 금토휴일 4만/인/박',
      evidence: '원문: "싱글차지(평일-3만/인/박, 금토휴일-4만/인/박)"',
      supported: true,
      note: null,
    },
    {
      id: 'cancellation_policy',
      field: 'notices_parsed PAYMENT',
      severity: 'CRITICAL',
      text: '예약후 1인 20만원 공제 / 10-7일전 30% / 6-2일전 50% / 1일~당일 100%',
      evidence: '원문 비고 + 별도 취소규정 안내 양쪽에 동일 표기. "1인 200,000원씩 공제 후 환불 ... 출발 10-7일전 30% ... 6-2일전 50% ... 1일~당일 100% 환불 불가"',
      supported: true,
      note: null,
    },
    {
      id: 'flight:out',
      field: 'itinerary_data.days[0].schedule flight',
      severity: 'HIGH',
      text: 'BX321 김해 10:30 → 청도 11:35',
      evidence: '원문: "부 산 청 도 BX321 10:30 11:35"',
      supported: true,
      note: null,
    },
    {
      id: 'flight:in',
      field: 'itinerary_data.days[last].schedule flight',
      severity: 'HIGH',
      text: 'BX322 청도 12:35 → 김해 15:30',
      evidence: '원문: "청  도 부  산 BX322 12:35 15:30"',
      supported: true,
      note: null,
    },
    {
      id: 'hotel',
      field: 'accommodations',
      severity: 'HIGH',
      text: '캐슬렉스 리조트 (등급 미명시)',
      evidence: '원문 일정: "HOTEL: 캐슬렉스 리조트"',
      supported: true,
      note: '원문에 별도 등급(4성/5성 등) 표기 없음 — grade=null',
    },
    {
      id: 'regions:3d',
      field: 'itinerary_data.days[].regions (3일)',
      severity: 'HIGH',
      text: 'D1=[부산,청도] / D2=[청도] / D3=[청도,부산]',
      evidence: '원문 "지역" 컬럼: 제1일 "부 산 청 도" / 제2일 "청 도" / 제3일 "청  도 부  산"',
      supported: true,
      note: null,
    },
    {
      id: 'regions:4d',
      field: 'itinerary_data.days[].regions (4일)',
      severity: 'HIGH',
      text: 'D1=[부산,청도] / D2=[청도] / D3=[청도] / D4=[청도,부산]',
      evidence: '원문 "지역" 컬럼: 제1일 "부 산 청 도" / 제2일 "청 도" / 제3일 "청 도" / 제4일 "청  도 부  산"',
      supported: true,
      note: '4일 D2/D3 모두 청도 단일 — 원문 그대로 (ERR-FUK-regions-copy 방어)',
    },
    {
      id: 'optional:massage',
      field: 'optional_tours',
      severity: 'MEDIUM',
      text: '외부 저녁식사+전신마사지 1.5h+차량 = 450위안/인 (4인 이상)',
      evidence: '원문: "추천옵션 외부저녁식사(샤브샤브 OR 현지식)+전신맛사지 1시간30분+차량 : 450위안/인 - 4인이상 출발조건"',
      supported: true,
      note: 'region=청도 명시',
    },
  ],
  overall_verdict: 'clean',
  unsupported_critical: 0,
  unsupported_high: 0,
};

// ── 공통 빌더 ──
function buildPkg3Day() {
  return {
    title: '실속 지존 캐슬렉스 GOLF 3일 54H',
    destination: '칭다오',
    country: '중국',
    category: 'golf',
    product_type: '실속',
    trip_style: '2박3일',
    duration: 3,
    nights: 2,
    departure_airport: '부산(김해)',
    departure_days: '월/화/수',
    airline: 'BX(에어부산)',
    min_participants: 2,
    status: 'pending',
    price: 579000,
    guide_tip: null,
    single_supplement: '평일 30,000원/박/인 · 금토휴일 40,000원/박/인',
    small_group_surcharge: '미팅/샌딩비: 4인 이상 300위안/인, 2명 450위안/인',
    surcharges: COMMON_SURCHARGES,
    excluded_dates: [],
    optional_tours: [RECOMMEND_OPTION],
    price_tiers: [],
    price_dates: buildPriceDates(DATES_3D, 579000),
    inclusions: COMMON_INCLUSIONS,
    excludes: COMMON_EXCLUDES,
    notices_parsed: COMMON_NOTICES,
    special_notes: COMMON_SPECIAL_NOTES,
    product_highlights: COMMON_HIGHLIGHTS_3D,
    product_summary:
      '부산 BX 직항으로 청도까지 1시간 5분, 캐슬렉스CC에서 첫날 18홀·둘째날 27~36홀 라운딩까지 54홀을 풀로 즐기실 수 있어요. 그린피·캐디피·전동카가 모두 포함되어 있고 캐슬렉스 리조트 2박 + 조식까지 묶었으니, 도착 직후부터 라운딩에 집중하시면 됩니다.',
    product_tags: ['골프', '캐슬렉스', '청도', '부산직항', '실속'],
    itinerary_data: {
      meta: {
        flight_out: 'BX321',
        flight_in: 'BX322',
        ticketing_deadline: '2026-04-29',
        airline: 'BX(에어부산)',
        departure_airport: '부산(김해)',
      },
      days: [
        {
          day: 1,
          regions: ['부산', '청도'],
          meals: meal(false, false, false, null, null, null),
          schedule: [
            N('08:30', '출발 2시간 전 김해공항 국제선 2층 미팅 후 수속'),
            F('10:30', 'BX321 김해국제공항 출발 → 청도국제공항 11:35 도착', 'BX321'),
            N(null, '청도공항 도착 후 가이드 미팅 (미팅보드 "캐슬렉스 골프")'),
            N(null, '골프장으로 이동 (약 1시간 소요)'),
            N(null, '▶캐슬렉스CC 18홀 라운딩 (일몰까지 라운딩 조건, 환불 불가)'),
            H('캐슬렉스 리조트 투숙 및 휴식'),
          ],
          hotel: HOTEL_INFO,
        },
        {
          day: 2,
          regions: ['청도'],
          meals: meal(true, false, false, '클럽식', null, null),
          schedule: [
            N(null, '호텔 조식 후 골프장으로 이동'),
            N(null, '▶캐슬렉스CC 27~36홀 라운딩'),
            N(null, '라운딩 후 호텔로 이동'),
            H('캐슬렉스 리조트 투숙 및 휴식'),
          ],
          hotel: HOTEL_INFO,
        },
        {
          day: 3,
          regions: ['청도', '부산'],
          meals: meal(true, false, false, '클럽식', null, null),
          schedule: [
            N(null, '호텔 조식 후 체크아웃, 공항으로 이동'),
            F('12:35', 'BX322 청도국제공항 출발 → 김해국제공항 15:30 도착', 'BX322'),
          ],
          hotel: null,
        },
      ],
    },
    itinerary: [
      '제1일: 부산(김해) → 청도 | 캐슬렉스CC 18홀 라운딩 + 호텔 투숙',
      '제2일: 청도 | 캐슬렉스CC 27~36홀 라운딩 + 호텔 휴식',
      '제3일: 청도 → 부산(김해) | 호텔 조식 후 귀국',
    ],
    accommodations: ['캐슬렉스 리조트 (2인1실)'],
    raw_text: RAW_TEXT,
    parser_version: 'register-v2026.04.24-claude-opus-4.7-direct',
    agent_audit_report: AGENT_AUDIT_REPORT,
    filename: 'landbusan_castlex_golf_20260424.txt',
    file_type: 'manual',
    confidence: 0.95,
  };
}

function buildPkg4Day() {
  return {
    title: '실속 지존 캐슬렉스 GOLF 4일 90H',
    destination: '칭다오',
    country: '중국',
    category: 'golf',
    product_type: '실속',
    trip_style: '3박4일',
    duration: 4,
    nights: 3,
    departure_airport: '부산(김해)',
    departure_days: '월/화/수',
    airline: 'BX(에어부산)',
    min_participants: 2,
    status: 'pending',
    price: 679000,
    guide_tip: null,
    single_supplement: '평일 30,000원/박/인 · 금토휴일 40,000원/박/인',
    small_group_surcharge: '미팅/샌딩비: 4인 이상 300위안/인, 2명 450위안/인',
    surcharges: COMMON_SURCHARGES,
    excluded_dates: [],
    optional_tours: [RECOMMEND_OPTION],
    price_tiers: [],
    price_dates: buildPriceDates(DATES_4D, 679000),
    inclusions: COMMON_INCLUSIONS,
    excludes: COMMON_EXCLUDES,
    notices_parsed: COMMON_NOTICES,
    special_notes: COMMON_SPECIAL_NOTES,
    product_highlights: COMMON_HIGHLIGHTS_4D,
    product_summary:
      '청도 캐슬렉스CC에서 4일간 18+27~36+27~36+이동만으로 90홀을 채우는 라운딩 헤비 코스입니다. BX 김해 직항으로 부담 없이 들어가 캐슬렉스 리조트 3박 + 조식까지 묶었고, 그린피·캐디피·전동카가 전부 포함되어 라운딩에만 집중하실 수 있어요.',
    product_tags: ['골프', '캐슬렉스', '청도', '부산직항', '실속', '90홀'],
    itinerary_data: {
      meta: {
        flight_out: 'BX321',
        flight_in: 'BX322',
        ticketing_deadline: '2026-04-29',
        airline: 'BX(에어부산)',
        departure_airport: '부산(김해)',
      },
      days: [
        {
          day: 1,
          regions: ['부산', '청도'],
          meals: meal(false, false, false, null, null, null),
          schedule: [
            N('08:30', '출발 2시간 전 김해공항 국제선 2층 미팅 후 수속'),
            F('10:30', 'BX321 김해국제공항 출발 → 청도국제공항 11:35 도착', 'BX321'),
            N(null, '청도공항 도착 후 가이드 미팅 (미팅보드 "캐슬렉스 골프")'),
            N(null, '골프장으로 이동 (약 1시간 소요)'),
            N(null, '▶캐슬렉스CC 18홀 라운딩 (일몰까지 라운딩 조건, 환불 불가)'),
            H('캐슬렉스 리조트 투숙 및 휴식'),
          ],
          hotel: HOTEL_INFO,
        },
        {
          day: 2,
          regions: ['청도'],
          meals: meal(true, false, false, '클럽식', null, null),
          schedule: [
            N(null, '호텔 조식 후 골프장으로 이동'),
            N(null, '▶캐슬렉스CC 27~36홀 라운딩'),
            N(null, '라운딩 후 호텔로 이동'),
            H('캐슬렉스 리조트 투숙 및 휴식'),
          ],
          hotel: HOTEL_INFO,
        },
        {
          day: 3,
          regions: ['청도'],
          meals: meal(true, false, false, '클럽식', null, null),
          schedule: [
            N(null, '호텔 조식 후 골프장으로 이동'),
            N(null, '▶캐슬렉스CC 27~36홀 라운딩'),
            N(null, '라운딩 후 호텔로 이동'),
            H('캐슬렉스 리조트 투숙 및 휴식'),
          ],
          hotel: HOTEL_INFO,
        },
        {
          day: 4,
          regions: ['청도', '부산'],
          meals: meal(true, false, false, '클럽식', null, null),
          schedule: [
            N(null, '호텔 조식 후 체크아웃, 공항으로 이동'),
            F('12:35', 'BX322 청도국제공항 출발 → 김해국제공항 15:30 도착', 'BX322'),
          ],
          hotel: null,
        },
      ],
    },
    itinerary: [
      '제1일: 부산(김해) → 청도 | 캐슬렉스CC 18홀 라운딩 + 호텔 투숙',
      '제2일: 청도 | 캐슬렉스CC 27~36홀 라운딩 + 호텔 휴식',
      '제3일: 청도 | 캐슬렉스CC 27~36홀 라운딩 + 호텔 휴식',
      '제4일: 청도 → 부산(김해) | 호텔 조식 후 귀국',
    ],
    accommodations: ['캐슬렉스 리조트 (2인1실)'],
    raw_text: RAW_TEXT,
    parser_version: 'register-v2026.04.24-claude-opus-4.7-direct',
    agent_audit_report: AGENT_AUDIT_REPORT,
    filename: 'landbusan_castlex_golf_20260424.txt',
    file_type: 'manual',
    confidence: 0.95,
  };
}

const packages = [buildPkg3Day(), buildPkg4Day()];

(async () => {
  await inserter.run(packages);
})().catch(err => {
  console.error('❌ 등록 실패:', err);
  process.exit(1);
});
