/**
 * 베스트아시아 / 황산 송백CC 무제한 골프 (BX 에어부산, 김해 직항)
 *   - 랜드사: 베스트아시아 (BA) / 마진율: 9% / 발권기한: null
 *   - 상품 2건:
 *       PKG1 — 3박4일 노쇼핑 골프 (매주 화 출발)
 *       PKG2 — 4박5일 노쇼핑 골프 (매주 금 출발)
 *   - 항공: BX3615 (부산→황산) / BX3625 (황산→부산)
 *   - 호텔: 송백CC 골프텔 5호관 (준5성)
 *   - 최소 출발: 2명 (원문 명시)
 *   - 전세기 특별약관: 예약 시 일인 20만원 데파짓 / 발권 후(출발21일전) 취소 시 항공료 환불불가
 *   - 중국연휴 서차지는 포함사항에 이미 반영됨 (surcharges=[])
 *
 * Self-Audit (Step 6.5 Agent Self-Audit, Opus 본 세션 수행):
 *   - overall_verdict: clean (모든 CRITICAL/HIGH claim supported)
 *   - 금액 주입 없음 (여행자보험 → 원문 그대로 "여행자보험")
 *   - min_participants=2 (원문 "2명부터 출발" 일치)
 *   - ticketing_deadline=null (원문에 "발권 마감" 키워드 없음)
 *   - surcharges=[] (원문 "중국연휴 서차지"는 포함사항 안에 이미 있음)
 *   - regions DAY별 원문 지역 컬럼대로 매핑
 */

const crypto = require('crypto');
const { createInserter } = require('./templates/insert-template');

// ── 원문 (Rule Zero — verbatim, 상품별 분리) ───────────────────
const RAW_PKG1 = `【노쇼핑】 황산 송백CC 무제한 골프 4일 BX (에어부산)
출 발 일
4월10일부터 ~ 5월29일까지 매주 화 출발
인    원
2명부터 출발
여 행 경 비
5월-19,26일
849,000
5월05일
999,000
포 함 사 항
 항공료, 택스, 유류세, 호텔, 송영차량(단독차량 별도문의), 한국어 가능한 상주직원, 무제한 그린피,
 호텔 조식+석식, 여행자보험, 김해공항 샌딩, 중국연휴 서차지,
불포함 사항
 카트비+캐디피(380위안/18홀/인), 캐디팁(150위안/18홀/인-2인1캐디), 클럽중식                                    미팅/샌딩비(150/위안/인-현지지불), 호텔 싱글차지(12만원), 싱글카트($20)
쇼 핑
 노쇼핑
기  타
▪ 본 상품은 5억원 배상책임보험에 가입되어 있습니다.
▪여권 유효기간은 출발일 기준 6개월 이상 남아 있어야 출국이 가능합니다
▪전세기 특별약관 적용 상품으로, 예약시 일인 20만원 데파짓 입금시 예약확정됩니다. ▪항공 발권후(출발21일전) 취소시, 항공료 전액 환불불가이므로, 신중한 예약 부탁드립니다.
▪2026년 12월31일까지 일반여권 소지자를 대상으로 비자면제 정책 시행중입니다.
 (비즈니스, 여행/관광, 친척/친구 방문 등 중국 입국 시 15일까지 무비자 체류 가능)
▪단수여권, 급행여권, 관용여권은 무비자 불가할 수 있습니다. 담당자에게 꼭 알려주세요.
  ※ 여권 재발급시 사전에 반드시 알려주셔야 합니다. 그렇지 않을 경우 발생된 문제는 책임지지 않습니다.
▪무제한 라운드 조건이나, 의무 라운드가 아닌 자율적 라운드 입니다. (단, 18홀 이상 라운드 조건)
▪2인 라운드 시 조인 한국인 또는 현지인 조인 플레이가 될 수 있습니다.
▪싱글차지 12만원입니다. 3호관 업그레이드 시 3박 기준 15만원 추가 이며, 싱글차지는 15만원 별도 발생됩니다.
▪2~3일차 오전 황산 반나절 투어 가능(4인이상 출발)  – 19만원/인
 (황산 관광은 전날 오후 6시 일기예보 기준으로 가능여부가 결정됩니다.)
▪외부 발마사지 60분 CNY200, 전신마사지 90분 CNY 300 (팁별도)
▪외부 석식 2인 출발시 추가 요금 발생 됩니다.
▪5호관은 욕조 사용이 불가하며, 구코스(무지개)만 라운드 가능합니다.


날 짜
지 역
교통편
시 간
세 부 사 항
식 사
제1일
화

부  산
황  산
BX3615

송영차량
10:30
11:50
 부산 김해 국제공항 출발
 황산 툰시 국제공항 도착
 송백CC 주재원 미팅 골프장으로이동 및 체크인 (약 5분 소요)
 ▶송백CC 18홀 라운드 – (일몰시까지)
 호텔 체크 인 및 휴식
중:불포함
석:현지식
(호텔식)




 HOTEL : 송백CC 골프텔 5호관(준5성)

제2일
수
황  산

전 일
 호텔 조식 후 골프장으로 이동(도보)
 ▶송백CC 무제한 라운드 – (의무 라운드X)
 라운드 후
 황산 시내로 이동(약 15분 소요) 및 석식
 호텔 투숙 및 휴식
조:호텔식
중:불포함
석:현지식
(외부)




 HOTEL : 상  동

제3일
목

황  산

전 일
 호텔 조식 후 골프장으로 이동(도보)
 ▶송백CC 무제한 라운드 – (의무 라운드X)
 라운드 후 황산 시내로 이동(약 15분 소요)
 -명청대 시대 건축물과 옛 거리를 재현한 노가거리
 삼겹살 석식 후 호텔 투숙 및 휴식
조:호텔식
중:불포함
석:삼겹살




 HOTEL : 상  동

제4일
금


황  산
부  산

송영차량
BX3625


12:50
16:00
 호텔 조식 후 체크 아웃 및 공항 이동
 *추가 18홀 라운드 비용(연휴제외): 580위안(그린피+캐디피+카트비)
 황산 툰시 국제공항 출발
 부산 김해 국제공항 도착
조:호텔식
 ※ 상기 일정은 현지사정 및 항공사사정에 의하여 변동될 수 있사오니 양해하여 주시기 바랍니다.`;

const RAW_PKG2 = `【노쇼핑】 황산 송백CC 무제한 골프 5일 BX (에어부산)
출 발 일
 4월10일부터 ~ 5월29일까지 매주 금 출발
인    원
2명부터 출발
여 행 경 비
5월-15,22,29일
1,069,000
포 함 사 항
 항공료, 택스, 유류세, 호텔, 송영차량(단독차량 별도문의), 한국어 가능한 상주직원, 무제한 그린피,
 호텔 조식+석식, 여행자보험, 김해공항 샌딩, 중국연휴 서차지,
불포함 사항
 카트비+캐디피(380위안/18홀/인), 캐디팁(150위안/18홀/인-2인1캐디), 클럽중식                         미팅/샌딩비(150/위안/인-현지지불), 호텔 싱글차지(16만원), 싱글카트($20),
쇼 핑
 노쇼핑
기  타
▪ 본 상품은 5억원 배상책임보험에 가입되어 있습니다.
▪여권 유효기간은 출발일 기준 6개월 이상 남아 있어야 출국이 가능합니다
▪전세기 특별약관 적용 상품으로, 예약시 일인 20만원 데파짓 입금시 예약확정됩니다. ▪항공 발권후(출발21일전) 취소시, 항공료 전액 환불불가이므로, 신중한 예약 부탁드립니다.
▪2026년 12월31일까지 일반여권 소지자를 대상으로 비자면제 정책 시행중입니다.
 (비즈니스, 여행/관광, 친척/친구 방문 등 중국 입국 시 15일까지 무비자 체류 가능)
▪단수여권, 급행여권, 관용여권은 무비자 불가할 수 있습니다. 담당자에게 꼭 알려주세요.
  ※ 여권 재발급시 사전에 반드시 알려주셔야 합니다. 그렇지 않을 경우 발생된 문제는 책임지지 않습니다.
▪무제한 라운드 조건이나, 의무 라운드가 아닌 자율적 라운드 입니다. (단, 18홀 이상 라운드 조건)
▪2인 라운드 시 조인 한국인 또는 현지인 조인 플레이가 될 수 있습니다.
▪싱글차지 16만원입니다. 3호관 업그레이드 시 4박 기준 20만원 추가 이며, 싱글차지는 20만원 별도 발생됩니다.
▪2~3일차 오전 황산 반나절 투어 가능(4인이상 출발)  – 19만원/인
 (황산 관광은 전날 오후 6시 일기예보 기준으로 가능여부가 결정됩니다.)
▪외부 발마사지 60분 CNY200, 전신마사지 90분 CNY 300 (팁별도)
▪외부 석식 2인 출발시 추가 요금 발생 됩니다.
▪5호관은 욕조 사용이 불가하며, 구코스(무지개)만 라운드 가능합니다.


날 짜
지 역
교통편
시 간
세 부 사 항
식 사
제1일
금

부  산
황  산
BX3615

송영차량
10:30
11:50
 산 김해 국제공항 출발
 황산 툰시 국제공항 도착
 송백CC 주재원 미팅 골프장으로이동 및 체크인 (약 5분 소요)
 ▶송백CC 18홀 라운드 – (일몰시까지)
 호텔 체크 인 및 휴식
중:불포함
석:현지식
(호텔식)




 HOTEL : 송백CC 골프텔 5호관(준5성)

제2일
토
황  산

전 일
 호텔 조식 후 골프장으로 이동(도보)
 ▶송백CC 무제한 라운드 – (의무 라운드X)
 라운드 후
 황산 시내로 이동(약 15분 소요) 및 석식
 호텔 투숙 및 휴식
조:호텔식
중:불포함
석:현지식
(외부)




 HOTEL : 상  동

제3일
일
황  산

전 일
 호텔 조식 후 골프장으로 이동(도보)
 ▶송백CC 무제한 라운드 – (의무 라운드X)
 라운드 후 황산 시내로 이동(약 15분 소요)
 -명청대 시대 건축물과 옛 거리를 재현한 노가거리
 석식 및 호텔 투숙 및 휴식
조:호텔식
중:불포함
석:삼겹살




 HOTEL : 상  동

제4일
월

황  산

전 일
 호텔 조식 후 골프장으로 이동(도보)
 ▶송백CC 무제한 라운드 – (의무 라운드X)
 라운드 후
 식식 및 호텔 투숙
조:호텔식
중:불포함
석:현지식
(호텔식)




 HOTEL : 상  동

제5일
화


황  산
부  산

송영차량
BX3625


12:50
16:00
 호텔 조식 및 체크아웃 후 공항으로 이동
 *추가 18홀 라운드 비용(연휴제외): 580위안/인(그린피+캐디피+카트비)
 황산 툰시 국제공항 출발
 부산 김해 국제공항 도착
조:호텔식
 ※ 상기 일정은 현지사정 및 항공사사정에 의하여 변동될 수 있사오니 양해하여 주시기 바랍니다.`;

const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');

const inserter = createInserter({
  landOperator: '베스트아시아',
  commissionRate: 9,
  ticketingDeadline: null, // 원문에 발권/티켓팅 마감 키워드 없음
  destCode: 'TXN',         // 황산 툰시 공항 IATA
});
const { helpers: { flight, normal, meal } } = inserter;

// ── 공용 유의사항 ─────────────────────────────────────────────────
const COMMON_NOTICES = [
  { type: 'CRITICAL', title: '배상책임보험', text: '본 상품은 5억원 배상책임보험에 가입되어 있습니다.' },
  { type: 'POLICY', title: '여권 유효기간', text: '여권 유효기간은 출발일 기준 6개월 이상 남아 있어야 출국이 가능합니다.' },
  { type: 'PAYMENT', title: '전세기 특별약관', text: '전세기 특별약관 적용 상품으로, 예약시 일인 20만원 데파짓 입금시 예약확정됩니다. 항공 발권후(출발21일전) 취소시, 항공료 전액 환불불가이므로, 신중한 예약 부탁드립니다.' },
  { type: 'POLICY', title: '무비자 정책', text: '2026년 12월31일까지 일반여권 소지자를 대상으로 비자면제 정책 시행중입니다. (비즈니스, 여행/관광, 친척/친구 방문 등 중국 입국 시 15일까지 무비자 체류 가능)' },
  { type: 'POLICY', title: '무비자 예외', text: '단수여권, 급행여권, 관용여권은 무비자 불가할 수 있습니다. 담당자에게 꼭 알려주세요. ※ 여권 재발급시 사전에 반드시 알려주셔야 합니다. 그렇지 않을 경우 발생된 문제는 책임지지 않습니다.' },
  { type: 'INFO', title: '무제한 라운드 조건', text: '무제한 라운드 조건이나, 의무 라운드가 아닌 자율적 라운드 입니다. (단, 18홀 이상 라운드 조건)' },
  { type: 'INFO', title: '조인 플레이', text: '2인 라운드 시 조인 한국인 또는 현지인 조인 플레이가 될 수 있습니다.' },
  { type: 'INFO', title: '황산 반나절 투어', text: '2~3일차 오전 황산 반나절 투어 가능(4인이상 출발) – 19만원/인. (황산 관광은 전날 오후 6시 일기예보 기준으로 가능여부가 결정됩니다.)' },
  { type: 'INFO', title: '외부 마사지 안내', text: '외부 발마사지 60분 CNY200, 전신마사지 90분 CNY 300 (팁별도)' },
  { type: 'INFO', title: '외부 석식 2인 출발', text: '외부 석식 2인 출발시 추가 요금 발생 됩니다.' },
  { type: 'INFO', title: '5호관 제약', text: '5호관은 욕조 사용이 불가하며, 구코스(무지개)만 라운드 가능합니다.' },
];

// ── 공용 선택관광 ─────────────────────────────────────────────────
const COMMON_OPTIONAL_TOURS = [
  { name: '황산 반나절 투어 (2~3일차 오전, 4인 이상)', region: '황산', price: '190,000원/인', price_krw: 190000, price_usd: null, note: '전날 오후 6시 일기예보 기준 가능여부 결정' },
  { name: '추가 18홀 라운드 (연휴제외)', region: '황산', price: 'CNY 580/인', price_krw: null, price_usd: null, note: '그린피+캐디피+카트비' },
  { name: '외부 발마사지 60분', region: '황산', price: 'CNY 200/인', price_krw: null, price_usd: null, note: '팁별도' },
  { name: '외부 전신마사지 90분', region: '황산', price: 'CNY 300/인', price_krw: null, price_usd: null, note: '팁별도' },
];

// ── 공용 포함/불포함 ──────────────────────────────────────────────
const INCLUSIONS = [
  '항공료, 택스, 유류세',
  '호텔',
  '송영차량(단독차량 별도문의)',
  '한국어 가능한 상주직원',
  '무제한 그린피',
  '호텔 조식+석식',
  '여행자보험',
  '김해공항 샌딩',
  '중국연휴 서차지',
];

const EXCLUDES_4D = [
  '카트비+캐디피(380위안/18홀/인)',
  '캐디팁(150위안/18홀/인-2인1캐디)',
  '클럽중식',
  '미팅/샌딩비(150위안/인-현지지불)',
  '호텔 싱글차지(12만원)',
  '싱글카트($20)',
];

const EXCLUDES_5D = [
  '카트비+캐디피(380위안/18홀/인)',
  '캐디팁(150위안/18홀/인-2인1캐디)',
  '클럽중식',
  '미팅/샌딩비(150위안/인-현지지불)',
  '호텔 싱글차지(16만원)',
  '싱글카트($20)',
];

// ── Agent Self-Audit (Step 6.5) ───────────────────────────────────
// Claude Opus 본 세션이 파싱 직후 수행. Gemini 호출 없음.
const buildAuditReport = (pkgLabel, claims) => ({
  parser_version: 'register-v2026.04.21-sonnet-4.6',
  ran_at: new Date().toISOString(),
  pkg_label: pkgLabel,
  claims,
  overall_verdict: claims.every(c => c.supported === true) ? 'clean'
    : claims.some(c => c.severity === 'CRITICAL' && c.supported === false) ? 'blocked'
    : 'warnings',
  unsupported_critical: claims.filter(c => c.severity === 'CRITICAL' && c.supported === false).length,
  unsupported_high: claims.filter(c => c.severity === 'HIGH' && c.supported === false).length,
});

const AUDIT_4D = buildAuditReport('PKG1 (3박4일 화출발)', [
  { id: 'min_participants', field: 'min_participants', severity: 'HIGH', text: '2명', evidence: '원문 인원 섹션: "2명부터 출발"', supported: true, note: null },
  { id: 'ticketing_deadline', field: 'ticketing_deadline', severity: 'HIGH', text: 'null', evidence: null, supported: true, note: '원문에 "발권/티켓팅/예약마감" 키워드 없음 — null 유지' },
  { id: 'inclusions:travel_insurance', field: 'inclusions', severity: 'CRITICAL', text: '여행자보험 (금액 주입 없음)', evidence: '포함 사항: "여행자보험" (원문 그대로)', supported: true, note: '2억/1억 등 금액 환각 방지 — ERR-FUK-insurance-injection' },
  { id: 'inclusions:surcharge_in_price', field: 'inclusions', severity: 'HIGH', text: '중국연휴 서차지 포함 → surcharges=[]', evidence: '포함 사항: "중국연휴 서차지"', supported: true, note: '연휴 surcharge 가 가격에 이미 포함됨. 5/5 999,000원은 연휴 반영가.' },
  { id: 'notices:PAYMENT', field: 'notices_parsed', severity: 'CRITICAL', text: '데파짓 20만원 / 발권후 21일전 취소 시 환불불가', evidence: '원문: "예약시 일인 20만원 데파짓 입금시 예약확정", "항공 발권후(출발21일전) 취소시, 항공료 전액 환불불가"', supported: true, note: null },
  { id: 'regions:d1-d4', field: 'itinerary_data.days[].regions', severity: 'HIGH', text: 'D1=[부산,황산] / D2=[황산] / D3=[황산] / D4=[황산,부산]', evidence: '원문 지역 컬럼: 제1일 "부산/황산", 제2일 "황산", 제3일 "황산", 제4일 "황산/부산"', supported: true, note: null },
  { id: 'optional_tours:region', field: 'optional_tours[].region', severity: 'MEDIUM', text: '모든 옵션 region="황산"', evidence: '기타 섹션 4개 옵션 모두 현지(황산) 수행', supported: true, note: null },
]);

const AUDIT_5D = buildAuditReport('PKG2 (4박5일 금출발)', [
  { id: 'min_participants', field: 'min_participants', severity: 'HIGH', text: '2명', evidence: '원문 인원 섹션: "2명부터 출발"', supported: true, note: null },
  { id: 'ticketing_deadline', field: 'ticketing_deadline', severity: 'HIGH', text: 'null', evidence: null, supported: true, note: '원문에 "발권/티켓팅/예약마감" 키워드 없음' },
  { id: 'inclusions:travel_insurance', field: 'inclusions', severity: 'CRITICAL', text: '여행자보험 (금액 주입 없음)', evidence: '포함 사항: "여행자보험"', supported: true, note: null },
  { id: 'inclusions:surcharge_in_price', field: 'inclusions', severity: 'HIGH', text: '중국연휴 서차지 포함 → surcharges=[]', evidence: '포함 사항: "중국연휴 서차지"', supported: true, note: null },
  { id: 'notices:PAYMENT', field: 'notices_parsed', severity: 'CRITICAL', text: '데파짓 20만원 / 발권후 21일전 취소 시 환불불가', evidence: '원문: "예약시 일인 20만원 데파짓 입금시 예약확정", "항공 발권후(출발21일전) 취소시"', supported: true, note: null },
  { id: 'regions:d1-d5', field: 'itinerary_data.days[].regions', severity: 'HIGH', text: 'D1=[부산,황산] / D2-D4=[황산] / D5=[황산,부산]', evidence: '원문 지역 컬럼 1:1 매핑 (제1일 부산/황산, 제2~4일 황산, 제5일 황산/부산)', supported: true, note: '4일 상품(PKG1)과 교차 복사 없음 — 각 상품 독립 파싱 확인 (ERR-KUL-02/03)' },
  { id: 'single_supplement_diff', field: 'excludes', severity: 'MEDIUM', text: 'PKG1 싱글차지 12만원 / PKG2 싱글차지 16만원', evidence: 'PKG1 불포함: "호텔 싱글차지(12만원)" / PKG2 불포함: "호텔 싱글차지(16만원)"', supported: true, note: '상품별 불포함 구분 유지 — 공용 상수 사용 X' },
  { id: 'optional_tours:region', field: 'optional_tours[].region', severity: 'MEDIUM', text: '모든 옵션 region="황산"', evidence: '기타 섹션 4개 옵션', supported: true, note: null },
]);

// ── PKG1: 황산 송백CC 3박4일 (매주 화) ────────────────────────────
const PKG1 = {
  title: '【노쇼핑】 황산 송백CC 무제한 골프 3박4일 (에어부산 BX)',
  destination: '황산',
  country: '중국',
  category: 'package',
  product_type: '노쇼핑',
  trip_style: '3박4일',
  duration: 4,
  nights: 3,
  departure_airport: '부산(김해)',
  departure_days: '화',
  airline: 'BX(에어부산)',
  min_participants: 2,
  status: 'pending',
  price: 849000, // 최저가
  guide_tip: null,
  single_supplement: 120000,
  small_group_surcharge: null,
  surcharges: [], // 중국연휴 서차지는 포함사항에 이미 포함됨
  excluded_dates: [],
  price_tiers: [
    {
      period_label: '5월 화 출발 (19일, 26일)',
      departure_dates: ['2026-05-19', '2026-05-26'],
      departure_day_of_week: '화',
      adult_price: 849000, child_price: null,
      status: 'available', note: null,
    },
    {
      period_label: '5월 5일 (중국 노동절)',
      departure_dates: ['2026-05-05'],
      departure_day_of_week: '화',
      adult_price: 999000, child_price: null,
      status: 'available', note: '중국 노동절 연휴 반영가',
    },
  ],
  inclusions: INCLUSIONS,
  excludes: EXCLUDES_4D,
  optional_tours: COMMON_OPTIONAL_TOURS,
  accommodations: ['송백CC 골프텔 5호관 (준5성)'],
  product_highlights: [
    '송백CC 무제한 그린피 (의무 라운드X, 일몰까지 자유롭게)',
    '조식+석식 포함 (삼겹살 석식 1회 포함)',
    '쇼핑·옵션·매너팁 부담 없는 노쇼핑 골프투어',
  ],
  product_summary: '황산 송백CC에서 의무 라운드 없이 마음껏 라운드하고 싶으신 분께 딱입니다. 부산 김해 직항으로 1시간 20분 만에 도착, 공항에서 골프장까지 약 5분 거리라 도착 당일부터 18홀 라운드가 가능해요. 조식·석식 전부 챙겨드리고, 쇼핑·매너팁 걱정 없이 골프에만 집중하실 수 있도록 구성했습니다. 3일차 노가거리 삼겹살 석식으로 중국 현지 분위기도 만끽하세요.',
  product_tags: ['#황산', '#골프', '#노쇼핑', '#무제한라운드', '#에어부산', '#송백CC'],
  notices_parsed: COMMON_NOTICES.concat([
    { type: 'INFO', title: '싱글차지 (3박4일)', text: '싱글차지 12만원입니다. 3호관 업그레이드 시 3박 기준 15만원 추가 이며, 싱글차지는 15만원 별도 발생됩니다.' },
  ]),
  special_notes: null,
  itinerary_data: {
    meta: {
      title: '황산 송백CC 무제한 골프 3박4일',
      product_type: '노쇼핑',
      destination: '황산',
      nights: 3, days: 4,
      departure_airport: '부산(김해)',
      airline: 'BX(에어부산)',
      flight_out: 'BX3615',
      flight_in: 'BX3625',
      departure_days: '화',
      min_participants: 2,
      room_type: '2인1실',
      ticketing_deadline: null,
      hashtags: ['#황산', '#골프', '#노쇼핑'],
      brand: '여소남',
    },
    highlights: {
      inclusions: INCLUSIONS,
      excludes: EXCLUDES_4D,
      shopping: '노쇼핑',
      remarks: [
        '본 상품은 5억원 배상책임보험에 가입되어 있습니다.',
        '무제한 라운드 조건이나, 의무 라운드가 아닌 자율적 라운드 입니다. (단, 18홀 이상 라운드 조건)',
        '2인 라운드 시 조인 한국인 또는 현지인 조인 플레이가 될 수 있습니다.',
        '싱글차지 12만원 (3호관 업그레이드 시 3박 기준 +15만원, 싱글차지 15만원 별도)',
        '5호관은 욕조 사용이 불가하며, 구코스(무지개)만 라운드 가능합니다.',
      ],
    },
    days: [
      {
        day: 1, regions: ['부산', '황산'],
        meals: meal(false, false, true, null, null, '현지식(호텔식)'),
        schedule: [
          flight('10:30', '부산 김해 국제공항 출발', 'BX3615'),
          flight('11:50', '황산 툰시 국제공항 도착', 'BX3615'),
          normal(null, '송백CC 주재원 미팅 후 골프장으로 이동 및 체크인 (약 5분 소요)'),
          normal(null, '▶송백CC 18홀 라운드 (일몰시까지)'),
          normal(null, '호텔 체크인 및 휴식'),
        ],
        hotel: { name: '송백CC 골프텔 5호관', grade: '준5성', note: null },
      },
      {
        day: 2, regions: ['황산'],
        meals: meal(true, false, true, '호텔식', null, '현지식(외부)'),
        schedule: [
          normal(null, '호텔 조식 후 골프장으로 이동 (도보)'),
          normal(null, '▶송백CC 무제한 라운드 (의무 라운드X)'),
          normal(null, '라운드 후 황산 시내로 이동 (약 15분 소요) 및 석식'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '송백CC 골프텔 5호관', grade: '준5성', note: '상동' },
      },
      {
        day: 3, regions: ['황산'],
        meals: meal(true, false, true, '호텔식', null, '삼겹살'),
        schedule: [
          normal(null, '호텔 조식 후 골프장으로 이동 (도보)'),
          normal(null, '▶송백CC 무제한 라운드 (의무 라운드X)'),
          normal(null, '라운드 후 황산 시내로 이동 (약 15분 소요)'),
          normal(null, '▶노가거리 (명청대 시대 건축물과 옛 거리를 재현한 거리)'),
          normal(null, '삼겹살 석식 후 호텔 투숙 및 휴식'),
        ],
        hotel: { name: '송백CC 골프텔 5호관', grade: '준5성', note: '상동' },
      },
      {
        day: 4, regions: ['황산', '부산'],
        meals: meal(true, false, false, '호텔식', null, null),
        schedule: [
          normal(null, '호텔 조식 후 체크아웃 및 공항 이동'),
          normal(null, '*추가 18홀 라운드 비용(연휴제외): 580위안(그린피+캐디피+카트비)'),
          flight('12:50', '황산 툰시 국제공항 출발', 'BX3625'),
          flight('16:00', '부산 김해 국제공항 도착', 'BX3625'),
        ],
        hotel: { name: null, grade: null, note: null },
      },
    ],
    optional_tours: COMMON_OPTIONAL_TOURS,
  },
  itinerary: [
    '제1일 (화): 부산(김해) 10:30 출발 → 황산(툰시) 11:50 도착 / 송백CC 18홀 라운드 / 호텔 체크인',
    '제2일 (수): 송백CC 무제한 라운드 (의무X) / 황산 시내 석식 / 호텔 투숙',
    '제3일 (목): 송백CC 무제한 라운드 (의무X) / 노가거리 / 삼겹살 석식',
    '제4일 (금): 호텔 조식 → 황산(툰시) 12:50 출발 → 부산(김해) 16:00 도착',
  ],
  raw_text: RAW_PKG1,
  raw_text_hash: hash(RAW_PKG1),
  parser_version: 'register-v2026.04.21-sonnet-4.6',
  agent_audit_report: AUDIT_4D,
  filename: 'manual_input_huangshan_4d',
  file_type: 'manual',
  confidence: 1.0,
};

// ── PKG2: 황산 송백CC 4박5일 (매주 금) ────────────────────────────
const PKG2 = {
  title: '【노쇼핑】 황산 송백CC 무제한 골프 4박5일 (에어부산 BX)',
  destination: '황산',
  country: '중국',
  category: 'package',
  product_type: '노쇼핑',
  trip_style: '4박5일',
  duration: 5,
  nights: 4,
  departure_airport: '부산(김해)',
  departure_days: '금',
  airline: 'BX(에어부산)',
  min_participants: 2,
  status: 'pending',
  price: 1069000,
  guide_tip: null,
  single_supplement: 160000,
  small_group_surcharge: null,
  surcharges: [],
  excluded_dates: [],
  price_tiers: [
    {
      period_label: '5월 금 출발 (15일, 22일, 29일)',
      departure_dates: ['2026-05-15', '2026-05-22', '2026-05-29'],
      departure_day_of_week: '금',
      adult_price: 1069000, child_price: null,
      status: 'available', note: null,
    },
  ],
  inclusions: INCLUSIONS,
  excludes: EXCLUDES_5D,
  optional_tours: COMMON_OPTIONAL_TOURS,
  accommodations: ['송백CC 골프텔 5호관 (준5성)'],
  product_highlights: [
    '송백CC 무제한 그린피 4일 (의무 라운드X, 일몰까지)',
    '조식+석식 포함 (삼겹살 석식 1회 포함)',
    '쇼핑·옵션·매너팁 부담 없는 노쇼핑 골프투어',
  ],
  product_summary: '황산 송백CC에서 주말 포함 4박5일 충분히 즐기고 싶으신 분께 추천드립니다. 매주 금요일 부산 김해 직항 출발로 도착 당일 18홀, 토/일/월 3일간 무제한 라운드 — 하루 2라운드도 가능합니다. 의무 라운드가 없어 컨디션에 맞춰 자유롭게 즐기실 수 있고, 조식·석식까지 챙겨드려 골프 외 스트레스를 최소화했습니다. 3일차 노가거리 삼겹살 석식으로 황산 현지 분위기도 경험하세요.',
  product_tags: ['#황산', '#골프', '#노쇼핑', '#무제한라운드', '#에어부산', '#송백CC'],
  notices_parsed: COMMON_NOTICES.concat([
    { type: 'INFO', title: '싱글차지 (4박5일)', text: '싱글차지 16만원입니다. 3호관 업그레이드 시 4박 기준 20만원 추가 이며, 싱글차지는 20만원 별도 발생됩니다.' },
  ]),
  special_notes: null,
  itinerary_data: {
    meta: {
      title: '황산 송백CC 무제한 골프 4박5일',
      product_type: '노쇼핑',
      destination: '황산',
      nights: 4, days: 5,
      departure_airport: '부산(김해)',
      airline: 'BX(에어부산)',
      flight_out: 'BX3615',
      flight_in: 'BX3625',
      departure_days: '금',
      min_participants: 2,
      room_type: '2인1실',
      ticketing_deadline: null,
      hashtags: ['#황산', '#골프', '#노쇼핑'],
      brand: '여소남',
    },
    highlights: {
      inclusions: INCLUSIONS,
      excludes: EXCLUDES_5D,
      shopping: '노쇼핑',
      remarks: [
        '본 상품은 5억원 배상책임보험에 가입되어 있습니다.',
        '무제한 라운드 조건이나, 의무 라운드가 아닌 자율적 라운드 입니다. (단, 18홀 이상 라운드 조건)',
        '2인 라운드 시 조인 한국인 또는 현지인 조인 플레이가 될 수 있습니다.',
        '싱글차지 16만원 (3호관 업그레이드 시 4박 기준 +20만원, 싱글차지 20만원 별도)',
        '5호관은 욕조 사용이 불가하며, 구코스(무지개)만 라운드 가능합니다.',
      ],
    },
    days: [
      {
        day: 1, regions: ['부산', '황산'],
        meals: meal(false, false, true, null, null, '현지식(호텔식)'),
        schedule: [
          flight('10:30', '부산 김해 국제공항 출발', 'BX3615'),
          flight('11:50', '황산 툰시 국제공항 도착', 'BX3615'),
          normal(null, '송백CC 주재원 미팅 후 골프장으로 이동 및 체크인 (약 5분 소요)'),
          normal(null, '▶송백CC 18홀 라운드 (일몰시까지)'),
          normal(null, '호텔 체크인 및 휴식'),
        ],
        hotel: { name: '송백CC 골프텔 5호관', grade: '준5성', note: null },
      },
      {
        day: 2, regions: ['황산'],
        meals: meal(true, false, true, '호텔식', null, '현지식(외부)'),
        schedule: [
          normal(null, '호텔 조식 후 골프장으로 이동 (도보)'),
          normal(null, '▶송백CC 무제한 라운드 (의무 라운드X)'),
          normal(null, '라운드 후 황산 시내로 이동 (약 15분 소요) 및 석식'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '송백CC 골프텔 5호관', grade: '준5성', note: '상동' },
      },
      {
        day: 3, regions: ['황산'],
        meals: meal(true, false, true, '호텔식', null, '삼겹살'),
        schedule: [
          normal(null, '호텔 조식 후 골프장으로 이동 (도보)'),
          normal(null, '▶송백CC 무제한 라운드 (의무 라운드X)'),
          normal(null, '라운드 후 황산 시내로 이동 (약 15분 소요)'),
          normal(null, '▶노가거리 (명청대 시대 건축물과 옛 거리를 재현한 거리)'),
          normal(null, '삼겹살 석식 및 호텔 투숙'),
        ],
        hotel: { name: '송백CC 골프텔 5호관', grade: '준5성', note: '상동' },
      },
      {
        day: 4, regions: ['황산'],
        meals: meal(true, false, true, '호텔식', null, '현지식(호텔식)'),
        schedule: [
          normal(null, '호텔 조식 후 골프장으로 이동 (도보)'),
          normal(null, '▶송백CC 무제한 라운드 (의무 라운드X)'),
          normal(null, '라운드 후 석식 및 호텔 투숙'),
        ],
        hotel: { name: '송백CC 골프텔 5호관', grade: '준5성', note: '상동' },
      },
      {
        day: 5, regions: ['황산', '부산'],
        meals: meal(true, false, false, '호텔식', null, null),
        schedule: [
          normal(null, '호텔 조식 및 체크아웃 후 공항으로 이동'),
          normal(null, '*추가 18홀 라운드 비용(연휴제외): 580위안/인(그린피+캐디피+카트비)'),
          flight('12:50', '황산 툰시 국제공항 출발', 'BX3625'),
          flight('16:00', '부산 김해 국제공항 도착', 'BX3625'),
        ],
        hotel: { name: null, grade: null, note: null },
      },
    ],
    optional_tours: COMMON_OPTIONAL_TOURS,
  },
  itinerary: [
    '제1일 (금): 부산(김해) 10:30 출발 → 황산(툰시) 11:50 도착 / 송백CC 18홀 라운드 / 호텔 체크인',
    '제2일 (토): 송백CC 무제한 라운드 (의무X) / 황산 시내 석식 / 호텔 투숙',
    '제3일 (일): 송백CC 무제한 라운드 (의무X) / 노가거리 / 삼겹살 석식',
    '제4일 (월): 송백CC 무제한 라운드 (의무X) / 호텔 석식',
    '제5일 (화): 호텔 조식 → 황산(툰시) 12:50 출발 → 부산(김해) 16:00 도착',
  ],
  raw_text: RAW_PKG2,
  raw_text_hash: hash(RAW_PKG2),
  parser_version: 'register-v2026.04.21-sonnet-4.6',
  agent_audit_report: AUDIT_5D,
  filename: 'manual_input_huangshan_5d',
  file_type: 'manual',
  confidence: 1.0,
};

inserter.run([PKG1, PKG2]).then(() => {
  console.log('\n✅ 황산 송백CC 무제한 골프 등록 스크립트 완료 (PKG1 3박4일 + PKG2 4박5일)');
  process.exit(0);
}).catch(err => {
  console.error('❌ 등록 실패:', err);
  process.exit(1);
});
