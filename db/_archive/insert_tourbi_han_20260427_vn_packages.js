/**
 * 투어비 — 베트남 하노이 VN항공 패키지 5종 등록
 * 등록일: 2026-04-27 / 발권 마감: 2026-04-28
 * 항공: VN429 부산-하노이 11:00-13:15 / VN428 하노이-부산 01:15-07:05
 * 마진율: 9% (투어비)
 *
 * 상품:
 *   1) 실속 (4성 / 옌뜨/메가/닌빈 택1)
 *   2) 노팁노옵션 (5성 / 옌뜨/메가/닌빈 택1)
 *   3) 디너크루즈 (5성 / 옌뜨/메가 택1 + 5성 디너크루즈)
 *   4) 크루즈1박 (5성 + 5성 크루즈숙박)
 *   5) 사파 (5성 / 사파 판시판)
 */

const fs = require('fs');
const path = require('path');
const { createInserter } = require('./templates/insert-template');

// ─── 원문 + 해시 ────────────────────────────────────────
const RAW_TEXT = fs.readFileSync(path.resolve(__dirname, 'sample.txt'), 'utf-8');

// ─── 가격 매트릭스 (원 단위) ────────────────────────────
const PRICING = {
  '실속':       { S1: 639000,  S2: 619000,  S3: 679000,  S4: 819000,  S5: 1219000 },
  '노팁노옵션': { S1: 899000,  S2: 859000,  S3: 919000,  S4: 1059000, S5: 1479000 },
  '디너크루즈': { S1: 929000,  S2: 909000,  S3: 969000,  S4: 1109000, S5: 1509000 },
  '크루즈1박':  { S1: 1159000, S2: 1139000, S3: 1199000, S4: 1339000, S5: 1739000 },
  '사파':       { S1: 1059000, S2: 1039000, S3: 1099000, S4: 1239000, S5: 1639000 },
};

const SEASON_RANGES = {
  S1: [['2026-04-01', '2026-04-29']],
  S2: [['2026-05-04', '2026-06-30'], ['2026-08-23', '2026-09-17'], ['2026-09-28', '2026-09-30']],
  S3: [['2026-07-01', '2026-07-16'], ['2026-08-15', '2026-08-22'], ['2026-09-18', '2026-09-22']],
  S4: [['2026-07-17', '2026-08-14']],
  S5: [['2026-09-24', '2026-09-24']],
};

const TODAY = '2026-04-27';

function expandRange(start, end) {
  const out = [];
  const c = new Date(start);
  const e = new Date(end);
  while (c <= e) {
    const iso = c.toISOString().slice(0, 10);
    if (iso > TODAY) out.push(iso);
    c.setDate(c.getDate() + 1);
  }
  return out;
}

function buildPriceDates(productName) {
  const result = [];
  const prices = PRICING[productName];
  for (const [season, ranges] of Object.entries(SEASON_RANGES)) {
    const price = prices[season];
    for (const [start, end] of ranges) {
      for (const date of expandRange(start, end)) {
        result.push({ date, price, confirmed: false });
      }
    }
  }
  return result.sort((a, b) => a.date.localeCompare(b.date));
}

// ─── 공통 식사/공통 일정 헬퍼 ────────────────────────────
const meal = (b, l, d, bn, ln, dn) => ({
  breakfast: b, lunch: l, dinner: d,
  breakfast_note: bn || null, lunch_note: ln || null, dinner_note: dn || null,
});
const flight = (time, activity) => ({ time, activity, type: 'flight', transport: '전용차량', note: null });
const normal = (time, activity, note) => ({ time: time || null, activity, type: 'normal', transport: null, note: note || null });
const optional = (time, activity, note) => ({ time: time || null, activity, type: 'optional', transport: null, note: note || null });
const shopping = (time, activity, note) => ({ time: time || null, activity, type: 'shopping', transport: null, note: note || null });

// 공통 customer_notes (5개 상품 공유)
const COMMON_CUSTOMER_NOTES = `▶ 미성년자(만 14세 미만) 베트남 입국 시 영문 가족관계증명서를 반드시 지참하셔야 합니다 (부모 중 1명만 여행해도 적용).
▶ 인원 미 충족시 조인행사 진행될 수 있으며 현지에서 옵션안내 같이 드립니다.
▶ 여권 유효기간은 반드시 6개월 이상 남아 있어야 합니다.
▶ 한국인 가이드 단속이 강화되고 있어, 현지인 가이드가 공항 미팅 및 샌딩을 진행합니다.
▶ 25.1.1부터 베트남 입국시 전자담배(액상·가열·궐련형 전부) 반입 금지 (소지·사용시 압수+벌금 약 50만동~300만동).
▶ 하노이 출퇴근 시간 29인승 이상 차량 통제로 해당 시간에는 16인승 차량으로 나누어 행사 진행됩니다.`;

const COMMON_INTERNAL_NOTES = `[랜드사 투어비 / 마진 9%]
- 4월 출발건은 ★4/28까지 선발 조건★ (선발 가격 적용)
- 5월 이후 출발건 발권 마감은 출발 21일전 기준 (랜드사 협의)
- 인원 미충족시 추가금액 발생 또는 조인행사
- 실속/노팁노옵션/디너크루즈 출확 6명 / 크루즈1박·사파 출확 8명/6명`;

// ─── meta 공통 ───────────────────────────────────────────
const META = {
  airline: '베트남항공',
  flight_out: 'VN429',
  flight_in: 'VN428',
  departure_airport: '부산(김해)',
  arrival_airport: '하노이(노이바이)',
  flight_out_dep_time: '11:00',
  flight_out_arr_time: '13:15',
  flight_in_dep_time: '01:15',
  flight_in_arr_time: '07:05',
};

// ─── 1. 실속 ────────────────────────────────────────────
function buildSilsok() {
  return {
    title: '[VN] 베트남 하노이/하롱베이/옌뜨or메가or닌빈 3박5일 ☑실속',
    destination: '하노이/하롱베이',
    country: '베트남',
    duration: 5,
    nights: 3,
    product_type: '실속',
    airline: '베트남항공',
    departure_airport: '부산(김해)',
    min_participants: 6,
    raw_text: RAW_TEXT,
    price_dates: buildPriceDates('실속'),
    accommodations: ['므엉탄 하노이 OR 동급 (4성)', '마리나 하롱 OR 동급 (4성)'],
    product_summary: '하롱베이 선상크루즈 + 옌뜨/메가/닌빈 택1 자유선택 + 마사지 1시간까지 핵심만 담은 4성 실속 패키지!',
    product_highlights: [
      '하롱베이 선상크루즈 + 티톱 전망대',
      '옌뜨/메가/닌빈 택1 (합행사 불가)',
      '전신 마사지 1시간 1회',
      '4성호텔',
    ],
    inclusions: [
      '왕복 항공료',
      '호텔',
      '차량',
      '전일정 식사',
      '한국인가이드',
      '현지인가이드',
      '관광지 입장료',
      '하롱베이 선상크루즈',
      '선상식',
      '티톱 전망대 관람',
      '옌뜨공원 케이블카 OR 메가그랜드월드 곤돌라(편도) OR 닌빈 땀꼭 삼판배 (택1)',
      '전신 마사지 1시간 (팁별도-1인/$5)',
      '하노이 시내관광 (호치민생가·바딘광장·한기둥사원 등)',
      '호안끼엠 호수 + 36거리 + 스트릿카 체험',
      '특식: 선상식 / 삼겹살 / 분짜정식 / 옌뜨 정식',
      '특전: 망고도시락 / 위즐커피 / 커피핀 (룸당 1개)',
    ],
    excludes: [
      '기사&가이드 팁 1인 $50 (성인·소인 동일)',
      '선택관광 및 개인 비용',
      '마사지팁 및 매너팁 (하노이 60분 $5/90분 $6/120분 $7, 하롱 60분 $4/90분 $5/120분 $7)',
      '싱글차지 1인 3박 9만원 (희망시)',
    ],
    surcharges: [],
    optional_tours: [
      { name: '하롱테마파크 해상케이블카 + 대관람차 + 젠 가든 (하롱베이)', price: '$50/인', region: '하롱베이' },
      { name: '전신 마사지 2시간 (하롱베이)', price: '$40/인 (팁 $7별도)', region: '하롱베이' },
      { name: '비경투어 + 스피드보트 + 항루언 (하롱베이)', price: '$50/인', region: '하롱베이' },
      { name: '활어회 (하롱베이)', price: '$30/인', region: '하롱베이' },
      { name: '씨푸드 (하롱베이)', price: '$30/인', region: '하롱베이' },
      { name: '전신 마사지 1시간 (하노이)', price: '$20/인 (팁별도)', region: '하노이' },
      { name: '전신 마사지 2시간 (하노이)', price: '$40/인 (팁별도)', region: '하노이' },
      { name: '하노이 야간시티투어', price: '$40/인', region: '하노이' },
      { name: '드마리스뷔페 & 센뷔페 (하노이)', price: '$50/인', region: '하노이' },
    ],
    customer_notes: COMMON_CUSTOMER_NOTES,
    internal_notes: COMMON_INTERNAL_NOTES + '\n- 싱글차지 1인 3박 9만원 (실속)\n- 일정 미참여시 패널티 1인 $100/1박당',
    notices_parsed: [
      { type: 'INFO', text: '쇼핑센터 - 침향 & 커피 & 잡화 (총 3회 방문)' },
      { type: 'POLICY', text: '일정 미참여시 패널티 1인 $100/1박당 적용' },
      { type: 'CRITICAL', text: '하롱베이 기상 악화시 대체 일정 진행될 수 있으며, 선상투어시 발이 편한 운동화로 챙겨주세요 (슬리퍼·샌들X)' },
      { type: 'CRITICAL', text: '미성년자(만 14세 미만) 베트남 입국 시 영문 가족관계증명서 필수 (부모 중 1명만 여행해도 적용)' },
      { type: 'CRITICAL', text: '여권 유효기간은 반드시 6개월 이상 남아 있어야 합니다' },
      { type: 'CRITICAL', text: '25.1.1부터 베트남 입국시 전자담배(액상·가열·궐련형 전부) 반입 금지. 소지·사용시 압수+벌금 약 50만동~300만동' },
      { type: 'INFO', text: '하노이 출퇴근 시간 29인승 이상 차량 통제로 해당 시간에는 16인승 차량으로 나누어 행사 진행됩니다' },
      { type: 'INFO', text: '한국인 가이드 단속 강화로 현지인 가이드가 공항 미팅 및 샌딩 진행' },
    ],
    itinerary_data: {
      meta: META,
      highlights: {
        inclusions: ['왕복항공료', '4성호텔', '전일정 식사', '하롱베이 선상크루즈', '옌뜨/메가/닌빈 택1', '마사지 1시간'],
        excludes: ['가이드/기사팁 $50', '마사지팁', '싱글차지 9만원'],
        shopping: '쇼핑센터 3회 (침향·커피·잡화)',
        remarks: [
          '인원 미달시 추가금 또는 조인행사',
          '하롱베이 기상 악화시 대체 일정',
          '한국인 가이드는 시내 동행, 공항은 현지인 가이드 미팅',
        ],
      },
      days: [
        {
          day: 1,
          regions: ['부산', '하노이'],
          schedule: [
            normal('08:00', '김해 국제공항 집결 후 출국 수속'),
            flight('11:00', '부산(김해) 출발 → 하노이(노이바이) 도착 13:15 (VN429)'),
            normal('13:10', '하노이 공항 도착 후 현지 가이드 미팅 / 한국인 가이드 미팅 후 시내로 이동'),
            normal(null, '▶하노이 시내관광 (호치민생가·한기둥사원·바딘광장 등)', '매주 월/금 호치민생가·박물관 휴관시 옥산사로 대체'),
            normal(null, '호텔 투숙 및 휴식'),
          ],
          meals: meal(true, true, true, '기내식', '쌀국수', '한식 (제육볶음)'),
          hotel: { name: '므엉탄 하노이 OR 동급', grade: '4성' },
        },
        {
          day: 2,
          regions: ['하노이', '옌뜨 OR 메가월드 OR 닌빈', '하롱베이'],
          schedule: [
            normal(null, '호텔 조식 후 가이드 미팅'),
            normal(null, '[택1] ▶옌뜨 국립공원 케이블카 (베트남 최고의 왕들이 보살핀다는 명산·약 2시간 이동)'),
            normal(null, '[택2] ▶메가그랜드월드 + 곤돌라 체험(편도) (베트남의 베네치아·약 1시간 30분 이동)'),
            normal(null, '[택3] ▶닌빈 땀꼭 삼판배 (육지의 하롱베이·약 1시간 30분 이동)', '택1·2·3 중 선택, 합행사 불가'),
            normal(null, '중식 후 유네스코 세계자연유산 하롱베이로 이동'),
            normal(null, '▶하롱베이 도착 후 콩카페 OR 하이랜드 커피 시음'),
            normal(null, '호텔 투숙 및 휴식'),
            optional(null, '추천 선택관광: 하롱테마파크 해상케이블카+대관람차+젠 가든 $50 / 전신 마사지 2시간 $40 (팁 $7별도)'),
          ],
          meals: meal(true, true, true, '호텔식', '현지식', '한식 (샤브샤브)'),
          hotel: { name: '마리나 하롱 OR 동급', grade: '4성' },
        },
        {
          day: 3,
          regions: ['하롱베이'],
          schedule: [
            normal(null, '호텔 조식 후 가이드 미팅'),
            normal(null, '영화 굿모닝 베트남의 배경 ▶하롱베이 선착장으로 이동'),
            normal(null, '▶기암괴석으로 이루어진 석회동굴 감상 (하늘문·용모양 궁전기둥·선녀탕 등)'),
            normal(null, '▶선상 중식 후 티톱섬 전망대 등정 (전경 감상)'),
            normal(null, '선착장 귀환 후 삼겹살 석식'),
            normal(null, '호텔 투숙 및 휴식'),
            optional(null, '추천 선택관광: 비경투어+스피드보트+항루언 $50 / 활어회 $30 / 씨푸드 $30'),
          ],
          meals: meal(true, true, true, '호텔식', '선상식', '삼겹살'),
          hotel: { name: '마리나 하롱 OR 동급', grade: '4성' },
        },
        {
          day: 4,
          regions: ['하롱베이', '하노이'],
          schedule: [
            normal(null, '호텔 조식 후 CHECK-OUT / 하노이로 이동 (약 3시간)'),
            shopping(null, '쇼핑센터 방문 (침향·커피·잡화)'),
            normal(null, '▶호안끼엠 호수 주변 + 여행자의 거리 + 스트릿카 체험', '팁 $1별도'),
            normal(null, '▶전신 마사지 1시간 체험', '팁 1인 $5별도'),
            normal(null, '석식 후 선택관광 또는 자유시간'),
            normal(null, '공항 이동 후 개별 출국 수속 (공항 내 한국인 가이드 출입 불가)'),
            optional(null, '추천 선택관광: 마사지 1시간 $20 / 2시간 $40 / 하노이 야간시티투어 $40 / 드마리스뷔페 & 센뷔페 $50'),
          ],
          meals: meal(true, true, true, '호텔식', '현지식', '한식'),
          hotel: null,
        },
        {
          day: 5,
          regions: ['하노이', '부산'],
          schedule: [
            flight('01:15', '하노이(노이바이) 출발 → 부산(김해) 도착 07:05 (VN428)'),
            normal('07:05', '부산 김해 국제공항 도착 (즐거운 여행이 되셨기를 바랍니다)'),
          ],
          meals: meal(true, false, false, '기내식'),
          hotel: null,
        },
      ],
    },
    agent_audit_report: {
      parser_version: 'register-v2026.04.21-sonnet-4.6',
      ran_at: new Date().toISOString(),
      claims: [
        { id: 'min_participants', field: 'min_participants', severity: 'HIGH',
          text: '6명부터 출확', evidence: '원문 [실속] 인원: "6명부터 출확 / 미달출발시 추가금액 발생"', supported: true },
        { id: 'ticketing_deadline', field: 'ticketing_deadline', severity: 'HIGH',
          text: '2026-04-28', evidence: '원문 헤더: "★ 4/28일까지 선발 조건 ★"', supported: true },
        { id: 'product_type:실속', field: 'product_type', severity: 'HIGH',
          text: '실속', evidence: '원문 제목: "[VN] 베트남 하노이/하롱베이/옌뜨or메가or닌빈 3박5일 ☑실속"', supported: true },
        { id: 'hotel_grade', field: 'accommodations[0]', severity: 'CRITICAL',
          text: '므엉탄 하노이 OR 동급 (4성)', evidence: '원문 [실속] Day1: "HOTEL : 므엉탄 하노이 OR 동급 (4성)"', supported: true },
        { id: 'tip_excludes', field: 'excludes[0]', severity: 'HIGH',
          text: '기사&가이드 팁 1인 $50', evidence: '원문 [실속] 불포함: "기사&가이드 팁 1인 $50 – 성인, 소인 동일"', supported: true },
        { id: 'massage_inclusion', field: 'inclusions', severity: 'CRITICAL',
          text: '전신 마사지 1시간', evidence: '원문 [실속] 포함: "전신 마사지 1시간 (팁별도-1인/$5)"', supported: true },
        { id: 'option_choice', field: 'inclusions', severity: 'HIGH',
          text: '옌뜨/메가/닌빈 택1', evidence: '원문 [실속] 포함: "옌뜨공원 케이블카 탑승 OR 메가그랜드월드 방문 + 곤돌라체험 (택 1)" + Day2: "택1)/택2)/택3)"', supported: true },
      ],
      overall_verdict: 'clean',
      unsupported_critical: 0,
      unsupported_high: 0,
    },
  };
}

// ─── 2. 노팁노옵션 ──────────────────────────────────────
function buildNoNo() {
  return {
    title: '[VN] 베트남 하노이/하롱/옌뜨or메가or닌빈 3박5일 ☑노팁노옵션',
    destination: '하노이/하롱베이',
    country: '베트남',
    duration: 5,
    nights: 3,
    product_type: '노팁노옵션',
    airline: '베트남항공',
    departure_airport: '부산(김해)',
    min_participants: 6,
    raw_text: RAW_TEXT,
    price_dates: buildPriceDates('노팁노옵션'),
    accommodations: [
      '모벤픽 리빙 웨스트 하노이 / 두짓 하노이 / 쉐라톤 하노이 웨스트 OR 동급 (5성)',
      '델라씨 하롱베이 / 드리오로 / 윈덤 레전드 하롱 OR 동급 (5성)',
    ],
    product_summary: '5성호텔 + 가이드/기사팁 포함 + 비경투어 + 마사지 90분 2회까지! 추가비용 부담 없는 하롱·하노이 노팁노옵션 풀패키지.',
    product_highlights: [
      '5성호텔 (모벤픽·두짓·쉐라톤·델라씨)',
      '하롱베이 선상크루즈+비경투어 (씨푸드 선상식)',
      '하롱테마파크 해상케이블카+젠가든+대관람차',
      '마사지 90분 2회',
    ],
    inclusions: [
      '호텔',
      '차량',
      '전일정 식사',
      '한국인가이드',
      '현지인가이드',
      '관광지 입장료',
      '가이드 및 기사팁',
      '옌뜨국립공원 케이블카',
      '하롱테마파크 (해상 케이블카+젠가든+대관람차)',
      '하롱베이 선상크루즈',
      '티톱 전망대 관람',
      '비경투어 (스피드보트+항루언)',
      '선상식 (씨푸드 포함)',
      '선장팁',
      '하롱베이 전신 마사지 90분',
      '하노이 전신 마사지 90분',
      '하노이 시내관광 (호치민생가·바딘광장·한기둥사원 등)',
      '호안끼엠 호수 + 36거리 + 스트릿카 체험',
      '콩까페 OR 하이랜드 커피시음',
      '특식: 선상식(씨푸드) / 삼겹살 / 현지식 / 월남쌈정식(소담소담) / 드마리스 뷔페',
      '특전: 망고도시락 / 위즐커피 / 커피핀 (룸당 1개)',
    ],
    excludes: [
      '마사지팁 및 매너팁 (하노이 60분 $5/90분 $6/120분 $7, 하롱 60분 $4/90분 $5/120분 $7)',
      '싱글차지 1인 3박 16만원 (희망시)',
    ],
    surcharges: [],
    optional_tours: [],
    customer_notes: COMMON_CUSTOMER_NOTES,
    internal_notes: COMMON_INTERNAL_NOTES + '\n- 싱글차지 1인 3박 16만원 (노팁노옵션)\n- 일정 미참여시 패널티 1인 $100/1박당',
    notices_parsed: [
      { type: 'INFO', text: '쇼핑센터 - 침향 & 커피 & 잡화 (총 3회 방문)' },
      { type: 'POLICY', text: '일정 미참여시 패널티 1인 $100/1박당 적용' },
      { type: 'CRITICAL', text: '하롱베이 기상 악화시 대체 일정 진행될 수 있으며, 선상투어시 발이 편한 운동화로 챙겨주세요 (슬리퍼·샌들X)' },
      { type: 'CRITICAL', text: '미성년자(만 14세 미만) 베트남 입국 시 영문 가족관계증명서 필수 (부모 중 1명만 여행해도 적용)' },
      { type: 'CRITICAL', text: '여권 유효기간은 반드시 6개월 이상 남아 있어야 합니다' },
      { type: 'CRITICAL', text: '25.1.1부터 베트남 입국시 전자담배(액상·가열·궐련형 전부) 반입 금지. 소지·사용시 압수+벌금 약 50만동~300만동' },
      { type: 'INFO', text: '하노이 출퇴근 시간 29인승 이상 차량 통제로 해당 시간에는 16인승 차량으로 나누어 행사 진행됩니다' },
      { type: 'INFO', text: '한국인 가이드 단속 강화로 현지인 가이드가 공항 미팅 및 샌딩 진행' },
    ],
    itinerary_data: {
      meta: META,
      highlights: {
        inclusions: ['왕복항공료', '5성호텔', '가이드/기사팁 포함', '하롱 선상크루즈+비경투어', '하롱테마파크', '마사지 90분 2회'],
        excludes: ['마사지팁', '싱글차지 16만원'],
        shopping: '쇼핑센터 3회 (침향·커피·잡화)',
        remarks: [
          '인원 미달시 추가금 또는 조인행사',
          '하롱베이 기상 악화시 대체 일정',
          '한국인 가이드는 시내 동행, 공항은 현지인 가이드 미팅',
        ],
      },
      days: [
        {
          day: 1,
          regions: ['부산', '하노이'],
          schedule: [
            normal('08:00', '김해 국제공항 집결 후 출국 수속'),
            flight('11:00', '부산(김해) 출발 → 하노이(노이바이) 도착 13:15 (VN429)'),
            normal('13:10', '하노이 공항 도착 후 현지 가이드 미팅 / 한국인 가이드 미팅 후 시내로 이동'),
            normal(null, '▶하노이 시내관광 (호치민생가·한기둥사원·바딘광장 등)', '매주 월/금 호치민생가·박물관 휴관시 옥산사로 대체'),
            normal(null, '▶하노이 맥주거리 체험 (맥주 1인 1잔 제공)'),
            normal(null, '호텔 투숙 및 휴식'),
          ],
          meals: meal(true, true, true, '기내식', '쌀국수', '한식 (제육볶음)'),
          hotel: { name: '모벤픽 리빙 웨스트 하노이 / 두짓 하노이 / 쉐라톤 하노이 웨스트 OR 동급', grade: '5성' },
        },
        {
          day: 2,
          regions: ['하노이', '옌뜨 OR 메가월드 OR 닌빈', '하롱베이'],
          schedule: [
            normal(null, '호텔 조식 후 가이드 미팅'),
            normal(null, '[택1] ▶옌뜨 국립공원 케이블카 (약 2시간 이동)'),
            normal(null, '[택2] ▶메가그랜드월드 + 곤돌라 체험(편도) (약 1시간 30분 이동)'),
            normal(null, '[택3] ▶닌빈 땀꼭 삼판배 (약 1시간 30분 이동)', '택1·2·3 중 선택, 합행사 불가'),
            normal(null, '중식 후 유네스코 세계자연유산 하롱베이로 이동'),
            normal(null, '▶하롱베이 도착 후 콩카페 OR 하이랜드 커피 시음'),
            normal(null, '▶하롱베이 전신 마사지 90분 체험', '팁별도'),
            normal(null, '호텔 투숙 및 휴식'),
          ],
          meals: meal(true, true, true, '호텔식', '현지식', '한식 (샤브샤브)'),
          hotel: { name: '델라씨 하롱베이 / 드리오로 / 윈덤 레전드 하롱 OR 동급', grade: '5성' },
        },
        {
          day: 3,
          regions: ['하롱베이'],
          schedule: [
            normal(null, '호텔 조식 후 가이드 미팅'),
            normal(null, '영화 굿모닝 베트남의 배경 ▶하롱베이 선착장으로 이동'),
            normal(null, '▶기암괴석으로 이루어진 석회동굴 감상 (하늘문·용모양 궁전기둥·선녀탕 등)'),
            normal(null, '▶선상 중식 (씨푸드 포함) 후 티톱섬 전망대 등정'),
            normal(null, '▶007영화 촬영지 항루원 비경관광 (스피드보트)'),
            normal(null, '선착장 귀환 후 ▶하롱테마파크 (해상 케이블카+젠가든+대관람차)'),
            normal(null, '호텔 투숙 및 휴식'),
          ],
          meals: meal(true, true, true, '호텔식', '선상식 (씨푸드)', '삼겹살'),
          hotel: { name: '델라씨 하롱베이 / 드리오로 / 윈덤 레전드 하롱 OR 동급', grade: '5성' },
        },
        {
          day: 4,
          regions: ['하롱베이', '하노이'],
          schedule: [
            normal(null, '호텔 조식 후 CHECK-OUT / 하노이로 이동 (약 3시간)'),
            shopping(null, '쇼핑센터 방문 (침향·커피·잡화)'),
            normal(null, '▶호안끼엠 호수 + 여행자의 거리 + 스트릿카 체험', '팁 $1별도'),
            normal(null, '▶하노이 전신 마사지 90분 체험', '팁별도'),
            normal(null, '석식 후 ▶하노이 롯데 전망대 관람'),
            normal(null, '공항 이동 후 개별 출국 수속'),
          ],
          meals: meal(true, true, true, '호텔식', '현지식', '드마리스 뷔페'),
          hotel: null,
        },
        {
          day: 5,
          regions: ['하노이', '부산'],
          schedule: [
            flight('01:15', '하노이(노이바이) 출발 → 부산(김해) 도착 07:05 (VN428)'),
            normal('07:05', '부산 김해 국제공항 도착'),
          ],
          meals: meal(true, false, false, '기내식'),
          hotel: null,
        },
      ],
    },
    agent_audit_report: {
      parser_version: 'register-v2026.04.21-sonnet-4.6',
      ran_at: new Date().toISOString(),
      claims: [
        { id: 'min_participants', field: 'min_participants', severity: 'HIGH',
          text: '6명부터 출확', evidence: '원문 [노팁노옵션]: "6명부터 출확 / 미달출발시 추가금액 발생"', supported: true },
        { id: 'tip_included', field: 'inclusions', severity: 'CRITICAL',
          text: '가이드/기사팁 포함', evidence: '원문 [노팁노옵션] 포함: "가이드 및 기사팁"', supported: true },
        { id: 'hotel_grade', field: 'accommodations', severity: 'CRITICAL',
          text: '5성호텔', evidence: '원문 [노팁노옵션] Day1: "모벤픽 리빙 웨스트 하노이 / 두짓 하노이 / 쉐라톤 하노이 웨스트 OR 동급 (5성)"', supported: true },
        { id: 'beer_street', field: 'days[0].schedule', severity: 'HIGH',
          text: '하노이 맥주거리 체험', evidence: '원문 [노팁노옵션] Day1: "하노이 맥주거리 체험 (맥주 1인 1잔 제공)"', supported: true },
        { id: 'massage_2x', field: 'inclusions', severity: 'CRITICAL',
          text: '마사지 90분 2회', evidence: '원문: "하롱베이 전신 마사지 90분 + 하노이 전신 마사지 90분"', supported: true },
        { id: 'theme_park', field: 'inclusions', severity: 'HIGH',
          text: '하롱테마파크', evidence: '원문 [노팁노옵션] 포함: "하롱테마파크 관광 (해상 케이블카＋젠가든+대관람차 체험)"', supported: true },
      ],
      overall_verdict: 'clean',
      unsupported_critical: 0,
      unsupported_high: 0,
    },
  };
}

// ─── 3. 디너크루즈 ──────────────────────────────────────
function buildDinnerCruise() {
  return {
    title: '[VN] 베트남 하노이/하롱/옌뜨or메가 ★럭셔리 5성 디너크루즈★ 3박5일 ☑노팁노옵션',
    destination: '하노이/하롱베이',
    country: '베트남',
    duration: 5,
    nights: 3,
    product_type: '노팁노옵션 (디너크루즈)',
    airline: '베트남항공',
    departure_airport: '부산(김해)',
    min_participants: 6,
    raw_text: RAW_TEXT,
    price_dates: buildPriceDates('디너크루즈'),
    accommodations: [
      '모벤픽 리빙 웨스트 하노이 / 두짓 하노이 / 쉐라톤 하노이 웨스트 OR 동급 (5성)',
      '델라씨 하롱베이 / 드리오로 / 윈덤 레전드 하롱 OR 동급 (5성)',
    ],
    product_summary: '5성 디너크루즈에서 즐기는 하롱의 야경·뷔페·불꽃쇼! 옌뜨 OR 메가 + 비경투어까지 모든 것이 들어간 럭셔리 노노 패키지.',
    product_highlights: [
      '5성 디너크루즈 (엠버서더 OR 루나)',
      '하롱 비경투어 + 하롱테마파크',
      '옌뜨 OR 메가 택1',
      '5성호텔 + 마사지 90분 + 60분',
    ],
    inclusions: [
      '호텔',
      '차량',
      '전일정 식사',
      '한국인가이드',
      '현지인가이드',
      '관광지 입장료',
      '가이드 및 기사팁',
      '하롱베이 5성급 디너크루즈 (엠버서더 OR 루나)',
      '옌뜨국립공원 케이블카 OR 메가그랜드월드 곤돌라(편도) (택1)',
      '하롱베이 선상크루즈',
      '티톱 전망대 관람',
      '비경투어 (스피드보트+항루언)',
      '선상식 (씨푸드 포함)',
      '선장팁',
      '하롱테마파크 (해상 케이블카+젠가든+대관람차)',
      '하노이 시내관광 (호치민생가·바딘광장·한기둥사원 등)',
      '하롱베이 전신 마사지 90분',
      '하노이 전신 마사지 60분',
      '호안끼엠 호수 + 36거리 + 스트릿카 체험',
      '콩까페 OR 하이랜드 커피시음',
      '특식: 디너크루즈뷔페 / 선상식(씨푸드) / 삼겹살 / 현지식 / 월남쌈정식(소담소담) / 드마리스 뷔페',
      '특전: 망고도시락 / 위즐커피 / 커피핀 (룸당 1개)',
    ],
    excludes: [
      '마사지팁 및 매너팁',
      '싱글차지 1인 3박 16만원 (희망시)',
    ],
    surcharges: [],
    optional_tours: [],
    customer_notes: COMMON_CUSTOMER_NOTES,
    internal_notes: COMMON_INTERNAL_NOTES + '\n- 싱글차지 1인 3박 16만원 (디너크루즈)\n- 일정 미참여시 패널티 1인 $100/1박당',
    notices_parsed: [
      { type: 'INFO', text: '쇼핑센터 - 침향 & 커피 & 잡화 (총 3회 방문)' },
      { type: 'POLICY', text: '일정 미참여시 패널티 1인 $100/1박당 적용' },
      { type: 'CRITICAL', text: '하롱베이 기상 악화시 대체 일정 진행될 수 있으며, 선상투어시 발이 편한 운동화로 챙겨주세요 (슬리퍼·샌들X)' },
      { type: 'CRITICAL', text: '미성년자(만 14세 미만) 베트남 입국 시 영문 가족관계증명서 필수' },
      { type: 'CRITICAL', text: '여권 유효기간은 반드시 6개월 이상 남아 있어야 합니다' },
      { type: 'CRITICAL', text: '25.1.1부터 베트남 입국시 전자담배 반입 금지' },
      { type: 'INFO', text: '하노이 출퇴근 시간 29인승 이상 차량 통제로 16인승 분리 진행' },
      { type: 'INFO', text: '한국인 가이드 단속 강화로 현지인 가이드가 공항 미팅 및 샌딩 진행' },
    ],
    itinerary_data: {
      meta: META,
      highlights: {
        inclusions: ['왕복항공료', '5성호텔', '5성 디너크루즈', '비경투어', '하롱테마파크', '마사지 90+60분', '가이드/기사팁'],
        excludes: ['마사지팁', '싱글차지 16만원'],
        shopping: '쇼핑센터 3회 (침향·커피·잡화)',
        remarks: [
          '인원 미달시 추가금 또는 조인행사',
          '하롱베이 기상 악화시 대체 일정',
          '디너크루즈는 엠버서더 OR 루나 중 현지 배정',
        ],
      },
      days: [
        {
          day: 1,
          regions: ['부산', '하노이'],
          schedule: [
            normal('08:00', '김해 국제공항 집결 후 출국 수속'),
            flight('11:00', '부산(김해) 출발 → 하노이(노이바이) 도착 13:15 (VN429)'),
            normal('13:10', '하노이 공항 도착 후 현지 가이드 미팅 / 한국인 가이드 미팅 후 시내로 이동'),
            normal(null, '▶하노이 시내관광 (호치민생가·한기둥사원·바딘광장 등)', '매주 월/금 호치민생가·박물관 휴관시 옥산사로 대체'),
            normal(null, '▶하노이 맥주거리 체험 (맥주 1인 1잔 제공)'),
            normal(null, '호텔 투숙 및 휴식'),
          ],
          meals: meal(true, true, true, '기내식', '쌀국수', '한식 (제육볶음)'),
          hotel: { name: '모벤픽 리빙 웨스트 하노이 / 두짓 하노이 / 쉐라톤 하노이 웨스트 OR 동급', grade: '5성' },
        },
        {
          day: 2,
          regions: ['하노이', '옌뜨 OR 메가월드', '하롱베이'],
          schedule: [
            normal(null, '호텔 조식 후 가이드 미팅'),
            normal(null, '[택1] ▶옌뜨 국립공원 케이블카 (약 2시간 이동)'),
            normal(null, '[택2] ▶메가그랜드월드 + 곤돌라 체험(편도) (약 1시간 30분 이동)', '택1·2 중 선택, 합행사 불가'),
            normal(null, '중식 후 유네스코 세계자연유산 하롱베이로 이동'),
            normal(null, '▶하롱베이 전신 마사지 90분 체험', '팁별도'),
            normal('18:00', '★5성급 디너크루즈 탑승 (엠버서더 OR 루나) — 하롱 시티 LED 조명·바이차이 대교 감상'),
            normal('18:30', '▶디너크루즈 럭셔리 레스토랑 프리미엄 뷔페식사'),
            normal('19:45', '하이라이트 \'러브 인더 베이\' 무대 공연 관람'),
            normal('20:15', '▶썬데크 스페셜 불꽃쇼 관람'),
            normal('20:45', '크루즈 터미널 도착 및 하선 / 호텔 귀환 및 자유시간'),
          ],
          meals: meal(true, true, true, '호텔식', '현지식', '디너크루즈 뷔페'),
          hotel: { name: '델라씨 하롱베이 / 드리오로 / 윈덤 레전드 하롱 OR 동급', grade: '5성' },
        },
        {
          day: 3,
          regions: ['하롱베이'],
          schedule: [
            normal(null, '호텔 조식 후 가이드 미팅'),
            normal(null, '영화 굿모닝 베트남의 배경 ▶하롱베이 선착장으로 이동'),
            normal(null, '▶기암괴석 석회동굴 감상 (하늘문·용모양 궁전기둥·선녀탕 등)'),
            normal(null, '▶선상 중식(씨푸드 포함) 후 티톱섬 전망대 등정'),
            normal(null, '▶007영화 촬영지 항루원 비경관광 (스피드보트)'),
            normal(null, '선착장 귀환 후 ▶하롱테마파크 (해상 케이블카+젠가든+대관람차)'),
            normal(null, '호텔 투숙 및 휴식'),
          ],
          meals: meal(true, true, true, '호텔식', '선상식 (씨푸드)', '삼겹살'),
          hotel: { name: '델라씨 하롱베이 / 드리오로 / 윈덤 레전드 하롱 OR 동급', grade: '5성' },
        },
        {
          day: 4,
          regions: ['하롱베이', '하노이'],
          schedule: [
            normal(null, '호텔 조식 후 CHECK-OUT / 하노이로 이동 (약 3시간)'),
            shopping(null, '쇼핑센터 방문 (침향·커피·잡화)'),
            normal(null, '▶호안끼엠 호수 + 여행자의 거리 + 스트릿카 체험', '팁 $1별도'),
            normal(null, '▶콩카페 OR 하이랜드 커피 시음'),
            normal(null, '▶하노이 전신 마사지 60분 체험', '팁별도'),
            normal(null, '석식 후 ▶하노이 롯데 전망대 관람'),
            normal(null, '공항 이동 후 개별 출국 수속'),
          ],
          meals: meal(true, true, true, '호텔식', '현지식', '드마리스 뷔페'),
          hotel: null,
        },
        {
          day: 5,
          regions: ['하노이', '부산'],
          schedule: [
            flight('01:15', '하노이(노이바이) 출발 → 부산(김해) 도착 07:05 (VN428)'),
            normal('07:05', '부산 김해 국제공항 도착'),
          ],
          meals: meal(true, false, false, '기내식'),
          hotel: null,
        },
      ],
    },
    agent_audit_report: {
      parser_version: 'register-v2026.04.21-sonnet-4.6',
      ran_at: new Date().toISOString(),
      claims: [
        { id: 'dinner_cruise', field: 'inclusions', severity: 'CRITICAL',
          text: '5성 디너크루즈 (엠버서더 OR 루나)', evidence: '원문 [디너크루즈] Day2: "★★5성급 디너크루즈 탑승 ( 엠버서더 OR 루나 크루즈 )"', supported: true },
        { id: 'option_choice', field: 'inclusions', severity: 'HIGH',
          text: '옌뜨 OR 메가 택1 (닌빈 없음)', evidence: '원문 [디너크루즈] Day2: "택1) 옌뜨 / 택2) 메가그랜드월드 / 택1,2 중 선택"', supported: true },
        { id: 'massage_90_60', field: 'inclusions', severity: 'CRITICAL',
          text: '하롱 90분 + 하노이 60분', evidence: '원문 [디너크루즈] 포함: "하롱베이 전신 마사지 90분 + 하노이 전신 마사지 60분"', supported: true },
        { id: 'min_participants', field: 'min_participants', severity: 'HIGH',
          text: '6명부터 출확', evidence: '원문 [디너크루즈]: "6명부터 출확"', supported: true },
      ],
      overall_verdict: 'clean',
      unsupported_critical: 0,
      unsupported_high: 0,
    },
  };
}

// ─── 4. 크루즈1박 ───────────────────────────────────────
function buildCruise1Night() {
  return {
    title: '[VN] 베트남 하노이/하롱/옌뜨 ★럭셔리 5성 하롱베이 크루즈숙박★ 3박5일 ☑노팁노옵션',
    destination: '하노이/하롱베이',
    country: '베트남',
    duration: 5,
    nights: 3,
    product_type: '노팁노옵션 (크루즈숙박)',
    airline: '베트남항공',
    departure_airport: '부산(김해)',
    min_participants: 8,
    raw_text: RAW_TEXT,
    price_dates: buildPriceDates('크루즈1박'),
    accommodations: [
      '델라씨 하롱베이 / 드리오로 / 윈덤 레전드 하롱 OR 동급 (5성)',
      '하롱베이 럭셔리 크루즈 5성 (엠버서더 / 파라다이스 / 라무르 / 옥토퍼스 OR 동급)',
    ],
    product_summary: '하롱베이 5성 럭셔리 크루즈에서 보내는 하룻밤! 유네스코 세계자연유산을 가장 가까이서 즐기는 프리미엄 크루즈숙박 패키지.',
    product_highlights: [
      '하롱베이 5성 크루즈 선상숙박 1박',
      '옌뜨국립공원 케이블카',
      '비경투어 (스피드보트+항루언)',
      '마사지 2시간 1회',
    ],
    inclusions: [
      '호텔',
      '차량',
      '전일정 식사',
      '한국인가이드',
      '현지인가이드',
      '관광지 입장료',
      '가이드 및 기사팁',
      '하롱베이 5성 크루즈 선상숙박 1박',
      '옌뜨국립공원 케이블카',
      '하롱베이 티톱 전망대 관람',
      '비경투어 (스피드보트+항루언)',
      '선장팁',
      '하노이 시내관광 (호치민생가·바딘광장·한기둥사원 등)',
      '전신 마사지 2시간 1회 (팁별도-1인/$7)',
      '호안끼엠 호수 + 36거리 + 스트릿카 체험',
      '콩까페 OR 하이랜드 커피시음',
      '특식: 5성 크루즈 선상식 2회 / 드마리스 뷔페',
      '특전: 망고도시락 + 위즐커피 + 커피핀 (룸당 1개)',
    ],
    excludes: [
      '마사지팁 및 매너팁',
      '써차지',
      '싱글차지 1인 3박 28만원 (희망시)',
    ],
    surcharges: [],
    optional_tours: [],
    customer_notes: COMMON_CUSTOMER_NOTES,
    internal_notes: COMMON_INTERNAL_NOTES + '\n- 싱글차지 1인 3박 28만원 (크루즈숙박)\n- 일정 미참여시 패널티 1인 $100/1박당\n- 출확 8명 (다른 상품보다 높음)\n- 써차지 별도 (원문에 명시되어 있으나 금액 표기 없음 — 랜드사 협의 필요)',
    notices_parsed: [
      { type: 'INFO', text: '쇼핑센터 - 침향 & 커피 & 잡화 (총 3회 방문)' },
      { type: 'POLICY', text: '일정 미참여시 패널티 1인 $100/1박당 적용' },
      { type: 'CRITICAL', text: '하롱베이 기상 악화시 대체 일정 진행될 수 있으며, 선상투어시 발이 편한 운동화로 챙겨주세요 (슬리퍼·샌들X)' },
      { type: 'CRITICAL', text: '미성년자(만 14세 미만) 베트남 입국 시 영문 가족관계증명서 필수' },
      { type: 'CRITICAL', text: '여권 유효기간은 반드시 6개월 이상 남아 있어야 합니다' },
      { type: 'CRITICAL', text: '25.1.1부터 베트남 입국시 전자담배 반입 금지' },
      { type: 'INFO', text: '성인 8명부터 출확 / 미달출발시 추가금액 발생' },
      { type: 'INFO', text: '하노이 출퇴근 시간 29인승 이상 차량 통제로 16인승 분리 진행' },
      { type: 'INFO', text: '한국인 가이드 단속 강화로 현지인 가이드가 공항 미팅 및 샌딩 진행' },
    ],
    itinerary_data: {
      meta: META,
      highlights: {
        inclusions: ['왕복항공료', '5성호텔 1박', '5성 크루즈 선상숙박 1박', '옌뜨 케이블카', '비경투어', '마사지 2시간', '가이드/기사팁'],
        excludes: ['마사지팁', '써차지', '싱글차지 28만원'],
        shopping: '쇼핑센터 3회 (침향·커피·잡화)',
        remarks: [
          '성인 8명부터 출확 / 미달출발시 추가금 발생',
          '하롱베이 기상 악화시 대체 일정',
          '크루즈는 엠버서더/파라다이스/라무르/옥토퍼스 등 동급 배정',
        ],
      },
      days: [
        {
          day: 1,
          regions: ['부산', '하노이', '하롱베이'],
          schedule: [
            normal('08:00', '김해 국제공항 집결 후 출국 수속'),
            flight('11:00', '부산(김해) 출발 → 하노이(노이바이) 도착 13:15 (VN429)'),
            normal('13:10', '하노이 국제공항 도착 후 현지 가이드 미팅'),
            normal(null, '한국인 가이드 미팅 후 중식'),
            normal(null, '▶하노이 시내관광 (호치민생가·한기둥사원·바딘광장 등)', '매주 월/금 호치민생가·박물관 휴관시 옥산사로 대체'),
            normal(null, '하롱베이로 이동 (약 3시간) — 농촌 전경 및 서민 생활상 감상'),
            normal(null, '호텔 투숙 및 휴식'),
          ],
          meals: meal(true, true, true, '기내식', '쌀국수', '한식 (제육볶음)'),
          hotel: { name: '델라씨 하롱베이 / 드리오로 / 윈덤 레전드 하롱 OR 동급', grade: '5성' },
        },
        {
          day: 2,
          regions: ['하롱베이', '옌뜨', '하롱베이'],
          schedule: [
            normal(null, '호텔 조식 후 가이드 미팅'),
            normal(null, '▶옌뜨 국립공원 케이블카 (약 2시간 이동, 베트남 최고의 왕들이 보살핀다는 명산)'),
            normal(null, '중식 후 영화 속 풍경 하롱베이로 이동'),
            normal(null, '▶콩카페 OR 하이랜드 커피 시음'),
            normal(null, '▶전신 마사지 2시간 체험', '팁별도'),
            normal(null, '호텔 투숙 및 휴식'),
          ],
          meals: meal(true, true, true, '호텔식', '현지식', '한식 (샤브샤브)'),
          hotel: { name: '델라씨 하롱베이 / 드리오로 / 윈덤 레전드 하롱 OR 동급', grade: '5성' },
        },
        {
          day: 3,
          regions: ['하롱베이'],
          schedule: [
            normal(null, '♡ 세계 7대 자연경관 하롱베이에서 보내는 럭셔리한 하룻밤'),
            normal(null, '호텔 조식 후 가이드 미팅'),
            normal(null, '영화 굿모닝베트남 배경 ▶하롱베이 선착장으로 이동'),
            normal(null, '★5성급 크루즈 탑승 — 승무원 환영인사 / 웰컴 드링크 / 오리엔테이션'),
            normal(null, '탁 트인 바다 전망 ▶크루즈 선상 중식'),
            normal(null, '▶유네스코 세계자연유산 하롱베이 신비로운 섬들 따라 크루즈 항해'),
            normal(null, '선셋 바다에서 크루즈 부대시설 자유 이용'),
            normal(null, '하롱베이 밤 풍경 감상 / 크루즈 선상숙박'),
          ],
          meals: meal(true, true, true, '호텔식', '크루즈 뷔페', '크루즈 디너'),
          hotel: { name: '하롱베이 럭셔리 크루즈 (엠버서더 / 파라다이스 / 라무르 / 옥토퍼스 OR 동급)', grade: '5성 크루즈' },
        },
        {
          day: 4,
          regions: ['하롱베이', '하노이'],
          schedule: [
            normal(null, '크루즈 조식 후 체크아웃 / 하노이로 이동 (약 3시간)'),
            shopping(null, '쇼핑센터 방문 (침향·커피·잡화)'),
            normal(null, '▶호안끼엠 호수 + 여행자의 거리 + 스트릿카 체험', '팁 $1별도'),
            normal(null, '석식 후 ▶하노이 롯데 전망대 관람'),
            normal(null, '공항 이동 후 개별 출국 수속'),
          ],
          meals: meal(true, true, true, '크루즈 조식', '현지식', '드마리스 뷔페'),
          hotel: null,
        },
        {
          day: 5,
          regions: ['하노이', '부산'],
          schedule: [
            flight('01:15', '하노이(노이바이) 출발 → 부산(김해) 도착 07:05 (VN428)'),
            normal('07:05', '부산 김해 국제공항 도착'),
          ],
          meals: meal(true, false, false, '기내식'),
          hotel: null,
        },
      ],
    },
    agent_audit_report: {
      parser_version: 'register-v2026.04.21-sonnet-4.6',
      ran_at: new Date().toISOString(),
      claims: [
        { id: 'cruise_overnight', field: 'accommodations[1]', severity: 'CRITICAL',
          text: '하롱 5성 크루즈 선상숙박', evidence: '원문 [크루즈숙박] Day3: "HOTEL : 하롱베이 럭셔리 크루즈 (5성 - 엠버서더 / 파라다이스 / 라무르 / 옥토퍼스 크루즈 OR 동급)"', supported: true },
        { id: 'min_participants_8', field: 'min_participants', severity: 'CRITICAL',
          text: '8명', evidence: '원문 [크루즈숙박] 인원: "성인 8명부터 출확 / 미달출발시 추가금액 발생"', supported: true },
        { id: 'massage_2h', field: 'inclusions', severity: 'CRITICAL',
          text: '마사지 2시간 1회', evidence: '원문 [크루즈숙박] 포함: "전신 마사지 2시간 (팁별도-1인/$7) 1회"', supported: true },
        { id: 'no_megaworld', field: 'days', severity: 'HIGH',
          text: '옌뜨만 (메가/닌빈 없음)', evidence: '원문 [크루즈숙박] Day2: "옌뜨 국립공원으로 이동" — 다른 옵션 없음', supported: true },
        { id: 'surcharge_excluded', field: 'excludes', severity: 'HIGH',
          text: '써차지 별도', evidence: '원문 [크루즈숙박] 불포함: "마사지팁 및 매너팁, 써차지"', supported: true },
      ],
      overall_verdict: 'clean',
      unsupported_critical: 0,
      unsupported_high: 0,
    },
  };
}

// ─── 5. 사파 ────────────────────────────────────────────
function buildSapa() {
  return {
    title: '[VN] 베트남 하노이/사파 3박5일 ☑노팁노옵션',
    destination: '하노이/사파',
    country: '베트남',
    duration: 5,
    nights: 3,
    product_type: '노팁노옵션 (사파)',
    airline: '베트남항공',
    departure_airport: '부산(김해)',
    min_participants: 6,
    raw_text: RAW_TEXT,
    price_dates: buildPriceDates('사파'),
    accommodations: [
      'KK 사파 / 파오스 OR 동급 (5성)',
      '모벤픽 리빙 웨스트 하노이 / 두짓 하노이 / 쉐라톤 하노이 웨스트 OR 동급 (5성)',
    ],
    product_summary: '인도차이나 최고봉 판시판산 (3,143M)에서 만나는 구름 위 풍경! 깟깟마을·탁박폭포·함종산 전망대까지 사파의 보석을 담은 패키지.',
    product_highlights: [
      '판시판투어 (케이블카+모노레일+트램 편도)',
      '깟깟마을 + 탁박폭포 + 함종산 전망대',
      '5성호텔 + 마사지 2시간',
      '여행자보험·유류할증료·기사팁 포함',
    ],
    inclusions: [
      '왕복 국제선 항공료',
      '택스',
      '유류할증료',
      '여행자보험',
      '가이드 및 기사팁',
      '호텔',
      '차량',
      '전일정 식사',
      '한국인가이드',
      '현지인가이드',
      '관광지 입장료',
      '판시판 케이블카 (세계 최장 6,293M)',
      '판시판 모노레일 왕복',
      '판시판 트램 편도(상행)',
      '깟깟마을 탐방',
      '탁박 폭포',
      '함종산 전망대',
      '모아나 카페 음료 1잔',
      '전신 마사지 2시간 1회',
      '특전: 룸당 과일바구니 1개',
      '특전: 베트남 전통 간식 바이 주이 첸 1인 1개',
      '특전: 코코넛 커피 1인 1잔',
    ],
    excludes: [
      '마사지팁 (60분 $5/90분 $6/120분 $7) 및 매너팁',
      '판시판 트램 하행선 (가이드 별도 문의/유료)',
      '싱글차지 1인 3박 18만원 (희망시)',
    ],
    surcharges: [
      { name: '호텔 써차지', start: '2026-04-25', end: '2026-04-27', amount: 60, currency: 'USD', unit: '1인 1박' },
      { name: '호텔 써차지', start: '2026-04-30', end: '2026-05-03', amount: 60, currency: 'USD', unit: '1인 1박' },
      { name: '호텔 써차지', start: '2026-08-30', end: '2026-09-02', amount: 60, currency: 'USD', unit: '1인 1박' },
      { name: '호텔 써차지', start: '2026-12-24', end: '2026-12-24', amount: 60, currency: 'USD', unit: '1인 1박' },
      { name: '갈라디너 (1회 필수)', start: '2026-04-25', end: '2026-04-27', amount: 25, currency: 'USD', unit: '1인' },
      { name: '갈라디너 (1회 필수)', start: '2026-04-30', end: '2026-05-03', amount: 25, currency: 'USD', unit: '1인' },
      { name: '갈라디너 (1회 필수)', start: '2026-08-30', end: '2026-09-02', amount: 25, currency: 'USD', unit: '1인' },
      { name: '갈라디너 (1회 필수)', start: '2026-12-24', end: '2026-12-24', amount: 25, currency: 'USD', unit: '1인' },
    ],
    optional_tours: [],
    customer_notes: COMMON_CUSTOMER_NOTES + '\n▶ 사파 지역은 고지대로 고산병이 올 수 있으므로 사전에 고산병 약·개인 약 지참 바랍니다.',
    internal_notes: COMMON_INTERNAL_NOTES + '\n- 싱글차지 1인 3박 18만원 (사파)\n- 일정 미참여시 패널티 1인 $150/1박당 (다른 상품 $100보다 높음)\n- 호텔 써차지: 4/25~27, 4/30~5/3, 8/30~9/2, 12/24 1인 1박 $60 + 갈라디너(1회 필수) $25\n- 출확 6명',
    notices_parsed: [
      { type: 'INFO', text: '쇼핑센터 - 침향 & 커피 (총 2회 방문)' },
      { type: 'POLICY', text: '일정 미참여시 패널티 1인 $150/1박당 적용' },
      { type: 'CRITICAL', text: '사파 지역은 고지대로 고산병이 올 수 있으므로 사전에 고산병 약·개인 약 지참 바랍니다' },
      { type: 'CRITICAL', text: '여권 유효기간은 반드시 6개월 이상 남아 있어야 합니다' },
      { type: 'CRITICAL', text: '25.1.1부터 베트남 입국시 전자담배 반입 금지' },
      { type: 'CRITICAL', text: '미성년자(만 14세 미만) 베트남 입국 시 영문 가족관계증명서 필수' },
      { type: 'INFO', text: '판시판 트램은 편도(상행)만 포함, 하행은 별도 유료' },
      { type: 'INFO', text: '하노이 출퇴근 시간 29인승 이상 차량 통제로 16인승 분리 진행' },
      { type: 'INFO', text: '한국인 가이드 단속 강화로 현지인 가이드가 공항 미팅 및 샌딩 진행' },
      { type: 'PAYMENT', text: '호텔 써차지 (4/25~27, 4/30~5/3, 8/30~9/2, 12/24) 숙박 1인 1박 $60 + 갈라디너(1회 필수) 1인 $25 추가' },
    ],
    itinerary_data: {
      meta: META,
      highlights: {
        inclusions: ['왕복항공료', '5성호텔', '판시판 케이블카+모노레일+트램', '깟깟마을·탁박폭포·함종산', '여행자보험', '마사지 2시간'],
        excludes: ['마사지팁', '트램 하행선', '싱글차지 18만원', '특정일 호텔 써차지'],
        shopping: '쇼핑센터 2회 (침향·커피)',
        remarks: [
          '사파는 고지대 (고산병 약 지참)',
          '하노이→사파 이동시간 약 5시간 (변동 가능)',
          '인원 미달시 추가금 또는 조인행사',
        ],
      },
      days: [
        {
          day: 1,
          regions: ['부산', '하노이', '사파'],
          schedule: [
            normal('08:00', '김해 국제공항 집결 후 출국 수속'),
            flight('11:00', '부산(김해) 출발 → 하노이(노이바이) 도착 13:15 (VN429)'),
            normal('13:10', '하노이 국제공항 도착 후 현지 가이드 미팅 / 중식'),
            normal(null, '라오까이를 거쳐 사파로 이동 (약 5시간)', '하노이→사파 이동시간 변동 가능'),
            normal(null, '▶사파 여행자의 거리 + 야시장 관광'),
            normal(null, '호텔 투숙 및 휴식'),
          ],
          meals: meal(true, true, true, '기내식', '쌀국수', '사파 현지식'),
          hotel: { name: 'KK 사파 / 파오스 OR 동급', grade: '5성' },
        },
        {
          day: 2,
          regions: ['사파'],
          schedule: [
            normal(null, '호텔 조식 후 가이드 미팅'),
            normal(null, '▶모아나 카페 (인생샷 스팟·음료 1잔 제공)'),
            normal(null, '▶판시판투어 — 케이블카 탑승 / 모노레일 왕복 / 트램 편도(상행)', '하행선 별도 유료'),
            normal(null, '▶세계 최장 케이블카 6,293M 탑승 후 종착 3,000M에서 600 계단'),
            normal(null, '▶인도차이나 최고봉 판시판산 감상 (3,143M)'),
            normal(null, '▶깟깟마을 탐방 + 트래킹 + 소수민족 마을 관광'),
            normal(null, '짬돈으로 이동 ▶탁박 폭포 관광 (사파에서 가장 아름다운 폭포)'),
            normal(null, '호텔 투숙 및 휴식'),
          ],
          meals: meal(true, true, true, '호텔식', '뷔페식 (판시판뷔페)', '무제한삼겹살 + 찌개'),
          hotel: { name: 'KK 사파 / 파오스 OR 동급', grade: '5성' },
        },
        {
          day: 3,
          regions: ['사파', '하노이'],
          schedule: [
            normal(null, '호텔 조식 후 가이드 미팅 / 호텔 체크아웃'),
            normal(null, '▶함종산 꽃 공원 탐방'),
            normal(null, '▶함종산 전망대에서 사파 전경 감상'),
            normal(null, '중식 후 하노이로 이동'),
            normal(null, '하노이 도착 후 ▶전신 마사지 2시간 체험', '팁별도'),
            normal(null, '호텔 투숙 및 휴식'),
          ],
          meals: meal(true, true, true, '호텔식', '현지식', '제육볶음 OR 김치전골'),
          hotel: { name: '모벤픽 리빙 웨스트 하노이 / 두짓 하노이 / 쉐라톤 하노이 웨스트 OR 동급', grade: '5성' },
        },
        {
          day: 4,
          regions: ['하노이'],
          schedule: [
            normal(null, '호텔 조식 후 가이드 미팅 / 호텔 체크아웃'),
            normal(null, '중식 후 쇼핑센터 방문'),
            shopping(null, '쇼핑센터 방문 (침향·커피)'),
            normal(null, '▶하노이 시내관광 (호치민생가·한기둥사원·바딘광장 등)', '매주 월/금 호치민생가·박물관 휴관시 옥산사로 대체'),
            normal(null, '▶호안끼엠 호수 주변 + 스트릿카 체험', '팁 $1별도'),
            normal(null, '공항 이동 후 개별 출국 수속'),
          ],
          meals: meal(true, true, true, '호텔식', '분짜정식', '해물순두부'),
          hotel: null,
        },
        {
          day: 5,
          regions: ['하노이', '부산'],
          schedule: [
            flight('01:15', '하노이(노이바이) 출발 → 부산(김해) 도착 07:05 (VN428)'),
            normal('07:05', '부산 김해 국제공항 도착'),
          ],
          meals: meal(true, false, false, '기내식'),
          hotel: null,
        },
      ],
    },
    agent_audit_report: {
      parser_version: 'register-v2026.04.21-sonnet-4.6',
      ran_at: new Date().toISOString(),
      claims: [
        { id: 'panshipan', field: 'inclusions', severity: 'CRITICAL',
          text: '판시판 케이블카+모노레일+트램 편도', evidence: '원문 [사파] Day2: "판시판투어 - 케이블카 탑승/모노레일 왕복/트램 편도"', supported: true },
        { id: 'tram_one_way', field: 'excludes', severity: 'CRITICAL',
          text: '트램 하행선 별도', evidence: '원문 [사파] Day2: "트램은 편도 (상행) 만 포함이며, 하행선은 가이드에게 별도 문의/유료"', supported: true },
        { id: 'travel_insurance', field: 'inclusions', severity: 'CRITICAL',
          text: '여행자보험 (금액 명시 없음)', evidence: '원문 [사파] 포함: "왕복 국제선 항공료 및 택스, 유류할증료, 여행자보험" — 금액 표기 없음', supported: true,
          note: '원문에 "2억" 등 금액 토큰 없음. 그대로 "여행자보험"만 표기 (Rule 3-1 준수)' },
        { id: 'min_participants_6', field: 'min_participants', severity: 'HIGH',
          text: '6명', evidence: '원문 [사파]: "성인 6명부터 출확"', supported: true },
        { id: 'penalty_150', field: 'notices_parsed', severity: 'HIGH',
          text: '패널티 $150/1박당', evidence: '원문 [사파] REMARK: "일정 미참여시 패널티 1인 $150/1박당 적용"', supported: true },
        { id: 'surcharge_dates', field: 'surcharges', severity: 'CRITICAL',
          text: '4/25~27, 4/30~5/3, 8/30~9/2, 12/24 호텔 써차지 $60 + 갈라디너 $25',
          evidence: '원문 [사파] 불포함: "호텔 써차지 4/25~27, 4/30~5/3, 8/30~9/2, 12/24 숙박 1인 1박 $60 / 갈라디너(1회 필수) 1인 $25 추가"',
          supported: true },
        { id: 'shop_2_visits', field: 'notices_parsed', severity: 'HIGH',
          text: '쇼핑 2회 (침향·커피)', evidence: '원문 [사파] REMARK: "쇼핑센터 - 침향 & 커피 (총 2회 방문)"', supported: true },
      ],
      overall_verdict: 'clean',
      unsupported_critical: 0,
      unsupported_high: 0,
    },
  };
}

// ─── main ────────────────────────────────────────────────
async function main() {
  const inserter = createInserter({
    landOperator: '투어비',
    commissionRate: 9,
    ticketingDeadline: '2026-04-28',
    destCode: 'HAN',
  });

  const packages = [
    buildSilsok(),
    buildNoNo(),
    buildDinnerCruise(),
    buildCruise1Night(),
    buildSapa(),
  ];

  console.log(`\n📦 등록 대상: ${packages.length}건`);
  packages.forEach((p, i) => {
    console.log(`   ${i + 1}. ${p.title} (price_dates: ${p.price_dates.length}건, 최저가 ${Math.min(...p.price_dates.map(d => d.price)).toLocaleString()}원)`);
  });

  // ─── 🆕 Pre-INSERT Self-Check (W26~W29) ─────────────────
  console.log('\n🔍 Pre-INSERT Self-Check 진행...');
  for (const p of packages) {
    // W26 inclusions 콤마 토큰
    for (const inc of (p.inclusions || [])) {
      if (typeof inc === 'string') {
        let depth = 0;
        for (let i = 0; i < inc.length; i++) {
          const ch = inc[i];
          if (ch === '(' || ch === '[' || ch === '{') depth++;
          else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
          else if (ch === ',' && depth === 0) {
            const prev = inc[i - 1];
            const nextRest = inc.slice(i + 1, i + 4);
            if (!(/\d/.test(prev || '') && /^\d{3}/.test(nextRest))) {
              throw new Error(`[W26 self-check] inclusions "${inc}" 콤마 포함 — 분리 필요`);
            }
          }
        }
      }
    }
    // W27/W28: validatePackage가 자동 검증
    // raw_text 50자+
    if (!p.raw_text || p.raw_text.length < 50) {
      throw new Error(`[RuleZero self-check] ${p.title} raw_text 누락 또는 짧음`);
    }
  }
  console.log('   ✅ self-check 통과 (W26 콤마 / RuleZero raw_text)');

  await inserter.run(packages);
}

main().catch(err => {
  console.error('\n❌ 등록 실패:', err);
  process.exit(1);
});
