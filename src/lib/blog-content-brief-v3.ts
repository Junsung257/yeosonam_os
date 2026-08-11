import type { BlogInformationAudience, BlogInformationRiskLevel } from './blog-information-planner';

export const BLOG_CONTENT_ARCHETYPES_V3 = [
  'direct_answer',
  'decision_comparison',
  'route_walkthrough',
  'neighborhood_selector',
  'traveler_type_plan',
  'budget_scenarios',
  'current_change_explainer',
  'mistake_prevention',
  'itinerary_timeline',
  'first_party_field_note',
  'seasonal_calendar',
  'real_customer_questions',
] as const;

export type BlogContentArchetypeV3 = (typeof BLOG_CONTENT_ARCHETYPES_V3)[number];

export interface BlogContentBriefV3Input {
  topic: string;
  destination?: string | null;
  primaryKeyword?: string | null;
  audience?: BlogInformationAudience | null;
  availableEvidenceTypes?: string[];
  firstPartySourceIds?: string[];
  customerQuestionIds?: string[];
  destinationDecisionDetails?: Array<{ text: string; evidenceId: string }>;
}

export interface BlogContentBriefV3 {
  version: 'blog-quality-v3';
  title: string;
  primaryDecision: string;
  archetype: BlogContentArchetypeV3;
  audience: BlogInformationAudience;
  riskLevel: BlogInformationRiskLevel;
  includeFaq: boolean;
  includeChecklist: boolean;
  includeTable: boolean;
  includeTwelveMonthTable: boolean;
  includeYearInTitle: boolean;
  imageMinimum: 0;
  sections: string[];
  destinationDecisionDetails: Array<{ text: string; evidenceId: string }>;
  experienceLanguageAllowed: boolean;
  issues: string[];
  passed: boolean;
}

const clean = (value: string | null | undefined) => String(value || '').replace(/\s+/g, ' ').trim();

export function selectBlogContentArchetypeV3(input: BlogContentBriefV3Input): BlogContentArchetypeV3 {
  const text = `${input.topic} ${input.primaryKeyword || ''}`;
  const evidence = new Set(input.availableEvidenceTypes || []);
  if ((input.firstPartySourceIds || []).length > 0 && evidence.has('first_party')) return 'first_party_field_note';
  if ((input.customerQuestionIds || []).length > 0) return 'real_customer_questions';
  if (/변경|시행|ETIAS|ETA|ESTA|규정|중단|재개/i.test(text)) return 'current_change_explainer';
  if (/공항.*(?:에서|부터)|(?:에서|부터).*공항|가는\s*법|이동/i.test(text)) return 'route_walkthrough';
  if (/숙소\s*(?:위치|지역)|동네|어디.*묵/i.test(text)) return 'neighborhood_selector';
  if (/부모님|아이|가족|시니어|혼자|커플/i.test(text)) return 'traveler_type_plan';
  if (/비용|예산|경비/i.test(text)) return 'budget_scenarios';
  if (/일정|코스|박\s*\d+\s*일|\d+박\s*\d+일/i.test(text)) return 'itinerary_timeline';
  if (/월별|계절|언제|날씨/i.test(text) && evidence.has('climate_series')) return 'seasonal_calendar';
  if (/비교|vs|어디가|선택/i.test(text)) return 'decision_comparison';
  if (/실수|주의|피해야|하지\s*말/i.test(text)) return 'mistake_prevention';
  return 'direct_answer';
}

function riskLevel(text: string): BlogInformationRiskLevel {
  if (/비자|입국|출입국|ETA|ESTA|ETIAS|여권|세관|면세|보험|법률|규제|안전\s*경보|의료|건강/i.test(text)) return 'HIGH';
  if (/요금|가격|운영시간|환율|공항|교통|날씨|일정\s*변경/i.test(text)) return 'MEDIUM';
  return 'LOW';
}

const sectionMap: Record<BlogContentArchetypeV3, string[]> = {
  direct_answer: ['짧은 답', '판단 기준', '상황별 선택'],
  decision_comparison: ['선택 기준', '대안별 차이', '누구에게 맞는가'],
  route_walkthrough: ['출발 전 확인', '구간별 이동', '실패했을 때 대안'],
  neighborhood_selector: ['지역을 고르는 기준', '지역별 장단점', '여행자 유형별 추천'],
  traveler_type_plan: ['동행 조건', '무리 없는 선택', '대체안'],
  budget_scenarios: ['계산 기준', '예산 시나리오', '비용이 달라지는 조건'],
  current_change_explainer: ['무엇이 바뀌었나', '누가 영향을 받나', '지금 해야 할 일'],
  mistake_prevention: ['자주 생기는 실수', '예방 기준', '문제가 생겼을 때'],
  itinerary_timeline: ['시간대별 흐름', '이동과 휴식', '일정 조정 기준'],
  first_party_field_note: ['관찰 범위', '현장 기록', '의사결정에 미치는 영향'],
  seasonal_calendar: ['계절별 차이', '목적별 시기 선택', '출발 직전 확인'],
  real_customer_questions: ['실제 질문', '직접 답변', '질문별 다음 행동'],
};

export function buildBlogContentBriefV3(input: BlogContentBriefV3Input): BlogContentBriefV3 {
  const primaryDecision = clean(input.primaryKeyword) || clean(input.topic);
  const archetype = selectBlogContentArchetypeV3(input);
  const details = (input.destinationDecisionDetails || [])
    .filter((detail) => clean(detail.text) && clean(detail.evidenceId))
    .slice(0, 8);
  const issues: string[] = [];
  if (!primaryDecision) issues.push('primary_decision_missing');
  if (details.length < 3) issues.push('destination_specific_evidence_below_three');
  if (archetype === 'first_party_field_note' && (input.firstPartySourceIds || []).length === 0) {
    issues.push('first_party_source_missing');
  }
  const includeTable = ['decision_comparison', 'budget_scenarios', 'neighborhood_selector'].includes(archetype);

  return {
    version: 'blog-quality-v3',
    title: primaryDecision,
    primaryDecision,
    archetype,
    audience: input.audience || 'general',
    riskLevel: riskLevel(`${input.topic} ${input.primaryKeyword || ''}`),
    includeFaq: archetype === 'real_customer_questions',
    includeChecklist: archetype === 'mistake_prevention',
    includeTable,
    includeTwelveMonthTable: archetype === 'seasonal_calendar' && (input.availableEvidenceTypes || []).includes('climate_series'),
    includeYearInTitle: false,
    imageMinimum: 0,
    sections: sectionMap[archetype],
    destinationDecisionDetails: details,
    experienceLanguageAllowed: (input.firstPartySourceIds || []).length > 0,
    issues,
    passed: issues.length === 0,
  };
}

export function assertNoFabricatedExperienceV3(text: string, firstPartySourceIds: string[]): string[] {
  if (firstPartySourceIds.length > 0) return [];
  const forbidden = [
    /직접\s*다녀왔/i,
    /(?:지인이\s*다녀왔|다녀온\s*지인)/i,
    /고객(?:이|님이)\s*말했/i,
    /운영팀이\s*직접\s*확인/i,
    /현지에서\s*확인/i,
    /문의가\s*급증/i,
  ];
  return forbidden.filter((pattern) => pattern.test(text)).map((pattern) => `fabricated_experience:${pattern.source}`);
}
