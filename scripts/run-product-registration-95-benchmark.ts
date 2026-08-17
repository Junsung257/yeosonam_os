import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  PRODUCT_REGISTRATION_V4_NORMALIZATION_VERSION,
  buildCanonicalNormalization,
} from '@/lib/product-registration-v4/canonical-worker';
import { extractSourceDocumentToIR } from '@/lib/product-registration-v4/extractions';
import {
  assertNoLineageSplitLeakage,
  assertReviewedBenchmarkCases,
  benchmarkMeetsCustomerOpenGate,
  majorCohortSafeOpenRate,
  summarizeProductRegistrationBenchmark,
  type ProductRegistrationBenchmarkCase,
} from '@/lib/product-registration-v6/benchmark-metrics';
import {
  compareCanonicalSectionToGroundTruth,
  compareCanonicalSectionSequenceToGroundTruth,
  resolveReviewedBenchmarkAnnotation,
  type BenchmarkCaseReviewBundle,
} from '@/lib/product-registration-v6/benchmark-ground-truth';
import {
  PRODUCT_REGISTRATION_BENCHMARK_RESULT_VERSION,
  PRODUCT_REGISTRATION_BENCHMARK_SCHEMA_VERSION,
  assertProductRegistrationEngineReleaseManifest,
  productRegistrationBenchmarkCorpusHash,
  productRegistrationEngineReleaseHash,
  type ProductRegistrationEngineReleaseManifest,
} from '@/lib/product-registration-v6/engine-release-manifest';
import { classifyProductSourceDocument } from '@/lib/product-registration-v6/document-classifier';
import { evaluateRegistrationPublicationPolicy } from '@/lib/product-registration-kernel/publication-policy';
import type { ProductRegistrationV6TerminalOutcome } from '@/lib/product-registration-v6/types';
import {
  assertApprovedBenchmarkCancellationPolicy,
  type ApprovedBenchmarkCancellationPolicy,
} from '@/lib/product-registration-v6/benchmark-policy';
import { PRODUCT_SOURCE_DEPARTURE_YEAR_CONTEXT_VERSION } from '@/lib/product-registration/source-departure-year-context';

type ManifestCase = {
  caseId: string;
  sourcePath?: string;
  rawText?: string;
  sourceHash: string;
  lineageHash: string;
  inputKind: 'hwp' | 'text';
  pasteOrigin?: 'operational' | 'manual_hwp_copy' | 'generated_ir' | null;
  split: 'development' | 'calibration' | 'frozen';
  supplierKey?: string | null;
  documentFamily?: string | null;
  /** Hash of the exact approved customer-visible policy snapshot used in production. */
  approvedCancellationPolicyHash?: string | null;
  reviews: BenchmarkCaseReviewBundle;
};

function terminalOutcomeForDocumentClass(documentClass: string): ProductRegistrationV6TerminalOutcome {
  if (documentClass === 'non_travel') return 'discarded_non_travel';
  if (documentClass === 'unsupported' || documentClass === 'corrupt') return 'quarantined_unsupported_or_corrupt';
  return 'blocked_action_required';
}

type BenchmarkManifest = {
  schemaVersion: 'product-registration-reviewed-benchmark-1' | typeof PRODUCT_REGISTRATION_BENCHMARK_SCHEMA_VERSION;
  corpusVersion: string;
  releaseManifest?: ProductRegistrationEngineReleaseManifest;
  approvedCancellationPolicy?: ApprovedBenchmarkCancellationPolicy | null;
  cases: ManifestCase[];
};

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function hash(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function asSections(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(item => item && typeof item === 'object') as Array<Record<string, unknown>> : [];
}

async function sourceBytes(item: ManifestCase): Promise<Buffer> {
  if (item.inputKind === 'text') {
    if (typeof item.rawText !== 'string') throw new Error(`BENCHMARK_TEXT_SOURCE_MISSING:${item.caseId}`);
    return Buffer.from(item.rawText, 'utf8');
  }
  if (!item.sourcePath) throw new Error(`BENCHMARK_HWP_SOURCE_PATH_MISSING:${item.caseId}`);
  return readFile(resolve(item.sourcePath));
}

async function main(): Promise<void> {
  const manifestPath = resolve(arg('--manifest') ?? (() => { throw new Error('BENCHMARK_MANIFEST_REQUIRED'); })());
  const outputPath = resolve(arg('--out', 'C:/Users/admin/Downloads/코덱스테스트/product-registration-95-benchmark-result.json')!);
  const selectedSplit = hasFlag('--all') ? null : arg('--split', 'frozen');
  const strict = hasFlag('--strict');
  const buildId = arg('--build-id', process.env.VERCEL_GIT_COMMIT_SHA ?? 'local-unpinned')!;
  const manifest = JSON.parse((await readFile(manifestPath)).toString('utf8')) as BenchmarkManifest;
  const isV2 = manifest.schemaVersion === PRODUCT_REGISTRATION_BENCHMARK_SCHEMA_VERSION;
  if ((!isV2 && manifest.schemaVersion !== 'product-registration-reviewed-benchmark-1') || !Array.isArray(manifest.cases)) {
    throw new Error('BENCHMARK_MANIFEST_SCHEMA_INVALID');
  }
  const corpusHash = productRegistrationBenchmarkCorpusHash(manifest.cases.map(item => ({
    caseId: item.caseId,
    sourceHash: item.sourceHash,
    lineageHash: item.lineageHash,
    inputKind: item.inputKind,
    pasteOrigin: item.pasteOrigin ?? null,
    split: item.split,
    supplierKey: item.supplierKey ?? null,
    documentFamily: item.documentFamily ?? null,
  })));
  if (isV2) {
    if (!manifest.releaseManifest) throw new Error('BENCHMARK_RELEASE_MANIFEST_REQUIRED');
    assertProductRegistrationEngineReleaseManifest(manifest.releaseManifest);
    if (manifest.releaseManifest.corpusHash !== corpusHash) throw new Error('BENCHMARK_RELEASE_CORPUS_HASH_MISMATCH');
    if (manifest.releaseManifest.gitCommit !== buildId) throw new Error('BENCHMARK_RELEASE_BUILD_MISMATCH');
  }
  if (manifest.approvedCancellationPolicy) {
    assertApprovedBenchmarkCancellationPolicy(manifest.approvedCancellationPolicy);
  }
  const expectedPolicyHash = manifest.approvedCancellationPolicy?.policy_hash ?? null;
  for (const item of manifest.cases) {
    if ((item.approvedCancellationPolicyHash ?? null) !== expectedPolicyHash) {
      throw new Error(`BENCHMARK_CANCELLATION_POLICY_CASE_MISMATCH:${item.caseId}`);
    }
  }

  const allReviewCases: ProductRegistrationBenchmarkCase[] = manifest.cases.flatMap(item => {
    const reviewed = resolveReviewedBenchmarkAnnotation(item.reviews);
    const expectedDocumentClass = reviewed.annotation.expectedDocumentClass ?? 'travel_product';
    return reviewed.annotation.sections.map((_, sectionIndex) => ({
      caseId: `${item.caseId}:${sectionIndex}`,
      inputKind: item.inputKind,
      extractionSucceeded: false,
      segmentExact: false,
      predictedOutcome: 'blocked',
      predictedTerminalOutcome: 'blocked_action_required',
      expectedSourceIncompleteDiscard: false,
      criticalFalsePublish: false,
      criticalFieldCount: 0,
      criticalExactCount: 0,
      lineageHash: item.lineageHash,
      split: item.split,
      supplierKey: item.supplierKey,
      documentFamily: item.documentFamily,
      doubleReviewed: true,
      firstReviewHash: reviewed.firstReviewHash,
      secondReviewHash: reviewed.secondReviewHash,
      adjudicationHash: reviewed.adjudicationHash,
    }));
  });
  assertNoLineageSplitLeakage(allReviewCases);
  assertReviewedBenchmarkCases(allReviewCases);

  const selected = manifest.cases.filter(item => !selectedSplit || item.split === selectedSplit);
  if (selected.length === 0) throw new Error(`BENCHMARK_SPLIT_EMPTY:${selectedSplit ?? 'all'}`);
  const resultCases: Array<ProductRegistrationBenchmarkCase & {
    fieldDiffs: unknown[];
    error: string | null;
    documentClass: string;
    pasteOrigin: ManifestCase['pasteOrigin'];
    sourceDepartureYearContextUsed: boolean;
  }> = [];

  for (const [sourceIndex, item] of selected.entries()) {
    process.stdout.write(`\r[${sourceIndex + 1}/${selected.length}] ${item.caseId.slice(0, 70).padEnd(70)}`);
    const reviewed = resolveReviewedBenchmarkAnnotation(item.reviews);
    const expectedDocumentClass = reviewed.annotation.expectedDocumentClass ?? 'travel_product';
    let extractionSucceeded = false;
    let parserFallbackUsed = false;
    let parserDisagreement = false;
    let documentClass = 'corrupt';
    let error: string | null = null;
    let predictedSections: Array<Record<string, unknown>> = [];
    let predictedOutcomes: ProductRegistrationBenchmarkCase['predictedOutcome'][] = [];
    let predictedTerminalOutcomes: NonNullable<ProductRegistrationBenchmarkCase['predictedTerminalOutcome']>[] = [];
    let sourceTexts: string[] = [];
    let canonicalSections: Awaited<ReturnType<typeof buildCanonicalNormalization>>['sections'] = [];
    try {
      const buffer = await sourceBytes(item);
      if (hash(buffer) !== item.sourceHash) throw new Error(`BENCHMARK_SOURCE_HASH_MISMATCH:${item.caseId}`);
      const filename = item.sourcePath?.split(/[\\/]/u).at(-1) ?? `${item.caseId}.txt`;
      const documentIr = await extractSourceDocumentToIR({
        buffer,
        filename,
        sourceType: item.inputKind,
      });
      extractionSucceeded = true;
      parserFallbackUsed = documentIr.assets.some(asset => asset.id === 'rhwp-native-fallback');
      const classification = classifyProductSourceDocument({ sourceType: item.inputKind, documentIr });
      documentClass = classification.documentClass;
      if (classification.documentClass === 'travel_product') {
        if (item.approvedCancellationPolicyHash && !/^[0-9a-f]{64}$/u.test(item.approvedCancellationPolicyHash)) {
          throw new Error(`BENCHMARK_CANCELLATION_POLICY_HASH_INVALID:${item.caseId}`);
        }
        const normalization = await buildCanonicalNormalization({
          allowEvidenceAiSegmentation: true,
          documentIr,
          sourceDocumentId: `benchmark:${item.sourceHash}`,
          extractionId: `benchmark:${item.caseId}`,
          sourceDepartureYearContext: reviewed.annotation.sourceDepartureYear == null
            ? null
            : {
                year: reviewed.annotation.sourceDepartureYear,
                authority: 'authenticated_admin',
                version: PRODUCT_SOURCE_DEPARTURE_YEAR_CONTEXT_VERSION,
              },
          departureDateReference: isV2 && manifest.releaseManifest
            ? { referenceDate: manifest.releaseManifest.referenceDate, rollingInferenceEligible: true }
            : null,
        });
        canonicalSections = normalization.sections;
        predictedSections = asSections(normalization.canonicalPayload.sections);
        sourceTexts = normalization.sections.map(section => section.rawText);
        const predictedDecisions = predictedSections.map((section, index) => evaluateRegistrationPublicationPolicy({
          canonicalPayload: { sections: [section] },
          sourceTexts: [sourceTexts[index] ?? documentIr.text],
          sourceHash: item.sourceHash,
          expectedSourceHash: item.sourceHash,
          cancellationCoverage: item.approvedCancellationPolicyHash ? [{
            revisionId: `benchmark:${item.caseId}:${index}`,
            catalogProductId: `benchmark:${item.caseId}:${index}`,
            covered: true,
            policyHash: item.approvedCancellationPolicyHash,
          }] : undefined,
        }));
        predictedOutcomes = predictedDecisions.map(decision => decision.outcome);
        predictedTerminalOutcomes = predictedDecisions.map(decision => decision.terminalOutcome);
      } else {
        predictedOutcomes = reviewed.annotation.sections.map(() => 'blocked');
        predictedTerminalOutcomes = reviewed.annotation.sections.map(() => terminalOutcomeForDocumentClass(documentClass));
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
      parserDisagreement = error.includes('HWP_PARSER_CRITICAL_VALUE_CONFLICT');
      predictedOutcomes = reviewed.annotation.sections.map(() => 'blocked');
      predictedTerminalOutcomes = reviewed.annotation.sections.map(() => terminalOutcomeForDocumentClass(documentClass));
    }

    const segmentation = expectedDocumentClass === 'travel_product'
      ? extractionSucceeded && documentClass === 'travel_product'
        ? compareCanonicalSectionSequenceToGroundTruth({
            canonicalSections,
            groundTruthSections: reviewed.annotation.sections,
          })
        : { exact: false, diffs: [`DOCUMENT_CLASS:${documentClass}`] }
      : {
          exact: documentClass === expectedDocumentClass,
          diffs: documentClass === expectedDocumentClass
            ? []
            : [`DOCUMENT_CLASS:${expectedDocumentClass}->${documentClass}`],
        };
    const segmentExact = segmentation.exact;
    for (const [sectionIndex, groundTruth] of reviewed.annotation.sections.entries()) {
      const predictedOutcome = predictedOutcomes[sectionIndex] ?? 'blocked';
      const predictedTerminalOutcome = predictedTerminalOutcomes[sectionIndex] ?? 'blocked_action_required';
      const expectedSourceIncompleteDiscard = groundTruth.sourceSalePricePresent === false;
      const publicationEligible = expectedDocumentClass === 'travel_product'
        && groundTruth.sourceSalePricePresent;
      const expectedTerminalOutcome = expectedDocumentClass === 'travel_product'
        ? expectedSourceIncompleteDiscard ? 'discarded_source_incomplete' as const : undefined
        : terminalOutcomeForDocumentClass(expectedDocumentClass);
      const comparison = expectedDocumentClass === 'travel_product'
        ? compareCanonicalSectionToGroundTruth({
            rawSection: predictedSections[sectionIndex] ?? {},
            sourceText: sourceTexts[sectionIndex] ?? '',
            groundTruth,
            predictedOutcome,
            expectedSourceIncompleteDiscard,
            standardCancellationPolicyApplied: Boolean(item.approvedCancellationPolicyHash),
          })
        : {
            criticalFalsePublish: predictedOutcome !== 'blocked',
            criticalFieldCount: 1,
            criticalExactCount: segmentation.exact ? 1 : 0,
            fieldDiffs: segmentation.exact ? [] : [{
              field: 'document_class', criticality: 'hard' as const,
              missing: [expectedDocumentClass], unexpected: [documentClass],
            }],
          };
      resultCases.push({
        caseId: `${item.caseId}:${sectionIndex}`,
        inputKind: item.inputKind,
        pasteOrigin: item.pasteOrigin ?? null,
        extractionSucceeded,
        segmentExact,
        predictedOutcome,
        predictedTerminalOutcome,
        expectedTerminalOutcome,
        publicationEligible,
        expectedSourceIncompleteDiscard,
        criticalFalsePublish: comparison.criticalFalsePublish,
        criticalFieldCount: comparison.criticalFieldCount,
        criticalExactCount: comparison.criticalExactCount,
        parserFallbackUsed,
        parserDisagreement,
        lineageHash: item.lineageHash,
        split: item.split,
        supplierKey: item.supplierKey,
        documentFamily: item.documentFamily,
        doubleReviewed: true,
        firstReviewHash: reviewed.firstReviewHash,
        secondReviewHash: reviewed.secondReviewHash,
        adjudicationHash: reviewed.adjudicationHash,
        fieldDiffs: [
          ...segmentation.diffs.map(field => ({ field, criticality: 'hard', missing: [], unexpected: [] })),
          ...comparison.fieldDiffs,
        ],
        error,
        documentClass,
        sourceDepartureYearContextUsed: reviewed.annotation.sourceDepartureYear != null,
      });
    }
  }
  process.stdout.write('\n');

  assertNoLineageSplitLeakage(resultCases);
  assertReviewedBenchmarkCases(resultCases);
  const summary = summarizeProductRegistrationBenchmark(resultCases);
  const cohorts = majorCohortSafeOpenRate({ cases: resultCases });
  const hwpCases = resultCases.filter(item => item.inputKind === 'hwp');
  const pasteCases = resultCases.filter(item => item.inputKind === 'text');
  const qualifyingPasteCases = pasteCases.filter(item => (
    item.pasteOrigin === 'operational' || item.pasteOrigin === 'manual_hwp_copy'
  ));
  const parityCases = [...hwpCases, ...qualifyingPasteCases];
  const lineagesWithBoth = [...new Set(parityCases.map(item => item.lineageHash))].filter(lineage => {
    const kinds = new Set(parityCases.filter(item => item.lineageHash === lineage).map(item => item.inputKind));
    return kinds.has('hwp') && kinds.has('text');
  });
  const parityLineages = lineagesWithBoth.filter(lineage => parityCases
    .filter(item => item.lineageHash === lineage)
    .every(item => item.criticalExactCount === item.criticalFieldCount && !item.criticalFalsePublish));
  const hwpPasteParityRate = lineagesWithBoth.length > 0 ? parityLineages.length / lineagesWithBoth.length : 0;
  const frozenSectionCount = resultCases.filter(item => item.split === 'frozen').length;
  const coreGate = benchmarkMeetsCustomerOpenGate({
    summary,
    frozenSectionCount,
    majorCohortMinimumRate: cohorts.minimumRate,
  });
  const customerOpenGate = coreGate
    && isV2
    && manifest.cases.every(item => item.reviews.first.annotation.schemaVersion === PRODUCT_REGISTRATION_BENCHMARK_SCHEMA_VERSION)
    && Boolean(manifest.releaseManifest)
    && buildId !== 'local-unpinned'
    && (hwpCases.length === 0 || hwpCases.every(item => item.extractionSucceeded))
    && qualifyingPasteCases.length >= 100
    && qualifyingPasteCases.every(item => item.extractionSucceeded)
    && lineagesWithBoth.length >= 100
    && hwpPasteParityRate === 1;
  const artifact = {
    schemaVersion: PRODUCT_REGISTRATION_BENCHMARK_RESULT_VERSION,
    privateArtifact: true,
    generatedAt: new Date().toISOString(),
    manifestPath,
    corpusVersion: manifest.corpusVersion,
    corpusHash,
    selectedSplit,
    buildId,
    parserVersion: PRODUCT_REGISTRATION_V4_NORMALIZATION_VERSION,
    releaseManifest: manifest.releaseManifest ?? null,
    releaseManifestHash: manifest.releaseManifest
      ? productRegistrationEngineReleaseHash(manifest.releaseManifest)
      : null,
    summary,
    frozenSectionCount,
    cohorts,
    hwpPasteParity: {
      qualifyingPasteSectionCount: qualifyingPasteCases.length,
      comparableLineageCount: lineagesWithBoth.length,
      exactLineageCount: parityLineages.length,
      rate: hwpPasteParityRate,
    },
    inputAssistance: {
      sourceDepartureYearSectionCount: resultCases.filter(item => item.sourceDepartureYearContextUsed).length,
    },
    customerOpenGate,
    gateBlockers: [
      ...(frozenSectionCount < 400 ? [`FROZEN_HOLDOUT_TOO_SMALL:${frozenSectionCount}/400`] : []),
      ...(summary.safeOpenRate < 0.97 ? [`OBSERVED_SAFE_OPEN_RATE:${summary.safeOpenRate}`] : []),
      ...(summary.safeOpenWilsonLowerBound < 0.95 ? [`WILSON_LOWER_BOUND:${summary.safeOpenWilsonLowerBound}`] : []),
      ...(summary.criticalExactMatchRate < 0.995 ? [`CRITICAL_EXACT_MATCH:${summary.criticalExactMatchRate}`] : []),
      ...(summary.criticalFalsePublishCount > 0 ? [`CRITICAL_FALSE_PUBLISH:${summary.criticalFalsePublishCount}`] : []),
      ...(summary.falseSourceIncompleteDiscardCount > 0
        ? [`FALSE_SOURCE_INCOMPLETE_DISCARD:${summary.falseSourceIncompleteDiscardCount}`]
        : []),
      ...(summary.invalidSourcePublishedCount > 0
        ? [`INVALID_SOURCE_PUBLISHED:${summary.invalidSourcePublishedCount}`]
        : []),
      ...(summary.sourceIncompleteDiscardExactRate < 1
        ? [`SOURCE_INCOMPLETE_DISCARD_EXACT:${summary.sourceIncompleteDiscardExactRate}`]
        : []),
      ...(summary.segmentExactMatchRate < 0.995 ? [`SEGMENT_EXACT_MATCH:${summary.segmentExactMatchRate}`] : []),
      ...(summary.extractionSuccessRate < 0.995 ? [`EXTRACTION_SUCCESS:${summary.extractionSuccessRate}`] : []),
      ...(cohorts.minimumRate < 0.9 ? [`MAJOR_COHORT_MIN_RATE:${cohorts.minimumRate}`] : []),
      ...(buildId === 'local-unpinned' ? ['BUILD_ID_UNPINNED'] : []),
      ...(!isV2 ? ['BENCHMARK_V2_REQUIRED'] : []),
      ...(isV2 && !manifest.releaseManifest ? ['RELEASE_MANIFEST_REQUIRED'] : []),
      ...(qualifyingPasteCases.length < 100 ? [`PASTE_CORPUS_TOO_SMALL:${qualifyingPasteCases.length}/100`] : []),
      ...(lineagesWithBoth.length < 100 ? [`HWP_PASTE_COMPARABLE_LINEAGES_TOO_SMALL:${lineagesWithBoth.length}/100`] : []),
      ...(hwpPasteParityRate < 1 ? [`HWP_PASTE_PARITY:${hwpPasteParityRate}`] : []),
    ],
    cases: resultCases,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ outputPath, summary, cohorts, customerOpenGate, gateBlockers: artifact.gateBlockers }, null, 2));
  if (strict && !customerOpenGate) process.exitCode = 1;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
