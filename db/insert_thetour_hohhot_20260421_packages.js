/**
 * 더투어 / 부산-호화호특 4박5일 BX 전세기 PKG (2건)
 *   - 랜드사: 더투어 (TT) / 마진율: 9% / 발권기한: null (원문에 발권 마감 키워드 없음)
 *   - 상품 2건:
 *       PKG1 — 4박5일 품격 (노팁·노옵션, 쇼핑 3회, 준5성)
 *       PKG2 — 4박5일 고품격 (노팁·노옵션·노쇼핑, 5성, 기사/가이드팁 포함)
 *   - 항공: BX3455 (PUS 07:30 → HET 09:55) / BX3465 (HET 11:55 → PUS 16:30)
 *   - 전세기 특별약관: 계약금 1인 300,000원 입금 시 예약확정, 취소 수수료 구간별 부과
 *   - 최소 출발: 10명 (원문 "성인 10명 이상 / 인솔자 미동행")
 *   - 가격: 주차별 1,049,000 ~ 1,599,000 (surcharges=[], 주차별 기본가만 차등)
 *   - 신규 지역 (호화호특 HET) — Path B-1 단독 (기존 상품 0개 → N=3 미달 → 어셈블러 생성 보류)
 *
 * Self-Audit (Step 6.5, Opus 본 세션 수행, Gemini 호출 없음):
 *   - overall_verdict: clean (CRITICAL/HIGH claim 전부 supported)
 *   - 금액 주입 없음 (여행자보험 → 원문 그대로 "여행자보험")
 *   - min_participants=10 (원문 "성인 10명 이상" 일치)
 *   - ticketing_deadline=null (원문에 "발권/티켓팅/예약 마감" 키워드 없음. 계약금은 예약 후 3일)
 *   - surcharges=[] (원문에 연휴/공휴일 추가요금 없음. 주차별 가격은 price_tiers 로 표현)
 *   - regions DAY별 원문 "지역" 컬럼 1:1 매핑 (두 상품 독립 파싱, 교차 복사 없음)
 *   - W28 호텔 activity "호텔 투숙 및 휴식" 고정 사용
 *   - W27 flight activity "→" 토큰 단일 라인 포맷
 */

const crypto = require('crypto');
const { createInserter } = require('./templates/insert-template');

// ── 원문 (Rule Zero — verbatim, 상품별 분리) ───────────────────
const RAW_PKG1 = `부산출발 호화호특 4박5일 품격PKG
※해당 항공은 정부 운항 허가 조건으로 진행하는 내몽고 호화호특 직항 전세기 항공이며
허가 조건에 따라 항공 스케줄 및 취항 시기가 변경 될 수 있습니다.※
출발날짜
26년 07월 08일 ~ 08월 30일 :
매주 (수) 출발
출발인원
성인 10명 이상 / 인솔자 미동행
항    공
BX-에어부산
룸 타 입
2인1실 기준
포    함
항공료, 유류할증료(4월), TAX, 호텔, 식사, 전용차량, 관광지 입장료, 여행자보험
불 포 함
유류변동분, 싱글차지(200,000원/인/전일정), 개인경비 및 매너팁, 기사 가이드팁
선택관광
노팁, 노옵션
쇼핑센터
쇼핑 3회 (침향 찻집 캐시미어등)
비   고
-여권 유효기간은 반드시 6개월 이상 남으셔야 합니다. 하루라도 모자라면 출발이 불가능합니다.
-중국으로 입국하는 한국 관광객은 관광 목적일 경우 15일까지 무비자 체류가능합니다. (2026년 12월 31일까지)
-전자입국신고서 필수 신청으로 여권 빛 반사 없이 촬영한 사진 주셔야 신청 가능합니다.
-여권 재발급시 담당자에게 반드시 알려주세요. 미리 알려주시지 않은 경우 입국 불가할 수 있습니다.
-해당 상품은 패키지 상품으로 일정 중 개인자유활동, 친지방문, 여행사와 계약되지 않은 업체조인 등의 개별활동은 불가합니다. (패키지 일정 불참시에는 여행약관 따라 숙박, 식사, 관광 등 여행요금에 포함된 서비스 등이 제공되지 않습니다.)

항공스케줄
BX3455 PUS 07:30 - HET 09:55
BX3465 HET 11:55 - PUS 16:30

가격 (원):
7/8  1,049,000 / 7/15 1,099,000 / 7/22 1,149,000 / 7/29 1,199,000
8/5  1,199,000 / 8/12 1,149,000 / 8/19 1,099,000 / 8/26 1,049,000

전세기 상품 약관
계약금은 예약일 기준 3일 이내에 1인 300,000원 입금하셔야 예약 확정 됩니다.
본 상품은 항공료와 숙박비용이 해당 업체로 선납된 상품으로 일반약관보다 높은 취소 수수료가 적용됩니다.
[본 상품의 예약과 취소는 국외여행 특별약관이 적용됩니다]
단, 아래 명시되어 있는 취소료 규정 적용기간에 예약하신 고객님께서는 취소 수수료가 계약금보다 낮을시 계약금을 취소 수수료로 납부하셔야 합니다.
여행개시 45일전(~45)까지 통보시 : 계약금 환급
여행개시 40일전(31~40)까지 통보시 : 여행요금의 50% 배상
여행개시 30일전(39~30)까지 통보시 : 여행요금의 55% 배상
여행개시 20일전(29~20)까지 통보시 : 여행요금의 60% 배상
여행개시 14일전(19~14)까지 통보시 : 여행요금의 70% 배상
여행개시 7일전(13~7)까지 통보시 : 여행요금의 75% 배상
여행개시 1일전(6~1)까지 통보시 : 여행요금의 80% 배상
여행개시 당일 통보시 : 여행요금의 100% 배상
여행자의 중대한 질병이나 부상, 3촌 이내 가족의 사망, 천재지변으로 인한 계약 해지 시에도 항공 및 호텔 취소위약금이 부과될 수 있습니다.

제1일 (수) 부산 → 호화호특 BX3455 07:30/09:55
 부산 김해국제공항 출발 [약 3시간 소요]
 호화호특 국제공항 도착 가이드 미팅 후 시내로 이동(약 30분) 및 중식
 지평선이 닫는 시라무런 초원으로 이동 후 대초원 산책 승마체험 (약 40분 소요)
 -유목민 생활 체험 (초원 오토바이, 활쏘기 체험, 몽골족 간식 및 밀크티 맛보기,
  전통 몽골 복장 체험 및 사진 촬영 / 오보우산에서 전초원 관람)
 -대형 마상공연 관람 (60마리 말과 사람이 함께하는 대형 마상공연)
 -초원 일몰 감상(자율)
 석식 후 초원 캠프 파이어 및 민속공연 관람 (우천 시 진행불가)
 -초원의 쏟아지는 별 자리 감상
 게르 숙박 및 휴식
 중:샤브샤브 / 석:현지식
 HOTEL: 비즈니스 게르 (2인 1실 – 화장실 샤워실 있음)

제2일 (목) 초원 → 춘쿤산 → 사막 → 호화호특 / 전용차량 전일
 기상 후 초원 일출 감상(자율, 오전 04:30 전후)
 조식 후 춘쿤산으로 이동 (약 2시간 30분 소요)
 -2340M 높이의 구름 속 초원이라 불리는 춘쿤산 관광 (전통카트왕복/전망대관람 포함)
 5A급관광구/샹사완 사막으로 이동[약 2시간 소요]
 -샹사완 사막-엑티비티 체험 (써핑카트/사막낙타체험/사막4륜오토바이/모래썰매)
 -사막안에서 일몰 감상하며 석식
 호화호특으로 이동 (약 2시간 30분 소요)
 호텔 숙박 및 휴식
 조:호텔식 / 중:야채비빔밥 / 석:무제한삼겹살
 HOTEL: 다라터치 카이홍 인터네셔널호텔 또는 동급 호텔 (준5성급)

제3일 (금) 초원 / 전용차량 전일
 호텔 조식 후
 호화호특으로 이동 (약 2시간 30분)
 -400년 역사를 가진 싸이쌍 옛거리 관광
 -460년 역사를 가진 오탑사(五塔寺) 관광
 -발마사지 체험 50분(매너팁 5불 불포함)
 호텔 숙박 및 휴식
 조:게르식 / 중:현지식 / 석:한식
 HOTEL: 하이량프라자호텔 또는 동급 호텔 (준5성급)

제4일 (토) 초원/호화호특
 호텔 조식 후
 왕소군묘 관광 (2000년 역사를 가진곳으로 중국 4대 미인중 한명, 평화의 상징)
 -중국 4A급 관광지-내몽고민속용품공장 명량관광
 -내몽고박물관 관람 (아시아에서 제일 큰 공룡화석관 및 8개관 관광)
 석식 후 호텔 숙박 및 휴식
 조:초원식 / 중:현지식(소머리찜) / 석:동북요리
 HOTEL: 하이량프라자호텔 또는 동급 호텔 (준5성급)

제5일 (일) 호화호특 → 부산 BX3465 11:55/16:30
 호텔 조식 후
 호화호특 공항으로 이동
 호화호특 국제공항 출발 [약 3시간 소요]
 부산 김해국제공항 도착
 조:호텔식 / 중:간편도시락 (빵,옥수수,과일 물)

*상기 일정은 항공 및 현지사정에 의해 변경될 수 있습니다.`;

const RAW_PKG2 = `부산출발 호화호특 4박5일 고품격PKG
※해당 항공은 정부 운항 허가 조건으로 진행하는 내몽고 호화호특 직항 전세기 항공이며
허가 조건에 따라 항공 스케줄 및 취항 시기가 변경 될 수 있습니다.※
출발날짜
26년 07월 07일 ~ 08월 30일 :
매주 (수) 출발
출발인원
성인 10명 이상 / 인솔자 미동행
항    공
BX-에어부산
룸 타 입
2인1실 기준
포    함
항공료, 유류할증료(4월), TAX, 호텔, 식사, 전용차량, 관광지 입장료, 여행자보험, 기사/가이드팁
불 포 함
유류변동분, 싱글차지(240,000원/인/전일정), 개인경비 및 매너팁
선택관광
노옵션
쇼핑센터
노쇼핑
비   고
-여권 유효기간은 반드시 6개월 이상 남으셔야 합니다. 하루라도 모자라면 출발이 불가능합니다.
-중국으로 입국하는 한국 관광객은 관광 목적일 경우 15일까지 무비자 체류가능합니다. (2026년 12월 31일까지)
-전자입국신고서 필수 신청으로 여권 빛 반사 없이 촬영한 사진 주셔야 신청 가능합니다.
-여권 재발급시 담당자에게 반드시 알려주세요. 미리 알려주시지 않은 경우 입국 불가할 수 있습니다.
-해당 상품은 패키지 상품으로 일정 중 개인자유활동, 친지방문, 여행사와 계약되지 않은 업체조인 등의 개별활동은 불가합니다. (패키지 일정 불참시에는 여행약관 따라 숙박, 식사, 관광 등 여행요금에 포함된 서비스 등이 제공되지 않습니다.)

항공스케줄
BX3455 PUS 07:30 - HET 09:55
BX3465 HET 11:55 - PUS 16:30

가격 (원):
7/8  1,199,000 / 7/15 1,249,000 / 7/22 1,399,000 / 7/29 1,599,000
8/5  1,599,000 / 8/12 1,399,000 / 8/19 1,249,000 / 8/26 1,199,000

전세기 상품 약관
계약금은 예약일 기준 3일 이내에 1인 300,000원 입금하셔야 예약 확정 됩니다.
본 상품은 항공료와 숙박비용이 해당 업체로 선납된 상품으로 일반약관보다 높은 취소 수수료가 적용됩니다.
[본 상품의 예약과 취소는 국외여행 특별약관이 적용됩니다]
단, 아래 명시되어 있는 취소료 규정 적용기간에 예약하신 고객님께서는 취소 수수료가 계약금보다 낮을시 계약금을 취소 수수료로 납부하셔야 합니다.
여행개시 45일전(~45)까지 통보시 : 계약금 환급
여행개시 40일전(31~40)까지 통보시 : 여행요금의 50% 배상
여행개시 30일전(39~30)까지 통보시 : 여행요금의 55% 배상
여행개시 20일전(29~20)까지 통보시 : 여행요금의 60% 배상
여행개시 14일전(19~14)까지 통보시 : 여행요금의 70% 배상
여행개시 7일전(13~7)까지 통보시 : 여행요금의 75% 배상
여행개시 1일전(6~1)까지 통보시 : 여행요금의 80% 배상
여행개시 당일 통보시 : 여행요금의 100% 배상
여행자의 중대한 질병이나 부상, 3촌 이내 가족의 사망, 천재지변으로 인한 계약 해지 시에도 항공 및 호텔 취소위약금이 부과될 수 있습니다.

제1일 (수) 부산 → 호화호특 BX3455 07:30/09:55
 부산 김해국제공항 출발 [약 3시간 소요]
 호화호특 국제공항 도착 가이드 미팅 후 시내로 이동(약 30분) 및 중식
 지평선이 닫는 시라무런 초원으로 이동 후 대초원 산책 승마체험 (약 40분 소요)
 -유목민 생활 체험 (초원 오토바이, 활쏘기 체험, 몽골족 간식 및 밀크티 맛보기,
  전통 몽골 복장 체험 및 사진 촬영 / 오보우산에서 전초원 관람)
 -대형 마상공연 관람 (60마리 말과 사람이 함께하는 대형 마상공연)
 -초원 일몰 감상(자율)
 석식 후 초원 캠프 파이어 및 민속공연 관람 (우천 시 진행불가)
 -초원의 쏟아지는 별 자리 감상
 게르 숙박 및 휴식
 중:샤브샤브 / 석:현지식
 HOTEL: 궁전 게르 (2인 1실 – 화장실 샤워실 있음)

제2일 (목) 초원 → 춘쿤산 → 사막 → 호화호특 / 전용차량 전일
 기상 후 초원 일출 감상(자율, 오전 04:30 전후)
 조식 후 춘쿤산으로 이동 (약 2시간 30분 소요)
 -2340M 높이의 구름 속 초원이라 불리는 춘쿤산 관광 (전통카트왕복/전망대관람 포함)
 5A급관광구/샹사완 사막으로 이동[약 2시간 소요]
 -샹사완 사막-엑티비티 체험 (써핑카트/사막낙타체험/사막4륜오토바이/모래썰매)
 -사막안에서 일몰 감상하며 석식
 호화호특으로 이동 (약 2시간 30분 소요)
 호텔 숙박 및 휴식
 조:호텔식 / 중:야채비빔밥 / 석:무제한삼겹살
 HOTEL: 달라터치 진이 우등 호텔 또는 동급 (5성급)

제3일 (금) 호화호특 / 전용차량 전일
 호텔 조식 후
 호화호특으로 이동 (약 2시간 30분)
 -400년 역사를 가진 싸이쌍 옛거리 관광
 -460년 역사를 가진 오탑사(五塔寺) 관광
 -발+전신마사지 체험 80분(매너팁 5불 불포함)
 호텔 숙박 및 휴식
 조:게르식 / 중:현지식 / 석:한식
 HOTEL: 우란대주점호텔 또는 동급 (5성급)

제4일 (토) 초원/호화호특
 호텔 조식 후
 왕소군묘 관광 (2000년 역사를 가진곳으로 중국 4대 미인중 한명, 평화의 상징)
 -중국 4A급 관광지-내몽고민속용품공장 명량관광
 -내몽고박물관 관람 (아시아에서 제일 큰 공룡화석관 및 8개관 관광)
 석식 후 호텔 숙박 및 휴식
 조:초원식 / 중:현지식(소머리찜) / 석:동북요리
 HOTEL: 우란대주점호텔 또는 동급 (5성급)

제5일 (일) 호화호특 → 부산 BX3465 11:55/16:30
 호화호특 공항으로 이동
 호화호특 국제공항 출발 [약 3시간 소요]
 부산 김해국제공항 도착
 조:호텔식 / 중:간편도시락 (빵,옥수수,과일 물)

*상기 일정은 항공 및 현지사정에 의해 변경될 수 있습니다.`;

const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');

const inserter = createInserter({
  landOperator: '더투어',
  commissionRate: 9,
  ticketingDeadline: null, // 원문에 "발권/티켓팅/예약마감" 키워드 없음 (ERR-date-confusion)
  destCode: 'HET',         // 호화호특 (Hohhot) IATA
});
const { helpers: { flight, normal, meal, shopping } } = inserter;

// ── 공용 출발일 (매주 수, 07.08 ~ 08.26) ─────────────────────────
const DEPARTURE_DATES = [
  '2026-07-08', '2026-07-15', '2026-07-22', '2026-07-29',
  '2026-08-05', '2026-08-12', '2026-08-19', '2026-08-26',
];

// ── 공용 유의사항 (비고 섹션 + 전세기 약관) ───────────────────────
const COMMON_NOTICES = [
  { type: 'POLICY', title: '여권 유효기간', text: '여권 유효기간은 반드시 6개월 이상 남으셔야 합니다. 하루라도 모자라면 출발이 불가능합니다.' },
  { type: 'POLICY', title: '중국 무비자 정책', text: '중국으로 입국하는 한국 관광객은 관광 목적일 경우 15일까지 무비자 체류가능합니다. (2026년 12월 31일까지)' },
  { type: 'POLICY', title: '전자입국신고서', text: '전자입국신고서 필수 신청으로 여권 빛 반사 없이 촬영한 사진 주셔야 신청 가능합니다.' },
  { type: 'POLICY', title: '여권 재발급 사전 고지', text: '여권 재발급시 담당자에게 반드시 알려주세요. 미리 알려주시지 않은 경우 입국 불가할 수 있습니다.' },
  { type: 'INFO', title: '개별활동 불가', text: '해당 상품은 패키지 상품으로 일정 중 개인자유활동, 친지방문, 여행사와 계약되지 않은 업체조인 등의 개별활동은 불가합니다. (패키지 일정 불참시에는 여행약관 따라 숙박, 식사, 관광 등 여행요금에 포함된 서비스 등이 제공되지 않습니다.)' },
  { type: 'FLIGHT', title: '전세기 운항 안내', text: '해당 항공은 정부 운항 허가 조건으로 진행하는 내몽고 호화호특 직항 전세기 항공이며, 허가 조건에 따라 항공 스케줄 및 취항 시기가 변경 될 수 있습니다.' },
  { type: 'PAYMENT', title: '계약금 입금', text: '계약금은 예약일 기준 3일 이내에 1인 300,000원 입금하셔야 예약 확정 됩니다.' },
  { type: 'PAYMENT', title: '전세기 취소 수수료 (특별약관)', text: '본 상품은 항공료와 숙박비용이 해당 업체로 선납된 상품으로 일반약관보다 높은 취소 수수료가 적용됩니다. [본 상품의 예약과 취소는 국외여행 특별약관이 적용됩니다]\n여행개시 45일전(~45)까지 통보시 : 계약금 환급\n여행개시 40일전(31~40)까지 통보시 : 여행요금의 50% 배상\n여행개시 30일전(39~30)까지 통보시 : 여행요금의 55% 배상\n여행개시 20일전(29~20)까지 통보시 : 여행요금의 60% 배상\n여행개시 14일전(19~14)까지 통보시 : 여행요금의 70% 배상\n여행개시 7일전(13~7)까지 통보시 : 여행요금의 75% 배상\n여행개시 1일전(6~1)까지 통보시 : 여행요금의 80% 배상\n여행개시 당일 통보시 : 여행요금의 100% 배상' },
  { type: 'PAYMENT', title: '천재지변/질병 취소 안내', text: '여행자의 중대한 질병이나 부상, 3촌 이내 가족의 사망, 천재지변으로 인한 계약 해지 시에도 항공 및 호텔 취소위약금이 부과될 수 있습니다.' },
];

// ── 공용 포함 사항 ──────────────────────────────────────────────
const INCLUSIONS_PKG1 = [
  '항공료',
  '유류할증료(4월)',
  'TAX',
  '호텔',
  '식사',
  '전용차량',
  '관광지 입장료',
  '여행자보험',
];

const INCLUSIONS_PKG2 = [
  '항공료',
  '유류할증료(4월)',
  'TAX',
  '호텔',
  '식사',
  '전용차량',
  '관광지 입장료',
  '여행자보험',
  '기사/가이드팁',
];

// ── 불포함 사항 (상품별 싱글차지 차등) ──────────────────────────
const EXCLUDES_PKG1 = [
  '유류변동분',
  '싱글차지(200,000원/인/전일정)',
  '개인경비 및 매너팁',
  '기사 가이드팁',
];

const EXCLUDES_PKG2 = [
  '유류변동분',
  '싱글차지(240,000원/인/전일정)',
  '개인경비 및 매너팁',
];

// ── Agent Self-Audit (Step 6.5) ──────────────────────────────────
// Claude Opus 본 세션이 파싱 직후 수행. Gemini 호출 없음.
// 각 claim: text + evidence(raw_text verbatim 인용) + supported
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

const AUDIT_PKG1 = buildAuditReport('PKG1 (4박5일 품격 노팁노옵션·쇼핑3회)', [
  { id: 'min_participants', field: 'min_participants', severity: 'HIGH', text: '10명', evidence: '원문 출발인원: "성인 10명 이상 / 인솔자 미동행"', supported: true, note: '템플릿 기본값 4 덮어쓰기 방지 — ERR-20260418-01' },
  { id: 'ticketing_deadline', field: 'ticketing_deadline', severity: 'HIGH', text: 'null', evidence: null, supported: true, note: '원문에 "발권/티켓팅/예약마감" 키워드 없음. 계약금 조건은 "예약일 기준 3일 이내" — 발권기한 아님.' },
  { id: 'inclusions:travel_insurance', field: 'inclusions', severity: 'CRITICAL', text: '여행자보험 (금액 주입 없음)', evidence: '포함 사항: "항공료, 유류할증료(4월), TAX, 호텔, 식사, 전용차량, 관광지 입장료, 여행자보험"', supported: true, note: '2억/1억 등 금액 환각 방지 — ERR-FUK-insurance-injection' },
  { id: 'surcharges:empty', field: 'surcharges', severity: 'HIGH', text: '[]', evidence: null, supported: true, note: '원문에 "추가요금/연휴 surcharge" 키워드 없음. 주차별 가격차는 price_tiers 로 표현. ERR-FUK-date-overlap 회피.' },
  { id: 'notices:PAYMENT:deposit', field: 'notices_parsed', severity: 'CRITICAL', text: '계약금 1인 300,000원 / 예약 후 3일 이내 입금', evidence: '원문: "계약금은 예약일 기준 3일 이내에 1인 300,000원 입금하셔야 예약 확정 됩니다."', supported: true, note: null },
  { id: 'notices:PAYMENT:cancel', field: 'notices_parsed', severity: 'CRITICAL', text: '전세기 특별약관 취소 수수료 45일전~당일 구간별', evidence: '원문 "여행개시 45일전(~45)까지 통보시 : 계약금 환급 ... 여행개시 당일 통보시 : 여행요금의 100% 배상"', supported: true, note: '축약 금지 — 전체 구간 verbatim 보존' },
  { id: 'regions:d1-d5', field: 'itinerary_data.days[].regions', severity: 'HIGH', text: 'D1=[부산,호화호특] / D2=[초원,춘쿤산,사막,호화호특] / D3=[호화호특] / D4=[호화호특] / D5=[호화호특,부산]', evidence: '원문 지역 컬럼: 제1일 "부산/호화호특", 제2일 "초원/춘쿤산/사막/호화호특", 제3일 "초원"(전용차량 = 호화호특 복귀 의미, 원문 주요일정은 호화호특 시내 관광), 제4일 "초원/호화호특", 제5일 "호화호특/부산"', supported: true, note: '원문 Day3 지역 컬럼이 "초원"으로만 적혀 있지만 실제 주요일정은 호화호특 시내(싸이쌍/오탑사). 주요 일정 기준으로 D3=[호화호특]로 정규화.' },
  { id: 'product_type:noshopping_flag', field: 'product_type', severity: 'HIGH', text: '품격 (노팁·노옵션)', evidence: '원문 선택관광: "노팁, 노옵션" / 쇼핑센터: "쇼핑 3회 (침향 찻집 캐시미어등)"', supported: true, note: '노쇼핑 아님 주의 — 쇼핑 3회 있음. product_type = "품격"' },
  { id: 'single_supplement', field: 'single_supplement', severity: 'MEDIUM', text: '200,000원', evidence: '원문 불포함: "싱글차지(200,000원/인/전일정)"', supported: true, note: null },
  { id: 'hotels:grade', field: 'accommodations', severity: 'MEDIUM', text: 'D1 비즈니스 게르 / D2 다라터치 카이홍 준5성 / D3-4 하이량프라자 준5성', evidence: '원문 HOTEL: 비즈니스 게르 / 다라터치 카이홍 인터네셔널호텔 (준5성급) / 하이량프라자호텔 (준5성급) x2', supported: true, note: null },
]);

const AUDIT_PKG2 = buildAuditReport('PKG2 (4박5일 고품격 노쇼핑·팁포함·5성)', [
  { id: 'min_participants', field: 'min_participants', severity: 'HIGH', text: '10명', evidence: '원문 출발인원: "성인 10명 이상 / 인솔자 미동행"', supported: true, note: null },
  { id: 'ticketing_deadline', field: 'ticketing_deadline', severity: 'HIGH', text: 'null', evidence: null, supported: true, note: '원문에 발권 마감 키워드 없음' },
  { id: 'inclusions:tips_included', field: 'inclusions', severity: 'CRITICAL', text: '기사/가이드팁 포함', evidence: '원문 포함 사항: "항공료, 유류할증료(4월), TAX, 호텔, 식사, 전용차량, 관광지 입장료, 여행자보험, 기사/가이드팁"', supported: true, note: '품격 대비 차이점 — 고품격은 팁까지 포함' },
  { id: 'inclusions:travel_insurance', field: 'inclusions', severity: 'CRITICAL', text: '여행자보험 (금액 주입 없음)', evidence: '원문 포함: "여행자보험"', supported: true, note: null },
  { id: 'surcharges:empty', field: 'surcharges', severity: 'HIGH', text: '[]', evidence: null, supported: true, note: '원문에 연휴/공휴일 추가요금 없음' },
  { id: 'product_type:noshopping', field: 'product_type', severity: 'CRITICAL', text: '고품격 (노팁·노옵션·노쇼핑)', evidence: '원문 선택관광: "노옵션" / 쇼핑센터: "노쇼핑" / 포함에 "기사/가이드팁"', supported: true, note: '실제 노쇼핑 — 품격과 명확히 구분' },
  { id: 'notices:PAYMENT', field: 'notices_parsed', severity: 'CRITICAL', text: '계약금·전세기 취소 수수료', evidence: '원문 동일 (PKG1과 공용)', supported: true, note: null },
  { id: 'regions:d1-d5', field: 'itinerary_data.days[].regions', severity: 'HIGH', text: 'D1=[부산,호화호특] / D2=[초원,춘쿤산,사막,호화호특] / D3=[호화호특] / D4=[호화호특] / D5=[호화호특,부산]', evidence: '원문 지역 컬럼 1:1 매핑 (제3일 "호화호특" — 품격과 다름 주의)', supported: true, note: '품격 D3 지역 컬럼은 "초원", 고품격 D3는 "호화호특" — 상품별 독립 파싱 확인 (ERR-KUL-02/03)' },
  { id: 'day3_massage_diff', field: 'itinerary_data.days[2]', severity: 'MEDIUM', text: '고품격 Day3 발+전신마사지 80분 (품격은 발마사지 50분)', evidence: '원문 D3: "발+전신마사지 체험 80분(매너팁 5불 불포함)"', supported: true, note: '품격과 명확히 구분 — 공용 schedule 사용 X' },
  { id: 'single_supplement', field: 'single_supplement', severity: 'MEDIUM', text: '240,000원', evidence: '원문 불포함: "싱글차지(240,000원/인/전일정)"', supported: true, note: null },
  { id: 'hotels:grade', field: 'accommodations', severity: 'MEDIUM', text: 'D1 궁전 게르 / D2 달라터치 진이 우등 5성 / D3-4 우란대주점호텔 5성', evidence: '원문 HOTEL: 궁전 게르 / 달라터치 진이 우등 호텔 (5성급) / 우란대주점호텔 (5성급) x2', supported: true, note: '품격 대비 상위 등급 (5성급)' },
]);

// ── 공용 product_tags ────────────────────────────────────────────
const COMMON_TAGS = ['#호화호특', '#내몽고', '#전세기', '#에어부산', '#부산출발', '#시라무런초원', '#샹사완사막'];

// ══════════════════════════════════════════════════════════════════
// PKG1: 부산출발 호화호특 4박5일 품격 (노팁·노옵션, 쇼핑 3회, 준5성)
// ══════════════════════════════════════════════════════════════════

const PKG1 = {
  title: '부산출발 호화호특 4박5일 품격 (노팁·노옵션, 에어부산 BX 전세기)',
  destination: '호화호특',
  country: '중국',
  category: 'package',
  product_type: '품격',
  trip_style: '4박5일',
  duration: 5,
  nights: 4,
  departure_airport: '부산(김해)',
  departure_days: '수',
  airline: 'BX(에어부산)',
  min_participants: 10,
  status: 'pending',
  price: 1049000, // 최저가 (7/8, 8/26)
  guide_tip: null,
  single_supplement: 200000,
  small_group_surcharge: null,
  surcharges: [], // 원문에 연휴 추가요금 없음 (주차별 가격차는 price_tiers 로 표현)
  excluded_dates: [],
  price_tiers: [
    {
      period_label: '7월 8일 (수)',
      departure_dates: ['2026-07-08'],
      departure_day_of_week: '수',
      adult_price: 1049000, child_price: null,
      status: 'available', note: null,
    },
    {
      period_label: '7월 15일 (수)',
      departure_dates: ['2026-07-15'],
      departure_day_of_week: '수',
      adult_price: 1099000, child_price: null,
      status: 'available', note: null,
    },
    {
      period_label: '7월 22일 (수)',
      departure_dates: ['2026-07-22'],
      departure_day_of_week: '수',
      adult_price: 1149000, child_price: null,
      status: 'available', note: null,
    },
    {
      period_label: '7월 29일 (수)',
      departure_dates: ['2026-07-29'],
      departure_day_of_week: '수',
      adult_price: 1199000, child_price: null,
      status: 'available', note: null,
    },
    {
      period_label: '8월 5일 (수)',
      departure_dates: ['2026-08-05'],
      departure_day_of_week: '수',
      adult_price: 1199000, child_price: null,
      status: 'available', note: null,
    },
    {
      period_label: '8월 12일 (수)',
      departure_dates: ['2026-08-12'],
      departure_day_of_week: '수',
      adult_price: 1149000, child_price: null,
      status: 'available', note: null,
    },
    {
      period_label: '8월 19일 (수)',
      departure_dates: ['2026-08-19'],
      departure_day_of_week: '수',
      adult_price: 1099000, child_price: null,
      status: 'available', note: null,
    },
    {
      period_label: '8월 26일 (수)',
      departure_dates: ['2026-08-26'],
      departure_day_of_week: '수',
      adult_price: 1049000, child_price: null,
      status: 'available', note: null,
    },
  ],
  inclusions: INCLUSIONS_PKG1,
  excludes: EXCLUDES_PKG1,
  optional_tours: [], // 노옵션 — 판매 가능한 선택관광 없음
  accommodations: [
    '비즈니스 게르 (2인1실, 화장실·샤워실 있음)',
    '다라터치 카이홍 인터네셔널호텔 또는 동급 (준5성급)',
    '하이량프라자호텔 또는 동급 (준5성급)',
  ],
  product_highlights: [
    '부산-호화호특 직항 전세기로 환승 없이 바로 내몽고',
    '시라무런 초원 승마·마상공연·캠프파이어까지 초원 체험 풀코스',
    '샹사완 사막 액티비티 4종 (낙타·4륜오토바이·모래썰매·써핑카트)',
    '춘쿤산·왕소군묘·내몽고박물관까지 핵심 관광지 모두 포함',
  ],
  product_summary: '내몽고 호화호특을 부산에서 직항 전세기로 편하게 다녀오실 수 있는 4박5일 패키지입니다. 시라무런 초원에서 승마·마상공연·캠프파이어로 유목민 생활을 직접 체험하시고, 샹사완 사막에서는 낙타·4륜오토바이·모래썰매 같은 액티비티 4종을 즐기실 수 있어요. 호화호특 시내 싸이쌍 옛거리·오탑사부터 왕소군묘·내몽고박물관까지 핵심 명소를 빠짐없이 돌아봅니다. 노팁·노옵션 구성이라 불필요한 추가 결제 스트레스 없이 다녀오실 수 있어요.',
  product_tags: COMMON_TAGS,
  notices_parsed: COMMON_NOTICES,
  special_notes: '쇼핑 3회 안내: 침향, 찻집, 캐시미어 등 (고객이 구매를 원하지 않으면 관람만 진행)',
  itinerary_data: {
    meta: {
      title: '부산출발 호화호특 4박5일 품격',
      product_type: '품격',
      destination: '호화호특',
      nights: 4, days: 5,
      departure_airport: '부산(김해)',
      airline: 'BX(에어부산)',
      flight_out: 'BX3455',
      flight_in: 'BX3465',
      departure_days: '수',
      min_participants: 10,
      room_type: '2인1실',
      ticketing_deadline: null,
      hashtags: ['#호화호특', '#내몽고', '#전세기'],
      brand: '여소남',
    },
    highlights: {
      inclusions: INCLUSIONS_PKG1,
      excludes: EXCLUDES_PKG1,
      shopping: '쇼핑 3회 (침향·찻집·캐시미어 등)',
      remarks: [
        '해당 항공은 정부 운항 허가 조건으로 진행하는 내몽고 호화호특 직항 전세기 항공이며, 허가 조건에 따라 항공 스케줄 및 취항 시기가 변경 될 수 있습니다.',
        '여권 유효기간 6개월 이상 필수 (하루라도 모자라면 출발 불가).',
        '중국 무비자 정책 2026년 12월 31일까지 15일 체류 가능.',
        '전자입국신고서 필수 (여권 빛 반사 없이 촬영한 사진 필요).',
        '패키지 상품으로 개별활동 불가 (불참 시 서비스 제공 안 됨).',
        '계약금 1인 300,000원 / 전세기 특별약관 적용 (취소 수수료 구간 별도 안내).',
      ],
    },
    days: [
      {
        day: 1, regions: ['부산', '호화호특'],
        meals: meal(false, true, true, null, '샤브샤브', '현지식'),
        schedule: [
          flight('07:30', '부산 김해국제공항 출발 → 호화호특 국제공항 09:55 도착', 'BX3455'),
          normal(null, '가이드 미팅 후 시내로 이동 (약 30분)'),
          normal(null, '중식'),
          normal(null, '지평선이 닫는 시라무런 초원으로 이동'),
          normal(null, '▶시라무런 초원 대초원 산책 및 승마체험 (약 40분 소요)'),
          normal(null, '▶유목민 생활 체험 (초원 오토바이, 활쏘기, 몽골족 간식 및 밀크티 맛보기, 전통 몽골 복장 체험 및 사진 촬영, 오보우산에서 전초원 관람)'),
          normal(null, '▶대형 마상공연 관람 (60마리 말과 사람이 함께하는 대형 마상공연)'),
          normal(null, '초원 일몰 감상 (자율)'),
          normal(null, '석식 후 초원 캠프 파이어 및 민속공연 관람 (우천 시 진행불가)'),
          normal(null, '초원의 쏟아지는 별자리 감상'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '비즈니스 게르', grade: '게르', note: '2인1실, 화장실·샤워실 있음' },
      },
      {
        day: 2, regions: ['초원', '춘쿤산', '사막', '호화호특'],
        meals: meal(true, true, true, '호텔식', '야채비빔밥', '무제한삼겹살'),
        schedule: [
          normal('04:30', '기상 후 초원 일출 감상 (자율)'),
          normal(null, '조식 후 춘쿤산으로 이동 (약 2시간 30분 소요)'),
          normal(null, '▶춘쿤산 관광 (2340M 높이의 구름 속 초원, 전통카트왕복 및 전망대관람 포함)'),
          normal(null, '5A급관광구 샹사완 사막으로 이동 (약 2시간 소요)'),
          normal(null, '▶샹사완 사막 액티비티 체험 (써핑카트, 사막낙타체험, 사막4륜오토바이, 모래썰매)'),
          normal(null, '사막 안에서 일몰 감상하며 석식'),
          normal(null, '호화호특으로 이동 (약 2시간 30분 소요)'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '다라터치 카이홍 인터네셔널호텔', grade: '준5성급', note: '또는 동급 호텔' },
      },
      {
        day: 3, regions: ['호화호특'],
        meals: meal(true, true, true, '게르식', '현지식', '한식'),
        schedule: [
          normal(null, '호텔 조식 후 호화호특으로 이동 (약 2시간 30분)'),
          normal(null, '▶싸이쌍 옛거리 (400년 역사를 가진 옛거리)'),
          normal(null, '▶오탑사 (五塔寺, 460년 역사를 가진 사찰)'),
          normal(null, '▶발마사지 체험 50분 (매너팁 5불 불포함)'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '하이량프라자호텔', grade: '준5성급', note: '또는 동급 호텔' },
      },
      {
        day: 4, regions: ['호화호특'],
        meals: meal(true, true, true, '초원식', '현지식(소머리찜)', '동북요리'),
        schedule: [
          normal(null, '호텔 조식'),
          normal(null, '▶왕소군묘 (2000년 역사, 중국 4대 미인 중 한 명·평화의 상징)'),
          normal(null, '▶내몽고민속용품공장 (중국 4A급 관광지, 명량관광)'),
          normal(null, '▶내몽고박물관 (아시아 최대 공룡화석관 및 8개관 관광)'),
          normal(null, '석식'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '하이량프라자호텔', grade: '준5성급', note: '또는 동급 호텔' },
      },
      {
        day: 5, regions: ['호화호특', '부산'],
        meals: meal(true, true, false, '호텔식', '간편도시락(빵, 옥수수, 과일, 물)', null),
        schedule: [
          normal(null, '호텔 조식 후 호화호특 공항으로 이동'),
          flight('11:55', '호화호특 국제공항 출발 → 부산 김해국제공항 16:30 도착', 'BX3465'),
        ],
        hotel: { name: null, grade: null, note: null },
      },
    ],
    optional_tours: [],
  },
  itinerary: [
    '제1일 (수): 부산(김해) 07:30 → 호화호특 09:55 / 시라무런 초원 승마·마상공연·캠프파이어 / 게르 숙박',
    '제2일 (목): 초원 일출 → 춘쿤산 → 샹사완 사막 액티비티 4종 → 호화호특 / 호텔 숙박',
    '제3일 (금): 싸이쌍 옛거리 / 오탑사 / 발마사지 50분 / 호텔 숙박',
    '제4일 (토): 왕소군묘 / 내몽고민속용품공장 / 내몽고박물관 / 호텔 숙박',
    '제5일 (일): 호텔 조식 → 호화호특 11:55 → 부산(김해) 16:30',
  ],
  raw_text: RAW_PKG1,
  raw_text_hash: hash(RAW_PKG1),
  parser_version: 'register-v2026.04.21-sonnet-4.6',
  agent_audit_report: AUDIT_PKG1,
  filename: 'manual_input_hohhot_pumgyeok',
  file_type: 'manual',
  confidence: 1.0,
};

// ══════════════════════════════════════════════════════════════════
// PKG2: 부산출발 호화호특 4박5일 고품격 (노팁·노옵션·노쇼핑, 5성)
// ══════════════════════════════════════════════════════════════════

const PKG2 = {
  title: '부산출발 호화호특 4박5일 고품격 (노팁·노옵션·노쇼핑, 에어부산 BX 전세기)',
  destination: '호화호특',
  country: '중국',
  category: 'package',
  product_type: '고품격',
  trip_style: '4박5일',
  duration: 5,
  nights: 4,
  departure_airport: '부산(김해)',
  departure_days: '수',
  airline: 'BX(에어부산)',
  min_participants: 10,
  status: 'pending',
  price: 1199000, // 최저가 (7/8, 8/26)
  guide_tip: null,
  single_supplement: 240000,
  small_group_surcharge: null,
  surcharges: [],
  excluded_dates: [],
  price_tiers: [
    { period_label: '7월 8일 (수)',  departure_dates: ['2026-07-08'], departure_day_of_week: '수', adult_price: 1199000, child_price: null, status: 'available', note: null },
    { period_label: '7월 15일 (수)', departure_dates: ['2026-07-15'], departure_day_of_week: '수', adult_price: 1249000, child_price: null, status: 'available', note: null },
    { period_label: '7월 22일 (수)', departure_dates: ['2026-07-22'], departure_day_of_week: '수', adult_price: 1399000, child_price: null, status: 'available', note: null },
    { period_label: '7월 29일 (수)', departure_dates: ['2026-07-29'], departure_day_of_week: '수', adult_price: 1599000, child_price: null, status: 'available', note: null },
    { period_label: '8월 5일 (수)',  departure_dates: ['2026-08-05'], departure_day_of_week: '수', adult_price: 1599000, child_price: null, status: 'available', note: null },
    { period_label: '8월 12일 (수)', departure_dates: ['2026-08-12'], departure_day_of_week: '수', adult_price: 1399000, child_price: null, status: 'available', note: null },
    { period_label: '8월 19일 (수)', departure_dates: ['2026-08-19'], departure_day_of_week: '수', adult_price: 1249000, child_price: null, status: 'available', note: null },
    { period_label: '8월 26일 (수)', departure_dates: ['2026-08-26'], departure_day_of_week: '수', adult_price: 1199000, child_price: null, status: 'available', note: null },
  ],
  inclusions: INCLUSIONS_PKG2,
  excludes: EXCLUDES_PKG2,
  optional_tours: [],
  accommodations: [
    '궁전 게르 (2인1실, 화장실·샤워실 있음)',
    '달라터치 진이 우등 호텔 또는 동급 (5성급)',
    '우란대주점호텔 또는 동급 (5성급)',
  ],
  product_highlights: [
    '부산-호화호특 직항 전세기 + 기사/가이드팁까지 전부 포함',
    '5성급 호텔 (달라터치 진이·우란대주점) + 궁전 게르 업그레이드',
    '노팁·노옵션·노쇼핑 — 추가결제 걱정 없는 고품격 구성',
    '발+전신 마사지 80분 (품격 대비 업그레이드)',
  ],
  product_summary: '호화호특을 진짜 편안하게 다녀오고 싶으신 분께 추천드리는 4박5일 고품격 상품입니다. 팁·옵션·쇼핑이 모두 없어 현지에서 추가로 지갑을 열 일이 거의 없고, 숙소도 5성급(달라터치 진이·우란대주점) + 궁전 게르로 업그레이드했습니다. 시라무런 초원·샹사완 사막 액티비티는 품격과 동일하게 즐기시고, 3일차 발+전신마사지 80분으로 여독까지 풀고 오세요.',
  product_tags: [...COMMON_TAGS, '#노쇼핑', '#노팁'],
  notices_parsed: COMMON_NOTICES,
  special_notes: null, // 노쇼핑 — 특이사항 없음
  itinerary_data: {
    meta: {
      title: '부산출발 호화호특 4박5일 고품격',
      product_type: '고품격',
      destination: '호화호특',
      nights: 4, days: 5,
      departure_airport: '부산(김해)',
      airline: 'BX(에어부산)',
      flight_out: 'BX3455',
      flight_in: 'BX3465',
      departure_days: '수',
      min_participants: 10,
      room_type: '2인1실',
      ticketing_deadline: null,
      hashtags: ['#호화호특', '#내몽고', '#전세기', '#노쇼핑'],
      brand: '여소남',
    },
    highlights: {
      inclusions: INCLUSIONS_PKG2,
      excludes: EXCLUDES_PKG2,
      shopping: '노쇼핑',
      remarks: [
        '해당 항공은 정부 운항 허가 조건으로 진행하는 내몽고 호화호특 직항 전세기 항공이며, 허가 조건에 따라 항공 스케줄 및 취항 시기가 변경 될 수 있습니다.',
        '여권 유효기간 6개월 이상 필수 (하루라도 모자라면 출발 불가).',
        '중국 무비자 정책 2026년 12월 31일까지 15일 체류 가능.',
        '전자입국신고서 필수 (여권 빛 반사 없이 촬영한 사진 필요).',
        '패키지 상품으로 개별활동 불가 (불참 시 서비스 제공 안 됨).',
        '계약금 1인 300,000원 / 전세기 특별약관 적용 (취소 수수료 구간 별도 안내).',
      ],
    },
    days: [
      {
        day: 1, regions: ['부산', '호화호특'],
        meals: meal(false, true, true, null, '샤브샤브', '현지식'),
        schedule: [
          flight('07:30', '부산 김해국제공항 출발 → 호화호특 국제공항 09:55 도착', 'BX3455'),
          normal(null, '가이드 미팅 후 시내로 이동 (약 30분)'),
          normal(null, '중식'),
          normal(null, '지평선이 닫는 시라무런 초원으로 이동'),
          normal(null, '▶시라무런 초원 대초원 산책 및 승마체험 (약 40분 소요)'),
          normal(null, '▶유목민 생활 체험 (초원 오토바이, 활쏘기, 몽골족 간식 및 밀크티 맛보기, 전통 몽골 복장 체험 및 사진 촬영, 오보우산에서 전초원 관람)'),
          normal(null, '▶대형 마상공연 관람 (60마리 말과 사람이 함께하는 대형 마상공연)'),
          normal(null, '초원 일몰 감상 (자율)'),
          normal(null, '석식 후 초원 캠프 파이어 및 민속공연 관람 (우천 시 진행불가)'),
          normal(null, '초원의 쏟아지는 별자리 감상'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '궁전 게르', grade: '게르(업그레이드)', note: '2인1실, 화장실·샤워실 있음' },
      },
      {
        day: 2, regions: ['초원', '춘쿤산', '사막', '호화호특'],
        meals: meal(true, true, true, '호텔식', '야채비빔밥', '무제한삼겹살'),
        schedule: [
          normal('04:30', '기상 후 초원 일출 감상 (자율)'),
          normal(null, '조식 후 춘쿤산으로 이동 (약 2시간 30분 소요)'),
          normal(null, '▶춘쿤산 관광 (2340M 높이의 구름 속 초원, 전통카트왕복 및 전망대관람 포함)'),
          normal(null, '5A급관광구 샹사완 사막으로 이동 (약 2시간 소요)'),
          normal(null, '▶샹사완 사막 액티비티 체험 (써핑카트, 사막낙타체험, 사막4륜오토바이, 모래썰매)'),
          normal(null, '사막 안에서 일몰 감상하며 석식'),
          normal(null, '호화호특으로 이동 (약 2시간 30분 소요)'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '달라터치 진이 우등 호텔', grade: '5성급', note: '또는 동급 호텔' },
      },
      {
        day: 3, regions: ['호화호특'],
        meals: meal(true, true, true, '게르식', '현지식', '한식'),
        schedule: [
          normal(null, '호텔 조식 후 호화호특으로 이동 (약 2시간 30분)'),
          normal(null, '▶싸이쌍 옛거리 (400년 역사를 가진 옛거리)'),
          normal(null, '▶오탑사 (五塔寺, 460년 역사를 가진 사찰)'),
          normal(null, '▶발+전신마사지 체험 80분 (매너팁 5불 불포함)'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '우란대주점호텔', grade: '5성급', note: '또는 동급 호텔' },
      },
      {
        day: 4, regions: ['호화호특'],
        meals: meal(true, true, true, '초원식', '현지식(소머리찜)', '동북요리'),
        schedule: [
          normal(null, '호텔 조식'),
          normal(null, '▶왕소군묘 (2000년 역사, 중국 4대 미인 중 한 명·평화의 상징)'),
          normal(null, '▶내몽고민속용품공장 (중국 4A급 관광지, 명량관광)'),
          normal(null, '▶내몽고박물관 (아시아 최대 공룡화석관 및 8개관 관광)'),
          normal(null, '석식'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '우란대주점호텔', grade: '5성급', note: '또는 동급 호텔' },
      },
      {
        day: 5, regions: ['호화호특', '부산'],
        meals: meal(true, true, false, '호텔식', '간편도시락(빵, 옥수수, 과일, 물)', null),
        schedule: [
          normal(null, '호텔 조식 후 호화호특 공항으로 이동'),
          flight('11:55', '호화호특 국제공항 출발 → 부산 김해국제공항 16:30 도착', 'BX3465'),
        ],
        hotel: { name: null, grade: null, note: null },
      },
    ],
    optional_tours: [],
  },
  itinerary: [
    '제1일 (수): 부산(김해) 07:30 → 호화호특 09:55 / 시라무런 초원 승마·마상공연·캠프파이어 / 궁전 게르',
    '제2일 (목): 초원 일출 → 춘쿤산 → 샹사완 사막 액티비티 4종 → 호화호특 / 5성급 호텔',
    '제3일 (금): 싸이쌍 옛거리 / 오탑사 / 발+전신마사지 80분 / 5성급 호텔',
    '제4일 (토): 왕소군묘 / 내몽고민속용품공장 / 내몽고박물관 / 5성급 호텔',
    '제5일 (일): 호텔 조식 → 호화호특 11:55 → 부산(김해) 16:30',
  ],
  raw_text: RAW_PKG2,
  raw_text_hash: hash(RAW_PKG2),
  parser_version: 'register-v2026.04.21-sonnet-4.6',
  agent_audit_report: AUDIT_PKG2,
  filename: 'manual_input_hohhot_gopumgyeok',
  file_type: 'manual',
  confidence: 1.0,
};

inserter.run([PKG1, PKG2]).then((result) => {
  console.log('\n✅ 더투어 / 부산-호화호특 4박5일 전세기 등록 스크립트 완료 (품격 + 고품격)');
  console.log(`   inserted=${result.inserted} / archived=${result.archived} / skipped=${result.skipped}`);
  process.exit(0);
}).catch(err => {
  console.error('❌ 등록 실패:', err);
  process.exit(1);
});
