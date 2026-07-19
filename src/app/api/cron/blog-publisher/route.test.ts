import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('blog publisher quota recovery contract', () => {
  const routeSource = () => readFileSync(
    join(process.cwd(), 'src/app/api/cron/blog-publisher/route.ts'),
    'utf8',
  );

  it('keeps attempting replacement candidates until the daily quota is filled or time is unsafe', () => {
    const source = routeSource();

    expect(source).toContain("readBoundedIntEnv('BLOG_PUBLISHER_MAX_EXTRA_CLAIM_ROUNDS', 4, 1, 8)");
    expect(source).toContain('while (publishedThisRun < remainingToday && extraClaimRounds < MAX_EXTRA_CLAIM_ROUNDS)');
    expect(source).toContain('getPublisherExtraClaimRecoveryPlan');
    expect(source).toContain('ensureDailyPublishableQueue({');
    expect(source).toContain('claim_queue_items');
    expect(source).toContain('publishedThisRun += 1');
    expect(source).toContain('candidateFailures.push');
  });

  it('deduplicates micro-angle candidates by destination, broad angle, and micro angle', () => {
    const source = routeSource();

    expect(source).toContain('buildRecentInfoDuplicateScope(item)');
    expect(source).toContain("query.contains('generation_meta', { micro_angle: scope.microAngle })");
  });

  it('never lets deterministic information fallback become a public article', () => {
    const source = routeSource();

    expect(source).toContain('deferAttemptedQueueItemForTimeBudget');
    expect(source).toContain("status: 'deferred_time_budget'");
    expect(source).toContain('private_diagnostic_fallback === true');
    expect(source).toContain('applyDeterministicInfoFallback');
    expect(source).toContain('deterministic_fast_fallback');
    expect(source).toContain('deterministic_info_fallback_not_publishable');
    expect(source).toContain('deterministic_fallback_blocked: true');
    expect(source).not.toContain('applyDeterministicInfoFallback(generated, item, primaryKeyword, qa.summary)');
    expect(source).not.toContain('applyDeterministicInfoFallback(generated, item, primaryKeyword, publishQuality.summary)');
  });

  it('does not inject product counts, prices, or booking signals into informational prompts', () => {
    const source = routeSource();

    expect(source).not.toContain('fetchBlogOriginalitySignals');
    expect(source).not.toContain('buildOriginalityPromptBlock');
    expect(source).not.toContain('originality_signals:');
  });

  it('routes queue rows through the explicit information/product boundary before generation', () => {
    const source = routeSource();

    expect(source).toContain('routeBlogContentLane({');
    expect(source).toContain('declaredLane: item.content_lane ?? null');
    expect(source).toContain('content_boundary_failed:');
    expect(source).toContain("contentBoundary.lane === 'card_news_bridge'");
    expect(source).toContain("contentBoundary.lane === 'product'");
    expect(source).toContain("product_generation', () => generateFromProduct(item)");
  });

  it('blocks incomplete information plans before invoking the writer', () => {
    const source = routeSource();
    const generatorStart = source.indexOf('async function generateFromTopic');
    const planner = source.indexOf('const contentBrief = buildQueueContentBrief', generatorStart);
    const blocker = source.indexOf('if (!contentBrief.passed)', planner);
    const writer = source.indexOf('const raw = await generatePublisherBlogText', blocker);

    expect(generatorStart).toBeGreaterThanOrEqual(0);
    expect(planner).toBeGreaterThan(generatorStart);
    expect(blocker).toBeGreaterThan(planner);
    expect(writer).toBeGreaterThan(blocker);
    expect(source).toContain('missing_inputs: contentBrief.plan.missingInputs');
  });

  it('keeps high-risk informational drafts private until a human review is completed', () => {
    const source = routeSource();

    expect(source).toContain('isHighRiskInformationalTopic({');
    expect(source).toContain("status: contentBoundary.lane === 'informational' || requiresHumanReview ? 'draft' : 'published'");
    expect(source).toContain("review_status: requiresHumanReview ? 'pending_review' : null");
    expect(source).toContain('representativeIdentity && !requiresHumanReview');
    expect(source).toContain('publishBlogInformationAtomically({');
    expect(source).toContain("status: 'pending_review'");
    expect(source).toContain('humanReviewRequired: true');
    expect(source).toContain("riskLevel: 'high'");
  });

  it('replaces quarantined fallback posts in place and always sends them to private review', () => {
    const source = routeSource();

    expect(source).toContain('readPrivateBlogRegenerationRequest(item)');
    expect(source).toContain('hasPrivateBlogRegenerationIntent(item)');
    expect(source).toContain('isEligiblePrivateBlogRegenerationTarget');
    expect(source).toContain("const reason = 'private_regeneration_request_invalid'");
    expect(source).toContain("const reason = 'private_regeneration_target_not_eligible'");
    expect(source).toContain('privateReplacementDraftId = privateRegenerationRequest.contentCreativeId');
    expect(source).toContain('privateRegenerationRequest !== null || requiresClaimReview');
    expect(source).toContain('forced_private_review: true');
  });

  it('excludes the in-place replacement draft from its own duplicate check', () => {
    const source = routeSource();

    expect(source).toContain('excludeContentCreativeId: item.content_creative_id ?? null');
  });

  it('supports an authenticated single-item private regeneration without quota refill', () => {
    const source = routeSource();
    const targetedStart = source.indexOf("searchParams.get('privateQueueId')");
    const regularRefill = source.indexOf('const queueRefill = await ensureDailyPublishableQueue');

    expect(targetedStart).toBeGreaterThanOrEqual(0);
    expect(targetedStart).toBeLessThan(regularRefill);
    expect(source).toContain('hasPrivateBlogRegenerationIntent(item)');
    expect(source).toContain('targetedPrivateRegeneration: true');
    expect(source).toContain('targetedAttempts < 2');
    expect(source).toContain('publisherRemainingMs(startTime) >= BLOG_PUBLISHER_MIN_ITEM_START_MS');
    expect(source).toContain('targetedAttempts,');
    expect(source).toContain("result.status === 'pending_review' || result.status === 'done'");
    expect(source).toContain(".eq('status', 'queued')\n    .select('id')\n    .maybeSingle()");
  });

  it('uses a lower-variance writer temperature for private regeneration', () => {
    const source = routeSource();

    expect(source).toContain('temperature: hasPrivateBlogRegenerationIntent(item) ? 0.25 : 0.7');
  });

  it('requires persisted research before targeted private regeneration calls the writer', () => {
    const source = routeSource();
    const targetedStart = source.indexOf("searchParams.get('privateQueueId')");
    const preflight = source.indexOf('evaluateBlogGenerationResearchReadiness({', targetedStart);
    const persistence = source.indexOf('persistBlogInformationResearch({', preflight);
    const writer = source.indexOf('let result = await processQueueItem', persistence);

    expect(preflight).toBeGreaterThan(targetedStart);
    expect(persistence).toBeGreaterThan(preflight);
    expect(writer).toBeGreaterThan(persistence);
    expect(source).toContain('private_regeneration_research_preflight:');
    expect(source).toContain('private_regeneration_research_persistence:');
    expect(source).toContain("delete safeMeta[BLOG_INFORMATION_RESEARCH_META_KEY]");
    expect(source).toContain('${researchPromptBlock}');
  });

  it('reconciles the final informational body with a bounded writer claim ledger', () => {
    const source = routeSource();

    expect(source).toContain('parseBlogInformationWriterOutput(raw)');
    expect(source).toContain('writer_claim_ledger: {');
    expect(source).toContain("claimLedger: contentBoundary.lane === 'informational'");
    expect(source).toContain("claimLedgerIssues: contentBoundary.lane === 'informational'");
    expect(source).toContain('auto_regeneration_attempts: 0');
    expect(source).toContain('auto_regeneration_limit: 0');
  });

  it('repairs common article-quality failures instead of treating them as terminal blockers', () => {
    const source = routeSource();

    expect(source).toContain("from '@/lib/blog-article-quality-v2-repair'");
    expect(source).toContain('repairArticleQualityV2Specifics');
    expect(source).toContain('const finalArticleRepair = repairArticleQualityV2Specifics');
  });

  it('returns claimed but unattempted rows to the queue for the next recovery run', () => {
    const source = routeSource();

    expect(source).toContain('releaseUnattemptedClaimedQueueItems');
    expect(source).toContain('timeBudgetClaimRelease');
    expect(source).toContain('getUnattemptedClaimReleaseIds');
    expect(source).toContain('time_budget_claim_release_failed');
  });

  it('does not reintroduce old mechanical SEO prompt rules that create AI-looking posts', () => {
    const source = routeSource();

    expect(source).not.toContain('H2 8개 고정');
    expect(source).not.toContain('H2 7~9개');
    expect(source).not.toContain('==핵심 문장==');
    expect(source).not.toContain('운영팀 직접 답사 톤');
    expect(source).not.toContain('여행 완벽 가이드');
    expect(source).not.toContain('지금 한국인이 가장 많이 묻는');
  });
});
