import { supabaseAdmin } from './supabase';
import {
  createBlogInformationSourceVersionKey,
  validateBlogInformationResearchBundle,
  type BlogInformationResearchBundle,
} from './blog-information-evidence';
import {
  resolveBlogInformationOfficialSourceTrust,
  type BlogInformationOfficialSourceRegistryEntry,
} from './blog-information-official-source';

export interface PersistedBlogInformationResearch {
  sourceIds: Record<string, string>;
  sourceVersionIds: Record<string, string>;
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

  const officialSources = bundle.sources.filter((source) =>
    source.authorityLevel === 'official_primary' || source.authorityLevel === 'official_secondary');
  const { data: registryRows, error: registryError } = officialSources.length > 0
    ? await supabaseAdmin
        .from('blog_information_official_source_registry')
        .select('id, hostname, source_type, authority_level, allow_subdomains')
        .eq('status', 'active')
    : { data: [], error: null };
  if (registryError) throwPersistenceError('official_registry', registryError);
  const registry = (registryRows ?? []).map((row) => ({
    id: String(row.id),
    hostname: String(row.hostname),
    sourceType: row.source_type,
    authorityLevel: row.authority_level,
    allowSubdomains: Boolean(row.allow_subdomains),
  })) as BlogInformationOfficialSourceRegistryEntry[];
  const officialTrustBySourceKey = new Map(officialSources.map((source) => {
    const trust = resolveBlogInformationOfficialSourceTrust({
      sourceUrl: source.sourceUrl,
      sourceType: source.sourceType,
      registry,
    });
    if (!trust) {
      throw new Error(`blog_information_official_source_untrusted:${source.sourceKey}`);
    }
    return [source.sourceKey, trust] as const;
  }));

  const common = {
    tenant_id: bundle.tenantId ?? null,
  };
  const siteScope = bundle.siteScope?.trim().toLowerCase() || 'www.yeosonam.com';
  const sourceRows = bundle.sources.map((source) => ({
    ...common,
    source_key: source.sourceKey,
    site_scope: siteScope,
    source_type: source.sourceType,
    authority_level: source.authorityLevel,
    official_source_registry_id: officialTrustBySourceKey.get(source.sourceKey)?.registryId ?? null,
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
  const { error: sourceInsertError } = await supabaseAdmin
    .from('blog_information_sources')
    .upsert(sourceRows, {
      onConflict: 'tenant_scope_key,source_key',
      ignoreDuplicates: true,
    });
  if (sourceInsertError) throwPersistenceError('sources', sourceInsertError);
  let sourceLookup = supabaseAdmin
    .from('blog_information_sources')
    .select('id, source_key')
    .eq('site_scope', siteScope)
    .in('source_key', bundle.sources.map((source) => source.sourceKey));
  sourceLookup = bundle.tenantId
    ? sourceLookup.eq('tenant_id', bundle.tenantId)
    : sourceLookup.is('tenant_id', null);
  const { data: persistedSources, error: sourceError } = await sourceLookup;
  if (sourceError || !persistedSources) throwPersistenceError('sources', sourceError);
  const sourceIds = Object.fromEntries(
    persistedSources.map((source) => [String(source.source_key), String(source.id)]),
  );
  if (Object.keys(sourceIds).length !== bundle.sources.length) {
    throwPersistenceError('source_identity_lookup', { message: 'source_identity_count_mismatch' });
  }

  const sourceVersionRows = bundle.sources.map((source) => ({
    ...common,
    source_id: sourceIds[source.sourceKey],
    site_scope: siteScope,
    version_key: createBlogInformationSourceVersionKey(source),
    content_hash: source.contentHash.toLowerCase(),
    source_type: source.sourceType,
    authority_level: source.authorityLevel,
    official_source_registry_id: officialTrustBySourceKey.get(source.sourceKey)?.registryId ?? null,
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
    status: 'active',
    metadata: source.metadata ?? {},
  }));
  const { error: sourceVersionInsertError } = await supabaseAdmin
    .from('blog_information_source_versions')
    .upsert(sourceVersionRows, {
      onConflict: 'source_id,version_key',
      ignoreDuplicates: true,
    });
  if (sourceVersionInsertError) throwPersistenceError('source_versions', sourceVersionInsertError);
  const { data: persistedSourceVersions, error: sourceVersionError } = await supabaseAdmin
    .from('blog_information_source_versions')
    .select('id, source_id, version_key')
    .in('version_key', sourceVersionRows.map((source) => source.version_key));
  if (sourceVersionError || !persistedSourceVersions) {
    throwPersistenceError('source_version_lookup', sourceVersionError);
  }
  const versionIdByIdentity = new Map(
    persistedSourceVersions.map((version) => [
      `${String(version.source_id)}:${String(version.version_key)}`,
      String(version.id),
    ]),
  );
  const sourceVersionIds = Object.fromEntries(bundle.sources.map((source) => {
    const identity = `${sourceIds[source.sourceKey]}:${createBlogInformationSourceVersionKey(source)}`;
    return [source.sourceKey, versionIdByIdentity.get(identity) ?? ''];
  }));
  if (Object.values(sourceVersionIds).some((id) => !id)) {
    throwPersistenceError('source_version_lookup', { message: 'source_version_count_mismatch' });
  }

  const evidenceRows = bundle.evidence.map((evidence) => ({
    ...common,
    content_key: bundle.contentKey,
    creative_id: bundle.creativeId ?? null,
    source_id: sourceIds[evidence.sourceKey],
    source_version_id: sourceVersionIds[evidence.sourceKey],
    evidence_key: evidence.evidenceKey,
    logical_evidence_key: evidence.evidenceKey,
    source_locator: evidence.sourceLocator ?? null,
    excerpt: evidence.excerpt ?? null,
    claim_type: evidence.claimType,
    risk_level: evidence.riskLevel,
    observed_at: evidence.observedAt,
    valid_from: evidence.validFrom ?? null,
    valid_until: evidence.validUntil ?? null,
    scope: evidence.scope,
    captured_by: evidence.capturedBy ?? 'information_researcher',
    metadata: evidence.metadata ?? {},
    updated_at: new Date().toISOString(),
  }));
  const { data: persistedEvidence, error: evidenceError } = await supabaseAdmin
    .from('blog_information_evidence')
    .upsert(evidenceRows, { onConflict: 'content_key,logical_evidence_key,source_version_id' })
    .select('id, logical_evidence_key');
  if (evidenceError || !persistedEvidence) throwPersistenceError('evidence', evidenceError);
  const evidenceIds = Object.fromEntries(
    persistedEvidence.map((evidence) => [String(evidence.logical_evidence_key), String(evidence.id)]),
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

  return { sourceIds, sourceVersionIds, evidenceIds, claimIds };
}
