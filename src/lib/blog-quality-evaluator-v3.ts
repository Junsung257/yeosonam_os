export const BLOG_QUALITY_DIMENSIONS_V3 = [
  'intent_completion', 'factual_support_coverage', 'stale_claim_count',
  'conflicting_claim_count', 'unsupported_number_count', 'destination_specificity',
  'information_gain', 'title_uniqueness', 'opening_uniqueness', 'structure_uniqueness',
  'Korean_language_integrity', 'image_relevance', 'image_uniqueness', 'source_quality',
  'author_review_truthfulness', 'internal_link_relevance', 'user_actionability',
  'serp_intent_alignment', 'decision_completion', 'query_cluster_coverage',
  'comparative_information_gain', 'competitor_copy_risk', 'title_snippet_congruence',
  'section_purpose_coverage', 'image_entity_match', 'pillar_support_relationship',
] as const;

export type BlogQualityDimensionV3 = (typeof BLOG_QUALITY_DIMENSIONS_V3)[number];

export interface BlogQualityDimensionResultV3 {
  value: number;
  passed: boolean;
  evidence: string[];
  failures: string[];
}

export interface BlogQualityEvaluationInputV3 {
  title: string;
  body: string;
  destination?: string | null;
  primaryDecision?: string | null;
  primaryQuery?: string | null;
  archetype?: string | null;
  intentCompletionScore?: number;
  supportedClaimCount?: number;
  factualClaimCount?: number;
  staleClaimCount?: number;
  conflictingClaimCount?: number;
  unsupportedNumberCount?: number;
  destinationSpecificDetailCount?: number;
  informationGainScore?: number;
  titleUniqueness?: number;
  openingUniqueness?: number;
  structureUniqueness?: number;
  imageRelevance?: number;
  imageUniqueness?: number;
  sourceQuality?: number;
  authorReviewTruthful?: boolean;
  internalLinkRelevance?: number;
  userActionability?: number;
  normalizedTitleClusterSize?: number;
  templateSaturation?: boolean;
  firstPartySourceIds?: string[];
  serpIntentAlignment?: number;
  decisionCompletion?: number;
  queryClusterCoverage?: number;
  comparativeInformationGain?: number;
  competitorCopyRisk?: number;
  titleSnippetCongruence?: number;
  sectionPurposeCoverage?: number;
  imageEntityMatch?: number;
  pillarSupportRelationship?: number;
  itineraryEvidenceTexts?: string[];
}

export interface BlogQualityEvaluationV3 {
  version: 'blog-quality-v3';
  passed: boolean;
  score: number;
  dimensions: Record<BlogQualityDimensionV3, BlogQualityDimensionResultV3>;
  hardBlockers: string[];
  failureReasons: Array<{ dimension: BlogQualityDimensionV3; code: string; evidence: string }>;
}

const KOREAN_NEGATIVE_FIXTURES: Array<[string, RegExp]> = [
  ['broken_editor_sentence', /고민을에서\s*덜어드리겠습니다\.에서\s*엄선한/u],
  ['broken_author_name', /여\s*여소남\s*에디터/u],
  ['broken_verb_lower', /낮춝니다/u],
  ['broken_adjective', /어렵편입니다/u],
  ['duplicate_travel_phrase', /여행\s*준비\s*여행/u],
  ['invalid_schengen_range', /쉥겐\s*협약국\s*2\s*[-~]\s*6개국/u],
];
const EXPERIENCE_RE = /운영팀(?:이)?\s*(?:직접\s*)?검증|지난달\s*다녀온\s*지인|직접\s*다녀왔|현지에서\s*(?:직접\s*)?확인(?:했|한|했습니다|하였다|해봤|해\s*보았)/u;
const STALE_ETIAS_RE = /ETIAS[\s\S]{0,80}(?:2025년\s*상반기|7\s*유로)|(?:2025년\s*상반기|7\s*유로)[\s\S]{0,80}ETIAS/iu;

const clamp = (value: number | undefined, fallback = 0) => Math.min(1, Math.max(0, value ?? fallback));
const result = (value: number, passed: boolean, evidence: string[], failures: string[]): BlogQualityDimensionResultV3 => ({
  value: Math.round(value * 100) / 100, passed, evidence, failures,
});

function extractItineraryEntityCandidatesV3(
  evidenceTexts: string[],
  destination?: string | null,
): string[] {
  const entities = new Set<string>();
  const destinationName = String(destination || '').normalize('NFKC').trim().toLocaleLowerCase('ko-KR');
  for (const raw of evidenceTexts) {
    const text = String(raw || '').normalize('NFKC');
    for (const match of text.matchAll(/\b[A-ZÀ-ÖØ-ÞĀ-ŽĐ][A-Za-zÀ-ÖØ-öø-ÿĀ-žĐđ'’.-]*(?:\s+[A-ZÀ-ÖØ-ÞĀ-ŽĐ][A-Za-zÀ-ÖØ-öø-ÿĀ-žĐđ'’.-]*){0,4}\b/gu)) {
      const value = match[0].trim();
      if (value.length >= 3) entities.add(value);
    }
    for (const match of text.matchAll(/([가-힣]{2,18}(?:\s+[가-힣]{2,12}){0,2}(?:산|힐|사원|해변|시장|공원|박물관|수족관|반도|다리|브리지|마운틴|패스|대성당|동굴|유적|관광지))/gu)) {
      entities.add(match[1].trim());
    }
  }
  return [...entities].filter((entity) => {
    const normalized = entity.toLocaleLowerCase('ko-KR');
    return normalized !== destinationName
      && !/^(?:official|tourism|travel|medium|low|high)$/i.test(entity);
  });
}

function inspectIntentArtifactV3(input: BlogQualityEvaluationInputV3): {
  score: number;
  evidence: string[];
  failures: string[];
} | null {
  const topic = `${input.primaryQuery || ''} ${input.title} ${input.primaryDecision || ''}`;
  const itineraryIntent = input.archetype === 'itinerary_timeline'
    || /일정|코스|동선|\d+박\s*\d+일/i.test(topic);
  const routeIntent = input.archetype === 'route_walkthrough'
    || /공항.*(?:에서|부터)|가는\s*법|교통편|이동수단/i.test(topic);
  if (!itineraryIntent && !routeIntent) return null;

  const artifactLines = input.body
    .replace(/<!--[\s\S]*?-->/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^\[[^\]]+\]\(https?:/i.test(line));
  const visibleLines = artifactLines.filter((line) => !/^#/u.test(line));
  const prose = visibleLines.join('\n');
  const firstParagraph = visibleLines.find((line) => !/^[-*]\s/.test(line)) || '';
  const itineraryEntities = itineraryIntent
    ? extractItineraryEntityCandidatesV3(input.itineraryEvidenceTexts ?? [], input.destination)
    : [];
  const requestedDays = itineraryIntent
    ? Number(topic.match(/(?:^|\s)\d{1,2}\s*박\s*(\d{1,2})\s*일/u)?.[1] ?? 0)
    : 0;
  const concreteStagePattern = /^(?:#{2,6}\s+|[-*+]\s+)?(?:(?:제?\s*)?\d{1,2}\s*일차|첫째\s*날|둘째\s*날|셋째\s*날|넷째\s*날|다섯째\s*날|아침|오전|점심|오후|저녁|밤|(?:동선|루트|코스)\s*(?:안|옵션)?\s*[A-Z0-9가-힣]?)/iu;
  const concreteStageLines = itineraryIntent
    ? artifactLines.filter((line) => concreteStagePattern.test(line)
      && itineraryEntities.some((entity) => line.toLocaleLowerCase('ko-KR').includes(entity.toLocaleLowerCase('ko-KR'))))
    : [];
  const distinctConcreteEntities = new Set(concreteStageLines.flatMap((line) =>
    itineraryEntities.filter((entity) => line.toLocaleLowerCase('ko-KR').includes(entity.toLocaleLowerCase('ko-KR'))),
  ));
  const concreteDayOrdinals = new Set(concreteStageLines.flatMap((line) => {
    const match = line.match(/(?:제?\s*)?(\d{1,2})\s*일차/u);
    return match ? [Number(match[1])] : [];
  }));
  const expectedConcreteBlocks = requestedDays > 0 ? Math.min(requestedDays, 7) : 2;
  const requiredDayOrdinalsPresent = requestedDays <= 0
    || Array.from({ length: expectedConcreteBlocks }, (_, index) => index + 1)
      .every((day) => concreteDayOrdinals.has(day));
  const concreteBlocksPassed = !itineraryIntent || (
    concreteStageLines.length >= expectedConcreteBlocks
    && distinctConcreteEntities.size >= Math.min(2, expectedConcreteBlocks)
    && requiredDayOrdinalsPresent
  );
  const sequenceMatches = prose.match(
    itineraryIntent
      ? /먼저|이어서|다음|별도|마지막|순서|묶(?:어|고|음)|분리(?:해|하고|한)|동선/gi
      : /출발|도착|구간|환승|타고|내리|이동수단|동선|먼저|이어서|마지막/gi,
  ) || [];
  const actionMatches = prose.match(
    /(?:묶어|분리해|비교|확인|검토|선택|결정|배치|정)하세요|후보로\s*두세요|순서로\s*두세요/gi,
  ) || [];
  const movementEvidence = /\d+(?:\.\d+)?\s*(?:분|시간)|(?:주말|평일|오전|오후|저녁|밤).*\d{1,2}\s*시/i.test(prose);
  const directAnswer = itineraryIntent
    ? /동선|이동\s*시간|묶|분리|순서/i.test(firstParagraph)
    : /동선|이동\s*시간|이동수단|출발|도착/i.test(firstParagraph);
  const sequenceStages = itineraryIntent
    ? Math.min(3, concreteStageLines.length)
    : [
        /출발|타는\s*곳|승차|먼저/iu,
        /이어서|다음|환승|구간|중간/iu,
        /도착|내리는\s*곳|하차|마지막/iu,
      ].filter((pattern) => pattern.test(prose)).length;
  const reservationCheck = /예약|입장\s*(?:가능|여부|조건)|운영\s*(?:여부|시간)|공식\s*(?:채널|사이트|앱).*확인/iu.test(prose);
  const restPlan = /휴식|쉬(?:고|는|어|세요)|여유|체력|식사\s*(?:시간|간격)|낮잠/iu.test(prose);
  const fallbackPlan = /우천|비가\s*오|휴무|취소|지연|매진|막차|대체\s*(?:일정|후보|동선|안)|플랜\s*B|일정[\s\S]{0,30}(?:줄이|바꾸|조정)/iu.test(prose);
  const routeBoardingDetail = /타는\s*곳|내리는\s*곳|승차|하차|환승|출발(?:지|점)|도착(?:지|점)/iu.test(prose);
  const artifactComplete = itineraryIntent
    ? directAnswer
      && concreteBlocksPassed
      && movementEvidence
      && reservationCheck
      && restPlan
      && fallbackPlan
    : directAnswer
      && sequenceStages === 3
      && movementEvidence
      && routeBoardingDetail
      && fallbackPlan;
  const weightedScore = itineraryIntent
    ? (directAnswer ? 0.2 : 0)
      + Math.min(1, concreteStageLines.length / expectedConcreteBlocks) * 0.2
      + (movementEvidence ? 0.15 : 0)
      + (reservationCheck ? 0.15 : 0)
      + (restPlan ? 0.15 : 0)
      + (fallbackPlan ? 0.15 : 0)
    : (directAnswer ? 0.2 : 0)
      + (sequenceStages / 3) * 0.25
      + (movementEvidence ? 0.2 : 0)
      + (routeBoardingDetail ? 0.2 : 0)
      + (fallbackPlan ? 0.15 : 0);
  // A high upstream/LLM task-completion score must never hide a missing
  // archetype artifact. Missing one required decision block caps the result
  // below the public threshold; this is deliberately independent of length.
  const score = clamp(artifactComplete ? weightedScore : Math.min(weightedScore, 0.7));
  return {
    score,
    evidence: [
      `archetype=${input.archetype || (itineraryIntent ? 'itinerary_timeline' : 'route_walkthrough')}`,
      `direct_answer=${directAnswer}`,
      `sequence_markers=${sequenceMatches.length}`,
      `sequence_stages=${sequenceStages}/3`,
      `action_markers=${actionMatches.length}`,
      `movement_evidence=${movementEvidence}`,
      ...(itineraryIntent
        ? [
            `concrete_itinerary_blocks=${concreteStageLines.length}/${expectedConcreteBlocks}`,
            `itinerary_day_ordinals=${[...concreteDayOrdinals].sort((left, right) => left - right).join(',') || 'none'}`,
            `named_itinerary_entities=${[...distinctConcreteEntities].join(',') || 'none'}`,
            `reservation_check=${reservationCheck}`,
            `rest_plan=${restPlan}`,
            `fallback_plan=${fallbackPlan}`,
          ]
        : [
            `boarding_detail=${routeBoardingDetail}`,
            `fallback_plan=${fallbackPlan}`,
          ]),
    ],
    failures: itineraryIntent && !concreteBlocksPassed
      ? ['concrete_itinerary_blocks_missing']
      : [],
  };
}

function inspectInformationGainArtifactV3(input: BlogQualityEvaluationInputV3): {
  score: number;
  evidence: string[];
  failures: string[];
} | null {
  const topic = `${input.primaryQuery || ''} ${input.title} ${input.primaryDecision || ''}`;
  const itineraryIntent = input.archetype === 'itinerary_timeline'
    || /일정|코스|동선|\d+박\s*\d+일/i.test(topic);
  if (!itineraryIntent) return null;

  const units = input.body
    .replace(/<!--[\s\S]*?-->/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^#{1,6}\s|^\[[^\]]+\]\(https?:/i.test(line))
    .flatMap((line) => line
      .replace(/^[-*+]\s+/, '')
      .split(/(?<=[.!?。！？])\s+/)
      .map((unit) => unit.trim()))
    .filter((unit) => unit.length >= 8 && !/\d/.test(unit));
  const concepts: Array<[string, RegExp]> = [
    ['movement', /이동|동선|구간|출발\s*(?:위치|지점)/iu],
    ['reservation', /예약|운영\s*(?:공지|여부|상태|조건)|공식\s*채널/iu],
    ['rest', /휴식|체력|쉬(?:고|는|어|세요)|여유/iu],
    ['fallback', /우천|휴무|지연|취소|대체\s*(?:일정|후보|동선|안)/iu],
    ['sequence', /순서|시작|중간|마무리|마지막|먼저|이어서|다음/iu],
    ['comparison', /비교|공식\s*(?:이동\s*)?시간|수치|근거/iu],
  ];
  const counts = concepts.map(([name, pattern]) => ({
    name,
    count: units.filter((unit) => pattern.test(unit)).length,
  }));
  const repeatedConcepts = counts.filter(({ count }) => count >= 4);
  const repetitionExcess = counts.reduce((sum, { count }) => sum + Math.max(0, count - 3), 0);
  const repetitiveDecisionAdvice = units.length >= 6
    && repeatedConcepts.length >= 2
    && repetitionExcess >= 6;

  return {
    score: repetitiveDecisionAdvice ? 0.5 : 1,
    evidence: [
      `non_numeric_decision_units=${units.length}`,
      `concept_counts=${counts.map(({ name, count }) => `${name}:${count}`).join(',')}`,
      `repeated_concepts=${repeatedConcepts.map(({ name }) => name).join(',') || 'none'}`,
      `repetition_excess=${repetitionExcess}`,
    ],
    failures: repetitiveDecisionAdvice
      ? ['decision_concepts_repeated_without_new_information']
      : [],
  };
}

export function evaluateBlogQualityV3(input: BlogQualityEvaluationInputV3): BlogQualityEvaluationV3 {
  const hardBlockers: string[] = [];
  const languageFailures = KOREAN_NEGATIVE_FIXTURES
    .filter(([, pattern]) => pattern.test(input.body))
    .map(([code]) => code);
  if (STALE_ETIAS_RE.test(`${input.title}\n${input.body}`)) hardBlockers.push('stale_etias_2025_or_7_euro');
  if (/\((?:2|3|4|5)편\)\s*$/u.test(input.title)) hardBlockers.push('numeric_part_title_suffix');
  if (input.templateSaturation) hardBlockers.push('template_saturation');
  if ((input.normalizedTitleClusterSize || 0) >= 3) hardBlockers.push('title_skeleton_saturated');
  if (EXPERIENCE_RE.test(input.body) && !(input.firstPartySourceIds || []).length) hardBlockers.push('unsupported_first_party_claim');
  if ((input.staleClaimCount || 0) > 0) hardBlockers.push('stale_claim');
  if ((input.conflictingClaimCount || 0) > 0) hardBlockers.push('conflicting_claim');
  if ((input.unsupportedNumberCount || 0) > 0) hardBlockers.push('unsupported_number');
  if (languageFailures.length) hardBlockers.push('korean_language_integrity');

  const factualCount = Number(input.factualClaimCount || 0);
  const supportCoverage = factualCount > 0 ? Number(input.supportedClaimCount || 0) / factualCount : 1;
  const destinationMentions = input.destination
    ? (input.body.match(new RegExp(input.destination.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gu')) || []).length
    : 0;
  const genericHereCount = (input.body.match(/(?:이곳|해당\s*지역|이\s*여행지)/gu) || []).length;
  const destinationSpecificity = clamp((input.destinationSpecificDetailCount || 0) / 3)
    * (genericHereCount > destinationMentions + 3 ? 0.4 : 1);
  const measuredIntentCompletion = typeof input.intentCompletionScore === 'number'
    ? clamp(input.intentCompletionScore)
    : input.primaryDecision && input.body.includes(input.primaryDecision) ? 1 : 0.7;
  const intentArtifact = inspectIntentArtifactV3(input);
  const intentCompletion = intentArtifact
    ? Math.min(measuredIntentCompletion, intentArtifact.score)
    : measuredIntentCompletion;
  const intentEvidence = intentArtifact?.evidence ?? [String(input.primaryDecision || '')];
  const intentArtifactFailures = intentArtifact?.failures ?? [];
  const effectiveSerpAlignment = intentArtifact
    ? Math.min(clamp(input.serpIntentAlignment, intentCompletion), intentArtifact.score)
    : clamp(input.serpIntentAlignment, intentCompletion);
  const effectiveDecisionCompletion = intentArtifact
    ? Math.min(clamp(input.decisionCompletion, intentCompletion), intentArtifact.score)
    : clamp(input.decisionCompletion, intentCompletion);
  const effectiveSectionCoverage = intentArtifact
    ? Math.min(clamp(input.sectionPurposeCoverage, intentCompletion), intentArtifact.score)
    : clamp(input.sectionPurposeCoverage, intentCompletion);
  const informationGainArtifact = inspectInformationGainArtifactV3(input);
  const measuredInformationGain = clamp(input.informationGainScore);
  const effectiveInformationGain = informationGainArtifact
    ? Math.min(measuredInformationGain, informationGainArtifact.score)
    : measuredInformationGain;
  const measuredComparativeInformationGain = clamp(
    input.comparativeInformationGain,
    input.informationGainScore,
  );
  const effectiveComparativeInformationGain = informationGainArtifact
    ? Math.min(measuredComparativeInformationGain, informationGainArtifact.score)
    : measuredComparativeInformationGain;
  const truthful = input.authorReviewTruthful !== false && !hardBlockers.includes('unsupported_first_party_claim');

  const dimensions: Record<BlogQualityDimensionV3, BlogQualityDimensionResultV3> = {
    intent_completion: result(intentCompletion, intentCompletion >= 0.75, intentEvidence, intentCompletion >= 0.75 ? [] : (intentArtifactFailures.length ? intentArtifactFailures : ['primary_decision_not_answered'])),
    factual_support_coverage: result(supportCoverage, supportCoverage >= 0.9, [`${input.supportedClaimCount || 0}/${factualCount}`], supportCoverage >= 0.9 ? [] : ['claim_support_coverage_below_90_percent']),
    stale_claim_count: result(input.staleClaimCount || 0, (input.staleClaimCount || 0) === 0, [`count=${input.staleClaimCount || 0}`], (input.staleClaimCount || 0) ? ['stale_claim_present'] : []),
    conflicting_claim_count: result(input.conflictingClaimCount || 0, (input.conflictingClaimCount || 0) === 0, [`count=${input.conflictingClaimCount || 0}`], (input.conflictingClaimCount || 0) ? ['claim_conflict_present'] : []),
    unsupported_number_count: result(input.unsupportedNumberCount || 0, (input.unsupportedNumberCount || 0) === 0, [`count=${input.unsupportedNumberCount || 0}`], (input.unsupportedNumberCount || 0) ? ['unsupported_number_present'] : []),
    destination_specificity: result(destinationSpecificity, destinationSpecificity >= 1, [`details=${input.destinationSpecificDetailCount || 0}`, `generic_here=${genericHereCount}`], destinationSpecificity >= 1 ? [] : ['destination_specific_details_below_three']),
    information_gain: result(
      effectiveInformationGain,
      effectiveInformationGain >= 0.6,
      informationGainArtifact?.evidence ?? [`score=${input.informationGainScore ?? 0}`],
      effectiveInformationGain >= 0.6
        ? []
        : informationGainArtifact?.failures.length
          ? informationGainArtifact.failures
          : ['information_gain_low'],
    ),
    title_uniqueness: result(clamp(input.titleUniqueness, 1), clamp(input.titleUniqueness, 1) >= 0.75, [`cluster=${input.normalizedTitleClusterSize || 1}`], hardBlockers.includes('title_skeleton_saturated') ? ['title_skeleton_saturated'] : []),
    opening_uniqueness: result(clamp(input.openingUniqueness, 1), clamp(input.openingUniqueness, 1) >= 0.75, [`score=${input.openingUniqueness ?? 1}`], clamp(input.openingUniqueness, 1) >= 0.75 ? [] : ['opening_too_similar']),
    structure_uniqueness: result(clamp(input.structureUniqueness, 1), clamp(input.structureUniqueness, 1) >= 0.35, [`score=${input.structureUniqueness ?? 1}`], clamp(input.structureUniqueness, 1) >= 0.35 ? [] : ['heading_tree_too_similar']),
    Korean_language_integrity: result(languageFailures.length ? 0 : 1, languageFailures.length === 0, languageFailures, languageFailures),
    image_relevance: result(clamp(input.imageRelevance, 1), clamp(input.imageRelevance, 1) >= 0.7, [`score=${input.imageRelevance ?? 1}`], clamp(input.imageRelevance, 1) >= 0.7 ? [] : ['image_not_relevant']),
    image_uniqueness: result(clamp(input.imageUniqueness, 1), clamp(input.imageUniqueness, 1) >= 0.8, [`score=${input.imageUniqueness ?? 1}`], clamp(input.imageUniqueness, 1) >= 0.8 ? [] : ['image_reused_across_destinations']),
    source_quality: result(clamp(input.sourceQuality, 1), clamp(input.sourceQuality, 1) >= 0.7, [`score=${input.sourceQuality ?? 1}`], clamp(input.sourceQuality, 1) >= 0.7 ? [] : ['source_authority_low']),
    author_review_truthfulness: result(truthful ? 1 : 0, truthful, [`first_party_sources=${(input.firstPartySourceIds || []).length}`], truthful ? [] : ['review_or_experience_claim_unverifiable']),
    internal_link_relevance: result(clamp(input.internalLinkRelevance, 1), clamp(input.internalLinkRelevance, 1) >= 0.6, [`score=${input.internalLinkRelevance ?? 1}`], clamp(input.internalLinkRelevance, 1) >= 0.6 ? [] : ['internal_link_irrelevant']),
    user_actionability: result(clamp(input.userActionability, 1), clamp(input.userActionability, 1) >= 0.7, [`score=${input.userActionability ?? 1}`], clamp(input.userActionability, 1) >= 0.7 ? [] : ['next_action_unclear']),
    serp_intent_alignment: result(effectiveSerpAlignment, effectiveSerpAlignment >= 0.75, intentEvidence, effectiveSerpAlignment >= 0.75 ? [] : ['serp_intent_misaligned']),
    decision_completion: result(effectiveDecisionCompletion, effectiveDecisionCompletion >= 0.75, intentEvidence, effectiveDecisionCompletion >= 0.75 ? [] : (intentArtifactFailures.length ? intentArtifactFailures : ['reader_decision_incomplete'])),
    query_cluster_coverage: result(clamp(input.queryClusterCoverage, 1), clamp(input.queryClusterCoverage, 1) >= 0.6, [`score=${input.queryClusterCoverage ?? 1}`], clamp(input.queryClusterCoverage, 1) >= 0.6 ? [] : ['query_cluster_undercovered']),
    comparative_information_gain: result(
      effectiveComparativeInformationGain,
      effectiveComparativeInformationGain >= 0.6,
      informationGainArtifact?.evidence
        ?? [`score=${input.comparativeInformationGain ?? input.informationGainScore ?? 0}`],
      effectiveComparativeInformationGain >= 0.6
        ? []
        : informationGainArtifact?.failures.length
          ? informationGainArtifact.failures
          : ['comparative_information_gain_low'],
    ),
    competitor_copy_risk: result(1 - clamp(input.competitorCopyRisk), clamp(input.competitorCopyRisk) <= 0.3, [`risk=${input.competitorCopyRisk ?? 0}`], clamp(input.competitorCopyRisk) <= 0.3 ? [] : ['competitor_phrase_overlap']),
    title_snippet_congruence: result(clamp(input.titleSnippetCongruence, 1), clamp(input.titleSnippetCongruence, 1) >= 0.8, [`score=${input.titleSnippetCongruence ?? 1}`], clamp(input.titleSnippetCongruence, 1) >= 0.8 ? [] : ['title_description_body_mismatch']),
    section_purpose_coverage: result(effectiveSectionCoverage, effectiveSectionCoverage >= 0.75, intentEvidence, effectiveSectionCoverage >= 0.75 ? [] : (intentArtifactFailures.length ? intentArtifactFailures : ['section_purpose_missing'])),
    image_entity_match: result(clamp(input.imageEntityMatch, input.imageRelevance), clamp(input.imageEntityMatch, input.imageRelevance) >= 0.7, [`score=${input.imageEntityMatch ?? input.imageRelevance ?? 1}`], clamp(input.imageEntityMatch, input.imageRelevance) >= 0.7 ? [] : ['image_entity_mismatch']),
    pillar_support_relationship: result(clamp(input.pillarSupportRelationship, 1), clamp(input.pillarSupportRelationship, 1) >= 0.7, [`score=${input.pillarSupportRelationship ?? 1}`], clamp(input.pillarSupportRelationship, 1) >= 0.7 ? [] : ['pillar_relationship_missing']),
  };

  const failureReasons = Object.entries(dimensions).flatMap(([dimension, dimensionResult]) =>
    dimensionResult.failures.map((code) => ({
      dimension: dimension as BlogQualityDimensionV3,
      code,
      evidence: dimensionResult.evidence.join(' | '),
    })),
  );
  const scoreable = Object.entries(dimensions)
    .filter(([key]) => !key.endsWith('_count'))
    .map(([, dimension]) => dimension.passed ? dimension.value : Math.min(dimension.value, 0.5));
  const score = Math.round((scoreable.reduce((sum, value) => sum + value, 0) / scoreable.length) * 10000) / 100;
  return {
    version: 'blog-quality-v3',
    passed: hardBlockers.length === 0 && failureReasons.length === 0,
    score,
    dimensions,
    hardBlockers: [...new Set(hardBlockers)],
    failureReasons,
  };
}
