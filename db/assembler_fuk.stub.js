/**
 * 후쿠오카 (FUK) 어셈블러 v0 — auto-bootstrapped @ 2026-04-28
 *
 * 자동 생성 출처: 5개 등록 상품 (TP-SMN-04-01, TB-FUK-03-01, TB-FUK-04-01, TB-FUK-03-02, TB-FUK-04-02)
 *
 * ⚠️  이 파일은 STUB 입니다. 다음 작업 필요:
 *   1) BLOCKS 의 keywords 정제 (자동 추출은 단순 토큰만)
 *   2) BLOCKS 의 short_desc / score 검토
 *   3) DESTINATION.notices 작성 (현재는 placeholder)
 *   4) TEMPLATES 작성 (현재 비어있음 — 상품 유형별 BLOCK 조합 필요)
 *   5) parseRawText() / buildProduct() / insertToDB() 는 칭다오·서안·다낭 어셈블러를 참고해 작성
 *   6) 검수 후 db/assembler_fuk.js 로 rename
 *
 * 사용법 (작성 완료 후):
 *   node db/assembler_fuk.js <raw.txt> --operator <랜드사> --commission <N> --deadline <YYYY-MM-DD> --dry-run
 *   node db/assembler_fuk.js <raw.txt> ... --insert
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
// 1. 후쿠오카 항공편 (자동 추출)
// ══════════════════════════════════════════════════════════════

const AIRLINES = {
  부관: { code: '부관', name: '부관훼리', airport: '부산국제여객터미널', flight_out: '부관???', flight_in: '부관???', flight_out_time: '00:00', arrival_time: '00:00', return_departure_time: '00:00', flight_in_time: '00:00' },
  카멜: { code: '카멜', name: '카멜리아 (선박)', airport: '부산국제여객터미널', flight_out: '카멜???', flight_in: '카멜???', flight_out_time: '00:00', arrival_time: '00:00', return_departure_time: '00:00', flight_in_time: '00:00' },
};

const DESTINATION = {
  name: '후쿠오카', country: '일본', region_code: 'FUK',
  hotel_pool: [
    // TODO: 호텔 등급별로 분류
    { grade: '?성', names: ['벳부 스기노이 호텔 또는 동급(2인1실)'], score: 2 },
    { grade: '?성', names: ['부관훼리(다인실 기준)'], score: 2 },
    { grade: '?성', names: ['카멜리아 페리 (다인실 기준) — 선상 1박'], score: 2 },
  ],
  notices: [
    { type: 'CRITICAL', title: '필수 확인', text: '• 여권 유효기간 출발일 기준 6개월 이상' },
    { type: 'PAYMENT', title: '취소 규정', text: '• 등록 상품의 notices_parsed 참고하여 작성 필요' },
    { type: 'INFO', title: '안내', text: '• 상기 일정은 현지 사정에 의해 변경될 수 있습니다' },
  ],
};

// ══════════════════════════════════════════════════════════════
// 2. BLOCKS — 자동 추출됨 (총 30개, 등장 빈도순)
// ══════════════════════════════════════════════════════════════

const BLOCKS = [
  {
    code: 'FUK-B001', name: "관광", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶큐슈 3대 신사 중 하나인 미야지다케 신사 관광")],
    keywords: ["관광"], // TODO: 정제 필요 (등장 8회)
    score: 1.5,
  },
  {
    code: 'FUK-B002', name: "라라포트 자유관광", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶라라포트 자유관광")],
    keywords: ["라라포트 자유관광","라라포트자유관광","라라포트"], // TODO: 정제 필요 (등장 5회)
    score: 1.5,
  },
  {
    code: 'FUK-B003', name: "베이사이드플레이스 관광", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶베이사이드플레이스 관광")],
    keywords: ["베이사이드플레이스 관광","베이사이드플레이스관광","베이사이드플레이스"], // TODO: 정제 필요 (등장 4회)
    score: 1.5,
  },
  {
    code: 'FUK-B004', name: "하카타 포트 타워  관광", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶하카타 포트 타워 (외관) 관광")],
    keywords: ["하카타 포트 타워  관광","하카타포트타워관광","하카타"], // TODO: 정제 필요 (등장 4회)
    score: 1.5,
  },
  {
    code: 'FUK-B005', name: "증정★", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "★미르히 푸딩 1인 1개 증정★")],
    keywords: ["증정★"], // TODO: 정제 필요 (등장 2회)
    score: 1.5,
  },
  {
    code: 'FUK-B006', name: "뇨이린지 관광", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶약 3천개의 개구리 석상이 있는 뇨이린지 관광")],
    keywords: ["뇨이린지 관광","뇨이린지관광","뇨이린지"], // TODO: 정제 필요 (등장 2회)
    score: 1.5,
  },
  {
    code: 'FUK-B007', name: "작은 교토 마메다마치 관광", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶큐슈 속의 작은 교토 마메다마치 관광")],
    keywords: ["작은 교토 마메다마치 관광","작은교토마메다마치관광","작은"], // TODO: 정제 필요 (등장 2회)
    score: 1.5,
  },
  {
    code: 'FUK-B008', name: "마메다마치", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶마메다마치")],
    keywords: ["마메다마치"], // TODO: 정제 필요 (등장 1회)
    score: 1.5,
  },
  {
    code: 'FUK-B009', name: "군초양조장", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶군초양조장")],
    keywords: ["군초양조장"], // TODO: 정제 필요 (등장 1회)
    score: 1.5,
  },
  {
    code: 'FUK-B010', name: "오오야마댐", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶진격의 거인 1화 속 장면을 재현한 오오야마댐")],
    keywords: ["오오야마댐"], // TODO: 정제 필요 (등장 1회)
    score: 1.5,
  },
  {
    code: 'FUK-B011', name: "호수", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶유후인 여행의 상징이자 필수 코스 긴린코 호수")],
    keywords: ["호수"], // TODO: 정제 필요 (등장 1회)
    score: 1.5,
  },
  {
    code: 'FUK-B012', name: "거리", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶아기자기한 상점들이 즐비하여 동화마을 같은 민예 거리")],
    keywords: ["거리"], // TODO: 정제 필요 (등장 1회)
    score: 1.5,
  },
  {
    code: 'FUK-B013', name: "성지가 된 가마도지옥", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶귀멸의칼날 카마도 탄지로와 성이 같아 팬들의 성지가 된 가마도지옥")],
    keywords: ["성지가 된 가마도지옥","성지가된가마도지옥","성지가"], // TODO: 정제 필요 (등장 1회)
    score: 1.5,
  },
  {
    code: 'FUK-B014', name: "기관고", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶스즈메의 문단속 메인 포스터 배경인 분고모리 기관고")],
    keywords: ["기관고"], // TODO: 정제 필요 (등장 1회)
    score: 1.5,
  },
  {
    code: 'FUK-B015', name: "다자이후 텐만구", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶다자이후 텐만구")],
    keywords: ["다자이후 텐만구","다자이후텐만구","다자이후"], // TODO: 정제 필요 (등장 1회)
    score: 1.5,
  },
  {
    code: 'FUK-B016', name: "해변", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶후쿠오카 인공해변 모모치 해변")],
    keywords: ["해변"], // TODO: 정제 필요 (등장 1회)
    score: 1.5,
  },
  {
    code: 'FUK-B017', name: "후쿠오카 타워 관광", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶높이 234M, 8000장의 유리로 단장한 후쿠오카 타워 관광")],
    keywords: ["후쿠오카 타워 관광","후쿠오카타워관광","후쿠오카"], // TODO: 정제 필요 (등장 1회)
    score: 1.5,
  },
  {
    code: 'FUK-B018', name: "꽃놀이 명소 마이즈루 공원", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶후쿠오카 성터가 남아있는 꽃놀이 명소 마이즈루 공원")],
    keywords: ["꽃놀이 명소 마이즈루 공원","꽃놀이명소마이즈루공원","꽃놀이"], // TODO: 정제 필요 (등장 1회)
    score: 1.5,
  },
  {
    code: 'FUK-B019', name: "신을 모신 태재부 천만궁", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶학문의 신을 모신 태재부 천만궁")],
    keywords: ["신을 모신 태재부 천만궁","신을모신태재부천만궁","신을"], // TODO: 정제 필요 (등장 1회)
    score: 1.5,
  },
  {
    code: 'FUK-B020', name: "지옥온천인 가마도 지옥온천 관광", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶신비한 지옥온천인 가마도 지옥온천(족욕 체험) 관광")],
    keywords: ["지옥온천인 가마도 지옥온천 관광","지옥온천인가마도지옥온천관광","지옥온천인"], // TODO: 정제 필요 (등장 1회)
    score: 1.5,
  },
  {
    code: 'FUK-B021', name: "유황재배지인 유노하나 관광", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶유황재배지인 유노하나 관광")],
    keywords: ["유황재배지인 유노하나 관광","유황재배지인유노하나관광","유황재배지인"], // TODO: 정제 필요 (등장 1회)
    score: 1.5,
  },
  {
    code: 'FUK-X022', name: "휴식처 오호리공원 산책", type: 'meal', duration: 'half',
    schedule: [N(null, "▶후쿠오카 시민들의 휴식처 오호리공원 산책")],
    keywords: ["휴식처 오호리공원 산책","휴식처오호리공원산책","휴식처"], // TODO: 정제 필요 (등장 1회)
    score: 0,
  },
  {
    code: 'FUK-B023', name: "현수교 유메오오츠리바시 관광", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶일본 최대 높이 보행자 다리인 꿈의 현수교 유메오오츠리바시 관광")],
    keywords: ["현수교 유메오오츠리바시 관광","현수교유메오오츠리바시관광","현수교"], // TODO: 정제 필요 (등장 1회)
    score: 1.5,
  },
  {
    code: 'FUK-B024', name: "이마리 도자기 마을 관광", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶일본의 도자기가 처음 만들어진 이마리 도자기 마을 관광")],
    keywords: ["이마리 도자기 마을 관광","이마리도자기마을관광","이마리"], // TODO: 정제 필요 (등장 1회)
    score: 1.5,
  },
  {
    code: 'FUK-B025', name: "도잔 신사", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶아리타 자기를 만들어 낸 조선인 출신 도공 도조 이삼평을 모시고 있는 도잔 신사")],
    keywords: ["도잔 신사","도잔신사","도잔"], // TODO: 정제 필요 (등장 1회)
    score: 1.5,
  },
  {
    code: 'FUK-B026', name: "테마파크 아리타 포세린파크", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶전세계 도자기를 전시하고 있는 테마파크 아리타 포세린파크")],
    keywords: ["테마파크 아리타 포세린파크","테마파크아리타포세린파크","테마파크"], // TODO: 정제 필요 (등장 1회)
    score: 1.5,
  },
  {
    code: 'FUK-B027', name: "차창관광", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶일본 3대 소나무 숲인 니지노마츠바라 차창관광")],
    keywords: ["차창관광"], // TODO: 정제 필요 (등장 1회)
    score: 1.5,
  },
  {
    code: 'FUK-B028', name: "카가미야마 전망대", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶카라츠의 탁트인 바다와 전경을 내려다보는 카가미야마 전망대")],
    keywords: ["카가미야마 전망대","카가미야마전망대","카가미야마"], // TODO: 정제 필요 (등장 1회)
    score: 1.5,
  },
  {
    code: 'FUK-B029', name: "토리이", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶결연의 상징으로 오랫동안 사랑받는 이토시마 부부바위, 토리이")],
    keywords: ["토리이"], // TODO: 정제 필요 (등장 1회)
    score: 1.5,
  },
  {
    code: 'FUK-B030', name: "드라이브 코스 선셋로드", type: 'sightseeing', duration: 'half',
    schedule: [N(null, "▶에메랄드 빛 해안을 달리는 드라이브 코스 선셋로드 (차창)")],
    keywords: ["드라이브 코스 선셋로드","드라이브코스선셋로드","드라이브"], // TODO: 정제 필요 (등장 1회)
    score: 1.5,
  },
];

// ══════════════════════════════════════════════════════════════
// 3. 코스 템플릿 — TODO: 상품 유형별 작성
// ══════════════════════════════════════════════════════════════

const TEMPLATES = [
  // 상품 유형 (자동 추출): 고품격|온천, 시내숙박, 정통 북큐슈, 온천, 소도시+후쿠오카
  // 예시:
  // {
  //   code: 'FUK-실속-2N', name: '후쿠오카 실속 2박3일', type: '실속', nights: 2, days: 3,
  //   signature_blocks: ['FUK-B001', 'FUK-B002'],
  //   excludes_blocks: [],
  //   inclusions: [...],
  //   excludes: [...],
  // },
];

// ══════════════════════════════════════════════════════════════
// 4. 공통 inclusions / excludes (등록 상품 3개 이상에 등장)
// ══════════════════════════════════════════════════════════════

const COMMON_INCLUSIONS = [
  "출국세",
  "왕복 훼리비",
  "부두세 & 유류세",
  "관광지 입장료",
  "가이드",
  "전용버스",
  "여행자보험"
];
const COMMON_EXCLUDES = [
  "가이드&기사팁 3만원/1인",
  "기타 개인비용",
  "일정표에 기재된 불포함 식사"
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
