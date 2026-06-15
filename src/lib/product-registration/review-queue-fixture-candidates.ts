import { createHash } from 'node:crypto';
import { safeRawTextExcerpt } from '@/lib/raw-text-privacy';
import {
  classifyProductRegistrationFailure,
  type ProductRegistrationFailureCode,
  type ProductRegistrationFailureDiagnostic,
  type ProductRegistrationFailureSeverity,
} from './failure-diagnostics';

export type UploadReviewQueueFixtureRow = {
  id: string;
  created_at: string | null;
  status: string | null;
  severity: string | null;
  error_reason: string | null;
  source_filename: string | null;
  file_hash: string | null;
  normalized_content_hash: string | null;
  raw_text_chunk: string | null;
  parsed_draft_json: unknown;
  product_title: string | null;
  land_operator_id: string | null;
};

export type UploadReviewFixtureCandidate = {
  fixtureId: string;
  queueId: string;
  createdAt: string | null;
  productTitle: string | null;
  sourceFilename: string | null;
  landOperatorId: string | null;
  severity: ProductRegistrationFailureSeverity;
  codes: ProductRegistrationFailureCode[];
  diagnostics: ProductRegistrationFailureDiagnostic[];
  nextAction: string;
  rawTextHash: string | null;
  fileHash: string | null;
  normalizedContentHash: string | null;
  sourceExcerpt: string | null;
  expectedAssertions: string[];
  targetModules: string[];
  verificationCommands: string[];
};

export type UploadReviewFixtureCandidateReport = {
  generatedAt: string;
  sourceRows: number;
  candidateCount: number;
  dedupedCount: number;
  codeCounts: Record<string, number>;
  candidates: UploadReviewFixtureCandidate[];
};

const SEVERITY_RANK: Record<ProductRegistrationFailureSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function shortHash(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.length <= 16 ? value : value.slice(0, 16);
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'unknown';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function diagnosticsFromParsedDraft(value: unknown): ProductRegistrationFailureDiagnostic[] {
  const root = asRecord(value);
  const diagnosticRoot = asRecord(root?._product_registration_failure_diagnostics);
  const diagnostics = diagnosticRoot?.diagnostics;
  if (!Array.isArray(diagnostics)) return [];
  return diagnostics.filter((item): item is ProductRegistrationFailureDiagnostic => {
    const row = asRecord(item);
    return typeof row?.code === 'string'
      && typeof row?.severity === 'string'
      && typeof row?.message === 'string'
      && typeof row?.nextAction === 'string';
  });
}

function worstSeverity(diagnostics: ProductRegistrationFailureDiagnostic[]): ProductRegistrationFailureSeverity {
  return diagnostics.reduce<ProductRegistrationFailureSeverity>((worst, diagnostic) => (
    SEVERITY_RANK[diagnostic.severity] > SEVERITY_RANK[worst] ? diagnostic.severity : worst
  ), 'low');
}

function uniqueDiagnostics(
  diagnostics: ProductRegistrationFailureDiagnostic[],
): ProductRegistrationFailureDiagnostic[] {
  const seen = new Set<string>();
  const result: ProductRegistrationFailureDiagnostic[] = [];
  for (const diagnostic of diagnostics) {
    if (seen.has(diagnostic.code)) continue;
    seen.add(diagnostic.code);
    result.push(diagnostic);
  }
  return result;
}

export function expectedAssertionsForCodes(codes: ProductRegistrationFailureCode[]): string[] {
  const assertions = new Set<string>();
  for (const code of codes) {
    if (code.startsWith('PRICE_') || code === 'MODEL_PRICE_UNSUPPORTED') {
      assertions.add('source-backed product_prices are recovered');
      assertions.add('source-backed price_dates align with product_prices');
      assertions.add('model-only price extraction cannot publish');
    }
    if (code.startsWith('ITINERARY_')) {
      assertions.add('itinerary day count and sequence match the source product duration');
      assertions.add('appendix/shared catalog sections do not enter customer itinerary');
    }
    if (code === 'FLIGHT_TIME_MISMATCH') {
      assertions.add('source-backed outbound and inbound flight times are saved and renderable');
    }
    if (code === 'DESTINATION_UNRESOLVED') {
      assertions.add('destination_code resolves from title, route, and itinerary context');
    }
    if (code === 'CATALOG_SPLIT_REQUIRED' || code === 'PRODUCT_COUNT_MISMATCH') {
      assertions.add('deterministic catalog split count equals source product count');
    }
    if (code === 'MOBILE_RENDER_FAILED' || code === 'A4_RENDER_FAILED' || code === 'CUSTOMER_RENDER_BLOCKED') {
      assertions.add('mobile landing and A4 payload render without customer blockers');
    }
    if (code.startsWith('ATTRACTION_')) {
      assertions.add('customer-visible attraction cards are source-supported and destination-compatible');
    }
    if (code === 'SUPABASE_NOT_CONFIGURED' || code === 'REQUEST_SCOPE_ERROR') {
      assertions.add('background upload tooling does not depend on request-scoped runtime state');
    }
    if (code === 'PERSISTENCE_CONSTRAINT_FAILED') {
      assertions.add('travel_packages persistence payload satisfies database shape constraints');
    }
  }
  if (assertions.size === 0) assertions.add('blocker is reproduced before the fix and absent after the fix');
  return [...assertions].sort();
}

export function targetModulesForCodes(codes: ProductRegistrationFailureCode[]): string[] {
  const modules = new Set<string>([
    'src/lib/product-registration/register-product-from-raw.ts',
    'src/lib/product-registration/deliverability-gate.ts',
  ]);
  for (const code of codes) {
    if (code.startsWith('PRICE_') || code === 'MODEL_PRICE_UNSUPPORTED') {
      modules.add('src/lib/product-registration/price-recovery.ts');
      modules.add('src/lib/product-registration/price-red-team-auditor.ts');
      modules.add('src/lib/supplier-raw-deterministic-facts.ts');
    }
    if (code.startsWith('ITINERARY_')) {
      modules.add('src/lib/product-registration/itinerary-normalization.ts');
      modules.add('src/lib/parser/catalog-pre-split.ts');
    }
    if (code === 'FLIGHT_TIME_MISMATCH') {
      modules.add('src/lib/supplier-raw-deterministic-facts.ts');
      modules.add('src/lib/product-registration-v3/gate.ts');
    }
    if (code === 'DESTINATION_UNRESOLVED') {
      modules.add('src/lib/product-registration/destination-resolution.ts');
    }
    if (code === 'CATALOG_SPLIT_REQUIRED' || code === 'PRODUCT_COUNT_MISMATCH') {
      modules.add('src/lib/product-registration/catalog-split-recovery.ts');
      modules.add('src/lib/parser/catalog-pre-split.ts');
    }
    if (code.startsWith('ATTRACTION_')) {
      modules.add('src/lib/itinerary-attraction-enricher.ts');
      modules.add('scripts/audit-product-mobile-landing-readiness.mjs');
    }
    if (code === 'SUPABASE_NOT_CONFIGURED') {
      modules.add('src/lib/supabase.ts');
      modules.add('src/app/api/upload/route.ts');
    }
    if (code === 'REQUEST_SCOPE_ERROR') {
      modules.add('src/lib/product-registration/upload-product-runner.ts');
      modules.add('src/app/api/upload/route.ts');
    }
    if (code === 'PERSISTENCE_CONSTRAINT_FAILED') {
      modules.add('src/lib/product-registration/persistence-rows.ts');
      modules.add('src/lib/product-registration/upload-persistence.ts');
    }
  }
  return [...modules].sort();
}

export function buildUploadReviewFixtureCandidate(
  row: UploadReviewQueueFixtureRow,
): UploadReviewFixtureCandidate {
  const diagnostics = uniqueDiagnostics([
    ...diagnosticsFromParsedDraft(row.parsed_draft_json),
    ...classifyProductRegistrationFailure(row.error_reason),
  ]);
  const codes = diagnostics.map(diagnostic => diagnostic.code);
  const primaryCode = codes[0] ?? 'UNKNOWN_BLOCKER';
  const rawTextHash = row.raw_text_chunk ? sha256(row.raw_text_chunk) : null;
  const fixtureId = [
    'upload-review',
    row.created_at?.slice(0, 10) ?? 'undated',
    slug(row.product_title ?? row.source_filename ?? row.id),
    slug(primaryCode),
    row.id.slice(0, 8),
  ].join('-');

  return {
    fixtureId,
    queueId: row.id,
    createdAt: row.created_at,
    productTitle: row.product_title,
    sourceFilename: row.source_filename,
    landOperatorId: row.land_operator_id,
    severity: worstSeverity(diagnostics),
    codes,
    diagnostics,
    nextAction: diagnostics[0]?.nextAction ?? 'Create a regression fixture and deterministic parser fix.',
    rawTextHash,
    fileHash: shortHash(row.file_hash),
    normalizedContentHash: shortHash(row.normalized_content_hash),
    sourceExcerpt: safeRawTextExcerpt(row.raw_text_chunk, 1600),
    expectedAssertions: expectedAssertionsForCodes(codes),
    targetModules: targetModulesForCodes(codes),
    verificationCommands: [
      'npx vitest run src/lib/product-registration src/lib/parser/deterministic',
      'npm run eval:product-registration:ci',
      'npm run type-check',
      'npm run audit:product-mobile-readiness:ci',
    ],
  };
}

export function buildUploadReviewFixtureCandidateReport(input: {
  rows: UploadReviewQueueFixtureRow[];
  generatedAt?: string;
}): UploadReviewFixtureCandidateReport {
  const candidates = input.rows.map(buildUploadReviewFixtureCandidate);
  const byKey = new Map<string, UploadReviewFixtureCandidate>();
  for (const candidate of candidates) {
    const key = [
      candidate.normalizedContentHash ?? candidate.fileHash ?? candidate.rawTextHash ?? candidate.queueId,
      candidate.productTitle ?? '',
      candidate.codes.join(','),
    ].join('|');
    if (!byKey.has(key)) byKey.set(key, candidate);
  }
  const deduped = [...byKey.values()];
  const codeCounts: Record<string, number> = {};
  for (const candidate of deduped) {
    for (const code of candidate.codes) codeCounts[code] = (codeCounts[code] ?? 0) + 1;
  }

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    sourceRows: input.rows.length,
    candidateCount: deduped.length,
    dedupedCount: candidates.length - deduped.length,
    codeCounts,
    candidates: deduped,
  };
}
