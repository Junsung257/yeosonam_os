import { supabaseAdmin } from './supabase';
import {
  validateBlogInformationResearchBundle,
  type BlogInformationResearchBundle,
} from './blog-information-evidence';

export interface PersistedBlogInformationResearch {
  sourceIds: Record<string, string>;
  evidenceIds: Record<string, string>;
  claimIds: Record<string, string>;
}

function throwPersistenceError(stage: string, error: { message?: string } | null): never {
  throw new Error(`blog_information_evidence_${stage}_failed:${error?.message || 'unknown'}`);
}

export async function persistBlogInformationResearch(
  bundle: BlogInformationResearchBundle,
): Promise<PersistedBlogInformationResearch> {
  const validation = validateBlogInformationResearchBundle(bundle);
  if (!validation.passed) {
    throw new Error(`blog_information_evidence_invalid:${validation.issues.join(',')}`);
  }

  const common = {
    tenant_id: bundle.tenantId ?? null,
  };
  const sourceRows = bundle.sources.map((source) => ({
    ...common,
    source_key: source.sourceKey,
    source_type: source.sourceType,
    authority_level: source.authorityLevel,
    source_url: source.sourceUrl ?? null,
    internal_identifier: source.internalIdentifier ?? null,
    publisher: source.publisher,
    retrieved_at: source.retrievedAt,
    valid_from: source.validFrom ?? null,
    valid_until: source.validUntil ?? null,
    destination: source.destination ?? null,
    country: source.country ?? null,
    claim_types: source.claimTypes,
    risk_level: source.riskLevel,
    reviewer_id: source.reviewerId ?? null,
    reviewed_at: source.reviewedAt ?? null,
    metadata: source.metadata ?? {},
    updated_at: new Date().toISOString(),
  }));
  const { data: persistedSources, error: sourceError } = await supabaseAdmin
    .from('blog_information_sources')
    .upsert(sourceRows, { onConflict: 'source_key' })
    .select('id, source_key');
  if (sourceError || !persistedSources) throwPersistenceError('sources', sourceError);
  const sourceIds = Object.fromEntries(
    persistedSources.map((source) => [String(source.source_key), String(source.id)]),
  );

  const evidenceRows = bundle.evidence.map((evidence) => ({
    ...common,
    content_key: bundle.contentKey,
    creative_id: bundle.creativeId ?? null,
    source_id: sourceIds[evidence.sourceKey],
    evidence_key: evidence.evidenceKey,
    source_locator: evidence.sourceLocator ?? null,
    excerpt: evidence.excerpt ?? null,
    claim_type: evidence.claimType,
    risk_level: evidence.riskLevel,
    observed_at: evidence.observedAt,
    valid_from: evidence.validFrom ?? null,
    valid_until: evidence.validUntil ?? null,
    captured_by: evidence.capturedBy ?? 'information_researcher',
    metadata: evidence.metadata ?? {},
    updated_at: new Date().toISOString(),
  }));
  const { data: persistedEvidence, error: evidenceError } = await supabaseAdmin
    .from('blog_information_evidence')
    .upsert(evidenceRows, { onConflict: 'content_key,evidence_key' })
    .select('id, evidence_key');
  if (evidenceError || !persistedEvidence) throwPersistenceError('evidence', evidenceError);
  const evidenceIds = Object.fromEntries(
    persistedEvidence.map((evidence) => [String(evidence.evidence_key), String(evidence.id)]),
  );

  const claimRows = bundle.claims.map((claim) => ({
    ...common,
    content_key: bundle.contentKey,
    creative_id: bundle.creativeId ?? null,
    claim_fingerprint: claim.claimFingerprint,
    claim_text: claim.claimText,
    claim_type: claim.claimType,
    risk_level: claim.riskLevel,
    extracted_value: claim.extractedValue ?? {},
    requires_evidence: claim.requiresEvidence,
    validation_status: 'pending',
    updated_at: new Date().toISOString(),
  }));
  const { data: persistedClaims, error: claimsError } = await supabaseAdmin
    .from('blog_information_claims')
    .upsert(claimRows, { onConflict: 'content_key,claim_fingerprint' })
    .select('id, claim_fingerprint');
  if (claimsError || !persistedClaims) throwPersistenceError('claims', claimsError);
  const claimIds = Object.fromEntries(
    persistedClaims.map((claim) => [String(claim.claim_fingerprint), String(claim.id)]),
  );

  const supportRows = bundle.claims.flatMap((claim) => claim.evidenceKeys.map((evidenceKey) => ({
    claim_id: claimIds[claim.claimFingerprint],
    evidence_id: evidenceIds[evidenceKey],
    support_type: 'supports',
  })));
  if (supportRows.length > 0) {
    const { error: linksError } = await supabaseAdmin
      .from('blog_information_claim_evidence')
      .upsert(supportRows, { onConflict: 'claim_id,evidence_id' });
    if (linksError) throwPersistenceError('links', linksError);
  }

  return { sourceIds, evidenceIds, claimIds };
}
