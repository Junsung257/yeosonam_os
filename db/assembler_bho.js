'use strict';
/**
 * 보홀 (BHO) 어셈블러 v1 — 2026-04-30
 *
 * 표준 반자유 3박5일 / 4박6일 패키지 라이브러리.
 * 각 랜드사 스크립트는 buildBoholPackages() 에 변수 데이터만 주입하면 됩니다.
 *
 * 사용법 (랜드사 스크립트에서):
 *   const { createInserter, computeRawHash } = require('./templates/insert-template');
 *   const { buildBoholPackages } = require('./assembler_bho');
 *
 *   const inserter = createInserter({ landOperator: '투어비', commissionRate: 10, ... });
 *   const packages = buildBoholPackages({
 *     inserter,
 *     hotels:      [{ idx:0, key:'dolphin', label:'돌핀베이', accommodation:'돌핀베이 (디럭스룸)' }],
 *     flightOut:   { code:'7C2157', dep:'21:05', arr:'00:45+1' },
 *     flightIn:    { code:'7C2158', dep:'01:45', arr:'06:55' },
 *     priceDates3D: [{ date:'2026-05-20', prices:[819000] }, ...],
 *     priceDates4D: [{ date:'2026-05-23', prices:[879000] }, ...],
 *     inclusions:  ['국제선 왕복 항공료 및 택스', ...],   // raw_text verbatim substrings 필수
 *     excludes:    [...],
 *     notices:     [...],
 *     rawText:     RAW_TEXT,
 *   });
 *   inserter.run(packages);
 *
 * ⚠️  activityNote 기본값은 투어비 원문 기준. 다른 랜드사는 해당 원문 verbatim 으로 오버라이드 필요.
 *
 * TODO (P2): CLI 모드 (node db/assembler_bho.js <raw.txt> --operator ... --insert)
 *   parseRawText() + Haiku 가격표 추출 → 아래 BLOCKS 카탈로그 활용
 */

const crypto = require('crypto');

// ─────────────────────────────────────────────────────────────────────────────
//  내부 헬퍼: helpers 객체를 직접 받지 않고 inserter 에서 destructure
// ─────────────────────────────────────────────────────────────────────────────

function _helpers(inserter) {
  return inserter.helpers;
}

// ─────────────────────────────────────────────────────────────────────────────
//  표준 일정 블록 빌더 (BHO 반자유 고정 구조)
// ─────────────────────────────────────────────────────────────────────────────

// D1: 부산 출발 → 보홀 도착 → 체크인
function _d1(h, flightOut, inserter) {
  const { flight, normal } = _helpers(inserter);
  return {
    day: 1,
    regions: ['부산', '보홀'],
    meals: { breakfast: false, lunch: false, dinner: false, notes: '' },
    schedule: [
      flight(flightOut.dep, `부산(김해) 출발 → 보홀(팡라오) 도착 ${flightOut.arr} (익일)`, flightOut.code),
      normal('보홀 국제공항 도착 후 입국 수속'),
      normal('현지인 가이드 미팅 후 리조트 CHECK-IN (한국인가이드 상시 카톡안내)'),
    ],
    hotel: { name: h.accommodation, grade: h.grade || '디럭스룸', note: null },
  };
}

// D2: 리조트 자유 (액티비티 없음)
function _d2(h, inserter) {
  const { normal } = _helpers(inserter);
  return {
    day: 2,
    regions: ['보홀'],
    meals: { breakfast: true, lunch: false, dinner: false, notes: '리조트 조식' },
    schedule: [
      normal('리조트 조식 후'),
      normal('리조트 전일 자유시간'),
    ],
    hotel: { name: h.accommodation, grade: h.grade || '디럭스룸', note: null },
  };
}

// D3: 액티비티일 (activityNote = 원문 verbatim 그대로)
function _d3(h, dayNum, activityNote, inserter) {
  const { normal } = _helpers(inserter);
  return {
    day: dayNum,
    regions: ['보홀'],
    meals: { breakfast: true, lunch: false, dinner: false, notes: '리조트 조식' },
    schedule: [
      normal('리조트 조식 후'),
      normal(activityNote),
      normal('후 자유시간'),
    ],
    hotel: { name: h.accommodation, grade: h.grade || '디럭스룸', note: null },
  };
}

// 추가 자유일 (4박 전용 D4)
function _dFree(h, dayNum, inserter) {
  const { normal } = _helpers(inserter);
  return {
    day: dayNum,
    regions: ['보홀'],
    meals: { breakfast: true, lunch: false, dinner: false, notes: '리조트 조식' },
    schedule: [
      normal('리조트 조식 후'),
      normal('리조트 전일 자유시간'),
    ],
    hotel: { name: h.accommodation, grade: h.grade || '디럭스룸', note: null },
  };
}

// 체크아웃일 (기내박): 당일 이동 후 야간 항공 대기
function _dCheckout(dayNum, inserter) {
  const { normal } = _helpers(inserter);
  return {
    day: dayNum,
    regions: ['보홀'],
    meals: { breakfast: true, lunch: false, dinner: false, notes: '리조트 조식' },
    schedule: [
      normal('리조트 조식후 CHECK-OUT'),
      normal('전일 자유시간 후 현지인 매니저 미팅후 공항으로 이동'),
    ],
    hotel: { name: null, grade: null, note: '기내박' },
  };
}

// 귀국일
function _dReturn(dayNum, flightIn, inserter) {
  const { flight, normal } = _helpers(inserter);
  return {
    day: dayNum,
    regions: ['보홀', '부산'],
    meals: { breakfast: false, lunch: false, dinner: false, notes: '' },
    schedule: [
      flight(flightIn.dep, `보홀(팡라오) 출발 → 부산(김해) 도착 ${flightIn.arr}`, flightIn.code),
      normal('부산 김해국제공항 도착'),
    ],
    hotel: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  핵심 공개 API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * buildBoholPackages(config) → package[] (inserter.run() 에 전달할 배열)
 *
 * config:
 *   inserter          createInserter() 결과
 *   hotels            [{idx, key, label, accommodation, grade?}]
 *                     idx = priceDates rows 의 prices[] 인덱스 (0-based)
 *   flightOut         {code, dep, arr}  dep/arr = 'HH:MM', arr 에 '+1' 포함 가능
 *   flightIn          {code, dep, arr}
 *   priceDates3D      [{date:'YYYY-MM-DD', prices:[n0,n1,...]}]  3박5일 가격행
 *   priceDates4D      [{date:'YYYY-MM-DD', prices:[n0,n1,...]}]  4박6일 가격행 (없으면 생략)
 *   inclusions        string[]  — 반드시 raw_text verbatim substrings
 *   excludes          string[]
 *   notices           [{type:'CRITICAL'|'POLICY'|'INFO', title, text}]
 *   rawText           string  — 원문 그대로 (Rule Zero)
 *   activityNote      string  — D3 활동 verbatim (기본값: 투어비 표준)
 *   optionalTours     []  (기본값: 빈 배열)
 *   productHighlights string[]  (없으면 자동)
 *   productSummary    string   (없으면 null → 등록 후 AI 생성)
 */
function buildBoholPackages(config) {
  const {
    inserter,
    hotels,
    flightOut,
    flightIn,
    priceDates3D = [],
    priceDates4D = [],
    inclusions,
    excludes,
    notices,
    rawText,
    activityNote = '▶ 아일랜드마린 호핑투어(중식 불포함) 또는 필리핀 전통 오일마사지(팁별도) 1시간 중 택1',
    optionalTours = [],
    productHighlights,
    productSummary,
  } = config;

  if (!inserter) throw new Error('[BHO assembler] inserter 는 필수입니다.');
  if (!hotels || hotels.length === 0) throw new Error('[BHO assembler] hotels 배열이 비어있습니다.');
  if (!rawText || rawText.length < 50) throw new Error('[BHO assembler] rawText 가 누락되거나 너무 짧습니다 (Rule Zero).');

  const rawTextHash = crypto.createHash('sha256').update(rawText, 'utf8').digest('hex');

  function priceDatesFor(rows, colIdx) {
    return rows
      .filter(r => Array.isArray(r.prices) && r.prices[colIdx] != null && r.prices[colIdx] > 0)
      .map(r => ({ date: r.date, price: r.prices[colIdx], confirmed: false }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  function metaString(suffix) {
    return {
      flight_out: `${flightOut.code} ${flightOut.dep} 부산(김해) → ${flightOut.arr} 보홀(팡라오) 익일`,
      flight_in: `${flightIn.code} ${flightIn.dep} 보홀(팡라오) → ${flightIn.arr} 부산(김해)`,
      airline: flightOut.code.substring(0, 2),
      flight_out_time: flightOut.dep,
    };
  }

  function buildDays3(h) {
    return [
      _d1(h, flightOut, inserter),           // D1: 출발→도착→체크인
      _d2(h, inserter),                      // D2: 자유
      _d3(h, 3, activityNote, inserter),     // D3: 액티비티
      _dCheckout(4, inserter),               // D4: 체크아웃 (기내박)
      _dReturn(5, flightIn, inserter),       // D5: 귀국
    ];
  }

  function buildDays4(h) {
    return [
      _d1(h, flightOut, inserter),           // D1: 출발→도착→체크인
      _d2(h, inserter),                      // D2: 자유
      _d3(h, 3, activityNote, inserter),     // D3: 액티비티
      _dFree(h, 4, inserter),               // D4: 자유 (4박 추가)
      _dCheckout(5, inserter),              // D5: 체크아웃 (기내박)
      _dReturn(6, flightIn, inserter),      // D6: 귀국
    ];
  }

  const packages = [];

  for (const h of hotels) {
    const pd3 = priceDatesFor(priceDates3D, h.idx);
    const pd4 = priceDatesFor(priceDates4D, h.idx);

    if (pd3.length > 0) {
      packages.push({
        raw_text: rawText,
        raw_text_hash: rawTextHash,
        duration_nights: 3,
        duration_days: 5,
        inclusions,
        excludes,
        notices,
        accommodations: [{ name: h.accommodation, nights: 3, grade: h.grade || '디럭스룸', note: null }],
        itinerary_data: { meta: metaString(), days: buildDays3(h) },
        price_dates: pd3,
        optional_tours: optionalTours,
        ...(productHighlights && { product_highlights: productHighlights }),
        ...(productSummary && { product_summary: productSummary }),
      });
    }

    if (pd4.length > 0) {
      packages.push({
        raw_text: rawText,
        raw_text_hash: rawTextHash,
        duration_nights: 4,
        duration_days: 6,
        inclusions,
        excludes,
        notices,
        accommodations: [{ name: h.accommodation, nights: 4, grade: h.grade || '디럭스룸', note: null }],
        itinerary_data: { meta: metaString(), days: buildDays4(h) },
        price_dates: pd4,
        optional_tours: optionalTours,
        ...(productHighlights && { product_highlights: productHighlights }),
        ...(productSummary && { product_summary: productSummary }),
      });
    }
  }

  return packages;
}

// ─────────────────────────────────────────────────────────────────────────────
//  BLOCKS 카탈로그 (stub에서 이관, P2 CLI 모드용)
//  현재는 참조 전용. CLI 구현 시 parseRawText() 의 매칭 후보로 사용.
// ─────────────────────────────────────────────────────────────────────────────

const BLOCKS = [
  { code: 'BHO-M001', name: '전통오일마사지 1시간', type: 'massage', duration: 'half',
    keywords: ['전통오일마사지 1시간', '전통오일마사지1시간', '전통오일마사지', '전신마사지', '오일마사지'] },
  { code: 'BHO-T002', name: '보홀 아일랜드 호핑투어', type: 'tour', duration: 'half',
    keywords: ['아일랜드마린 호핑투어', '아일랜드 호핑투어', '호핑투어', '보홀 아일랜드 호핑투어', '아일랜드호핑투어'] },
  { code: 'BHO-T003', name: '보홀 데이투어', type: 'tour', duration: 'full',
    keywords: ['보홀 데이투어', '보홀데이투어', '데이투어', '어드벤처'] },
  { code: 'BHO-S004', name: '초콜릿힐', type: 'sightseeing', duration: 'half',
    keywords: ['초콜릿힐', '초콜렛힐', 'Chocolate Hills'] },
  { code: 'BHO-S005', name: '안경원숭이', type: 'sightseeing', duration: 'half',
    keywords: ['안경원숭이', '타르시어원숭이', '타리스어원숭이', 'Tarsier'] },
  { code: 'BHO-S006', name: '맨메이드 포레스트', type: 'sightseeing', duration: 'half',
    keywords: ['맨메이드포레스트', '멘메이드포레스트', 'Bilar Manmade Forest'] },
  { code: 'BHO-T007', name: '발리카삭 호핑투어', type: 'tour', duration: 'half',
    keywords: ['발리카삭 호핑투어', '발리카삭호핑투어', '발리카삭'] },
  { code: 'BHO-T008', name: '나팔링투어', type: 'tour', duration: 'half',
    keywords: ['나팔링투어', '정어리떼 스노클링 나팔링투어'] },
  { code: 'BHO-T009', name: '반딧불투어', type: 'tour', duration: 'half',
    keywords: ['반딧불투어'] },
  { code: 'BHO-S010', name: '보홀 시내관광', type: 'sightseeing', duration: 'half',
    keywords: ['보홀 시내관광', '보홀시내관광', '사왕 재래시장', '성어거스틴 성당'] },
  { code: 'BHO-A011', name: '스쿠버다이빙', type: 'activity', duration: 'half',
    keywords: ['스쿠버다이빙', '다이빙', '스쿠버'] },
  { code: 'BHO-S012', name: '팡라오성당', type: 'sightseeing', duration: 'half',
    keywords: ['팡라오성당', '성어거스틴성당', 'Saint Augustine Church Panglao'] },
];

module.exports = { buildBoholPackages, BLOCKS };
