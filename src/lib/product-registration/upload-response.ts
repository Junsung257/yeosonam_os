import type { SupabaseClient } from '@supabase/supabase-js';

import {
  buildUploadRegisterReport,
  type UploadRegisterReportPackage,
  type UploadRegisterReportRow,
} from '@/lib/product-registration-register-report';
import { calculateProductRegistrationTrustScore } from '@/lib/product-registration-trust-score';
import {
  buildLearningEngineEvidenceFromRuntime,
  scoreCentralLearningEngine,
  summarizeLearningRuntimeEventEvidence,
} from '@/lib/product-registration/learning-engine-scorecard';
import type { ImprovementLedgerEvent } from '@/lib/product-registration/improvement-ledger';
import { mineProductRegistrationPatterns } from '@/lib/product-registration/pattern-mining';
import type { UploadGate } from '@/lib/upload-validator';
import type { UploadInputAnalysis } from '@/lib/product-registration-input-guard';
import type { UploadSourceMetadataResult } from '@/lib/upload-source-metadata';
import { classifyProductRegistrationFailure, summarizeProductRegistrationFailures } from './failure-diagnostics';

type TokenUsageSource = {
  provider?: string;
  input?: number;
  output?: number;
  cache_hit?: number;
  phase2Provider?: string;
  phase2Input?: number;
  phase2Output?: number;
  phase2CacheHit?: number;
  elapsed_ms?: number;
} | null | undefined;

function buildTokenInfo(tu: TokenUsageSource) {
  if (!tu) return null;
  const input = Number(tu.input ?? 0);
  const output = Number(tu.output ?? 0);
  const cacheHit = Number(tu.cache_hit ?? 0);
  const billableInput = input - cacheHit;
  const phase1CostUsd = tu.provider === 'deepseek'
    ? (cacheHit / 1_000_000 * 0.014) + (billableInput / 1_000_000 * 0.14) + (output / 1_000_000 * 0.28)
    : (input / 1_000_000 * 0.30) + (output / 1_000_000 * 2.50);

  const p2in = Number(tu.phase2Input ?? 0);
  const p2out = Number(tu.phase2Output ?? 0);
  const p2cache = Number(tu.phase2CacheHit ?? 0);
  const phase2CostUsd = tu.phase2Provider === 'gemini'
    ? (p2in / 1_000_000 * 0.30) + (p2out / 1_000_000 * 2.50)
    : (p2cache / 1_000_000 * 0.014) + ((p2in - p2cache) / 1_000_000 * 0.14) + (p2out / 1_000_000 * 0.28);

  return {
    provider: tu.provider,
    inputTokens: input,
    outputTokens: output,
    cacheHitTokens: cacheHit,
    phase2Provider: tu.phase2Provider ?? 'deepseek',
    phase2InputTokens: p2in,
    phase2OutputTokens: p2out,
    phase2CacheHitTokens: p2cache,
    costUsd: Math.round((phase1CostUsd + phase2CostUsd) * 1_000_000) / 1_000_000,
    elapsed_ms: tu.elapsed_ms,
  };
}

function buildAttractionLine(stats: {
  matched: number;
  unmatched: number;
  seeded: number;
  reflected: number;
}): string {
  if (stats.matched + stats.seeded + stats.unmatched <= 0) return '';
  return [
    `관광지 매칭 ${stats.matched}개`,
    stats.seeded > 0 ? `신규 시드 ${stats.seeded}개` : null,
    stats.reflected > 0 ? `같은 등록 즉시반영 ${stats.reflected}개` : null,
    stats.unmatched > 0 ? `미매칭 ${stats.unmatched}개(검수 큐)` : null,
  ].filter(Boolean).join(' · ');
}

export async function buildUploadResponsePayload(input: {
  supabase: SupabaseClient;
  isSupabaseConfigured: boolean;
  savedIds: string[];
  savedTitles: string[];
  savedInternalCodes: string[];
  savedConfidences: number[];
  saveErrors: { title: string; error: string }[];
  totalPriceRowsSaved: number;
  savedPriceRowsByPackageId: Map<string, number>;
  productsToSaveLength: number;
  parsedDocument: Record<string, any>;
  fileHash: string;
  classification: unknown;
  inputAnalysisForTrust: UploadInputAnalysis | null;
  preSaveV3Status: string | null;
  matchedAttractionCount: number;
  unmatchedAttractionCount: number;
  attractionSeededCount: number;
  attractionReflectedCount: number;
  uploadSourceMetadata: UploadSourceMetadataResult | null;
  filenameSupplierRaw: string | null | undefined;
  marginRate: number;
  fileName: string;
  baseUrl: string;
  improvementEvents?: ImprovementLedgerEvent[];
  improvementEventsSaved?: number;
  improvementEventsSaveError?: string | null;
  skippedDuplicateSections?: number;
}): Promise<Record<string, unknown>> {
  const productCount = input.productsToSaveLength;
  const successCount = input.savedIds.length;
  const saveErrorDiagnostics = input.saveErrors.map(error => ({
    title: error.title,
    error: error.error,
    diagnostics: classifyProductRegistrationFailure(error.error),
  }));
  const failureSummary = summarizeProductRegistrationFailures(input.saveErrors.map(error => error.error));
  const blockedCount = saveErrorDiagnostics.filter(error => (
    error.diagnostics.some(diagnostic => diagnostic.severity === 'critical')
  )).length;
  const overallGate: UploadGate = blockedCount > 0 && successCount === 0
    ? 'BLOCKED'
    : blockedCount > 0
      ? 'REVIEW_NEEDED'
      : 'CLEAN';

  const attractionStats = {
    matched: input.matchedAttractionCount,
    unmatched: input.unmatchedAttractionCount,
    seeded: input.attractionSeededCount,
    reflected: input.attractionReflectedCount,
  };
  const attractionLine = buildAttractionLine(attractionStats);

  let registerReport: UploadRegisterReportRow[] = [];
  if (input.isSupabaseConfigured && input.savedIds.length > 0) {
    try {
      const { data: pkgs } = await input.supabase
        .from('travel_packages')
        .select('id, internal_code, title, price, airline, status, departure_days, commission_rate, land_operator, price_dates, itinerary_data')
        .in('id', input.savedIds);
      registerReport = buildUploadRegisterReport((pkgs ?? []) as UploadRegisterReportPackage[], input.baseUrl, {
        priceRowsByPackageId: input.savedPriceRowsByPackageId,
      });
    } catch (e) {
      console.warn('[upload] register report build failed:', e instanceof Error ? e.message : String(e));
    }
  }

  const trustScore = calculateProductRegistrationTrustScore({
    inputBlocked: input.inputAnalysisForTrust?.blocked ?? false,
    inputNeedsReview: input.inputAnalysisForTrust?.needsReview ?? false,
    inputIssueCodes: input.inputAnalysisForTrust?.issues.map(issue => issue.code) ?? [],
    actualProductCount: productCount,
    savedProductCount: successCount,
    priceRowsSaved: input.totalPriceRowsSaved,
    priceDatesCount: registerReport.reduce((sum, row) => sum + row.price_dates_count, 0),
    itineraryDaysCount: registerReport.reduce((sum, row) => sum + row.itinerary_days_count, 0),
    rawNoticeLeakRisk: false,
    v3Status: input.preSaveV3Status,
    unmatchedActivitiesCount: attractionStats.unmatched,
    renderAuditStatus: 'unknown',
  });
  const improvementEvents = input.improvementEvents ?? [];
  const improvementEventsSaved = input.improvementEventsSaved ?? 0;
  const macroMining = mineProductRegistrationPatterns({
    events: improvementEvents,
    minEvents: 50,
    minFailedOrReviewNeeded: 10,
    minRepeatedBlockers: 5,
  });
  const runtimeEventEvidence = summarizeLearningRuntimeEventEvidence(improvementEvents);
  const improvementLedgerReady = improvementEvents.length > 0
    && improvementEventsSaved >= improvementEvents.length
    && !input.improvementEventsSaveError;
  const learningScore = scoreCentralLearningEngine(buildLearningEngineEvidenceFromRuntime({
    microEventsCaptured: improvementEvents.length,
    microEventsPersisted: improvementEventsSaved,
    macroCandidatesGenerated: macroMining.candidates.length,
    promotionReadyCandidates: macroMining.candidates.filter(candidate => candidate.promotionReady).length,
    hasAutoQARunner: true,
    hasRenderAuditors: true,
    hasImprovementLedger: improvementLedgerReady,
    hasPatternMining: true,
    hasPromotionWorkflow: true,
    routeBoundaryClean: true,
    ...runtimeEventEvidence,
    mobileA4AuditVerified: (runtimeEventEvidence.renderAuditPassEvents ?? 0) > 0,
    priceAndDateRegressionVerified: false,
    liveSampleVerificationReady: false,
    fullRegressionVerified: false,
    operatorReportAvailable: true,
  }));

  return {
    success: successCount > 0 || !input.isSupabaseConfigured,
    data: input.parsedDocument,
    dbId: input.savedIds[0] ?? null,
    dbIds: input.savedIds,
    titles: input.savedTitles,
    internal_codes: input.savedInternalCodes,
    internal_code: input.savedInternalCodes[0] ?? null,
    finalConfidence: input.savedConfidences[0] ?? input.parsedDocument.confidence,
    finalConfidences: input.savedConfidences,
    productCount,
    skippedDuplicateSections: input.skippedDuplicateSections ?? 0,
    priceRowsSaved: input.totalPriceRowsSaved,
    fileHash: `${input.fileHash.slice(0, 12)}...`,
    classification: input.classification,
    gate: overallGate,
    trustScore,
    learningEngine: {
      mode: 'shadow',
      microEventsCaptured: improvementEvents.length,
      microEventsPersisted: improvementEventsSaved,
      persistenceError: input.improvementEventsSaveError ?? null,
      latestStatuses: improvementEvents.slice(-5).map(event => event.finalStatus),
      macroShouldRun: macroMining.shouldRun,
      macroRunReasons: macroMining.runReasons,
      macroCandidates: macroMining.candidates.slice(0, 5).map(candidate => ({
        id: candidate.id,
        kind: candidate.kind,
        evidenceCount: candidate.evidenceCount,
        promotionReady: candidate.promotionReady,
        risk: candidate.risk,
        recommendedAction: candidate.recommendedAction,
      })),
      score: {
        micro: learningScore.micro.total,
        macro: learningScore.macro.total,
        combined: learningScore.combined,
        productionReady: learningScore.productionReady,
        blockers: learningScore.blockers.slice(0, 12),
      },
    },
    failureDiagnostics: {
      codes: failureSummary.codes,
      diagnostics: failureSummary.diagnostics,
      hasCritical: failureSummary.hasCritical,
      nextAction: failureSummary.nextAction,
      byProduct: saveErrorDiagnostics,
    },
    tokenUsage: buildTokenInfo(input.parsedDocument._tokenUsage as TokenUsageSource),
    attractionStats,
    uploadMetadata: {
      landOperator: input.uploadSourceMetadata?.landOperator ?? input.filenameSupplierRaw ?? null,
      commissionRate: input.uploadSourceMetadata?.commissionRate ?? Math.round(input.marginRate * 10000) / 100,
      marginRate: input.marginRate,
      sourceLabel: input.uploadSourceMetadata?.cleanSourceLabel ?? input.fileName,
      metadataOnlyLineRemoved: input.uploadSourceMetadata?.metadataOnlyLineRemoved ?? false,
      issues: input.uploadSourceMetadata?.issues ?? [],
    },
    registerReport,
    ...(input.saveErrors.length > 0 ? { errors: input.saveErrors } : {}),
    message: productCount > 1
      ? `문서에서 ${successCount}/${productCount}개 상품 등록 완료. 가격 ${input.totalPriceRowsSaved}행 저장${attractionLine ? ` · ${attractionLine}` : ''}`
      : successCount > 0
        ? `문서 파싱 완료. (${input.savedInternalCodes[0] ?? 'DB 미설정'}) 가격 ${input.totalPriceRowsSaved}행${attractionLine ? ` · ${attractionLine}` : ''}`
        : '문서 파싱은 완료됐지만 DB 저장에 실패했습니다.',
  };
}
