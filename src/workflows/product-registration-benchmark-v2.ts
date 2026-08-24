import { FatalError } from 'workflow';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  PRODUCT_REGISTRATION_V4_NORMALIZATION_VERSION,
  buildCanonicalNormalization,
} from '@/lib/product-registration-v4/canonical-worker';
import { sha256Hex } from '@/lib/product-registration-v4/document-ir';
import { extractSourceDocumentToIR } from '@/lib/product-registration-v4/extractions';
import type { ProductSourceType } from '@/lib/product-registration-v4/types';
import {
  compareCanonicalSectionSequenceToGroundTruth,
  compareCanonicalSectionToGroundTruth,
  type BenchmarkGroundTruthSection,
} from '@/lib/product-registration-v6/benchmark-ground-truth';
import {
  benchmarkMeetsCustomerOpenGate,
  majorCohortSafeOpenRate,
  summarizeProductRegistrationBenchmark,
  type ProductRegistrationBenchmarkCase,
  type ProductRegistrationBenchmarkExpectedOutcome,
} from '@/lib/product-registration-v6/benchmark-metrics';
import {
  assertProductRegistrationEngineReleaseManifest,
  type ProductRegistrationEngineReleaseManifest,
} from '@/lib/product-registration-v6/engine-release-manifest';
import {
  classifyProductSourceDocument,
  type ProductSourceDocumentClass,
} from '@/lib/product-registration-v6/document-classifier';
import { evaluateProductRegistrationV6Policy } from '@/lib/product-registration-v6/terminal-policy';
import {
  PRODUCT_REGISTRATION_V6_POLICY_VERSION,
  type ProductRegistrationV6TerminalOutcome,
} from '@/lib/product-registration-v6/types';
import type { RegistrationTermsPolicySnapshot } from '@/lib/standard-terms-client';
import { getSupabaseAdmin } from '@/lib/supabase';
import { PRODUCT_SOURCE_DEPARTURE_YEAR_CONTEXT_VERSION } from '@/lib/product-registration/source-departure-year-context';

type JsonObject = Record<string, unknown>;

function db(): SupabaseClient {
  const client = getSupabaseAdmin();
  if (!client) throw new FatalError('SUPABASE_ADMIN_NOT_CONFIGURED');
  return client as SupabaseClient;
}

export type ProductRegistrationBenchmarkV2WorkflowInput = {
  tenantId: string;
  benchmarkRunId: string;
  releaseManifest: ProductRegistrationEngineReleaseManifest;
  termsPolicy: RegistrationTermsPolicySnapshot;
};

type GroundTruthRow = {
  groundTruthSectionId: string;
  sectionIndex: number;
  groundTruth: BenchmarkGroundTruthSection;
};

type BenchmarkSourceCase = {
  corpusSourceId: string;
  sourceDocumentId: string;
  sourceHash: string;
  lineageHash: string;
  inputKind: 'hwp' | 'text';
  split: 'frozen';
  supplierKey: string | null;
  documentFamily: string | null;
  sourceDepartureYear: number | null;
  originalFilename: string;
  storageBucket: string;
  storagePath: string;
  sourceType: ProductSourceType;
  expectedDocumentClass: ProductSourceDocumentClass;
  groundTruthSections: GroundTruthRow[];
};

type BenchmarkCaseResult = ProductRegistrationBenchmarkCase & {
  groundTruthSectionId: string;
  corpusSourceId: string;
  fieldDiffs: unknown[];
};

function object(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}

function parseSourceCase(value: unknown): BenchmarkSourceCase {
  const row = object(value);
  if (!row || !Array.isArray(row.groundTruthSections)) throw new FatalError('BENCHMARK_CASE_PAYLOAD_INVALID');
  const sourceType = String(row.sourceType);
  if (!['hwp', 'text'].includes(sourceType)) throw new FatalError(`BENCHMARK_SOURCE_TYPE_UNSUPPORTED:${sourceType}`);
  const expectedDocumentClass = String(row.expectedDocumentClass) as ProductSourceDocumentClass;
  if (!['travel_product', 'non_travel', 'unsupported', 'corrupt'].includes(expectedDocumentClass)) {
    throw new FatalError('BENCHMARK_EXPECTED_DOCUMENT_CLASS_INVALID');
  }
  const groundTruthSections = row.groundTruthSections.map(rawGroundTruth => {
    const ground = object(rawGroundTruth);
    const truth = object(ground?.groundTruth);
    if (!ground || !truth) throw new FatalError('BENCHMARK_GROUND_TRUTH_INVALID');
    return {
      groundTruthSectionId: String(ground.groundTruthSectionId),
      sectionIndex: Number(ground.sectionIndex),
      groundTruth: truth as unknown as BenchmarkGroundTruthSection,
    };
  });
  return {
    corpusSourceId: String(row.corpusSourceId),
    sourceDocumentId: String(row.sourceDocumentId),
    sourceHash: String(row.sourceHash),
    lineageHash: String(row.lineageHash),
    inputKind: row.inputKind === 'text' ? 'text' : 'hwp',
    split: 'frozen',
    supplierKey: typeof row.supplierKey === 'string' ? row.supplierKey : null,
    documentFamily: typeof row.documentFamily === 'string' ? row.documentFamily : null,
    sourceDepartureYear: Number.isInteger(row.sourceDepartureYear) ? Number(row.sourceDepartureYear) : null,
    originalFilename: String(row.originalFilename),
    storageBucket: String(row.storageBucket),
    storagePath: String(row.storagePath),
    sourceType: sourceType as ProductSourceType,
    expectedDocumentClass,
    groundTruthSections,
  };
}

function terminalOutcomeForDocumentClass(documentClass: string): ProductRegistrationV6TerminalOutcome {
  if (documentClass === 'non_travel') return 'discarded_non_travel';
  if (documentClass === 'unsupported' || documentClass === 'corrupt') return 'quarantined_unsupported_or_corrupt';
  return 'blocked_action_required';
}

function benchmarkOutcomeForPrediction(input: {
  predictedOutcome: ProductRegistrationBenchmarkCase['predictedOutcome'];
  terminalOutcome: ProductRegistrationV6TerminalOutcome;
}): ProductRegistrationBenchmarkExpectedOutcome {
  if (input.terminalOutcome === 'discarded_non_travel') return 'EXPECTED_NON_PRODUCT';
  if (input.terminalOutcome === 'discarded_source_incomplete') return 'EXPECTED_SOURCE_INCOMPLETE';
  if (input.predictedOutcome !== 'blocked') return 'EXPECTED_PUBLISHABLE';
  return 'EXPECTED_REVIEW_REQUIRED';
}

async function loadBenchmarkCasesStep(input: ProductRegistrationBenchmarkV2WorkflowInput): Promise<BenchmarkSourceCase[]> {
  'use step';
  assertProductRegistrationEngineReleaseManifest(input.releaseManifest);
  if (input.termsPolicy.policy_hash !== input.releaseManifest.termsPolicyHash || !input.termsPolicy.has_cancellation_policy) {
    throw new FatalError('BENCHMARK_TERMS_POLICY_MISMATCH');
  }
  const supabase = db();
  const { data, error } = await supabase.rpc('get_product_registration_benchmark_run_cases_v2', {
    p_tenant_id: input.tenantId,
    p_benchmark_run_id: input.benchmarkRunId,
  });
  if (error) throw error;
  if (!Array.isArray(data) || data.length === 0) throw new FatalError('BENCHMARK_FROZEN_CORPUS_EMPTY');
  return data.map(parseSourceCase);
}

async function runBenchmarkSourceStep(
  input: ProductRegistrationBenchmarkV2WorkflowInput,
  source: BenchmarkSourceCase,
): Promise<BenchmarkCaseResult[]> {
  'use step';
  const supabase = db();
  const { data: blob, error: downloadError } = await supabase.storage.from(source.storageBucket).download(source.storagePath);
  if (downloadError || !blob) throw downloadError ?? new Error('BENCHMARK_SOURCE_DOWNLOAD_FAILED');
  const buffer = Buffer.from(await blob.arrayBuffer());
  if (sha256Hex(buffer) !== source.sourceHash) throw new FatalError('BENCHMARK_SOURCE_HASH_MISMATCH');

  let extractionSucceeded = false;
  let parserFallbackUsed = false;
  let parserDisagreement = false;
  let predictedSections: Array<Record<string, unknown>> = [];
  let canonicalSections: Awaited<ReturnType<typeof buildCanonicalNormalization>>['sections'] = [];
  let sourceTexts: string[] = [];
  let predictedOutcomes: ProductRegistrationBenchmarkCase['predictedOutcome'][] = [];
  let predictedTerminalOutcomes: NonNullable<ProductRegistrationBenchmarkCase['predictedTerminalOutcome']>[] = [];
  let documentClass = 'corrupt';
  let errorMessage: string | null = null;

  try {
    const documentIr = await extractSourceDocumentToIR({
      buffer,
      filename: source.originalFilename,
      sourceType: source.sourceType,
    });
    extractionSucceeded = true;
    parserFallbackUsed = documentIr.assets.some(asset => asset.id === 'rhwp-native-fallback');
    const classification = classifyProductSourceDocument({ sourceType: source.sourceType, documentIr });
    documentClass = classification.documentClass;
    if (classification.documentClass === 'travel_product') {
      const normalization = await buildCanonicalNormalization({
        allowEvidenceAiSegmentation: true,
        documentIr,
        sourceDocumentId: source.sourceDocumentId,
        extractionId: `benchmark:${input.benchmarkRunId}:${source.corpusSourceId}`,
        sourceDepartureYearContext: source.sourceDepartureYear == null ? null : {
          year: source.sourceDepartureYear,
          authority: 'authenticated_admin',
          version: PRODUCT_SOURCE_DEPARTURE_YEAR_CONTEXT_VERSION,
        },
        departureDateReference: {
          referenceDate: input.releaseManifest.referenceDate,
          rollingInferenceEligible: true,
        },
      });
      canonicalSections = normalization.sections;
      predictedSections = normalization.canonicalPayload.sections;
      sourceTexts = normalization.sections.map(section => section.rawText);
      const decisions = predictedSections.map((section, sectionIndex) => evaluateProductRegistrationV6Policy({
        canonicalPayload: { sections: [section] },
        sourceTexts: [sourceTexts[sectionIndex] ?? documentIr.text],
        sourceHash: source.sourceHash,
        expectedSourceHash: source.sourceHash,
        cancellationCoverage: [{
          revisionId: `benchmark:${input.benchmarkRunId}:${source.corpusSourceId}:${sectionIndex}`,
          catalogProductId: `benchmark:${source.corpusSourceId}:${sectionIndex}`,
          covered: true,
          policyHash: input.termsPolicy.policy_hash,
        }],
      }));
      predictedOutcomes = decisions.map(decision => decision.outcome);
      predictedTerminalOutcomes = decisions.map(decision => decision.terminalOutcome);
    } else {
      predictedOutcomes = source.groundTruthSections.map(() => 'blocked');
      predictedTerminalOutcomes = source.groundTruthSections.map(() => terminalOutcomeForDocumentClass(documentClass));
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
    parserDisagreement = errorMessage.includes('HWP_PARSER_CRITICAL_VALUE_CONFLICT');
    predictedOutcomes = source.groundTruthSections.map(() => 'blocked');
    predictedTerminalOutcomes = source.groundTruthSections.map(() => terminalOutcomeForDocumentClass(documentClass));
  }

  const truthSections = source.groundTruthSections.map(row => row.groundTruth);
  const segmentation = source.expectedDocumentClass === 'travel_product'
    ? extractionSucceeded && documentClass === 'travel_product'
      ? compareCanonicalSectionSequenceToGroundTruth({ canonicalSections, groundTruthSections: truthSections })
      : { exact: false, diffs: [`DOCUMENT_CLASS:${documentClass}`] }
    : {
        exact: documentClass === source.expectedDocumentClass,
        diffs: documentClass === source.expectedDocumentClass
          ? []
          : [`DOCUMENT_CLASS:${source.expectedDocumentClass}->${documentClass}`],
      };
  const results: BenchmarkCaseResult[] = [];
  for (const row of source.groundTruthSections) {
    const sectionIndex = row.sectionIndex;
    const predictedOutcome = predictedOutcomes[sectionIndex] ?? 'blocked';
    const predictedTerminalOutcome = predictedTerminalOutcomes[sectionIndex] ?? 'blocked_action_required';
    const predictedExpectedOutcome = benchmarkOutcomeForPrediction({ predictedOutcome, terminalOutcome: predictedTerminalOutcome });
    const expectedSourceIncompleteDiscard = row.groundTruth.sourceSalePricePresent === false;
    const publicationEligible = source.expectedDocumentClass === 'travel_product'
      && row.groundTruth.sourceSalePricePresent;
    const expectedTerminalOutcome = source.expectedDocumentClass === 'travel_product'
      ? expectedSourceIncompleteDiscard ? 'discarded_source_incomplete' as const : undefined
      : terminalOutcomeForDocumentClass(source.expectedDocumentClass);
    const comparison = source.expectedDocumentClass === 'travel_product'
      ? compareCanonicalSectionToGroundTruth({
          rawSection: predictedSections[sectionIndex] ?? {},
          sourceText: sourceTexts[sectionIndex] ?? '',
          groundTruth: row.groundTruth,
          predictedOutcome,
          expectedSourceIncompleteDiscard,
          standardCancellationPolicyApplied: true,
        })
      : {
          criticalFalsePublish: predictedOutcome !== 'blocked',
          criticalFieldCount: 1,
          criticalExactCount: segmentation.exact ? 1 : 0,
          fieldDiffs: segmentation.exact ? [] : [{
            field: 'document_class', criticality: 'hard' as const,
            missing: [source.expectedDocumentClass], unexpected: [documentClass],
          }],
        };
    const result: BenchmarkCaseResult = {
      caseId: `${source.corpusSourceId}:${sectionIndex}`,
      groundTruthSectionId: row.groundTruthSectionId,
      corpusSourceId: source.corpusSourceId,
      inputKind: source.inputKind,
      extractionSucceeded,
      segmentExact: segmentation.exact,
      predictedOutcome,
      predictedTerminalOutcome,
      expectedOutcome: row.groundTruth.expectedOutcome,
      predictedExpectedOutcome,
      criticalSourceSpanExact: segmentation.exact
        && comparison.criticalExactCount === comparison.criticalFieldCount,
      expectedTerminalOutcome,
      publicationEligible,
      expectedSourceIncompleteDiscard,
      criticalFalsePublish: comparison.criticalFalsePublish,
      criticalFieldCount: comparison.criticalFieldCount,
      criticalExactCount: comparison.criticalExactCount,
      parserFallbackUsed,
      parserDisagreement,
      lineageHash: source.lineageHash,
      split: 'frozen',
      supplierKey: source.supplierKey,
      documentFamily: source.documentFamily,
      doubleReviewed: true,
      firstReviewHash: 'persisted-double-review',
      secondReviewHash: 'persisted-double-review',
      adjudicationHash: null,
      fieldDiffs: [
        ...segmentation.diffs.map(field => ({ field, criticality: 'hard', missing: [], unexpected: [] })),
        ...comparison.fieldDiffs,
      ],
    };
    const { error: persistError } = await supabase.rpc('persist_product_registration_benchmark_case_v2', {
      p_tenant_id: input.tenantId,
      p_benchmark_run_id: input.benchmarkRunId,
      p_payload: {
        corpusSourceId: source.corpusSourceId,
        groundTruthSectionId: row.groundTruthSectionId,
        inputKind: source.inputKind,
        buildId: input.releaseManifest.gitCommit,
        parserVersion: PRODUCT_REGISTRATION_V4_NORMALIZATION_VERSION,
        profileVersion: input.releaseManifest.supplierProfileVersion,
        policyVersion: PRODUCT_REGISTRATION_V6_POLICY_VERSION,
        predictedOutcome,
        extractionSucceeded,
        segmentExact: segmentation.exact,
        safeOpen: extractionSucceeded && segmentation.exact && predictedOutcome !== 'blocked' && !comparison.criticalFalsePublish,
        criticalFalsePublish: comparison.criticalFalsePublish,
        criticalFieldCount: comparison.criticalFieldCount,
        criticalExactCount: comparison.criticalExactCount,
        parserFallbackUsed,
        parserDisagreement,
        expectedOutcome: row.groundTruth.expectedOutcome,
        predictedExpectedOutcome,
        outcomeExact: row.groundTruth.expectedOutcome === predictedExpectedOutcome,
        criticalSourceSpanExact: result.criticalSourceSpanExact,
        fieldDiffs: result.fieldDiffs,
        metrics: {
          predictedTerminalOutcome,
          expectedOutcome: row.groundTruth.expectedOutcome,
          predictedExpectedOutcome,
          expectedTerminalOutcome: expectedTerminalOutcome ?? null,
          publicationEligible,
          expectedDocumentClass: source.expectedDocumentClass,
          documentClass,
          error: errorMessage,
        },
      },
    });
    if (persistError) throw persistError;
    results.push(result);
  }
  return results;
}

async function finalizeBenchmarkRunStep(
  input: ProductRegistrationBenchmarkV2WorkflowInput,
  cases: BenchmarkCaseResult[],
): Promise<{ passed: boolean; summary: ReturnType<typeof summarizeProductRegistrationBenchmark>; cohortMinimumRate: number }> {
  'use step';
  const summary = summarizeProductRegistrationBenchmark(cases);
  const cohorts = majorCohortSafeOpenRate({ cases });
  const passed = benchmarkMeetsCustomerOpenGate({
    summary,
    frozenSectionCount: cases.length,
    majorCohortMinimumRate: cohorts.minimumRate,
  });
  const supabase = db();
  const { error } = await supabase.rpc('finalize_product_registration_benchmark_run_v2', {
    p_tenant_id: input.tenantId,
    p_benchmark_run_id: input.benchmarkRunId,
    p_summary: {
      ...summary,
      cohortMinimumRate: cohorts.minimumRate,
      eligibleCohortCount: cohorts.eligibleCohortCount,
      releaseManifest: input.releaseManifest,
    },
    p_passed: passed,
  });
  if (error) throw error;
  return { passed, summary, cohortMinimumRate: cohorts.minimumRate };
}

export async function productRegistrationBenchmarkV2Workflow(
  input: ProductRegistrationBenchmarkV2WorkflowInput,
): Promise<{ benchmarkRunId: string; passed: boolean; sampleCount: number; safeOpenRate: number }> {
  'use workflow';
  const sources = await loadBenchmarkCasesStep(input);
  const allCases: BenchmarkCaseResult[] = [];
  const batchSize = 8;
  for (let index = 0; index < sources.length; index += batchSize) {
    const batch = sources.slice(index, index + batchSize);
    const batchResults = await Promise.all(batch.map(source => runBenchmarkSourceStep(input, source)));
    allCases.push(...batchResults.flat());
  }
  const finalized = await finalizeBenchmarkRunStep(input, allCases);
  return {
    benchmarkRunId: input.benchmarkRunId,
    passed: finalized.passed,
    sampleCount: finalized.summary.sampleCount,
    safeOpenRate: finalized.summary.safeOpenRate,
  };
}
