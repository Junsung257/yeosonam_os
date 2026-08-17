import { createHash } from 'node:crypto';

export type LearningSplit = 'development' | 'calibration' | 'frozen';

export type LearningManifestEntry = {
  sourcePath: string;
  filename: string;
  sourceHash: string | null;
  lineageHash: string;
  split: LearningSplit;
  duplicateOf: string | null;
  documentClass: string;
  extraction?: {
    succeeded?: boolean;
    parser?: string;
    tables?: number;
    nativeFallbackUsed?: boolean;
  };
  prelabel: {
    sectionCount: number;
    sectionHashes?: string[];
    kernelOutcomes?: string[];
    outcomes?: string[];
    terminalOutcomes?: string[];
    kernelBlockers?: string[];
    blockers?: string[];
    kernelSectionBlockers?: string[][];
    sectionBlockers?: string[][];
    departureDatePolicy?: {
      sectionDispositions?: string[];
    };
  };
};

export type LearningManifest = {
  schemaVersion: string;
  generatedAt?: string;
  entries?: LearningManifestEntry[];
};

export type LearningBlockerFamily =
  | 'segmentation'
  | 'price_date_scope'
  | 'sale_price_missing'
  | 'price_evidence'
  | 'departure_year'
  | 'cancellation_terms'
  | 'inclusions_exclusions'
  | 'commercial_contradiction'
  | 'itinerary'
  | 'flight_transport'
  | 'lodging'
  | 'other';

export type LearningMethod =
  | 'segmentation_fixture'
  | 'dual_ai_evidence_consensus'
  | 'companion_document_or_profile'
  | 'typed_date_scope_rule'
  | 'policy_or_context_graph'
  | 'supplier_profile_fixture'
  | 'deterministic_rule_fixture';

export type LearningObservation = {
  caseId: string;
  sourcePath: string;
  filename: string;
  sourceHash: string;
  lineageHash: string;
  split: Exclude<LearningSplit, 'frozen'>;
  sectionIndex: number;
  sectionHash: string | null;
  outcome: 'verified' | 'degraded' | 'blocked';
  blockers: string[];
  blockerFamilies: LearningBlockerFamily[];
  primaryFamily: LearningBlockerFamily;
  learningMethod: LearningMethod;
  priorityScore: number;
};

export type LearningCluster = {
  family: LearningBlockerFamily;
  blocker: string;
  riskWeight: number;
  occurrenceCount: number;
  sourceCount: number;
  lineageCount: number;
  priorityScore: number;
  samples: string[];
};

export type LearningSplitSummary = {
  allSections: number;
  pastOnlyExcluded: number;
  discardedSourceIncomplete: number;
  activeSections: number;
  publicationEligibleSections: number;
  safeSections: number;
  blockedSections: number;
  activeSafeRate: number;
  publicationEligibleSafeRate: number;
};

export type LearningRegressionSummary = {
  comparableSections: number;
  recoveredSections: number;
  regressedSections: number;
  safetyTightenedSections: number;
  unchangedSafeSections: number;
  unchangedBlockedSections: number;
};

export type LearningPromotionEvidence = {
  reviewedFrozenSectionCount: number;
  criticalExactMatchRate: number;
  criticalFalsePublicationCount: number;
  customerOpenGatePassed: boolean;
  consecutiveFrozenPasses: number;
};

export type ProductRegistrationLearningCycle = {
  schemaVersion: 'product-registration-learning-cycle-1';
  generatedAt: string;
  manifestGeneratedAt: string | null;
  privateArtifact: true;
  frozenIndividualCasesInspected: false;
  summaries: Record<LearningSplit, LearningSplitSummary>;
  clusters: LearningCluster[];
  selectedReviewCases: LearningObservation[];
  silverCandidateCases: LearningObservation[];
  regression: LearningRegressionSummary | null;
  promotion: {
    eligible: boolean;
    reasons: string[];
  };
  cycleHash: string;
};

const FAMILY_RISK: Record<LearningBlockerFamily, number> = {
  segmentation: 10,
  price_date_scope: 10,
  sale_price_missing: 10,
  price_evidence: 10,
  departure_year: 10,
  cancellation_terms: 9,
  inclusions_exclusions: 9,
  commercial_contradiction: 10,
  itinerary: 8,
  flight_transport: 7,
  lodging: 6,
  other: 4,
};

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${stableJson(row[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function normalizeLearningBlocker(blocker: string): string {
  return blocker
    .replace(/sections\[\d+\]/gu, 'sections[*]')
    .replace(/variants\[\d+\]/gu, 'variants[*]')
    .replace(/price_calendar\[\d+\]/gu, 'price_calendar[*]')
    .replace(/(PRICE_DATE_(?:YEAR|WEEKDAY)_CONFLICT):\d+/gu, '$1')
    .replace(/(SECTION_|VARIANT_)(?:INDEX_)?\d+/gu, '$1*');
}

export function learningBlockerFamily(blocker: string): LearningBlockerFamily {
  const value = normalizeLearningBlocker(blocker);
  if (/PRICE_DATE_(?:YEAR|WEEKDAY)_CONFLICT/iu.test(value)) return 'departure_year';
  if (/(?:segment|section cardinality|상품 구간|구간 분리)/iu.test(value)) return 'segmentation';
  if (/(?:PRICE_DATE_YEAR_CONFLICT|departure year|출발연도|연도 충돌)/iu.test(value)) return 'departure_year';
  if (/(?:판매가와 출발일|price_calendar|applicability|적용 범위|적용 관계)/iu.test(value)) return 'price_date_scope';
  if (/(?:성인 기준 판매가|adult sale price|판매가가 없습니다|sale price unavailable)/iu.test(value)) return 'sale_price_missing';
  if (/(?:amount evidence|금액.*evidence|원문 evidence.*재확인|AMOUNT_NOT_REPLAYABLE|SOURCE_SALE_PRICE_REQUIRES_RESOLUTION|판매가 후보.*확정하지 못)/iu.test(value)) return 'price_evidence';
  if (/(?:cancellation|refund|취소|환불)/iu.test(value)) return 'cancellation_terms';
  if (/(?:CUSTOMER_FACT_CONTRADICTION|NO_SHOPPING_WITH_SHOPPING_ITEMS|NO_OPTION_WITH_OPTION_ITEMS|GUIDE_TIP_INCLUDED_AND_LOCAL_PAYMENT)/iu.test(value)) return 'commercial_contradiction';
  if (/(?:inclusions|exclusions|포함사항|불포함사항|포함|불포함)/iu.test(value)) return 'inclusions_exclusions';
  if (/(?:itinerary|DAY 일정|일정 구조)/iu.test(value)) return 'itinerary';
  if (/(?:flight|transport|항공|교통)/iu.test(value)) return 'flight_transport';
  if (/(?:lodging|hotel|숙박|호텔)/iu.test(value)) return 'lodging';
  return 'other';
}

export function learningBlockerRiskWeight(blocker: string): number {
  return FAMILY_RISK[learningBlockerFamily(blocker)];
}

export function learningMethodForFamily(family: LearningBlockerFamily): LearningMethod {
  if (family === 'segmentation') return 'segmentation_fixture';
  if (family === 'price_date_scope' || family === 'price_evidence') return 'dual_ai_evidence_consensus';
  if (family === 'sale_price_missing') return 'companion_document_or_profile';
  if (family === 'departure_year') return 'typed_date_scope_rule';
  if (family === 'cancellation_terms' || family === 'inclusions_exclusions' || family === 'commercial_contradiction') return 'policy_or_context_graph';
  if (family === 'itinerary' || family === 'flight_transport' || family === 'lodging') return 'supplier_profile_fixture';
  return 'deterministic_rule_fixture';
}

function normalizedOutcome(value: string | undefined): 'verified' | 'degraded' | 'blocked' {
  if (value === 'verified' || value === 'degraded') return value;
  return 'blocked';
}

function sectionBlockers(entry: LearningManifestEntry, sectionIndex: number): string[] {
  const kernel = entry.prelabel.kernelSectionBlockers?.[sectionIndex]
    ?? (sectionIndex === 0 ? entry.prelabel.kernelBlockers ?? [] : []);
  const terminal = entry.prelabel.sectionBlockers?.[sectionIndex]
    ?? (sectionIndex === 0 ? entry.prelabel.blockers ?? [] : []);
  return [...new Set([...kernel, ...terminal].map(normalizeLearningBlocker))];
}

function sectionDisposition(entry: LearningManifestEntry, sectionIndex: number): string | null {
  return entry.prelabel.departureDatePolicy?.sectionDispositions?.[sectionIndex] ?? null;
}

function sectionTerminalOutcome(entry: LearningManifestEntry, sectionIndex: number): string | null {
  return entry.prelabel.terminalOutcomes?.[sectionIndex] ?? null;
}

function summarizeSplit(entries: LearningManifestEntry[], split: LearningSplit): LearningSplitSummary {
  let allSections = 0;
  let pastOnlyExcluded = 0;
  let discardedSourceIncomplete = 0;
  let safeSections = 0;
  let blockedSections = 0;
  for (const entry of entries) {
    if (entry.split !== split || entry.duplicateOf || entry.documentClass !== 'travel_product') continue;
    for (let sectionIndex = 0; sectionIndex < entry.prelabel.sectionCount; sectionIndex += 1) {
      allSections += 1;
      if (sectionDisposition(entry, sectionIndex) === 'past_only_excluded') {
        pastOnlyExcluded += 1;
        continue;
      }
      if (sectionTerminalOutcome(entry, sectionIndex) === 'discarded_source_incomplete') {
        discardedSourceIncomplete += 1;
        continue;
      }
      const outcome = normalizedOutcome(entry.prelabel.outcomes?.[sectionIndex] ?? entry.prelabel.kernelOutcomes?.[sectionIndex]);
      if (outcome === 'blocked') blockedSections += 1;
      else safeSections += 1;
    }
  }
  const activeSections = allSections - pastOnlyExcluded;
  const publicationEligibleSections = activeSections - discardedSourceIncomplete;
  return {
    allSections,
    pastOnlyExcluded,
    discardedSourceIncomplete,
    activeSections,
    publicationEligibleSections,
    safeSections,
    blockedSections,
    activeSafeRate: activeSections > 0 ? safeSections / activeSections : 0,
    publicationEligibleSafeRate: publicationEligibleSections > 0
      ? safeSections / publicationEligibleSections
      : 0,
  };
}

function buildObservations(entries: LearningManifestEntry[]): LearningObservation[] {
  const raw: Array<Omit<LearningObservation, 'priorityScore' | 'primaryFamily' | 'learningMethod'>> = [];
  for (const entry of entries) {
    if (entry.split === 'frozen' || entry.duplicateOf || entry.documentClass !== 'travel_product' || !entry.sourceHash) continue;
    for (let sectionIndex = 0; sectionIndex < entry.prelabel.sectionCount; sectionIndex += 1) {
      if (sectionDisposition(entry, sectionIndex) === 'past_only_excluded') continue;
      if (sectionTerminalOutcome(entry, sectionIndex) === 'discarded_source_incomplete') continue;
      const outcome = normalizedOutcome(entry.prelabel.outcomes?.[sectionIndex] ?? entry.prelabel.kernelOutcomes?.[sectionIndex]);
      const blockers = sectionBlockers(entry, sectionIndex);
      if (outcome !== 'blocked' && blockers.length === 0) continue;
      const blockerFamilies = [...new Set(blockers.map(learningBlockerFamily))];
      if (blockerFamilies.length === 0) blockerFamilies.push('other');
      raw.push({
        caseId: `hwp:${entry.sourceHash}:section:${sectionIndex}`,
        sourcePath: entry.sourcePath,
        filename: entry.filename,
        sourceHash: entry.sourceHash,
        lineageHash: entry.lineageHash,
        split: entry.split,
        sectionIndex,
        sectionHash: entry.prelabel.sectionHashes?.[sectionIndex] ?? null,
        outcome,
        blockers,
        blockerFamilies,
      });
    }
  }
  const familyFrequency = new Map<LearningBlockerFamily, number>();
  raw.forEach(item => item.blockerFamilies.forEach(family => familyFrequency.set(family, (familyFrequency.get(family) ?? 0) + 1)));
  return raw.map(item => {
    const primaryFamily = [...item.blockerFamilies].sort((left, right) => {
      const leftScore = FAMILY_RISK[left] * (familyFrequency.get(left) ?? 1);
      const rightScore = FAMILY_RISK[right] * (familyFrequency.get(right) ?? 1);
      return rightScore - leftScore || left.localeCompare(right);
    })[0] ?? 'other';
    const priorityScore = item.blockerFamilies.reduce((sum, family) => (
      sum + FAMILY_RISK[family] * Math.max(1, familyFrequency.get(family) ?? 1)
    ), 0);
    return {
      ...item,
      primaryFamily,
      learningMethod: learningMethodForFamily(primaryFamily),
      priorityScore,
    };
  });
}

function buildClusters(observations: LearningObservation[]): LearningCluster[] {
  const grouped = new Map<string, {
    family: LearningBlockerFamily;
    blocker: string;
    occurrences: number;
    sources: Set<string>;
    lineages: Set<string>;
    samples: string[];
  }>();
  for (const item of observations) {
    for (const blocker of item.blockers) {
      const family = learningBlockerFamily(blocker);
      const key = `${family}:${blocker}`;
      const group = grouped.get(key) ?? {
        family,
        blocker,
        occurrences: 0,
        sources: new Set<string>(),
        lineages: new Set<string>(),
        samples: [],
      };
      group.occurrences += 1;
      group.sources.add(item.sourceHash);
      group.lineages.add(item.lineageHash);
      if (group.samples.length < 8 && !group.samples.includes(item.filename)) group.samples.push(item.filename);
      grouped.set(key, group);
    }
  }
  return [...grouped.values()].map(group => ({
    family: group.family,
    blocker: group.blocker,
    riskWeight: FAMILY_RISK[group.family],
    occurrenceCount: group.occurrences,
    sourceCount: group.sources.size,
    lineageCount: group.lineages.size,
    priorityScore: FAMILY_RISK[group.family] * group.occurrences * Math.max(1, group.lineages.size),
    samples: group.samples,
  })).sort((left, right) => right.priorityScore - left.priorityScore || left.blocker.localeCompare(right.blocker));
}

export function selectDiverseLearningCases(input: {
  observations: LearningObservation[];
  maximumCases?: number;
  maximumPerFamily?: number;
}): LearningObservation[] {
  const maximumCases = input.maximumCases ?? 60;
  const maximumPerFamily = input.maximumPerFamily ?? Math.max(4, Math.ceil(maximumCases / 4));
  const pool = input.observations.filter(item => item.split === 'development');
  const selected: LearningObservation[] = [];
  const selectedLineages = new Set<string>();
  const familyCounts = new Map<LearningBlockerFamily, number>();
  while (selected.length < maximumCases) {
    const candidates = pool.filter(item => (
      !selectedLineages.has(item.lineageHash)
      && (familyCounts.get(item.primaryFamily) ?? 0) < maximumPerFamily
    ));
    if (candidates.length === 0) break;
    candidates.sort((left, right) => {
      const leftAdjusted = left.priorityScore / (1 + (familyCounts.get(left.primaryFamily) ?? 0));
      const rightAdjusted = right.priorityScore / (1 + (familyCounts.get(right.primaryFamily) ?? 0));
      return rightAdjusted - leftAdjusted
        || right.priorityScore - left.priorityScore
        || left.caseId.localeCompare(right.caseId);
    });
    const chosen = candidates[0]!;
    selected.push(chosen);
    selectedLineages.add(chosen.lineageHash);
    familyCounts.set(chosen.primaryFamily, (familyCounts.get(chosen.primaryFamily) ?? 0) + 1);
  }
  return selected;
}

function regressionSummary(currentEntries: LearningManifestEntry[], previousEntries: LearningManifestEntry[]): LearningRegressionSummary {
  const previous = new Map<string, { outcome: 'verified' | 'degraded' | 'blocked'; disposition: string | null }>();
  for (const entry of previousEntries) {
    if (entry.split === 'frozen' || entry.duplicateOf || entry.documentClass !== 'travel_product' || !entry.sourceHash) continue;
    for (let index = 0; index < entry.prelabel.sectionCount; index += 1) {
      const sectionHash = entry.prelabel.sectionHashes?.[index];
      if (!sectionHash) continue;
      previous.set(`${entry.sourceHash}:${sectionHash}`, {
        outcome: normalizedOutcome(entry.prelabel.outcomes?.[index] ?? entry.prelabel.kernelOutcomes?.[index]),
        disposition: sectionDisposition(entry, index),
      });
    }
  }
  const result: LearningRegressionSummary = {
    comparableSections: 0,
    recoveredSections: 0,
    regressedSections: 0,
    safetyTightenedSections: 0,
    unchangedSafeSections: 0,
    unchangedBlockedSections: 0,
  };
  for (const entry of currentEntries) {
    if (entry.split === 'frozen' || entry.duplicateOf || entry.documentClass !== 'travel_product' || !entry.sourceHash) continue;
    for (let index = 0; index < entry.prelabel.sectionCount; index += 1) {
      const sectionHash = entry.prelabel.sectionHashes?.[index];
      if (!sectionHash) continue;
      const before = previous.get(`${entry.sourceHash}:${sectionHash}`);
      if (!before) continue;
      const disposition = sectionDisposition(entry, index);
      if (before.disposition === 'past_only_excluded' || disposition === 'past_only_excluded') continue;
      const terminalOutcome = sectionTerminalOutcome(entry, index);
      const after = normalizedOutcome(entry.prelabel.outcomes?.[index] ?? entry.prelabel.kernelOutcomes?.[index]);
      const beforeSafe = before.outcome !== 'blocked';
      const afterSafe = after !== 'blocked';
      result.comparableSections += 1;
      if (beforeSafe && terminalOutcome === 'discarded_source_incomplete') {
        // A source without an adult sale price must become private/discarded.
        // This is stricter publication safety, not a parser regression.
        result.safetyTightenedSections += 1;
      } else if (!beforeSafe && afterSafe) result.recoveredSections += 1;
      else if (beforeSafe && !afterSafe) result.regressedSections += 1;
      else if (beforeSafe) result.unchangedSafeSections += 1;
      else result.unchangedBlockedSections += 1;
    }
  }
  return result;
}

export function buildBlindLearningReviewQueue(input: {
  manifestPath: string;
  cycle: ProductRegistrationLearningCycle;
  approvedCancellationPolicyHash?: string | null;
}): Record<string, unknown> {
  const bySource = new Map<string, LearningObservation[]>();
  input.cycle.selectedReviewCases.forEach(item => {
    const values = bySource.get(item.sourceHash) ?? [];
    values.push(item);
    bySource.set(item.sourceHash, values);
  });
  return {
    schemaVersion: 'product-registration-review-queue-1',
    corpusVersion: `${input.manifestPath}#active-learning:${input.cycle.cycleHash}`,
    generatedAt: input.cycle.generatedAt,
    privateArtifact: true,
    engineOutputsIncluded: false,
    approvedCancellationPolicy: null,
    approvedCancellationPolicyHash: input.approvedCancellationPolicyHash ?? null,
    selectionPolicy: 'risk-diverse-development-only-1',
    reviewerInstructions: [
      '원문만 보고 상품 구간과 고객 판매 사실을 작성합니다.',
      '엔진 출력, 차단 사유, 과거 등록 상품값, 다른 검수자의 답을 보지 않습니다.',
      '가격·출발일·통화·포함/불포함·취소조건은 원문 위치를 함께 표시합니다.',
      '각 상품 구간마다 성인 기준 판매가가 원문에 실제로 있는지 sourceSalePricePresent=true/false로 반드시 판정합니다.',
      '판매가가 없다는 판정도 두 검수자가 독립 확인해야 하며, 가격표·특가 축약·공통 요금표가 있으면 false로 판정하지 않습니다.',
      'first와 second는 서로 다른 검수자가 독립 작성하고, 불일치할 때만 제3자가 조정합니다.',
    ],
    cases: [...bySource.values()].map(items => {
      const item = items[0]!;
      return {
        caseId: `hwp:${item.sourceHash}`,
        sourcePath: item.sourcePath,
        sourceHash: item.sourceHash,
        lineageHash: item.lineageHash,
        inputKind: 'hwp',
        pasteOrigin: null,
        split: item.split,
        filename: item.filename,
        supplierKey: null,
        documentFamily: null,
        selectedSectionIndexes: items.map(value => value.sectionIndex).sort((left, right) => left - right),
        first: null,
        second: null,
        adjudicator: null,
      };
    }),
  };
}

export function createProductRegistrationLearningCycle(input: {
  manifest: LearningManifest;
  previousManifest?: LearningManifest | null;
  maximumReviewCases?: number;
  maximumPerFamily?: number;
  promotionEvidence?: LearningPromotionEvidence | null;
  generatedAt?: string;
}): ProductRegistrationLearningCycle {
  const entries = input.manifest.entries ?? [];
  const observations = buildObservations(entries);
  const selectedReviewCases = selectDiverseLearningCases({
    observations,
    maximumCases: input.maximumReviewCases,
    maximumPerFamily: input.maximumPerFamily,
  });
  const silverCandidateCases = selectedReviewCases.filter(item => item.learningMethod === 'dual_ai_evidence_consensus');
  const regression = input.previousManifest
    ? regressionSummary(entries, input.previousManifest.entries ?? [])
    : null;
  const promotionReasons: string[] = [];
  const evidence = input.promotionEvidence;
  if (!evidence) promotionReasons.push('REVIEWED_BENCHMARK_EVIDENCE_MISSING');
  else {
    if (evidence.reviewedFrozenSectionCount < 300) promotionReasons.push(`FROZEN_REVIEW_TOO_SMALL:${evidence.reviewedFrozenSectionCount}/300`);
    if (evidence.criticalExactMatchRate < 0.995) promotionReasons.push(`CRITICAL_EXACT_MATCH_BELOW_GATE:${evidence.criticalExactMatchRate}`);
    if (evidence.criticalFalsePublicationCount > 0) promotionReasons.push(`CRITICAL_FALSE_PUBLICATION:${evidence.criticalFalsePublicationCount}`);
    if (!evidence.customerOpenGatePassed) promotionReasons.push('CUSTOMER_OPEN_GATE_NOT_PASSED');
    if (evidence.consecutiveFrozenPasses < 2) promotionReasons.push(`CONSECUTIVE_FROZEN_PASSES_REQUIRED:${evidence.consecutiveFrozenPasses}/2`);
  }
  if (regression && regression.regressedSections > 0) promotionReasons.push(`ACTIVE_REGRESSION_DETECTED:${regression.regressedSections}`);
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const base = {
    schemaVersion: 'product-registration-learning-cycle-1' as const,
    generatedAt,
    manifestGeneratedAt: input.manifest.generatedAt ?? null,
    privateArtifact: true as const,
    frozenIndividualCasesInspected: false as const,
    summaries: {
      development: summarizeSplit(entries, 'development'),
      calibration: summarizeSplit(entries, 'calibration'),
      frozen: summarizeSplit(entries, 'frozen'),
    },
    clusters: buildClusters(observations),
    selectedReviewCases,
    silverCandidateCases,
    regression,
    promotion: {
      eligible: promotionReasons.length === 0,
      reasons: promotionReasons,
    },
  };
  return {
    ...base,
    cycleHash: sha256(stableJson(base)),
  };
}
