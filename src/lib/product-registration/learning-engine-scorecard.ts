export type LearningEngineScoreStatus =
  | 'not_usable'
  | 'diagnostic_only'
  | 'shadow_mode'
  | 'limited_auto_fix'
  | 'production_ready';

export type ScoreCriterion = {
  id: string;
  label: string;
  points: number;
  earned: number;
};

export type LearningEngineScore = {
  total: number;
  status: LearningEngineScoreStatus;
  criteria: ScoreCriterion[];
  blockers: string[];
};

export type MicroLearningEngineEvidence = {
  triggerCoverageReady: boolean;
  sourceComparisonReady: boolean;
  autoRepairDisciplineReady: boolean;
  customerRenderAuditReady: boolean;
  improvementLedgerReady: boolean;
  safetyGatesReady: boolean;
};

export type MacroLearningEngineEvidence = {
  ledgerCoverageReady: boolean;
  patternMiningReady: boolean;
  canonicalizationReady: boolean;
  promotionGateReady: boolean;
  regressionEvidenceReady: boolean;
  operatorVisibilityReady: boolean;
};

export type CentralLearningEngineScore = {
  micro: LearningEngineScore;
  macro: LearningEngineScore;
  combined: number;
  productionReady: boolean;
  blockers: string[];
};

export type LearningEngineRuntimeEvidence = {
  microEventsCaptured: number;
  microEventsPersisted?: number;
  macroCandidatesGenerated: number;
  promotionReadyCandidates: number;
  hasAutoQARunner: boolean;
  hasRenderAuditors: boolean;
  hasImprovementLedger: boolean;
  hasPatternMining: boolean;
  hasPromotionWorkflow?: boolean;
  routeBoundaryClean: boolean;
  fullRegressionVerified: boolean;
  sourceEvidenceEvents?: number;
  comparedFieldEvents?: number;
  renderAuditPassEvents?: number;
  distinctRawTextHashes?: number;
  distinctDetectedFormats?: number;
  mobileA4AuditVerified?: boolean;
  priceAndDateRegressionVerified?: boolean;
  liveSampleVerificationReady?: boolean;
  operatorReportAvailable: boolean;
};

type LearningRuntimeEventEvidence = {
  rawTextHash?: string | null;
  detectedFormat?: string | null;
  evidenceSpans?: unknown[];
  comparedFields?: unknown[];
  packagesAudit?: { status?: string | null } | null;
  a4Audit?: { status?: string | null } | null;
};

function statusForScore(score: number): LearningEngineScoreStatus {
  if (score >= 95) return 'production_ready';
  if (score >= 90) return 'limited_auto_fix';
  if (score >= 80) return 'shadow_mode';
  if (score >= 60) return 'diagnostic_only';
  return 'not_usable';
}

function buildScore(criteria: ScoreCriterion[]): LearningEngineScore {
  const total = criteria.reduce((sum, criterion) => sum + criterion.earned, 0);
  const blockers = criteria
    .filter(criterion => criterion.earned < criterion.points)
    .map(criterion => `${criterion.id}:${criterion.label}`);
  return {
    total,
    status: statusForScore(total),
    criteria,
    blockers,
  };
}

function criterion(id: string, label: string, points: number, ready: boolean): ScoreCriterion {
  return {
    id,
    label,
    points,
    earned: ready ? points : 0,
  };
}

export function scoreMicroLearningEngine(evidence: MicroLearningEngineEvidence): LearningEngineScore {
  return buildScore([
    criterion('micro_trigger_coverage', 'failure and low-confidence triggers are wired outside upload route', 15, evidence.triggerCoverageReady),
    criterion('micro_source_compare', 'raw source, section text, spans, and standardized fields are compared', 20, evidence.sourceComparisonReady),
    criterion('micro_auto_repair', 'deterministic repairs run before fallback with max three attempts', 15, evidence.autoRepairDisciplineReady),
    criterion('micro_render_audit', 'packages and A4 customer payload audits run after repair', 20, evidence.customerRenderAuditReady),
    criterion('micro_ledger', 'every attempt stores blockers, fixes, evidence, status, and candidates', 15, evidence.improvementLedgerReady),
    criterion('micro_safety_gates', 'deliverability, price, destination, itinerary, and render gates are enforced', 15, evidence.safetyGatesReady),
  ]);
}

export function scoreMacroLearningEngine(evidence: MacroLearningEngineEvidence): LearningEngineScore {
  return buildScore([
    criterion('macro_ledger_coverage', 'micro events have stable normalized blocker signatures', 15, evidence.ledgerCoverageReady),
    criterion('macro_pattern_mining', 'headings, price tables, itinerary columns, supplier formats, and pollution signatures are mined', 20, evidence.patternMiningReady),
    criterion('macro_canonicalization', 'aliases become candidates without overwriting parser rules', 15, evidence.canonicalizationReady),
    criterion('macro_promotion_gate', 'candidate to production promotion gate is enforced', 20, evidence.promotionGateReady),
    criterion('macro_regression_evidence', 'golden corpus and eval prove no existing formats regress', 20, evidence.regressionEvidenceReady),
    criterion('macro_operator_visibility', 'operator report shows evidence, risk, and next action', 10, evidence.operatorVisibilityReady),
  ]);
}

export function scoreCentralLearningEngine(input: {
  micro: MicroLearningEngineEvidence;
  macro: MacroLearningEngineEvidence;
}): CentralLearningEngineScore {
  const micro = scoreMicroLearningEngine(input.micro);
  const macro = scoreMacroLearningEngine(input.macro);
  const combined = Math.round((micro.total + macro.total) / 2);
  const blockers = [
    ...(micro.total < 90 ? [`micro score ${micro.total} < 90`] : []),
    ...(macro.total < 90 ? [`macro score ${macro.total} < 90`] : []),
    ...(combined < 95 ? [`combined score ${combined} < 95`] : []),
    ...micro.blockers.map(blocker => `micro:${blocker}`),
    ...macro.blockers.map(blocker => `macro:${blocker}`),
  ];

  return {
    micro,
    macro,
    combined,
    productionReady: micro.total >= 90 && macro.total >= 90 && combined >= 95,
    blockers,
  };
}

export function buildLearningEngineEvidenceFromRuntime(
  runtime: LearningEngineRuntimeEvidence,
): {
  micro: MicroLearningEngineEvidence;
  macro: MacroLearningEngineEvidence;
} {
  const microEventsPersisted = runtime.microEventsPersisted ?? runtime.microEventsCaptured;
  const durableLedgerReady = runtime.hasImprovementLedger
    && runtime.microEventsCaptured > 0
    && microEventsPersisted >= runtime.microEventsCaptured;
  const sourceComparisonEvidenceReady = (runtime.sourceEvidenceEvents ?? 0) > 0
    || (runtime.comparedFieldEvents ?? 0) > 0;
  const renderEvidenceReady = (runtime.renderAuditPassEvents ?? 0) > 0
    && runtime.mobileA4AuditVerified === true;
  const distinctRawTextHashes = runtime.distinctRawTextHashes ?? 0;
  const distinctDetectedFormats = runtime.distinctDetectedFormats ?? 0;
  const regressionEvidenceReady = runtime.fullRegressionVerified
    && runtime.mobileA4AuditVerified === true
    && runtime.priceAndDateRegressionVerified === true
    && runtime.liveSampleVerificationReady === true;

  return {
    micro: {
      triggerCoverageReady: runtime.hasAutoQARunner && runtime.routeBoundaryClean,
      sourceComparisonReady: runtime.hasAutoQARunner && durableLedgerReady && sourceComparisonEvidenceReady,
      autoRepairDisciplineReady: runtime.hasAutoQARunner,
      customerRenderAuditReady: runtime.hasRenderAuditors && renderEvidenceReady,
      improvementLedgerReady: durableLedgerReady,
      safetyGatesReady: regressionEvidenceReady,
    },
    macro: {
      ledgerCoverageReady: durableLedgerReady
        && runtime.microEventsCaptured >= 50
        && distinctRawTextHashes >= 3,
      patternMiningReady: runtime.hasPatternMining
        && runtime.macroCandidatesGenerated > 0
        && distinctDetectedFormats > 0,
      canonicalizationReady: runtime.hasPatternMining,
      promotionGateReady: Boolean(runtime.hasPromotionWorkflow)
        && runtime.promotionReadyCandidates > 0
        && distinctRawTextHashes >= 3
        && regressionEvidenceReady,
      regressionEvidenceReady,
      operatorVisibilityReady: runtime.operatorReportAvailable,
    },
  };
}

export function summarizeLearningRuntimeEventEvidence(
  events: LearningRuntimeEventEvidence[],
): Pick<
  LearningEngineRuntimeEvidence,
  | 'sourceEvidenceEvents'
  | 'comparedFieldEvents'
  | 'renderAuditPassEvents'
  | 'distinctRawTextHashes'
  | 'distinctDetectedFormats'
> {
  return {
    sourceEvidenceEvents: events.filter(event => (event.evidenceSpans?.length ?? 0) > 0).length,
    comparedFieldEvents: events.filter(event => (event.comparedFields?.length ?? 0) > 0).length,
    renderAuditPassEvents: events.filter(event =>
      event.packagesAudit?.status === 'pass' && event.a4Audit?.status === 'pass',
    ).length,
    distinctRawTextHashes: new Set(
      events
        .map(event => event.rawTextHash?.trim())
        .filter((hash): hash is string => Boolean(hash)),
    ).size,
    distinctDetectedFormats: new Set(
      events
        .map(event => event.detectedFormat?.trim())
        .filter((format): format is string => Boolean(format)),
    ).size,
  };
}
