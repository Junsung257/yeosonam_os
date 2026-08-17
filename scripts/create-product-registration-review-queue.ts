import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  assertApprovedBenchmarkCancellationPolicy,
  type ApprovedBenchmarkCancellationPolicy,
} from '@/lib/product-registration-v6/benchmark-policy';

type CorpusEntry = {
  sourcePath: string;
  filename: string;
  sourceHash: string | null;
  lineageHash: string;
  split: 'development' | 'calibration' | 'frozen';
  duplicateOf: string | null;
  documentClass: string;
};

type CorpusManifest = {
  schemaVersion: string;
  entries?: CorpusEntry[];
};

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function main(): Promise<void> {
  const manifestPath = resolve(arg('--manifest') ?? (() => { throw new Error('CORPUS_MANIFEST_REQUIRED'); })());
  const outputPath = resolve(arg('--out', 'C:/Users/admin/Downloads/코덱스테스트/product-registration-review-queue.json')!);
  const policyPath = arg('--policy');
  const split = arg('--split', 'development');
  if (!['development', 'calibration', 'frozen'].includes(split ?? '')) throw new Error('REVIEW_QUEUE_SPLIT_INVALID');
  const manifest = JSON.parse((await readFile(manifestPath)).toString('utf8')) as CorpusManifest;
  if (manifest.schemaVersion !== 'product-registration-private-corpus-1') throw new Error('CORPUS_MANIFEST_SCHEMA_INVALID');
  let approvedCancellationPolicy: ApprovedBenchmarkCancellationPolicy | null = null;
  if (policyPath) {
    const policyArtifact = JSON.parse((await readFile(resolve(policyPath))).toString('utf8')) as {
      schemaVersion?: string;
      policy?: unknown;
    };
    if (policyArtifact.schemaVersion !== 'product-registration-approved-cancellation-policy-1') {
      throw new Error('BENCHMARK_CANCELLATION_POLICY_ARTIFACT_INVALID');
    }
    assertApprovedBenchmarkCancellationPolicy(policyArtifact.policy);
    approvedCancellationPolicy = policyArtifact.policy;
  }

  const cases = (manifest.entries ?? [])
    .filter(entry => !entry.duplicateOf)
    .filter(entry => entry.documentClass === 'travel_product')
    .filter(entry => entry.split === split)
    .map(entry => ({
      caseId: `hwp:${entry.sourceHash}`,
      sourcePath: entry.sourcePath,
      sourceHash: entry.sourceHash,
      lineageHash: entry.lineageHash,
      inputKind: 'hwp' as const,
      pasteOrigin: null,
      split: entry.split,
      filename: entry.filename,
      supplierKey: null,
      documentFamily: null,
      approvedCancellationPolicyHash: approvedCancellationPolicy?.policy_hash ?? null,
      first: null,
      second: null,
      adjudicator: null,
    }));
  if (cases.some(item => !item.sourceHash)) throw new Error('REVIEW_QUEUE_SOURCE_HASH_MISSING');

  const queue = {
    schemaVersion: 'product-registration-review-queue-1',
    corpusVersion: `${manifestPath}#${split}`,
    generatedAt: new Date().toISOString(),
    privateArtifact: true,
    engineOutputsIncluded: false,
    approvedCancellationPolicy,
    reviewerInstructions: [
      '원문만 보고 상품 구간과 필드를 작성합니다.',
      '엔진 prelabel 또는 이전 등록 상품값을 열람하지 않습니다.',
      'first와 second는 서로 다른 검수자가 독립 작성합니다.',
      '두 결과가 다를 때만 adjudicator가 원문을 다시 확인합니다.',
      '각 상품 구간마다 성인 기준 판매가가 원문에 실제로 있는지 sourceSalePricePresent=true/false로 반드시 판정합니다.',
      '가격표·특가 축약·공통 요금표가 있으면 판매가 없음으로 판정하지 않습니다.',
      '원문·파일명에 출발연도가 없지만 업로드 시 확인 가능한 단일 연도가 있으면 annotation.sourceDepartureYear에 4자리로 기록합니다. 추정하거나 현재연도를 자동 입력하지 않습니다.',
    ],
    cases,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(queue, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ outputPath, split, caseCount: cases.length, engineOutputsIncluded: false }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
