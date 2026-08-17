import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  benchmarkAnnotationHash,
  resolveReviewedBenchmarkAnnotation,
  type BenchmarkAnnotationReview,
  type ReviewedBenchmarkAnnotation,
} from '@/lib/product-registration-v6/benchmark-ground-truth';
import {
  assertApprovedBenchmarkCancellationPolicy,
  type ApprovedBenchmarkCancellationPolicy,
} from '@/lib/product-registration-v6/benchmark-policy';

type PendingReview = {
  reviewerId: string;
  engineOutputVisible: false;
  annotation: ReviewedBenchmarkAnnotation;
};

type QueueCase = {
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
  approvedCancellationPolicyHash?: string | null;
  first: PendingReview | null;
  second: PendingReview | null;
  adjudicator?: PendingReview | null;
};

type ReviewQueue = {
  schemaVersion: 'product-registration-review-queue-1';
  corpusVersion: string;
  engineOutputsIncluded: false;
  approvedCancellationPolicy?: ApprovedBenchmarkCancellationPolicy | null;
  cases: QueueCase[];
};

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function sealReview(review: PendingReview | null | undefined, slot: string): BenchmarkAnnotationReview {
  if (!review || !review.reviewerId.trim()) throw new Error(`REVIEW_SLOT_INCOMPLETE:${slot}`);
  if (review.engineOutputVisible !== false) throw new Error(`REVIEW_NOT_BLINDED:${slot}`);
  return {
    annotation: review.annotation,
    annotationHash: benchmarkAnnotationHash(review.annotation),
    blindedToEngine: true,
  };
}

async function main(): Promise<void> {
  const queuePath = resolve(arg('--queue') ?? (() => { throw new Error('REVIEW_QUEUE_REQUIRED'); })());
  const outputPath = resolve(arg('--out', 'C:/Users/admin/Downloads/코덱스테스트/product-registration-reviewed-benchmark.json')!);
  const queue = JSON.parse((await readFile(queuePath)).toString('utf8')) as ReviewQueue;
  if (queue.schemaVersion !== 'product-registration-review-queue-1' || queue.engineOutputsIncluded !== false) {
    throw new Error('REVIEW_QUEUE_SCHEMA_INVALID');
  }
  if (queue.approvedCancellationPolicy) {
    assertApprovedBenchmarkCancellationPolicy(queue.approvedCancellationPolicy);
  }

  const cases = queue.cases.map(item => {
    const expectedPolicyHash = queue.approvedCancellationPolicy?.policy_hash ?? null;
    if ((item.approvedCancellationPolicyHash ?? null) !== expectedPolicyHash) {
      throw new Error(`BENCHMARK_CANCELLATION_POLICY_CASE_MISMATCH:${item.caseId}`);
    }
    if (!item.first || !item.second) throw new Error(`DOUBLE_REVIEW_REQUIRED:${item.caseId}`);
    if (item.first.reviewerId === item.second.reviewerId) throw new Error(`INDEPENDENT_REVIEWERS_REQUIRED:${item.caseId}`);
    const first = sealReview(item.first, `${item.caseId}:first`);
    const second = sealReview(item.second, `${item.caseId}:second`);
    const adjudicator = first.annotationHash === second.annotationHash
      ? undefined
      : sealReview(item.adjudicator, `${item.caseId}:adjudicator`);
    if (item.adjudicator && [item.first.reviewerId, item.second.reviewerId].includes(item.adjudicator.reviewerId)) {
      throw new Error(`INDEPENDENT_ADJUDICATOR_REQUIRED:${item.caseId}`);
    }
    const reviews = { first, second, ...(adjudicator ? { adjudicator } : {}) };
    resolveReviewedBenchmarkAnnotation(reviews);
    return {
      caseId: item.caseId,
      sourcePath: item.sourcePath,
      rawText: item.rawText,
      sourceHash: item.sourceHash,
      lineageHash: item.lineageHash,
      inputKind: item.inputKind,
      pasteOrigin: item.pasteOrigin ?? null,
      split: item.split,
      supplierKey: item.supplierKey ?? null,
      documentFamily: item.documentFamily ?? null,
      approvedCancellationPolicyHash: item.approvedCancellationPolicyHash ?? null,
      reviews,
    };
  });

  const artifact = {
    schemaVersion: 'product-registration-reviewed-benchmark-1',
    corpusVersion: queue.corpusVersion,
    sealedAt: new Date().toISOString(),
    privateArtifact: true,
    approvedCancellationPolicy: queue.approvedCancellationPolicy ?? null,
    cases,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ outputPath, caseCount: cases.length }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
