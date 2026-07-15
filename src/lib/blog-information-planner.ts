import {
  buildBlogInformationContract,
  type BlogInformationContract,
  type BlogInformationContractInput,
  type BlogInformationIntent,
} from './blog-information-contract';

export type BlogInformationAudience =
  | 'general'
  | 'family'
  | 'couple'
  | 'solo'
  | 'senior'
  | 'student';

export type BlogInformationRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface BlogInformationPlannerInput extends BlogInformationContractInput {
  audience?: BlogInformationAudience | null;
  locale?: string | null;
  travelerNationality?: string | null;
}

export interface BlogInformationRequiredFact {
  id: string;
  label: string;
  requiresTable: boolean;
}

export interface BlogInformationPlannedTable {
  id: string;
  purpose: string;
  minimumRows: number;
}

export interface BlogInformationPlan {
  intent: BlogInformationIntent;
  destinationId: string | null;
  destinationName: string | null;
  audience: BlogInformationAudience;
  locale: string;
  travelerNationality: string | null;
  primaryQuestion: string;
  requiredSections: string[];
  requiredFacts: BlogInformationRequiredFact[];
  plannedTables: BlogInformationPlannedTable[];
  faqQuestions: string[];
  riskLevel: BlogInformationRiskLevel;
  missingInputs: string[];
  sourcePolicy: BlogInformationContract['sourcePolicy'];
  requiresHumanReview: boolean;
  contract: BlogInformationContract;
  passed: boolean;
}

const AUDIENCE_PATTERNS: Array<[BlogInformationAudience, RegExp]> = [
  ['family', /가족|아이|아동|유아|부모님|family|kid/i],
  ['couple', /커플|부부|신혼|허니문|couple|honeymoon/i],
  ['solo', /혼자|나홀로|1인|solo/i],
  ['senior', /시니어|고령|노년|60대|70대|senior/i],
  ['student', /학생|대학생|유학생|student/i],
];

const TABLE_SLOT_IDS: Partial<Record<BlogInformationIntent, string[]>> = {
  food_budget: ['daily_budget', 'meal_ranges', 'trip_total'],
  monthly_weather: ['monthly_temperature', 'precipitation'],
  airport_transport: ['mode_comparison', 'fare_breakdown', 'schedule'],
  hotel_areas: ['four_areas', 'pros_cons_fit', 'nightly_price'],
  family_budget: ['budget_categories', 'budget_tiers', 'child_fares'],
  family_itinerary: ['day_by_day', 'movement_rest'],
  entry_requirements: ['visa_authorization', 'supporting_documents', 'customs_allowance'],
  travel_insurance: ['exclusions', 'deductible', 'claim_documents'],
  currency_payment: ['payment_methods', 'fees', 'acceptance'],
  general: ['decision_criteria', 'practical_checklist'],
};

function clean(value?: string | null): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function inferAudience(input: BlogInformationPlannerInput): BlogInformationAudience {
  if (input.audience) return input.audience;
  const text = [input.topic, input.primaryKeyword, input.category, input.microAngle]
    .filter(Boolean)
    .join(' ');
  return AUDIENCE_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0] ?? 'general';
}

function normalizeDestinationId(value?: string | null): string | null {
  const normalized = clean(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized || null;
}

function inferTravelerNationality(input: BlogInformationPlannerInput): string | null {
  const explicit = clean(input.travelerNationality);
  if (explicit) return explicit;
  const text = [input.topic, input.primaryKeyword].filter(Boolean).join(' ');
  if (/한국인|대한민국|한국\s*국적|korean/i.test(text)) return 'KR';
  return null;
}

function riskLevel(intent: BlogInformationIntent): BlogInformationRiskLevel {
  if (intent === 'entry_requirements' || intent === 'travel_insurance') return 'HIGH';
  if (['monthly_weather', 'airport_transport', 'currency_payment'].includes(intent)) return 'MEDIUM';
  return 'LOW';
}

function primaryQuestion(intent: BlogInformationIntent, destination: string | null): string {
  const place = destination || '해외여행지';
  const questions: Record<BlogInformationIntent, string> = {
    food_budget: `${place}에서 하루 식비와 메뉴별 예산을 얼마로 잡아야 하나요?`,
    monthly_weather: `${place}의 월별 날씨와 옷차림은 어떻게 준비해야 하나요?`,
    airport_transport: `${place} 공항에서 시내까지 어떤 교통수단이 시간과 비용에 맞나요?`,
    hotel_areas: `${place}에서 일정과 예산에 맞는 숙소 지역은 어디인가요?`,
    family_budget: `${place} 가족여행의 항목별 총예산은 얼마로 잡아야 하나요?`,
    family_itinerary: `${place} 가족여행 일정을 이동과 휴식까지 어떻게 구성해야 하나요?`,
    entry_requirements: `${place} 입국에 필요한 여권·비자·신고·세관 조건은 무엇인가요?`,
    travel_insurance: '여행보험에서 꼭 확인해야 할 보장·면책·청구 조건은 무엇인가요?',
    currency_payment: `${place}에서 환전과 카드·현금 결제를 어떻게 나누는 것이 안전한가요?`,
    general: `${place} 여행을 결정하기 전에 무엇을 확인해야 하나요?`,
  };
  return questions[intent];
}

function faqQuestions(intent: BlogInformationIntent, destination: string | null): string[] {
  const place = destination || '여행지';
  const common = `최신 정보는 출발 전 어디에서 다시 확인하나요?`;
  const questions: Record<BlogInformationIntent, string[]> = {
    food_budget: [`${place} 하루 식비는 얼마인가요?`, '현금과 카드 중 무엇이 유리한가요?', common],
    monthly_weather: [`${place} 여행하기 좋은 달은 언제인가요?`, '비가 오면 어떤 옷과 준비물이 필요한가요?', common],
    airport_transport: ['심야 도착 때 이용 가능한 교통수단은 무엇인가요?', '인원과 수하물에 따라 무엇이 유리한가요?', common],
    hotel_areas: ['첫 방문자에게 편한 지역은 어디인가요?', '공항과 관광지 이동을 함께 고려하면 어디가 좋은가요?', common],
    family_budget: ['아동 요금은 몇 살부터 적용되나요?', '예상 밖 추가 비용은 무엇인가요?', common],
    family_itinerary: ['아이 연령에 따라 일정을 어떻게 줄이나요?', '비 오는 날 대안 일정은 무엇인가요?', common],
    entry_requirements: ['한국 국적 여행자에게 비자가 필요한가요?', '여권 유효기간은 얼마나 남아야 하나요?', common],
    travel_insurance: ['카드 부가보험과 중복되면 어떻게 하나요?', '사고 뒤 어떤 서류를 준비해야 하나요?', common],
    currency_payment: ['현금은 얼마를 준비하면 되나요?', '해외 결제 수수료를 어떻게 확인하나요?', common],
    general: [`${place} 여행 전 가장 먼저 확인할 것은 무엇인가요?`, '일정이 바뀌면 어떤 항목을 다시 확인하나요?', common],
  };
  return questions[intent];
}

export function buildBlogInformationPlan(input: BlogInformationPlannerInput): BlogInformationPlan {
  const contract = buildBlogInformationContract(input);
  const destinationName = contract.destination.valid ? contract.destination.destination : null;
  const destinationId = normalizeDestinationId(destinationName);
  const audience = inferAudience(input);
  const locale = clean(input.locale) || 'ko-KR';
  const travelerNationality = inferTravelerNationality(input);
  const tableIds = new Set(TABLE_SLOT_IDS[contract.intentType] || []);
  const requiredFacts = contract.requiredSlots.map((slot) => ({
    id: slot.id,
    label: slot.label,
    requiresTable: slot.requiresTable === true || tableIds.has(slot.id),
  }));
  const plannedTables = requiredFacts
    .filter((fact) => fact.requiresTable)
    .map((fact) => ({ id: fact.id, purpose: fact.label, minimumRows: 3 }));
  const faqs = faqQuestions(contract.intentType, destinationName);
  const missingInputs = contract.issues.map((issue) => `contract:${issue}`);

  if (!clean(input.topic) && !clean(input.primaryKeyword)) missingInputs.push('topic_or_primary_keyword');
  if (!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(locale)) missingInputs.push('valid_locale');
  if (contract.intentType === 'entry_requirements' && !travelerNationality) {
    missingInputs.push('traveler_nationality');
  }
  if (contract.requiredSections.length < 4) missingInputs.push('required_sections');
  if (requiredFacts.length < 4) missingInputs.push('required_facts');
  if (plannedTables.length === 0) missingInputs.push('planned_tables');
  if (faqs.length < 3) missingInputs.push('faq_questions');

  return {
    intent: contract.intentType,
    destinationId,
    destinationName,
    audience,
    locale,
    travelerNationality,
    primaryQuestion: primaryQuestion(contract.intentType, destinationName),
    requiredSections: contract.requiredSections,
    requiredFacts,
    plannedTables,
    faqQuestions: faqs,
    riskLevel: riskLevel(contract.intentType),
    missingInputs: [...new Set(missingInputs)],
    sourcePolicy: contract.sourcePolicy,
    requiresHumanReview: contract.humanReview.required,
    contract,
    passed: contract.passed && missingInputs.length === 0,
  };
}
