/**
 * 하노이 (HAN) 어셈블러 v0 — auto-bootstrapped @ 2026-04-26
 *
 * 자동 생성 출처: 7개 등록 상품 (ETC-ETC-05-27, ETC-ETC-05-28, TB-HAN-05-04, TB-HAN-05-02, TB-HAN-05-01, TB-HAN-05-03, TB-HAN-05-05)
 *
 * ⚠️  이 파일은 STUB 입니다. 다음 작업 필요:
 *   1) BLOCKS 의 keywords 정제 (자동 추출은 단순 토큰만)
 *   2) BLOCKS 의 short_desc / score 검토
 *   3) DESTINATION.notices 작성 (현재는 placeholder)
 *   4) TEMPLATES 작성 (현재 비어있음 — 상품 유형별 BLOCK 조합 필요)
 *   5) parseRawText() / buildProduct() / insertToDB() 는 칭다오·서안·다낭 어셈블러를 참고해 작성
 *   6) 검수 후 db/assembler_han.js 로 rename
 *
 * 사용법 (작성 완료 후):
 *   node db/assembler_han.js <raw.txt> --operator <랜드사> --commission <N> --deadline <YYYY-MM-DD> --dry-run
 *   node db/assembler_han.js <raw.txt> ... --insert
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { findDuplicate, isSamePriceDates, isSameDeadline } = require('./templates/insert-template');

const N = (time, activity) => ({ time, activity, type: 'normal', transport: null, note: null });
const F = (time, activity, transport) => ({ time, activity, type: 'flight', transport, note: null });
const T = (time, activity) => ({ time, activity, type: 'normal', transport: '전용차량', note: null });
const O = (time, activity) => ({ time, activity, type: 'optional', transport: null, note: null });

// ══════════════════════════════════════════════════════════════
// 1. 하노이 항공편 (자동 추출)
// ══════════════════════════════════════════════════════════════

const AIRLINES = {
  VJ: { code: 'VJ', name: 'VJ', airport: '김해', flight_out: 'VJ???', flight_in: 'VJ???', flight_out_time: '00:00', arrival_time: '00:00', return_departure_time: '00:00', flight_in_time: '00:00' },
  베트: { code: '베트', name: '베트남항공', airport: '김해', flight_out: '베트???', flight_in: '베트???', flight_out_time: '00:00', arrival_time: '00:00', return_departure_time: '00:00', flight_in_time: '00:00' },
};

const DESTINATION = {
  name: '하노이', country: '미상', region_code: 'HAN',
  hotel_pool: [
    // TODO: 호텔 등급별로 분류
    { grade: '?성', names: ['하노이 모데나 호텔 빈옌 (준5성급)'], score: 2 },
    { grade: '?성', names: ['하이퐁 머큐어 호텔 또는 동급 (준 5성급)'], score: 2 },
    { grade: '?성', names: ['델라씨 하롱베이 / 드리오로 / 윈덤 레전드 하롱 OR 동급 (5성)'], score: 2 },
    { grade: '?성', names: ['하롱베이 럭셔리 크루즈 5성 (엠버서더 / 파라다이스 / 라무르 / 옥토퍼스 OR 동급)'], score: 2 },
    { grade: '?성', names: ['모벤픽 리빙 웨스트 하노이 / 두짓 하노이 / 쉐라톤 하노이 웨스트 OR 동급 (5성)'], score: 2 },
    { grade: '?성', names: ['므엉탄 하노이 OR 동급 (4성)'], score: 2 },
  ],
  notices: [
    { type: 'CRITICAL', title: '필수 확인', text: '• 여권 유효기간 출발일 기준 6개월 이상' },
    { type: 'PAYMENT', title: '취소 규정', text: '• 등록 상품의 notices_parsed 참고하여 작성 필요' },
    { type: 'INFO', title: '안내', text: '• 상기 일정은 현지 사정에 의해 변경될 수 있습니다' },
  ],
};

// ══════════════════════════════════════════════════════════════
// 2. BLOCKS — 자동 추출됨 (총 26개, 등장 빈도순)
// ══════════════════════════════════════════════════════════════

const BLOCKS = [
  {
    code: 'HAN-B001', name: "체험", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶호안끼엠 호수 + 여행자의 거리 + 스트릿카 체험")],
    keywords: ["체험"], // TODO: 정제 필요 (등장 9회)
    score: 1.5,
  },
  {
    code: 'HAN-B002', name: "하노이 시내관광", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶하노이 시내관광 (호치민생가·한기둥사원·바딘광장 등)")],
    keywords: ["하노이 시내관광","하노이시내관광","하노이"], // TODO: 정제 필요 (등장 5회)
    score: 1.5,
  },
  {
    code: 'HAN-B003', name: "시음", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶콩카페 OR 하이랜드 커피 시음")],
    keywords: ["시음"], // TODO: 정제 필요 (등장 4회)
    score: 1.5,
  },
  {
    code: 'HAN-X004', name: "등정", type: 'meal', duration: 'half',
    schedule: [N(null, "▶선상 중식 (씨푸드 포함) 후 티톱섬 전망대 등정")],
    keywords: ["등정"], // TODO: 정제 필요 (등장 3회)
    score: 0,
  },
  {
    code: 'HAN-B005', name: "감상", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "★5성급 디너크루즈 탑승 (엠버서더 OR 루나) — 하롱 시티 LED 조명·바이차이 대교 감상")],
    keywords: ["감상"], // TODO: 정제 필요 (등장 3회)
    score: 1.5,
  },
  {
    code: 'HAN-B006', name: "하노이 맥주거리 체험", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶하노이 맥주거리 체험 (맥주 1인 1잔 제공)")],
    keywords: ["하노이 맥주거리 체험","하노이맥주거리체험","하노이"], // TODO: 정제 필요 (등장 2회)
    score: 1.5,
  },
  {
    code: 'HAN-B007', name: "석회동굴 감상", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶기암괴석으로 이루어진 석회동굴 감상 (하늘문·용모양 궁전기둥·선녀탕 등)")],
    keywords: ["석회동굴 감상","석회동굴감상","석회동굴"], // TODO: 정제 필요 (등장 2회)
    score: 1.5,
  },
  {
    code: 'HAN-B008', name: "비경관광", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶007영화 촬영지 항루원 비경관광 (스피드보트)")],
    keywords: ["비경관광"], // TODO: 정제 필요 (등장 2회)
    score: 1.5,
  },
  {
    code: 'HAN-N009', name: "관광", type: 'night', duration: 'half',
    schedule: [N(null, "▶사파 여행자의 거리 + 야시장 관광")],
    keywords: ["관광"], // TODO: 정제 필요 (등장 2회)
    score: 1.5,
  },
  {
    code: 'HAN-B010', name: "옌뜨 국립공원 케이블카", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶옌뜨 국립공원 케이블카 (약 2시간 이동, 베트남 최고의 왕들이 보살핀다는 명산)")],
    keywords: ["옌뜨 국립공원 케이블카","옌뜨국립공원케이블카","옌뜨"], // TODO: 정제 필요 (등장 1회)
    score: 1.5,
  },
  {
    code: 'HAN-M011', name: "전신 마사지 2시간 체험", type: 'massage', duration: 'half',
    schedule: [N(null, "▶전신 마사지 2시간 체험")],
    keywords: ["전신 마사지 2시간 체험","전신마사지2시간체험","전신"], // TODO: 정제 필요 (등장 1회)
    score: 1,
  },
  {
    code: 'HAN-B012', name: "오리엔테이션", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "★5성급 크루즈 탑승 — 승무원 환영인사 / 웰컴 드링크 / 오리엔테이션")],
    keywords: ["오리엔테이션"], // TODO: 정제 필요 (등장 1회)
    score: 1.5,
  },
  {
    code: 'HAN-B013', name: "항해", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶유네스코 세계자연유산 하롱베이 신비로운 섬들 따라 크루즈 항해")],
    keywords: ["항해"], // TODO: 정제 필요 (등장 1회)
    score: 1.5,
  },
  {
    code: 'HAN-M014', name: "$40", type: 'massage', duration: 'half',
    schedule: [N(null, "추천 선택관광: 하롱테마파크 해상케이블카+대관람차+젠 가든 $50 / 전신 마사지 2시간 $40 (팁 $7별도)")],
    keywords: ["$40"], // TODO: 정제 필요 (등장 1회)
    score: 1,
  },
  {
    code: 'HAN-B015', name: "$30", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "추천 선택관광: 비경투어+스피드보트+항루언 $50 / 활어회 $30 / 씨푸드 $30")],
    keywords: ["$30"], // TODO: 정제 필요 (등장 1회)
    score: 1.5,
  },
  {
    code: 'HAN-M016', name: "전신 마사지 1시간 체험", type: 'massage', duration: 'half',
    schedule: [N(null, "▶전신 마사지 1시간 체험")],
    keywords: ["전신 마사지 1시간 체험","전신마사지1시간체험","전신"], // TODO: 정제 필요 (등장 1회)
    score: 1,
  },
  {
    code: 'HAN-M017', name: "$50", type: 'massage', duration: 'half',
    schedule: [N(null, "추천 선택관광: 마사지 1시간 $20 / 2시간 $40 / 하노이 야간시티투어 $40 / 드마리스뷔페 & 센뷔페 $50")],
    keywords: ["$50"], // TODO: 정제 필요 (등장 1회)
    score: 1,
  },
  {
    code: 'HAN-X018', name: "뷔페식사", type: 'meal', duration: 'half',
    schedule: [N(null, "▶디너크루즈 럭셔리 레스토랑 프리미엄 뷔페식사")],
    keywords: ["뷔페식사"], // TODO: 정제 필요 (등장 1회)
    score: 0,
  },
  {
    code: 'HAN-B019', name: "썬데크 스페셜 불꽃쇼 관람", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶썬데크 스페셜 불꽃쇼 관람")],
    keywords: ["썬데크 스페셜 불꽃쇼 관람","썬데크스페셜불꽃쇼관람","썬데크"], // TODO: 정제 필요 (등장 1회)
    score: 1.5,
  },
  {
    code: 'HAN-B020', name: "기암괴석 석회동굴 감상", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶기암괴석 석회동굴 감상 (하늘문·용모양 궁전기둥·선녀탕 등)")],
    keywords: ["기암괴석 석회동굴 감상","기암괴석석회동굴감상","기암괴석"], // TODO: 정제 필요 (등장 1회)
    score: 1.5,
  },
  {
    code: 'HAN-B021', name: "모아나 카페", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶모아나 카페 (인생샷 스팟·음료 1잔 제공)")],
    keywords: ["모아나 카페","모아나카페","모아나"], // TODO: 정제 필요 (등장 1회)
    score: 1.5,
  },
  {
    code: 'HAN-B022', name: "편도", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶판시판투어 — 케이블카 탑승 / 모노레일 왕복 / 트램 편도(상행)")],
    keywords: ["편도"], // TODO: 정제 필요 (등장 1회)
    score: 1.5,
  },
  {
    code: 'HAN-B023', name: "세계 최장 케이블카 6", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶세계 최장 케이블카 6")],
    keywords: ["세계 최장 케이블카 6","세계최장케이블카6","세계"], // TODO: 정제 필요 (등장 1회)
    score: 1.5,
  },
  {
    code: 'HAN-B024', name: "293M 탑승 후 종착 3", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶293M 탑승 후 종착 3")],
    keywords: ["293M 탑승 후 종착 3","293M탑승후종착3","293M"], // TODO: 정제 필요 (등장 1회)
    score: 1.5,
  },
  {
    code: 'HAN-B025', name: "000M에서 600 계단", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶000M에서 600 계단")],
    keywords: ["000M에서 600 계단","000M에서600계단","000M에서"], // TODO: 정제 필요 (등장 1회)
    score: 1.5,
  },
  {
    code: 'HAN-B026', name: "함종산 꽃 공원 탐방", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶함종산 꽃 공원 탐방")],
    keywords: ["함종산 꽃 공원 탐방","함종산꽃공원탐방","함종산"], // TODO: 정제 필요 (등장 1회)
    score: 1.5,
  },
];

// ══════════════════════════════════════════════════════════════
// 3. 코스 템플릿 — TODO: 상품 유형별 작성
// ══════════════════════════════════════════════════════════════

const TEMPLATES = [
  // 상품 유형 (자동 추출): 일반, 노팁노옵션 (크루즈숙박), 노팁노옵션, 실속, 노팁노옵션 (디너크루즈), 노팁노옵션 (사파)
  // 예시:
  // {
  //   code: 'HAN-실속-2N', name: '하노이 실속 2박3일', type: '실속', nights: 2, days: 3,
  //   signature_blocks: ['HAN-B001', 'HAN-B002'],
  //   excludes_blocks: [],
  //   inclusions: [...],
  //   excludes: [...],
  // },
];

// ══════════════════════════════════════════════════════════════
// 4. 공통 inclusions / excludes (등록 상품 4개 이상에 등장)
// ══════════════════════════════════════════════════════════════

const COMMON_INCLUSIONS = [
  "현지인가이드",
  "호텔",
  "차량",
  "전일정 식사",
  "한국인가이드",
  "관광지 입장료",
  "가이드 및 기사팁",
  "하노이 시내관광 (호치민생가·바딘광장·한기둥사원 등)",
  "호안끼엠 호수 + 36거리 + 스트릿카 체험"
];
const COMMON_EXCLUDES = [];

// ══════════════════════════════════════════════════════════════
// 5. parseRawText / buildProduct / insertToDB
// ══════════════════════════════════════════════════════════════
// TODO: 칭다오·서안·다낭 어셈블러 (db/assembler_qingdao.js 등) 를 참고해 작성
//
// 핵심 함수:
//   - parseRawText(text) → 일자별 텍스트, 가격, 포함/불포함 등 파싱
//   - matchBlocks(parsed)  → BLOCKS 키워드 매칭
//   - detectTemplate(matched, parsed)  → TEMPLATES 중 가장 적합한 것 선택
//   - buildProduct(parsed, template, blocks) → travel_packages INSERT 객체 조립
//   - insertToDB(products, options) → 중복 검사 + INSERT
//
// printReport / main 도 동일 패턴

if (require.main === module) {
  console.error('⚠️  이 어셈블러는 STUB 상태입니다. parseRawText / buildProduct 등을 구현하세요.');
  console.error('   참고: db/assembler_qingdao.js, db/assembler_xian.js, db/assembler_danang.js');
  process.exit(2);
}

module.exports = { BLOCKS, TEMPLATES, AIRLINES, DESTINATION, COMMON_INCLUSIONS, COMMON_EXCLUDES };
