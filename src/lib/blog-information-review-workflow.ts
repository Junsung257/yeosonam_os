import { createHash } from 'node:crypto';
import {
  createBlogInformationSourceVersionKey,
  validateBlogInformationResearchBundle,
  type BlogInformationEvidenceScope,
  type BlogInformationResearchBundle,
} from './blog-information-evidence';
import {
  validateBlogInformationClaims,
  type BlogInformationClaimValidationReport,
  type PersistedBlogInformationClaimRecord,
} from './blog-information-claim-validator';
import {
  buildBlogInformationPlan,
  type BlogInformationPlan,
  type BlogInformationPlannerInput,
} from './blog-information-planner';

export type BlogInformationReviewState =
  | 'draft'
  | 'researching'
  | 'pending_review'
  | 'changes_requested'
  | 'approved'
  | 'ready'
  | 'published'
  | 'rejected';

export interface BlogInformationContentFingerprintInput {
  blogHtml?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  slug?: string | null;
}

export interface BlogInformationResearcher {
  research(plan: BlogInformationPlan): Promise<BlogInformationResearchBundle | null>;
}

export interface BlogInformationEvidenceWorkflowStore {
  save(input: {
    plan: BlogInformationPlan;
    research: BlogInformationResearchBundle | null;
    report: BlogInformationClaimValidationReport;
    state: BlogInformationReviewState;
    contentFingerprint: string;
  }): Promise<{ reviewCaseId: string }>;
}

export interface ExecuteBlogInformationEvidenceWorkflowInput {
  creativeId: string;
  contentKey: string;
  markdown: string;
  seoTitle?: string | null;
  seoDescription?: string | null;
  slug?: string | null;
  productId?: string | null;
  tenantId?: string | null;
  siteScope?: string | null;
  plannerInput: BlogInformationPlannerInput;
  expectedScope?: Partial<Pick<BlogInformationEvidenceScope, 'country' | 'destination' | 'applicableTo' | 'locale'>>;
  now?: Date;
}

export interface BlogInformationEvidenceWorkflowResult {
  plan: BlogInformationPlan;
  research: BlogInformationResearchBundle | null;
  report: BlogInformationClaimValidationReport;
  state: BlogInformationReviewState;
  contentFingerprint: string;
  reviewCaseId: string;
}

export interface BlogInformationReviewPublishability {
  passed: boolean;
  reasons: Array<
    | 'review_state_not_publishable'
    | 'high_risk_human_approval_required'
    | 'content_changed_reapproval_required'
    | 'latest_evidence_validation_failed'
  >;
}

export function evaluateBlogInformationReviewPublishability(input: {
  state: BlogInformationReviewState;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  reviewedFingerprint: string;
  currentFingerprint: string;
  report: BlogInformationClaimValidationReport;
}): BlogInformationReviewPublishability {
  const reasons: BlogInformationReviewPublishability['reasons'] = [];
  if (!['ready', 'approved'].includes(input.state)) reasons.push('review_state_not_publishable');
  if (input.riskLevel === 'HIGH' && input.state !== 'approved') {
    reasons.push('high_risk_human_approval_required');
  }
  if (input.reviewedFingerprint !== input.currentFingerprint) {
    reasons.push('content_changed_reapproval_required');
  }
  if (!input.report.passed) reasons.push('latest_evidence_validation_failed');
  return { passed: reasons.length === 0, reasons };
}

export function createBlogInformationContentFingerprint(
  input: BlogInformationContentFingerprintInput,
): string {
  const material = [input.blogHtml, input.seoTitle, input.seoDescription, input.slug]
    .map((value) => value ?? '')
    .join('\n');
  return createHash('sha256').update(material, 'utf8').digest('hex');
}

export function buildBlogInformationPersistedClaimRecords(
  research: BlogInformationResearchBundle,
): PersistedBlogInformationClaimRecord[] {
  const sourceByKey = new Map(research.sources.map((source) => [source.sourceKey, source]));
  const evidenceByKey = new Map(research.evidence.map((evidence) => [evidence.evidenceKey, evidence]));

  return research.claims.map((claim) => ({
    claimFingerprint: claim.claimFingerprint,
    claimText: claim.claimText,
    claimType: claim.claimType,
    extractedValue: claim.extractedValue,
    validationStatus: 'supported',
    evidence: claim.evidenceKeys.flatMap((evidenceKey) => {
      const evidence = evidenceByKey.get(evidenceKey);
      const source = evidence ? sourceByKey.get(evidence.sourceKey) : null;
      if (!evidence || !source) return [];
      return [{
        evidenceKey: evidence.evidenceKey,
        sourceVersionId: createBlogInformationSourceVersionKey(source),
        claimType: evidence.claimType,
        observedAt: evidence.observedAt,
        validUntil: evidence.validUntil,
        excerpt: evidence.excerpt ?? null,
        scope: evidence.scope,
        source: {
          authorityLevel: source.authorityLevel,
          retrievedAt: source.retrievedAt,
          validUntil: source.validUntil,
          status: 'active' as const,
        },
      }];
    }),
  }));
}

export function validateBlogInformationResearchDraft(input: {
  markdown: string;
  research: BlogInformationResearchBundle | null;
  intentType: string;
  expectedScope?: ExecuteBlogInformationEvidenceWorkflowInput['expectedScope'];
  now?: Date;
}): BlogInformationClaimValidationReport {
  const bundleValidation = input.research
    ? validateBlogInformationResearchBundle(input.research)
    : { passed: false, issues: ['missing_research_bundle'] };
  const persistedClaims = input.research
    ? buildBlogInformationPersistedClaimRecords(input.research)
    : [];
  const claimLedger = input.research?.claims.map((claim) => ({
    claimFingerprint: claim.claimFingerprint,
    claimText: claim.claimText,
    claimType: claim.claimType,
    riskLevel: claim.riskLevel,
  }));

  return validateBlogInformationClaims({
    markdown: input.markdown,
    persistedClaims,
    claimLedger,
    claimLedgerIssues: bundleValidation.passed
      ? []
      : bundleValidation.issues.map((issue) => `research_bundle:${issue}`),
    intentType: input.intentType,
    expectedScope: input.expectedScope,
    // This pass validates provenance, scope, semantics, and freshness. Human
    // approval is a separate durable transition and is never inferred here.
    reviewStatus: 'approved',
    now: input.now,
  });
}

export async function executeBlogInformationEvidenceWorkflow(
  input: ExecuteBlogInformationEvidenceWorkflowInput,
  dependencies: { researcher: BlogInformationResearcher; store: BlogInformationEvidenceWorkflowStore },
): Promise<BlogInformationEvidenceWorkflowResult> {
  if (input.productId) throw new Error('blog_information_workflow_product_content_forbidden');

  const plan = buildBlogInformationPlan(input.plannerInput);
  if (!plan.passed) throw new Error(`blog_information_plan_invalid:${plan.missingInputs.join(',')}`);
  const researched = await dependencies.researcher.research(plan);
  const research = researched
    ? {
        ...researched,
        contentKey: input.contentKey,
        creativeId: input.creativeId,
        tenantId: input.tenantId ?? null,
        siteScope: input.siteScope ?? null,
      }
    : null;
  const report = validateBlogInformationResearchDraft({
    markdown: input.markdown,
    research,
    intentType: plan.intent,
    expectedScope: input.expectedScope,
    now: input.now,
  });
  const state: BlogInformationReviewState = report.passed && !plan.requiresHumanReview
    ? 'ready'
    : 'pending_review';
  const contentFingerprint = createBlogInformationContentFingerprint({
    blogHtml: input.markdown,
    seoTitle: input.seoTitle,
    seoDescription: input.seoDescription,
    slug: input.slug ?? input.contentKey,
  });
  const stored = await dependencies.store.save({ plan, research, report, state, contentFingerprint });

  return { plan, research, report, state, contentFingerprint, reviewCaseId: stored.reviewCaseId };
}
