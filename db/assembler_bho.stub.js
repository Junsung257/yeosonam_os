/**
 * 보홀 (BHO) 어셈블러 v0 — auto-bootstrapped @ 2026-04-27
 *
 * 자동 생성 출처: 10개 등록 상품 (TC-BHO-05-02, TC-BHO-06-01, TC-BHO-05-01, TC-BHO-06-02, ID-BHO-06-02, ID-BHO-05-02, ID-BHO-06-03, ID-BHO-05-01, ID-BHO-05-03, ID-BHO-06-01)
 *
 * ⚠️  이 파일은 STUB 입니다. 다음 작업 필요:
 *   1) BLOCKS 의 keywords 정제 (자동 추출은 단순 토큰만)
 *   2) BLOCKS 의 short_desc / score 검토
 *   3) DESTINATION.notices 작성 (현재는 placeholder)
 *   4) TEMPLATES 작성 (현재 비어있음 — 상품 유형별 BLOCK 조합 필요)
 *   5) parseRawText() / buildProduct() / insertToDB() 는 칭다오·서안·다낭 어셈블러를 참고해 작성
 *   6) 검수 후 db/assembler_bho.js 로 rename
 *
 * 사용법 (작성 완료 후):
 *   node db/assembler_bho.js <raw.txt> --operator <랜드사> --commission <N> --deadline <YYYY-MM-DD> --dry-run
 *   node db/assembler_bho.js <raw.txt> ... --insert
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
// 1. 보홀 항공편 (자동 추출)
// ══════════════════════════════════════════════════════════════

const AIRLINES = {
  7C: { code: '7C', name: '7C(제주항공)', airport: '부산(김해)', flight_out: '7C???', flight_in: '7C???', flight_out_time: '00:00', arrival_time: '00:00', return_departure_time: '00:00', flight_in_time: '00:00' },
};

const DESTINATION = {
  name: '보홀', country: '필리핀', region_code: 'BHO',
  hotel_pool: [
    // TODO: 호텔 등급별로 분류
    { grade: '?성', names: ['솔레아 코스트 보홀 (슈페리어 가든뷰)'], score: 2 },
    { grade: '?성', names: ['헤난 타왈라 (디럭스룸)'], score: 2 },
    { grade: '?성', names: ['헤난 알로나 / 코스트 (택1, 디럭스룸)'], score: 2 },
    { grade: '?성', names: ['돌핀베이 (디럭스룸)'], score: 2 },
  ],
  notices: [
    { type: 'CRITICAL', title: '필수 확인', text: '• 여권 유효기간 출발일 기준 6개월 이상' },
    { type: 'PAYMENT', title: '취소 규정', text: '• 등록 상품의 notices_parsed 참고하여 작성 필요' },
    { type: 'INFO', title: '안내', text: '• 상기 일정은 현지 사정에 의해 변경될 수 있습니다' },
  ],
};

// ══════════════════════════════════════════════════════════════
// 2. BLOCKS — 자동 추출됨 (총 19개, 등장 빈도순)
// ══════════════════════════════════════════════════════════════

const BLOCKS = [
  {
    code: 'BHO-B001', name: "강습", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶해양스포츠 체험 - 스쿠버다이빙 강습 (이론교육)")],
    keywords: ["강습"], // TODO: 정제 필요 (등장 6회)
    score: 1.5,
  },
  {
    code: 'BHO-M002', name: "전통오일마사지 1시간", type: 'massage', duration: 'half',
    schedule: [N(null, "▶전통오일마사지 1시간 (팁별도 · 아동불포함)")],
    keywords: ["전통오일마사지 1시간","전통오일마사지1시간","전통오일마사지"], // TODO: 정제 필요 (등장 6회)
    score: 1,
  },
  {
    code: 'BHO-X003', name: "보홀 아일랜드 호핑투어", type: 'meal', duration: 'half',
    schedule: [N(null, "▶보홀 아일랜드 호핑투어 (스노쿨링 + 중식 BBQ)")],
    keywords: ["보홀 아일랜드 호핑투어","보홀아일랜드호핑투어","보홀"], // TODO: 정제 필요 (등장 6회)
    score: 0,
  },
  {
    code: 'BHO-B004', name: "보홀 시내관광", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶보홀 시내관광 (사왕 재래시장 · 성어거스틴 성당)")],
    keywords: ["보홀 시내관광","보홀시내관광","보홀"], // TODO: 정제 필요 (등장 6회)
    score: 1.5,
  },
  {
    code: 'BHO-B005', name: "사왕재래시장", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶사왕재래시장")],
    keywords: ["사왕재래시장"], // TODO: 정제 필요 (등장 4회)
    score: 1.5,
  },
  {
    code: 'BHO-B006', name: "팡라오성당", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶팡라오성당")],
    keywords: ["팡라오성당"], // TODO: 정제 필요 (등장 4회)
    score: 1.5,
  },
  {
    code: 'BHO-B007', name: "보홀 데이투어", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶보홀 데이투어 (타르시어원숭이·초콜릿힐·멘메이드포레스트)")],
    keywords: ["보홀 데이투어","보홀데이투어","보홀"], // TODO: 정제 필요 (등장 3회)
    score: 1.5,
  },
  {
    code: 'BHO-B008', name: "포함", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶나팔링투어 — 정어리떼 스노클링 장비·커티지·음료 포함")],
    keywords: ["포함"], // TODO: 정제 필요 (등장 2회)
    score: 1.5,
  },
  {
    code: 'BHO-B009', name: "관람", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶반딧불투어 — 맹그로브 숲 반딧불 관람")],
    keywords: ["관람"], // TODO: 정제 필요 (등장 2회)
    score: 1.5,
  },
  {
    code: 'BHO-X010', name: "스노클링·호핑중식", type: 'meal', duration: 'half',
    schedule: [N(null, "▶보홀 아일랜드 호핑투어 — 돌핀왓칭·발리카삭 거북이왓칭·푼톳 열대어 스노클링·호핑중식")],
    keywords: ["스노클링·호핑중식"], // TODO: 정제 필요 (등장 2회)
    score: 0,
  },
  {
    code: 'BHO-B011', name: "안경원숭이·맨메이드포레스트·초콜릿힐", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶보홀 데이투어 — 안경원숭이·맨메이드포레스트·초콜릿힐")],
    keywords: ["안경원숭이·맨메이드포레스트·초콜릿힐"], // TODO: 정제 필요 (등장 2회)
    score: 1.5,
  },
  {
    code: 'BHO-B012', name: "정어리떼 스노클링 나팔링투어", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶정어리떼 스노클링 나팔링투어 (추천)")],
    keywords: ["정어리떼 스노클링 나팔링투어","정어리떼스노클링나팔링투어","정어리떼"], // TODO: 정제 필요 (등장 2회)
    score: 1.5,
  },
  {
    code: 'BHO-B013', name: "반딧불투어", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶반딧불투어 (추천)")],
    keywords: ["반딧불투어"], // TODO: 정제 필요 (등장 2회)
    score: 1.5,
  },
  {
    code: 'BHO-B014', name: "아일랜드 호핑투어", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶아일랜드 호핑투어 (스노클링)")],
    keywords: ["아일랜드 호핑투어","아일랜드호핑투어","아일랜드"], // TODO: 정제 필요 (등장 2회)
    score: 1.5,
  },
  {
    code: 'BHO-B015', name: "발리카삭 호핑투어", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶발리카삭 호핑투어 (스노클링+거북이왓칭)")],
    keywords: ["발리카삭 호핑투어","발리카삭호핑투어","발리카삭"], // TODO: 정제 필요 (등장 2회)
    score: 1.5,
  },
  {
    code: 'BHO-B016', name: "제공", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "★단독★ 발리카삭 호핑투어 선포함 시 돌핀왓칭($30) 서비스 제공")],
    keywords: ["제공"], // TODO: 정제 필요 (등장 2회)
    score: 1.5,
  },
  {
    code: 'BHO-B017', name: "데이투어", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶데이투어 (원숭이+초콜릿힐+멘메이드포레스트)")],
    keywords: ["데이투어"], // TODO: 정제 필요 (등장 2회)
    score: 1.5,
  },
  {
    code: 'BHO-B018', name: "어드벤처", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶어드벤처 (로복강+원숭이+초콜릿힐+멘메이드포레스트)")],
    keywords: ["어드벤처"], // TODO: 정제 필요 (등장 2회)
    score: 1.5,
  },
  {
    code: 'BHO-M019', name: "전신마사지 60분", type: 'massage', duration: 'half',
    schedule: [N(null, "▶전신마사지 60분")],
    keywords: ["전신마사지 60분","전신마사지60분","전신마사지"], // TODO: 정제 필요 (등장 2회)
    score: 1,
  },
];

// ══════════════════════════════════════════════════════════════
// 3. 코스 템플릿 — TODO: 상품 유형별 작성
// ══════════════════════════════════════════════════════════════

const TEMPLATES = [
  // 상품 유형 (자동 추출): 노옵션, 슬림, 스팟특가-헤난타왈라, 스팟특가-헤난알로나·코스트, 스팟특가-돌핀베이
  // 예시:
  // {
  //   code: 'BHO-실속-2N', name: '보홀 실속 2박3일', type: '실속', nights: 2, days: 3,
  //   signature_blocks: ['BHO-B001', 'BHO-B002'],
  //   excludes_blocks: [],
  //   inclusions: [...],
  //   excludes: [...],
  // },
];

// ══════════════════════════════════════════════════════════════
// 4. 공통 inclusions / excludes (등록 상품 5개 이상에 등장)
// ══════════════════════════════════════════════════════════════

const COMMON_INCLUSIONS = [
  "왕복 국제선 항공료",
  "유류할증료",
  "일정상 식사",
  "가이드",
  "택스",
  "해외여행자보험",
  "호텔 (2인 1실)",
  "전용차량 & 기사",
  "현지공항세",
  "관광지 입장료",
  "특식 2회",
  "전통오일마사지 1시간 (아동불포함)",
  "보홀 시내관광"
];
const COMMON_EXCLUDES = [
  "에티켓 팁",
  "기타 개인 경비",
  "선택 관광 비용",
  "호텔 써차지",
  "갈라 디너",
  "보홀 호핑투어 미선택 시 중식 1회 자유식"
];

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
