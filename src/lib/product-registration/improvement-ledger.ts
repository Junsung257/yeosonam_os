import { createHash } from 'node:crypto';
import type { SourceEvidenceSpan, StandardProductRegistrationObject } from './types';

export type ImprovementFinalStatus = 'PASS' | 'AUTO_FIXED' | 'REVIEW_NEEDED' | 'BLOCKED';

export type ImprovementAuditStatus = 'pass' | 'warn' | 'fail' | 'unknown';

export type AutoFixKind = 'deterministic' | 'schema_fallback' | 'manual_review_candidate';

export type ImprovementAttemptPhase =
  | 'normal_registration'
  | 'deterministic_source_recompare'
  | 'render_payload_audit_repair'
  | 'final_reregistration_deliverability_audit';

export type AutoFixRecord = {
  field: string;
  kind: AutoFixKind;
  reason: string;
  before?: unknown;
  after?: unknown;
  confidence: number;
};

export type RenderAuditResult = {
  status: ImprovementAuditStatus;
  failures: string[];
  warnings: string[];
};

export type ImprovementLedgerEvent = {
  uploadId: string | null;
  productId: string | null;
  packageId: string | null;
  attemptNo: number;
  attemptPhase: ImprovementAttemptPhase;
  rawTextHash: string;
  sectionRawTextHash: string | null;
  parserVersion: string;
  detectedFormat: string;
  blockersBefore: string[];
  blockersAfter: string[];
  normalizedBlockerSignatures: string[];
  evidenceSpans: SourceEvidenceSpan[];
  comparedFields: string[];
  autoFixesApplied: AutoFixRecord[];
  packagesAudit: RenderAuditResult;
  a4Audit: RenderAuditResult;
  finalStatus: ImprovementFinalStatus;
  fixtureCandidate: boolean;
  ruleCandidate: boolean;
  createdAt: string;
};

export function hashSourceText(value: string | null | undefined): string {
  return createHash('sha256').update(value ?? '').digest('hex');
}

export function normalizeBlockerSignature(blocker: string): string {
  return blocker
    .toLowerCase()
    .replace(/\d{4}-\d{2}-\d{2}/g, '<date>')
    .replace(/\d{1,3}(?:,\d{3})+/g, '<amount>')
    .replace(/\b\d+\b/g, '<num>')
    .replace(/"[^"]+"/g, '"<quote>"')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

export function inferDetectedFormat(input: {
  rawText: string;
  registration: StandardProductRegistrationObject;
}): string {
  const raw = input.rawText;
  if (/\bPKG\s*\d+/i.test(raw)) return 'catalog_pkg';
  if (input.registration.pricing.source.includes('hotel_column_matrix')) return 'hotel_column_matrix';
  if (input.registration.pricing.source.includes('weekday_period_table')) return 'weekday_period_table';
  if (input.registration.pricing.source.includes('supplier_raw')) return 'supplier_raw_facts';
  if (/일\s*자|주요\s*행사|교통편|식\s*사/.test(raw)) return 'day_table';
  return 'unknown';
}

export function buildImprovementLedgerEvent(input: {
  uploadId?: string | null;
  productId?: string | null;
  packageId?: string | null;
  attemptNo: number;
  attemptPhase?: ImprovementAttemptPhase;
  rawText: string;
  sectionRawText?: string | null;
  parserVersion?: string | null;
  detectedFormat?: string | null;
  registration: StandardProductRegistrationObject;
  blockersBefore: string[];
  blockersAfter: string[];
  comparedFields: string[];
  autoFixesApplied?: AutoFixRecord[];
  packagesAudit: RenderAuditResult;
  a4Audit: RenderAuditResult;
  finalStatus: ImprovementFinalStatus;
  createdAt?: string;
}): ImprovementLedgerEvent {
  const normalizedBlockerSignatures = [...new Set([
    ...input.blockersBefore,
    ...input.blockersAfter,
  ].map(normalizeBlockerSignature).filter(Boolean))];
  const autoFixesApplied = input.autoFixesApplied ?? [];
  return {
    uploadId: input.uploadId ?? null,
    productId: input.productId ?? null,
    packageId: input.packageId ?? null,
    attemptNo: input.attemptNo,
    attemptPhase: input.attemptPhase ?? attemptPhaseFor(input.attemptNo),
    rawTextHash: hashSourceText(input.rawText),
    sectionRawTextHash: input.sectionRawText ? hashSourceText(input.sectionRawText) : null,
    parserVersion: input.parserVersion ?? 'product-registration-central',
    detectedFormat: input.detectedFormat ?? inferDetectedFormat({
      rawText: input.rawText,
      registration: input.registration,
    }),
    blockersBefore: input.blockersBefore,
    blockersAfter: input.blockersAfter,
    normalizedBlockerSignatures,
    evidenceSpans: input.registration.evidence.spans,
    comparedFields: [...new Set(input.comparedFields)].sort(),
    autoFixesApplied,
    packagesAudit: input.packagesAudit,
    a4Audit: input.a4Audit,
    finalStatus: input.finalStatus,
    fixtureCandidate: input.finalStatus === 'REVIEW_NEEDED' || input.finalStatus === 'BLOCKED',
    ruleCandidate: autoFixesApplied.some(fix => fix.kind === 'deterministic')
      || normalizedBlockerSignatures.length > 0,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function attemptPhaseFor(attemptNo: number): ImprovementAttemptPhase {
  if (attemptNo <= 0) return 'normal_registration';
  if (attemptNo === 1) return 'deterministic_source_recompare';
  if (attemptNo === 2) return 'render_payload_audit_repair';
  return 'final_reregistration_deliverability_audit';
}
