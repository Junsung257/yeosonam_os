/**
 * ★ 청주-석가장(태항산) 2026 가을 전세기 — 투어라운지 / 정액 18만원 / 17항차
 *
 *   1) 청주-석가장 [보천대협곡/천계산/대협곡] 4일 (수요일 출발, 9건)
 *   2) 청주-석가장 [보천대협곡/천계산/대협곡/신동태항] 5일 (토요일 출발, 8건)
 *
 *   - 항공: RF 에어로케이 전세기 (RF8133 청주14:25→석가장15:45 / RF8143 석가장16:45→청주19:35)
 *   - 호텔: 임주 환빈서안호텔 5성급 / 한단 영양국제호텔 5성급
 *   - 노팁/노옵션 (선택관광 없음, 쇼핑 라텍스·차·침향 중 2회)
 *   - 정액 커미션 18만원/건 (commission_rate=0 + commission_fixed_amount=180000)
 */
const { createInserter } = require('./templates/insert-template');

const inserter = createInserter({
  landOperator: '투어라운지',
  commissionFixedAmount: 180000,   // 정액 18만원/건 (사장님 입력)
  commissionCurrency: 'KRW',
  ticketingDeadline: null,         // 원문에 발권기한 명시 없음
  destCode: 'SJW',                 // 석가장 정딩 국제공항
});

// ── 헬퍼 ──
const N = (time, activity) => ({ time, activity, type: 'normal', transport: null, note: null });
const F = (time, activity, transport) => ({ time, activity, type: 'flight', transport, note: null });
const T = (activity) => ({ time: null, activity, type: 'normal', transport: '전용차량', note: null });
const H = (activity) => ({ time: null, activity, type: 'hotel', transport: null, note: null });
const meal = (b, l, d, bn, ln, dn) => ({
  breakfast: b, lunch: l, dinner: d,
  breakfast_note: bn || null, lunch_note: ln || null, dinner_note: dn || null,
});

// ── 출발일 ──
// 3박4일 (수): 9/23(추석연휴 1,099,000) + 9/30,10/7,14,21,28,11/4,11,18 (899,000) — 9건
const DATES_4D = [
  { date: '2026-09-23', price: 1099000, confirmed: false }, // 추석연휴
  { date: '2026-09-30', price: 899000,  confirmed: false },
  { date: '2026-10-07', price: 899000,  confirmed: false },
  { date: '2026-10-14', price: 899000,  confirmed: false },
  { date: '2026-10-21', price: 899000,  confirmed: false },
  { date: '2026-10-28', price: 899000,  confirmed: false },
  { date: '2026-11-04', price: 899000,  confirmed: false },
  { date: '2026-11-11', price: 899000,  confirmed: false },
  { date: '2026-11-18', price: 899000,  confirmed: false },
];

// 4박5일 (토): 9/26 + 10/3,10,17,24,31, 11/7,14 (999,000) — 8건
const DATES_5D = [
  { date: '2026-09-26', price: 999000, confirmed: false },
  { date: '2026-10-03', price: 999000, confirmed: false },
  { date: '2026-10-10', price: 999000, confirmed: false },
  { date: '2026-10-17', price: 999000, confirmed: false },
  { date: '2026-10-24', price: 999000, confirmed: false },
  { date: '2026-10-31', price: 999000, confirmed: false },
  { date: '2026-11-07', price: 999000, confirmed: false },
  { date: '2026-11-14', price: 999000, confirmed: false },
];

// ── 공통 데이터 ──
const COMMON_INCLUSIONS = [
  '항공료',
  'TAX/유류세',
  '호텔(2인1실)',
  '전일정 식사',
  '리무진차량',
  '관광지 입장료',
  '여행자보험',
  '가이드&기사 경비',
];

const COMMON_EXCLUDES = [
  '개인경비',
  '매너팁',
];

const SURCHARGES_4D = [
  { name: '싱글차지(전일정)', start: null, end: null, amount: 140000, currency: 'KRW', unit: '인' },
];

const SURCHARGES_5D = [
  { name: '싱글차지(전일정)', start: null, end: null, amount: 180000, currency: 'KRW', unit: '인' },
];

// 노옵션 명시 — optional_tours 비움
const OPTIONAL_TOURS = [];

const COMMON_NOTICES = [
  {
    type: 'CRITICAL',
    title: '필수 확인',
    text: '• 여권 유효기간 출발일 기준 6개월 이상 남아 있어야 합니다\n• 본 상품은 전세기편을 이용하여 항공좌석·호텔객실 등을 일부 선납해놓은 상품으로, 공정거래위원회 약관과는 별도로 국외여행 제5조 특별약관에 따라 별도 취소 수수료가 부과됩니다',
  },
  {
    type: 'INFO',
    title: '수화물 안내',
    text: '• 무료 위탁수하물 15KG / 기내수하물 7KG',
  },
  {
    type: 'PAYMENT',
    title: '예약금·완납 안내',
    text: '• 예약금: 30만원/인\n• 출발 2주전 잔금 완납\n• 최소출발인원 10명',
  },
  {
    type: 'POLICY',
    title: '전세기 특별약관 (취소 수수료)',
    text: '• 여행개시 30일 전까지 통보 시: 계약금 100% 환급\n• 여행개시 29일~21일 전까지 통보 시: 여행요금의 30% 취소 수수료\n• 여행개시 20일~11일 전까지 통보 시: 여행요금의 50% 취소 수수료\n• 여행개시 10일~당일까지 통보 시: 여행요금의 100% 취소 수수료\n※ 단, 주말(토·일) 및 업무시간 이외의 취소 통보는 취소료 규정 산정날짜에서 제외',
  },
  {
    type: 'INFO',
    title: '일정 변동 안내',
    text: '• 상기 일정은 항공 및 현지 사정으로 인하여 변동이 있을 수 있습니다',
  },
];

// FIELD_POLICY: special_notes 는 deprecated (LLM 컨텍스트 전용). 쇼핑 정보는 customer_notes 에.
const COMMON_CUSTOMER_NOTES = `* 쇼핑센터: 라텍스·차·침향 중 2회 방문 (선택관광 없음 / 매너팁 별도)
* 호텔: 임주 환빈서안호텔 또는 동급 (5성급), 한단 영양국제호텔 또는 동급 (5성급)
* 항공: RF 에어로케이 전세기 (청주↔석가장 직항)`;

const COMMON_INTERNAL_NOTES = `* 랜드사: 투어라운지 / 정액 커미션 180,000원/건 (KRW)
* 17항차 (2026/9/23 ~ 11/18) — 가을 시즌 한정
* 주 2회 운항 (수요일 3박4일 / 토요일 4박5일)
* 전세기 특별약관 적용 — 30일전 환불선 명확히 안내`;

const HOTEL_LINJU = { name: '임주 환빈서안호텔 또는 동급', grade: '5성급', note: '2인1실' };
const HOTEL_HANDAN = { name: '한단 영양국제호텔 또는 동급', grade: '5성급', note: '2인1실' };

// ── 원문 (Rule Zero — verbatim 보존) ──
const RAW_TEXT = `투어라운지 커미션 18만원

 청주-태항산 (석가장) 직항 전세기-RF
#노팁,노옵션 #17항차 #수(4일),토(5일) #가을


전상품  <노팁 + 노옵션>
RF 에어로케이
주 2회
수, 토
2026년 09월 23일 ~ 11월 18일 <17항차>
수요일<3박 4일>  토요일<4박 5일>
청주 ➡ 석가장  RF8133  14:25–15:45
석가장 ➡ 청주  RF8143  16:45-19:35
⚑ 상품요금표 - 가을 ⚑
상품명 / 날짜
상품가
보천대협곡/천계산/대협곡
<3박4일> 수요일 출발
 09월 23일 <추석연휴>
1,099,000
 09월 30일
899,000
 10월 7일, 14일, 21일, 28일
 11월 4일, 11일, 18일
보천대협곡/천계산/대협곡
/신동태항
<4박5일> 토요일 출발
 09월 26일
999,000
 10월 3일, 10일, 17일, 24일, 31일
 11월 7일, 14일
★ 취소료 규정 ★

 본 상품은 전세기편을 이용하여 항공좌석, 호텔객실, 골프장 비용을 일부 선납 해놓은 상품으로
 공정거래위원회 약관과는 별도로 국외여행 제5조 특별약관에 따라 별도 취소 수수료가
 부과됩니다.

  - 여행개시 30일 전까지 통보시 - 계약금 100% 환급
  - 여행개시 29일전~21일전까지 통보시 – 여행요금의  30% 취소 수수료 적용
  - 여행개시 20일전~11일전까지 통보시 – 여행요금의  50% 취소 수수료 적용
  - 여행개시 10일전~당일   까지 통보시 – 여행요금의 100% 취소 수수료 적용


청주-석가장 [보천대협곡/천계산/대협곡/신동태항] 5일–노팁/노옵션
상품가
노팁
노옵션
< 매주 토요일 출발 >
최소출발인원 10명
 09월  26일
999,000
 10월 3일, 10일, 17일, 24일, 31일
 11월  7일, 14일
포함사항
항공료, TAX/유류세, 호텔(2인1실), 전일정 식사, 리무진차량, 관광지입장료, 여행자보험, 가이드&기사 경비
불포함사항
개인경비 및 기타 매너팁, 싱글차지 18만원/인/전일정
쇼핑/옵션
라텍스, 차, 침향 중 2회 방문 / 노옵션
안내사항
▪ 여권 유효기간은 최소 6개월 이상 남아 있어야 합니다.
▪ 무료 수화물 안내: 위탁수하물 15KG / 기내수하물 7KG
예약금
&
특별약관
▪ 예약금 : 30만원(인) / 출발 2주전 잔금완납
▪ 전세기 특별약관 적용됩니다. 신중하게 예약해주세요.
 - 여행개시 30일전 까지 취소시: 계약금 환불
 - 여행개시 29일전 20일전까지 통보시: 여행요금의 30% 배상
 - 여행개시 20일전 11일전까지 통보시: 여행요금의 50% 배상
 - 여행개시 10일전에서 당일까지 통보시: 여행요금의 100% 배상
 ※ 단, 주말(토, 일요일) 및 업무시간 이외의 취소 통보는 취소료 규정 산정날짜에서 제외.


------
DATE
CITY
TRANSIT
TIME
ITINERARY
MEAL
제1일
토
청 주
석가장
임 주
RF8133

전용차량
14:25
15:45

청주 국제공항 출발
석가장 국제공항 도착 후 가이드 미팅
임주로 이동 [약 4시간 30분 소요]
석식 후 호텔 투숙 및 휴식

석:샤브샤브
  무제한
HTL : 임주-환빈서안호텔 또는 동급 [5성급]
제2일
일
임 주
천계산
보  천
대협곡

임 주

전용차량
전 일
호텔 조식 후 천계산으로 이동 [약 1시간 30분 소요]
▶운봉화랑[전동카 포함]-시담대-여화대-유리잔도
중식 후 보천대협곡으로 이동 [약 40분 소요]
▶입구-셔틀버스-공중버스-쌍심플래폼-레일케이블카-전동카
 -유리전망대-전동카-동굴엘레베이터-전동카-셔틀버스-출구
임주로 이동 [약 2시간 소요]
▶피로를 풀어주는 전신마사지 90분 체험 [매너팁 별도]
석식 후 호텔 투숙 및 휴식
조:호텔식
중:산  채
   비빔밥
석:삼겹살
   무제한
HTL : 임주-환빈서안호텔 또는 동급 [5성급]
제3일
월
임 주
대협곡


한 단
전용차량
전 일
호텔 조식 후 대협곡으로 이동 [약 50분 소요]
▶도화곡-황룡담-이룡희주-함주-구련폭포[도보로 약 60분]
 환산선 일주[전동카 포함]-천갱-수녀봉-몽환곡
중식 후 한단으로 이동 [약 1시간 40분 소요]
석식 후 호텔 투숙 및 휴식
조:호텔식
중:동태찌개
석:현지식
HTL : 한단-영양국제호텔 또는 동급 [5성급]
제4일
화
한 단
동태항

한 단
전용차량
전 일
호텔 조식 후 동태항으로 이동 [약 1시간 20분 소요]
▶입구-케이블카-남천문-중천문-태항일주-태항천폭-천척장성
  -불관대-홍석잔도-북고봉-셔틀버스 하산
중식 후 한단으로 이동 [약 1시간 20분 소요]
▶2600년 역사를 가지고 있는 북방 수성-광부고성
석식 후 호텔 투숙 및 휴식
조:호텔식
중:된장찌개
  +보 쌈
석:현지식
HTL : 한단-영양국제호텔 또는 동급 [5성급]
제5일
수
한 단
석가장


청 주
전용차량


RF8143
오 전


16:45
19:35
호텔 조식 후 석가장으로 이동 [약 2시간 소요]
▶조운묘 관광
중식 후 공항으로 이동
석가장 국제공항 출발
청주 국제공항 도착
조:호텔식
중:호텔식
☞ 상기 일정은 항공 및 현지사정으로 인하여 변동이 있을 수도 있습니다.



-----


청주-석가장 [보천대협곡/천계산/대협곡] 4일–노팁/노옵션
상 품 가
노팁
노옵션
< 매주 수요일 출발 >
최소출발인원 10명
09월 23일 <추석연휴>
1,099,000
09월 30일
899,000
10월 7일, 14일, 21일, 28일
11월 4일, 11일, 18일
포함사항
항공료, TAX/유류세, 호텔(2인1실), 전일정 식사, 리무진차량, 관광지입장료, 여행자보험, 가이드&기사 경비
불포함사항
개인경비 및 기타 매너팁, 싱글차지 14만원/인/전일정
쇼핑/옵션
라텍스, 차, 침향 중 2회 방문 / 노옵션
안내사항
▪ 여권 유효기간은 최소 6개월 이상 남아 있어야 합니다.
▪ 무료 수화물 안내: 위탁수하물 15KG / 기내수하물 7KG
예약금
&
특별약관
▪ 예약금 : 30만원(인) / 출발 2주전 잔금완납
▪ 전세기 특별약관 적용됩니다. 신중하게 예약해주세요.
 - 여행개시 30일전 까지 취소시: 계약금 환불
 - 여행개시 29일전 20일전까지 통보시: 여행요금의 30% 배상
 - 여행개시 20일전 11일전까지 통보시: 여행요금의 50% 배상
 - 여행개시 10일전에서 당일까지 통보시: 여행요금의 100% 배상
 ※ 단, 주말(토, 일요일) 및 업무시간 이외의 취소 통보는 취소료 규정 산정날짜에서 제외.



DATE
CITY
TRANSIT
TIME
ITINERARY
MEAL
제1일
수
청 주
석가장
임 주
RF8133

전용차량
14:25
15:45

청주 국제공항 출발
석가장 국제공항 도착 후 가이드 미팅
임주로 이동 [약 4시간 30분 소요]
석식 후 호텔 투숙 및 휴식

석:샤브샤브
   무제한
HTL : 임주 환빈서안호텔 또는 동급 [5성급]
제2일
목
임 주
천계산
보 천
대협곡

임 주
전용차량
전 일
호텔 조식 후 천계산으로 이동 [약 1시간 30분 소요]
▶운봉화랑[전동카 포함]-시담대-여화대-유리잔도
중식 후 보천대협곡으로 이동 [약 40분 소요]
▶입구-셔틀버스-공중버스-쌈심플래폼-레일케이블카-전동카
 -유리전망대-전동카-동굴엘리베이터-전동카-셔틀버스-출구
임주로 이동 [약 2시간 소요]
▶피로를 풀어주는 전신마사지 90분 체험 [매너팁 별도]
석식 후 호텔 투숙 및 휴식
조:호텔식
중:산  채
   비빔밥
석:삼겹살
  무제한
HTL : 임주 환빈서안호텔 또는 동급 [5성급]
제3일
금
임 주
대협곡


한 단
전용차량
전 일
호텔 조식 후 대협곡으로 이동 [약 50분 소요]
▶도화곡-황룡담-함주-이룡희주-구련폭포[도보 약 60분]
  -환산성일주[전동카]-천갱-수녀봉-몽환곡
중식 후 한단으로 이동 [약 1시간 40분 소요]
▶2600년 역사를 가지고 있는 북방 수성-광부고성
석식 후 호텔 투숙 및 휴식
조:호텔식
중:동태찌개석:현지식
HTL : 한단-영양국제호텔 또는 동급 [5성급]
제4일
토
한 단
석가장


청 주
전용차량


RF8143
오 전


16:45
19:35
호텔 조식 후 석가장으로 이동 [약 2시간 소요]
▶조운묘 관광
중식 후 공항으로 이동
석가장 국제공항 출발
청주 국제공항 도착
조:호텔식
중:호텔식
☞ 상기 일정은 항공 및 현지사정으로 인하여 변동이 있을 수도 있습니다.`;

// ── Agent Self-Audit (Step 6.5) — Reflection + CoT ──
const AGENT_AUDIT_REPORT = {
  parser_version: 'register-v2026.04.27-claude-opus-4.7-direct',
  ran_at: new Date().toISOString(),
  claims: [
    {
      id: 'min_participants',
      field: 'min_participants',
      severity: 'HIGH',
      text: '최소 출발인원 10명',
      evidence: '원문: "< 매주 토요일 출발 > 최소출발인원 10명" / "< 매주 수요일 출발 > 최소출발인원 10명"',
      supported: true,
      note: null,
    },
    {
      id: 'ticketing_deadline',
      field: 'ticketing_deadline',
      severity: 'HIGH',
      text: 'ticketing_deadline = null',
      evidence: '원문에 발권기한·발권마감 표기 없음. "출발 2주전 잔금완납"은 잔금 완납 기한이지 발권기한 아님.',
      supported: true,
      note: 'ERR-date-confusion 방어 — 잔금완납 기한을 ticketing_deadline 으로 오매핑 금지',
    },
    {
      id: 'inclusions:insurance',
      field: 'inclusions',
      severity: 'CRITICAL',
      text: '여행자보험 (금액 미명시)',
      evidence: '원문: "포함사항 항공료, TAX/유류세, 호텔(2인1실), 전일정 식사, 리무진차량, 관광지입장료, 여행자보험, 가이드&기사 경비"',
      supported: true,
      note: '원문에 "2억"·"1억" 등 보험 금액 표기 없음 — 원문 그대로 "여행자보험"만 저장 (ERR-FUK-insurance-injection 방어)',
    },
    {
      id: 'inclusions:hotel_grade',
      field: 'inclusions/accommodations',
      severity: 'CRITICAL',
      text: '호텔(2인1실), 5성급 (임주 환빈서안호텔 / 한단 영양국제호텔)',
      evidence: '원문 일정: "HTL : 임주-환빈서안호텔 또는 동급 [5성급]" / "HTL : 한단-영양국제호텔 또는 동급 [5성급]"',
      supported: true,
      note: '5성급 표기는 원문에 명시되어 있으므로 accommodations 에 반영 OK',
    },
    {
      id: 'price:4d:추석',
      field: 'price_dates 4D',
      severity: 'HIGH',
      text: '2026-09-23 1,099,000원 (추석연휴)',
      evidence: '원문: "09월 23일 <추석연휴> 1,099,000"',
      supported: true,
      note: null,
    },
    {
      id: 'price:4d:평일',
      field: 'price_dates 4D',
      severity: 'HIGH',
      text: '9/30 + 10/7,14,21,28 + 11/4,11,18 = 899,000원',
      evidence: '원문: "09월 30일 899,000 / 10월 7일, 14일, 21일, 28일 / 11월 4일, 11일, 18일"',
      supported: true,
      note: null,
    },
    {
      id: 'price:5d',
      field: 'price_dates 5D',
      severity: 'HIGH',
      text: '9/26 + 10/3,10,17,24,31 + 11/7,14 = 999,000원',
      evidence: '원문: "09월 26일 999,000 / 10월 3일, 10일, 17일, 24일, 31일 / 11월 7일, 14일"',
      supported: true,
      note: null,
    },
    {
      id: 'flight:out',
      field: 'itinerary_data.days[0] flight',
      severity: 'HIGH',
      text: 'RF8133 청주 14:25 → 석가장 15:45',
      evidence: '원문: "청주 ➡ 석가장  RF8133  14:25–15:45"',
      supported: true,
      note: null,
    },
    {
      id: 'flight:in',
      field: 'itinerary_data.days[last] flight',
      severity: 'HIGH',
      text: 'RF8143 석가장 16:45 → 청주 19:35',
      evidence: '원문: "석가장 ➡ 청주  RF8143  16:45-19:35"',
      supported: true,
      note: null,
    },
    {
      id: 'surcharges:single:4d',
      field: 'surcharges (4일)',
      severity: 'HIGH',
      text: '싱글차지 140,000원/인/전일정',
      evidence: '원문 4일 불포함사항: "개인경비 및 기타 매너팁, 싱글차지 14만원/인/전일정"',
      supported: true,
      note: null,
    },
    {
      id: 'surcharges:single:5d',
      field: 'surcharges (5일)',
      severity: 'HIGH',
      text: '싱글차지 180,000원/인/전일정',
      evidence: '원문 5일 불포함사항: "개인경비 및 기타 매너팁, 싱글차지 18만원/인/전일정"',
      supported: true,
      note: null,
    },
    {
      id: 'cancellation_policy',
      field: 'notices_parsed POLICY',
      severity: 'CRITICAL',
      text: '전세기 특별약관: 30일전 환불 / 29-21일전 30% / 20-11일전 50% / 10-당일 100%',
      evidence: '원문: "여행개시 30일 전까지 통보시 - 계약금 100% 환급 / 29일전~21일전 - 30% / 20일전~11일전 - 50% / 10일전~당일 - 100%"',
      supported: true,
      note: '주말·업무시간 외 취소는 산정날짜 제외 단서 포함',
    },
    {
      id: 'payment',
      field: 'notices_parsed PAYMENT',
      severity: 'HIGH',
      text: '예약금 30만원/인, 출발 2주전 잔금완납',
      evidence: '원문: "예약금 : 30만원(인) / 출발 2주전 잔금완납"',
      supported: true,
      note: null,
    },
    {
      id: 'shopping',
      field: 'customer_notes',
      severity: 'HIGH',
      text: '쇼핑센터 라텍스/차/침향 중 2회',
      evidence: '원문: "쇼핑/옵션 라텍스, 차, 침향 중 2회 방문 / 노옵션"',
      supported: true,
      note: '원문에 "2회" 명시 — N회 수치 정확 반영',
    },
    {
      id: 'optional_tours',
      field: 'optional_tours',
      severity: 'HIGH',
      text: 'optional_tours = []',
      evidence: '원문: "노옵션" — 선택관광 없음',
      supported: true,
      note: null,
    },
    {
      id: 'regions:4d',
      field: 'itinerary_data.days[].regions (4일)',
      severity: 'HIGH',
      text: 'D1=[청주,석가장,임주] / D2=[임주,천계산,보천대협곡,임주] / D3=[임주,대협곡,한단] / D4=[한단,석가장,청주]',
      evidence: '원문 4일 "지역" 컬럼: 제1일 "청 주, 석가장, 임 주" / 제2일 "임 주, 천계산, 보 천 대협곡, 임 주" / 제3일 "임 주, 대협곡, 한 단" / 제4일 "한 단, 석가장, 청 주"',
      supported: true,
      note: null,
    },
    {
      id: 'regions:5d',
      field: 'itinerary_data.days[].regions (5일)',
      severity: 'HIGH',
      text: 'D1=[청주,석가장,임주] / D2=[임주,천계산,보천대협곡,임주] / D3=[임주,대협곡,한단] / D4=[한단,동태항,한단] / D5=[한단,석가장,청주]',
      evidence: '원문 5일 "지역" 컬럼: 제1일 "청 주, 석가장, 임 주" / 제2일 "임 주, 천계산, 보 천 대협곡, 임 주" / 제3일 "임 주, 대협곡, 한 단" / 제4일 "한 단, 동태항, 한 단" / 제5일 "한 단, 석가장, 청 주"',
      supported: true,
      note: '4일과 5일은 D3 차이 — 4일은 D3에 광부고성 포함(한단 도착 후), 5일은 D4(동태항+한단 광부고성). 원문 그대로 (ERR-FUK-regions-copy 방어)',
    },
    {
      id: 'attraction:gwangbu',
      field: 'itinerary_data.days schedule',
      severity: 'HIGH',
      text: '광부고성: 4일은 D3, 5일은 D4',
      evidence: '원문 4일 D3: "한단으로 이동... ▶2600년 역사를 가지고 있는 북방 수성-광부고성" / 원문 5일 D4: "한단으로 이동... ▶2600년 역사를 가지고 있는 북방 수성-광부고성"',
      supported: true,
      note: '두 상품의 광부고성 위치가 다름 — 원문 일정 그대로 매핑 (ERR-KUL-02/03 DAY 교차 오염 방어)',
    },
    {
      id: 'attraction:dongtaehang',
      field: 'itinerary_data.days schedule',
      severity: 'HIGH',
      text: '동태항(신동태항): 5일에만 D4 등장. 4일에는 없음.',
      evidence: '원문 4일에는 "동태항" 일정 자체 부재 / 원문 5일 D4: "동태항으로 이동 [약 1시간 20분 소요] ▶입구-케이블카-남천문-중천문-태항일주-태항천폭-천척장성-불관대-홍석잔도-북고봉-셔틀버스 하산"',
      supported: true,
      note: '4일에 동태항 임의 추가 금지 (ERR-KUL-02 교차 오염 방어)',
    },
    {
      id: 'meals:5d_d4',
      field: 'itinerary_data.days[3].meals (5일)',
      severity: 'MEDIUM',
      text: 'D4 식사: 조:호텔식 / 중:된장찌개+보쌈 / 석:현지식',
      evidence: '원문 5일 제4일: "조:호텔식 / 중:된장찌개+보 쌈 / 석:현지식"',
      supported: true,
      note: null,
    },
  ],
  overall_verdict: 'clean',
  unsupported_critical: 0,
  unsupported_high: 0,
};

// ── 4박5일 (토요일 출발) ──
function buildPkg5Day() {
  return {
    title: '청주-석가장 [보천대협곡·천계산·대협곡·신동태항] 5일 노팁/노옵션',
    destination: '석가장',
    country: '중국',
    category: 'package',
    product_type: '노팁/노옵션',
    trip_style: '4박5일',
    duration: 5,
    nights: 4,
    departure_airport: '청주(CJJ)',
    departure_days: '토',
    airline: 'RF(에어로케이) 전세기',
    min_participants: 10,
    status: 'pending',
    price: 999000,
    guide_tip: null,
    single_supplement: '180,000원/인/전일정',
    small_group_surcharge: null,
    surcharges: SURCHARGES_5D,
    excluded_dates: [],
    optional_tours: OPTIONAL_TOURS,
    price_tiers: [],
    price_dates: DATES_5D,
    inclusions: COMMON_INCLUSIONS,
    excludes: COMMON_EXCLUDES,
    notices_parsed: COMMON_NOTICES,
    customer_notes: COMMON_CUSTOMER_NOTES,
    internal_notes: COMMON_INTERNAL_NOTES,
    product_highlights: [
      '청주 RF 에어로케이 전세기 직항 (석가장 직항)',
      '5성급 호텔 (임주 환빈서안호텔 + 한단 영양국제호텔)',
      '천계산·보천대협곡·대협곡·신동태항 핵심 코스 4일 풀투어',
      '전 일정 식사 포함 (산채비빔밥·삼겹살 무제한·샤브샤브 등)',
      '전신마사지 90분 체험 (둘째날, 매너팁 별도)',
    ],
    product_summary:
      '가을 단풍 시즌에 RF 에어로케이 청주 직항 전세기로 떠나는 4박5일 태항산 코스입니다. 천계산·보천대협곡·대협곡·신동태항까지 핵심 코스를 모두 담았고, 임주 환빈서안호텔(5성급)과 한단 영양국제호텔(5성급)에서 묵으며 노팁·노옵션으로 진행됩니다. 산채비빔밥·삼겹살 무제한·동태찌개·된장찌개+보쌈 등 전 일정 식사가 포함되어 있어 출발 후엔 일정만 따라가시면 됩니다.',
    product_tags: ['중국', '석가장', '태항산', '전세기', '청주직항', '단풍', '노팁노옵션', '5성급'],
    itinerary_data: {
      meta: {
        flight_out: 'RF8133',
        flight_in: 'RF8143',
        ticketing_deadline: null,
        airline: 'RF(에어로케이)',
        departure_airport: '청주(CJJ)',
        seats_note: '전세기',
      },
      days: [
        {
          day: 1,
          regions: ['청주', '석가장', '임주'],
          meals: meal(false, false, true, null, null, '샤브샤브 무제한'),
          schedule: [
            N('12:25', '출발 2시간 전 청주국제공항 미팅 후 수속'),
            F('14:25', 'RF8133 청주국제공항 출발 → 석가장국제공항 15:45 도착', 'RF8133'),
            N(null, '석가장 국제공항 도착 후 가이드 미팅'),
            T('임주로 이동 [약 4시간 30분 소요]'),
            H('임주 환빈서안호텔 또는 동급 (5성급) 투숙 및 휴식'),
          ],
          hotel: HOTEL_LINJU,
        },
        {
          day: 2,
          regions: ['임주', '천계산', '보천대협곡', '임주'],
          meals: meal(true, true, true, '호텔식', '산채비빔밥', '삼겹살 무제한'),
          schedule: [
            N(null, '호텔 조식 후 천계산으로 이동 [약 1시간 30분 소요]'),
            N(null, '▶천계산 (운봉화랑·시담대·여화대·유리잔도, 전동카 포함)'),
            N(null, '중식 후 보천대협곡으로 이동 [약 40분 소요]'),
            N(null, '▶보천대협곡 (셔틀버스·공중버스·쌍심플래폼·레일케이블카·전동카·유리전망대·동굴엘레베이터)'),
            T('임주로 이동 [약 2시간 소요]'),
            N(null, '▶전신마사지 90분 체험 (매너팁 별도)'),
            H('임주 환빈서안호텔 또는 동급 (5성급) 투숙 및 휴식'),
          ],
          hotel: HOTEL_LINJU,
        },
        {
          day: 3,
          regions: ['임주', '대협곡', '한단'],
          meals: meal(true, true, true, '호텔식', '동태찌개', '현지식'),
          schedule: [
            N(null, '호텔 조식 후 대협곡으로 이동 [약 50분 소요]'),
            N(null, '▶대협곡 (도화곡·황룡담·이룡희주·함주·구련폭포 도보 약 60분·환산선일주·천갱·수녀봉·몽환곡, 전동카 포함)'),
            T('중식 후 한단으로 이동 [약 1시간 40분 소요]'),
            H('한단 영양국제호텔 또는 동급 (5성급) 투숙 및 휴식'),
          ],
          hotel: HOTEL_HANDAN,
        },
        {
          day: 4,
          regions: ['한단', '동태항', '한단'],
          meals: meal(true, true, true, '호텔식', '된장찌개+보쌈', '현지식'),
          schedule: [
            N(null, '호텔 조식 후 동태항으로 이동 [약 1시간 20분 소요]'),
            N(null, '▶동태항 (입구·케이블카·남천문·중천문·태항일주·태항천폭·천척장성·불관대·홍석잔도·북고봉·셔틀버스 하산)'),
            T('중식 후 한단으로 이동 [약 1시간 20분 소요]'),
            N(null, '▶광부고성 (2600년 역사를 가지고 있는 북방 수성)'),
            H('한단 영양국제호텔 또는 동급 (5성급) 투숙 및 휴식'),
          ],
          hotel: HOTEL_HANDAN,
        },
        {
          day: 5,
          regions: ['한단', '석가장', '청주'],
          meals: meal(true, true, false, '호텔식', '호텔식', null),
          schedule: [
            T('호텔 조식 후 석가장으로 이동 [약 2시간 소요]'),
            N(null, '▶조운묘 관광'),
            N(null, '중식 후 공항으로 이동'),
            F('16:45', 'RF8143 석가장국제공항 출발 → 청주국제공항 19:35 도착', 'RF8143'),
          ],
          hotel: null,
        },
      ],
    },
    itinerary: [
      '제1일 (토): 청주 → 석가장 → 임주 (전용차량 4시간 30분) | 석식 후 호텔 투숙',
      '제2일 (일): 임주 → 천계산 → 보천대협곡 → 임주 | 전신마사지 90분 + 호텔 투숙',
      '제3일 (월): 임주 → 대협곡 → 한단 (전용차량 1시간 40분) | 호텔 투숙',
      '제4일 (화): 한단 → 동태항 → 한단 + 광부고성 | 호텔 투숙',
      '제5일 (수): 한단 → 석가장 → 청주 (조운묘 관광 후 귀국)',
    ],
    accommodations: [
      '임주 환빈서안호텔 또는 동급 (5성급, 2인1실)',
      '한단 영양국제호텔 또는 동급 (5성급, 2인1실)',
    ],
    raw_text: RAW_TEXT,
    parser_version: 'register-v2026.04.27-claude-opus-4.7-direct',
    agent_audit_report: AGENT_AUDIT_REPORT,
    filename: 'tourlounge_sjw_taehang_20260427.txt',
    file_type: 'manual',
    confidence: 0.95,
  };
}

// ── 3박4일 (수요일 출발) ──
function buildPkg4Day() {
  return {
    title: '청주-석가장 [보천대협곡·천계산·대협곡] 4일 노팁/노옵션',
    destination: '석가장',
    country: '중국',
    category: 'package',
    product_type: '노팁/노옵션',
    trip_style: '3박4일',
    duration: 4,
    nights: 3,
    departure_airport: '청주(CJJ)',
    departure_days: '수',
    airline: 'RF(에어로케이) 전세기',
    min_participants: 10,
    status: 'pending',
    price: 899000,  // 최저가 (9/23 추석연휴는 1,099,000)
    guide_tip: null,
    single_supplement: '140,000원/인/전일정',
    small_group_surcharge: null,
    surcharges: SURCHARGES_4D,
    excluded_dates: [],
    optional_tours: OPTIONAL_TOURS,
    price_tiers: [],
    price_dates: DATES_4D,
    inclusions: COMMON_INCLUSIONS,
    excludes: COMMON_EXCLUDES,
    notices_parsed: COMMON_NOTICES,
    customer_notes: COMMON_CUSTOMER_NOTES,
    internal_notes: COMMON_INTERNAL_NOTES,
    product_highlights: [
      '청주 RF 에어로케이 전세기 직항 (석가장 직항)',
      '5성급 호텔 (임주 환빈서안호텔 + 한단 영양국제호텔)',
      '천계산·보천대협곡·대협곡·광부고성 핵심 코스',
      '전 일정 식사 포함 (산채비빔밥·삼겹살 무제한·동태찌개 등)',
      '전신마사지 90분 체험 (둘째날, 매너팁 별도)',
    ],
    product_summary:
      '가을 단풍 시즌 RF 에어로케이 청주 직항 전세기로 떠나는 3박4일 태항산 코스입니다. 천계산·보천대협곡·대협곡·광부고성까지 핵심만 빠르게 묶었고, 임주 환빈서안호텔(5성급)과 한단 영양국제호텔(5성급)에 묵으며 노팁·노옵션으로 진행됩니다. 4박5일과 달리 동태항(신동태항)은 빠지지만 일정이 짧아 짧은 휴가에도 편안히 다녀오시기 좋습니다.',
    product_tags: ['중국', '석가장', '태항산', '전세기', '청주직항', '단풍', '노팁노옵션', '5성급'],
    itinerary_data: {
      meta: {
        flight_out: 'RF8133',
        flight_in: 'RF8143',
        ticketing_deadline: null,
        airline: 'RF(에어로케이)',
        departure_airport: '청주(CJJ)',
        seats_note: '전세기',
      },
      days: [
        {
          day: 1,
          regions: ['청주', '석가장', '임주'],
          meals: meal(false, false, true, null, null, '샤브샤브 무제한'),
          schedule: [
            N('12:25', '출발 2시간 전 청주국제공항 미팅 후 수속'),
            F('14:25', 'RF8133 청주국제공항 출발 → 석가장국제공항 15:45 도착', 'RF8133'),
            N(null, '석가장 국제공항 도착 후 가이드 미팅'),
            T('임주로 이동 [약 4시간 30분 소요]'),
            H('임주 환빈서안호텔 또는 동급 (5성급) 투숙 및 휴식'),
          ],
          hotel: HOTEL_LINJU,
        },
        {
          day: 2,
          regions: ['임주', '천계산', '보천대협곡', '임주'],
          meals: meal(true, true, true, '호텔식', '산채비빔밥', '삼겹살 무제한'),
          schedule: [
            N(null, '호텔 조식 후 천계산으로 이동 [약 1시간 30분 소요]'),
            N(null, '▶천계산 (운봉화랑·시담대·여화대·유리잔도, 전동카 포함)'),
            N(null, '중식 후 보천대협곡으로 이동 [약 40분 소요]'),
            N(null, '▶보천대협곡 (셔틀버스·공중버스·쌈심플래폼·레일케이블카·전동카·유리전망대·동굴엘리베이터)'),
            T('임주로 이동 [약 2시간 소요]'),
            N(null, '▶전신마사지 90분 체험 (매너팁 별도)'),
            H('임주 환빈서안호텔 또는 동급 (5성급) 투숙 및 휴식'),
          ],
          hotel: HOTEL_LINJU,
        },
        {
          day: 3,
          regions: ['임주', '대협곡', '한단'],
          meals: meal(true, true, true, '호텔식', '동태찌개', '현지식'),
          schedule: [
            N(null, '호텔 조식 후 대협곡으로 이동 [약 50분 소요]'),
            N(null, '▶대협곡 (도화곡·황룡담·함주·이룡희주·구련폭포 도보 약 60분·환산성일주·천갱·수녀봉·몽환곡, 전동카 포함)'),
            T('중식 후 한단으로 이동 [약 1시간 40분 소요]'),
            N(null, '▶광부고성 (2600년 역사를 가지고 있는 북방 수성)'),
            H('한단 영양국제호텔 또는 동급 (5성급) 투숙 및 휴식'),
          ],
          hotel: HOTEL_HANDAN,
        },
        {
          day: 4,
          regions: ['한단', '석가장', '청주'],
          meals: meal(true, true, false, '호텔식', '호텔식', null),
          schedule: [
            T('호텔 조식 후 석가장으로 이동 [약 2시간 소요]'),
            N(null, '▶조운묘 관광'),
            N(null, '중식 후 공항으로 이동'),
            F('16:45', 'RF8143 석가장국제공항 출발 → 청주국제공항 19:35 도착', 'RF8143'),
          ],
          hotel: null,
        },
      ],
    },
    itinerary: [
      '제1일 (수): 청주 → 석가장 → 임주 (전용차량 4시간 30분) | 석식 후 호텔 투숙',
      '제2일 (목): 임주 → 천계산 → 보천대협곡 → 임주 | 전신마사지 90분 + 호텔 투숙',
      '제3일 (금): 임주 → 대협곡 → 한단 + 광부고성 | 호텔 투숙',
      '제4일 (토): 한단 → 석가장 → 청주 (조운묘 관광 후 귀국)',
    ],
    accommodations: [
      '임주 환빈서안호텔 또는 동급 (5성급, 2인1실)',
      '한단 영양국제호텔 또는 동급 (5성급, 2인1실)',
    ],
    raw_text: RAW_TEXT,
    parser_version: 'register-v2026.04.27-claude-opus-4.7-direct',
    agent_audit_report: AGENT_AUDIT_REPORT,
    filename: 'tourlounge_sjw_taehang_20260427.txt',
    file_type: 'manual',
    confidence: 0.95,
  };
}

const packages = [buildPkg4Day(), buildPkg5Day()];

(async () => {
  await inserter.run(packages);
})().catch(err => {
  console.error('❌ 등록 실패:', err);
  process.exit(1);
});
