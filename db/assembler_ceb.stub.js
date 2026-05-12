/**
 * 세부 (CEB) 어셈블러 v0 — auto-bootstrapped @ 2026-04-27
 *
 * 자동 생성 출처: 3개 등록 상품 (TP-CEB-05-04, TP-CEB-05-05, TP-CEB-05-06)
 *
 * ⚠️  이 파일은 STUB 입니다. 다음 작업 필요:
 *   1) BLOCKS 의 keywords 정제 (자동 추출은 단순 토큰만)
 *   2) BLOCKS 의 short_desc / score 검토
 *   3) DESTINATION.notices 작성 (현재는 placeholder)
 *   4) TEMPLATES 작성 (현재 비어있음 — 상품 유형별 BLOCK 조합 필요)
 *   5) parseRawText() / buildProduct() / insertToDB() 는 칭다오·서안·다낭 어셈블러를 참고해 작성
 *   6) 검수 후 db/assembler_ceb.js 로 rename
 *
 * 사용법 (작성 완료 후):
 *   node db/assembler_ceb.js <raw.txt> --operator <랜드사> --commission <N> --deadline <YYYY-MM-DD> --dry-run
 *   node db/assembler_ceb.js <raw.txt> ... --insert
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
// 1. 세부 항공편 (자동 추출)
// ══════════════════════════════════════════════════════════════

const AIRLINES = {
  BX: { code: 'BX', name: 'BX(에어부산)', airport: '부산(김해)', flight_out: 'BX???', flight_in: 'BX???', flight_out_time: '00:00', arrival_time: '00:00', return_departure_time: '00:00', flight_in_time: '00:00' },
};

const DESTINATION = {
  name: '세부', country: '필리핀', region_code: 'CEB',
  hotel_pool: [
    // TODO: 호텔 등급별로 분류
    { grade: '?성', names: ['알테라 OR 티샤인 (예약호텔/리조트)'], score: 2 },
    { grade: '?성', names: ['솔레아 (예약호텔/리조트)'], score: 2 },
    { grade: '?성', names: ['두짓타니 (예약호텔/리조트)'], score: 2 },
  ],
  notices: [
    { type: 'CRITICAL', title: '필수 확인', text: '• 여권 유효기간 출발일 기준 6개월 이상' },
    { type: 'PAYMENT', title: '취소 규정', text: '• 등록 상품의 notices_parsed 참고하여 작성 필요' },
    { type: 'INFO', title: '안내', text: '• 상기 일정은 현지 사정에 의해 변경될 수 있습니다' },
  ],
};

// ══════════════════════════════════════════════════════════════
// 2. BLOCKS — 자동 추출됨 (총 3개, 등장 빈도순)
// ══════════════════════════════════════════════════════════════

const BLOCKS = [
  {
    code: 'CEB-B001', name: "세부 디스커버리 투어", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶세부 디스커버리 투어 (재래시장·열대과일 상점방문)")],
    keywords: ["세부 디스커버리 투어","세부디스커버리투어","세부"], // TODO: 정제 필요 (등장 3회)
    score: 1.5,
  },
  {
    code: 'CEB-X002', name: "아일랜드 호핑투어", type: 'meal', duration: 'half',
    schedule: [N(null, "▶아일랜드 호핑투어 (스노클링 + 바다낚시 + 중식BBQ)")],
    keywords: ["아일랜드 호핑투어","아일랜드호핑투어","아일랜드"], // TODO: 정제 필요 (등장 3회)
    score: 0,
  },
  {
    code: 'CEB-B003', name: "막탄 시내관광", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶막탄 시내관광 (막탄슈라인·막탄 산토리니 성당)")],
    keywords: ["막탄 시내관광","막탄시내관광","막탄"], // TODO: 정제 필요 (등장 3회)
    score: 1.5,
  },
];

// ══════════════════════════════════════════════════════════════
// 3. 코스 템플릿 — TODO: 상품 유형별 작성
// ══════════════════════════════════════════════════════════════

const TEMPLATES = [
  // 상품 유형 (자동 추출): 슬림
  // 예시:
  // {
  //   code: 'CEB-실속-2N', name: '세부 실속 2박3일', type: '실속', nights: 2, days: 3,
  //   signature_blocks: ['CEB-B001', 'CEB-B002'],
  //   excludes_blocks: [],
  //   inclusions: [...],
  //   excludes: [...],
  // },
];

// ══════════════════════════════════════════════════════════════
// 4. 공통 inclusions / excludes (등록 상품 2개 이상에 등장)
// ══════════════════════════════════════════════════════════════

const COMMON_INCLUSIONS = [
  "왕복 항공료 (BX711 / BX712)",
  "숙박 (예약호텔 / 리조트)",
  "일정상 식사",
  "가이드",
  "차량 (공항 ↔ 리조트 전용차량 / 일정 중 현지차량)",
  "스쿠버다이빙 강습",
  "세부 디스커버리 투어 (재래시장, 열대과일 상점방문)",
  "막탄 시내관광 (막탄슈라인, 막탄 산토리니 성당)"
];
const COMMON_EXCLUDES = [
  "석식 2회 (제1일 석식, 제3일 석식, 제4일 석식)",
  "중식 1회 (제3일 중식)",
  "조식 1회 (제5일 조식)",
  "아일랜드 호핑투어 (선택관광 1인 $80, 선포함시 5만원)",
  "이트래블 QR코드 발급 (대행 불가, 고객 직접 발급)"
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
