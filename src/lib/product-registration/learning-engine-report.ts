import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  ImprovementAuditStatus,
  ImprovementFinalStatus,
  ImprovementLedgerEvent,
  RenderAuditResult,
} from './improvement-ledger';
import {
  buildLearningEngineEvidenceFromRuntime,
  scoreCentralLearningEngine,
} from './learning-engine-scorecard';
import { mineProductRegistrationPatterns } from './pattern-mining';
import {
  buildPromotionWorkItems,
  type PromotionWorkItem,
} from './promotion-workflow';
import type { SourceEvidenceSpan } from './types';

export type ProductRegistrationImprovementEventRow = {
  id?: string;
  created_at: string;
  upload_id: string | null;
  product_id: string | null;
  package_id: string | null;
  attempt_no: number | null;
  attempt_phase?: string | null;
  raw_text_hash: string;
  section_raw_text_hash: string | null;
  parser_version: string | null;
  detected_format: string | null;
  final_status: string;
  blockers_before: unknown;
  blockers_after: unknown;
  normalized_blocker_signatures: unknown;
  evidence_spans: unknown;
  compared_fields: unknown;
  auto_fixes_applied: unknown;
  packages_audit: unknown;
  a4_audit: unknown;
  fixture_candidate: boolean | null;
  rule_candidate: boolean | null;
};

export type ProductRegistrationLearningReport = {
  ok: boolean;
  generatedAt: string;
  window: {
    since: string | null;
    limit: number;
    eventsLoaded: number;
  };
  micro: {
    eventsCaptured: number;
    eventsPersisted: number;
    statuses: Record<string, number>;
    fixtureCandidates: number;
    ruleCandidates: number;
  };
  macro: {
    shouldRun: boolean;
    runReasons: string[];
    candidates: ReturnType<typeof mineProductRegistrationPatterns>['candidates'];
  };
  promotion: {
    workItems: PromotionWorkItem[];
    requiresReview: true;
    autoMutationEnabled: false;
  };
  score: {
    micro: number;
    macro: number;
    combined: number;
    productionReady: boolean;
    blockers: string[];
  };
  safety: {
    readOnly: true;
    productionMutation: false;
    rawTextStored: false;
    promotionRequiresReview: true;
  };
  nextAction: string;
};

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function auditResult(value: unknown): RenderAuditResult {
  if (!value || typeof value !== 'object') {
    return { status: 'unknown', failures: [], warnings: [] };
  }
  const record = value as Record<string, unknown>;
  const status = typeof record.status === 'string'
    && ['pass', 'warn', 'fail', 'unknown'].includes(record.status)
    ? record.status as ImprovementAuditStatus
    : 'unknown';
  return {
    status,
    failures: stringArray(record.failures),
    warnings: stringArray(record.warnings),
  };
}

function finalStatus(value: string): ImprovementFinalStatus {
  return ['PASS', 'AUTO_FIXED', 'REVIEW_NEEDED', 'BLOCKED'].includes(value)
    ? value as ImprovementFinalStatus
    : 'REVIEW_NEEDED';
}

export function mapImprovementLedgerRowToEvent(row: ProductRegistrationImprovementEventRow): ImprovementLedgerEvent {
  return {
    uploadId: row.upload_id,
    productId: row.product_id,
    packageId: row.package_id,
    attemptNo: row.attempt_no ?? 0,
    attemptPhase: row.attempt_phase === 'normal_registration'
      || row.attempt_phase === 'deterministic_source_recompare'
      || row.attempt_phase === 'render_payload_audit_repair'
      || row.attempt_phase === 'final_reregistration_deliverability_audit'
      ? row.attempt_phase
      : 'normal_registration',
    rawTextHash: row.raw_text_hash,
    sectionRawTextHash: row.section_raw_text_hash,
    parserVersion: row.parser_version ?? 'product-registration-central',
    detectedFormat: row.detected_format ?? 'unknown',
    blockersBefore: stringArray(row.blockers_before),
    blockersAfter: stringArray(row.blockers_after),
    normalizedBlockerSignatures: stringArray(row.normalized_blocker_signatures),
    evidenceSpans: Array.isArray(row.evidence_spans) ? row.evidence_spans as SourceEvidenceSpan[] : [],
    comparedFields: stringArray(row.compared_fields),
    autoFixesApplied: Array.isArray(row.auto_fixes_applied)
      ? row.auto_fixes_applied as ImprovementLedgerEvent['autoFixesApplied']
      : [],
    packagesAudit: auditResult(row.packages_audit),
    a4Audit: auditResult(row.a4_audit),
    finalStatus: finalStatus(row.final_status),
    fixtureCandidate: Boolean(row.fixture_candidate),
    ruleCandidate: Boolean(row.rule_candidate),
    createdAt: row.created_at,
  };
}

export function buildProductRegistrationLearningReport(input: {
  events: ImprovementLedgerEvent[];
  since?: string | null;
  limit: number;
  generatedAt?: string;
  fullRegressionVerified?: boolean;
  loadError?: string | null;
}): ProductRegistrationLearningReport {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const statuses = input.events.reduce<Record<string, number>>((acc, event) => {
    acc[event.finalStatus] = (acc[event.finalStatus] ?? 0) + 1;
    return acc;
  }, {});
  const macroMining = mineProductRegistrationPatterns({ events: input.events });
  const promotionWorkItems = buildPromotionWorkItems({
    candidates: macroMining.candidates,
    events: input.events,
  });
  const score = scoreCentralLearningEngine(buildLearningEngineEvidenceFromRuntime({
    microEventsCaptured: input.events.length,
    macroCandidatesGenerated: macroMining.candidates.length,
    promotionReadyCandidates: promotionWorkItems.length,
    hasAutoQARunner: true,
    hasRenderAuditors: true,
    hasImprovementLedger: true,
    hasPatternMining: true,
    hasPromotionWorkflow: true,
    routeBoundaryClean: true,
    fullRegressionVerified: Boolean(input.fullRegressionVerified),
    operatorReportAvailable: true,
  }));
  const scoreBlockers = input.loadError
    ? [`learning report load failed: ${input.loadError}`, ...score.blockers]
    : score.blockers;
  const nextAction = input.loadError
    ? 'Check product_registration_improvement_events migration and service-role read access.'
    : promotionWorkItems.length > 0
    ? 'Review promotion work items, add fixtures, then promote deterministic parser rules through full regression.'
    : macroMining.shouldRun
      ? 'Review macro candidates and collect source examples before promotion.'
      : 'Keep collecting upload events until macro thresholds are reached.';

  return {
    ok: true,
    generatedAt,
    window: {
      since: input.since ?? null,
      limit: input.limit,
      eventsLoaded: input.events.length,
    },
    micro: {
      eventsCaptured: input.events.length,
      eventsPersisted: input.events.length,
      statuses,
      fixtureCandidates: input.events.filter(event => event.fixtureCandidate).length,
      ruleCandidates: input.events.filter(event => event.ruleCandidate).length,
    },
    macro: {
      shouldRun: macroMining.shouldRun,
      runReasons: macroMining.runReasons,
      candidates: macroMining.candidates,
    },
    promotion: {
      workItems: promotionWorkItems,
      requiresReview: true,
      autoMutationEnabled: false,
    },
    score: {
      micro: score.micro.total,
      macro: score.macro.total,
      combined: score.combined,
      productionReady: score.productionReady && !input.loadError,
      blockers: scoreBlockers,
    },
    safety: {
      readOnly: true,
      productionMutation: false,
      rawTextStored: false,
      promotionRequiresReview: true,
    },
    nextAction,
  };
}

export async function loadProductRegistrationLearningReport(input: {
  supabase: SupabaseClient;
  isSupabaseConfigured: boolean;
  since?: string | null;
  limit?: number;
  fullRegressionVerified?: boolean;
}): Promise<ProductRegistrationLearningReport> {
  const limit = Math.max(1, Math.min(input.limit ?? 500, 1000));
  if (!input.isSupabaseConfigured) {
    return buildProductRegistrationLearningReport({
      events: [],
      since: input.since ?? null,
      limit,
      fullRegressionVerified: false,
    });
  }

  let query = input.supabase
    .from('product_registration_improvement_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (input.since) {
    query = query.gte('created_at', input.since);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const events = ((data ?? []) as ProductRegistrationImprovementEventRow[])
    .map(mapImprovementLedgerRowToEvent)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return buildProductRegistrationLearningReport({
    events,
    since: input.since ?? null,
    limit,
    fullRegressionVerified: input.fullRegressionVerified,
  });
}
