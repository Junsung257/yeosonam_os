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
    sourceDocumentId: input.sourceDocumentId,
    extractionId: input.extractionId,
    nodeId: item.nodeId,
    quoteHash: item.quoteHash,
    sourceQuote: item.quote,
  }));
}

function pushClaim(
  claims: ProductRegistrationV5Claim[],
  fieldPath: string,
  normalizedValue: unknown,
  evidence: ProductRegistrationV5Claim['evidence'],
): void {
  if (normalizedValue === undefined) return;
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
          pushClaim(
            claims,
            `sections[${sectionIndex}].v3.ledger.variants[${variantIndex}].${key}`,
            (variant as JsonObject)[key],
            sectionEvidence,
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
  if (input.sections) {
    await persistSegments({ supabase: input.supabase, build: input.build, sections: input.sections });
  }
  const existing = await findExistingRevision(input.supabase, input.build);
  if (existing) return { revisionId: existing.id, inserted: false, claimCount: input.build.claims.length };

  // A package can be written by the V3 compatibility path after the V5
  // normalization worker has already run.  Never mutate the unbound row:
  // create a new immutable package-bound revision and keep the old row as a
  // quarantined lineage witness.  The publication RPC rejects unbound rows.
  const unbound = await findUnboundRevision(input.supabase, input.build);

  const { data: revision, error: revisionError } = await input.supabase
    .from('product_registration_v5_revisions')
    .insert({
      tenant_id: input.build.tenantId,
      package_id: input.build.packageId,
      job_id: input.build.jobId,
      normalization_id: input.build.normalizationId,
      source_document_id: input.build.sourceDocumentId,
      extraction_id: input.build.extractionId,
      revision_no: input.build.revisionNo,
      schema_version: PRODUCT_REGISTRATION_V5_SCHEMA_VERSION,
      normalization_version: input.build.normalizationVersion,
      canonical_payload: input.build.canonicalPayload,
      payload_hash: input.build.payloadHash,
      lineage_hash: input.build.lineageHash,
      status: input.build.status,
      supersedes_revision_id: unbound?.id ?? input.build.supersedesRevisionId ?? null,
    })
    .select('id')
    .single();
  if (revisionError) {
    const raced = await findExistingRevision(input.supabase, input.build);
    if (raced) return { revisionId: raced.id, inserted: false, claimCount: input.build.claims.length };
    throw revisionError;
  }

  const revisionId = String((revision as RevisionRow).id);
  if (input.build.claims.length > 0) {
    const claimRows = input.build.claims.map(claim => ({
      revision_id: revisionId,
      field_path: claim.fieldPath,
      normalized_value: claim.normalizedValue,
      criticality: claim.criticality,
      extraction_method: claim.extractionMethod,
      evidence_status: claim.evidenceStatus,
      conflict_status: claim.conflictStatus,
      claim_hash: claim.claimHash,
    }));
    const { data: insertedClaims, error: claimError } = await input.supabase
      .from('product_registration_v5_claims')
      .insert(claimRows)
      .select('id, claim_hash');
    if (claimError) throw claimError;
    const claimIds = new Map<string, string>();
    for (const row of (insertedClaims ?? []) as Array<{ id: string; claim_hash: string }>) {
      claimIds.set(row.claim_hash, row.id);
    }
    const evidenceRows = input.build.claims.flatMap(claim => {
      const claimId = claimIds.get(claim.claimHash);
      if (!claimId) return [];
      return claim.evidence.map(evidence => ({
        claim_id: claimId,
        source_document_id: evidence.sourceDocumentId,
        extraction_id: evidence.extractionId,
        node_id: evidence.nodeId,
        page: evidence.page ?? null,
        quote_hash: evidence.quoteHash,
        source_quote: evidence.sourceQuote ?? null,
      }));
    });
    if (evidenceRows.length > 0) {
      const { error: evidenceError } = await input.supabase
        .from('product_registration_v5_claim_evidence')
        .insert(evidenceRows);
      if (evidenceError) throw evidenceError;
    }
  }
  return { revisionId, inserted: true, claimCount: input.build.claims.length };
}
