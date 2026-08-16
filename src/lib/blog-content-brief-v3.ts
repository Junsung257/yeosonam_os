import type { BlogInformationAudience, BlogInformationRiskLevel } from './blog-information-planner';
import { isHighRiskInformationalTopic } from './blog-publication-review-policy';
import type { SearchDecisionIntent, SerpResearchPacketV3 } from './blog-serp-research-v3';

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

export interface EvidenceLinkedDetail {
  text: string;
  evidenceId: string;
  sourceType?: string;
}

export interface SectionPurpose {
  id: string;
  purpose: string;
  decisionQuestion: string;
  requiredEvidenceIds: string[];
  optional: boolean;
}

export interface EvidenceRequirement {
  purpose: string;
  riskLevel: BlogInformationRiskLevel;
  minimumAuthoritySources: number;
  expiresAtRequired: boolean;
}

export interface ImagePurpose {
  purpose: string;
  entityType: 'destination' | 'landmark' | 'hotel' | 'route' | 'climate_chart' | 'none';
  required: boolean;
  evidenceUseAllowed: boolean;
  allowedSources: string[];
}

export interface TitleCandidate {
  title: string;
  rationale: string;
  primary: boolean;
}

export interface ArticleMetadataPlan {
  title: string;
  ogTitle: string;
  description: string;
  descriptionTarget: { min: 80; max: 150 };
}

export interface BlogContentBriefV3Input {
  topic: string;
  destination?: string | null;
  primaryKeyword?: string | null;
  secondaryQueries?: string[];
  audience?: BlogInformationAudience | null;
  availableEvidenceTypes?: string[];
  firstPartySourceIds?: string[];
  customerQuestionIds?: string[];
  destinationDecisionDetails?: EvidenceLinkedDetail[];
  serpResearch?: SerpResearchPacketV3 | null;
}

export interface BlogContentBriefV3 {
  version: 'blog-quality-v3.1';
  title: string;
  primaryDecision: string;
  primaryQuery: string;
  secondaryQueries: string[];
  archetype: BlogContentArchetypeV3;
  audience: BlogInformationAudience;
  riskLevel: BlogInformationRiskLevel;
  publicationStrategy: 'new_article' | 'refresh_representative';
  sectionPurposes: SectionPurpose[];
  requiredEvidence: EvidenceRequirement[];
  imagePlan: ImagePurpose[];
  titleCandidates: TitleCandidate[];
  metadata: ArticleMetadataPlan;
  includeFaq: boolean;
  includeChecklist: boolean;
  includeTable: boolean;
  includeTwelveMonthTable: boolean;
  includeYearInTitle: boolean;
  imageMinimum: 0;
  sections: string[];
  destinationDecisionDetails: EvidenceLinkedDetail[];
  verifiedFirstPartySourceIds: string[];
  experienceLanguageAllowed: boolean;
  issues: string[];
  passed: boolean;
}

export function resolveVerifiedFirstPartySourceIdsV3(input: {
  registeredIds?: string[];
  sources: Array<{
    sourceKey: string;
    internalIdentifier?: string | null;
    authorityLevel: string;
    sourceType: string;
  }>;
}): string[] {
  const verified = input.sources.filter(
    (source) => source.authorityLevel === 'field_observation' || source.sourceType === 'field_research',
  );
  const identifiers = new Set(verified.flatMap((source) => [
    source.sourceKey,
    ...(source.internalIdentifier ? [source.internalIdentifier] : []),
  ]));
  return unique([
    ...verified.map((source) => source.sourceKey),
    ...(input.registeredIds ?? []).filter((identifier) => identifiers.has(clean(identifier))),
  ]);
}

const clean = (value: string | null | undefined) => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();

function unique(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = clean(value);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function inferDecisionIntent(input: BlogContentBriefV3Input): SearchDecisionIntent {
  if (input.serpResearch) return input.serpResearch.intent;
  const text = `${input.topic} ${input.primaryKeyword || ''}`;
  if (/변경|시행|중단|재개|ETIAS|ETA|ESTA|규정/i.test(text)) return 'current_change';
  if (/날씨|우기|건기|옷차림|기온|강수/i.test(text)) return 'weather_travel_viability';
  if (/호텔|리조트|숙소|어디.*묵/i.test(text)) return 'hotel_area_selection';
  if (/가볼만한곳|관광지|명소|액티비티/i.test(text)) return 'attraction_selection';
  if (/비용|예산|경비|가격/i.test(text)) return 'budget_decision';
  // A query such as "여행 일정과 이동 동선" asks for an executable
  // itinerary, not merely a comparison of transport modes. Resolve the more
  // specific itinerary intent before the broad 이동/교통 route matcher.
  if (/일정|코스|동선|\d+박\s*\d+일/i.test(text)) return 'itinerary_execution';
  if (/공항.*(?:에서|부터)|가는\s*법|이동|교통/i.test(text)) return 'route_decision';
  if (/부모님|가족|아이|커플|신혼|혼자|시니어/i.test(text)) return 'traveler_fit';
  if (/^[^\s]+\s*여행$/i.test(clean(input.primaryKeyword) || clean(input.topic))) return 'destination_overview';
  return 'direct_answer';
}

export function selectBlogContentArchetypeV3(input: BlogContentBriefV3Input): BlogContentArchetypeV3 {
  const text = `${input.topic} ${input.primaryKeyword || ''}`;
  const evidence = new Set(input.availableEvidenceTypes || []);
  if ((input.firstPartySourceIds || []).length > 0 && evidence.has('first_party')) return 'first_party_field_note';
  if ((input.customerQuestionIds || []).length > 0) return 'real_customer_questions';
  const intent = inferDecisionIntent(input);
  if (intent === 'current_change') return 'current_change_explainer';
  if (intent === 'route_decision') return 'route_walkthrough';
  if (intent === 'hotel_area_selection') return 'neighborhood_selector';
  if (intent === 'attraction_selection') return 'decision_comparison';
  if (intent === 'traveler_fit') return 'traveler_type_plan';
  if (intent === 'budget_decision') return 'budget_scenarios';
  if (intent === 'itinerary_execution') return 'itinerary_timeline';
  if (intent === 'weather_travel_viability' && evidence.has('climate_series') && /월별|계절|언제/i.test(text)) {
    return 'seasonal_calendar';
  }
  if (/준비물|체크\s*리스트|체크리스트|짐\s*싸기|짐싸기|packing|checklist|preparation/i.test(text)) {
    return 'mistake_prevention';
  }
  if (/비교|vs|어디가|선택/i.test(text)) return 'decision_comparison';
  if (/실수|주의|피해야|하지\s*말/i.test(text)) return 'mistake_prevention';
  return input.serpResearch?.archetypeCandidates[0] ?? 'direct_answer';
}

function riskLevel(text: string): BlogInformationRiskLevel {
  if (isHighRiskInformationalTopic({ topic: text })) return 'HIGH';
  if (/요금|가격|운영시간|환율|공항|교통|날씨|일정\s*변경/i.test(text)) return 'MEDIUM';
  return 'LOW';
}

function sectionPurposes(intent: SearchDecisionIntent, details: EvidenceLinkedDetail[]): SectionPurpose[] {
  const ids = details.map((detail) => detail.evidenceId);
  const build = (id: string, purpose: string, decisionQuestion: string, optional = false): SectionPurpose => ({
    id,
    purpose,
    decisionQuestion,
    requiredEvidenceIds: optional ? [] : ids.slice(0, 3),
    optional,
  });
  switch (intent) {
    case 'weather_travel_viability':
      return [
        build('answer', '여행 가능 여부를 첫 문단에서 답한다', '이 시기에 여행해도 괜찮은가?'),
        build('variability', '평년값과 실제 변동 위험을 구분한다', '비와 기온 변동이 일정에 어떤 영향을 주는가?'),
        build('schedule-impact', '날씨가 이동과 예약에 미치는 영향을 설명한다', '어떤 일정을 조정해야 하는가?'),
        build('clothing', '공식 기후 근거로 옷차림을 판단한다', '무엇을 입고 챙겨야 하는가?'),
        build('rain-plan', '우천 시 실행 가능한 대안을 제시한다', '비가 오면 무엇으로 바꿀 수 있는가?', true),
        build('last-check', '출발 직전 확인할 공식 채널을 안내한다', '마지막으로 어디를 확인해야 하는가?'),
      ];
    case 'hotel_area_selection':
      return [
        build('area-first', '개별 호텔보다 숙소 지역을 먼저 고르게 한다', '어느 지역이 일정에 맞는가?'),
        build('traveler-fit', '가족·커플·휴양·관광 조건을 나눈다', '누구에게 어느 지역이 맞는가?'),
        build('tradeoffs', '검증된 선택지만 장단점을 비교한다', '무엇을 얻고 무엇을 포기하는가?'),
        build('movement', '공항·관광지 이동 부담을 비교한다', '매일 이동이 얼마나 달라지는가?'),
        build('booking-check', '현재 판매·예약 조건 확인 경로를 안내한다', '예약 직전에 무엇을 다시 확인하는가?'),
      ];
    case 'attraction_selection':
      return [
        build('selection', '시간·체력·동행 유형별 선택 기준을 제시한다', '내 일정에 어떤 장소가 맞는가?'),
        build('place-facts', '장소별 이동·체류·비용 조건을 검증한다', '각 장소에 실제로 무엇이 필요한가?'),
        build('route-grouping', '함께 묶을 수 있는 동선을 제시한다', '어떤 순서로 움직여야 덜 힘든가?'),
        build('alternatives', '휴무·우천·혼잡 대안을 제시한다', '계획이 틀어지면 무엇으로 바꾸는가?', true),
      ];
    case 'route_decision':
      return [
        build('quick-choice', '상황별 추천 이동수단을 먼저 답한다', '지금 어떤 이동수단을 고르는가?'),
        build('segments', '출발점부터 도착점까지 구간을 설명한다', '어디에서 타고 어디에서 내리는가?'),
        build('cost-time', '요금·시간·수하물 조건을 함께 비교한다', '시간과 비용의 차이는 무엇인가?'),
        build('failure-plan', '지연·막차·매진 대안을 제시한다', '계획대로 되지 않으면 어떻게 하는가?'),
      ];
    case 'budget_decision':
      return [
        build('basis', '가격 기준일과 포함 범위를 밝힌다', '이 예산은 무엇을 포함하는가?'),
        build('scenarios', '절약·일반·여유 시나리오를 근거로 비교한다', '내 방식에는 얼마가 드는가?'),
        build('drivers', '비용을 바꾸는 조건을 설명한다', '어디에서 예산 차이가 커지는가?'),
      ];
    case 'itinerary_execution':
      return [
        build('timeline', '날짜보다 이동·예약·휴식 순서로 일정을 만든다', '언제 무엇을 해야 무리가 없는가?'),
        build('movement', '구간별 이동 시간을 반영한다', '이동 때문에 놓치는 것은 없는가?'),
        build('fallback', '우천·휴무·피로 대체안을 둔다', '일정이 틀어지면 어떻게 조정하는가?', true),
      ];
    case 'current_change':
      return [
        build('change', '이전 상태와 현재 상태를 시행일과 함께 구분한다', '정확히 무엇이 바뀌었는가?'),
        build('affected', '영향받는 여행자를 특정한다', '나에게 적용되는가?'),
        build('action', '공식 출처에 근거한 다음 행동을 제시한다', '지금 무엇을 해야 하는가?'),
      ];
    case 'traveler_fit':
      return [
        build('conditions', '동행자의 체력·연령·관심 조건을 정한다', '우리 일행의 제약은 무엇인가?'),
        build('fit', '조건별로 무리 없는 선택을 비교한다', '어떤 선택이 우리에게 맞는가?'),
        build('fallback', '피로·우천·취소 대안을 제시한다', '어려울 때 무엇을 줄이거나 바꾸는가?', true),
      ];
    default:
      return [
        build('answer', '검색 질문에 첫 문단에서 직접 답한다', '독자가 가장 먼저 알고 싶은 답은 무엇인가?'),
        build('criteria', '선택을 바꾸는 조건을 설명한다', '어떤 조건에서 답이 달라지는가?'),
        build('action', '출발 전 실행할 다음 행동을 제시한다', '독자는 다음에 무엇을 해야 하는가?'),
      ];
  }
}

function buildTitleCandidates(primaryQuery: string, destination: string, intent: SearchDecisionIntent): TitleCandidate[] {
  const query = clean(primaryQuery).replace(/\s*(?:완벽|최고|필수|총정리|BEST)\s*/gi, ' ').replace(/\s+/g, ' ').trim();
  const candidates: Array<[string, string]> = intent === 'weather_travel_viability'
    ? [[`${query}, 여행해도 괜찮을까?`, '검색 질문과 여행 가능 여부를 직접 연결']]
    : intent === 'hotel_area_selection'
      ? [[`${query}: ${destination || '숙소'} 지역부터 고르는 기준`, '호텔 나열보다 지역 결정을 먼저 해결']]
      : intent === 'attraction_selection'
        ? [[`${query}: 시간·체력에 맞춰 고르는 법`, '장소 나열보다 선택 조건을 명시']]
        : intent === 'route_decision'
          ? [[`${query}: 시간·비용·수하물 기준 비교`, '이동 의사결정의 핵심 조건을 명시']]
      : intent === 'budget_decision'
            ? [[`${query}: 여행 방식별 예산 시나리오`, '근거 있는 비용 조건을 설명']]
            : intent === 'itinerary_execution'
              ? [[`${query}: 이동 부담을 줄이는 순서`, '명소 나열보다 실행 순서와 동선 결정을 명시']]
            : [[query, '검색어와 본문의 주된 답을 그대로 일치']];
  return unique(candidates.map(([title]) => title)).map((title, index) => ({
    title: title.slice(0, 80),
    rationale: candidates[index]?.[1] ?? '검색 질문과 본문 답의 일치',
    primary: index === 0,
  }));
}

function buildDescription(primaryQuery: string, intent: SearchDecisionIntent): string {
  const base = intent === 'weather_travel_viability'
    ? `${primaryQuery}의 여행 가능 여부를 판단할 수 있도록 확인된 날씨 조건과 일정 영향을 정리했습니다. 옷차림과 우천 대안, 출발 전 확인 항목을 함께 살펴보세요.`
    : intent === 'hotel_area_selection'
      ? `${primaryQuery}을 찾는 분을 위해 먼저 지역을 고르는 기준과 여행자 유형별 판단 조건을 정리했습니다. 확인된 정보로 장단점을 비교해 내 일정에 맞는 숙소 후보를 좁혀 보세요.`
      : intent === 'attraction_selection'
        ? `${primaryQuery}을 찾는 분을 위해 일정·체력·동행자에 따른 선택 기준을 정리했습니다. 확인된 공식 정보와 각 장소의 조건을 비교해 내 일정에 맞는 후보를 좁혀 보세요.`
        : intent === 'route_decision'
          ? `${primaryQuery}의 이동 방법을 시간·비용·환승 부담 기준으로 비교합니다. 확인된 공식 교통 정보를 바탕으로 내 일정에 맞는 경로와 출발 전 확인 조건을 정리했습니다.`
          : intent === 'budget_decision'
            ? `${primaryQuery}에 필요한 비용을 여행 방식별로 나누어 비교합니다. 확인된 가격 근거와 변동 조건을 바탕으로 내 예산에 맞는 선택과 출발 전 확인 항목을 정리했습니다.`
            : intent === 'itinerary_execution'
              ? `${primaryQuery}을 이동 시간과 일정 순서 기준으로 정리했습니다. 확인된 공식 정보를 바탕으로 함께 묶을 동선과 따로 둘 일정을 나누고, 마지막 순서까지 실행 가능하게 살펴보세요.`
            : `${primaryQuery}에 바로 답할 수 있도록 확인된 정보와 선택 기준을 구분해 정리했습니다. 내 일정과 우선순위에 맞는 결정을 내리고 출발 전에 다시 확인할 항목도 살펴보세요.`;
  const complete = base.length >= 80
    ? base
    : `${base} 최신 공식 정보는 출발 직전에 다시 확인하세요.`;
  return complete.slice(0, 150);
}

function evidenceRequirements(risk: BlogInformationRiskLevel, intent: SearchDecisionIntent): EvidenceRequirement[] {
  const authoritySources = risk === 'HIGH' ? 1 : 1;
  const expires = risk !== 'LOW' || ['weather_travel_viability', 'route_decision', 'hotel_area_selection', 'current_change'].includes(intent);
  return [{
    purpose: risk === 'HIGH'
      ? '모든 외부 사실을 공식 1차 출처와 사람 승인에 연결'
      : '숫자·운영·가격·날씨 사실을 권위 출처 claim에 연결',
    riskLevel: risk,
    minimumAuthoritySources: authoritySources,
    expiresAtRequired: expires,
  }];
}

function imagePlan(intent: SearchDecisionIntent): ImagePurpose[] {
  if (intent === 'weather_travel_viability') return [{
    purpose: '공식 기후 자료를 독자가 비교할 수 있는 차트',
    entityType: 'climate_chart',
    required: false,
    evidenceUseAllowed: true,
    allowedSources: ['official_data_chart', 'first_party_destination'],
  }];
  if (intent === 'hotel_area_selection') return [{
    purpose: '비교 대상 호텔 또는 숙소 지역을 정확히 식별하는 이미지',
    entityType: 'hotel',
    required: false,
    evidenceUseAllowed: true,
    allowedSources: ['first_party', 'licensed_customer', 'official_hotel'],
  }];
  if (intent === 'attraction_selection') return [{
    purpose: '해당 장소 설명 옆에 배치하는 정확한 장소 이미지',
    entityType: 'landmark',
    required: false,
    evidenceUseAllowed: true,
    allowedSources: ['first_party', 'official_tourism', 'licensed_wikimedia', 'entity_verified_stock'],
  }];
  return [{
    purpose: '독자의 판단을 실제로 돕는 경우에만 사용하는 관련 이미지',
    entityType: 'destination',
    required: false,
    evidenceUseAllowed: false,
    allowedSources: ['first_party', 'official_source', 'licensed_wikimedia', 'entity_verified_stock'],
  }];
}

export function buildBlogContentBriefV3(input: BlogContentBriefV3Input): BlogContentBriefV3 {
  const primaryQuery = clean(input.primaryKeyword) || clean(input.topic);
  const intent = inferDecisionIntent(input);
  const archetype = selectBlogContentArchetypeV3(input);
  const details = (input.destinationDecisionDetails || [])
    .filter((detail) => clean(detail.text) && clean(detail.evidenceId))
    .slice(0, 12);
  const risk = riskLevel(`${input.topic} ${input.primaryKeyword || ''}`);
  const purposes = sectionPurposes(intent, details);
  const destination = clean(input.destination);
  const titleCandidates = buildTitleCandidates(primaryQuery, destination, intent);
  const metadataDescription = buildDescription(primaryQuery, intent);
  const issues: string[] = [];
  if (!primaryQuery) issues.push('primary_decision_missing');
  if (details.length < 3) issues.push('destination_specific_evidence_below_three');
  if (archetype === 'first_party_field_note' && (input.firstPartySourceIds || []).length === 0) {
    issues.push('first_party_source_missing');
  }
  if (metadataDescription.length < 80 || metadataDescription.length > 150) issues.push('metadata_description_length');
  const includeTable = ['decision_comparison', 'budget_scenarios', 'neighborhood_selector'].includes(archetype)
    && details.length >= 3;
  const broadRepresentative = intent === 'destination_overview' && input.serpResearch?.queryCluster.tier === 'broad';

  return {
    version: 'blog-quality-v3.1',
    title: titleCandidates[0]?.title ?? primaryQuery,
    primaryDecision: purposes[0]?.decisionQuestion ?? primaryQuery,
    primaryQuery,
    secondaryQueries: unique([
      ...(input.secondaryQueries ?? []),
      ...(input.serpResearch?.queryCluster.secondaryQueries ?? []),
    ]).filter((query) => query.toLowerCase() !== primaryQuery.toLowerCase()).slice(0, 12),
    archetype,
    audience: input.audience || 'general',
    riskLevel: risk,
    publicationStrategy: broadRepresentative ? 'refresh_representative' : 'new_article',
    sectionPurposes: purposes,
    requiredEvidence: evidenceRequirements(risk, intent),
    imagePlan: imagePlan(intent),
    titleCandidates,
    metadata: {
      title: titleCandidates[0]?.title ?? primaryQuery,
      ogTitle: titleCandidates[0]?.title ?? primaryQuery,
      description: metadataDescription,
      descriptionTarget: { min: 80, max: 150 },
    },
    includeFaq: archetype === 'real_customer_questions',
    includeChecklist: archetype === 'mistake_prevention',
    includeTable,
    includeTwelveMonthTable: archetype === 'seasonal_calendar'
      && (input.availableEvidenceTypes || []).includes('climate_series'),
    includeYearInTitle: false,
    imageMinimum: 0,
    sections: purposes.map((purpose) => purpose.purpose),
    destinationDecisionDetails: details,
    verifiedFirstPartySourceIds: unique(input.firstPartySourceIds ?? []),
    experienceLanguageAllowed: (input.firstPartySourceIds || []).length > 0,
    issues,
    passed: issues.length === 0,
  };
}

export function buildBlogContentBriefV3PromptBlock(brief: BlogContentBriefV3): string {
  return [
    '## Content Brief - must follow before writing',
    '## Flexible Content Brief V3.1 — writer source of truth',
    `- Fixed title/H1/OG title: ${brief.metadata.title}`,
    `- Primary query: ${brief.primaryQuery}`,
    `- Primary decision: ${brief.primaryDecision}`,
    `- Archetype: ${brief.archetype}`,
    `- Publication strategy: ${brief.publicationStrategy}`,
    `- FAQ: ${brief.includeFaq ? 'use only the registered customer questions' : 'do not append'}`,
    `- Checklist: ${brief.includeChecklist ? 'use only when it prevents a documented mistake' : 'do not append'}`,
    `- Table: ${brief.includeTable ? 'allowed only when every cell is evidence-backed' : 'do not force'}`,
    '- No fixed H2 count, word count, image count, year suffix, power word, or generic closing section.',
    '- Section purpose is a decision contract, not an exact heading to copy:',
    ...brief.sectionPurposes.map((section) => `  - ${section.purpose} — ${section.decisionQuestion}`),
    '- Evidence-linked destination details that must be used accurately:',
    ...brief.destinationDecisionDetails.map((detail) => `  - [${detail.evidenceId}] ${detail.text}`),
    `- Experience language allowed: ${brief.experienceLanguageAllowed ? 'yes, only for registered source IDs' : 'no'}`,
    '- Numbers, dates, prices, operating conditions, and experience statements must come from the supplied claim ledger.',
  ].join('\n');
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
