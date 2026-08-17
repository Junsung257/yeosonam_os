import type { SupabaseClient } from '@supabase/supabase-js';

import { buildV5ItineraryItems, buildV5PriceRules } from '@/lib/product-registration-v4/typed-projections';
import { buildCanonicalTermsRevisions } from './terms';
import { registrationDatabaseError } from './errors';

import type {
  CommittedCanonicalRevision,
  CommitCanonicalRevisionInput,
  CompatibilityProjectionBinding,
} from './types';

type RpcResult = Record<string, unknown>;

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function canonicalDepartureReferenceDate(payload: Record<string, unknown>): string | null {
  const sections = Array.isArray(payload.sections) ? payload.sections : [];
  const references = [...new Set(sections.map(section => {
    const policy = object(object(section)?.departureDatePolicy);
    return typeof policy?.referenceDate === 'string' ? policy.referenceDate : null;
  }).filter((value): value is string => Boolean(value)))];
  if (references.length > 1) throw new Error('REGISTRATION_DEPARTURE_REFERENCE_DATE_CONFLICT');
  return references[0] ?? null;
}

function assertNoPastCanonicalFacts(input: {
  referenceDate: string | null;
  priceRules: ReturnType<typeof buildV5PriceRules>;
  departures: Record<string, unknown>[];
}) {
  if (!input.referenceDate) return;
  for (const rule of input.priceRules) {
    if (rule.specificDate && rule.specificDate < input.referenceDate) {
      throw new Error('REGISTRATION_PAST_PRICE_DATE_FORBIDDEN');
    }
    if (rule.effectiveEnd && rule.effectiveEnd < input.referenceDate) {
      throw new Error('REGISTRATION_PAST_PRICE_RANGE_FORBIDDEN');
    }
    if (rule.effectiveStart && rule.effectiveStart < input.referenceDate) {
      throw new Error('REGISTRATION_UNCLIPPED_PAST_PRICE_RANGE_FORBIDDEN');
    }
  }
  for (const departure of input.departures) {
    const date = typeof departure.departure_date === 'string' ? departure.departure_date : null;
    if (date && date < input.referenceDate) {
      throw new Error('REGISTRATION_PAST_DEPARTURE_INSTANCE_FORBIDDEN');
    }
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`REGISTRATION_AUTHORITY_RESPONSE_MISSING:${field}`);
  return value;
}

export async function commitCanonicalRevisionAtomic(input: {
  supabase: SupabaseClient;
  commit: CommitCanonicalRevisionInput;
}): Promise<CommittedCanonicalRevision> {
  const { build, sections, domainProjection } = input.commit;
  if (build.tenantId !== input.commit.tenantId) throw new Error('REGISTRATION_AUTHORITY_TENANT_MISMATCH');
  if (build.packageId) throw new Error('REGISTRATION_AUTHORITY_REVISION_MUST_PRECEDE_COMPATIBILITY_PACKAGE');

  const priceRules = buildV5PriceRules({ revisionId: 'pending', canonicalPayload: build.canonicalPayload });
  const itineraryItems = buildV5ItineraryItems({ revisionId: 'pending', canonicalPayload: build.canonicalPayload });
  const terms = buildCanonicalTermsRevisions(build.canonicalPayload);
  const departureReferenceDate = canonicalDepartureReferenceDate(build.canonicalPayload);
  assertNoPastCanonicalFacts({
    referenceDate: departureReferenceDate,
    priceRules,
    departures: domainProjection.departures,
  });
  const { data, error } = await input.supabase.rpc('commit_product_registration_revision_atomic', {
    p_payload: {
      tenant_id: input.commit.tenantId,
      catalog_product_id: input.commit.catalogProductId ?? null,
      product_key: input.commit.productKey,
      source_channel: input.commit.sourceChannel,
      operation_key: input.commit.operationKey,
      identity_status: 'resolved',
      identity_metadata: {
        job_id: build.jobId,
        source_document_id: build.sourceDocumentId,
        section_keys: sections.map(section => section.sectionKey),
        departure_reference_date: departureReferenceDate,
      },
      job_id: build.jobId,
      normalization_id: build.normalizationId,
      source_document_id: build.sourceDocumentId,
      extraction_id: build.extractionId,
      // The database serializes revision numbering per catalog identity.
      // Application retries never guess a mutable next number.
      revision_no: null,
      schema_version: 'product-registration-v5-canonical-1',
      normalization_version: build.normalizationVersion,
      canonical_payload: build.canonicalPayload,
      payload_hash: build.payloadHash,
      lineage_hash: build.lineageHash,
      source_hash: build.rawTextHash,
      status: build.status,
      supersedes_revision_id: build.supersedesRevisionId ?? null,
      segments: sections.map(section => ({
        segment_index: section.index,
        section_key: section.sectionKey,
        raw_text_hash: section.rawTextHash,
        raw_text: section.rawText,
        evidence: section.evidence,
        state: build.status === 'needs_review' ? 'needs_review' : 'candidate',
      })),
      claims: build.claims.map(claim => ({
        field_path: claim.fieldPath,
        normalized_value: claim.normalizedValue,
        criticality: claim.criticality,
        extraction_method: claim.extractionMethod,
        evidence_status: claim.evidenceStatus,
        conflict_status: claim.conflictStatus,
        claim_hash: claim.claimHash,
        evidence: claim.evidence.map(evidence => ({
          source_document_id: evidence.sourceDocumentId,
          extraction_id: evidence.extractionId,
          node_id: evidence.nodeId,
          page: evidence.page ?? null,
          quote_hash: evidence.quoteHash,
          source_quote: evidence.sourceQuote ?? null,
        })),
      })),
      price_rules: priceRules.map(rule => ({
        section_index: rule.sectionIndex,
        variant_key: rule.variantKey,
        component_type: rule.componentType,
        scope: rule.scope,
        specific_date: rule.specificDate,
        effective_start: rule.effectiveStart,
        effective_end: rule.effectiveEnd,
        weekday: rule.weekday,
        amount: rule.amount,
        currency: rule.currency,
        charge_basis: rule.chargeBasis,
        inclusion: rule.inclusion,
        source_field_path: rule.sourceFieldPath,
        evidence_ref: rule.evidenceRef,
        rule_hash: rule.ruleHash,
      })),
      itinerary_items: itineraryItems.map(item => ({
        section_index: item.sectionIndex,
        variant_key: item.variantKey,
        day_index: item.dayIndex,
        sequence_no: item.sequenceNo,
        item_type: item.itemType,
        start_time: item.startTime,
        timezone: item.timezone,
        title: item.title,
        description: item.description,
        canonical_id: item.canonicalId,
        source_field_path: item.sourceFieldPath,
        evidence_ref: item.evidenceRef,
        item_hash: item.itemHash,
      })),
      departure_instances: domainProjection.departures,
      transport_segments: domainProjection.transportSegments,
      lodging_stays: domainProjection.lodgingStays,
      golf_rounds: domainProjection.golfRounds,
      terms: terms.map(row => ({
        terms_type: row.termsType,
        terms_payload: row.termsPayload,
        terms_hash: row.termsHash,
        validation_state: row.validationState,
        claim_field_paths: row.claimFieldPaths,
      })),
    },
  });
  if (error) throw registrationDatabaseError('REGISTRATION_REVISION_COMMIT_FAILED', error);
  const result = (data ?? {}) as RpcResult;
  return {
    tenantId: requiredString(result.tenant_id, 'tenant_id'),
    catalogProductId: requiredString(result.catalog_product_id, 'catalog_product_id'),
    revisionId: requiredString(result.revision_id, 'revision_id'),
    revisionHash: requiredString(result.revision_hash, 'revision_hash'),
    inserted: result.inserted === true,
    claimCount: Number(result.claim_count ?? 0),
    priceRuleCount: Number(result.price_rule_count ?? 0),
    itineraryItemCount: Number(result.itinerary_item_count ?? 0),
    domainRowCount: Number(result.domain_row_count ?? 0),
    authorityMode: requiredString(result.authority_mode, 'authority_mode') as CommittedCanonicalRevision['authorityMode'],
  };
}

export async function bindCompatibilityProjectionAtomic(input: {
  supabase: SupabaseClient;
  binding: CompatibilityProjectionBinding;
}): Promise<RpcResult> {
  const { data, error } = await input.supabase.rpc('bind_product_registration_compatibility_projection_atomic', {
    p_payload: {
      tenant_id: input.binding.tenantId,
      catalog_product_id: input.binding.catalogProductId,
      revision_id: input.binding.revisionId,
      revision_hash: input.binding.revisionHash,
      package_id: input.binding.packageId,
      internal_code: input.binding.internalCode ?? null,
      operation_key: input.binding.operationKey,
    },
  });
  if (error) throw error;
  return (data ?? {}) as RpcResult;
}

export async function projectCompatibilityFromRevisionAtomic(input: {
  supabase: SupabaseClient;
  tenantId: string;
  catalogProductId: string;
  revisionId: string;
  revisionHash: string;
  sourceHash: string;
  operationKey: string;
  projection: Record<string, unknown>;
  supplierCode: string;
  landOperator?: string | null;
  commissionRate?: number | null;
}): Promise<{ packageId: string; internalCode: string }> {
  const { data, error } = await input.supabase.rpc('project_product_registration_compatibility_atomic', {
    p_payload: {
      tenant_id: input.tenantId,
      catalog_product_id: input.catalogProductId,
      revision_id: input.revisionId,
      revision_hash: input.revisionHash,
      source_hash: input.sourceHash,
      operation_key: input.operationKey,
      supplier_code: input.supplierCode,
      land_operator: input.landOperator ?? null,
      commission_rate: input.commissionRate ?? null,
      projection: input.projection,
    },
  });
  if (error) throw error;
  const result = (data ?? {}) as RpcResult;
  return {
    packageId: requiredString(result.package_id, 'package_id'),
    internalCode: requiredString(result.internal_code, 'internal_code'),
  };
}

export async function createCandidateSnapshot(input: {
  supabase: SupabaseClient;
  row: Record<string, unknown> & {
    tenant_id: string;
    package_id: string;
    catalog_product_id: string;
    canonical_revision_id: string;
    snapshot_hash: string;
  };
}): Promise<{ snapshotId: string; inserted: boolean }> {
  const { data, error } = await input.supabase
    .from('public_package_snapshots')
    .insert(input.row)
    .select('id')
    .maybeSingle();
  if (!error && typeof data?.id === 'string') return { snapshotId: data.id, inserted: true };

  const { data: existing, error: existingError } = await input.supabase
    .from('public_package_snapshots')
    .select('id,catalog_product_id,canonical_revision_id')
    .eq('tenant_id', input.row.tenant_id)
    .eq('package_id', input.row.package_id)
    .eq('snapshot_hash', input.row.snapshot_hash)
    .maybeSingle();
  if (existingError
    || !existing
    || existing.catalog_product_id !== input.row.catalog_product_id
    || existing.canonical_revision_id !== input.row.canonical_revision_id) {
    throw error ?? existingError ?? new Error('REGISTRATION_SNAPSHOT_INSERT_FAILED');
  }
  return { snapshotId: String(existing.id), inserted: false };
}
