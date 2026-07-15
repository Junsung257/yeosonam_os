import { supabaseAdmin } from './supabase';
import { queueForReview } from './content-review-workflow';
import { persistBlogInformationResearch } from './blog-information-evidence-repository';
import {
  evaluateBlogInformationClaimPublishGate,
  toBlogInformationClaimValidationMeta,
} from './blog-information-claim-publish-gate';
import type { BlogInformationClaimValidationReport } from './blog-information-claim-validator';
import {
  createBlogInformationContentFingerprint,
  type BlogInformationEvidenceWorkflowStore,
  type BlogInformationReviewState,
} from './blog-information-review-workflow';
import type { BlogInformationPlan } from './blog-information-planner';
import { validateBlogInformationResearchBundle, type BlogInformationResearchBundle } from './blog-information-evidence';

interface InformationReviewCaseRow {
  id: string;
  creative_id: string;
  content_key: string;
  intent_type: string;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
  status: BlogInformationReviewState;
  content_fingerprint: string;
  validator_report: BlogInformationClaimValidationReport;
}

interface InformationCreativeRow {
  id: string;
  blog_html: string | null;
  slug: string | null;
  seo_title: string | null;
  seo_description: string | null;
  destination: string | null;
  product_id: string | null;
  generation_meta: Record<string, unknown> | null;
  review_status: string | null;
  status: string;
}

function persistenceError(stage: string, error: { message?: string } | null): Error {
  return new Error(`blog_information_review_${stage}_failed:${error?.message || 'unknown'}`);
}

async function loadReviewCase(creativeId: string): Promise<{
  reviewCase: InformationReviewCaseRow;
  creative: InformationCreativeRow;
} | null> {
  const { data: reviewCase, error: caseError } = await supabaseAdmin
    .from('blog_information_review_cases')
    .select('id, creative_id, content_key, intent_type, risk_level, status, content_fingerprint, validator_report')
    .eq('creative_id', creativeId)
    .maybeSingle();
  if (caseError) throw persistenceError('case_lookup', caseError);
  if (!reviewCase) return null;
  const { data: creative, error: creativeError } = await supabaseAdmin
    .from('content_creatives')
    .select('id, blog_html, slug, seo_title, seo_description, destination, product_id, generation_meta, review_status, status')
    .eq('id', creativeId)
    .single();
  if (creativeError || !creative) throw persistenceError('creative_lookup', creativeError);
  return {
    reviewCase: reviewCase as InformationReviewCaseRow,
    creative: creative as InformationCreativeRow,
  };
}

export function createBlogInformationEvidenceWorkflowStore(input: {
  creativeId: string;
  contentKey: string;
  tenantId?: string | null;
}): BlogInformationEvidenceWorkflowStore {
  return {
    async save({ plan, research, report, state, contentFingerprint }) {
      const researchIsPersistable = research
        ? validateBlogInformationResearchBundle(research).passed
        : false;
      if (research && researchIsPersistable) await persistBlogInformationResearch(research);

      const issueByFingerprint = new Map(report.issues.map((issue) => [issue.claimFingerprint, issue]));
      for (const claim of researchIsPersistable ? research?.claims ?? [] : []) {
        const issue = issueByFingerprint.get(claim.claimFingerprint);
        const { error } = await supabaseAdmin
          .from('blog_information_claims')
          .update({
            validation_status: issue ? 'review_required' : 'supported',
            validation_reason: issue?.code ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq('creative_id', input.creativeId)
          .eq('claim_fingerprint', claim.claimFingerprint);
        if (error) throw persistenceError('claim_validation', error);
      }

      const { data: reviewCase, error: caseError } = await supabaseAdmin
        .from('blog_information_review_cases')
        .upsert({
          tenant_id: input.tenantId ?? null,
          creative_id: input.creativeId,
          content_key: input.contentKey,
          intent_type: plan.intent,
          risk_level: plan.riskLevel,
          status: state,
          content_fingerprint: contentFingerprint,
          validator_report: report,
          approved_by: null,
          approved_at: null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'creative_id' })
        .select('id')
        .single();
      if (caseError || !reviewCase) throw persistenceError('case_upsert', caseError);
      const reviewCaseId = String(reviewCase.id);

      const { error: eventError } = await supabaseAdmin
        .from('blog_information_review_events')
        .insert({
          review_case_id: reviewCaseId,
          creative_id: input.creativeId,
          action: researchIsPersistable ? 'research_validated' : 'research_missing',
          to_status: state,
          content_fingerprint: contentFingerprint,
          validator_report: report,
          metadata: { intent_type: plan.intent, risk_level: plan.riskLevel },
        });
      if (eventError) throw persistenceError('event_insert', eventError);

      const creativeUpdate = state === 'pending_review'
        ? { status: 'draft', published_at: null, review_status: 'pending_review' }
        : { status: 'draft', published_at: null };
      const { error: creativeError } = await supabaseAdmin
        .from('content_creatives')
        .update(creativeUpdate)
        .eq('id', input.creativeId)
        .is('product_id', null);
      if (creativeError) throw persistenceError('creative_state', creativeError);

      if (state === 'pending_review') {
        const { data: existingQueue, error: queueLookupError } = await supabaseAdmin
          .from('content_review_queue')
          .select('id')
          .eq('information_review_case_id', reviewCaseId)
          .in('status', ['queued', 'assigned'])
          .limit(1);
        if (queueLookupError) throw persistenceError('queue_lookup', queueLookupError);
        if (!existingQueue?.length) {
          await queueForReview({
            creativeId: input.creativeId,
            informationReviewCaseId: reviewCaseId,
            priority: plan.riskLevel === 'HIGH' ? 95 : 80,
            reason: 'auto_generated',
            humanReviewRequired: true,
            riskLevel: plan.riskLevel.toLowerCase() as 'low' | 'medium' | 'high',
          });
        }
      }

      return { reviewCaseId };
    },
  };
}

function normalizedActorId(actorId?: string | null): string | null {
  return actorId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(actorId)
    ? actorId
    : null;
}

export async function submitBlogInformationReviewDecision(input: {
  creativeId: string;
  actorId?: string | null;
  status: 'approved' | 'rejected' | 'changes_requested';
  note?: string | null;
  now?: Date;
}): Promise<{ handled: boolean; reviewCaseId?: string; report?: BlogInformationClaimValidationReport }> {
  const loaded = await loadReviewCase(input.creativeId);
  if (!loaded) return { handled: false };
  if (loaded.creative.product_id) throw new Error('blog_information_review_product_content_forbidden');

  const fingerprint = createBlogInformationContentFingerprint({
    blogHtml: loaded.creative.blog_html,
    seoTitle: loaded.creative.seo_title,
    seoDescription: loaded.creative.seo_description,
    slug: loaded.creative.slug,
  });
  const report = input.status === 'approved'
    ? await evaluateBlogInformationClaimPublishGate({
        creativeId: input.creativeId,
        contentKey: loaded.reviewCase.content_key,
        markdown: loaded.creative.blog_html ?? '',
        productId: null,
        reviewStatus: 'approved',
        approvalValidation: true,
        intentType: loaded.reviewCase.intent_type,
        expectedScope: { destination: loaded.creative.destination ?? undefined },
        now: input.now,
      })
    : loaded.reviewCase.validator_report;
  if (input.status === 'approved' && !normalizedActorId(input.actorId)) {
    throw new Error('blog_information_review_human_actor_required');
  }
  if (input.status === 'approved' && !report.passed) {
    throw new Error(`blog_information_review_revalidation_failed:${report.issues.map((issue) => issue.code).join(',')}`);
  }

  const { error } = await supabaseAdmin.rpc('decide_blog_information_review', {
    p_case_id: loaded.reviewCase.id,
    p_creative_id: input.creativeId,
    p_decision: input.status,
    p_actor_id: normalizedActorId(input.actorId),
    p_content_fingerprint: fingerprint,
    p_validator_report: report,
    p_note: input.note ?? null,
  });
  if (error) throw persistenceError('decision_rpc', error);
  return { handled: true, reviewCaseId: loaded.reviewCase.id, report };
}

export async function publishBlogInformationReviewedDraft(input: {
  creativeId: string;
  actorId?: string | null;
  now?: Date;
}): Promise<{ handled: boolean; slug?: string | null; report?: BlogInformationClaimValidationReport }> {
  const loaded = await loadReviewCase(input.creativeId);
  if (!loaded) return { handled: false };
  if (loaded.creative.product_id) throw new Error('blog_information_publish_product_content_forbidden');
  if (!['ready', 'approved'].includes(loaded.reviewCase.status)) {
    throw new Error(`blog_information_review_not_publishable:${loaded.reviewCase.status}`);
  }

  const fingerprint = createBlogInformationContentFingerprint({
    blogHtml: loaded.creative.blog_html,
    seoTitle: loaded.creative.seo_title,
    seoDescription: loaded.creative.seo_description,
    slug: loaded.creative.slug,
  });
  if (fingerprint !== loaded.reviewCase.content_fingerprint) {
    throw new Error('blog_information_review_content_changed_reapproval_required');
  }
  const report = await evaluateBlogInformationClaimPublishGate({
    creativeId: input.creativeId,
    contentKey: loaded.reviewCase.content_key,
    markdown: loaded.creative.blog_html ?? '',
    productId: null,
    reviewStatus: loaded.reviewCase.status === 'approved' ? 'approved' : null,
    intentType: loaded.reviewCase.intent_type,
    expectedScope: { destination: loaded.creative.destination ?? undefined },
    now: input.now,
  });
  if (!report.passed) {
    throw new Error(`blog_information_publish_revalidation_failed:${report.issues.map((issue) => issue.code).join(',')}`);
  }
  const publishedAt = (input.now ?? new Date()).toISOString();
  const { error } = await supabaseAdmin.rpc('publish_blog_information_reviewed_draft', {
    p_case_id: loaded.reviewCase.id,
    p_creative_id: input.creativeId,
    p_actor_id: normalizedActorId(input.actorId),
    p_content_fingerprint: fingerprint,
    p_validation_meta: { information_claim_validation: toBlogInformationClaimValidationMeta(report) },
    p_published_at: publishedAt,
  });
  if (error) throw persistenceError('publish_rpc', error);
  return { handled: true, slug: loaded.creative.slug, report };
}

export interface BlogInformationReviewQueueDetail {
  reviewCaseId: string;
  creativeId: string;
  title: string | null;
  destination: string | null;
  intentType: string;
  riskLevel: string;
  status: string;
  contentFingerprint: string;
  validatorReasons: string[];
  claims: Array<{
    claim: string;
    source: string | null;
    sourceUrl: string | null;
    excerpt: string | null;
    scope: Record<string, unknown> | null;
    verifiedAt: string | null;
    expiresAt: string | null;
  }>;
}

export async function getBlogInformationReviewQueue(limit = 50): Promise<BlogInformationReviewQueueDetail[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const { data: cases, error: caseError } = await supabaseAdmin
    .from('blog_information_review_cases')
    .select('id, creative_id, intent_type, risk_level, status, content_fingerprint, validator_report')
    .in('status', ['pending_review', 'changes_requested', 'approved', 'ready'])
    .order('updated_at', { ascending: false })
    .limit(safeLimit);
  if (caseError) throw persistenceError('queue_cases', caseError);
  if (!cases?.length) return [];
  const creativeIds = cases.map((item) => item.creative_id);
  const [{ data: creatives, error: creativesError }, { data: claims, error: claimsError }] = await Promise.all([
    supabaseAdmin.from('content_creatives').select('id, seo_title, destination').in('id', creativeIds),
    supabaseAdmin.from('blog_information_claims').select('id, creative_id, claim_text, validation_reason').in('creative_id', creativeIds),
  ]);
  if (creativesError) throw persistenceError('queue_creatives', creativesError);
  if (claimsError) throw persistenceError('queue_claims', claimsError);
  const claimIds = (claims ?? []).map((claim) => claim.id);
  const { data: links, error: linksError } = claimIds.length
    ? await supabaseAdmin.from('blog_information_claim_evidence').select('claim_id, evidence_id').in('claim_id', claimIds).eq('support_type', 'supports')
    : { data: [], error: null };
  if (linksError) throw persistenceError('queue_links', linksError);
  const evidenceIds = [...new Set((links ?? []).map((link) => link.evidence_id))];
  const { data: evidence, error: evidenceError } = evidenceIds.length
    ? await supabaseAdmin.from('blog_information_evidence').select('id, source_version_id, excerpt, scope, observed_at, valid_until').in('id', evidenceIds)
    : { data: [], error: null };
  if (evidenceError) throw persistenceError('queue_evidence', evidenceError);
  const versionIds = [...new Set((evidence ?? []).map((item) => item.source_version_id).filter(Boolean))];
  const { data: versions, error: versionsError } = versionIds.length
    ? await supabaseAdmin.from('blog_information_source_versions').select('id, publisher, source_url').in('id', versionIds)
    : { data: [], error: null };
  if (versionsError) throw persistenceError('queue_versions', versionsError);

  const creativeById = new Map((creatives ?? []).map((item) => [item.id, item]));
  const evidenceById = new Map((evidence ?? []).map((item) => [item.id, item]));
  const versionById = new Map((versions ?? []).map((item) => [item.id, item]));
  const linksByClaim = new Map<string, string[]>();
  for (const link of links ?? []) linksByClaim.set(link.claim_id, [...(linksByClaim.get(link.claim_id) ?? []), link.evidence_id]);

  return cases.map((reviewCase) => {
    const creative = creativeById.get(reviewCase.creative_id);
    const caseClaims = (claims ?? []).filter((claim) => claim.creative_id === reviewCase.creative_id);
    const report = reviewCase.validator_report as BlogInformationClaimValidationReport;
    return {
      reviewCaseId: reviewCase.id,
      creativeId: reviewCase.creative_id,
      title: creative?.seo_title ?? null,
      destination: creative?.destination ?? null,
      intentType: reviewCase.intent_type,
      riskLevel: reviewCase.risk_level,
      status: reviewCase.status,
      contentFingerprint: reviewCase.content_fingerprint,
      validatorReasons: (report?.issues ?? []).map((issue) => issue.code),
      claims: caseClaims.flatMap((claim) => (linksByClaim.get(claim.id) ?? []).map((evidenceId) => {
        const item = evidenceById.get(evidenceId);
        const version = item?.source_version_id ? versionById.get(item.source_version_id) : null;
        const scope = item?.scope as Record<string, unknown> | null | undefined;
        return {
          claim: claim.claim_text,
          source: version?.publisher ?? null,
          sourceUrl: version?.source_url ?? null,
          excerpt: item?.excerpt ?? null,
          scope: scope ?? null,
          verifiedAt: typeof scope?.verifiedAt === 'string' ? scope.verifiedAt : item?.observed_at ?? null,
          expiresAt: typeof scope?.nextReviewAt === 'string' ? scope.nextReviewAt : item?.valid_until ?? null,
        };
      })),
    };
  });
}
