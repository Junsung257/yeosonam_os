import { createHash } from 'node:crypto';

import { PRODUCT_REGISTRATION_V4_NORMALIZATION_VERSION } from '@/lib/product-registration-v4/canonical-worker';
import { PRODUCT_REGISTRATION_V4_PARSER_VERSION } from '@/lib/product-registration-v4/types';

import { PRODUCT_REGISTRATION_V6_POLICY_VERSION, PRODUCT_REGISTRATION_V6_WORKFLOW_VERSION } from './types';

type JsonObject = Record<string, unknown>;

export const PRODUCT_REGISTRATION_BENCHMARK_SCHEMA_VERSION = 'product-registration-reviewed-benchmark-2' as const;
export const PRODUCT_REGISTRATION_BENCHMARK_RESULT_VERSION = 'product-registration-reviewed-benchmark-result-2' as const;

export type ProductRegistrationEngineReleaseManifest = {
  schemaVersion: 'product-registration-engine-release-1';
  gitCommit: string;
  parserVersion: string;
  normalizationVersion: string;
  workflowVersion: string;
  policyVersion: string;
  termsPolicyHash: string;
  supplierProfileVersion: string;
  referenceDate: string;
  corpusHash: string;
};

export type ProductRegistrationBenchmarkCorpusIdentity = {
  caseId: string;
  sourceHash: string;
  lineageHash: string;
  inputKind: 'hwp' | 'text';
  pasteOrigin?: string | null;
  split: 'development' | 'calibration' | 'frozen';
  supplierKey?: string | null;
  documentFamily?: string | null;
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as JsonObject)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function productRegistrationEngineReleaseHash(
  manifest: ProductRegistrationEngineReleaseManifest,
): string {
  return createHash('sha256').update(stableJson(manifest)).digest('hex');
}

export function productRegistrationBenchmarkCorpusHash(
  cases: ProductRegistrationBenchmarkCorpusIdentity[],
): string {
  const canonicalLines = cases.map(item => [
    item.caseId,
    item.sourceHash,
    item.lineageHash,
    item.inputKind,
    item.pasteOrigin ?? '',
    item.split,
    item.supplierKey ?? '',
    item.documentFamily ?? '',
  ].join('|')).sort((left, right) => left.localeCompare(right));
  return createHash('sha256').update(canonicalLines.join('\n')).digest('hex');
}

function assertIsoDate(value: string, code: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00+09:00`))) {
    throw new Error(code);
  }
}

export function assertProductRegistrationEngineReleaseManifest(
  manifest: ProductRegistrationEngineReleaseManifest,
): void {
  if (manifest.schemaVersion !== 'product-registration-engine-release-1') {
    throw new Error('PRODUCT_REGISTRATION_RELEASE_SCHEMA_INVALID');
  }
  if (!/^[0-9a-f]{7,64}$/iu.test(manifest.gitCommit)) {
    throw new Error('PRODUCT_REGISTRATION_RELEASE_COMMIT_UNPINNED');
  }
  if (manifest.parserVersion !== PRODUCT_REGISTRATION_V4_PARSER_VERSION) {
    throw new Error('PRODUCT_REGISTRATION_RELEASE_PARSER_MISMATCH');
  }
  if (manifest.normalizationVersion !== PRODUCT_REGISTRATION_V4_NORMALIZATION_VERSION) {
    throw new Error('PRODUCT_REGISTRATION_RELEASE_NORMALIZATION_MISMATCH');
  }
  if (manifest.workflowVersion !== PRODUCT_REGISTRATION_V6_WORKFLOW_VERSION) {
    throw new Error('PRODUCT_REGISTRATION_RELEASE_WORKFLOW_MISMATCH');
  }
  if (manifest.policyVersion !== PRODUCT_REGISTRATION_V6_POLICY_VERSION) {
    throw new Error('PRODUCT_REGISTRATION_RELEASE_POLICY_MISMATCH');
  }
  if (!/^[0-9a-f]{64}$/iu.test(manifest.termsPolicyHash)) {
    throw new Error('PRODUCT_REGISTRATION_RELEASE_TERMS_POLICY_UNPINNED');
  }
  if (!manifest.supplierProfileVersion.trim()) {
    throw new Error('PRODUCT_REGISTRATION_RELEASE_PROFILE_UNPINNED');
  }
  assertIsoDate(manifest.referenceDate, 'PRODUCT_REGISTRATION_RELEASE_REFERENCE_DATE_INVALID');
  if (!/^[0-9a-f]{64}$/iu.test(manifest.corpusHash)) {
    throw new Error('PRODUCT_REGISTRATION_RELEASE_CORPUS_HASH_INVALID');
  }
}

export function buildCurrentProductRegistrationEngineReleaseManifest(input: {
  gitCommit: string;
  supplierProfileVersion: string;
  referenceDate: string;
  corpusHash: string;
  termsPolicyHash: string;
}): ProductRegistrationEngineReleaseManifest {
  const manifest: ProductRegistrationEngineReleaseManifest = {
    schemaVersion: 'product-registration-engine-release-1',
    gitCommit: input.gitCommit,
    parserVersion: PRODUCT_REGISTRATION_V4_PARSER_VERSION,
    normalizationVersion: PRODUCT_REGISTRATION_V4_NORMALIZATION_VERSION,
    workflowVersion: PRODUCT_REGISTRATION_V6_WORKFLOW_VERSION,
    policyVersion: PRODUCT_REGISTRATION_V6_POLICY_VERSION,
    termsPolicyHash: input.termsPolicyHash,
    supplierProfileVersion: input.supplierProfileVersion,
    referenceDate: input.referenceDate,
    corpusHash: input.corpusHash,
  };
  assertProductRegistrationEngineReleaseManifest(manifest);
  return manifest;
}
