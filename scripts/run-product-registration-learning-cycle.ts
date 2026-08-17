import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  buildBlindLearningReviewQueue,
  createProductRegistrationLearningCycle,
  type LearningManifest,
  type LearningPromotionEvidence,
} from '@/lib/product-registration-v6/learning-loop';

type ReviewedBenchmarkResult = {
  schemaVersion: 'product-registration-reviewed-benchmark-result-1';
  frozenSectionCount: number;
  customerOpenGate: boolean;
  summary: {
    criticalExactMatchRate: number;
    criticalFalsePublishCount: number;
  };
};

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function args(name: string): string[] {
  return process.argv.flatMap((value, index) => value === name && process.argv[index + 1]
    ? [process.argv[index + 1]!]
    : []);
}

function numberArg(name: string, fallback: number): number {
  const raw = arg(name);
  if (raw == null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`LEARNING_CYCLE_NUMBER_INVALID:${name}:${raw}`);
  return value;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse((await readFile(resolve(path))).toString('utf8')) as T;
}

async function benchmarkPromotionEvidence(paths: string[]): Promise<LearningPromotionEvidence | null> {
  if (paths.length === 0) return null;
  const results = await Promise.all(paths.map(path => readJson<ReviewedBenchmarkResult>(path)));
  results.forEach(result => {
    if (result.schemaVersion !== 'product-registration-reviewed-benchmark-result-1') {
      throw new Error('LEARNING_CYCLE_BENCHMARK_RESULT_SCHEMA_INVALID');
    }
  });
  let consecutiveFrozenPasses = 0;
  for (let index = results.length - 1; index >= 0; index -= 1) {
    if (!results[index]!.customerOpenGate) break;
    consecutiveFrozenPasses += 1;
  }
  const latest = results.at(-1)!;
  return {
    reviewedFrozenSectionCount: latest.frozenSectionCount,
    criticalExactMatchRate: latest.summary.criticalExactMatchRate,
    criticalFalsePublicationCount: latest.summary.criticalFalsePublishCount,
    customerOpenGatePassed: latest.customerOpenGate,
    consecutiveFrozenPasses,
  };
}

async function main(): Promise<void> {
  const manifestPath = resolve(arg('--manifest') ?? (() => { throw new Error('LEARNING_CYCLE_MANIFEST_REQUIRED'); })());
  const previousManifestPath = arg('--previous-manifest');
  const outputPath = resolve(arg(
    '--out',
    'C:/Users/admin/Downloads/코덱스테스트/product-registration-learning-cycle.json',
  )!);
  const reviewQueuePath = resolve(arg(
    '--review-queue-out',
    'C:/Users/admin/Downloads/코덱스테스트/product-registration-active-learning-review-queue.json',
  )!);
  const silverQueuePath = resolve(arg(
    '--silver-queue-out',
    'C:/Users/admin/Downloads/코덱스테스트/product-registration-silver-candidate-queue.json',
  )!);
  const manifest = await readJson<LearningManifest>(manifestPath);
  if (manifest.schemaVersion !== 'product-registration-private-corpus-1') {
    throw new Error(`LEARNING_CYCLE_MANIFEST_SCHEMA_INVALID:${manifest.schemaVersion}`);
  }
  const previousManifest = previousManifestPath
    ? await readJson<LearningManifest>(resolve(previousManifestPath))
    : null;
  if (previousManifest && previousManifest.schemaVersion !== 'product-registration-private-corpus-1') {
    throw new Error(`LEARNING_CYCLE_PREVIOUS_MANIFEST_SCHEMA_INVALID:${previousManifest.schemaVersion}`);
  }
  const promotionEvidence = await benchmarkPromotionEvidence(args('--benchmark-result'));
  const cycle = createProductRegistrationLearningCycle({
    manifest,
    previousManifest,
    maximumReviewCases: numberArg('--max-review-cases', 60),
    maximumPerFamily: numberArg('--max-per-family', 12),
    promotionEvidence,
  });
  const reviewQueue = buildBlindLearningReviewQueue({ manifestPath, cycle });
  const silverQueue = {
    schemaVersion: 'product-registration-silver-candidate-queue-1',
    generatedAt: cycle.generatedAt,
    privateArtifact: true,
    cycleHash: cycle.cycleHash,
    groundTruthEligible: false,
    frozenCasesIncluded: false,
    requirements: [
      'Claude와 Gemini를 서로 독립적으로 호출합니다.',
      '값·적용 범위·원문 anchor ID·quote hash가 모두 일치해야 silver 후보가 됩니다.',
      '결정론 검증기가 금액·통화·날짜를 원문에서 재생하지 못하면 폐기합니다.',
      'silver 후보는 parser/profile 개발에만 사용하며 95% 정확도 분모와 고객 공개 증거로 사용하지 않습니다.',
    ],
    cases: cycle.silverCandidateCases.map(item => ({
      caseId: item.caseId,
      sourcePath: item.sourcePath,
      sourceHash: item.sourceHash,
      lineageHash: item.lineageHash,
      sectionIndex: item.sectionIndex,
      blockerFamily: item.primaryFamily,
      learningMethod: item.learningMethod,
      priorityScore: item.priorityScore,
    })),
  };
  await Promise.all([
    mkdir(dirname(outputPath), { recursive: true }),
    mkdir(dirname(reviewQueuePath), { recursive: true }),
    mkdir(dirname(silverQueuePath), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(outputPath, `${JSON.stringify(cycle, null, 2)}\n`, 'utf8'),
    writeFile(reviewQueuePath, `${JSON.stringify(reviewQueue, null, 2)}\n`, 'utf8'),
    writeFile(silverQueuePath, `${JSON.stringify(silverQueue, null, 2)}\n`, 'utf8'),
  ]);
  console.log(JSON.stringify({
    outputPath,
    reviewQueuePath,
    silverQueuePath,
    summaries: cycle.summaries,
    topClusters: cycle.clusters.slice(0, 10),
    selectedReviewSourceCount: (reviewQueue.cases as unknown[]).length,
    silverCandidateCount: silverQueue.cases.length,
    regression: cycle.regression,
    promotion: cycle.promotion,
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
