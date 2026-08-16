import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/app/api/cron/blog-publisher/route.ts', 'utf8');
const controller = readFileSync('src/app/api/cron/blog-publication-controller/route.ts', 'utf8');

describe('blog publisher V4 orchestration wiring', () => {
  it('reserves budget before the only provider-call boundary and settles receipts', () => {
    const helper = source.slice(
      source.indexOf('async function generatePublisherBlogText'),
      source.indexOf('function publisherRemainingMs'),
    );
    expect(helper.indexOf('reserveBlogAiBudgetBeforeCallV4({')).toBeLessThan(
      helper.indexOf('generateBlogTextWithReceipt(prompt,'),
    );
    expect(helper).toContain('settleBlogAiBudgetReservationV4');
    expect(helper).toContain('receipt: error instanceof BlogAiResponseError ? error.receipt : null');
    expect(helper).toContain('blog_ai_budget_blocked');
    expect(source.match(/generateBlogTextWithReceipt\(/g)).toHaveLength(1);
  });

  it('queues the grounded Gemini rescue route and never treats it as publishable directly', () => {
    expect(source).toContain("['rewrite_pro_high', 'rewrite_pro_max', 'rescue_gemini', 'reresearch', 'quarantine']");
    expect(source).toContain("researchValid:");
    expect(source).toContain("claimLedgerValid:");
    expect(source).toContain("stage === 'rescue_gemini'");
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
});
