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
const EXPERIENCE_RE = /운영팀(?:이)?\s*(?:직접\s*)?검증|지난달\s*다녀온\s*지인|직접\s*다녀왔|현지에서\s*확인/u;
const STALE_ETIAS_RE = /ETIAS[\s\S]{0,80}(?:2025년\s*상반기|7\s*유로)|(?:2025년\s*상반기|7\s*유로)[\s\S]{0,80}ETIAS/iu;

const clamp = (value: number | undefined, fallback = 0) => Math.min(1, Math.max(0, value ?? fallback));
const result = (value: number, passed: boolean, evidence: string[], failures: string[]): BlogQualityDimensionResultV3 => ({
  value: Math.round(value * 100) / 100, passed, evidence, failures,
});

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
  const intentCompletion = typeof input.intentCompletionScore === 'number'
    ? clamp(input.intentCompletionScore)
    : input.primaryDecision && input.body.includes(input.primaryDecision) ? 1 : 0.7;
  const truthful = input.authorReviewTruthful !== false && !hardBlockers.includes('unsupported_first_party_claim');

  const dimensions: Record<BlogQualityDimensionV3, BlogQualityDimensionResultV3> = {
    intent_completion: result(intentCompletion, intentCompletion >= 0.75, [String(input.primaryDecision || '')], intentCompletion >= 0.75 ? [] : ['primary_decision_not_answered']),
    factual_support_coverage: result(supportCoverage, supportCoverage >= 0.9, [`${input.supportedClaimCount || 0}/${factualCount}`], supportCoverage >= 0.9 ? [] : ['claim_support_coverage_below_90_percent']),
    stale_claim_count: result(input.staleClaimCount || 0, (input.staleClaimCount || 0) === 0, [`count=${input.staleClaimCount || 0}`], (input.staleClaimCount || 0) ? ['stale_claim_present'] : []),
    conflicting_claim_count: result(input.conflictingClaimCount || 0, (input.conflictingClaimCount || 0) === 0, [`count=${input.conflictingClaimCount || 0}`], (input.conflictingClaimCount || 0) ? ['claim_conflict_present'] : []),
    unsupported_number_count: result(input.unsupportedNumberCount || 0, (input.unsupportedNumberCount || 0) === 0, [`count=${input.unsupportedNumberCount || 0}`], (input.unsupportedNumberCount || 0) ? ['unsupported_number_present'] : []),
    destination_specificity: result(destinationSpecificity, destinationSpecificity >= 1, [`details=${input.destinationSpecificDetailCount || 0}`, `generic_here=${genericHereCount}`], destinationSpecificity >= 1 ? [] : ['destination_specific_details_below_three']),
    information_gain: result(clamp(input.informationGainScore), clamp(input.informationGainScore) >= 0.6, [`score=${input.informationGainScore ?? 0}`], clamp(input.informationGainScore) >= 0.6 ? [] : ['information_gain_low']),
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
    serp_intent_alignment: result(clamp(input.serpIntentAlignment, intentCompletion), clamp(input.serpIntentAlignment, intentCompletion) >= 0.75, [`score=${input.serpIntentAlignment ?? intentCompletion}`], clamp(input.serpIntentAlignment, intentCompletion) >= 0.75 ? [] : ['serp_intent_misaligned']),
    decision_completion: result(clamp(input.decisionCompletion, intentCompletion), clamp(input.decisionCompletion, intentCompletion) >= 0.75, [`score=${input.decisionCompletion ?? intentCompletion}`], clamp(input.decisionCompletion, intentCompletion) >= 0.75 ? [] : ['reader_decision_incomplete']),
    query_cluster_coverage: result(clamp(input.queryClusterCoverage, 1), clamp(input.queryClusterCoverage, 1) >= 0.6, [`score=${input.queryClusterCoverage ?? 1}`], clamp(input.queryClusterCoverage, 1) >= 0.6 ? [] : ['query_cluster_undercovered']),
    comparative_information_gain: result(clamp(input.comparativeInformationGain, input.informationGainScore), clamp(input.comparativeInformationGain, input.informationGainScore) >= 0.6, [`score=${input.comparativeInformationGain ?? input.informationGainScore ?? 0}`], clamp(input.comparativeInformationGain, input.informationGainScore) >= 0.6 ? [] : ['comparative_information_gain_low']),
    competitor_copy_risk: result(1 - clamp(input.competitorCopyRisk), clamp(input.competitorCopyRisk) <= 0.3, [`risk=${input.competitorCopyRisk ?? 0}`], clamp(input.competitorCopyRisk) <= 0.3 ? [] : ['competitor_phrase_overlap']),
    title_snippet_congruence: result(clamp(input.titleSnippetCongruence, 1), clamp(input.titleSnippetCongruence, 1) >= 0.8, [`score=${input.titleSnippetCongruence ?? 1}`], clamp(input.titleSnippetCongruence, 1) >= 0.8 ? [] : ['title_description_body_mismatch']),
    section_purpose_coverage: result(clamp(input.sectionPurposeCoverage, intentCompletion), clamp(input.sectionPurposeCoverage, intentCompletion) >= 0.75, [`score=${input.sectionPurposeCoverage ?? intentCompletion}`], clamp(input.sectionPurposeCoverage, intentCompletion) >= 0.75 ? [] : ['section_purpose_missing']),
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
