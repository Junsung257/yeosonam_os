import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('blog publisher quota recovery contract', () => {
  const routeSource = () => readFileSync(
    join(process.cwd(), 'src/app/api/cron/blog-publisher/route.ts'),
    'utf8',
  );
  const corpusDiversitySource = () => readFileSync(
    join(process.cwd(), 'src/lib/blog-corpus-diversity-repository-v4.ts'),
    'utf8',
  );
  const publisherBriefSource = () => readFileSync(
    join(process.cwd(), 'src/lib/blog-publisher-brief-v4.ts'),
    'utf8',
  );

  it('does not override DeepSeek Pro thinking mode on rewrite calls', () => {
    expect(routeSource()).not.toMatch(
      /model:\s*BLOG_DEEPSEEK_MODELS\.rewrite,\s*deepseekThinking:\s*'disabled'/,
    );
  });

  it('records and bounds source-backed empty research extraction retries', () => {
    const source = routeSource();

    expect(source).toContain("auto_research_failure: {");
    expect(source).toContain('researchFailureAttempt < 2');
    expect(source).toContain("auto_research_extraction_empty:");
    expect(source).toContain("const terminalFailureStatus = failureStatus === 'failed' || failureStatus === 'skipped'");
    expect(source).toContain('status: terminalFailureStatus');
    expect(source).toContain("? 'research_retry_queued'");
  });

  it('accepts an exact Inngest queue target without weakening the manual canary contract', () => {
    const source = routeSource();

    expect(source).toContain("searchParams.get('pipelineQueueId')");
    expect(source).toContain('isInngestBlogAutopilotConfigured()');
    expect(source).toContain('!durablePipelineQueueId && (item.product_id');
    expect(source).toContain('durablePipeline: Boolean(durablePipelineQueueId)');
  });

  it('keeps attempting replacement candidates until the currently due slot quota is filled or time is unsafe', () => {
    const source = routeSource();

    expect(source).toContain("readBoundedIntEnv('BLOG_PUBLISHER_MAX_EXTRA_CLAIM_ROUNDS', 4, 1, 8)");
    expect(source).toContain('slotCompletionsThisRun < remainingDueNow');
    expect(source).toContain('extraClaimRounds < MAX_EXTRA_CLAIM_ROUNDS');
    expect(source).toContain('attemptedQueueIds.size < MAX_CANDIDATE_ATTEMPTS_PER_RUN');
    expect(source).toContain('calculateBlogPublishSlotQuota({');
    expect(source).toContain("'daily_publish_quota_reached_atomic_upgrade_processed'");
    expect(source).toContain('PUBLISHED_BLOG_ATOMIC_UPGRADE_MODE');
    expect(source).toContain("const evidenceContentKey = contentBoundary.lane === 'informational'");
    expect(source).toContain('expectedContentKey: evidenceContentKey');
    expect(source).toContain('contentKey: evidenceContentKey');
    expect(source).toContain('information_evidence_content_key: evidenceContentKey');
    expect(source).toContain('applyFinalResearchStructureRepair();');
    expect(source).toContain('evaluateBlogAutopublishDecisionV3');
    expect(source).toContain('loadQueueDemandEvidenceV3(item)');
    expect(source).toContain('verified_demand_signal_missing_before_generation');
    expect(source).toContain('demand_signal_repository_unavailable_before_generation');
    const snapshotRefresh = source.indexOf("rpc('refresh_blog_public_snapshots_v3')");
    const indexingEnqueue = source.indexOf('const result = await enqueueBlogIndexingJob({');
    expect(snapshotRefresh).toBeGreaterThan(0);
    expect(snapshotRefresh).toBeLessThan(indexingEnqueue);
    expect(source).toContain("publicSnapshotRefresh.status === 'succeeded'");
    expect(source).toContain('probeBlogRuntimeSchemaWithSupabaseV3');
    expect(source).toContain("resource.scope === 'publish' || resource.scope === 'delivery'");
    expect(source).toContain('!schemaReadiness.publishReady || !schemaReadiness.deliveryReady');
    expect(source).toContain("reason: 'blog_quality_v3_runtime_schema_not_ready'");
    expect(source).toContain('loadBlogCorpusDiversityV4');
    expect(corpusDiversitySource()).toContain('evaluateBlogCorpusCandidateV3');
    expect(source).toContain('evaluateBlogQualityV3');
    expect(source).toContain("gate.gate === 'image_quality'");
    expect(source).toContain("gate.gate === 'links'");
    expect(source).toContain('intentCompletionScore: taskCompletion01');
    expect(source).toContain('[BLOG_INFORMATION_RESEARCH_META_KEY]: null');
    expect(source).toContain('information_research_fingerprint: null');
    expect(source).toContain("forceQueue: qualityRouteV4.route !== 'quarantine'");
    expect(source).toContain('const forceOrchestratorQueue = retryPolicy?.forceQueue === true');
    expect(source).toContain('const isDuplicateFailure = isBlogDuplicateQueueFailure(reason)');
    expect(source).toContain('failure_retryable: forceOrchestratorQueue || decision.retryable');
    expect(source).not.toContain('const duplicateTaggedFailure =');
    expect(source).toContain("failureStatus === 'queued' ? 'rewrite_queued' : failureStatus");
    expect(source).not.toContain("'local_transport_deterministic_evidence_article'");
    expect(source).not.toContain('softenKeywordDensity');
    expect(source).not.toContain('seoMetadataDetailsNeedRepair');
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
    const representativePreclaim = source.indexOf('findBlogInformationRepresentative(representativeKey)');
    const topicGeneration = source.indexOf("topic_generation', () => generateFromTopic(item, {");
    expect(representativePreclaim).toBeGreaterThanOrEqual(0);
    expect(topicGeneration).toBeGreaterThan(representativePreclaim);
    expect(source).toContain('information_representative_preclaim:');
  });

  it('preserves the information micro angle through generation and quality evaluation', () => {
    const source = routeSource();

    expect(source).toContain('function getGeneratedQualityMicroAngle');
    expect(source).toContain('microAngleForInformationIntent(intent)');
    expect(source).toContain('micro_angle: getGeneratedQualityMicroAngle(generated, item)');
    expect(source).toContain('micro_angle: getQueueMicroAngle(item) ?? microAngleForInformationIntent(contentBrief.plan.intent)');
  });

  it('keeps excluded rewrite facts out of the decision-artifact prompt', () => {
    const source = routeSource();

    expect(source).toContain('restrictBlogDecisionArtifactFactsV1(');
    expect(source).toContain('buildBlogDecisionArtifactPromptBlockV1(rewriteDecisionArtifact)');
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
    const writer = source.indexOf('const generation = await generatePublisherBlogText', blocker);

    expect(generatorStart).toBeGreaterThanOrEqual(0);
    expect(planner).toBeGreaterThan(generatorStart);
    expect(blocker).toBeGreaterThan(planner);
    expect(writer).toBeGreaterThan(blocker);
    expect(source).toContain('missing_inputs: contentBrief.plan.missingInputs');
  });

  it('keeps high-risk informational drafts private until a human review is completed', () => {
    const source = routeSource();

    expect(source).toContain('isHighRiskInformationalTopic({');
    expect(source).toContain('const contentRequiresHumanReview');
    expect(source).toContain("status: publishAllowed ? 'published' : 'draft'");
    expect(source).toContain("review_status: (publishAllowed || approvedForDeferredPublication) ? contentReviewStatus : 'pending_review'");
    expect(source).toContain('representativeIdentity && !requiresHumanReview');
    expect(source).toContain('publishBlogInformationAtomically({');
    expect(source).toContain("status: 'pending_review'");
    expect(source).toContain('createBlogInformationEvidenceWorkflowStore({');
    expect(source).toContain("state: 'pending_review'");
    expect(source).toContain('markBlogGenerationRunForHumanReviewV4({');
    expect(source).toContain('review_case_research_missing:');
  });

  it('closes model-approved runs when a downstream publication gate blocks the queue', () => {
    const source = routeSource();
    const failureHandler = source.slice(source.indexOf('async function handleFailure'));

    expect(failureHandler).toContain("const blockedRunStatus = finalStatus === 'failed' ? 'quarantine' : 'human_review'");
    expect(failureHandler).toContain(".eq('status', 'generating')");
    expect(failureHandler).toContain('scheduled_publish_at: null');
    expect(failureHandler).toContain('publication_gate_${finalStatus}');
  });

  it('replaces quarantined fallback posts in place and always sends them to private review', () => {
    const source = routeSource();

    expect(source).toContain('readPrivateBlogRegenerationRequest(item)');
    expect(source).toContain('hasPrivateBlogRegenerationIntent(item)');
    expect(source).toContain('isEligiblePrivateBlogRegenerationTarget');
    expect(source).toContain("const reason = 'private_regeneration_request_invalid'");
    expect(source).toContain("const reason = 'private_regeneration_target_not_eligible'");
    expect(source).toContain('validatedPrivateRegenerationRequest: privateRegenerationRequest ?? undefined');
    expect(source).toContain('options.validatedPrivateRegenerationRequest');
    expect(source).toContain('generateFromTopic(item, {');
    expect(source).toContain(
      'const privateRegenerationRequest = options.validatedPrivateRegenerationRequest',
    );
    expect(source).toContain(
      'const publishedAtomicUpgrade = isPublishedBlogAtomicUpgradeRequest(privateRegenerationRequest);',
    );
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
    expect(source).toContain('isBlogInformationClaimValidationPendingHumanApprovalOnly');
    expect(source).toContain('claimValidationPendingHumanApprovalOnly');
    expect(source).toContain('const publicationTimestamp = publishedAtomicUpgrade && originalPublishedAt');
    expect(source).toContain("status: publishedAtomicUpgrade ? 'upgraded' : 'published'");
    expect(source).toContain('const automatedPublishedReplacement = publishedAtomicUpgrade');
    expect(source).toContain('buildAutomatedPublishedBlogReplacementDraftSlug');
    expect(source).toContain('mode: AUTOMATED_PUBLISHED_BLOG_REPLACEMENT_MODE');
    expect(source).toContain('if (publishedAtomicUpgrade) {');
    expect(source).toContain('&& !publishedAtomicUpgrade');
  });

  it('excludes the in-place replacement draft from its own duplicate check', () => {
    const source = routeSource();
    const corpusSource = corpusDiversitySource();

    expect(source).toContain('excludeContentCreativeId: item.content_creative_id ?? null');
    expect(source).toContain('skipDuplicateCheck: isPublishedBlogAtomicUpgradeRequest(');
    expect(source).toContain('replacementTargetCreativeId: privateRegenerationRequest?.contentCreativeId ?? null');
    expect(corpusSource).toContain('belongsToBlogReplacementLineage');
    expect(corpusSource).toContain('row.canonical_creative_id === input.replacementTargetCreativeId');
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
    expect(source).toContain('const result = await processQueueItem(item, new Map(), { startedAtMs: startTime, deferPublication });');
    expect(source).toContain("result.status === 'approved_for_slot'");
  });

  it('uses a lower-variance writer temperature for private regeneration', () => {
    const source = routeSource();

    expect(source).toContain('temperature: hasPrivateBlogRegenerationIntent(item) ? 0.25 : 0.7');
  });

  it('does not rewrite prose to hit an exact primary keyword quota', () => {
    const source = routeSource();

    expect(source).not.toContain('function repairPrimaryKeywordPresence');
    expect(source).not.toContain('repairKeywordDensityToTarget');
    expect(source).not.toContain('SEO primary keyword repair');
  });

  it('persists SEO component evidence when aggregate SEO remains below the release floor', () => {
    const source = routeSource();

    expect(source).toContain('last_seo_score: {');
    expect(source).toContain('details: seoScore.details');
    expect(source).toContain('information_claim_validation: claimValidationSummary');
    expect(source).toContain('quality_evaluation_v3');
    expect(source).toContain("from('blog_quality_evaluations')");
  });

  it('persists the final SEO score on successful and pending-review queue handoffs', () => {
    const source = routeSource();

    expect(source).toContain('const successfulQueueMeta = {');
    expect(source).toContain('last_seo_score: {');
    expect(source).toContain('score: seoScore.score');
    expect(source).toContain('max_score: seoScore.maxScore');
    expect(source).toContain('summary: seoScore.summary');
    expect(source.indexOf('...(generated.generation_meta || {}),')).toBeLessThan(
      source.indexOf('last_seo_score: {', source.indexOf('...(generated.generation_meta || {}),')),
    );
  });

  it('normalizes literal newline escapes at every final quality boundary', () => {
    const source = routeSource();

    expect(source).toContain('const applyFinalLiteralNewlineRepair = (): void => {');
    expect(source).toContain('repairBlogLiteralNewlines(generated.blog_html)');
    expect(source.match(/applyFinalLiteralNewlineRepair\(\);/g)).toHaveLength(2);
    expect(source).toContain('replacement_count: literalNewlineRepair.replacementCount');
  });

  it('avoids duplicate AI and image work during a controlled private regeneration', () => {
    const source = routeSource();

    expect(source).toContain('const privateRegeneration = privateRegenerationRequest !== null');
    expect(source).toContain('const shouldAnalyzeSerp = !privateRegeneration && Boolean(');
    expect(source).not.toContain('maybeApplyChainOfDensity');
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
    expect(source).toContain('queueMetaWithoutResearchBundleV4 as queueMetaWithoutResearchBundle');
    expect(publisherBriefSource()).toContain("delete safeMeta[BLOG_INFORMATION_RESEARCH_META_KEY]");
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

    expect(source).toContain('parseBlogInformationWriterOutput(generation.text)');
    expect(source).not.toContain('repairBlogGenerationResearchStructure({');
    expect(source).toContain('information_research_structure_repair: {');
    expect(source).toContain('const applyFinalResearchStructureRepair = (): void =>');
    expect(source).toContain("policy: 'v3_claim_gate_only_no_deterministic_prose_rewrite'");
    expect(source).toContain('const runQualityWithResearchStructure = async (): Promise<QualityGateReport> =>');
    expect(source).toContain('const runQualityAfterAiReadableRepair = async (): Promise<QualityGateReport> =>');
    expect(source).toContain('const restoreFinalReusableImages = async (): Promise<void> =>');
    expect(source).toContain('const applyFinalGateCustomerSurfaceRepair = (): void =>');
    expect(source).toContain('const applyFinalInlineSurfaceRepair = (): void =>');
    expect(source).toContain('await restoreFinalReusableImages();');
    const finalQualityBoundary = source.indexOf(
      'const runQualityWithResearchStructure = async (): Promise<QualityGateReport> =>',
    );
    const finalSurfaceRepair = source.indexOf(
      'applyFinalGateCustomerSurfaceRepair();',
      finalQualityBoundary,
    );
    const finalResearchRepair = source.indexOf(
      'applyFinalResearchStructureRepair();',
      finalSurfaceRepair,
    );
    const finalImageRestore = source.indexOf('await restoreFinalReusableImages();', finalResearchRepair);
    const finalInlineSurfaceRepair = source.indexOf(
      'applyFinalInlineSurfaceRepair();',
      finalImageRestore,
    );
    const finalQualityGate = source.indexOf(
      'return runGeneratedQualityGates(generated, item, blogType, primaryKeyword);',
      finalInlineSurfaceRepair,
    );
    expect(finalQualityBoundary).toBeGreaterThan(-1);
    expect(finalSurfaceRepair).toBeGreaterThan(finalQualityBoundary);
    expect(finalResearchRepair).toBeGreaterThan(finalSurfaceRepair);
    expect(finalImageRestore).toBeGreaterThan(finalResearchRepair);
    expect(finalInlineSurfaceRepair).toBeGreaterThan(finalImageRestore);
    expect(finalQualityGate).toBeGreaterThan(finalInlineSurfaceRepair);
    expect(source).toContain('hasRenderedPageH1: true');
    expect(source).not.toContain('seoMetadataDetailsNeedRepair');
    expect(source).toContain('qa = await runQualityWithResearchStructure();');
    expect(source).toContain('qa = await runQualityAfterAiReadableRepair();');
    const genericRepair = source.indexOf('qa = await repairFailedQualityGates(generated, item, qa, blogType, primaryKeyword);');
    const finalAiRepair = source.indexOf('qa = await runQualityAfterAiReadableRepair();', genericRepair);
    expect(genericRepair).toBeGreaterThan(-1);
    expect(finalAiRepair).toBeGreaterThan(genericRepair);
    expect(source).toContain('quality gate failed; preserving generated content as a private review draft');
    expect(source).toContain('writer_claim_ledger: {');
    expect(source).toContain("claimLedger: contentBoundary.lane === 'informational'");
    expect(source).toContain("claimLedgerIssues: contentBoundary.lane === 'informational'");
    expect(source).toContain('toBlogInformationClaimValidationMeta(reviewClaimValidation)');
    expect(source).toContain(
      'isBlogInformationClaimValidationPendingHumanApprovalOnly(reviewClaimValidation)',
    );
    expect(source).toContain('const evaluateCurrentInformationClaimValidation = async () =>');
    expect(source).toContain('const preSeoClaimValidation = await evaluateCurrentInformationClaimValidation();');
    expect(source).toContain('const finalClaimValidation = await evaluateCurrentInformationClaimValidation();');
    expect(source).toContain('isHighRiskInformationalTopic({');
    expect(source).toContain('researchReadiness.passed');
    expect(source).not.toContain('forceDeterministicEvidenceArticle:');
    expect(source).toContain('const applyFinalInternalLinkFloor = (): void =>');
    expect(source).not.toContain('여행 정보 아카이브](/blog)');
    expect(source).not.toContain('entry_requirements_deterministic_evidence_article');
    expect(source).toContain('? { auto_research: item.meta.auto_research }');
    const preSeoClaimValidation = source.indexOf(
      'const preSeoClaimValidation = await evaluateCurrentInformationClaimValidation();',
    );
    const seoEvaluation = source.indexOf('let seoScore = computeSeoScore(buildSeoScoreInput());');
    const finalClaimValidation = source.indexOf(
      'const finalClaimValidation = await evaluateCurrentInformationClaimValidation();',
    );
    expect(preSeoClaimValidation).toBeGreaterThan(-1);
    expect(seoEvaluation).toBeGreaterThan(preSeoClaimValidation);
    expect(finalClaimValidation).toBeGreaterThan(seoEvaluation);
    expect(source).toContain("from('content_review_queue')");
    expect(source).toContain(".update({ status: 'skipped' })");
    expect(source).toContain(".in('status', ['queued', 'assigned'])");
  });

  it('records article-quality failures without deterministic content repair', () => {
    const source = routeSource();

    expect(source).not.toContain("from '@/lib/blog-article-quality-v2-repair'");
    expect(source).not.toContain('repairArticleQualityV2Specifics');
    expect(source).toContain('V3 records failed dimensions and routes the generated draft to review');
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

  it('bounds grounded writer output and makes DeepSeek thinking explicit by stage', () => {
    const source = routeSource();

    expect(source).toContain('const BLOG_PUBLISHER_AI_MAX_OUTPUT_TOKENS = 8_192');
    expect(source).toContain('const BLOG_PUBLISHER_AI_REWRITE_MAX_OUTPUT_TOKENS = 8_192');
    expect(source).toContain("'BLOG_PUBLISHER_AI_REWRITE_TIMEOUT_MS'");
    expect(source).toContain("'BLOG_PUBLISHER_GENERATION_TIMEOUT_MS'");
    expect(source).toContain('190_000');
    expect(source).toContain('const MAX_EXEC_MS = 270_000');
    expect(source).toContain("const isRewrite = context.stage !== 'draft_flash'");
    expect(source).toContain('? BLOG_PUBLISHER_AI_REWRITE_MAX_OUTPUT_TOKENS');
    expect(source).toContain("deepseekThinking: execution.provider === 'deepseek'");
    expect(source).toContain("options.deepseekThinking ?? execution.deepseekThinking ?? 'disabled'");
    expect(source).toContain('const writerOutputBoundary = boundBlogWriterOutput(blog_html)');
    expect(source).toContain('writer_output_boundary: {');
    expect(source).toContain('? BLOG_PUBLISHER_AI_REWRITE_PROVIDER_TIMEOUT_MS');
    expect(source).toContain('isRewrite ? BLOG_PUBLISHER_AI_REWRITE_TIMEOUT_MS : BLOG_PUBLISHER_AI_TIMEOUT_MS');
    expect(source).toContain('model: BLOG_DEEPSEEK_MODELS.rewrite');
    expect(source).not.toContain("fallback: 'gemini'");
  });

  it('normalizes the writer H1 before deterministic decision-artifact composition', () => {
    const source = routeSource();
    const normalizeIndex = source.indexOf('const headingNormalizedWriterOutput =');
    const composeIndex = source.indexOf('const writerOutput = applyBlogDecisionArtifactToWriterOutputV1({');

    expect(normalizeIndex).toBeGreaterThan(-1);
    expect(composeIndex).toBeGreaterThan(normalizeIndex);
    expect(source).toContain('output: headingNormalizedWriterOutput');
    expect(source).not.toContain('repairFoodBudgetRewriteOpeningV4({');
  });

  it('runs the independent editorial judge for high-risk drafts as well as the human gate', () => {
    const source = routeSource();
    const harnessBoundary = source.indexOf("if (blogType === 'info' && storedDecisionArtifact)");
    const judgeCall = source.indexOf('await evaluatePublisherEditorialHarnessV5({', harnessBoundary);
    const evaluationWrite = source.indexOf(".from('blog_quality_evaluations')", judgeCall);

    expect(harnessBoundary).toBeGreaterThan(-1);
    expect(judgeCall).toBeGreaterThan(harnessBoundary);
    expect(evaluationWrite).toBeGreaterThan(judgeCall);
    expect(source).not.toContain("if (contentBriefV3.riskLevel === 'HIGH') {");
    expect(source).toContain('const contentRequiresHumanReview = blogType === \'info\'');
    expect(source).toContain('|| plannedHumanReview || isHighRiskInformationalTopic({');
  });

  it('persists incomplete provider calls as failed attempts and never evaluates partial text', () => {
    const source = routeSource();

    expect(source).toContain('const providerFailureCode = classifyBlogAiProviderFailure(err)');
    expect(source).toContain("attemptStatus: 'failed'");
    expect(source).toContain("hardBlockers: ['model_output_incomplete']");
    expect(source).toContain('provider_finish_reason: failureReceipt.finishReason');
    expect(source).toContain("next_stage: terminal ? null : retrySameStage ? stage : 'rewrite_pro_max'");
    expect(source).toContain('forceQueue: !terminal');
    expect(source).toContain("'blog_ai_transport_error'");
    expect(source).toContain("? 'timeout'");
    expect(source).toContain("readLatestBlogModelCallAttemptNumberV4(");
    expect(source).toContain('attemptNumber: generationAttemptNumber');
    expect(source).toContain('attempt: generationAttemptNumber');
    expect(source).toContain("latestModelCallAttemptNumber >= 2 ? 'rewrite_pro_max' : 'rewrite_pro_high'");
    expect(source).toContain("deepseekThinking: 'disabled'");
    expect(source).toContain('thinking: generation.receipt.thinkingMode');
    expect(source).not.toContain("generationStage === 'rewrite_pro_max' ? 'max' : 'high'");
    expect(source).toContain('evidencePacket: {');
    expect(source).toContain('approvedClaims: rewriteApprovedClaims');
    expect(source).toContain('inspectBlogInformationClaimLiteralSupport');
    expect(source).toContain('officialSourceUrls: [...new Set(artifactResearchBundle.sources');
    expect(source).toContain('const seo_title = contentBriefV3.metadata.title.trim().slice(0, 80)');
    expect(source).toContain('const publishQualityFailureReasons = [');
    expect(source).toContain('`publish_gate:${gate.gate}`');
    expect(source).toContain('score: orchestrationQualityScore');
    expect(source).toContain('publish_quality_passed: publishQuality.passed');
  });
});
