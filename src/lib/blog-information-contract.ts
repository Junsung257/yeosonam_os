import { stripMarkup } from './blog-text-utils';
import { validateBlogInformationStructure } from './blog-information-structure';

export const BLOG_INFORMATION_INTENTS = [
  'food_budget',
  'monthly_weather',
  'airport_transport',
  'local_transport',
  'hotel_areas',
  'family_budget',
  'itinerary',
  'shopping_souvenirs',
  'currency_payment',
  'entry_requirements',
  'travel_insurance',
] as const;

export type BlogInformationPublishableIntent = (typeof BLOG_INFORMATION_INTENTS)[number];
export type BlogInformationIntent = BlogInformationPublishableIntent | 'general';

export interface BlogInformationContractInput {
  intentType?: BlogInformationIntent | 'family_itinerary' | null;
  destination?: string | null;
  topic?: string | null;
  primaryKeyword?: string | null;
  category?: string | null;
  microAngle?: string | null;
}

export interface BlogInformationRequiredSlot {
  id: string;
  label: string;
  signals: string[][];
  requiresTable?: boolean;
}

export interface BlogInformationSourcePolicy {
  minimumClaimSourceCoverage: number;
  primarySourcesRequired: boolean;
  exactNumbersRequireSource: boolean;
  retrievedAtRequired: boolean;
  sourceTypes: string[];
}

export interface BlogInformationHumanReviewPolicy {
  required: boolean;
  reason: string | null;
}

export type BlogDestinationEntityIssueCode =
  | 'numeric_destination'
  | 'reserved_destination'
  | 'audience_destination'
  | 'machine_concatenated_destination';

export interface BlogDestinationEntityIssue {
  code: BlogDestinationEntityIssueCode;
  value: string;
  message: string;
}

export interface BlogDestinationEntityValidation {
  valid: boolean;
  destination: string | null;
  issues: BlogDestinationEntityIssue[];
}

export interface BlogInformationContract {
  intentType: BlogInformationIntent;
  destination: BlogDestinationEntityValidation;
  requiredSlots: BlogInformationRequiredSlot[];
  sourcePolicy: BlogInformationSourcePolicy;
  humanReview: BlogInformationHumanReviewPolicy;
  requiredSections: string[];
  sourceRequirements: string[];
  passed: boolean;
  issues: Array<BlogDestinationEntityIssueCode | 'missing_destination_for_intent' | 'unresolved_intent'>;
}

export type BlogInformationMarkdownIssueCode =
  | 'missing_required_slot'
  | 'invalid_structured_content'
  | 'internal_operational_data_leak';

export interface BlogInformationMarkdownIssue {
  code: BlogInformationMarkdownIssueCode;
  message: string;
  evidence?: Record<string, unknown>;
}

export interface BlogInformationMarkdownReport {
  passed: boolean;
  intentType: BlogInformationIntent;
  coveredSlots: string[];
  missingSlots: string[];
  structuredIssues: string[];
  operationalDataLeaks: string[];
  issues: BlogInformationMarkdownIssue[];
}

const INVALID_AUDIENCE_DESTINATIONS = new Set([
  '가족',
  '대학생',
  '아이',
  '어린이',
  '부모님',
  '시니어',
  '신혼부부',
  '커플',
  '혼자',
  '혼행',
  '여행자',
  '고객',
  'family',
  'student',
  'students',
  'senior',
  'couple',
  'traveler',
  'traveller',
]);

const RESERVED_DESTINATIONS = new Set([
  'top',
  'best',
  'all',
  'popular',
  '추천',
  '전체',
  '여행',
  '여행지',
  '해외여행',
]);

const MICRO_ANGLE_INTENTS: Record<string, BlogInformationIntent> = {
  food_budget: 'food_budget',
  weather_packing: 'monthly_weather',
  airport_arrival: 'airport_transport',
  transport_cost: 'local_transport',
  local_mobility: 'local_transport',
  hotel_area: 'hotel_areas',
  budget_family: 'family_budget',
  kid_friendly: 'itinerary',
  shopping_budget: 'shopping_souvenirs',
};

const CATEGORY_INTENTS: Array<[RegExp, BlogInformationIntent]> = [
  [/visa|entry|immigration|입국|비자|세관|면세/i, 'entry_requirements'],
  [/insurance|보험/i, 'travel_insurance'],
  [/weather|climate|날씨|기후/i, 'monthly_weather'],
  [/food|meal|dining|미식|식비|맛집/i, 'food_budget'],
  [/hotel|lodging|stay|숙소|호텔/i, 'hotel_areas'],
  [/shopping|souvenir|쇼핑|기념품|선물/i, 'shopping_souvenirs'],
  [/currency|payment|exchange|환율|환전|결제/i, 'currency_payment'],
  [/airport|공항/i, 'airport_transport'],
  [/transport|transit|교통|이동/i, 'local_transport'],
  [/itinerary|route|일정|코스|동선|family|kid|가족|아이/i, 'itinerary'],
];

const TEXT_INTENTS: Array<[RegExp, BlogInformationIntent]> = [
  [/(?:비자|입국|여권|전자허가|입국\s*신고|세관|면세|visa|immigration|passport|eta|esta)/i, 'entry_requirements'],
  [/(?:여행자?\s*보험|해외\s*보험|의료비|응급\s*후송|수하물\s*(?:분실|지연)|travel\s*insurance)/i, 'travel_insurance'],
  [/(?:날씨|월별|옷차림|우기|건기|기온|강수|태풍|weather|climate|rainfall)/i, 'monthly_weather'],
  [/(?:식비|음식값|메뉴\s*가격|맛집\s*비용|meal\s*budget|food\s*(?:cost|budget))/i, 'food_budget'],
  [/(?:숙소\s*지역|호텔\s*(?:지역|위치)|어디에\s*묵|hotel\s*areas?|where\s*to\s*stay)/i, 'hotel_areas'],
  [/(?:공항|픽업|공항철도|리무진|첫차|막차|airport\s*(?:transport|transfer)|transfer)/i, 'airport_transport'],
  [/(?:대중교통|시내\s*교통|현지\s*교통|교통비|렌터카|버스\s*노선|열차\s*노선|public\s*transport|local\s*(?:transport|transit)|rental\s*car)/i, 'local_transport'],
  [/(?:가족|아이|아동|부모님|family|kid).*(?:예산|비용|경비|budget)|(?:예산|비용|경비|budget).*(?:가족|아이|아동|부모님|family|kid)/i, 'family_budget'],
  [/(?:기념품|쇼핑|선물|souvenirs?|shopping).*(?:가격|구매|시장|매장|품목)?|(?:가격|구매|시장|매장|품목).*(?:기념품|쇼핑|선물|souvenirs?|shopping)/i, 'shopping_souvenirs'],
  [/(?:일정|코스|동선|여정|itinerary|route)/i, 'itinerary'],
  [/(?:환율|환전|현금|카드\s*결제|모바일\s*결제|결제\s*수단|currency|exchange|payment)/i, 'currency_payment'],
];

const EXPLICIT_PREPARATION_RE = /준비물|체크\s*리스트|체크리스트|짐\s*싸기|짐싸기|필수품|packing|checklist|preparation/i;

function isExplicitPreparationQuestion(input: BlogInformationContractInput): boolean {
  return EXPLICIT_PREPARATION_RE.test(clean([
    input.topic,
    input.primaryKeyword,
  ].filter(Boolean).join(' ')));
}

const SLOTS: Record<BlogInformationIntent, BlogInformationRequiredSlot[]> = {
  food_budget: [
    slot('quick_answer', '3줄 빠른 답', [['빠른 답', '핵심 요약', '한눈에']]),
    slot('daily_budget', '1인 1일 예산', [['1인', '한 사람'], ['1일', '하루'], ['절약', '일반', '여유'], ['예산', '비용']]),
    slot('meal_ranges', '끼니별 가격 범위', [['아침'], ['점심'], ['저녁'], ['간식', '카페']]),
    slot('representative_menus', '대표 메뉴와 가격', [['대표 메뉴', '메뉴'], ['가격', '비용']]),
    slot('area_price_difference', '지역별 가격 차이', [['지역별', '지역'], ['가격 차이', '비용 차이']]),
    slot('trip_total', '숙박일별 총액 예시', [['3박 4일', '4박 5일', '총액']]),
    slot('party_scenarios', '인원 구성별 시나리오', [['1인', '커플', '가족']]),
    slot('currency_basis', '통화와 환산 기준일', [['통화', '환율', '환산'], ['기준일', '확인일']]),
    slot('fees_and_booking', '세금·서비스료·예약 조건', [['세금', '서비스료'], ['예약']]),
    slot('food_sources', '가격 조사 출처', [['출처', '공식', '현장 조사', '확인 링크']]),
  ],
  monthly_weather: [
    slot('monthly_temperature', '1~12월 평균 기온', [['1월'], ['12월'], ['최고', '최저'], ['기온', '℃']], true),
    slot('precipitation', '강수량 또는 강수일', [['강수량', '강수일', '비']], true),
    slot('humidity_wind', '습도와 바람', [['습도', '바람']]),
    slot('season_risk', '우기·건기와 이상기후 위험', [['우기', '건기'], ['태풍', '폭염', '한파', '위험']]),
    slot('monthly_clothing', '월별 옷차림', [['옷차림', '복장']]),
    slot('best_time', '여행 목적별 추천 시기', [['추천 시기', '여행 시기', '언제']]),
    slot('forecast_link', '출발 직전 예보 링크', [['예보', '기상청', '출발 직전'], ['http', '공식 링크', '확인 링크']]),
    slot('climate_period_source', '기후 평년값 관측 기간과 출처', [['관측 기간', '평년'], ['출처', '공식']]),
  ],
  airport_transport: [
    slot('airport_distance', '공항과 주요 숙박 지역 거리', [['공항'], ['거리', 'km'], ['숙소', '호텔', '시내']]),
    slot('mode_comparison', '이동수단 비교', [['열차', '기차'], ['버스'], ['택시'], ['앱 호출', '픽업']]),
    slot('fare_breakdown', '성인·아동·수하물 요금', [['성인'], ['어린이', '아동'], ['수하물'], ['요금', '가격']]),
    slot('schedule', '소요시간·배차·첫차·막차', [['소요시간', '분', '시간'], ['배차'], ['첫차'], ['막차']]),
    slot('ticket_purchase', '티켓 구매 방식', [['티켓', '표'], ['구매', '예매']]),
    slot('late_arrival', '심야 도착 대응', [['심야', '늦은 도착', '밤 도착']]),
    slot('traveler_fit', '인원·짐·아이 동반별 추천', [['인원', '혼자', '2인'], ['짐', '수하물'], ['아이', '아동']]),
    slot('operator_source', '공식 운영사 링크와 확인일', [['공식', '운영사'], ['확인일', '기준일'], ['http', '링크']]),
  ],
  local_transport: [
    slot('route_network', '주요 이동 구간과 노선 범위', [['출발', '도착', '구간'], ['노선', '정류장', '환승']]),
    slot('option_comparison', '현지 이동수단 또는 노선 비교', [['버스', '열차', '셔틀'], ['렌터카', '택시', '도보']]),
    slot('fares_passes', '편도 요금과 패스 가격', [['요금', '가격'], ['편도', '왕복', '패스']]),
    slot('travel_time_frequency', '구간별 소요시간과 배차 간격', [['소요시간', '분', '시간'], ['배차', '간격', '빈도']]),
    slot('operating_schedule', '첫차·막차 또는 운행 시간', [['첫차', '막차'], ['운행 시간', '시간표', '운영 시간']]),
    slot('ticket_reservation', '승차권 구매와 예약 방법', [['승차권', '티켓'], ['구매', '예약']]),
    slot('service_limits', '계절·예약·수하물·운휴 제한', [['계절', '성수기', '운휴'], ['예약', '수하물', '제한']]),
    slot('operator_source', '공식 운영사 링크와 확인일', [['공식', '운영사'], ['확인일', '기준일'], ['http', '링크']]),
  ],
  hotel_areas: [
    slot('four_areas', '실제 숙소 지역 4곳 이상', [['지역 1', '첫 번째 지역', '지역별', '숙소 지역']]),
    slot('pros_cons_fit', '지역별 장단점과 추천 여행자', [['장점'], ['단점'], ['추천 여행자', '추천 대상']]),
    slot('nightly_price', '1박 가격 범위와 성수기', [['1박'], ['가격', '요금'], ['성수기']]),
    slot('access', '공항·역·관광지 접근성', [['공항'], ['역', '정류장'], ['관광지'], ['접근', '이동']]),
    slot('night_accessibility', '야간 분위기와 이동약자 접근성', [['야간', '밤', '소음'], ['계단', '유모차', '접근성']]),
    slot('location_relationship', '지도 또는 위치 관계', [['지도', '위치 관계', '동선']]),
    slot('itinerary_combinations', '일정 유형별 추천 조합', [['일정 유형', '일정별'], ['추천 조합', '조합']]),
  ],
  family_budget: [
    slot('family_scenario', '성인·아동 수와 연령 시나리오', [['성인'], ['아동', '아이'], ['연령', '나이']]),
    slot('trip_length_scope', '숙박일과 항공 포함 범위', [['숙박', '박'], ['항공'], ['포함', '제외']]),
    slot('budget_categories', '항공·숙소·식비·교통·관광·보험·통신', [['항공'], ['숙소'], ['식비'], ['교통'], ['관광'], ['보험'], ['통신']]),
    slot('budget_tiers', '절약형·일반형·여유형 총액', [['절약형'], ['일반형'], ['여유형'], ['총액']]),
    slot('child_fares', '어린이 요금 적용 조건', [['어린이', '아동'], ['요금'], ['조건']]),
    slot('age_rules', '무료·유료 연령 구분', [['무료'], ['유료'], ['연령', '나이']]),
    slot('unexpected_costs', '예상 밖 추가비', [['추가비', '추가 비용', '예상 밖']]),
  ],
  itinerary: [
    slot('party_profile', '동행 구성과 연령', [['성인', '부모님'], ['아이', '아동'], ['나이', '연령']]),
    slot('day_by_day', '일차별 일정', [['1일 차', '1일차'], ['2일 차', '2일차']]),
    slot('movement_rest', '이동시간과 휴식 계획', [['이동시간', '이동 시간'], ['휴식', '낮잠']]),
    slot('meal_access', '식사와 화장실 접근', [['식사'], ['화장실']]),
    slot('weather_alternative', '날씨 변수와 대안 일정', [['날씨', '비'], ['대안', '실내']]),
    slot('age_fit', '연령별 적합성', [['연령별', '나이별', '유아', '청소년']]),
    slot('reservation_checks', '예약·운영시간 확인', [['예약'], ['운영시간', '영업시간'], ['공식', '확인']]),
  ],
  shopping_souvenirs: [
    slot('shopping_items', '실제 기념품·쇼핑 품목', [['기념품', '쇼핑', '선물'], ['품목', '제품']], true),
    slot('item_prices', '품목별 실제 가격', [['가격', '금액'], ['통화', '원', '엔', '달러']], true),
    slot('purchase_areas', '구매 지역과 매장', [['구매 지역', '시장', '매장', '백화점']], true),
    slot('quality_checks', '정품·품질 확인 기준', [['정품', '품질', '유통기한', '원산지']]),
    slot('customs_cautions', '반입·면세 주의', [['반입', '면세', '세관', '금지']]),
    slot('shopping_sources', '가격·세관 근거', [['출처', '확인일', '기준일'], ['http', '공식 링크']]),
  ],
  entry_requirements: [
    slot('destination_country', '목적 국가', [['목적 국가', '입국 국가', '국가']]),
    slot('traveler_nationality', '여행자 국적', [['국적', '대한민국 여권', '한국 국적']]),
    slot('purpose_stay', '여행 목적과 체류기간', [['여행 목적', '관광 목적'], ['체류기간', '체류 기간']]),
    slot('checked_at', '확인 기준일', [['확인 기준일', '확인일', '기준일']]),
    slot('passport_validity', '여권 유효기간', [['여권'], ['유효기간', '잔여 기간']]),
    slot('visa_authorization', '비자·전자허가·입국신고', [['비자'], ['전자허가', 'ETA', 'ESTA'], ['입국신고', '입국 신고']]),
    slot('supporting_documents', '귀국편·숙소·재정증빙', [['귀국편', '왕복 항공권'], ['숙소'], ['재정증빙', '재정 증빙']]),
    slot('customs_allowance', '세관·면세 범위', [['세관'], ['면세']]),
    slot('primary_sources', '정부·대사관·공항·세관 1차 출처', [['정부', '대사관', '공항', '세관'], ['http', '공식 링크', '출처']]),
    slot('exact_official_item', '공식 링크의 정확한 확인 항목', [['확인 항목', '공식 안내'], ['최종 확인', '세부 조건']]),
  ],
  travel_insurance: [
    slot('medical', '해외 의료비', [['해외 의료비', '병원비']]),
    slot('injury_evacuation', '상해·질병·응급후송', [['상해'], ['질병'], ['응급후송', '응급 후송']]),
    slot('flight_disruption', '항공 지연·결항', [['항공 지연'], ['결항']]),
    slot('baggage', '수하물 지연·분실', [['수하물 지연'], ['수하물 분실', '분실']]),
    slot('belongings', '휴대품 손해', [['휴대품', '소지품'], ['손해', '도난']]),
    slot('liability', '배상책임', [['배상책임', '배상 책임']]),
    slot('deductible', '자기부담금', [['자기부담금', '자기 부담금']]),
    slot('exclusions', '제외사항', [['제외사항', '보장 제외', '면책']]),
    slot('card_overlap', '카드보험 중복 여부', [['카드보험', '카드 보험'], ['중복']]),
    slot('claim_documents', '보험금 청구 서류', [['청구'], ['서류']]),
    slot('age_conditions', '연령·기저질환 조건', [['연령', '나이'], ['기저질환', '기저 질환']]),
    slot('expert_review', '보험·법률 전문 검수', [['전문 검수', '전문가 검수'], ['검수일', '검토일']]),
  ],
  currency_payment: [
    slot('currency_answer', '통화와 결제 핵심 답', [['통화', '화폐'], ['결제']]),
    slot('exchange_rate_basis', '환율과 확인 기준일', [['환율'], ['기준일', '확인일']]),
    slot('payment_methods', '현금·카드·모바일 결제 비교', [['현금'], ['카드'], ['모바일 결제', 'QR 결제']]),
    slot('fees', '환전·인출·카드 수수료', [['환전'], ['인출', 'ATM'], ['수수료']]),
    slot('acceptance', '지역·업종별 결제 가능 범위', [['지역별', '업종별', '매장'], ['결제 가능', '사용 가능']]),
    slot('cash_scenario', '필요 현금 시나리오', [['현금'], ['얼마', '예산', '시나리오']]),
    slot('payment_risk', '결제 실패·사기·분실 대응', [['결제 실패', '거절', '사기', '분실'], ['대응', '주의']]),
    slot('financial_sources', '공식 금융·관광기관 출처', [['공식', '중앙은행', '은행', '관광청'], ['출처', '링크']]),
  ],
  general: [
    slot('direct_answer', '검색 질문에 대한 직접 답', [['핵심', '결론', '먼저', '답']]),
    slot('decision_criteria', '상황별 판단 기준', [['판단 기준', '선택 기준', '상황별']]),
    slot('practical_checklist', '실행 체크리스트', [['체크리스트', '확인할 것', '준비할 것']]),
    slot('risks', '변경 가능성과 주의사항', [['주의', '변경', '위험', '리스크']]),
  ],
};

const SOURCE_POLICIES: Record<BlogInformationIntent, BlogInformationSourcePolicy> = {
  food_budget: sourcePolicy(0.9, false, [
    'official',
    'field_research',
    'reputable_local_source',
    'reputable_price_source',
  ]),
  monthly_weather: sourcePolicy(0.9, true, ['meteorological_agency', 'official_climate_data']),
  airport_transport: sourcePolicy(0.9, false, [
    'airport',
    'transport_operator',
    'government',
    'official_tourism',
    'reputable_local_source',
    'reputable_price_source',
  ]),
  local_transport: sourcePolicy(0.9, false, [
    'transport_operator',
    'government',
    'official_tourism',
    'reputable_local_source',
    'reputable_price_source',
  ]),
  hotel_areas: sourcePolicy(0.9, false, [
    'official_map',
    'field_research',
    'reputable_booking_data',
    'reputable_local_source',
  ]),
  family_budget: sourcePolicy(0.9, false, [
    'official',
    'transport_operator',
    'field_research',
    'reputable_price_source',
  ]),
  itinerary: sourcePolicy(0.9, false, [
    'official_operator',
    'official_map',
    'official_tourism',
    'transport_operator',
    'field_research',
    'reputable_local_source',
  ]),
  shopping_souvenirs: sourcePolicy(0.9, false, [
    'official_tourism',
    'field_research',
    'reputable_price_source',
    'reputable_local_source',
    'customs',
  ]),
  entry_requirements: sourcePolicy(1, true, ['government', 'embassy', 'immigration', 'customs']),
  travel_insurance: sourcePolicy(1, true, ['insurer_policy', 'regulator', 'legal_review']),
  currency_payment: sourcePolicy(0.9, true, ['central_bank', 'bank', 'government', 'official_tourism']),
  general: sourcePolicy(0.9, false, ['official', 'reputable_source']),
};

const HUMAN_REVIEW_POLICIES: Record<BlogInformationIntent, BlogInformationHumanReviewPolicy> = {
  entry_requirements: {
    required: true,
    reason: '입국·비자·세관 정보는 공식 1차 출처와 사람 편집자 검수가 필요합니다.',
  },
  travel_insurance: {
    required: true,
    reason: '보험·법률 정보는 전문 검수 없이 자동 발행할 수 없습니다.',
  },
  currency_payment: {
    required: false,
    reason: '면세·반출입·법정 한도를 다룰 때는 별도 사람 검수가 필요합니다.',
  },
  food_budget: noHumanReview(),
  monthly_weather: noHumanReview(),
  airport_transport: noHumanReview(),
  local_transport: noHumanReview(),
  hotel_areas: noHumanReview(),
  family_budget: noHumanReview(),
  itinerary: noHumanReview(),
  shopping_souvenirs: noHumanReview(),
  general: noHumanReview(),
};

const INTERNAL_OPERATIONAL_DATA_PATTERNS = [
  /(?:조회된\s*)?관련\s*상품\s*[:：]?\s*\d+\s*개/gi,
  /활성\s*상품\s*[:：]?\s*\d+\s*개/gi,
  /예약\s*신호\s*[:：]?\s*\d+\s*건/gi,
  /최근\s*예약\s*(?:신호|건수)\s*[:：]?\s*\d+\s*건/gi,
  /여소남\s*(?:원천|내부)\s*데이터\s*신호/gi,
  /상품\s*데이터\s*확인\s*기준/gi,
  /\b(?:active_product_count|booking_count|package_count|reservation_stats|internal_insight)\b/gi,
];

function slot(
  id: string,
  label: string,
  signals: string[][],
  requiresTable = false,
): BlogInformationRequiredSlot {
  return { id, label, signals, requiresTable };
}

function sourcePolicy(
  minimumClaimSourceCoverage: number,
  primarySourcesRequired: boolean,
  sourceTypes: string[],
): BlogInformationSourcePolicy {
  return {
    minimumClaimSourceCoverage,
    primarySourcesRequired,
    exactNumbersRequireSource: true,
    retrievedAtRequired: true,
    sourceTypes,
  };
}

function noHumanReview(): BlogInformationHumanReviewPolicy {
  return { required: false, reason: null };
}

function clean(value?: string | null): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function normalizeForMatch(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s*_`#>|()[\]{}'".,:;!?~\/\\-]+/g, '')
    .trim();
}

function isMachineConcatenatedDestination(value: string): boolean {
  const compact = value.replace(/[\s/_+&-]+/g, '');
  if (/^[a-z]{18,}$/i.test(compact) && !/[\s/_+&-]/.test(value)) return true;
  if (
    !/[\s/_+&-]/.test(value)
    && /(?:kualalumpur.*singapore.*malacca|쿠알라룸푸르.*싱가포르.*말라카)/i.test(compact)
  ) return true;
  return /^(?:post|guide|destination)[-_]?[a-z0-9]{6,}$/i.test(value);
}

export function validateBlogDestinationEntity(destination?: string | null): BlogDestinationEntityValidation {
  const value = clean(destination);
  if (!value) return { valid: true, destination: null, issues: [] };

  const issues: BlogDestinationEntityIssue[] = [];
  const lower = value.toLowerCase();
  if (/^\d+$/.test(value) || /^(?:19|20)\d{2}$/.test(value) || /^\d{1,2}\s*월$/.test(value)) {
    issues.push({ code: 'numeric_destination', value, message: '숫자·연도·월은 목적지 엔티티가 아닙니다.' });
  }
  if (RESERVED_DESTINATIONS.has(lower)) {
    issues.push({ code: 'reserved_destination', value, message: 'top·best·전체 같은 예약어는 목적지가 아닙니다.' });
  }
  if (INVALID_AUDIENCE_DESTINATIONS.has(lower)) {
    issues.push({ code: 'audience_destination', value, message: '고객 유형은 목적지 엔티티가 아닙니다.' });
  }
  if (isMachineConcatenatedDestination(value)) {
    issues.push({
      code: 'machine_concatenated_destination',
      value,
      message: '구분자 없이 결합된 기계 토큰은 목적지로 사용할 수 없습니다.',
    });
  }

  return {
    valid: issues.length === 0,
    destination: value,
    issues,
  };
}

export function inferBlogInformationIntent(input: BlogInformationContractInput): BlogInformationIntent {
  if (input.intentType === 'family_itinerary') return 'itinerary';
  if (input.intentType === 'general') return 'general';
  if (input.intentType && BLOG_INFORMATION_INTENTS.includes(input.intentType as BlogInformationPublishableIntent)) {
    return input.intentType as BlogInformationPublishableIntent;
  }

  const coreText = clean([input.topic, input.primaryKeyword, input.destination].filter(Boolean).join(' '));
  const microAngle = clean(input.microAngle).toLowerCase();
  if (
    microAngle === 'transport_cost'
    && /공항|픽업|공항철도|리무진|airport\s*(?:transport|transfer)|arrival\s*transfer/i.test(coreText)
  ) {
    return 'airport_transport';
  }
  if (microAngle && MICRO_ANGLE_INTENTS[microAngle]) return MICRO_ANGLE_INTENTS[microAngle];

  for (const [pattern, intent] of TEXT_INTENTS) {
    if (pattern.test(coreText)) return intent;
  }

  const category = clean(input.category);
  for (const [pattern, intent] of CATEGORY_INTENTS) {
    if (pattern.test(category)) return intent;
  }

  return 'general';
}

function sourceRequirementsFor(
  intentType: BlogInformationIntent,
  policy: BlogInformationSourcePolicy,
): string[] {
  const requirements = [
    `검증 가능한 claim의 출처 연결률은 최소 ${Math.round(policy.minimumClaimSourceCoverage * 100)}%여야 함`,
    '정확한 가격·비율·시간·정책 수치는 출처 URL, 확인일, 단위, 적용 조건이 없으면 사용 금지',
    `허용 출처 유형: ${policy.sourceTypes.join(', ')}`,
  ];
  if (policy.primarySourcesRequired) requirements.push('공식 1차 출처가 반드시 필요함');
  if (intentType === 'monthly_weather') requirements.push('기후 평년값은 관측 기간을 함께 표시해야 함');
  if (intentType === 'entry_requirements' || intentType === 'travel_insurance') {
    requirements.push('사람 편집자 승인 전에는 발행할 수 없음');
  }
  return requirements;
}

export function buildBlogInformationContract(input: BlogInformationContractInput): BlogInformationContract {
  const intentType = inferBlogInformationIntent(input);
  const destination = validateBlogDestinationEntity(input.destination);
  const requiredSlots = SLOTS[intentType];
  const sourcePolicyValue = SOURCE_POLICIES[intentType];
  const humanReview = HUMAN_REVIEW_POLICIES[intentType];
  const issues: BlogInformationContract['issues'] = destination.issues.map((issue) => issue.code);

  // Preparation is a concrete decision even though the legacy evidence taxonomy
  // has no dedicated enum. Keep truly generic travel topics private, but allow
  // this narrow compatibility path so V3 can choose its evidence-led archetype.
  if (intentType === 'general' && !isExplicitPreparationQuestion(input)) issues.push('unresolved_intent');
  const destinationRequired = intentType !== 'general' && intentType !== 'travel_insurance';
  if (destinationRequired && !destination.destination) issues.push('missing_destination_for_intent');

  return {
    intentType,
    destination,
    requiredSlots,
    sourcePolicy: sourcePolicyValue,
    humanReview,
    requiredSections: requiredSlots.map((requiredSlot) => requiredSlot.label),
    sourceRequirements: sourceRequirementsFor(intentType, sourcePolicyValue),
    passed: issues.length === 0,
    issues,
  };
}

function hasRenderableMarkdownTable(markdown: string): boolean {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  for (let index = 0; index < lines.length - 4; index += 1) {
    if (!/^\s*\|.+\|\s*$/.test(lines[index] ?? '')) continue;
    if (!/^\s*\|\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|\s*$/.test(lines[index + 1] ?? '')) continue;
    let bodyRows = 0;
    for (let row = index + 2; row < lines.length && /^\s*\|.+\|\s*$/.test(lines[row] ?? ''); row += 1) {
      bodyRows += 1;
    }
    if (bodyRows >= 3) return true;
  }
  return false;
}

function slotCovered(slotDefinition: BlogInformationRequiredSlot, markdown: string, plain: string): boolean {
  const normalizedPlain = normalizeForMatch(plain);
  const normalizedLabel = normalizeForMatch(slotDefinition.label);
  const labelCovered = normalizedLabel.length >= 3 && normalizedPlain.includes(normalizedLabel);
  const signalsCovered = slotDefinition.signals.every((group) =>
    group.some((signal) => {
      if (signal === 'http') return /https?:\/\//i.test(markdown);
      return normalizedPlain.includes(normalizeForMatch(signal));
    }),
  );
  const contentCovered = labelCovered || signalsCovered;
  return contentCovered && (!slotDefinition.requiresTable || hasRenderableMarkdownTable(markdown));
}

function findOperationalDataLeaks(markdown: string): string[] {
  const matches: string[] = [];
  for (const pattern of INTERNAL_OPERATIONAL_DATA_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of markdown.matchAll(pattern)) {
      const value = clean(match[0]);
      if (value && !matches.includes(value)) matches.push(value);
    }
  }
  return matches.slice(0, 12);
}

export function inspectBlogInformationMarkdown(input: {
  markdown: string;
  contract: BlogInformationContract;
}): BlogInformationMarkdownReport {
  const plain = stripMarkup(input.markdown).replace(/\s+/g, ' ').trim();
  const coveredSlots = input.contract.requiredSlots
    .filter((slotDefinition) => slotCovered(slotDefinition, input.markdown, plain))
    .map((slotDefinition) => slotDefinition.id);
  const coveredSet = new Set(coveredSlots);
  const missingSlots = input.contract.requiredSlots
    .filter((slotDefinition) => !coveredSet.has(slotDefinition.id))
    .map((slotDefinition) => slotDefinition.id);
  const operationalDataLeaks = findOperationalDataLeaks(input.markdown);
  const structureReport = validateBlogInformationStructure({
    intent: input.contract.intentType,
    markdown: input.markdown,
  });
  const issues: BlogInformationMarkdownIssue[] = [];

  for (const missingSlot of missingSlots) {
    const definition = input.contract.requiredSlots.find((slotDefinition) => slotDefinition.id === missingSlot);
    issues.push({
      code: 'missing_required_slot',
      message: `필수 정보 슬롯이 없습니다: ${definition?.label ?? missingSlot}`,
      evidence: { slot: missingSlot },
    });
  }
  if (operationalDataLeaks.length > 0) {
    issues.push({
      code: 'internal_operational_data_leak',
      message: '고객에게 공개하면 안 되는 내부 상품·예약 운영값이 포함되어 있습니다.',
      evidence: { samples: operationalDataLeaks },
    });
  }
  if (!structureReport.passed) {
    issues.push({
      code: 'invalid_structured_content',
      message: '의도별 필수 값·행·고유 엔티티·근거 구조가 완성되지 않았습니다.',
      evidence: { issues: structureReport.issues },
    });
  }

  return {
    passed: input.contract.passed && issues.length === 0,
    intentType: input.contract.intentType,
    coveredSlots,
    missingSlots,
    structuredIssues: structureReport.issues,
    operationalDataLeaks,
    issues,
  };
}
