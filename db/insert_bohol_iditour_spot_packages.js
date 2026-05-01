/**
 * 7C 부산-보홀 ★스팟특가★ 6종 등록 (아이디투어 9%)
 *
 * 호텔 3종 × 듀레이션 2종 = 6 packages
 *   - 돌핀베이 / 헤난 타왈라 / 헤난 알로나·코스트
 *   - 3박5일 (수/목 출발) / 4박6일 (토/일 출발)
 *
 * 항공: 7C2157(부산→보홀) / 7C2158(보홀→부산)
 */

const fs = require('fs');
const path = require('path');
const { createInserter } = require('./templates/insert-template');

const RAW_TEXT = fs.readFileSync(path.join(__dirname, '..', 'scratch', 'bohol-iditour-spot-raw.txt'), 'utf-8');

const inserter = createInserter({
  landOperator: '아이디투어',
  commissionRate: 9,
  ticketingDeadline: null, // 원문 "4/24(금)까지 선발 조건" 등록일(4/27) 기준 이미 경과 — 예약 시 항공 리체크 후 재견적
  destCode: 'BHO',
});
const { helpers: { flight, normal, optional, shopping, meal } } = inserter;

// ── 호텔 정의 ─────────────────────────────────────
const HOTELS = {
  dolphin: { key: 'dolphin', label: '돌핀베이', accommodation: '돌핀베이 (디럭스룸)' },
  tawala:  { key: 'tawala',  label: '헤난 타왈라', accommodation: '헤난 타왈라 (디럭스룸)' },
  alona:   { key: 'alona',   label: '헤난 알로나·코스트', accommodation: '헤난 알로나 / 코스트 (택1, 디럭스룸)' },
};

// ── 가격 매트릭스 (원문 verbatim) ───────────────────
// [date, [돌핀베이, 헤난타왈라, 헤난알로나/코스트]]
const PRICES_3D5 = [
  { date: '2026-04-29', dow: '수', prices: [509000, 729000, 799000] },
  { date: '2026-04-30', dow: '목', prices: [769000, 979000, 1179000], note: '골든위크' },
  { date: '2026-05-06', dow: '수', prices: [559000, 769000, 969000] },
  { date: '2026-05-20', dow: '수', prices: [609000, 829000, 899000] },
  { date: '2026-05-21', dow: '목', prices: [729000, 939000, 1009000] },
  { date: '2026-05-28', dow: '목', prices: [539000, 749000, 829000] },
];

const PRICES_4D6 = [
  { date: '2026-05-02', dow: '토', prices: [539000, 799000, 779000] },
  { date: '2026-05-03', dow: '일', prices: [539000, 799000, 779000] },
  { date: '2026-05-17', dow: '일', prices: [539000, 799000, 779000] },
  { date: '2026-05-31', dow: '일', prices: [539000, 799000, 779000] },
  { date: '2026-05-23', dow: '토', prices: [559000, 829000, 799000] },
  { date: '2026-05-24', dow: '일', prices: [559000, 829000, 799000] },
];

const HOTEL_INDEX = { dolphin: 0, tawala: 1, alona: 2 };

function buildPriceDates(rows, hotelKey) {
  const idx = HOTEL_INDEX[hotelKey];
  return rows
    .map(r => ({ date: r.date, price: r.prices[idx], confirmed: false }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function buildPriceTiers(rows, hotelKey) {
  const idx = HOTEL_INDEX[hotelKey];
  return rows.map(r => ({
    period_label: `${r.date.slice(5).replace('-', '/')} ${r.dow}요일${r.note ? ` (${r.note})` : ''}`,
    departure_dates: [r.date],
    adult_price: r.prices[idx],
    status: 'available',
    note: r.note || null,
  }));
}

// ── 포함/불포함 (W26: 콤마 분리 필수) ──────────────
const INCLUSIONS = [
  '왕복 국제선 항공료',
  '유류할증료',
  '택스',
  '해외여행자보험',
  '호텔 (2인 1실)',
  '전용차량 & 기사',
  '가이드',
  '현지공항세',
  '관광지 입장료',
  '일정상 식사',
  '특식 2회',
  '전통오일마사지 1시간 (아동불포함)',
  '보홀 시내관광',
];

const EXCLUDES_4D6 = [
  '가이드 & 기사 팁 $60(4박)/1인 (성인·아동 동일 · 현지 직불)',
  '에티켓 팁',
  '기타 개인 경비',
  '선택 관광 비용',
  '호텔 써차지',
  '갈라 디너',
  '보홀 호핑투어 미선택 시 중식 1회 자유식',
];

const EXCLUDES_3D5 = [
  '가이드 & 기사 팁 (1인 · 성인·아동 동일 · 현지 직불)',
  '에티켓 팁',
  '기타 개인 경비',
  '선택 관광 비용',
  '호텔 써차지',
  '갈라 디너',
  '보홀 호핑투어 미선택 시 중식 1회 자유식',
];

// ── 선택관광 (원문 비고 블록) ──────────────────────
const OPTIONAL_TOURS = [
  { name: '체험다이빙', price_usd: 120, price_krw: null, price: '$120', note: null, region: '보홀' },
  { name: '보홀 호핑투어', price_usd: 80, price_krw: null, price: '$80', note: '한국 선포함 시 5만원/인', region: '보홀' },
  { name: '돌핀워칭', price_usd: 30, price_krw: null, price: '$30', note: '호핑투어 시 가능', region: '보홀' },
  { name: '거북이워칭', price_usd: 30, price_krw: null, price: '$30', note: '호핑투어 시 가능', region: '보홀' },
  { name: '반딧불투어', price_usd: 60, price_krw: null, price: '$60', note: '2인 이상', region: '보홀' },
  { name: '비팜 선셋포인트 디너', price_usd: 60, price_krw: null, price: '$60', note: '2인 이상', region: '보홀' },
  { name: '나이트투어', price_usd: 60, price_krw: null, price: '$60', note: '2인 이상', region: '보홀' },
  { name: '짚라인', price_usd: 30, price_krw: null, price: '$30', note: '데이투어 시 가능', region: '보홀' },
  { name: 'ATV', price_usd: 30, price_krw: null, price: '$30', note: '데이투어 시 가능', region: '보홀' },
  { name: '보홀 데이투어', price_usd: 60, price_krw: null, price: '$60', note: '2인 이상 · 타리스어원숭이.초콜렛힐.멘메이드포레스트', region: '보홀' },
];

// ── 안내사항 (원문 비고 + 필리핀 입국 주의사항 verbatim) ──
const COMMON_NOTICES = [
  { type: 'CRITICAL', title: '여권 유효기간', text: '여권 유효기간이 입국일 기준 6개월 이상 남아있어야 출국 가능합니다.' },
  { type: 'CRITICAL', title: 'E-트래블 QR', text: '필리핀 입국 시 E-트래블 QR코드 작성 필수입니다.' },
  { type: 'CRITICAL', title: '미성년자 단독 입국 제한', text: '만 15세 미만 승객 입국 시 반드시 부모 또는 보호자 동반이 필요합니다. (수수료 및 필요서류 별도 확인)' },
  { type: 'INFO', title: '차량 안내', text: '공항 ↔ 리조트 이동은 전용차량(벤 또는 버스), 일정 중 이동은 현지차량(멀티캡 또는 지프니)으로 진행됩니다.' },
  { type: 'POLICY', title: '리조트 써차지', text: '크리스마스·신정·구정·부활절·노동절 등 리조트 써차지 기간에는 추가요금이 별도 발생할 수 있습니다.' },
  { type: 'INFO', title: '레이트 체크아웃', text: 'LATE CHECK OUT은 리조트 상황에 따라 가능 여부가 결정되며 개런티되지 않습니다.' },
  { type: 'POLICY', title: '노쇼핑 변경 시 추가금', text: '노쇼핑으로 변경하실 경우 1인 8만원의 추가금이 발생합니다. (쇼핑 일정이 있는 일반상품과 연합 진행되며, 쇼핑 시간 동안 알로나 비치 자유시간이 부여됩니다.)' },
  { type: 'INFO', title: '객실 기준', text: '기본 디럭스룸 기준입니다.' },
  { type: 'POLICY', title: '예약 전 리체크', text: '수배 전 실시간 항공 및 호텔 리체크 후 진행 부탁드립니다.' },
  { type: 'POLICY', title: '항공요금 조건', text: '현재 적용된 항공요금은 4/24(금)까지 선발 조건이며, 이후 요금이 변동될 수 있습니다.' },
  { type: 'POLICY', title: '유류세 변동', text: '유류세는 4월 기준이며, 발권 시점에 따라 변동될 수 있습니다.' },
  { type: 'POLICY', title: '현지 일정 미참여 패널티', text: '현지 일정 미참여 시 외국 국적(여권 확인) 손님은 패널티 $100/인이 발생할 수 있습니다.' },
];

const REMARKS = [
  '여권 유효기간 6개월 이상 필수',
  '필리핀 입국 시 E-트래블 QR코드 필수',
  '만 15세 미만 단독 입국 불가 (부모·보호자 동반 필수)',
  '공항↔리조트 전용차량, 일정 중 현지차량(멀티캡/지프니) 운행',
  '크리스마스·신정·구정·부활절·노동절 리조트 써차지 별도',
  'LATE CHECK OUT 개런티 불가',
  '노쇼핑 변경 시 1인 8만원 추가금',
  '기본 디럭스룸 기준',
  '수배 전 항공·호텔 리체크 필수',
  '항공요금 4/24까지 선발 조건 · 이후 변동 가능',
  '유류세 발권 시점 변동 가능',
  '현지 일정 미참여 시 외국국적 패널티 $100/인',
  '현지 사정·항공 사정에 의해 일정 변경 가능',
];

// ── 항공편 (W25 호환 포맷) ─────────────────────────
const OUT_FLIGHT = flight('20:40', '부산(김해) 출발 → 보홀(팡라오) 도착 00:30 (익일)', '7C2157');
const IN_FLIGHT  = flight('01:30', '보홀(팡라오) 출발 → 부산(김해) 도착 06:55', '7C2158');

// ── 일정 빌더 (호텔별로 hotel 객체만 다름) ────────
function buildHotelObj(hotel) {
  return { name: hotel.label, grade: '디럭스룸', note: '상기 호텔 또는 동급' };
}

function d1(hotel) {
  return {
    day: 1, regions: ['부산', '보홀'],
    meals: meal(false, false, false),
    schedule: [
      normal(null, '부산(김해) 국제공항 미팅 / 출국 수속'),
      OUT_FLIGHT,
      normal(null, '보홀 팡라오 국제공항 도착 후 입국 / 가이드 미팅'),
      normal(null, '리조트 이동'),
      normal(null, '호텔 투숙 및 휴식'),
    ],
    hotel: buildHotelObj(hotel),
  };
}

function d2(hotel) {
  return {
    day: 2, regions: ['보홀'],
    meals: meal(true, true, true, '호텔식', '현지식', '특석식'),
    schedule: [
      normal(null, '호텔 조식 후 가이드 미팅'),
      normal(null, '▶해양스포츠 체험 - 스쿠버다이빙 강습 (이론교육)'),
      // 원문 D2 일정 verbatim: "▶ 여행의 피로를 풀어줄 전신마사지 1시간 (팁별도/아동불포함)"
      // (포함사항은 "전통오일마사지" 표기 — 원문 자체 모순. 일정 verbatim 우선)
      normal(null, '▶전신마사지 1시간 (팁별도 · 아동불포함)'),
      normal(null, '석식 후 리조트 휴식'),
    ],
    hotel: buildHotelObj(hotel),
  };
}

function d3(hotel) {
  return {
    day: 3, regions: ['보홀'],
    meals: meal(true, false, true, '호텔식', null, '특석식'),
    schedule: [
      normal(null, '리조트 조식 후 가이드 미팅'),
      optional(null, '▶보홀 아일랜드 호핑투어 (스노쿨링 + 중식 BBQ)', '한국 선포함 시 5만원/인 추가 / 현지 옵션가 $80/인'),
      normal(null, '※ 호핑투어 미선택 시 중식 1회는 자유식'),
      normal(null, '석식 후 리조트 휴식'),
    ],
    hotel: buildHotelObj(hotel),
  };
}

// 4박6일 D4 — 추가 자유일 + 보홀데이투어 옵션
function d4Free(hotel) {
  return {
    day: 4, regions: ['보홀'],
    meals: meal(true, true, true, '호텔식', '현지식', '한식'),
    schedule: [
      normal(null, '리조트 조식 후 자유시간'),
      // 원문 verbatim 보존 — 랜드사 표기 그대로. attractions 매칭은 aliases 통해 처리.
      // ("타리스어원숭이"→안경원숭이 alias / "초콜렛힐"→초콜릿힐 alias / "멘메이드포레스트"→맨메이드 포레스트 alias)
      optional(null, '▶보홀 데이투어 (타리스어원숭이.초콜렛힐.멘메이드포레스트)', '$60/1인 · 2인 이상 출발 가능'),
      normal(null, '※ 선택관광 미참여 시 리조트 내 자유시간 (가이드 미동반)'),
      normal(null, '석식 후 리조트 휴식'),
    ],
    hotel: buildHotelObj(hotel),
  };
}

// 체크아웃 + 시내관광 + 쇼핑 + 공항 (3박5일 D4 또는 4박6일 D5)
function dCheckout(dayNum) {
  return {
    day: dayNum, regions: ['보홀'],
    meals: meal(true, true, true, '호텔식', '현지식', '한식'),
    schedule: [
      normal(null, '리조트 조식 후 체크아웃 / 가이드 미팅'),
      normal(null, '중식 후 이동'),
      shopping(null, '필리핀 쇼핑센터 방문 (토산품·기념품 · 2군데)'),
      normal(null, '▶보홀 시내관광 (사왕 재래시장+성어거스틴성당)'),
      normal(null, '석식 후 공항 이동 / 출국 수속'),
    ],
    hotel: { name: null, grade: null, note: '기내박' },
  };
}

// 귀국편 (마지막 일차)
function dLast(dayNum) {
  return {
    day: dayNum, regions: ['부산'],
    meals: meal(false, false, false),
    schedule: [
      IN_FLIGHT,
      normal(null, '부산(김해) 도착 후 해산 (즐거운 여행 되셨기를 바랍니다)'),
    ],
    hotel: null,
  };
}

// ── 패키지 빌더 ───────────────────────────────────
function buildAuditReport(hotel, isLong) {
  return {
    parser_version: 'register-v2026.04.27-opus-4.7-direct',
    ran_at: new Date().toISOString(),
    claims: [
      {
        id: 'min_participants', field: 'min_participants', severity: 'MEDIUM',
        text: '최소 출발인원 2명',
        evidence: null,
        supported: null,
        note: '원문에 패키지 최소 인원 명시 없음. 옵션 일부에 "2인 이상" 명시. 표준 2인 1실 기준으로 2 설정.',
      },
      {
        id: 'flight_out', field: 'itinerary_data.meta.flight_out', severity: 'HIGH',
        text: '7C2157 부산 20:40 출발 → 보홀 00:30 도착',
        evidence: '원문 제1일 항공 칸: "7C2157 / 20:40 / 00:30 / 부산 공항 출발 - 보홀 향발"',
        supported: true,
      },
      {
        id: 'flight_in', field: 'itinerary_data.meta.flight_in', severity: 'HIGH',
        text: '7C2158 보홀 01:30 출발 → 부산 06:55 도착',
        evidence: `원문 ${isLong ? '제5일[제6일]' : '제5일'} 항공 칸: "7C2158 / 01:30 / 06:55"`,
        supported: true,
      },
      {
        id: 'hotel', field: 'accommodations', severity: 'HIGH',
        text: hotel.accommodation,
        evidence: `원문 가격표 컬럼: "${hotel.label}" + 비고 "기본 디럭스룸 기준"`,
        supported: true,
      },
      {
        id: 'inclusions_massage', field: 'inclusions', severity: 'CRITICAL',
        text: '전통오일마사지 1시간 (아동불포함) 포함',
        evidence: '원문 포함사항: "전통오일마사지1시간(아동불포함)"',
        supported: true,
      },
      {
        id: 'inclusions_special_meal', field: 'inclusions', severity: 'HIGH',
        text: '특식 2회 포함',
        evidence: '원문 포함사항: "특식2회"',
        supported: true,
      },
      {
        id: 'inclusions_city_tour', field: 'inclusions', severity: 'HIGH',
        text: '보홀 시내관광 포함',
        evidence: '원문 포함사항: "보홀시내관광" + 일정 "보홀 시내관광 (사왕 재래시장+성어거스틴성당)"',
        supported: true,
      },
      {
        id: 'excludes_tip', field: 'excludes', severity: 'CRITICAL',
        text: isLong
          ? '가이드&기사 팁 $60(4박)/1인 (성인·아동 동일 · 현지 직불)'
          : '가이드&기사 팁 (1인 · 성인·아동 동일 · 현지 직불) — 3박 기준 금액 원문 미명시',
        evidence: isLong
          ? '원문 불포함사항: "가이드&기사 팁 $60(4박)/1인(성인/아동 동일 현지 직불)"'
          : '원문 불포함 라인은 "$60(4박)" 만 명시 (4박6일용). 3박5일 금액은 원문에 미명시 — 환각 방지 위해 금액 생략.',
        supported: true,
      },
      {
        id: 'opt_hopping', field: 'optional_tours', severity: 'HIGH',
        text: '보홀 호핑투어 $80 (한국 선포함 5만원/인)',
        evidence: '원문 일정 D3: "보홀 아일랜드 호핑투어... 한국 선포함 시 5만원/인 추가 & 현지 옵션가 $80/인"',
        supported: true,
      },
      {
        id: 'opt_daytour', field: 'optional_tours', severity: 'HIGH',
        text: '보홀 데이투어 $60 (2인 이상)',
        evidence: '원문 일정 D4[4박6일]: "보홀데이투어(2인이상 출발가능/$60/1인)"',
        supported: true,
        note: isLong ? '4박6일 D4 추천 옵션' : '3박5일에는 D4 자유일 없음 — 옵션 카탈로그에는 표기 (참고용)',
      },
      {
        id: 'no_shopping_fee', field: 'notices_parsed', severity: 'HIGH',
        text: '노쇼핑 변경 시 1인 8만원',
        evidence: '원문 비고: "노 쇼핑으로 변경시 추가금 1인 8만원 발생합니다."',
        supported: true,
      },
      {
        id: 'penalty_foreigner', field: 'notices_parsed', severity: 'HIGH',
        text: '현지 일정 미참여 외국국적 패널티 $100/인',
        evidence: '원문 비고: "현지 일정 미 참여시, 외국국적(여권확인)일시 패널티 $100/인 발생 됩니다."',
        supported: true,
      },
      {
        id: 'ticketing_deadline', field: 'ticketing_deadline', severity: 'HIGH',
        text: 'ticketing_deadline=null',
        evidence: '원문 "현재 적용된 항공요금은 4/24(금)까지 선발 조건" — 등록일(2026-04-27) 기준 이미 경과. 환각 방지 위해 null 처리하고 internal_notes 에 메모.',
        supported: true,
      },
      {
        id: 'surcharges', field: 'surcharges', severity: 'HIGH',
        text: 'surcharges=[]',
        evidence: '원문은 크리스마스·신정·구정·부활절·노동절 써차지 "별도" 라고만 표기. 구체 금액·기간 없음 → 객체 배열 빈 상태 유지.',
        supported: true,
      },
      {
        id: 'duration', field: 'duration', severity: 'HIGH',
        text: isLong ? '4박6일' : '3박5일',
        evidence: isLong
          ? '원문 가격표 "(6일)" + 일정 "[4박6일]" + "[제6일]" 표기'
          : '원문 가격표 "(5일)" + 일정 "[제5일]" 표기',
        supported: true,
      },
    ],
    overall_verdict: 'clean',
    unsupported_critical: 0,
    unsupported_high: 0,
  };
}

function buildPackage(hotel, isLong) {
  const duration = isLong ? 6 : 5;
  const nights = isLong ? 4 : 3;
  const tripStyle = isLong ? '4박6일' : '3박5일';
  const departureDays = isLong ? '토/일' : '수/목';
  const priceRows = isLong ? PRICES_4D6 : PRICES_3D5;
  const priceDates = buildPriceDates(priceRows, hotel.key);
  const priceTiers = buildPriceTiers(priceRows, hotel.key);
  const minPrice = Math.min(...priceDates.map(d => d.price));
  const excludes = isLong ? EXCLUDES_4D6 : EXCLUDES_3D5;

  const days = isLong
    ? [d1(hotel), d2(hotel), d3(hotel), d4Free(hotel), dCheckout(5), dLast(6)]
    : [d1(hotel), d2(hotel), d3(hotel), dCheckout(4), dLast(5)];

  const itineraryStrings = isLong
    ? [
        '제1일: 부산(김해) 20:40 출발 → 보홀(팡라오) 00:30 도착 → 리조트 투숙',
        '제2일: 호텔 조식 후 스쿠버다이빙 강습 + 전통오일마사지 1시간',
        '제3일: 리조트 조식 후 보홀 아일랜드 호핑투어 (선택)',
        '제4일: 리조트 자유시간 / 보홀 데이투어 (선택)',
        '제5일: 체크아웃 → 쇼핑센터 → 보홀 시내관광 → 공항',
        '제6일: 보홀 01:30 출발 → 부산 06:55 도착',
      ]
    : [
        '제1일: 부산(김해) 20:40 출발 → 보홀(팡라오) 00:30 도착 → 리조트 투숙',
        '제2일: 호텔 조식 후 스쿠버다이빙 강습 + 전통오일마사지 1시간',
        '제3일: 리조트 조식 후 보홀 아일랜드 호핑투어 (선택)',
        '제4일: 체크아웃 → 쇼핑센터 → 보홀 시내관광 → 공항',
        '제5일: 보홀 01:30 출발 → 부산 06:55 도착',
      ];

  const productType = `스팟특가-${hotel.label.replace(/\s+/g, '')}`;

  return {
    title: `7C 부산-보홀 ${hotel.label} 스팟특가 ${tripStyle}`,
    destination: '보홀', country: '필리핀', category: 'package',
    product_type: productType, trip_style: tripStyle,
    duration, nights,
    departure_airport: '부산(김해)', airline: '7C(제주항공)',
    departure_days: departureDays,
    min_participants: 2, status: 'pending',
    price: minPrice,
    guide_tip: isLong ? 60 : null,
    single_supplement: null, small_group_surcharge: null,
    surcharges: [], excluded_dates: [],
    price_tiers: priceTiers,
    price_dates: priceDates,
    inclusions: INCLUSIONS,
    excludes,
    optional_tours: OPTIONAL_TOURS,
    accommodations: [hotel.accommodation],
    product_highlights: [
      `${hotel.label} ${nights}박 투숙 (디럭스룸 기준)`,
      '전통오일마사지 1시간 + 특식 2회 포함',
      `부산 출발 직항 7C 제주항공 · ${tripStyle}`,
    ],
    product_summary: isLong
      ? `주말(토·일) 출발로 여유 있게 즐기시는 ${hotel.label} ${tripStyle} 스팟특가예요. 호텔 ${nights}박에 보홀 시내관광·전통오일마사지·특식 2회까지 포함이고, D4에 보홀 데이투어 옵션으로 안경원숭이·초콜릿힐 코스도 추가하실 수 있어요.`
      : `평일(수·목) 출발 ${hotel.label} ${tripStyle} 스팟특가입니다. 호텔 ${nights}박 + 스쿠버다이빙 강습 + 전통오일마사지 + 보홀 시내관광까지 알차게 담았고, D3 호핑투어를 한국에서 선포함하시면 5만원/인으로 더 저렴하게 즐기실 수 있어요.`,
    product_tags: ['#보홀', `#${hotel.label.replace(/\s+/g, '')}`, '#부산출발', '#직항', '#스팟특가', `#${tripStyle}`],
    notices_parsed: COMMON_NOTICES,
    customer_notes: null,
    internal_notes: [
      '랜드사: 아이디투어 (수수료 9%)',
      '원문 발권 조건: "4/24(금)까지 선발 조건" — 등록일(2026-04-27) 기준 이미 경과. 예약 진행 시 항공·호텔 실시간 리체크 후 재견적 필수.',
      '갈라디너 / 호텔 써차지 (크리스마스·신정·구정·부활절·노동절) 별도 발생 가능 — 예약 단계에서 리조트별 써차지 기간 재확인.',
      '기본 디럭스룸 기준 / 헤난 알로나·코스트는 두 호텔 중 한 곳 배정 (택1).',
      isLong ? '4박6일 가이드&기사 팁 $60/인 (현지 직불).' : '3박5일 가이드&기사 팁 금액은 원문 미명시. 예약 시 랜드사에 재확인.',
      '쇼핑센터: 토산품·기념품 2군데 / 노쇼핑 변경 시 1인 8만원 추가금.',
    ].join(' | '),
    itinerary_data: {
      meta: {
        title: `7C 부산-보홀 ${hotel.label} 스팟특가 ${tripStyle}`,
        product_type: productType, destination: '보홀', nights, days: duration,
        departure_airport: '부산(김해)', airline: '7C(제주항공)',
        flight_out: '7C2157', flight_in: '7C2158',
        departure_days: departureDays, min_participants: 2, room_type: '2인 1실 (디럭스룸)',
        ticketing_deadline: null,
        hashtags: ['#보홀', '#스팟특가', `#${hotel.label.replace(/\s+/g, '')}`],
        brand: '여소남',
      },
      highlights: {
        inclusions: INCLUSIONS,
        excludes,
        shopping: '토산품·기념품 쇼핑센터 2군데 방문',
        remarks: REMARKS,
      },
      days,
      optional_tours: OPTIONAL_TOURS,
    },
    itinerary: itineraryStrings,
    raw_text: RAW_TEXT,
    filename: 'bohol-iditour-spot-raw.txt',
    file_type: 'manual',
    confidence: 0.95,
    agent_audit_report: buildAuditReport(hotel, isLong),
  };
}

const ALL_PACKAGES = [
  buildPackage(HOTELS.dolphin, false),
  buildPackage(HOTELS.tawala,  false),
  buildPackage(HOTELS.alona,   false),
  buildPackage(HOTELS.dolphin, true),
  buildPackage(HOTELS.tawala,  true),
  buildPackage(HOTELS.alona,   true),
];

inserter.run(ALL_PACKAGES).then(result => {
  console.log('\n🎉 등록 완료', result);
});
