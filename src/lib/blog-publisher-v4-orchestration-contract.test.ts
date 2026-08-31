import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/app/api/cron/blog-publisher/route.ts', 'utf8');
const controller = readFileSync('src/app/api/cron/blog-publication-controller/route.ts', 'utf8');
const autoResearch = readFileSync('src/lib/blog-auto-research.ts', 'utf8');

describe('blog publisher V4 orchestration wiring', () => {
  it('reserves and settles budget at both generation and editorial-judge provider boundaries', () => {
    const helper = source.slice(
      source.indexOf('async function generatePublisherBlogText'),
      source.indexOf('function publisherRemainingMs'),
    );
    const judgeHelper = source.slice(
      source.indexOf('async function evaluatePublisherEditorialHarnessV5'),
      source.indexOf('function shouldSkipMediaGenerationFailure'),
    );
    expect(helper.indexOf('reserveBlogAiBudgetBeforeCallV4({')).toBeLessThan(
      helper.indexOf('generateBlogTextWithReceipt(prompt,'),
    );
    expect(helper).toContain('settleBlogAiBudgetReservationV4');
    expect(helper).toContain('receipt: error instanceof BlogAiResponseError ? error.receipt : null');
    expect(helper).toContain('blog_ai_budget_blocked');
    expect(judgeHelper.indexOf('reserveBlogEditorialJudgeBudgetBeforeCallV5({')).toBeLessThan(
      judgeHelper.indexOf('generateBlogJsonWithReceipt(buildBlogEditorialJudgePromptV1({'),
    );
    expect(judgeHelper).toContain('settleBlogAiBudgetReservationV4({');
    expect(judgeHelper).toContain('cascade: false');
    expect(judgeHelper).toContain("deepseekThinking: 'disabled'");
    expect(source.match(/generateBlogTextWithReceipt\(/g)).toHaveLength(1);
    expect(source.match(/generateBlogJsonWithReceipt\(/g)).toHaveLength(1);
  });

  it('keeps every publication model stage DeepSeek-only', () => {
    expect(source).toContain("['rewrite_pro_high', 'rewrite_pro_max', 'reresearch', 'quarantine']");
    expect(source).toContain("researchValid:");
    expect(source).toContain("claimLedgerValid:");
    expect(source).not.toContain('rescue_gemini');
    expect(source).not.toContain('gemini-2.5-pro');
    expect(autoResearch).toContain('const AUTO_RESEARCH_MODEL = BLOG_DEEPSEEK_MODELS.rewrite');
    expect(autoResearch).toContain('generateBlogJSON(buildBlogStructuredResearchPrompt');
    expect(autoResearch).toContain('cascade: false');
    expect(autoResearch).toContain("deepseekThinking: 'disabled'");
    expect(autoResearch).not.toContain("deepseekThinking: 'enabled'");
    expect(autoResearch).not.toContain('GoogleGenAI');
    expect(autoResearch).not.toContain("getProviderApiKey('gemini')");
    expect(autoResearch).not.toContain('.models.generateContent({');
  });

  it('excludes research claims whose type disagrees with the publish classifier', () => {
    expect(source).toContain('inspectBlogInformationClaimTypeCompatibility(');
    expect(source).toContain('entry.typeCompatibility.passed');
    expect(source).toContain("reason: 'claim_type_mismatch'");
  });

  it('does not route V3 rewrites on diagnostic keyword-density style SEO details', () => {
    expect(source).toContain('isBlogSeoDetailBlockingForPublish(');
    expect(source).toContain('Boolean(generated.generation_meta?.content_brief_v3)');
  });

  it('publishes only the immutable selected attempt, never whichever attempt happens to be latest', () => {
    expect(controller).toContain('selected_attempt_id,latest_quality_score');
    expect(controller).toContain(".eq('id', selectedAttemptId)");
    expect(controller).toContain('selected_attempt_not_publishable');
    expect(controller).not.toContain('latest_attempt_not_publishable');
  });

  it('never sends an indexing notification for a draft that failed to become public', () => {
    const nonRepresentative = controller.slice(
      controller.indexOf('} else {', controller.indexOf('if (identity)')),
      controller.indexOf('const [runSync, queueSync]'),
    );
    expect(nonRepresentative.indexOf(".update({ status: 'published'"))
      .toBeLessThan(nonRepresentative.indexOf('enqueueBlogIndexingJob({'));
    expect(nonRepresentative).toContain('indexing_enqueue_failed_after_public_commit');
  });

  it('keeps the legacy publisher generation-only and rechecks the selected output at public commit', () => {
    expect(source).toContain('const deferPublication = true');
    expect(source).not.toContain("const deferPublication = request.nextUrl.searchParams.get('phase') === 'generate_only'");
    expect(controller).toContain('selected_attempt_output_mismatch');
    expect(controller).toContain("String(selectedOutput.markdown ?? '') === String(creative.blog_html ?? '')");
    expect(controller).toContain('creative_public_policy_blocked:');
    expect(controller).toContain('information_claim_gate_not_passed');
  });

  it('runs the claim gate across title, description, and body public surfaces', () => {
    expect(source.match(/\[generated\.seo_title, generated\.seo_description, generated\.blog_html\]/g))
      .toHaveLength(2);
  });

  it('revalidates the controlled canary without consuming another model attempt', () => {
    expect(source).toContain("['opening_heading_exclusion_v1', 'route_template_dedup_v2'].includes(request.reason)");
    expect(source).toContain('attempts: attemptRevalidationRequest');
    expect(source).toContain('loadBlogAttemptRevalidationCandidateV4(');
    expect(source).toContain('revalidateBlogGenerationAttemptV4({');
    expect(source).toContain('model_calls: 0');
    expect(source.match(/alignGuamAirportCanaryDescriptionV4\(/g)).toHaveLength(3);
    expect(source).toContain('const alreadyRevalidatedAttempt =');
    expect(source).toContain('existingRevalidation?.source_attempt_id === request.attemptId');
  });

  it('synchronizes a non-human informational review case before approving its deferred slot', () => {
    const deferredApproval = source.slice(
      source.indexOf("if (approvedForDeferredPublication)"),
      source.indexOf("if (representativeIdentity && !requiresHumanReview)"),
    );
    expect(deferredApproval).toContain("state: 'ready'");
    expect(deferredApproval).toContain('deferred_information_review_ready_precondition_failed');
    expect(deferredApproval).toContain('deferred_information_review_ready_sync_failed:');
    expect(deferredApproval.indexOf('deferredReviewStore.save({')).toBeLessThan(
      deferredApproval.indexOf('approveBlogGenerationRunForSlotV4({'),
    );
    expect(deferredApproval).toContain('reviewClaimValidation.requiresHumanReview');
    expect(deferredApproval).toContain('deferredBrief.plan.requiresHumanReview');
  });
});
