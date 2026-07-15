import { supabaseAdmin } from './supabase';
import {
  validateBlogInformationClaims,
  type BlogInformationClaimEvidenceRecord,
  type BlogInformationClaimValidationReport,
  type PersistedBlogInformationClaimRecord,
} from './blog-information-claim-validator';
import type {
  BlogInformationAuthorityLevel,
  BlogInformationClaimType,
  BlogInformationEvidenceScope,
  BlogInformationExtractedValue,
} from './blog-information-evidence';
import type { BlogInformationClaimLedgerEntry } from './blog-information-claim-ledger';
import { createBlogInformationContentFingerprint } from './blog-information-review-workflow';

export const BLOG_INFORMATION_CLAIM_AUTO_REGENERATION_LIMIT = 0;

export interface BlogInformationClaimPublishGateInput {
  creativeId?: string | null;
  contentKey: string;
  markdown: string;
  productId?: string | null;
  reviewStatus?: string | null;
  tenantId?: string | null;
  now?: Date;
  claimLedger?: BlogInformationClaimLedgerEntry[];
  claimLedgerIssues?: string[];
  intentType?: string | null;
  approvalValidation?: boolean;
  expectedScope?: Partial<Pick<BlogInformationEvidenceScope, 'country' | 'destination' | 'applicableTo' | 'locale'>>;
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
    ledger: result.ledger ?? null,
    auto_regeneration_attempts: 0,
    auto_regeneration_limit: BLOG_INFORMATION_CLAIM_AUTO_REGENERATION_LIMIT,
    ...(result.lookupError ? { lookup_error: result.lookupError } : {}),
    ...(result.skipped ? { skipped: result.skipped } : {}),
  };
}

async function applyDurableReviewStateGate(input: {
  creativeId?: string | null;
  markdown: string;
  contentKey: string;
  reviewStatus?: string | null;
  approvalValidation?: boolean;
  report: BlogInformationClaimValidationReport;
}): Promise<BlogInformationClaimValidationReport> {
  if (!input.creativeId) return input.report;
  const { data: reviewCase, error: caseError } = await supabaseAdmin
    .from('blog_information_review_cases')
    .select('status, risk_level, content_fingerprint')
    .eq('creative_id', input.creativeId)
    .maybeSingle();
  if (caseError) throw new Error(`blog_information_review_case_lookup_failed:${caseError.message}`);

  const needsDurableHumanReview = input.report.requiresHumanReview && input.reviewStatus === 'approved';
  if (!reviewCase) {
    if (!needsDurableHumanReview) return input.report;
    return {
      ...input.report,
      passed: false,
      issues: [...input.report.issues, {
        code: 'review_state_required',
        claimFingerprint: input.report.claims[0]?.claimFingerprint
          ?? createBlogInformationContentFingerprint({ blogHtml: input.markdown, slug: input.contentKey }),
        claimType: input.report.claims[0]?.claimType ?? 'factual',
        message: '고위험 정보성 글은 본문 지문과 근거를 고정한 검토 케이스가 필요합니다.',
      }],
    };
  }

  const { data: creative, error: creativeError } = await supabaseAdmin
    .from('content_creatives')
    .select('seo_title, seo_description, slug')
    .eq('id', input.creativeId)
    .single();
  if (creativeError || !creative) {
    throw new Error(`blog_information_review_creative_lookup_failed:${creativeError?.message || 'not_found'}`);
  }
  const fingerprint = createBlogInformationContentFingerprint({
    blogHtml: input.markdown,
    seoTitle: creative.seo_title,
    seoDescription: creative.seo_description,
    slug: creative.slug,
  });
  const issues = [...input.report.issues];
  const claim = input.report.claims[0];
  if (fingerprint !== reviewCase.content_fingerprint) {
    issues.push({
      code: 'review_fingerprint_mismatch',
      claimFingerprint: claim?.claimFingerprint ?? fingerprint,
      claimType: claim?.claimType ?? 'factual',
      message: '검토 후 본문 또는 공개 메타데이터가 변경되어 재승인이 필요합니다.',
    });
  }
  if (!input.approvalValidation) {
    const publishableState = reviewCase.status === 'ready' || reviewCase.status === 'approved';
    const highRiskApproved = reviewCase.risk_level !== 'HIGH' || reviewCase.status === 'approved';
    if (!publishableState || !highRiskApproved) {
      issues.push({
        code: 'review_state_required',
        claimFingerprint: claim?.claimFingerprint ?? fingerprint,
        claimType: claim?.claimType ?? 'factual',
        message: `현재 정보 검토 상태로는 발행할 수 없습니다: ${reviewCase.status}`,
      });
    }
  }
  return { ...input.report, passed: issues.length === 0, issues };
}

async function loadPersistedClaimRecords(
  creativeId: string,
): Promise<{ records: PersistedBlogInformationClaimRecord[]; error?: string }> {
  const { data: claims, error: claimsError } = await supabaseAdmin
    .from('blog_information_claims')
    .select('id, claim_fingerprint, claim_text, claim_type, extracted_value, validation_status')
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
        .select('id, evidence_key, source_id, source_version_id, excerpt, scope, claim_type, observed_at, valid_until')
        .in('id', evidenceIds)
    : { data: [], error: null };
  if (evidenceError) return { records: [], error: evidenceError.message };

  const sourceIds = [...new Set((evidence ?? []).map((item) => item.source_id))];
  const sourceVersionIds = [...new Set(
    (evidence ?? [])
      .map((item) => item.source_version_id)
      .filter((id): id is string => Boolean(id)),
  )];
  const { data: sourceVersions, error: sourceVersionsError } = sourceVersionIds.length > 0
    ? await supabaseAdmin
        .from('blog_information_source_versions')
        .select('id, source_id, authority_level, retrieved_at, valid_until, status')
        .in('id', sourceVersionIds)
    : { data: [], error: null };
  if (sourceVersionsError) return { records: [], error: sourceVersionsError.message };
  const { data: sources, error: sourcesError } = sourceIds.length > 0
    ? await supabaseAdmin
        .from('blog_information_sources')
        .select('id, authority_level, retrieved_at, valid_until, status')
        .in('id', sourceIds)
    : { data: [], error: null };
  if (sourcesError) return { records: [], error: sourcesError.message };

  const sourceById = new Map((sources ?? []).map((source) => [source.id, source]));
  const sourceVersionById = new Map((sourceVersions ?? []).map((version) => [version.id, version]));
  const evidenceById = new Map((evidence ?? []).map((item) => {
    const pinnedVersion = item.source_version_id
      ? sourceVersionById.get(item.source_version_id)
      : null;
    if (pinnedVersion && pinnedVersion.source_id !== item.source_id) return [item.id, null] as const;
    const source = pinnedVersion ?? sourceById.get(item.source_id);
    if (!source) return [item.id, null] as const;
    const record: BlogInformationClaimEvidenceRecord = {
      evidenceKey: item.evidence_key,
      sourceVersionId: item.source_version_id,
      claimType: item.claim_type as BlogInformationClaimType,
      observedAt: item.observed_at,
      validUntil: item.valid_until,
      excerpt: item.excerpt,
      scope: item.scope as BlogInformationEvidenceScope,
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
      claimText: claim.claim_text,
      claimType: claim.claim_type as BlogInformationClaimType,
      extractedValue: claim.extracted_value as unknown as BlogInformationExtractedValue,
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

  try {
    const loaded = input.creativeId
      ? await loadPersistedClaimRecords(input.creativeId)
      : { records: [] as PersistedBlogInformationClaimRecord[] };
    const inferredIntent = input.intentType
      ?? (/여행자?\s*보험|보험\s*(?:보장|면책|가입|청구)/i.test(input.markdown)
        ? 'travel_insurance'
        : /입국|출입국|비자|여권|세관|면세|전자여행허가|ETA|ESTA/i.test(input.markdown)
          ? 'entry_requirements'
          : null);
    const report = validateBlogInformationClaims({
      markdown: input.markdown,
      persistedClaims: loaded.records,
      claimLedger: input.claimLedger,
      claimLedgerIssues: input.claimLedgerIssues,
      intentType: inferredIntent,
      expectedScope: input.expectedScope,
      reviewStatus: input.reviewStatus,
      now: input.now,
    });
    if (loaded.error) return { ...report, passed: false, lookupError: loaded.error };
    return await applyDurableReviewStateGate({
      creativeId: input.creativeId,
      markdown: input.markdown,
      contentKey: input.contentKey,
      reviewStatus: input.reviewStatus,
      approvalValidation: input.approvalValidation,
      report,
    });
  } catch (error) {
    const report = validateBlogInformationClaims({
      markdown: input.markdown,
      persistedClaims: null as unknown as PersistedBlogInformationClaimRecord[],
    });
    return {
      ...report,
      passed: false,
      lookupError: error instanceof Error ? error.message : 'unknown_claim_validator_error',
    };
  }
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
      extracted_value: claim.extractedValue,
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
