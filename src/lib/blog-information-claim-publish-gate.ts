import { supabaseAdmin } from './supabase';
import {
  extractBlogInformationClaims,
  validateBlogInformationClaims,
  type BlogInformationClaimEvidenceRecord,
  type BlogInformationClaimValidationReport,
  type PersistedBlogInformationClaimRecord,
} from './blog-information-claim-validator';
import type {
  BlogInformationAuthorityLevel,
  BlogInformationClaimType,
} from './blog-information-evidence';

export interface BlogInformationClaimPublishGateInput {
  creativeId?: string | null;
  contentKey: string;
  markdown: string;
  productId?: string | null;
  reviewStatus?: string | null;
  tenantId?: string | null;
  now?: Date;
}

export interface BlogInformationClaimPublishGateResult extends BlogInformationClaimValidationReport {
  skipped?: 'product_content';
  lookupError?: string;
}

export function toBlogInformationClaimValidationMeta(
  result: BlogInformationClaimPublishGateResult,
): Record<string, unknown> {
  return {
    passed: result.passed,
    coverage: result.coverage,
    claim_count: result.claims.length,
    requires_human_review: result.requiresHumanReview,
    issues: result.issues.slice(0, 20),
    ...(result.lookupError ? { lookup_error: result.lookupError } : {}),
    ...(result.skipped ? { skipped: result.skipped } : {}),
  };
}

async function loadPersistedClaimRecords(
  creativeId: string,
): Promise<{ records: PersistedBlogInformationClaimRecord[]; error?: string }> {
  const { data: claims, error: claimsError } = await supabaseAdmin
    .from('blog_information_claims')
    .select('id, claim_fingerprint, claim_type, validation_status')
    .eq('creative_id', creativeId);
  if (claimsError) return { records: [], error: claimsError.message };
  if (!claims || claims.length === 0) return { records: [] };

  const claimIds = claims.map((claim) => claim.id);
  const { data: links, error: linksError } = await supabaseAdmin
    .from('blog_information_claim_evidence')
    .select('claim_id, evidence_id, support_type')
    .in('claim_id', claimIds)
    .eq('support_type', 'supports');
  if (linksError) return { records: [], error: linksError.message };

  const evidenceIds = [...new Set((links ?? []).map((link) => link.evidence_id))];
  const { data: evidence, error: evidenceError } = evidenceIds.length > 0
    ? await supabaseAdmin
        .from('blog_information_evidence')
        .select('id, evidence_key, source_id, claim_type, observed_at, valid_until')
        .in('id', evidenceIds)
    : { data: [], error: null };
  if (evidenceError) return { records: [], error: evidenceError.message };

  const sourceIds = [...new Set((evidence ?? []).map((item) => item.source_id))];
  const { data: sources, error: sourcesError } = sourceIds.length > 0
    ? await supabaseAdmin
        .from('blog_information_sources')
        .select('id, authority_level, retrieved_at, valid_until, status')
        .in('id', sourceIds)
    : { data: [], error: null };
  if (sourcesError) return { records: [], error: sourcesError.message };

  const sourceById = new Map((sources ?? []).map((source) => [source.id, source]));
  const evidenceById = new Map((evidence ?? []).map((item) => {
    const source = sourceById.get(item.source_id);
    if (!source) return [item.id, null] as const;
    const record: BlogInformationClaimEvidenceRecord = {
      evidenceKey: item.evidence_key,
      claimType: item.claim_type as BlogInformationClaimType,
      observedAt: item.observed_at,
      validUntil: item.valid_until,
      source: {
        authorityLevel: source.authority_level as BlogInformationAuthorityLevel,
        retrievedAt: source.retrieved_at,
        validUntil: source.valid_until,
        status: source.status,
      },
    };
    return [item.id, record] as const;
  }));
  const linksByClaim = new Map<string, BlogInformationClaimEvidenceRecord[]>();
  for (const link of links ?? []) {
    const record = evidenceById.get(link.evidence_id);
    if (!record) continue;
    const current = linksByClaim.get(link.claim_id) ?? [];
    current.push(record);
    linksByClaim.set(link.claim_id, current);
  }

  return {
    records: claims.map((claim) => ({
      claimFingerprint: claim.claim_fingerprint,
      claimType: claim.claim_type as BlogInformationClaimType,
      validationStatus: claim.validation_status,
      evidence: linksByClaim.get(claim.id) ?? [],
    })),
  };
}

export async function evaluateBlogInformationClaimPublishGate(
  input: BlogInformationClaimPublishGateInput,
): Promise<BlogInformationClaimPublishGateResult> {
  if (input.productId) {
    return {
      passed: true,
      claims: [],
      issues: [],
      coverage: 1,
      requiresHumanReview: false,
      skipped: 'product_content',
    };
  }

  const extracted = extractBlogInformationClaims(input.markdown);
  if (extracted.length === 0) {
    return {
      passed: true,
      claims: [],
      issues: [],
      coverage: 1,
      requiresHumanReview: false,
    };
  }

  const loaded = input.creativeId
    ? await loadPersistedClaimRecords(input.creativeId)
    : { records: [] as PersistedBlogInformationClaimRecord[] };
  const report = validateBlogInformationClaims({
    markdown: input.markdown,
    persistedClaims: loaded.records,
    reviewStatus: input.reviewStatus,
    now: input.now,
  });
  return loaded.error
    ? { ...report, passed: false, lookupError: loaded.error }
    : report;
}

export async function persistBlogInformationClaimFindings(input: {
  creativeId: string;
  contentKey: string;
  tenantId?: string | null;
  report: BlogInformationClaimValidationReport;
}): Promise<void> {
  if (input.report.claims.length === 0) return;
  const issueByFingerprint = new Map(
    input.report.issues.map((issue) => [issue.claimFingerprint, issue]),
  );
  const now = new Date().toISOString();
  const rows = input.report.claims.map((claim) => {
    const issue = issueByFingerprint.get(claim.claimFingerprint);
    return {
      tenant_id: input.tenantId ?? null,
      content_key: input.contentKey,
      creative_id: input.creativeId,
      claim_fingerprint: claim.claimFingerprint,
      claim_text: claim.claimText,
      claim_type: claim.claimType,
      risk_level: claim.riskLevel,
      requires_evidence: true,
      validation_status: issue ? 'review_required' : 'supported',
      validation_reason: issue?.code ?? null,
      updated_at: now,
    };
  });
  const { error } = await supabaseAdmin
    .from('blog_information_claims')
    .upsert(rows, { onConflict: 'content_key,claim_fingerprint' });
  if (error) throw new Error(`blog_information_claim_findings_persist_failed:${error.message}`);
}
