import { sha256Hex } from './document-ir';
import type { CanonicalSection } from './canonical-worker';

import type { SupabaseClient } from '@supabase/supabase-js';

export const PRODUCT_REGISTRATION_V5_SCHEMA_VERSION = 'product-registration-v5-canonical-1';

export type ProductRegistrationV5RevisionStatus =
  | 'candidate'
  | 'needs_review'
  | 'verified'
  | 'approved'
  | 'published'
  | 'superseded'
  | 'blocked';

export type ProductRegistrationV5ClaimCriticality = 'critical' | 'high' | 'normal' | 'low';

export type ProductRegistrationV5Claim = {
  fieldPath: string;
  normalizedValue: unknown;
  criticality: ProductRegistrationV5ClaimCriticality;
  extractionMethod: 'deterministic';
  evidenceStatus: 'verified' | 'unverified' | 'missing' | 'conflicting';
  conflictStatus: 'none' | 'conflict';
  claimHash: string;
  evidence: Array<{
    sourceDocumentId: string;
    extractionId: string;
    nodeId: string;
    page?: number;
    quoteHash: string;
    sourceQuote?: string;
  }>;
};

export type ProductRegistrationV5RevisionBuild = {
  tenantId: string | null;
  packageId?: string | null;
  jobId: string;
  normalizationId: string;
  sourceDocumentId: string;
  extractionId: string;
  revisionNo?: number;
  normalizationVersion: string;
  canonicalPayload: Record<string, unknown>;
  rawTextHash: string;
  status: ProductRegistrationV5RevisionStatus;
  payloadHash: string;
  lineageHash: string;
  claims: ProductRegistrationV5Claim[];
  /**
   * When a canonical shadow revision was created before the compatibility
   * package existed, the first package-bound revision supersedes that
   * unbound candidate.  The old row remains append-only and non-publishable.
   */
  supersedesRevisionId?: string | null;
};

type JsonObject = Record<string, unknown>;

function sortForHash(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForHash);
  if (value && typeof value === 'object') {
    return Object.keys(value as JsonObject)
      .sort()
      .reduce<JsonObject>((result, key) => {
        const child = (value as JsonObject)[key];
        if (child !== undefined) result[key] = sortForHash(child);
        return result;
      }, {});
  }
  return value;
}

/** Stable JSON is required so rerunning a stage produces the same revision key. */
export function stableJson(value: unknown): string {
  return JSON.stringify(sortForHash(value)) ?? 'null';
}

export function criticalityForPath(fieldPath: string): ProductRegistrationV5ClaimCriticality {
  if (/(price|flight|departure|arrival|hotel|lodging|notice|cancel|refund)/i.test(fieldPath)) return 'critical';
  if (/(itinerary|day|inclusion|exclusion|option|attraction)/i.test(fieldPath)) return 'high';
  return 'normal';
}

function evidenceForSection(input: {
  section: CanonicalSection;
  sourceDocumentId: string;
  extractionId: string;
}): ProductRegistrationV5Claim['evidence'] {
  return input.section.evidence.map(item => ({
    sourceDocumentId: item.sourceDocumentId ?? input.sourceDocumentId,
    extractionId: item.extractionId ?? input.extractionId,
    nodeId: item.nodeId,
    quoteHash: item.quoteHash,
    sourceQuote: item.quote,
  }));
}

function evidenceForValue(input: {
  value: unknown;
  section: CanonicalSection;
  sourceDocumentId: string;
  extractionId: string;
}): ProductRegistrationV5Claim['evidence'] {
  const found: ProductRegistrationV5Claim['evidence'] = [];
  const seen = new Set<string>();
  const recordEvidence = (evidence: JsonObject) => {
    const sourceQuote = typeof evidence.quote === 'string' ? evidence.quote.trim() : '';
    const matchingSectionEvidence = input.section.evidence.find(item =>
      (typeof evidence.quote_hash === 'string' && item.quoteHash === evidence.quote_hash)
      || (sourceQuote && (item.quote.includes(sourceQuote) || sourceQuote.includes(item.quote))),
    );
    const nodeId = typeof evidence.node_id === 'string' && evidence.node_id.trim()
      ? evidence.node_id.trim()
      : matchingSectionEvidence?.nodeId;
    if (!sourceQuote || !nodeId) return;
    const quoteHash = typeof evidence.quote_hash === 'string' && /^[0-9a-f]{64}$/.test(evidence.quote_hash)
      ? evidence.quote_hash
      : matchingSectionEvidence?.quoteHash ?? sha256Hex(sourceQuote);
    const key = `${nodeId}:${quoteHash}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({
      sourceDocumentId: matchingSectionEvidence?.sourceDocumentId ?? input.sourceDocumentId,
      extractionId: matchingSectionEvidence?.extractionId ?? input.extractionId,
      nodeId,
      page: typeof evidence.page === 'number' ? evidence.page : undefined,
      quoteHash,
      sourceQuote,
    });
  };
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const row = value as JsonObject;
    if (Array.isArray(row.evidence)) {
      row.evidence.map(item => item && typeof item === 'object' && !Array.isArray(item) ? item as JsonObject : null)
        .filter((item): item is JsonObject => Boolean(item))
        .forEach(recordEvidence);
    } else if (row.evidence && typeof row.evidence === 'object') {
      recordEvidence(row.evidence as JsonObject);
    }
    Object.entries(row).forEach(([key, child]) => {
      if (key !== 'evidence') visit(child);
    });
  };
  visit(input.value);
  return found;
}

function pushClaim(
  claims: ProductRegistrationV5Claim[],
  fieldPath: string,
  normalizedValue: unknown,
  evidence: ProductRegistrationV5Claim['evidence'],
): void {
  if (normalizedValue === undefined || normalizedValue === null) return;
  if (Array.isArray(normalizedValue) && normalizedValue.length === 0) return;
  if (normalizedValue && typeof normalizedValue === 'object'
    && !Array.isArray(normalizedValue)
    && Object.keys(normalizedValue as JsonObject).length === 0) return;
  const claimHash = sha256Hex(stableJson({ fieldPath, normalizedValue, evidence }));
  claims.push({
    fieldPath,
    normalizedValue,
    criticality: criticalityForPath(fieldPath),
    extractionMethod: 'deterministic',
    evidenceStatus: evidence.length > 0 ? 'verified' : 'missing',
    conflictStatus: 'none',
    claimHash,
    evidence,
  });
}

function buildClaims(input: {
  canonicalPayload: Record<string, unknown>;
  sections: CanonicalSection[];
  sourceDocumentId: string;
  extractionId: string;
}): ProductRegistrationV5Claim[] {
  const claims: ProductRegistrationV5Claim[] = [];
  const payloadSections = Array.isArray(input.canonicalPayload.sections)
    ? input.canonicalPayload.sections
    : [];

  payloadSections.forEach((payloadSection, sectionIndex) => {
    const section = input.sections[sectionIndex];
    if (!payloadSection || typeof payloadSection !== 'object') return;
    const sectionEvidence = section
      ? evidenceForSection({ section, sourceDocumentId: input.sourceDocumentId, extractionId: input.extractionId })
      : [];
    const v3 = (payloadSection as JsonObject).v3;
    if (!v3 || typeof v3 !== 'object') {
      pushClaim(claims, `sections[${sectionIndex}]`, payloadSection, sectionEvidence);
      return;
    }
    const ledger = (v3 as JsonObject).ledger;
    const variants: unknown[] = ledger && typeof ledger === 'object' && Array.isArray((ledger as JsonObject).variants)
      ? (ledger as JsonObject).variants as unknown[]
      : [];
    variants.forEach((variant, variantIndex) => {
      if (!variant || typeof variant !== 'object') return;
      for (const key of ['price_calendar', 'flight_segments', 'days', 'inclusions', 'exclusions', 'options', 'standard_notices', 'minimum_departure']) {
        if (key in (variant as JsonObject)) {
          const normalizedValue = (variant as JsonObject)[key];
          pushClaim(
            claims,
            `sections[${sectionIndex}].v3.ledger.variants[${variantIndex}].${key}`,
            normalizedValue,
            evidenceForValue({
              value: normalizedValue,
              section: input.sections[sectionIndex]!,
              sourceDocumentId: input.sourceDocumentId,
              extractionId: input.extractionId,
            }),
          );
        }
      }
    });
    if ('gate_result' in (v3 as JsonObject)) {
      pushClaim(claims, `sections[${sectionIndex}].v3.gate_result`, (v3 as JsonObject).gate_result, sectionEvidence);
    }
  });

  return claims;
}

export function buildProductRegistrationV5Revision(input: {
  tenantId?: string | null;
  packageId?: string | null;
  jobId: string;
  normalizationId: string;
  sourceDocumentId: string;
  extractionId: string;
  normalization: {
    version: string;
    rawTextHash: string;
    sections: CanonicalSection[];
    canonicalPayload: {
      sections: Array<Record<string, unknown>>;
      lineage?: { attractionMasterHash?: string | null };
    };
    lineage?: { attractionMasterHash?: string | null };
    status: 'complete' | 'needs_review';
  };
  revisionNo?: number;
}): ProductRegistrationV5RevisionBuild {
  const canonicalPayload = input.normalization.canonicalPayload;
  const payloadHash = sha256Hex(stableJson({
    schemaVersion: PRODUCT_REGISTRATION_V5_SCHEMA_VERSION,
    normalizationVersion: input.normalization.version,
    canonicalPayload,
  }));
  const lineageHash = sha256Hex(stableJson({
    sourceDocumentId: input.sourceDocumentId,
    extractionId: input.extractionId,
    normalizationId: input.normalizationId,
    normalizationVersion: input.normalization.version,
    rawTextHash: input.normalization.rawTextHash,
    attractionMasterHash: input.normalization.lineage?.attractionMasterHash ?? null,
  }));
  const claims = buildClaims({
    canonicalPayload,
    sections: input.normalization.sections,
    sourceDocumentId: input.sourceDocumentId,
    extractionId: input.extractionId,
  });
  return {
    tenantId: input.tenantId ?? null,
    packageId: input.packageId ?? null,
    jobId: input.jobId,
    normalizationId: input.normalizationId,
    sourceDocumentId: input.sourceDocumentId,
    extractionId: input.extractionId,
    revisionNo: input.revisionNo ?? 1,
    normalizationVersion: input.normalization.version,
    canonicalPayload,
    rawTextHash: input.normalization.rawTextHash,
    status: input.normalization.status === 'complete' ? 'candidate' : 'needs_review',
    payloadHash,
    lineageHash,
    claims,
  };
}

type RevisionRow = { id: string };

async function findExistingRevision(supabase: SupabaseClient, build: ProductRegistrationV5RevisionBuild): Promise<RevisionRow | null> {
  let query = supabase
    .from('product_registration_v5_revisions')
    .select('id')
    .eq('normalization_id', build.normalizationId)
    .eq('payload_hash', build.payloadHash)
    .limit(1);
  query = build.packageId
    ? query.eq('package_id', build.packageId)
    : query.is('package_id', null);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return (data as RevisionRow | null) ?? null;
}

async function findUnboundRevision(
  supabase: SupabaseClient,
  build: ProductRegistrationV5RevisionBuild,
): Promise<RevisionRow | null> {
  if (!build.packageId) return null;
  const { data, error } = await supabase
    .from('product_registration_v5_revisions')
    .select('id')
    .eq('normalization_id', build.normalizationId)
    .eq('payload_hash', build.payloadHash)
    .is('package_id', null)
    .maybeSingle();
  if (error) throw error;
  return (data as RevisionRow | null) ?? null;
}

export async function nextProductRegistrationV5RevisionNo(input: {
  supabase: SupabaseClient;
  packageId?: string | null;
}): Promise<number> {
  if (!input.packageId) return 1;
  const { data, error } = await input.supabase
    .from('product_registration_v5_revisions')
    .select('revision_no')
    .eq('package_id', input.packageId)
    .order('revision_no', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const current = Number((data as { revision_no?: unknown } | null)?.revision_no ?? 0);
  return Number.isFinite(current) && current > 0 ? Math.floor(current) + 1 : 1;
}

async function persistSegments(input: {
  supabase: SupabaseClient;
  build: ProductRegistrationV5RevisionBuild;
  sections: CanonicalSection[];
}): Promise<void> {
  const { data: existingRows, error: existingError } = await input.supabase
    .from('product_registration_v5_segments')
    .select('segment_index')
    .eq('normalization_id', input.build.normalizationId);
  if (existingError) throw existingError;
  const existingIndexes = new Set((existingRows ?? []).map(row => Number((row as { segment_index: number }).segment_index)));
  const rows = input.sections
    .filter(section => !existingIndexes.has(section.index))
    .map(section => ({
      tenant_id: input.build.tenantId,
      job_id: input.build.jobId,
      normalization_id: input.build.normalizationId,
      source_document_id: input.build.sourceDocumentId,
      extraction_id: input.build.extractionId,
      segment_index: section.index,
      section_key: section.sectionKey,
      raw_text_hash: section.rawTextHash,
      raw_text: section.rawText,
      evidence: section.evidence,
      state: input.build.status === 'needs_review' ? 'needs_review' : 'candidate',
    }));
  if (rows.length === 0) return;
  const { error } = await input.supabase.from('product_registration_v5_segments').insert(rows);
  if (error) {
    // A concurrent retry may have won the unique insert. Re-read before
    // surfacing the error so the stage remains effectively-once.
    const { data: raced, error: racedError } = await input.supabase
      .from('product_registration_v5_segments')
      .select('segment_index')
      .eq('normalization_id', input.build.normalizationId);
    if (racedError || (raced ?? []).length < input.sections.length) throw error;
  }
}

export async function persistProductRegistrationV5Revision(input: {
  supabase: SupabaseClient;
  build: ProductRegistrationV5RevisionBuild;
  sections?: CanonicalSection[];
}): Promise<{ revisionId: string; inserted: boolean; claimCount: number }> {
  void input;
  throw new Error('V5_REVISION_WRITER_RETIRED_USE_COMMIT_REVISION_ATOMIC');
}
