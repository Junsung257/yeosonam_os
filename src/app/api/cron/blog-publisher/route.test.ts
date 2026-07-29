import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('blog publisher quota recovery contract', () => {
  const routeSource = () => readFileSync(
    join(process.cwd(), 'src/app/api/cron/blog-publisher/route.ts'),
    'utf8',
  );

  it('keeps attempting replacement candidates until the currently due slot quota is filled or time is unsafe', () => {
    const source = routeSource();

    expect(source).toContain("readBoundedIntEnv('BLOG_PUBLISHER_MAX_EXTRA_CLAIM_ROUNDS', 4, 1, 8)");
    expect(source).toContain('while (publishedThisRun < remainingDueNow && extraClaimRounds < MAX_EXTRA_CLAIM_ROUNDS)');
    expect(source).toContain('calculateBlogPublishSlotQuota({');
    expect(source).toContain("'daily_publish_quota_reached_atomic_upgrade_processed'");
    expect(source).toContain('PUBLISHED_BLOG_ATOMIC_UPGRADE_MODE');
    expect(source).toContain("const evidenceContentKey = contentBoundary.lane === 'informational'");
    expect(source).toContain('expectedContentKey: evidenceContentKey');
    expect(source).toContain('contentKey: evidenceContentKey');
    expect(source).toContain('information_evidence_content_key: evidenceContentKey');
    expect(source).toContain('applyFinalResearchStructureRepair();');
    expect(source).toContain('generated.blog_html = softenKeywordDensity(generated.blog_html, primaryKeyword, blogType);');
    expect(source).toContain("['title', 'meta_description'].includes(d.name) && d.score < d.maxScore");
    expect(source).toContain("contains('meta'");
    expect(source).toContain("? 'daily_publish_quota_reached'");
    expect(source).toContain("'scheduled_publish_window_not_due'");
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

  it('uses the dedicated validated information prompt and records a safe manifest', () => {
    const source = routeSource();
    const generatorStart = source.indexOf('async function generateFromTopic');
    const generatorSource = source.slice(generatorStart, source.indexOf('async function', generatorStart + 30));

    expect(source).toContain(".eq('domain', 'blog_info_writer_guide')");
    expect(source).toContain('databaseContentValidator: isValidInformationalWriterGuide');
    expect(generatorSource).toContain('getActiveBlogInformationWriterGuide()');
    expect(generatorSource).toContain('buildInformationalWriterPrompt({');
    expect(generatorSource).toContain('prompt_manifest: promptManifest');
    expect(generatorSource).not.toContain('5~8회 반복');
    expect(generatorSource).not.toContain("content: styleGuide");
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
    expect(source).toContain('status: publishedAtomicUpgrade');
    expect(source).toContain("(contentBoundary.lane === 'informational' || requiresHumanReview ? 'draft' : 'published')");
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
    expect(source).toContain('!publishedAtomicUpgrade && privateRegenerationRequest !== null');
    expect(source).toContain('forced_private_review: !publishedAtomicUpgrade');
  });

  it('replaces public legacy posts only after research and every publication gate pass', () => {
    const source = routeSource();

    expect(source).toContain('isPublishedBlogAtomicUpgradeRequest');
    expect(source).toContain('published_atomic_upgrade_claim_gate_failed');
    expect(source).toContain('published_atomic_upgrade_human_review_required');
    expect(source).toContain('preserved_published_creative_id');
    expect(source).toContain('information_claim_validation: claimValidationSummary');
    expect(source).toContain('const publicationTimestamp = publishedAtomicUpgrade && originalPublishedAt');
    expect(source).toContain("status: publishedAtomicUpgrade ? 'upgraded' : 'published'");
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
    expect(source).toContain('const targetedAttempts = 1');
    expect(source).not.toContain('targetedAttempts < 2');
    expect(source).toContain('targetedAttempts,');
    expect(source).toContain("result.status === 'pending_review'");
    expect(source).toContain("|| result.status === 'done'");
    expect(source).toContain("|| result.status === 'upgraded'");
    expect(source).toContain(".eq('status', 'queued')\n    .select('id')\n    .maybeSingle()");
  });

  it('supports an explicitly flagged single-item informational publication canary', () => {
    const source = routeSource();
    const targetedStart = source.indexOf("searchParams.get('targetQueueId')");
    const regularRecovery = source.indexOf('const staleRecovery = await recoverStaleGeneratingQueueItems');

    expect(targetedStart).toBeGreaterThanOrEqual(0);
    expect(targetedStart).toBeLessThan(regularRecovery);
    expect(source).toContain('targetMeta.controlled_publish_canary !== true');
    expect(source).toContain("reason: item.product_id\n            ? 'target_queue_item_must_be_informational'");
    expect(source).toContain('targetedCanaryPublication: true');
    expect(source).toContain('const result = await processQueueItem(item, new Map(), { startedAtMs: startTime });');
  });

  it('uses a lower-variance writer temperature for private regeneration', () => {
    const source = routeSource();

    expect(source).toContain('temperature: hasPrivateBlogRegenerationIntent(item) ? 0.25 : 0.7');
  });

  it('repairs an exact primary keyword miss before blocking SEO publication', () => {
    const source = routeSource();

    expect(source).toContain('function repairPrimaryKeywordPresence');
    expect(source).toContain("d.name === 'primary_keyword' && d.status === 'fail'");
    expect(source).toContain('const keywordRepair = repairPrimaryKeywordPresence(generated.blog_html, primaryKeyword)');
    expect(source).toContain('SEO primary keyword repair');
  });

  it('avoids duplicate AI and image work during a controlled private regeneration', () => {
    const source = routeSource();

    expect(source).toContain('const privateRegeneration = hasPrivateBlogRegenerationIntent(item)');
    expect(source).toContain('const shouldAnalyzeSerp = !privateRegeneration && Boolean(');
    expect(source).toContain('if (!privateRegeneration) {\n    blog_html = await maybeApplyChainOfDensity(blog_html);');
    expect(source).toContain('if (destForImage && !privateRegeneration) {');
    expect(source).toContain('const replacementAssets = privateReplacementAssets ?? queueReusableAssets');
    expect(source).not.toContain('if (!publishedAtomicUpgrade) {\n        privateReplacementAssets = {');
    expect(source).toContain('fallbackImageUrls: replacementAssets?.inlineImageUrls');
    expect(source).toContain('preferFallbackImages: replacementAssets !== null');
    expect(source).toContain('const replacementImageShortfall = replacementAssets !== null');
    expect(source).toContain('const mayFillReplacementImageShortfall = replacementAssets !== null');
    expect(source).toContain('allowPexelsSearch: replacementAssets === null || mayFillReplacementImageShortfall');
    expect(source).toContain('allowGeneratedFallback: replacementAssets === null || mayFillReplacementImageShortfall');
    expect(source).toContain(': replacementImageShortfall');
    expect(source).toContain('if (publishedAtomicUpgrade && !generated.og_image_url) {');
    expect(source).toContain('const [firstInlineImage] = extractBlogInlineImageUrls(generated.blog_html)');
    expect(source).toContain("provider: 'inline_asset'");
  });

  it('reuses a queue-linked draft image set during an evidence-backed retry', () => {
    const source = routeSource();

    expect(source).toContain("typeof item.content_creative_id === 'string'");
    expect(source).toContain(".eq('id', item.content_creative_id)");
    expect(source).toContain("queueCreative.channel === 'naver_blog'");
    expect(source).toContain("queueCreative.status === 'draft'");
    expect(source).toContain('queueReusableDraftId = queueCreative.id');
    expect(source).toContain('queueReusableAssets = {');
    expect(source).toContain('extractBlogInlineImageUrls(');
    expect(source).toContain('promoteDraftId = privateReplacementDraftId ?? queueReusableDraftId');
  });

  it('requires persisted research before targeted private regeneration calls the writer', () => {
    const source = routeSource();
    const targetedStart = source.indexOf("searchParams.get('privateQueueId')");
    const preflight = source.indexOf('evaluateBlogGenerationResearchReadiness({', targetedStart);
    const persistence = source.indexOf('persistBlogInformationResearch({', preflight);
    const writer = source.indexOf('const result = await processQueueItem', persistence);

    expect(preflight).toBeGreaterThan(targetedStart);
    expect(persistence).toBeGreaterThan(preflight);
    expect(writer).toBeGreaterThan(persistence);
    expect(source).toContain('private_regeneration_research_preflight:');
    expect(source).toContain('private_regeneration_research_persistence:');
    expect(source).toContain('markBlogInformationResearchClaimsSupported({');
    expect(source).toContain("delete safeMeta[BLOG_INFORMATION_RESEARCH_META_KEY]");
    expect(source).toContain('researchPromptBlock,');
  });

  it('promotes only a passed research bundle and does not treat audience labels as evidence scope', () => {
    const source = routeSource();
    const finalPreflight = source.indexOf('if (!researchReadiness.passed || !researchReadiness.bundle)');
    const promotion = source.indexOf('markBlogInformationResearchClaimsSupported({', finalPreflight);
    const writerPrompt = source.indexOf('const researchPromptBlock', promotion);

    expect(finalPreflight).toBeGreaterThan(-1);
    expect(promotion).toBeGreaterThan(finalPreflight);
    expect(writerPrompt).toBeGreaterThan(promotion);
    expect(source).not.toContain(': typeof generatedPlanBriefRecord?.audience');
  });

  it('reconciles the final informational body with a bounded writer claim ledger', () => {
    const source = routeSource();

    expect(source).toContain('parseBlogInformationWriterOutput(raw)');
    expect(source).toContain('repairBlogGenerationResearchStructure({');
    expect(source).toContain('plannedTitle: contentBrief.title');
    expect(source).toContain('plannedTitle: finalContentBrief.title');
    expect(source).toContain('information_research_structure_repair: {');
    expect(source).toContain('const applyFinalResearchStructureRepair = (): void =>');
    expect(source).toContain("stage: 'final_quality_boundary'");
    expect(source).toContain('const runQualityWithResearchStructure = async (): Promise<QualityGateReport> =>');
    expect(source).toContain('const runQualityAfterAiReadableRepair = async (): Promise<QualityGateReport> =>');
    expect(source).toContain('const restoreFinalReusableImages = async (): Promise<void> =>');
    expect(source).toContain('await restoreFinalReusableImages();');
    const finalResearchRepair = source.indexOf('applyFinalResearchStructureRepair();');
    const finalImageRestore = source.indexOf('await restoreFinalReusableImages();', finalResearchRepair);
    const finalQualityGate = source.indexOf(
      'return runGeneratedQualityGates(generated, item, blogType, primaryKeyword);',
      finalImageRestore,
    );
    expect(finalResearchRepair).toBeGreaterThan(-1);
    expect(finalImageRestore).toBeGreaterThan(finalResearchRepair);
    expect(finalQualityGate).toBeGreaterThan(finalImageRestore);
    expect(source).toContain('hasRenderedPageH1: true');
    expect(source).toContain("['title', 'meta_description'].includes(d.name) && d.score < d.maxScore");
    expect(source).toContain('qa = await runQualityWithResearchStructure();');
    expect(source).toContain('qa = await runQualityAfterAiReadableRepair();');
    const genericRepair = source.indexOf('qa = await repairFailedQualityGates(generated, item, qa, blogType, primaryKeyword);');
    const finalAiRepair = source.indexOf('qa = await runQualityAfterAiReadableRepair();', genericRepair);
    expect(genericRepair).toBeGreaterThan(-1);
    expect(finalAiRepair).toBeGreaterThan(genericRepair);
    expect(source).toContain("qa = blogType === 'info'");
    expect(source).toContain('writer_claim_ledger: {');
    expect(source).toContain("claimLedger: contentBoundary.lane === 'informational'");
    expect(source).toContain("claimLedgerIssues: contentBoundary.lane === 'informational'");
    expect(source).toContain('auto_regeneration_attempts: 0');
    expect(source).toContain('auto_regeneration_limit: 0');
    expect(source).toContain("from('content_review_queue')");
    expect(source).toContain(".update({ status: 'skipped' })");
    expect(source).toContain(".in('status', ['queued', 'assigned'])");
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

  it('bounds grounded writer output and disables dynamic Gemini thinking', () => {
    const source = routeSource();

    expect(source).toContain('const BLOG_PUBLISHER_AI_MAX_OUTPUT_TOKENS = 8_192');
    expect(source).toContain('maxTokens: options.maxTokens ?? BLOG_PUBLISHER_AI_MAX_OUTPUT_TOKENS');
    expect(source).toContain('thinkingBudget: options.thinkingBudget ?? 0');
    expect(source).toContain('firstTryTimeoutMs: BLOG_PUBLISHER_AI_FIRST_PROVIDER_TIMEOUT_MS');
    expect(source).toContain('fallbackTimeoutMs: BLOG_PUBLISHER_AI_FALLBACK_PROVIDER_TIMEOUT_MS');
  });
});
