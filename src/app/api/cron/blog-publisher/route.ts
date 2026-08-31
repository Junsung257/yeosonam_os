import { NextRequest, NextResponse } from 'next/server';
import { cronUnauthorizedResponse, isCronOrVercelAuthorized } from '@/lib/cron-auth';
import { logWarning } from '@/lib/sentry-logger';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { CUSTOMER_VISIBLE_STATUSES } from '@/lib/visibility-status';
import { runQualityGates, type QualityGateReport } from '@/lib/blog-quality-gate';
import {
  BlogAiResponseError,
  classifyBlogAiProviderFailure,
  generateBlogTextWithReceipt,
  hasBlogApiKey,
  type BlogAiTextResult,
} from '@/lib/blog-ai-caller';
import { generateBlogSeo, type AngleType } from '@/lib/content-generator';
import { buildProductBlogBrief, buildProductSlugSuffix } from '@/lib/blog-product-brief';
import { generateProductConsultantBlogPost } from '@/lib/blog-product-consultant-writer';
import {
  BLOG_EDITORIAL_VOICE,
  buildInfoGuideBrief,
  buildInfoWriterPromptBlock,
  buildProductConsultBrief,
  buildProductConsultantPromptBlock,
} from '@/lib/blog-editorial-voice';
import { enqueueBlogIndexingJob } from '@/lib/blog-indexing-outbox';
import { processDueBlogIndexingJobs } from '@/lib/blog-indexing-worker';
import { resolveBlogCanonicalOrigin } from '@/lib/blog-canonical-url';
import { revalidatePublicBlogCache } from '@/lib/revalidate-blog-cache';
import { withCronLogging } from '@/lib/cron-observability';
import { analyzeSerp, buildSerpPromptBlock } from '@/lib/serp-analyzer';
import { researchKeyword, enrichWithGscData } from '@/lib/keyword-research';
import { computeSeoScore } from '@/lib/blog-seo-scorer';
import { extractFaqItems, extractHowToSteps } from '@/lib/blog-jsonld';
import {
  evaluateBlogPublishQuality,
  isBlogSeoDetailBlockingForPublish,
  type BlogPublishQualityReport,
} from '@/lib/blog-publish-quality';
import { buildBlogQueueSuccessMeta } from '@/lib/blog-queue-success-meta';
import { withPersistedBlogReadingTime } from '@/lib/blog-reading-time';
import { repairPublisherSeoSlug } from '@/lib/blog-publisher-repair';
import { repairBlogSeoMetadata } from '@/lib/blog-seo-repair';
import {
  ensureBlogInlineImages,
  extractBlogInlineImageUrls,
  findRelevantBlogPexelsImage,
} from '@/lib/blog-inline-images';
import { generateSectionImage, isGeneratedBlogImageUrl } from '@/lib/blog-image-gen';
import { enqueuePublishedBlogCover } from '@/lib/blog-media-jobs';
import { indexBlog } from '@/lib/jarvis/rag/indexer';
import { parsePublisherBridgeResponse } from '@/lib/blog-card-news-bridge';
import { calculateBlogPublishSlotQuota } from '@/lib/blog-publish-slot-quota';
import { buildBlogPackageCtaUrl, sanitizeBlogCtaLinks } from '@/lib/blog-cta';
import { boundBlogWriterOutput } from '@/lib/blog-writer-output-boundary';
import { repairBlogLiteralNewlines } from '@/lib/blog-literal-newline-repair';
import { repairBlogPublishFormattingV3 } from '@/lib/blog-safe-publish-repair-v3';
import {
  fetchApprovedReviewSnippets,
  formatReviewQuotesAppendMarkdown,
  formatReviewQuotesForPrompt,
} from '@/lib/blog-review-quotes';
import { getCardNewsRenderBufferMs, getEarliestBlogPublishEligibleMsBatch } from '@/lib/card-news-render-readiness';
import { getSlideImagePublicUrlsForBlog } from '@/lib/card-news-slide-urls';
import { recordAutoPublishLog } from '@/lib/publish-orchestration';
import { ensureAutoAdMappingsForBlog } from '@/lib/blog-ad-mapping-auto';
import { getSecret } from '@/lib/secret-registry';
import {
  slugifyTopic,
  romanize,
  extractDestination,
  slugIncludesDestination,
} from '@/lib/slug-utils';
import { VALID_CATEGORIES } from '@/lib/blog-categories';
import {
  customerOpenContractBlogBlockReason,
  isCustomerOpenContractBlogPublishable,
  loadCustomerOpenContractForPackage,
} from '@/lib/product-registration/customer-open-contract';
import { isPexelsConfigured } from '@/lib/pexels';
import { BLOG_INFORMATION_PROMPT_VERSION, BLOG_PROMPT_VERSION } from '@/lib/prompt-version';
import { BLOG_STYLE_GUIDE } from '@/prompts/blog/style-guide';
import {
  BLOG_INFORMATION_WRITER_GUIDE,
  isValidInformationalWriterGuide,
} from '@/prompts/blog/informational-writer-guide';
import { selectActiveBlogPrompt, type SelectedBlogPrompt } from '@/lib/blog-prompt-selection';
import {
  buildInformationalDepthBlock,
  buildInformationalQualityBlock,
  buildInformationalWriterPrompt,
} from '@/lib/blog-informational-writer-prompt';
import { buildFreshnessPromptBlock, classifyBlogFreshnessRisk } from '@/lib/blog-freshness-risk';
import { buildBlogContentBrief } from '@/lib/blog-content-brief';
import {
  BLOG_INFORMATION_RESEARCH_META_KEY,
  buildBlogGenerationResearchPromptBlock,
  evaluateBlogGenerationResearchReadiness,
  summarizeBlogGenerationResearch,
} from '@/lib/blog-generation-research';
import {
  markBlogInformationResearchClaimsSupported,
  persistBlogInformationResearch,
} from '@/lib/blog-information-evidence-repository';
import { researchBlogInformationAutomatically } from '@/lib/blog-auto-research';
import { buildBlogIntentPromptContract, classifyBlogIntent } from '@/lib/blog-content-intent';
import { ensureDailyPublishableQueue, getBlogPublishingPolicy, MIN_PUBLISHABLE_BUFFER_DAYS, normalizeDailyPostTarget } from '@/lib/blog-scheduler';
import {
  classifyBlogQueueFailure,
  isBlogDuplicateQueueFailure,
  shouldSelfHealBlogQueueItem,
} from '@/lib/blog-queue-failure-policy';
import { normalizeBlogAngleType } from '@/lib/blog-queue-normalize';
import { evaluateBlogTopicFit } from '@/lib/blog-topic-fit-gate';
import {
  quarantineNonRetryableBlogQueueItems,
  recoverRequeueableFailedBlogQueueItems,
  rescheduleOverdueQueuedBlogQueueItems,
} from '@/lib/blog-queue-lifecycle';
import { choosePublisherPrimaryKeyword } from '@/lib/blog-publisher-primary-keyword';
import {
  canRunOptionalPublisherWork,
  canStartPublisherItemWithFallback,
  getPublisherExtraClaimRecoveryPlan,
  getPublisherGenerationTimeoutMs,
  getPublisherRemainingMs,
  getUnattemptedClaimReleaseIds,
  sortPublisherQueueForTimeBudget,
} from '@/lib/blog-publisher-time-budget';
import { readBoundedIntEnv } from '@/lib/env-utils';
import { isHighRiskInformationalTopic } from '@/lib/blog-publication-review-policy';
import { routeBlogContentLane } from '@/lib/blog-content-boundary';
import {
  evaluateBlogInformationClaimPublishGate,
  isBlogInformationClaimValidationPendingHumanApprovalOnly,
  persistBlogInformationClaimFindings,
  toBlogInformationClaimValidationMeta,
} from '@/lib/blog-information-claim-publish-gate';
import {
  parseBlogInformationWriterOutput,
  restoreApprovedRewriteClaimLabels,
  type BlogInformationClaimLedgerEntry,
} from '@/lib/blog-information-claim-ledger';
import {
  countUnsupportedNumericBlogInformationClaims,
  inspectBlogInformationClaimTypeCompatibility,
} from '@/lib/blog-information-claim-validator';
import {
  buildBlogInformationRepresentativeKey,
  canUpgradePublishedBlogForRepresentative,
  readBlogInformationRepresentativeIdentity,
  type BlogInformationDuplicateDecision,
  type BlogInformationRepresentativeIdentity,
} from '@/lib/blog-information-representative';
import {
  attachBlogInformationRepresentativeDraft,
  findBlogInformationRepresentative,
  reserveBlogInformationRepresentative,
} from '@/lib/blog-information-representative-repository';
import { publishBlogInformationAtomically } from '@/lib/blog-information-atomic-publication';
import { createBlogInformationContentFingerprint } from '@/lib/blog-information-review-workflow';
import {
  buildBlogGenerationDedupMetadata,
} from '@/lib/blog-generation-dedup';
import {
  bindBlogGenerationDedup,
  claimBlogGenerationDedup,
  releaseBlogGenerationDedup,
} from '@/lib/blog-generation-dedup-repository';
import { createBlogInformationEvidenceWorkflowStore } from '@/lib/blog-information-review-repository';
import {
  evaluateBlogAutopublishDecisionV3,
  hasVerifiedBlogDemandSignal,
  readBlogAutopublishPolicyV3,
  type BlogDemandSignalInput,
} from '@/lib/blog-autopublish-policy-v3';
import {
  mergePersistedBlogDemandSignalsV3,
  readEmbeddedBlogQueueDemandSignalV3,
  type PersistedBlogDemandSignalV3,
} from '@/lib/blog-demand-repository-v3';
import {
  aggregateObservedBlogSearchMetricsV3,
  scoreBlogDemandCandidateV3,
} from '@/lib/blog-demand-engine-v3';
import {
  buildBlogContentBriefV3,
  buildBlogContentBriefV3PromptBlock,
  resolveVerifiedFirstPartySourceIdsV3,
  type BlogContentBriefV3,
} from '@/lib/blog-content-brief-v3';
import {
  buildSerpResearchPromptBlockV3,
  findCompetitorPhraseMatchesV3,
  prioritizeBlogSerpInitialCandidatesV3,
  researchSerpNaverFirstV3,
  type SerpResearchPacketV3,
} from '@/lib/blog-serp-research-v3';
import { enrichBlogDemandWithNaverV3 } from '@/lib/blog-live-demand-v3';
import {
  inspectBlogInformationClaimLiteralSupport,
  isPrimaryInformationAuthority,
  type BlogInformationResearchBundle,
} from '@/lib/blog-information-evidence';
import { evaluateBlogQualityV3 } from '@/lib/blog-quality-evaluator-v3';
import {
  BLOG_DEEPSEEK_MODELS,
  BLOG_QUALITY_MAX_ATTEMPTS_V4,
  buildDeepSeekRewritePromptV4,
  decideBlogQualityRouteV4,
  nextBlogPublicationSlotKstV4,
  normalizeBlogWriterHeadingV4,
  resolveBlogGenerationModelV4,
  selectDecisionRelevantRewriteClaimsV4,
  type BlogDeepSeekStage,
} from '@/lib/blog-deepseek-orchestrator-v4';
import {
  approveBlogGenerationRunForSlotV4,
  isEligibleBlogGenerationAttemptRevalidationV4,
  markBlogGenerationRunForHumanReviewV4,
  readLatestBlogGenerationAttemptV4,
  readLatestBlogModelCallAttemptNumberV4,
  nextBlogModelCallAttemptNumberV4,
  recordBlogGenerationAttemptV4,
  revalidateBlogGenerationAttemptV4,
  reserveBlogAiBudgetBeforeCallV4,
  reserveBlogEditorialJudgeBudgetBeforeCallV5,
  settleBlogAiBudgetReservationV4,
} from '@/lib/blog-generation-run-v4';
import {
  estimateBlogAiCallReservationUsdV4,
  estimateBlogEditorialJudgeReservationUsdV5,
} from '@/lib/blog-ai-budget-v4';
import {
  applyBlogDecisionArtifactToWriterOutputV1,
  buildBlogDecisionArtifactPromptBlockV1,
  buildBlogDecisionArtifactV1,
  buildBlogEditorialJudgePromptV1,
  buildBlogPromptTraceV1,
  combineBlogEditorialHarnessV1,
  inspectBlogEditorialDeterministicallyV1,
  parseBlogEditorialJudgeReportV1,
  restrictBlogDecisionArtifactFactsV1,
  withBlogDecisionArtifactClaimsV1,
  type BlogDecisionArtifactV1,
  type BlogEditorialHarnessReportV1,
  type BlogPromptTraceV1,
} from '@/lib/blog-editorial-harness-v5';
import {
  BLOG_RUNTIME_RESOURCES_V3,
  probeBlogRuntimeSchemaWithSupabaseV3,
} from '@/lib/blog-runtime-readiness-v3';
import {
  evaluateBlogCorpusCandidateV3,
  type BlogCorpusCandidateV3,
  type BlogCorpusDiversityEvaluationV3,
} from '@/lib/blog-corpus-diversity-v3';
import { belongsToBlogReplacementLineage } from '@/lib/blog-corpus-lineage-v3';
import { PUBLIC_BLOG_READ_SOURCE } from '@/lib/blog-public-eligibility';
import { buildRecentInfoDuplicateScope } from '@/lib/blog-info-duplicate-scope';
import {
  AUTOMATED_PUBLISHED_BLOG_REPLACEMENT_MODE,
  buildAutomatedPublishedBlogReplacementDraftSlug,
  buildReviewedPublishedBlogReplacementDraftSlug,
  hasPrivateBlogRegenerationIntent,
  isEligiblePrivateBlogRegenerationTarget,
  isPublishedBlogAtomicUpgradeRequest,
  PUBLISHED_BLOG_ATOMIC_UPGRADE_MODE,
  preservePublishedBlogAtomicUpgradeSlug,
  REVIEWED_PUBLISHED_BLOG_REPLACEMENT_MODE,
  readPrivateBlogRegenerationRequest,
  type PrivateBlogRegenerationRequest,
} from '@/lib/blog-private-regeneration';

/**
 * 블로그 생성/검증 실행기. V4 production schedule은 blog-generate wrapper에서 야간에 호출한다.
 *
 * 로직:
 *   1) blog_topic_queue WHERE target_publish_at <= NOW() AND status='queued' 스캔 (최대 MAX_BATCH)
 *   2) 각 항목:
 *      a. status='generating' 락 (동시성 방지)
 *      b. source 에 따라 생성:
 *         - pillar       → /destinations/[city] 허브 (장문 AI)
 *         - card_news    → from-card-news `publisher_bridge`(본문만) + 퍼블리셔가 단일 INSERT/승격
 *         - product      → product_consultant_writer (템플릿)
 *         - 나머지       → DeepSeek V4 Flash 초안, 필요 시 Pro 제한 재작성
 *      c. claim·수요·중복·언어·공개표면 품질 검증
 *      d. generate_only는 승인 초안만 적재하고, 주간 controller가 모델 호출 없이 공개
 *         Fail → 최대 3회 내 재작성/재연구 후 격리
 *   3) 실패 사유는 error_patterns RAG 에 자동 기록 (자기학습)
 *
 * 멀티테넌시: blog_topic_queue.tenant_id 그대로 content_creatives 에 전파
 *
 * 카드뉴스 경로는 "생성 API가 draft를 먼저 넣고 퍼블리셔가 또 INSERT"하면 멱등이 깨지므로,
 * At-least-once 크론에서 흔한 **단일 커밋 지점** 패턴으로 브리지 호출을 분리함.
 */

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const MAX_BATCH = readBoundedIntEnv('BLOG_PUBLISHER_MAX_BATCH', 1, 1, 4);
const CLAIM_POOL_MULTIPLIER = readBoundedIntEnv('BLOG_PUBLISHER_CLAIM_POOL_MULTIPLIER', 4, 1, 5);
const MAX_CANDIDATE_POOL = readBoundedIntEnv('BLOG_PUBLISHER_MAX_CANDIDATE_POOL', 8, MAX_BATCH, 8);
const MAX_CANDIDATE_ATTEMPTS_PER_RUN = 8;
const BLOG_DAILY_CANDIDATE_CAP = readBoundedIntEnv('BLOG_DAILY_CANDIDATE_CAP', 30, 1, 30);
const MAX_EXTRA_CLAIM_ROUNDS = readBoundedIntEnv('BLOG_PUBLISHER_MAX_EXTRA_CLAIM_ROUNDS', 4, 1, 8);
// V3 never deterministically invents or appends content to satisfy a gate.
const BLOG_AUTOPUBLISH_POLICY_V3 = readBlogAutopublishPolicyV3();
const BLOG_PUBLISHER_AI_TIMEOUT_MS = readBoundedIntEnv('BLOG_PUBLISHER_AI_TIMEOUT_MS', 90_000, 30_000, 180_000);
const BLOG_PUBLISHER_AI_REWRITE_TIMEOUT_MS = readBoundedIntEnv(
  'BLOG_PUBLISHER_AI_REWRITE_TIMEOUT_MS',
  165_000,
  90_000,
  190_000,
);
const BLOG_PUBLISHER_AI_FIRST_PROVIDER_TIMEOUT_MS = 55_000;
const BLOG_PUBLISHER_AI_REWRITE_PROVIDER_TIMEOUT_MS = 150_000;
const BLOG_PUBLISHER_AI_MAX_OUTPUT_TOKENS = 8_192;
// Pro rewrite runs without thinking tokens in the serverless path, leaving the
// full budget for the complete article and hidden claim ledger.
const BLOG_PUBLISHER_AI_REWRITE_MAX_OUTPUT_TOKENS = 8_192;
const BLOG_PUBLISHER_BRIDGE_TIMEOUT_MS = readBoundedIntEnv('BLOG_PUBLISHER_BRIDGE_TIMEOUT_MS', 60_000, 10_000, 120_000);
const BLOG_PUBLISHER_GENERATION_TIMEOUT_MS = readBoundedIntEnv(
  'BLOG_PUBLISHER_GENERATION_TIMEOUT_MS',
  190_000,
  30_000,
  210_000,
);
const BLOG_PUBLISHER_MIN_ITEM_START_MS = readBoundedIntEnv('BLOG_PUBLISHER_MIN_ITEM_START_MS', 75_000, 30_000, 180_000);
const BLOG_PUBLISHER_FAST_FALLBACK_MIN_ITEM_START_MS = readBoundedIntEnv('BLOG_PUBLISHER_FAST_FALLBACK_MIN_ITEM_START_MS', 30_000, 15_000, 90_000);
const BLOG_PUBLISHER_ITEM_FINISH_RESERVE_MS = readBoundedIntEnv('BLOG_PUBLISHER_ITEM_FINISH_RESERVE_MS', 45_000, 15_000, 90_000);
const BLOG_PUBLISHER_OPTIONAL_WORK_MIN_MS = readBoundedIntEnv('BLOG_PUBLISHER_OPTIONAL_WORK_MIN_MS', 45_000, 10_000, 120_000);
// A candidate gets one draft plus up to four DeepSeek repair passes. The
// research bundle/claim fingerprints remain persisted between attempts, so
// retries may change expression and structure but never invent facts. Hard
// factual blockers still terminate before this budget is consumed.
const MAX_ATTEMPTS = BLOG_QUALITY_MAX_ATTEMPTS_V4;
// The outer generation budget must be longer than the 165s DeepSeek Pro
// rewrite budget. Keep 15s below the 285s cron guard and 30s below Vercel.
const MAX_EXEC_MS = 270_000;
const STALE_GENERATING_RECOVERY_MS = 15 * 60 * 1000;

function readQueueDemandSignalV3(item: any): BlogDemandSignalInput {
  return readEmbeddedBlogQueueDemandSignalV3(item);
}

async function loadQueueDemandEvidenceV3(item: any): Promise<{
  repositoryReady: boolean;
  signal: BlogDemandSignalInput;
  acceptedProviders: string[];
  rejectedCount: number;
  error: string | null;
  performance: ReturnType<typeof aggregateObservedBlogSearchMetricsV3>;
}> {
  const base = readQueueDemandSignalV3(item);
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [demandResult, activeProductResult, performanceResult] = await Promise.all([
    supabaseAdmin
      .from('blog_demand_signals')
      .select('provider, signal_value, source_reference, verified_at, expires_at')
      .eq('queue_id', item.id),
    item.product_id
      ? supabaseAdmin
          .from('travel_packages')
          .select('id')
          .eq('id', item.product_id)
          .in('status', [...CUSTOMER_VISIBLE_STATUSES])
          .in('publication_state', ['approved', 'published'])
          .limit(1)
      : Promise.resolve({ data: [], error: null }),
    item.primary_keyword
      ? supabaseAdmin
          .from('blog_search_performance')
          .select('metric_date, clicks, impressions, average_position')
          .eq('query', String(item.primary_keyword).trim())
          .gte('metric_date', since)
          .order('metric_date', { ascending: false })
          .limit(500)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const { data, error } = demandResult;
  if (error) {
    return {
      repositoryReady: false,
      signal: base,
      acceptedProviders: [],
      rejectedCount: 0,
      error: error.message,
      performance: aggregateObservedBlogSearchMetricsV3([]),
    };
  }
  const merged = mergePersistedBlogDemandSignalsV3(
    {
      ...base,
      activeProductRelation: base.activeProductRelation
        || (!activeProductResult.error && Boolean(activeProductResult.data?.length)),
    },
    (data ?? []) as PersistedBlogDemandSignalV3[],
  );
  const liveNaver = hasVerifiedBlogDemandSignal(merged.signal)
    ? { signal: merged.signal, acceptedProviders: [] as string[], errors: [] as string[] }
    : await enrichBlogDemandWithNaverV3(merged.signal, item.primary_keyword || item.topic);
  return {
    repositoryReady: !performanceResult.error,
    signal: liveNaver.signal,
    acceptedProviders: [...new Set([...merged.acceptedProviders, ...liveNaver.acceptedProviders])].sort(),
    rejectedCount: merged.rejectedCount,
    error: [performanceResult.error?.message, ...liveNaver.errors].filter(Boolean).join('|') || null,
    performance: aggregateObservedBlogSearchMetricsV3(performanceResult.data ?? []),
  };
}

async function loadBlogPortfolioSaturationV3(archetype: string, isWeatherContent: boolean): Promise<{
  weatherShare30d: number;
  sameArchetypeInLast10: number;
}> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from(PUBLIC_BLOG_READ_SOURCE)
    .select('category, seo_title, generation_meta, published_at')
    .gte('published_at', since)
    .order('published_at', { ascending: false })
    .limit(100);
  if (error || !data) return { weatherShare30d: 1, sameArchetypeInLast10: 10 };
  const rows = data as Array<{ category?: string | null; seo_title?: string | null; generation_meta?: Record<string, any> | null }>;
  const weather = rows.filter((row) => /weather|날씨|옷차림/i.test(`${row.category || ''} ${row.seo_title || ''}`)).length;
  const sameArchetypeInLast10 = rows.slice(0, 10).filter((row) =>
    row.generation_meta?.content_brief_v3?.archetype === archetype,
  ).length;
  return {
    weatherShare30d: (rows.length + 1) > 0
      ? (weather + (isWeatherContent ? 1 : 0)) / (rows.length + 1)
      : 0,
    sameArchetypeInLast10,
  };
}

async function loadBlogCorpusDiversityV3(input: {
  queueItemId: string;
  excludeCreativeId?: string | null;
  replacementTargetCreativeId?: string | null;
  title: string;
  body: string;
  destination?: string | null;
}): Promise<{ report: BlogCorpusDiversityEvaluationV3 | null; error: string | null }> {
  const [creativesResult, queueResult, representativesResult] = await Promise.all([
    supabaseAdmin
      .from('content_creatives')
      .select('id, seo_title, title, blog_html, destination, status, generation_meta')
      .eq('channel', 'naver_blog')
      .in('status', ['published', 'draft']),
    supabaseAdmin
      .from('blog_topic_queue')
      .select('id, topic, destination, status, meta')
      .in('status', ['queued', 'generating', 'pending_review']),
    supabaseAdmin
      .from('blog_information_representatives')
      .select('canonical_creative_id, canonical_slug, destination_id, status')
      .eq('status', 'active'),
  ]);
  const failures = [creativesResult.error, queueResult.error, representativesResult.error]
    .filter(Boolean)
    .map((error) => error?.message || 'unknown_error');
  if (failures.length) return { report: null, error: `corpus_lookup_failed:${failures.join('|')}` };

  const corpus: BlogCorpusCandidateV3[] = [];
  for (const row of creativesResult.data || []) {
    if (input.excludeCreativeId && row.id === input.excludeCreativeId) continue;
    if (belongsToBlogReplacementLineage({
      id: row.id,
      meta: row.generation_meta,
      replacementTargetCreativeId: input.replacementTargetCreativeId,
    })) continue;
    corpus.push({
      title: String(row.seo_title || row.title || ''),
      body: typeof row.blog_html === 'string' ? row.blog_html : null,
      destination: typeof row.destination === 'string' ? row.destination : null,
      source: row.status === 'draft' ? 'draft' : 'published',
    });
  }
  for (const row of queueResult.data || []) {
    if (row.id === input.queueItemId) continue;
    if (belongsToBlogReplacementLineage({
      meta: row.meta,
      replacementTargetCreativeId: input.replacementTargetCreativeId,
    })) continue;
    corpus.push({
      title: String(row.topic || ''),
      destination: typeof row.destination === 'string' ? row.destination : null,
      source: 'queued',
    });
  }
  for (const row of representativesResult.data || []) {
    if (!row.canonical_slug) continue;
    if (row.canonical_creative_id === input.replacementTargetCreativeId) continue;
    corpus.push({
      title: String(row.canonical_slug).replace(/-/g, ' '),
      destination: typeof row.destination_id === 'string' ? row.destination_id : null,
      source: 'representative',
    });
  }
  return {
    report: evaluateBlogCorpusCandidateV3({
      title: input.title,
      body: input.body,
      destination: input.destination,
    }, corpus.filter((row) => row.title.trim().length > 0)),
    error: null,
  };
}

function getQueueMicroAngle(item: any): string | null {
  const value = item?.meta?.micro_angle;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function microAngleForInformationIntent(intent: unknown): string | null {
  const normalized = typeof intent === 'string' ? intent.trim() : '';
  return ({
    food_budget: 'food_budget',
    monthly_weather: 'weather_packing',
    airport_transport: 'airport_arrival',
    local_transport: 'transport_cost',
    hotel_areas: 'hotel_area',
    family_budget: 'budget_family',
    itinerary: 'itinerary',
    shopping_souvenirs: 'shopping_souvenirs',
    currency_payment: 'currency_payment',
    entry_requirements: 'entry_requirements',
    travel_insurance: 'travel_insurance',
  } as Record<string, string>)[normalized] ?? null;
}

function getGeneratedQualityMicroAngle(generated: GeneratedBlog, item: any): string | null {
  const explicitGenerated = generated.generation_meta?.micro_angle;
  if (typeof explicitGenerated === 'string' && explicitGenerated.trim()) return explicitGenerated.trim();
  const contentBrief = generated.generation_meta?.content_brief;
  const intent = contentBrief && typeof contentBrief === 'object' && !Array.isArray(contentBrief)
    ? (contentBrief as Record<string, unknown>).intent_type
    : null;
  return getQueueMicroAngle(item) ?? microAngleForInformationIntent(intent);
}

function buildQueueContentBrief(item: any) {
  const queuedKeywords = Array.isArray(item.meta?.keywords) ? item.meta.keywords as string[] : [];
  return buildBlogContentBrief({
    topic: item.topic,
    destination: item.destination,
    primaryKeyword: item.primary_keyword || item.destination || item.topic.split(' ')[0],
    category: item.category,
    source: item.source,
    keywords: queuedKeywords,
    microAngle: getQueueMicroAngle(item),
    audience: typeof item.meta?.audience === 'string' ? item.meta.audience : null,
    locale: typeof item.meta?.locale === 'string' ? item.meta.locale : null,
    travelerNationality: typeof item.meta?.traveler_nationality === 'string'
      ? item.meta.traveler_nationality
      : null,
  });
}

function buildResearchBackedContentBriefV3(input: {
  item: any;
  legacyBrief: ReturnType<typeof buildQueueContentBrief>;
  researchBundle: BlogInformationResearchBundle;
  serpResearch: SerpResearchPacketV3 | null;
}): BlogContentBriefV3 {
  const evidenceByKey = new Map(input.researchBundle.evidence.map((evidence) => [evidence.evidenceKey, evidence]));
  const sourceByKey = new Map(input.researchBundle.sources.map((source) => [source.sourceKey, source]));
  const destinationDecisionDetails = input.researchBundle.claims
    .filter((claim) => claim.requiresEvidence && claim.evidenceKeys.length > 0 && claim.claimText.trim().length > 0)
    .map((claim) => {
      const evidence = evidenceByKey.get(claim.evidenceKeys[0]);
      const source = evidence ? sourceByKey.get(evidence.sourceKey) : null;
      return {
        text: claim.claimText,
        evidenceId: claim.claimFingerprint,
        sourceType: source?.sourceType,
      };
    })
    .filter((detail, index, rows) => rows.findIndex((row) => row.evidenceId === detail.evidenceId) === index)
    .slice(0, 12);
  const bundleEvidenceTypes = new Set(input.researchBundle.claims.map((claim) => claim.claimType));
  const availableEvidenceTypes = [
    ...bundleEvidenceTypes,
    ...(input.researchBundle.claims.filter((claim) => claim.claimType === 'climate').length >= 12
      ? ['climate_series']
      : []),
    ...(input.researchBundle.sources.some((source) => source.authorityLevel === 'field_observation' || source.sourceType === 'field_research')
      ? ['first_party']
      : []),
  ];
  const registeredFirstPartyIds = Array.isArray(input.item.meta?.first_party_source_ids)
    ? input.item.meta.first_party_source_ids.filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  const verifiedFirstPartyIds = resolveVerifiedFirstPartySourceIdsV3({
    registeredIds: registeredFirstPartyIds,
    sources: input.researchBundle.sources,
  });
  return buildBlogContentBriefV3({
    topic: input.item.topic,
    destination: input.item.destination,
    primaryKeyword: input.item.primary_keyword || input.legacyBrief.primaryKeyword,
    secondaryQueries: [
      ...(Array.isArray(input.item.meta?.keywords) ? input.item.meta.keywords : []),
      ...input.legacyBrief.secondaryKeywords,
    ].filter((value): value is string => typeof value === 'string'),
    audience: typeof input.item.meta?.audience === 'string' ? input.item.meta.audience : null,
    availableEvidenceTypes,
    // A queue meta ID is not evidence by itself. Experience language is enabled
    // only when the ID resolves to a persisted field-observation source in the
    // current validated research packet.
    firstPartySourceIds: [...new Set(verifiedFirstPartyIds)],
    customerQuestionIds: Array.isArray(input.item.meta?.customer_question_ids)
      ? input.item.meta.customer_question_ids.filter((value: unknown): value is string => typeof value === 'string')
      : [],
    destinationDecisionDetails,
    serpResearch: input.serpResearch,
  });
}

function queueMetaWithoutResearchBundle(meta: unknown): Record<string, unknown> {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {};
  const safeMeta = { ...(meta as Record<string, unknown>) };
  delete safeMeta[BLOG_INFORMATION_RESEARCH_META_KEY];
  return safeMeta;
}

async function findOrGenerateBlogCover(input: {
  destination: string;
  primaryKeyword: string;
  sectionTitle: string;
}): Promise<string | null> {
  let url: string | null = null;
  if (isPexelsConfigured()) {
    url = await findRelevantBlogPexelsImage({
      ...input,
      minimumScore: 70,
    });
  }
  if (url) return url;
  return generateSectionImage(
    input.sectionTitle,
    input.primaryKeyword,
    input.destination,
    { skipPexelsFallback: true },
  );
}

function classifyPublisherFailure(reason?: string): string {
  const text = (reason ?? '').toLowerCase();
  if (!text) return 'other';
  if (text.includes('timeout') || text.includes('time_budget')) return 'timeout';
  if (text.includes('[length]') || text.includes('thin content') || text.includes('min length')) return 'length';
  if (text.includes('[links]') || text.includes('internal link') || text.includes('external authority') || text.includes('link')) return 'links';
  if (text.includes('duplicate') || text.includes('slug') || text.includes('중복')) return 'duplicate';
  if (text.includes('topic_fit') || text.includes('destination_prefix')) return 'topic_fit';
  if (text.includes('structure_integrity') || text.includes('structure')) return 'structure_integrity';
  if (text.includes('keyword_density')) return 'keyword_density';
  if (text.includes('table_integrity') || text.includes('table')) return 'table_integrity';
  if (text.includes('article_quality_v2') || text.includes('standalone_markdown') || text.includes('literal_markdown')) return 'article_quality_v2';
  if (text.includes('render_integrity') || text.includes('render')) return 'render_integrity';
  if (text.includes('intent_quality') || text.includes('intent')) return 'intent_quality';
  if (text.includes('editorial_quality') || text.includes('editorial')) return 'editorial_quality';
  if (text.includes('image_quality') || text.includes('image')) return 'image_quality';
  if (text.includes('seo')) return 'seo_score';
  if (text.includes('db') || text.includes('insert') || text.includes('update')) return 'database';
  return 'other';
}

function buildPublisherFailureBreakdown(results: Array<{ status: string; reason?: string }>): Record<string, number> {
  return results
    .filter(result => result.status !== 'published'
      && result.status !== 'approved_for_slot'
      && result.status !== 'done'
      && result.status !== 'deferred_buffer'
      && result.status !== 'deferred_time_budget')
    .reduce<Record<string, number>>((acc, result) => {
      const bucket = classifyPublisherFailure(result.reason);
      acc[bucket] = (acc[bucket] ?? 0) + 1;
      return acc;
    }, {});
}

function withPublisherTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}_timeout:${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function generatePublisherBlogText(
  prompt: string,
  options: Partial<Parameters<typeof generateBlogTextWithReceipt>[1]> = {},
  context: { queueId: string; attemptNumber: number; stage: BlogDeepSeekStage },
): Promise<BlogAiTextResult> {
  const execution = resolveBlogGenerationModelV4(context.stage);
  if (!execution || !hasBlogApiKey(execution.model)) {
    throw new Error(`blog_ai_model_unavailable:${context.stage}`);
  }
  const isRewrite = context.stage !== 'draft_flash';
  const maxTokens = options.maxTokens ?? (isRewrite
    ? BLOG_PUBLISHER_AI_REWRITE_MAX_OUTPUT_TOKENS
    : BLOG_PUBLISHER_AI_MAX_OUTPUT_TOKENS);
  const requestedUsd = estimateBlogAiCallReservationUsdV4({
    stage: context.stage,
    maxOutputTokens: maxTokens,
  });
  if (requestedUsd == null || requestedUsd <= 0) {
    throw new Error(`blog_ai_pricing_unavailable:${execution.provider}:${execution.model}`);
  }
  const reservation = await reserveBlogAiBudgetBeforeCallV4({
    queueId: context.queueId,
    attemptNumber: context.attemptNumber,
    stage: context.stage,
    provider: execution.provider,
    model: execution.model,
    requestedUsd,
  });
  if (!reservation.allowed || !reservation.reservationId) {
    throw new Error(`blog_ai_budget_blocked:${reservation.reason}`);
  }

  try {
    const result = await withPublisherTimeout(
      generateBlogTextWithReceipt(prompt, {
      ...options,
      model: execution.model,
      maxTokens,
      deepseekThinking: execution.provider === 'deepseek'
        ? options.deepseekThinking ?? execution.deepseekThinking ?? 'disabled'
        : undefined,
      reasoningEffort: execution.reasoningEffort,
      requestTimeoutMs: options.requestTimeoutMs ?? (isRewrite
        ? BLOG_PUBLISHER_AI_REWRITE_PROVIDER_TIMEOUT_MS
        : BLOG_PUBLISHER_AI_FIRST_PROVIDER_TIMEOUT_MS),
      }),
      isRewrite ? BLOG_PUBLISHER_AI_REWRITE_TIMEOUT_MS : BLOG_PUBLISHER_AI_TIMEOUT_MS,
      'blog_ai_generation',
    );
    const settlementError = await settleBlogAiBudgetReservationV4({
      reservationId: reservation.reservationId,
      receipt: result.receipt,
      status: 'completed',
    });
    if (settlementError) {
      logWarning('[cron/blog-publisher] AI budget settlement retained conservative reservation', {
        queueId: context.queueId,
        attemptNumber: context.attemptNumber,
        error: settlementError,
      });
    }
    return result;
  } catch (error) {
    // Network/timeout failures may have no provider receipt. They still settle
    // the row to `failed` while retaining the conservative reservation, so the
    // daily cap and operational ledger cannot silently diverge.
    const settlementError = await settleBlogAiBudgetReservationV4({
      reservationId: reservation.reservationId,
      receipt: error instanceof BlogAiResponseError ? error.receipt : null,
      status: 'failed',
    });
    if (settlementError) {
      logWarning('[cron/blog-publisher] failed AI attempt budget settlement unavailable', {
        queueId: context.queueId,
        attemptNumber: context.attemptNumber,
        error: settlementError,
      });
    }
    throw error;
  }
}

const BLOG_EDITORIAL_JUDGE_MAX_OUTPUT_TOKENS = 1_200;

async function evaluatePublisherEditorialHarnessV5(input: {
  queueId: string;
  attemptNumber: number;
  title: string;
  primaryQuery: string;
  primaryDecision: string;
  intentType: string;
  markdown: string;
  artifact: BlogDecisionArtifactV1;
}): Promise<{
  report: BlogEditorialHarnessReportV1;
  receipt: BlogAiTextResult['receipt'] | null;
}> {
  const deterministic = inspectBlogEditorialDeterministicallyV1({
    title: input.title,
    markdown: input.markdown,
    intentType: input.intentType,
    artifact: input.artifact,
  });
  if (!deterministic.passed) {
    return {
      report: combineBlogEditorialHarnessV1({ deterministic, semantic: null }),
      receipt: null,
    };
  }

  const requestedUsd = estimateBlogEditorialJudgeReservationUsdV5({
    maxOutputTokens: BLOG_EDITORIAL_JUDGE_MAX_OUTPUT_TOKENS,
  });
  const reservation = await reserveBlogEditorialJudgeBudgetBeforeCallV5({
    queueId: input.queueId,
    attemptNumber: input.attemptNumber,
    model: BLOG_DEEPSEEK_MODELS.rewrite,
    requestedUsd,
  });
  if (!reservation.allowed || !reservation.reservationId) {
    return {
      report: combineBlogEditorialHarnessV1({ deterministic, semantic: null }),
      receipt: null,
    };
  }

  let receipt: BlogAiTextResult['receipt'] | null = null;
  try {
    const judge = await withPublisherTimeout(
      generateBlogTextWithReceipt(buildBlogEditorialJudgePromptV1({
        title: input.title,
        primaryQuery: input.primaryQuery,
        primaryDecision: input.primaryDecision,
        markdown: input.markdown,
        artifact: input.artifact,
      }), {
        model: BLOG_DEEPSEEK_MODELS.rewrite,
        cascade: false,
        deepseekThinking: 'disabled',
        temperature: 0,
        maxTokens: BLOG_EDITORIAL_JUDGE_MAX_OUTPUT_TOKENS,
        requestTimeoutMs: 60_000,
      }),
      75_000,
      'blog_editorial_judge',
    );
    receipt = judge.receipt;
    const semantic = parseBlogEditorialJudgeReportV1(judge.text);
    await settleBlogAiBudgetReservationV4({
      reservationId: reservation.reservationId,
      receipt,
      status: 'completed',
    });
    return {
      report: combineBlogEditorialHarnessV1({ deterministic, semantic }),
      receipt,
    };
  } catch (error) {
    await settleBlogAiBudgetReservationV4({
      reservationId: reservation.reservationId,
      receipt: error instanceof BlogAiResponseError ? error.receipt : receipt,
      status: 'failed',
    });
    return {
      report: combineBlogEditorialHarnessV1({ deterministic, semantic: null }),
      receipt,
    };
  }
}

function publisherRemainingMs(startedAtMs: number): number {
  return getPublisherRemainingMs(startedAtMs, MAX_EXEC_MS);
}

function isFastFallbackEligibleInfoItem(item: any): boolean {
  return !item?.product_id && !item?.card_news_id && item?.source !== 'pillar';
}

function canStartPublisherQueueItem(item: any, remainingMs: number): boolean {
  return canStartPublisherItemWithFallback({
    remainingMs,
    minItemStartMs: BLOG_PUBLISHER_MIN_ITEM_START_MS,
    fallbackMinItemStartMs: BLOG_PUBLISHER_FAST_FALLBACK_MIN_ITEM_START_MS,
    fallbackEligible: isFastFallbackEligibleInfoItem(item),
  });
}

async function withGenerationBudget<T>(
  startedAtMs: number,
  label: string,
  work: () => Promise<T>,
): Promise<T> {
  const timeoutMs = getPublisherGenerationTimeoutMs(
    publisherRemainingMs(startedAtMs),
    BLOG_PUBLISHER_GENERATION_TIMEOUT_MS,
    BLOG_PUBLISHER_ITEM_FINISH_RESERVE_MS,
  );
  if (timeoutMs <= 0) {
    throw new Error(`publisher_time_budget_exhausted_before_${label}`);
  }
  return withPublisherTimeout(work(), timeoutMs, label);
}

function getKstDayRangeUtc(now = new Date()): { startIso: string; endIso: string; dayKey: string } {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth();
  const d = kst.getUTCDate();
  const startUtc = new Date(Date.UTC(y, m, d, -9, 0, 0, 0));
  const endUtc = new Date(Date.UTC(y, m, d + 1, -9, 0, 0, 0));
  return {
    startIso: startUtc.toISOString(),
    endIso: endUtc.toISOString(),
    dayKey: `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
  };
}

async function getTodayBlogPublishCount(): Promise<{ count: number; dayKey: string }> {
  const range = getKstDayRangeUtc();
  const { count, error } = await supabaseAdmin
    .from(PUBLIC_BLOG_READ_SOURCE)
    .select('id', { count: 'exact', head: true })
    .gte('published_at', range.startIso)
    .lt('published_at', range.endIso);

  if (error) {
    logWarning('[cron/blog-publisher] daily publish quota count failed', error);
    return { count: 0, dayKey: range.dayKey };
  }
  return { count: count ?? 0, dayKey: range.dayKey };
}

async function getTodayBlogGenerationCount(): Promise<number> {
  const range = getKstDayRangeUtc();
  const { count, error } = await supabaseAdmin
    .from('blog_generation_runs')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', range.startIso)
    .lt('created_at', range.endIso);
  if (error) {
    logWarning('[cron/blog-publisher] V4 generation count unavailable', error);
    return 0;
  }
  return Number(count ?? 0);
}

/** 크론 1회 실행당 스타일 가이드 1회만 로드 (N+1 방지) */
let blogStyleGuideCache: SelectedBlogPrompt | null = null;
let blogInformationWriterGuideCache: SelectedBlogPrompt | null = null;

function isUsableBlogSlug(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const slug = value.trim().toLowerCase();
  const lowQualitySlug =
    /^(?:post|draft|test)(?:-|$)/.test(slug) ||
    /^\d+(?:-|$)/.test(slug) ||
    /(?:^|-)post-[a-z0-9]{3,8}$/.test(slug) ||
    /-[a-f0-9]{6,8}$/.test(slug) ||
    /^(?:vs-){2,}/.test(slug);
  return /^[a-z0-9][a-z0-9-]{2,79}$/.test(slug)
    && /[a-z]/.test(slug)
    && !slug.endsWith('-')
    && !lowQualitySlug
    && !/^((preparation|currency|weather|visa|budget|food|faq|itinerary|transport)(-v\d+)?)$/.test(slug);
}

function categorySlugSuffix(item: any): string {
  const category = String(item.category || '').toLowerCase();
  const topic = String(item.topic || '').toLowerCase();
  if (category.includes('currency') || topic.includes('환전')) return 'currency';
  if (category.includes('preparation') || topic.includes('준비')) return 'preparation';
  if (category.includes('weather') || topic.includes('날씨')) return 'weather';
  if (category.includes('visa') || topic.includes('비자') || topic.includes('입국')) return 'visa';
  if (category.includes('itinerary') || topic.includes('일정')) return 'itinerary';
  if (category.includes('food') || topic.includes('맛집')) return 'food';
  return 'guide';
}

function stableFallbackSlug(item: any): string {
  const destination = romanize(String(item.destination || extractDestination(String(item.topic || '')) || ''));
  const idPart = String(item.id || '')
    .replace(/[^a-z0-9]/gi, '')
    .slice(-8)
    .toLowerCase();
  const stableId = idPart ? `q${idPart}` : 'qauto';
  const fallback = [destination || 'travel', categorySlugSuffix(item), stableId].filter(Boolean).join('-');
  return isUsableBlogSlug(fallback) ? fallback : `travel-guide-${stableId}`;
}

function buildQueueSlug(item: any): string {
  const expected = item.meta?.expected_slug ?? item.meta?.spun_slug ?? item.slug_hint;
  const cleanTopic = String(item.topic || '').replace(/[\s—–-]*재작성\s*v\d+/gi, '').trim();
  const topicSlug = slugifyTopic(cleanTopic);
  const destination = String(item.destination || extractDestination(cleanTopic) || '');
  const hasKnownDestination = Boolean(romanize(destination));

  if (
    isUsableBlogSlug(expected)
    && (!hasKnownDestination || slugIncludesDestination(expected, destination))
  ) {
    const cleanExpected = expected.trim().toLowerCase();
    const expectedLooksThin =
      !cleanExpected.includes('-') &&
      topicSlug.includes('-') &&
      /-(preparation|currency|weather|visa|budget|food|faq|itinerary|transport|guide)(-v\d+)?$/.test(topicSlug);
    if (!expectedLooksThin) return cleanExpected;
  }

  if (
    isUsableBlogSlug(topicSlug)
    && (!hasKnownDestination || slugIncludesDestination(topicSlug, destination))
  ) return topicSlug;

  return stableFallbackSlug(item);
}

function normalizeGeneratedSlug(generated: GeneratedBlog, item: any): boolean {
  const queueSlug = buildQueueSlug(item);
  if (!isUsableBlogSlug(queueSlug) || generated.slug === queueSlug) return false;

  const current = String(generated.slug || '').trim().toLowerCase();
  const destination = String(item.destination || extractDestination(String(item.topic || '')) || '');
  const queueHasCategory = /-(preparation|currency|weather|visa|budget|food|faq|itinerary|transport|guide)(-v\d+)?$/.test(queueSlug);
  const currentLooksThin = !current.includes('-') && queueSlug.includes('-') && queueHasCategory;
  const currentIsCategoryOnly = /^-?(preparation|currency|weather|visa|budget|food|faq|itinerary|transport|guide)(-v\d+)?$/.test(current);
  const currentMissesKnownDestination =
    Boolean(romanize(destination))
    && slugIncludesDestination(queueSlug, destination)
    && !slugIncludesDestination(current, destination);

  if (
    !isUsableBlogSlug(current)
    || currentLooksThin
    || currentIsCategoryOnly
    || currentMissesKnownDestination
  ) {
    generated.slug = queueSlug;
    return true;
  }

  return false;
}

function normalizeAngleType(value: unknown): AngleType {
  return normalizeBlogAngleType(value);
}

function buildEditorialVariationPromptBlock(item: any): string | null {
  const variation = item?.meta?.editorial_variation;
  if (!variation || typeof variation !== 'object') return null;
  const readerScenario = typeof variation.reader_scenario === 'string' ? variation.reader_scenario : null;
  const openingVariant = typeof variation.opening_variant === 'string' ? variation.opening_variant : null;
  const sectionOrderVariant = typeof variation.section_order_variant === 'string' ? variation.section_order_variant : null;
  if (!readerScenario && !openingVariant && !sectionOrderVariant) return null;
  return [
    '## Editorial variation - prevents fleet-level sameness',
    readerScenario ? `- Reader scenario: ${readerScenario}` : null,
    openingVariant ? `- Opening angle: ${openingVariant}` : null,
    sectionOrderVariant ? `- Section order variant: ${sectionOrderVariant}` : null,
    '- Keep the same factual evidence and required sections, but do not reuse a generic opening formula or the same H2 order from other recent posts.',
    '- The first paragraph must answer the reader task through the selected opening angle before any broad travel-planning wording.',
  ].filter((line): line is string => Boolean(line)).join('\n');
}

function buildQualityGateInput(
  generated: GeneratedBlog,
  item: any,
  blogType: 'product' | 'info',
  primaryKeyword?: string | null,
) {
  return {
    blog_html: generated.blog_html,
    slug: generated.slug,
    destination: item.destination,
    angle_type: normalizeAngleType(item.angle_type),
    blog_type: blogType,
    primary_keyword: primaryKeyword,
    category: item.category,
    content_type: item.source === 'pillar' ? 'pillar' : (item.product_id ? 'package_intro' : 'guide'),
    product_id: item.product_id ?? null,
    micro_angle: getGeneratedQualityMicroAngle(generated, item),
    generation_meta: generated.generation_meta ?? null,
    excludeContentCreativeId: item.content_creative_id ?? null,
    skipDuplicateCheck: isPublishedBlogAtomicUpgradeRequest(
      readPrivateBlogRegenerationRequest(item),
    ),
  };
}

async function runGeneratedQualityGates(
  generated: GeneratedBlog,
  item: any,
  blogType: 'product' | 'info',
  primaryKeyword?: string | null,
): Promise<QualityGateReport> {
  return runQualityGates(buildQualityGateInput(generated, item, blogType, primaryKeyword));
}

async function runGeneratedPublishQuality(
  generated: GeneratedBlog,
  item: any,
  blogType: 'product' | 'info',
  primaryKeyword?: string | null,
): Promise<BlogPublishQualityReport> {
  const qualityInput = buildQualityGateInput(generated, item, blogType, primaryKeyword);
  return evaluateBlogPublishQuality({
    ...qualityInput,
    seo_title: generated.seo_title,
    seo_description: generated.seo_description,
    secondary_keywords: Array.isArray(item.meta?.keywords) ? item.meta.keywords : [],
  });
}

function applyFinalCustomerSurfaceRepair(
  generated: GeneratedBlog,
  _item: any,
  _primaryKeyword?: string | null,
): string[] {
  const surfaceRepair = repairBlogPublishFormattingV3(generated.blog_html);
  if (!surfaceRepair.changed) return [];
  generated.blog_html = surfaceRepair.markdown;
  return surfaceRepair.changes;
}

function buildDeterministicInfoFallbackMarkdown(item: any, primaryKeyword?: string | null): string {
  const keyword = String(primaryKeyword || item.primary_keyword || item.topic || item.destination || '여행 준비');
  const destination = item.destination || extractDestination(String(item.topic || keyword)) || keyword.split(/\s+/)[0] || '여행지';
  const subject = destination && destination !== keyword ? destination : '이 여행';
  const seed = `${item.id || ''}|${item.topic || ''}|${primaryKeyword || ''}|${destination || ''}`;
  const pick = (variants: string[]) => {
    let hash = 0;
    for (const char of seed) hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
    return variants[hash % variants.length] ?? variants[0] ?? '';
  };
  const keywordParticle = (() => {
    const chars = Array.from(keyword.trim()).reverse();
    const lastHangul = chars.find((char) => {
      const code = char.charCodeAt(0);
      return code >= 0xac00 && code <= 0xd7a3;
    });
    return lastHangul && ((lastHangul.charCodeAt(0) - 0xac00) % 28) > 0 ? '은' : '는';
  })();
  const context = `${item.topic || ''} ${keyword} ${item.category || ''}`;
  const currentYear = new Date().getFullYear();
  const shortLabel = /보험|보장|병원|수하물|상해|질병|분실/.test(context)
    ? '여행자 보험'
    : /로밍|유심|이심|eSIM|데이터|통신|전화/.test(context)
      ? '통신 준비'
      : /비자|입국|서류|여권|세관|면세/.test(context)
        ? '입국 서류'
        : /공항|픽업|택시|렌터카|교통|이동|동선|시내/.test(context)
          ? '공항 이동'
          : /아이|가족|일정|코스/.test(context)
            ? '가족 일정'
            : /예산|비용|식비|경비|쇼핑/.test(context)
              ? '여행 경비'
              : '여행 준비';
  const lead = /보험|보장|병원|수하물|상해|질병|분실/.test(context)
    ? pick([
      `${keyword}${keywordParticle} 1차로 항공 지연, 병원 이용, 수하물 분실, 현지 결제 가능 범위를 비교하면 필요 여부를 판단하기 쉽습니다. 여행 기간, 동행자 나이, 기존 카드 보험을 확인한 뒤 부족한 보장만 추가하세요.`,
      `${keyword}${keywordParticle} 보장 이름보다 실제로 쓸 상황을 먼저 보는 편이 안전합니다. 항공 지연, 병원비, 수하물 분실, 동행자 나이를 나누면 과한 보장과 부족한 보장을 구분할 수 있습니다.`,
    ])
    : /로밍|유심|이심|eSIM|데이터|통신|전화/.test(context)
      ? pick([
        `${keyword}${keywordParticle} 가격만 보지 말고 개통 방식, 데이터 용량, 통화 필요 여부, 현지 앱 인증 가능성을 함께 확인해야 합니다. 짧은 일정은 로밍, 장기·가족 일정은 유심이나 eSIM 비교가 유리한 경우가 많습니다.`,
        `${keyword}${keywordParticle} 공항에서 시간을 줄이려면 구매 가격보다 개통 난이도를 먼저 봐야 합니다. 동행자가 많으면 공유 방식, 혼자라면 인증과 통화 가능 여부를 기준으로 고르세요.`,
      ])
      : /비자|입국|서류|여권|세관|면세/.test(context)
        ? pick([
          `${keyword}${keywordParticle} 출발 2주 전 무비자 가능 여부, 체류 가능 일수, 여권 6개월 기준, 항공사 요구 서류를 공식 안내로 다시 확인해야 합니다. 여권·항공권·숙소 정보·입국 신고 조건을 나누면 공항에서 빠뜨릴 항목을 줄일 수 있습니다.`,
          `${keyword}${keywordParticle} 후기보다 공식 조건을 먼저 확인해야 하는 항목입니다. 여권 유효기간, 체류 가능 일수, 항공사 서류 요구를 따로 보면 공항에서 다시 줄 서는 일을 줄일 수 있습니다.`,
        ])
        : /공항|픽업|택시|렌터카|교통|이동|동선|시내/.test(context)
          ? pick([
            `${keyword}${keywordParticle} 도착 시간, 숙소 위치, 결제 수단, 이동 앱 사용 가능 여부를 함께 봐야 첫날 1~2시간 손실을 줄일 수 있습니다. 짐이 많거나 밤 도착이면 택시·픽업, 낮 도착이면 앱 호출과 셔틀을 비교하세요.`,
            `${keyword}${keywordParticle} 첫날 피로를 줄이려면 가장 싼 이동수단보다 실패 가능성이 낮은 방법을 먼저 고르는 편이 좋습니다. 도착 시간, 짐 개수, 숙소 위치, 결제 수단을 함께 확인하세요.`,
          ])
          : /아이|가족|일정|코스/.test(context)
            ? pick([
              `${destination} 가족여행은 하루 코스를 많이 넣기보다 이동 1회당 시간, 숙소 위치, 식사·휴식 시간을 먼저 맞추는 편이 좋습니다. 첫날은 이동과 휴식, 둘째 날 이후는 투어·리조트·시내 일정을 나눠 잡으세요.`,
              `${destination} 가족 일정은 관광지 개수보다 컨디션 관리가 먼저입니다. 공항 이동, 낮잠이나 휴식 시간, 식사 간격을 잡아 두면 아이와 부모님 모두 일정이 편해집니다.`,
            ])
            : /예산|비용|식비|경비|쇼핑/.test(context)
              ? pick([
                `${keyword}${keywordParticle} 항공·숙소 결제액과 현지 식비, 교통비, 선택 관광, 팁을 따로 봐야 실제 총액이 잡힙니다. 먼저 1인 비용과 가족 총액, 현지 추가비 가능 항목을 나누면 과소예산을 줄일 수 있습니다.`,
                `${keyword}${keywordParticle} 표시 가격만 보면 저렴해 보여도 현지에서 다시 쓰는 돈이 생길 수 있습니다. 결제 완료 금액, 식비, 이동비, 선택 관광, 카드 수수료 5가지를 나눠 계산하세요.`,
                `${keyword}${keywordParticle} 예산표를 만들 때는 “이미 낸 돈”과 “현장에서 낼 돈”을 분리해야 합니다. 가족이나 단체 일정은 1인 금액보다 전체 총액으로 비교하는 편이 정확합니다.`,
              ])
              : pick([
                `${keyword}${keywordParticle} 일정, 비용, 이동 시간, 현지 확인 조건을 먼저 나누면 판단이 쉽습니다. 출발일 기준으로 바뀔 수 있는 항목을 다시 확인하고, 표와 체크리스트에서 필요한 부분만 빠르게 비교하세요.`,
                `${keyword}${keywordParticle} 처음부터 모든 정보를 읽기보다 바뀔 수 있는 항목을 먼저 보는 편이 좋습니다. 출발일, 인원, 이동 시간, 현지 결제 조건을 나누면 준비 기준이 선명해집니다.`,
                `${keyword}${keywordParticle} 준비 순서를 잡으면 불필요한 검색 시간을 줄일 수 있습니다. 공식 확인이 필요한 항목과 개인 취향으로 고를 항목을 나눠 보고 마지막에 체크리스트로 정리하세요.`,
              ]);

  return [
    `# ${keyword}`,
    '',
    lead,
    '',
    '## 먼저 볼 4가지',
    '',
    `- ${subject}은 출발일, 인원, 숙소 위치, 항공 시간에 따라 준비 기준이 달라집니다.`,
    '- 정책, 항공, 현지 교통, 날씨처럼 바뀔 수 있는 항목은 출발 7일 전과 24시간 전에 다시 확인합니다.',
    '- 비용은 결제 완료 금액과 현지 추가 비용을 분리해서 봐야 예산 오차를 줄일 수 있습니다.',
    '- 아이·부모님 동반 일정은 이동 시간 30분 차이도 체감 피로가 커질 수 있습니다.',
    '',
    '## 빠른 판단표',
    '',
    '| 상황 | 먼저 볼 것 | 문의 전 확인할 점 |',
    '| --- | --- | --- |',
    `| 처음 가는 일정 | 입국, 이동, 결제, 통신 | 여권 정보와 항공권 영문 이름 일치 여부 |`,
    '| 가족 여행 | 이동 시간, 숙소 위치, 식사 간격 | 아이 연령, 침대 조건, 차량 탑승 시간 |',
    '| 예산 중심 | 총액, 현지 추가비, 취소 규정 | 포함/불포함 항목과 환율 변동 가능성 |',
    '| 짧은 일정 | 공항 동선, 첫날 피로도 | 늦은 도착이면 야간 일정을 줄일지 여부 |',
    '',
    '## 준비 순서',
    '',
    `1. 출발 2주 전에는 여권, 항공권, 숙소 예약, 입국 조건을 먼저 확인합니다.`,
    '2. 출발 7일 전에는 날씨, 현지 결제 수단, 통신 준비, 이동 앱 사용 가능 여부를 다시 봅니다.',
    '3. 출발 전날에는 바우처, 보험, 비상 연락처, 공항 이동 시간을 동행자와 공유합니다.',
    '4. 현지에서는 일정 변경 가능성이 있으니 첫날과 마지막 날은 여유 시간을 남겨둡니다.',
    '',
    '## 실수하기 쉬운 부분',
    '',
    `같은 지역 일정이라도 항공 도착 시간과 숙소 위치에 따라 체감 난이도가 크게 달라집니다. 낮 도착이면 이동 후 가벼운 식사와 산책이 가능하지만, 밤 도착이면 숙소 이동과 체크인만 해도 피로가 쌓일 수 있습니다.`,
    '',
    '비용도 상품가나 항공권만 보면 부족합니다. 현지 교통비, 식비, 선택 관광, 팁, 카드 수수료, 환율 변동까지 따로 봐야 실제 총액이 잡힙니다. 특히 가족 여행은 1인 금액보다 가족 총액으로 비교하는 편이 안전합니다.',
    '',
    '## 상황별 선택 기준',
    '',
    '아이와 함께라면 이동 시간을 가장 먼저 줄이는 편이 좋습니다. 숙소가 조금 비싸더라도 공항, 식당, 주요 일정과 가까우면 대기 시간이 줄고 컨디션 관리가 쉬워집니다. 부모님과 함께라면 계단, 차량 탑승 시간, 식사 간격, 화장실 접근성을 같이 봐야 합니다.',
    '',
    '친구나 커플 일정이라면 비용과 자유 시간을 더 세밀하게 비교할 수 있습니다. 다만 첫날부터 빡빡한 일정을 넣으면 항공 지연이나 입국 대기 시간이 생겼을 때 전체 계획이 밀릴 수 있습니다. 첫날은 체크인과 주변 동선 확인, 둘째 날부터 핵심 일정을 배치하는 구성이 안정적입니다.',
    '',
    '예산을 아끼고 싶다면 가장 싼 선택지만 고르기보다 포함 항목을 먼저 나눠야 합니다. 공항 이동, 식사, 선택 관광, 보험, 통신, 현지 팁이 빠져 있으면 처음에는 저렴해 보여도 총액은 올라갈 수 있습니다. 반대로 이미 포함된 항목이 많다면 표시 가격이 조금 높아도 실제 지출은 더 안정적일 수 있습니다.',
    '',
    '## 출발 전 최종 체크',
    '',
    '- 여권 유효기간, 항공권 영문 이름, 숙소 예약자 이름을 서로 맞춰 봅니다.',
    '- 항공 도착 시간이 늦다면 첫날 일정은 식사와 체크인 중심으로 줄입니다.',
    '- 카드 결제 가능 여부와 소액 현금 준비를 나눠 확인합니다.',
    '- 현지 통신은 로밍, 유심, eSIM 중 개통 난이도와 동행자 수를 기준으로 고릅니다.',
    '- 비상 연락처, 보험 증권, 예약 번호는 휴대폰과 종이 메모에 나눠 보관합니다.',
    '',
    '## 고객이 많이 헷갈리는 부분',
    '',
    '예약 전에는 “가능하다”와 “확정됐다”를 구분해야 합니다. 항공 좌석, 객실 가능 여부, 차량 배정, 현지 행사 일정은 조회 시점에 따라 달라질 수 있습니다. 그래서 상담이나 예약 전 확인에서는 금액만 묻기보다 출발일, 인원, 아이 나이, 원하는 객실, 피하고 싶은 이동 시간을 함께 알려주는 편이 빠릅니다.',
    '',
    '또 하나는 공식 정보와 후기 정보를 섞어 보는 문제입니다. 후기는 실제 체감 난이도를 이해하는 데 도움이 되지만, 비자, 입국, 항공, 안전, 날씨 경보처럼 바뀔 수 있는 정보는 공식 안내를 기준으로 마지막에 다시 확인해야 합니다. 이 글의 숫자와 예시는 판단 기준이고, 최종 조건은 출발 시점 안내가 기준입니다.',
    '',
    '## 공식 확인 링크',
    '',
    '- [외교부 해외안전여행](https://www.0404.go.kr/)',
    '- [외교부](https://www.mofa.go.kr/)',
    '',
    '## 문의 전 질문',
    '',
    'Q. 언제 확인하면 좋나요?',
    `A. ${currentYear}년 기준으로는 출발 2주 전 1차 확인, 출발 7일 전 재확인, 출발 24시간 전 최종 확인 순서가 가장 안전합니다.`,
    '',
    'Q. 현지에서 바로 바꿔도 되나요?',
    'A. 가능한 항목도 있지만 공항, 호텔, 현지 업체 조건이 다를 수 있습니다. 비용과 시간 손실을 줄이려면 출발 전에 큰 항목을 정리해 두는 편이 좋습니다.',
    '',
    '**내 일정 기준으로 확인하기**',
    '',
    `[내 일정 기준으로 가능 여부 확인](${resolveBlogCanonicalOrigin()}/?utm_source=naver_blog&utm_medium=organic&utm_campaign=${encodeURIComponent(buildQueueSlug(item))}&utm_content=bottom_soft_cta)`,
    '',
    `[관련 여행 가이드 더 보기](${resolveBlogCanonicalOrigin()}/blog?utm_source=naver_blog&utm_medium=organic&utm_campaign=${encodeURIComponent(buildQueueSlug(item))}&utm_content=related_blog)`,
    '',
    `[여행 상품 조건 확인](${resolveBlogCanonicalOrigin()}/packages?utm_source=naver_blog&utm_medium=organic&utm_campaign=${encodeURIComponent(buildQueueSlug(item))}&utm_content=package_check)`,
  ].join('\n');
}

async function applyDeterministicInfoFallback(
  generated: GeneratedBlog,
  item: any,
  primaryKeyword?: string | null,
  reason?: string,
): Promise<string[]> {
  if (item.product_id) return [];
  const changes = ['deterministic_info_fallback'];
  generated.blog_html = buildDeterministicInfoFallbackMarkdown(item, primaryKeyword);
  generated.seo_title = repairBlogSeoMetadata({
    seoTitle: `${primaryKeyword || item.topic} 체크리스트와 비교 기준 2026`,
    seoDescription: '',
    topic: item.topic,
    primaryKeyword,
    destination: item.destination,
    category: item.category,
  }).seoTitle;
  const fallbackContext = `${item.topic || ''} ${primaryKeyword || ''} ${item.category || ''}`;
  const fallbackShortLabel = /보험|보장|병원|수하물|상해|질병|분실/.test(fallbackContext)
    ? '여행자 보험'
    : /로밍|유심|이심|eSIM|데이터|통신|전화/.test(fallbackContext)
      ? '통신 준비'
      : /비자|입국|서류|여권|세관|면세/.test(fallbackContext)
        ? '입국 서류'
        : /공항|픽업|택시|렌터카|교통|이동|동선|시내/.test(fallbackContext)
          ? '공항 이동'
          : /아이|가족|일정|코스/.test(fallbackContext)
            ? '가족 일정'
            : /예산|비용|식비|경비|쇼핑/.test(fallbackContext)
              ? '여행 경비'
              : '여행 준비';
  const fallbackKeyword = String(primaryKeyword || item.topic || fallbackShortLabel);
  generated.seo_description = `${fallbackKeyword} 기준으로 일정, 비용, 이동, 준비물, 공식 확인 링크, 예약 전 체크 포인트를 한 번에 정리했습니다.`.slice(0, 155);
  generated.generation_meta = {
    ...(generated.generation_meta || {}),
    deterministic_info_fallback: true,
    deterministic_fallback_reason: reason || null,
    writer: 'info_writer',
  };
  try {
    const imageResult = await ensureBlogInlineImages({
      markdown: generated.blog_html,
      destination: item.destination,
      primaryKeyword,
      ogImageUrl: generated.og_image_url,
      minImages: 0,
      maxImages: 4,
    });
    if (imageResult.inserted > 0) generated.blog_html = imageResult.markdown;
  } catch { /* private fallback diagnostics do not depend on image fetch success */ }
  generated.blog_html = sanitizeBlogCtaLinks(generated.blog_html, {
    destination: item.destination,
    slug: generated.slug,
    utmSource: 'naver_blog',
  });
  const surfaceChanges = applyFinalCustomerSurfaceRepair(generated, item, primaryKeyword);
  changes.push(...surfaceChanges);
  return changes;
}

async function repairFailedQualityGates(
  _generated: GeneratedBlog,
  _item: any,
  qa: QualityGateReport,
  _blogType: 'product' | 'info',
  _primaryKeyword?: string | null,
): Promise<QualityGateReport> {
  // V3 records failed dimensions and routes the generated draft to review.
  // It never invents facts, sections, links, images, or keyword occurrences.
  return qa;
}

async function getActiveBlogStyleGuide(): Promise<SelectedBlogPrompt> {
  if (blogStyleGuideCache) return blogStyleGuideCache;
  const { data: promptRow } = await supabaseAdmin
    .from('prompt_versions')
    .select('content, version')
    .eq('domain', 'blog_style_guide')
    .eq('is_active', true)
    .limit(1);
  blogStyleGuideCache = selectActiveBlogPrompt({
    databaseContent: promptRow?.[0]?.content,
    databaseVersion: promptRow?.[0]?.version,
    repositoryContent: BLOG_STYLE_GUIDE,
    repositoryVersion: BLOG_PROMPT_VERSION,
  });
  return blogStyleGuideCache;
}

async function getActiveBlogInformationWriterGuide(): Promise<SelectedBlogPrompt> {
  if (blogInformationWriterGuideCache) return blogInformationWriterGuideCache;
  const { data: promptRow } = await supabaseAdmin
    .from('prompt_versions')
    .select('content, version')
    .eq('domain', 'blog_info_writer_guide')
    .eq('is_active', true)
    .limit(1);
  blogInformationWriterGuideCache = selectActiveBlogPrompt({
    databaseContent: promptRow?.[0]?.content,
    databaseVersion: promptRow?.[0]?.version,
    repositoryContent: BLOG_INFORMATION_WRITER_GUIDE,
    repositoryVersion: BLOG_INFORMATION_PROMPT_VERSION,
    databaseContentValidator: isValidInformationalWriterGuide,
  });
  return blogInformationWriterGuideCache;
}

async function recoverStaleGeneratingQueueItems(): Promise<{ recovered: number; failed: number }> {
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - STALE_GENERATING_RECOVERY_MS).toISOString();
  const { data: staleItems, error } = await supabaseAdmin
    .from('blog_topic_queue')
    .select('id, attempts, last_error, meta')
    .eq('status', 'generating')
    .lt('updated_at', cutoff)
    .limit(MAX_CANDIDATE_POOL);

  if (error || !staleItems || staleItems.length === 0) {
    if (error) logWarning('[cron/blog-publisher] stale generating recovery scan failed', error);
    return { recovered: 0, failed: 0 };
  }

  let recovered = 0;
  let failed = 0;
  for (const item of staleItems as Array<{ id: string; attempts: number | null; last_error: string | null; meta?: unknown }>) {
    const meta = item.meta && typeof item.meta === 'object' && !Array.isArray(item.meta)
      ? { ...(item.meta as Record<string, unknown>) }
      : {};
    const attempts = item.attempts ?? 0;
    const canRequeue = attempts < MAX_ATTEMPTS && shouldSelfHealBlogQueueItem({ lastError: item.last_error, meta });
    const updatePayload = canRequeue
      ? {
          status: 'queued',
          target_publish_at: now,
          last_error: `publisher recovered stale generating ${now}: ${item.last_error ?? ''}`.slice(0, 500),
          updated_at: now,
          meta: {
            ...meta,
            recovered_by: 'blog-publisher',
            stale_generating_recovered_at: now,
            stale_generating_attempts: attempts,
          },
        }
      : {
          status: 'failed',
          attempts: Math.max(MAX_ATTEMPTS, attempts),
          last_error: `publisher quarantined stale generating ${now}: ${item.last_error ?? ''}`.slice(0, 500),
          updated_at: now,
          meta: {
            ...meta,
            self_heal_blocked: true,
            quarantine_reason: 'stale_generating_or_non_retryable_failure',
            stale_generating_closed_at: now,
            stale_generating_attempts: attempts,
          },
        };

    const { error: updateError } = await supabaseAdmin
      .from('blog_topic_queue')
      .update(updatePayload as never)
      .eq('id', item.id)
      .eq('status', 'generating');

    if (!updateError) {
      if (canRequeue) recovered += 1;
      else failed += 1;
    }
  }

  return { recovered, failed };
}

async function pullForwardQueuedBacklog(
  limit: number,
  excludeIds: Set<string> = new Set(),
  opts?: {
    fallbackEligibleOnly?: boolean;
    priority?: number;
  },
): Promise<number> {
  if (limit <= 0) return 0;

  const now = new Date().toISOString();
  const { data: candidates, error } = await supabaseAdmin
    .from('blog_topic_queue')
    .select('id,product_id,card_news_id,source')
    .eq('status', 'queued')
    .gt('target_publish_at', now)
    .order('priority', { ascending: false })
    .order('target_publish_at', { ascending: true })
    .limit(opts?.fallbackEligibleOnly ? Math.max(limit * 3, 12) : limit);

  if (error || !candidates || candidates.length === 0) {
    if (error) logWarning('[cron/blog-publisher] backlog pull-forward scan failed', error);
    return 0;
  }

  const ids = candidates
    .filter((row: { id?: string | null; product_id?: string | null; card_news_id?: string | null; source?: string | null }) =>
      !opts?.fallbackEligibleOnly || isFastFallbackEligibleInfoItem(row),
    )
    .map((row: { id?: string | null }) => row.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0 && !excludeIds.has(id));
  if (ids.length === 0) return 0;

  const updatePayload: Record<string, unknown> = {
    target_publish_at: now,
    updated_at: now,
  };
  if (typeof opts?.priority === 'number') {
    updatePayload.priority = opts.priority;
  }

  const { error: updateError } = await supabaseAdmin
    .from('blog_topic_queue')
    .update(updatePayload as never)
    .in('id', ids.slice(0, limit))
    .eq('status', 'queued');

  if (updateError) {
    logWarning('[cron/blog-publisher] backlog pull-forward update failed', updateError);
    return 0;
  }

  return Math.min(ids.length, limit);
}

async function releaseUnattemptedClaimedQueueItems(
  claimedRows: Array<{ id?: string | null; meta?: unknown }>,
  attemptedIds: Set<string>,
): Promise<{ released: number; errors: string[] }> {
  const now = new Date().toISOString();
  const releaseIds = new Set(getUnattemptedClaimReleaseIds(claimedRows, attemptedIds));
  let released = 0;
  const errors: string[] = [];

  for (const row of claimedRows) {
    const id = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : null;
    if (!id || !releaseIds.has(id)) continue;
    releaseIds.delete(id);
    const meta = row.meta && typeof row.meta === 'object' && !Array.isArray(row.meta)
      ? row.meta as Record<string, unknown>
      : {};
    const { error } = await supabaseAdmin
      .from('blog_topic_queue')
      .update({
        status: 'queued',
        target_publish_at: now,
        updated_at: now,
        last_error: 'publisher_released_unattempted_time_budget_claim',
        meta: {
          ...meta,
          time_budget_claim_released_at: now,
          time_budget_claim_release_reason: 'not_attempted_before_publisher_exit',
        },
      } as never)
      .eq('id', id)
      .eq('status', 'generating');
    if (error) errors.push(`${id}: ${error.message}`);
    else released += 1;
  }

  return { released, errors };
}

async function deferAttemptedQueueItemForTimeBudget(item: any, remainingMs: number): Promise<void> {
  const now = new Date();
  const targetPublishAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
  const meta = item.meta && typeof item.meta === 'object' && !Array.isArray(item.meta)
    ? { ...(item.meta as Record<string, unknown>) }
    : {};
  delete meta.deterministic_fallback_reason;
  delete meta.deterministic_fallback_blocked;

  const { error } = await supabaseAdmin
    .from('blog_topic_queue')
    .update({
      status: 'queued',
      attempts: item.attempts ?? 0,
      target_publish_at: targetPublishAt,
      updated_at: now.toISOString(),
      last_error: 'publisher_deferred_before_generation_time_budget',
      meta: {
        ...meta,
        time_budget_deferred_at: now.toISOString(),
        time_budget_remaining_ms: Math.max(0, Math.floor(remainingMs)),
      },
    } as never)
    .eq('id', item.id)
    .eq('status', 'generating');

  if (error) throw new Error(`time_budget_defer_failed:${error.message}`);
}

async function deferDuePillarQueueItems(): Promise<{ deferred: number }> {
  const now = new Date();
  const nextWeeklyWindow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const nextWeeklyIso = nextWeeklyWindow.toISOString();

  const { data: duePillars, error } = await supabaseAdmin
    .from('blog_topic_queue')
    .select('id')
    .eq('status', 'queued')
    .eq('source', 'pillar')
    .or(`target_publish_at.is.null,target_publish_at.lte.${now.toISOString()}`)
    .limit(20);

  if (error || !duePillars || duePillars.length === 0) {
    if (error) logWarning('[cron/blog-publisher] pillar deferral scan failed', error);
    return { deferred: 0 };
  }

  const ids = duePillars
    .map((row: { id?: string | null }) => row.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  if (ids.length === 0) return { deferred: 0 };

  const { error: updateError } = await supabaseAdmin
    .from('blog_topic_queue')
    .update({
      target_publish_at: nextWeeklyIso,
      priority: 25,
      updated_at: now.toISOString(),
    } as never)
    .in('id', ids)
    .eq('status', 'queued')
    .eq('source', 'pillar');

  if (updateError) {
    logWarning('[cron/blog-publisher] pillar deferral update failed', updateError);
    return { deferred: 0 };
  }

  return { deferred: ids.length };
}

async function runBlogPublisher(request: NextRequest) {
  if (!isCronOrVercelAuthorized(request)) {
    return cronUnauthorizedResponse();
  }

  if (!isSupabaseConfigured) {
    return { skipped: true, reason: 'Supabase 미설정', errors: [] as string[] };
  }
  // V4 has one public commit boundary: blog-publication-controller.  Keep this
  // legacy route generation-only even when an operator calls it directly or a
  // stale scheduler omits `phase=generate_only`; otherwise a valid cron secret
  // could bypass the immutable selected-attempt controller contract.
  const deferPublication = true;

  const schemaReadiness = await probeBlogRuntimeSchemaWithSupabaseV3(
    supabaseAdmin,
    new Date(),
    BLOG_RUNTIME_RESOURCES_V3.filter((resource) => (
      resource.scope === 'publish' || resource.scope === 'delivery'
    )),
  );
  if (!schemaReadiness.publishReady || !schemaReadiness.deliveryReady) {
    return {
      ok: false,
      skipped: true,
      reason: 'blog_quality_v3_runtime_schema_not_ready',
      autopublishMode: BLOG_AUTOPUBLISH_POLICY_V3.mode,
      requestedAutopublishMode: BLOG_AUTOPUBLISH_POLICY_V3.requestedMode,
      deploymentProvenance: BLOG_AUTOPUBLISH_POLICY_V3.deploymentProvenance,
      schemaReadiness,
      errors: [] as string[],
    };
  }

  const results: Array<{
    id: string;
    topic: string;
    status: string;
    reason?: string;
    atomicIndexing?: boolean;
  }> = [];
  const errors: string[] = [];
  const candidateFailures: string[] = [];
  const startTime = Date.now();
  const attemptedQueueIds = new Set<string>();

  try {
    blogStyleGuideCache = null;
    blogInformationWriterGuideCache = null;
    const privateQueueId = request.nextUrl.searchParams.get('privateQueueId')?.trim();
    if (privateQueueId) {
      const { data: item, error: itemError } = await supabaseAdmin
        .from('blog_topic_queue')
        .select('*')
        .eq('id', privateQueueId)
        .eq('status', 'queued')
        .maybeSingle();

      if (itemError || !item) {
        return {
          ok: false,
          processed: 0,
          published: 0,
          targetedPrivateRegeneration: true,
          reason: itemError?.message || 'private_regeneration_queue_item_not_found',
          results,
          errors,
        };
      }

      if (!hasPrivateBlogRegenerationIntent(item)) {
        return {
          ok: false,
          processed: 0,
          published: 0,
          targetedPrivateRegeneration: true,
          reason: 'private_regeneration_intent_required',
          results,
          errors,
        };
      }

      const privateRegenerationRequest = readPrivateBlogRegenerationRequest(item);
      if (privateRegenerationRequest) {
        const publishedAtomicUpgrade = isPublishedBlogAtomicUpgradeRequest(privateRegenerationRequest);
        const { data: replacementTarget, error: replacementTargetError } = await supabaseAdmin
          .from('content_creatives')
          .select('id,channel,status,product_id,generation_meta')
          .eq('id', privateRegenerationRequest.contentCreativeId)
          .maybeSingle();
        if (replacementTargetError
          || !isEligiblePrivateBlogRegenerationTarget(replacementTarget, privateRegenerationRequest)) {
          const reason = 'private_regeneration_target_not_eligible';
          await supabaseAdmin.from('blog_topic_queue').update({
            status: 'skipped',
            last_error: reason,
            meta: {
              ...(item.meta || {}),
              self_heal_blocked: true,
              private_regeneration_blocked: true,
              target_error: replacementTargetError?.message ?? null,
            },
          }).eq('id', privateQueueId);
          return {
            ok: false,
            processed: 0,
            published: 0,
            targetedPrivateRegeneration: true,
            reason,
            results,
            errors: [reason],
          };
        }

        if (!publishedAtomicUpgrade) {
          const contentBrief = buildQueueContentBrief(item);
          const researchReadiness = evaluateBlogGenerationResearchReadiness({
            meta: item.meta,
            expectedContentKey: buildQueueSlug(item),
            destination: item.destination,
            intent: contentBrief.intentType,
            locale: contentBrief.plan.locale,
            sourcePolicy: contentBrief.sourcePolicy,
          });
          const researchSummary = summarizeBlogGenerationResearch(researchReadiness);
          if (!contentBrief.passed || !researchReadiness.passed || !researchReadiness.bundle) {
            const issues = !contentBrief.passed
              ? contentBrief.issues.map((issue) => `brief:${issue}`)
              : researchReadiness.issues;
            const reason = `private_regeneration_research_preflight:${issues.slice(0, 8).join(',')}`;
            await supabaseAdmin.from('blog_topic_queue').update({
              status: 'skipped',
              last_error: reason,
              meta: {
                ...(item.meta || {}),
                self_heal_blocked: true,
                research_preflight: researchSummary,
              },
            }).eq('id', privateQueueId);
            return {
              ok: false,
              processed: 0,
              published: 0,
              targetedPrivateRegeneration: true,
              reason,
              researchPreflight: researchSummary,
              results,
              errors: [reason],
            };
          }

          try {
            await persistBlogInformationResearch({
              ...researchReadiness.bundle,
              creativeId: privateRegenerationRequest.contentCreativeId,
              tenantId: item.tenant_id ?? researchReadiness.bundle.tenantId ?? null,
            });
            await markBlogInformationResearchClaimsSupported({
              contentKey: researchReadiness.bundle.contentKey,
              claimFingerprints: researchReadiness.bundle.claims.map(
                (claim) => claim.claimFingerprint,
              ),
            });
          } catch (error) {
            const persistenceIssue = error instanceof Error ? error.message : String(error);
            const reason = `private_regeneration_research_persistence:${persistenceIssue}`;
            await supabaseAdmin.from('blog_topic_queue').update({
              status: 'skipped',
              last_error: reason,
              meta: {
                ...(item.meta || {}),
                self_heal_blocked: true,
                research_preflight: {
                  ...researchSummary,
                  persistence_passed: false,
                },
              },
            }).eq('id', privateQueueId);
            return {
              ok: false,
              processed: 0,
              published: 0,
              targetedPrivateRegeneration: true,
              reason,
              researchPreflight: researchSummary,
              results,
              errors: [reason],
            };
          }
        }
      }

      const result = await processQueueItem(item, new Map(), {
        startedAtMs: startTime,
        validatedPrivateRegenerationRequest: privateRegenerationRequest ?? undefined,
        deferPublication,
      });
      const targetedAttempts = 1;
      results.push(result);
      const completedPrivately = result.status === 'pending_review'
        || result.status === 'approved_for_slot'
        || result.status === 'done'
        || result.status === 'upgraded';
      return {
        ok: completedPrivately,
        processed: 1,
        published: 0,
        targetedPrivateRegeneration: true,
        targetedAttempts,
        queueId: privateQueueId,
        results,
        errors: completedPrivately ? errors : [...errors, result.reason || result.status],
        ranAt: new Date().toISOString(),
      };
    }

    const targetQueueId = request.nextUrl.searchParams.get('targetQueueId')?.trim();
    if (targetQueueId) {
      const { data: item, error: itemError } = await supabaseAdmin
        .from('blog_topic_queue')
        .select('*')
        .eq('id', targetQueueId)
        .eq('status', 'queued')
        .maybeSingle();
      const targetMeta = item?.meta && typeof item.meta === 'object' && !Array.isArray(item.meta)
        ? item.meta as Record<string, unknown>
        : {};
      if (itemError || !item) {
        return {
          ok: false,
          processed: 0,
          published: 0,
          targetedCanaryPublication: true,
          reason: itemError?.message || 'target_queue_item_not_found',
          results,
          errors,
        };
      }
      if (item.product_id || targetMeta.controlled_publish_canary !== true) {
        return {
          ok: false,
          processed: 0,
          published: 0,
          targetedCanaryPublication: true,
          reason: item.product_id
            ? 'target_queue_item_must_be_informational'
            : 'controlled_publish_canary_flag_required',
          results,
          errors,
        };
      }

      const result = await processQueueItem(item, new Map(), { startedAtMs: startTime, deferPublication });
      results.push(result);
      const published = result.status === 'published' ? 1 : 0;
      const targetedSucceeded = published === 1
        || result.status === 'pending_review'
        || result.status === 'approved_for_slot';
      return {
        ok: targetedSucceeded,
        processed: 1,
        published,
        targetedCanaryPublication: true,
        queueId: targetQueueId,
        results,
        errors: targetedSucceeded
          ? errors
          : [...errors, result.reason || result.status],
        ranAt: new Date().toISOString(),
      };
    }

    const staleRecovery = await recoverStaleGeneratingQueueItems();
    const recoverableBacklogRecovery = await recoverRequeueableFailedBlogQueueItems({
      limit: MAX_CANDIDATE_POOL * 3,
      recoveredBy: 'blog-publisher-preflight',
    }).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`recoverable_backlog_recovery_failed: ${message}`);
      return { scanned: 0, requeued: 0, skipped: 0, deferred: 0, kept_blocked: 0, errors: [message] };
    });
    const queueHealthCleanup = await rescheduleOverdueQueuedBlogQueueItems({
      limit: MAX_CANDIDATE_POOL * 3,
      rescheduledBy: 'blog-publisher-preflight',
    }).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`queue_health_cleanup_failed: ${message}`);
      return { scanned: 0, rescheduled: 0, actions: [] };
    });
    const preflightQuarantine = await quarantineNonRetryableBlogQueueItems({
      limit: MAX_CANDIDATE_POOL * 3,
      maxAttempts: MAX_ATTEMPTS,
    });
    const pillarDeferral = await deferDuePillarQueueItems();
    const publishPolicy = await getBlogPublishingPolicy('global').catch(() => null);
    const targetPostsToday = deferPublication
      ? BLOG_DAILY_CANDIDATE_CAP
      : Math.min(
          BLOG_AUTOPUBLISH_POLICY_V3.dailyPublishCap,
          normalizeDailyPostTarget(publishPolicy?.posts_per_day ?? process.env.BLOG_DAILY_PUBLISH_TARGET),
        );
    const todayQuota = await getTodayBlogPublishCount();
    const slotQuota = calculateBlogPublishSlotQuota({
      dailyTarget: targetPostsToday,
      alreadyPublished: todayQuota.count,
      slotTimes: publishPolicy?.slot_times,
    });
    const generatedToday = deferPublication ? await getTodayBlogGenerationCount() : 0;
    const remainingDueNow = deferPublication
      ? Math.max(0, BLOG_DAILY_CANDIDATE_CAP - generatedToday)
      : slotQuota.remainingDueNow;
    if (remainingDueNow <= 0) {
      const dailyQuotaReached = slotQuota.remainingDaily <= 0;
      let atomicUpgradeResult: Awaited<ReturnType<typeof processQueueItem>> | null = null;
      if (!deferPublication && dailyQuotaReached && canStartPublisherQueueItem({
        source: 'quality_upgrade',
        meta: {
          private_regeneration: {
            mode: PUBLISHED_BLOG_ATOMIC_UPGRADE_MODE,
            atomic_publish_replace: true,
          },
        },
      }, publisherRemainingMs(startTime))) {
        const { data: atomicUpgrade, error: atomicUpgradeError } = await supabaseAdmin
          .from('blog_topic_queue')
          .select('*')
          .eq('status', 'queued')
          .lte('target_publish_at', new Date().toISOString())
          .contains('meta', {
            private_regeneration: {
              mode: PUBLISHED_BLOG_ATOMIC_UPGRADE_MODE,
              atomic_publish_replace: true,
            },
          })
          .order('priority', { ascending: false })
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (atomicUpgradeError) {
          errors.push(`atomic_quality_upgrade_lookup_failed:${atomicUpgradeError.message}`);
        } else if (atomicUpgrade) {
          atomicUpgradeResult = await processQueueItem(
            atomicUpgrade,
            new Map(),
            { startedAtMs: startTime },
          );
        }
      }
      return {
        processed: atomicUpgradeResult ? 1 : 0,
        published: 0,
        upgraded: atomicUpgradeResult?.status === 'upgraded' ? 1 : 0,
        skipped: atomicUpgradeResult === null,
        reason: atomicUpgradeResult
          ? 'daily_publish_quota_reached_atomic_upgrade_processed'
          : dailyQuotaReached
            ? 'daily_publish_quota_reached'
          : 'scheduled_publish_window_not_due',
        ...(atomicUpgradeResult ? { results: [atomicUpgradeResult] } : {}),
        dailyQuota: {
          day: todayQuota.dayKey,
          target: targetPostsToday,
          scheduledTargetNow: slotQuota.scheduledTargetNow,
          alreadyPublished: todayQuota.count,
          remaining: remainingDueNow,
          remainingAfterRun: 0,
          remainingDailyAfterRun: slotQuota.remainingDaily,
          nextSlot: slotQuota.nextSlot,
          slotTimes: slotQuota.slotTimes,
        },
        staleRecovery,
        recoverableBacklogRecovery,
        queueHealthCleanup,
        preflightQuarantine,
        pillarDeferral,
        errors,
      };
    }

    // 원자적 큐 클레임 — FOR UPDATE SKIP LOCKED 로 중복 발행 방지
    const queueRefill = await ensureDailyPublishableQueue({
      postsPerDay: targetPostsToday,
      minCandidates: Math.max(targetPostsToday * MIN_PUBLISHABLE_BUFFER_DAYS, remainingDueNow * CLAIM_POOL_MULTIPLIER, 8),
    }).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`publishable_queue_refill_failed: ${message}`);
      return null;
    });

    const claimLimit = Math.min(
      MAX_CANDIDATE_POOL,
      Math.max(MAX_BATCH, remainingDueNow * CLAIM_POOL_MULTIPLIER),
    );
    const claimedQueueRows: any[] = [];
    let { data: queue } = await supabaseAdmin.rpc('claim_queue_items', {
      limit_rows: claimLimit,
    });
    if (Array.isArray(queue)) claimedQueueRows.push(...queue);

    if (!queue || queue.length === 0) {
      const pulled = await pullForwardQueuedBacklog(claimLimit, attemptedQueueIds);
      if (pulled > 0) {
        const retryClaim = await supabaseAdmin.rpc('claim_queue_items', {
          limit_rows: claimLimit,
        });
        queue = retryClaim.data;
        if (Array.isArray(queue)) claimedQueueRows.push(...queue);
        if (retryClaim.error) {
          errors.push(`claim_queue_items retry failed: ${retryClaim.error.message}`);
        }
      }
      if (queue && queue.length > 0) {
        // Continue with pulled-forward backlog below.
      } else {
      return {
        processed: 0,
        published: 0,
        message: '발행할 토픽 없음',
        dailyQuota: {
          day: todayQuota.dayKey,
          target: targetPostsToday,
          scheduledTargetNow: slotQuota.scheduledTargetNow,
          alreadyPublished: todayQuota.count,
          remaining: remainingDueNow,
          remainingAfterRun: remainingDueNow,
          remainingDailyAfterRun: slotQuota.remainingDaily,
          nextSlot: slotQuota.nextSlot,
          slotTimes: slotQuota.slotTimes,
        },
        staleRecovery,
        recoverableBacklogRecovery,
        queueHealthCleanup,
        preflightQuarantine,
        pillarDeferral,
        queueRefill,
        failure_breakdown: { candidate_shortage: 1 },
        errors,
      };
    }
    }

    const cardNewsIds = [...new Set(queue.map((q: { card_news_id?: string | null }) => q.card_news_id).filter(Boolean))] as string[];
    const eligibleByCardNewsId =
      cardNewsIds.length > 0 ? await getEarliestBlogPublishEligibleMsBatch(cardNewsIds) : new Map<string, number>();

    let publishedThisRun = 0;
    let slotCompletionsThisRun = 0;
    let extraClaimRounds = 0;
    let pullForwarded = 0;
    let emergencyRefillRounds = 0;
    let stoppedForTimeBudget = false;
    const emergencyRefills: Array<Awaited<ReturnType<typeof ensureDailyPublishableQueue>> | null> = [];
    const orderedInitialQueue = prioritizeBlogSerpInitialCandidatesV3(sortPublisherQueueForTimeBudget(queue, {
      remainingMs: publisherRemainingMs(startTime),
      minItemStartMs: BLOG_PUBLISHER_MIN_ITEM_START_MS,
      fallbackMinItemStartMs: BLOG_PUBLISHER_FAST_FALLBACK_MIN_ITEM_START_MS,
      isFallbackEligible: isFastFallbackEligibleInfoItem,
    }));
    for (const item of orderedInitialQueue) {
      if (attemptedQueueIds.size >= MAX_CANDIDATE_ATTEMPTS_PER_RUN) break;
      if (attemptedQueueIds.has(item.id)) {
        results.push({ id: item.id, topic: item.topic, status: 'skipped', reason: 'already_attempted_this_run' });
        continue;
      }
      if (slotCompletionsThisRun >= remainingDueNow) {
        break;
      }
      // 남은 시간 체크 — 30초 미만이면 중단
      const remaining = publisherRemainingMs(startTime);
      if (!canStartPublisherQueueItem(item, remaining)) {
        stoppedForTimeBudget = true;
        console.log(`[blog-publisher] remaining ${Math.round(remaining / 1000)}s - stopping before next item`);
        break;
      }
      attemptedQueueIds.add(item.id);
      try {
        const r = await processQueueItem(item, eligibleByCardNewsId, { startedAtMs: startTime, deferPublication });
        results.push(r);
        if (r.status === 'published') {
          publishedThisRun += 1;
        }
        if (r.status === 'published' || r.status === 'approved_for_slot') slotCompletionsThisRun += 1;
        if (r.status !== 'published' && r.status !== 'approved_for_slot' && r.status !== 'done' && r.status !== 'deferred_buffer' && r.status !== 'deferred_time_budget' && r.status !== 'skipped') {
          candidateFailures.push(`${r.id} (${r.topic}): ${r.reason ?? r.status}`);
        }
      } catch (err) {
        candidateFailures.push(`${item.id} fatal: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    while (
      slotCompletionsThisRun < remainingDueNow
      && extraClaimRounds < MAX_EXTRA_CLAIM_ROUNDS
      && attemptedQueueIds.size < MAX_CANDIDATE_ATTEMPTS_PER_RUN
    ) {
      const remaining = publisherRemainingMs(startTime);
      const extraClaimPlan = getPublisherExtraClaimRecoveryPlan({
        remainingMs: remaining,
        minItemStartMs: BLOG_PUBLISHER_MIN_ITEM_START_MS,
        fallbackMinItemStartMs: BLOG_PUBLISHER_FAST_FALLBACK_MIN_ITEM_START_MS,
        remainingQuota: remainingDueNow - slotCompletionsThisRun,
        maxBatch: MAX_BATCH,
        claimPoolMultiplier: CLAIM_POOL_MULTIPLIER,
        maxCandidatePool: MAX_CANDIDATE_POOL,
      });
      if (!extraClaimPlan.canClaim) {
        stoppedForTimeBudget = true;
        console.log(`[blog-publisher] remaining ${Math.round(remaining / 1000)}s - stopping before next claim: ${extraClaimPlan.reason}`);
        break;
      }

      const remainingQuota = extraClaimPlan.remainingQuota;
      const extraClaimLimit = extraClaimPlan.claimLimit;
      extraClaimRounds += 1;
      const lowTimeFallbackOnly = extraClaimPlan.fallbackEligibleOnly;
      if (lowTimeFallbackOnly) {
        const pulledFallback = await pullForwardQueuedBacklog(extraClaimLimit, attemptedQueueIds, {
          fallbackEligibleOnly: true,
          priority: 95,
        });
        pullForwarded += pulledFallback;
      }

      const nextClaimResult = await supabaseAdmin.rpc('claim_queue_items', {
        limit_rows: extraClaimLimit,
      });
      let nextQueue = nextClaimResult.data;
      if (Array.isArray(nextQueue)) claimedQueueRows.push(...nextQueue);
      const nextClaimError = nextClaimResult.error;
      if (nextClaimError) {
        errors.push(`claim_queue_items extra failed: ${nextClaimError.message}`);
        break;
      }

      if (!nextQueue || nextQueue.length === 0) {
        emergencyRefillRounds += 1;
        const emergencyRefill = await ensureDailyPublishableQueue({
          postsPerDay: targetPostsToday,
          minCandidates: Math.max(targetPostsToday * MIN_PUBLISHABLE_BUFFER_DAYS, remainingQuota * CLAIM_POOL_MULTIPLIER, 8),
        }).catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          errors.push(`emergency_publishable_queue_refill_failed: ${message}`);
          return null;
        });
        emergencyRefills.push(emergencyRefill);

        const pulled = await pullForwardQueuedBacklog(extraClaimLimit, attemptedQueueIds, lowTimeFallbackOnly
          ? { fallbackEligibleOnly: true, priority: 95 }
          : undefined);
        pullForwarded += pulled;
        if (pulled <= 0 && !emergencyRefill?.added) break;

        const retryClaim = await supabaseAdmin.rpc('claim_queue_items', {
          limit_rows: extraClaimLimit,
        });
        nextQueue = retryClaim.data;
        if (Array.isArray(nextQueue)) claimedQueueRows.push(...nextQueue);
        if (retryClaim.error) {
          errors.push(`claim_queue_items extra retry failed: ${retryClaim.error.message}`);
          break;
        }
        if (!nextQueue || nextQueue.length === 0) break;
      }

      nextQueue = nextQueue.filter((q: { id?: string | null }) => q.id && !attemptedQueueIds.has(q.id));
      if (nextQueue.length === 0) break;

      const nextCardNewsIds = [...new Set(nextQueue.map((q: { card_news_id?: string | null }) => q.card_news_id).filter(Boolean))] as string[];
      const nextEligibleByCardNewsId =
        nextCardNewsIds.length > 0 ? await getEarliestBlogPublishEligibleMsBatch(nextCardNewsIds) : new Map<string, number>();

      const orderedNextQueue = prioritizeBlogSerpInitialCandidatesV3(sortPublisherQueueForTimeBudget(nextQueue, {
        remainingMs: publisherRemainingMs(startTime),
        minItemStartMs: BLOG_PUBLISHER_MIN_ITEM_START_MS,
        fallbackMinItemStartMs: BLOG_PUBLISHER_FAST_FALLBACK_MIN_ITEM_START_MS,
        isFallbackEligible: isFastFallbackEligibleInfoItem,
      }));

      for (const item of orderedNextQueue) {
        if (attemptedQueueIds.size >= MAX_CANDIDATE_ATTEMPTS_PER_RUN) break;
        if (attemptedQueueIds.has(item.id)) {
          results.push({ id: item.id, topic: item.topic, status: 'skipped', reason: 'already_attempted_this_run' });
          continue;
        }
        if (slotCompletionsThisRun >= remainingDueNow) break;

        const itemRemaining = publisherRemainingMs(startTime);
        if (!canStartPublisherQueueItem(item, itemRemaining)) {
          stoppedForTimeBudget = true;
          console.log(`[blog-publisher] remaining ${Math.round(itemRemaining / 1000)}s - stopping before next item`);
          break;
        }
        attemptedQueueIds.add(item.id);

        try {
          const r = await processQueueItem(item, nextEligibleByCardNewsId, { startedAtMs: startTime, deferPublication });
          results.push(r);
          if (r.status === 'published') {
            publishedThisRun += 1;
          }
          if (r.status === 'published' || r.status === 'approved_for_slot') slotCompletionsThisRun += 1;
          if (r.status !== 'published' && r.status !== 'approved_for_slot' && r.status !== 'done' && r.status !== 'deferred_buffer' && r.status !== 'deferred_time_budget' && r.status !== 'skipped') {
            candidateFailures.push(`${r.id} (${r.topic}): ${r.reason ?? r.status}`);
          }
        } catch (err) {
          candidateFailures.push(`${item.id} fatal: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    const timeBudgetClaimRelease = await releaseUnattemptedClaimedQueueItems(claimedQueueRows, attemptedQueueIds);
    if (timeBudgetClaimRelease.errors.length > 0) {
      errors.push(...timeBudgetClaimRelease.errors.map((error) => `time_budget_claim_release_failed:${error}`));
    }

    const baseUrl = resolveBlogCanonicalOrigin();
    const publishedSlugs = results
      .filter((r): r is typeof r & { reason: string } => r.status === 'published' && !!r.reason)
      .map(r => r.reason);
    const publicPublicationRequested = BLOG_AUTOPUBLISH_POLICY_V3.mode !== 'draft_only'
      && publishedSlugs.length > 0;
    let publicSnapshotRefresh: {
      status: 'not_needed' | 'succeeded' | 'failed';
      result?: unknown;
      error?: string;
    } = { status: 'not_needed' };
    if (publicPublicationRequested) {
      const { data: snapshotData, error: snapshotError } = await supabaseAdmin
        .rpc('refresh_blog_public_snapshots_v3');
      if (snapshotError) {
        publicSnapshotRefresh = { status: 'failed', error: snapshotError.message };
        errors.push(`public_snapshot_refresh_failed:${snapshotError.message}`);
      } else {
        publicSnapshotRefresh = { status: 'succeeded', result: snapshotData };
      }
    }
    const publicSideEffectsEnabled = publicPublicationRequested
      && publicSnapshotRefresh.status === 'succeeded';

    const creativeIdBySlug = new Map<string, string>();
    if (publicSideEffectsEnabled) {
      const { data: slugRows } = await supabaseAdmin
        .from('content_creatives')
        .select('id, slug')
        .in('slug', publishedSlugs)
        .eq('status', 'published');
      for (const row of slugRows ?? []) {
        if (row.slug && row.id) creativeIdBySlug.set(row.slug, row.id);
      }
    }

    // Indexing outbox + revalidatePath. External provider requests run in blog-indexing-worker.
    const indexingPromises: Promise<{ slug: string; ok: boolean; error?: string }>[] = [];
    for (const r of publicSideEffectsEnabled ? results : []) {
      if (r.status === 'published' && r.reason && !r.atomicIndexing) {
        const slug = r.reason;
        const contentCreativeId = creativeIdBySlug.get(slug) ?? null;
        indexingPromises.push((async () => {
          const result = await enqueueBlogIndexingJob({
            slug,
            baseUrl,
            contentCreativeId,
            source: 'blog_publisher',
          });
          if (!result.ok) {
            return { slug, ok: false, error: result.error || `indexing enqueue failed: ${slug}` };
          }
          return { slug, ok: true };
        })());
        revalidatePublicBlogCache(slug);
      }
    }
    const indexingResults = await Promise.allSettled(indexingPromises);
    const indexingFailures = indexingResults.flatMap((result) => {
      if (result.status === 'rejected') {
        return [{
          slug: 'unknown',
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        }];
      }
      return result.value.ok ? [] : [{
        slug: result.value.slug,
        error: result.value.error ?? 'indexing enqueue failed',
      }];
    });
    const indexingFailed = indexingFailures.length;
    if (indexingFailed > 0) {
      errors.push(...indexingFailures.map((failure) => `indexing_enqueue_failed:${failure.slug}:${failure.error}`));
    }

    if (
      publicSideEffectsEnabled
      && canRunOptionalPublisherWork(publisherRemainingMs(startTime), BLOG_PUBLISHER_OPTIONAL_WORK_MIN_MS)
    ) {
      try {
        const { data: ccRows } = await supabaseAdmin
          .from('content_creatives')
          .select('id, slug')
          .in('slug', publishedSlugs)
          .eq('status', 'published');
        const bySlug = new Map<string, string>();
        for (const row of ccRows ?? []) {
          const s = row?.slug;
          const id = row?.id;
          if (typeof s === 'string' && s && typeof id === 'string' && id) {
            bySlug.set(s, id);
          }
        }
        await Promise.all(
          publishedSlugs.map(async slug => {
            const cid = bySlug.get(slug);
            if (!cid) return;
            try {
              await indexBlog(cid);
            } catch (e) {
              logWarning('[cron/blog-publisher] RAG indexing failed (non-blocking)', e);
            }
          }),
        );
      } catch (e) {
        logWarning('[cron/blog-publisher] RAG batch fetch failed', e);
      }
    }
    if (publicSideEffectsEnabled) revalidatePublicBlogCache();

    const canDrainInlineIndexing = publicSideEffectsEnabled && canRunOptionalPublisherWork(
      publisherRemainingMs(startTime),
      BLOG_PUBLISHER_OPTIONAL_WORK_MIN_MS,
    );
    const indexingWorker = canDrainInlineIndexing
      ? await processDueBlogIndexingJobs({
          workerName: 'blog-publisher-inline-indexing',
          limit: 10,
          baseUrl,
        })
      : {
          skipped: true,
          reason: 'publisher_time_budget_reserved_for_summary',
          processed: 0,
          stale_reset: 0,
          results: [],
          errors: [],
        };
    if (indexingWorker.errors.length > 0) {
      errors.push(...indexingWorker.errors.map((error) => `indexing: ${error}`));
    }

    const publishedCount = results.filter(r => r.status === 'published').length;
    const approvedForSlotCount = results.filter(r => r.status === 'approved_for_slot').length;
    const quotaCompletedCount = deferPublication ? approvedForSlotCount : publishedCount;
    const failureBreakdown = buildPublisherFailureBreakdown(results);
    const canonicalMatched = publishedSlugs.every(slug => typeof slug === 'string' && slug.trim().length > 0 && !slug.startsWith('/'));
    const underfilledQuota = !deferPublication && quotaCompletedCount < remainingDueNow;
    if (underfilledQuota) {
      errors.push(
        quotaCompletedCount === 0
          ? 'publisher_zero_published_with_remaining_quota'
          : 'publisher_under_published_with_remaining_quota',
      );
      errors.push(...candidateFailures.slice(0, 5).map((failure) => `candidate_failure:${failure}`));
    }

    return {
      processed: results.length,
      published: publishedCount,
      approvedForSlot: approvedForSlotCount,
      phase: deferPublication ? 'generate_only' : 'generate_and_publish',
      candidate_failures: candidateFailures,
      indexingWorker,
      publicSnapshotRefresh,
      dailyQuota: {
        day: todayQuota.dayKey,
        target: targetPostsToday,
        scheduledTargetNow: slotQuota.scheduledTargetNow,
        alreadyPublishedBeforeRun: todayQuota.count,
        remainingBeforeRun: remainingDueNow,
        remainingAfterRun: Math.max(0, remainingDueNow - quotaCompletedCount),
        remainingDailyAfterRun: Math.max(0, slotQuota.remainingDaily - publishedCount),
        nextSlot: slotQuota.nextSlot,
        slotTimes: slotQuota.slotTimes,
      },
      quota_fulfillment: {
        required: remainingDueNow,
        published: publishedCount,
        approvedForSlot: approvedForSlotCount,
        met: !underfilledQuota,
        candidate_failures: candidateFailures.length,
        attempted_candidates: attemptedQueueIds.size,
      },
      staleRecovery,
      recoverableBacklogRecovery,
      queueHealthCleanup,
      preflightQuarantine,
      pillarDeferral,
      queueRefill,
      failure_breakdown: failureBreakdown,
      operational_checks: {
        published_count: publishedCount,
        quality_passed: results.filter(r => r.status === 'published').length === publishedCount,
        indexing_queued: publishedCount === 0 ? true : indexingFailed === 0,
        canonical_matched: canonicalMatched,
      },
      extraClaimRounds,
      emergencyRefillRounds,
      emergencyRefills,
      pullForwarded,
      timeBudgetClaimRelease,
      time_budget: {
        max_exec_ms: MAX_EXEC_MS,
        min_item_start_ms: BLOG_PUBLISHER_MIN_ITEM_START_MS,
        fast_fallback_min_item_start_ms: BLOG_PUBLISHER_FAST_FALLBACK_MIN_ITEM_START_MS,
        item_finish_reserve_ms: BLOG_PUBLISHER_ITEM_FINISH_RESERVE_MS,
        optional_work_min_ms: BLOG_PUBLISHER_OPTIONAL_WORK_MIN_MS,
        remaining_ms: publisherRemainingMs(startTime),
        stopped_for_time_budget: stoppedForTimeBudget,
        inline_indexing_drained: canDrainInlineIndexing,
      },
      results,
      errors,
      ranAt: new Date().toISOString(),
    };
  } catch (err) {
    errors.push(`fatal: ${err instanceof Error ? err.message : String(err)}`);
    return { processed: 0, errors, results };
  }
}

export const GET = withCronLogging('blog-publisher', runBlogPublisher, {
  handlerTimeoutMs: 285_000,
  sideEffectTimeoutMs: 5_000,
});

async function isRecentInfoDuplicateCandidate(item: any): Promise<boolean> {
  const scope = buildRecentInfoDuplicateScope(item);
  if (!scope) return false;
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  let query = supabaseAdmin
    .from('content_creatives')
    .select('id', { count: 'exact', head: true })
    .eq('channel', 'naver_blog')
    .eq('status', 'published')
    .eq('destination', scope.destination)
    .eq('angle_type', scope.angleType)
    .is('product_id', null)
    .gte('published_at', cutoff);

  // Refill candidates under the broad `value` angle are intentionally
  // distinct when their micro angles differ. Legacy rows without a micro
  // angle keep the conservative destination+angle duplicate rule.
  if (scope.microAngle) {
    query = query.contains('generation_meta', { micro_angle: scope.microAngle });
  }

  const { count, error } = await query;

  if (error) {
    logWarning('[cron/blog-publisher] recent duplicate precheck failed', {
      id: item.id,
      destination: scope.destination,
      angleType: scope.angleType,
      microAngle: scope.microAngle,
      error: error.message,
    });
    return false;
  }

  return Number(count ?? 0) > 0;
}

interface BlogAttemptRevalidationRequestV4 {
  attemptId: string;
  reason: 'opening_heading_exclusion_v1' | 'route_template_dedup_v2';
}

function readBlogAttemptRevalidationRequestV4(item: any): BlogAttemptRevalidationRequestV4 | null {
  const request = item?.meta?.deterministic_attempt_revalidation_v4;
  if (!request || typeof request !== 'object' || Array.isArray(request)) return null;
  const attemptId = typeof request.attempt_id === 'string' ? request.attempt_id.trim() : '';
  const attemptCount = Number(item?.attempts || 0);
  const reason = request.reason as BlogAttemptRevalidationRequestV4['reason'];
  const attemptCountAllowed = reason === 'opening_heading_exclusion_v1'
    ? attemptCount === BLOG_QUALITY_MAX_ATTEMPTS_V4
    : reason === 'route_template_dedup_v2' && attemptCount === 4;
  if (item?.meta?.controlled_publish_canary !== true
    || item?.source !== 'user_seed'
    || !attemptCountAllowed
    || request.mode !== 'deterministic_quality_revalidation'
    || !['opening_heading_exclusion_v1', 'route_template_dedup_v2'].includes(request.reason)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(attemptId)) {
    return null;
  }
  return { attemptId, reason };
}

async function processQueueItem(
  item: any,
  eligibleByCardNewsId: Map<string, number>,
  options: {
    startedAtMs?: number;
    validatedPrivateRegenerationRequest?: PrivateBlogRegenerationRequest;
    deferPublication?: boolean;
  } = {},
): Promise<{
  id: string;
  topic: string;
  status: string;
  reason?: string;
  atomicIndexing?: boolean;
}> {
  const attemptRevalidationRequest = readBlogAttemptRevalidationRequestV4(item);
  // 동시성 방지 — generating 락
  const { data: lockedRow, error: lockErr } = await supabaseAdmin
    .from('blog_topic_queue')
    .update({
      status: 'generating',
      // Evaluator-only revalidation reuses the durable model output and must
      // not consume or fabricate another model-attempt number.
      attempts: attemptRevalidationRequest
        ? Number(item.attempts || 0)
        : (item.attempts || 0) + 1,
    })
    .eq('id', item.id)
    .eq('status', 'queued')
    .select('id')
    .maybeSingle();

  if (lockErr || !lockedRow) {
    return {
      id: item.id,
      topic: item.topic,
      status: 'lock_failed',
      reason: lockErr?.message || 'queue_item_not_available_for_claim',
    };
  }

  try {
    const startedAtMs = options.startedAtMs ?? Date.now();
    const contentBoundary = routeBlogContentLane({
      source: item.source,
      productId: item.product_id ?? null,
      cardNewsId: item.card_news_id ?? null,
      declaredLane: item.content_lane ?? null,
    });
    if (!contentBoundary.passed) {
      const reason = `content_boundary_failed:${contentBoundary.issue}`;
      await handleFailure(item, reason, null, true, { content_boundary: contentBoundary });
      return { id: item.id, topic: item.topic, status: 'skipped', reason };
    }
    const privateRegenerationIntent = hasPrivateBlogRegenerationIntent(item);
    const demandPreflight = await loadQueueDemandEvidenceV3(item);
    if (
      !privateRegenerationIntent
      && BLOG_AUTOPUBLISH_POLICY_V3.requireDemandSignal
      && (!demandPreflight.repositoryReady || !hasVerifiedBlogDemandSignal(demandPreflight.signal))
    ) {
      const reason = demandPreflight.repositoryReady
        ? 'verified_demand_signal_missing_before_generation'
        : 'demand_signal_repository_unavailable_before_generation';
      await handleFailure(item, reason, null, true, {
        demand_preflight_v3: {
          repository_ready: demandPreflight.repositoryReady,
          accepted_providers: demandPreflight.acceptedProviders,
          rejected_count: demandPreflight.rejectedCount,
          error: demandPreflight.error,
        },
      });
      return { id: item.id, topic: item.topic, status: 'skipped', reason };
    }
    if (item.card_news_id) {
      const cnid = item.card_news_id as string;
      const eligibleMs =
        eligibleByCardNewsId.get(cnid) ?? Date.now() + getCardNewsRenderBufferMs();
      if (Date.now() < eligibleMs) {
        const when = new Date(eligibleMs).toISOString();
        await supabaseAdmin
          .from('blog_topic_queue')
          .update({
            status: 'queued',
            attempts: item.attempts ?? 0,
            target_publish_at: when,
            last_error: null,
            updated_at: new Date().toISOString(),
            meta: {
              ...(item.meta || {}),
              render_buffer_until: when,
              deferred_render_buffer_at: new Date().toISOString(),
            },
          })
          .eq('id', item.id);
        return { id: item.id, topic: item.topic, status: 'deferred_buffer', reason: when };
      }
    }

    // 생성 경로 분기
    //   1) pillar → /destinations/[city] 허브 본문 생성 (장문 AI)
    //   2) card_news 연결 → from-card-news API 위임 (PNG 삽입 블로그)
    //   3) product_id 있음 → grounded product draft + DeepSeek V4
    //   4) 나머지 → research-backed DeepSeek V4 정보성 글
    const topicFit = evaluateBlogTopicFit({
      topic: item.topic,
      destination: item.destination,
      primaryKeyword: item.primary_keyword,
      angleType: item.angle_type,
      category: item.category,
      contentType: item.source === 'pillar' ? 'pillar' : (item.product_id ? 'package_intro' : 'guide'),
      source: item.source,
      productId: item.product_id,
    });
    if (!topicFit.passed) {
      const reason = `topic_fit_failed_before_generation: ${topicFit.issues
        .filter((issue) => issue.severity === 'critical')
        .map((issue) => issue.code)
        .join(', ') || 'unknown'}`;
      await handleFailure(item, reason, { topic_fit_gate: topicFit }, true);
      return { id: item.id, topic: item.topic, status: 'skipped', reason };
    }

    const privateRegenerationRequest = options.validatedPrivateRegenerationRequest
      ?? readPrivateBlogRegenerationRequest(item);
    const publishedAtomicUpgrade = isPublishedBlogAtomicUpgradeRequest(privateRegenerationRequest);
    let privateReplacementDraftId: string | null = null;
    let privateReplacementAssets: { ogImageUrl: string | null; inlineImageUrls: string[] } | null = null;
    let originalPublishedAt: string | null = null;
    let originalPublishedSlug: string | null = null;
    if (privateRegenerationIntent && !privateRegenerationRequest) {
      const reason = 'private_regeneration_request_invalid';
      await handleFailure(item, reason, null, true, {
        private_regeneration_blocked: true,
      });
      return { id: item.id, topic: item.topic, status: 'skipped', reason };
    }
    if (privateRegenerationRequest) {
      const { data: replacementTarget, error: replacementTargetError } = await supabaseAdmin
        .from('content_creatives')
        .select('id,channel,status,product_id,published_at,slug,generation_meta,og_image_url,blog_html')
        .eq('id', privateRegenerationRequest.contentCreativeId)
        .maybeSingle();
      if (
        replacementTargetError
        || !replacementTarget
        || !isEligiblePrivateBlogRegenerationTarget(replacementTarget, privateRegenerationRequest)
      ) {
        const reason = 'private_regeneration_target_not_eligible';
        await handleFailure(item, reason, null, true, {
          private_regeneration_blocked: true,
          target_error: replacementTargetError?.message ?? null,
        });
        return { id: item.id, topic: item.topic, status: 'skipped', reason };
      }
      privateReplacementDraftId = privateRegenerationRequest.contentCreativeId;
      originalPublishedAt = typeof replacementTarget.published_at === 'string'
        ? replacementTarget.published_at
        : null;
      originalPublishedSlug = typeof replacementTarget.slug === 'string'
        ? replacementTarget.slug
        : null;
      privateReplacementAssets = {
        ogImageUrl: typeof replacementTarget.og_image_url === 'string' ? replacementTarget.og_image_url : null,
        inlineImageUrls: extractBlogInlineImageUrls(
          typeof replacementTarget.blog_html === 'string' ? replacementTarget.blog_html : null,
        ),
      };
    }
    let queueReusableDraftId: string | null = null;
    let queueReusableDraftReviewStatus: string | null = null;
    let queueReusableAssets: { ogImageUrl: string | null; inlineImageUrls: string[] } | null = null;
    if (!privateRegenerationRequest && typeof item.content_creative_id === 'string') {
      const { data: queueCreative, error: queueCreativeError } = await supabaseAdmin
        .from('content_creatives')
        .select('id,channel,status,review_status,og_image_url,blog_html')
        .eq('id', item.content_creative_id)
        .maybeSingle();
      if (queueCreativeError) {
        logWarning('[cron/blog-publisher] queue draft asset lookup failed', queueCreativeError);
      } else if (
        queueCreative
        && queueCreative.channel === 'naver_blog'
        && queueCreative.status === 'draft'
      ) {
        queueReusableDraftId = queueCreative.id;
        queueReusableDraftReviewStatus = typeof queueCreative.review_status === 'string'
          ? queueCreative.review_status
          : null;
        queueReusableAssets = {
          ogImageUrl: typeof queueCreative.og_image_url === 'string' ? queueCreative.og_image_url : null,
          inlineImageUrls: extractBlogInlineImageUrls(
            typeof queueCreative.blog_html === 'string' ? queueCreative.blog_html : null,
          ),
        };
      }
    }
    const replacementAssets = privateReplacementAssets ?? queueReusableAssets;

    if (contentBoundary.lane === 'informational' && !publishedAtomicUpgrade) {
      const queueBrief = buildQueueContentBrief(item);
      const destinationId = queueBrief.plan.destinationId;
      if (queueBrief.passed && destinationId) {
        const representativeKey = buildBlogInformationRepresentativeKey({
          destinationId,
          intent: queueBrief.intentType,
          audience: queueBrief.plan.audience,
          locale: queueBrief.plan.locale,
        });
        const existingRepresentative = await findBlogInformationRepresentative(representativeKey);
        const reservationOwner = `blog_topic_queue:${item.id}`;
        const mayResumeOwnReservation = existingRepresentative?.status === 'reserved'
          && existingRepresentative.reservationOwner === reservationOwner;
        if (existingRepresentative && !mayResumeOwnReservation) {
          const reason = `information_representative_preclaim:${existingRepresentative.status}:${
            existingRepresentative.canonicalSlug ?? representativeKey
          }`;
          await handleFailure(item, reason, null, false, {
            information_representative_preclaim: true,
            representative_key: representativeKey,
            canonical_creative_id: existingRepresentative.canonicalCreativeId,
            canonical_slug: existingRepresentative.canonicalSlug,
            representative_status: existingRepresentative.status,
          });
          return { id: item.id, topic: item.topic, status: 'skipped_duplicate', reason };
        }
      }
    }

    if (!publishedAtomicUpgrade && await isRecentInfoDuplicateCandidate(item)) {
      const reason = `recent_info_duplicate_before_generation: 최근 14일 내 ${item.destination ?? '동일 목적지'} + ${item.angle_type ?? 'value'} 정보성 글 이미 발행됨`;
      await handleFailure(item, reason, null, false, {
        pre_generation_duplicate_check: true,
      });
      return { id: item.id, topic: item.topic, status: 'skipped', reason };
    }

    let generated: GeneratedBlog;
    let revalidatedAttemptId: string | null = null;
    /** 카드뉴스로 이미 만든 draft 행을 published 로 승격할 때 사용 */
    let promoteDraftId: string | null = null;
    promoteDraftId = privateReplacementDraftId ?? queueReusableDraftId;

    if (item.source === 'pillar' && item.destination) {
      // A pillar is now a representative-refresh strategy, not a fixed writer
      // template. The normal V3 path enforces official evidence, a flexible
      // archetype and the broad-query no-new-URL rule before generation.
      generated = await withGenerationBudget(startedAtMs, 'pillar_generation', () => generatePillar(item));
    } else if (contentBoundary.lane === 'card_news_bridge') {
      promoteDraftId = null;
      const { data: cnCheck } = await supabaseAdmin
        .from('card_news')
        .select('linked_blog_id')
        .eq('id', item.card_news_id)
        .limit(1);
      const linkedId = cnCheck?.[0]?.linked_blog_id as string | undefined;

      if (linkedId) {
        const { data: ccRow } = await supabaseAdmin
          .from('content_creatives')
          .select('id, status, blog_html, slug, seo_title, seo_description, og_image_url')
          .eq('id', linkedId)
          .maybeSingle();

        if (!ccRow) {
          await handleFailure(item, 'card_news.linked_blog_id 에 해당하는 content_creatives 행 없음', null, true);
          return { id: item.id, topic: item.topic, status: 'error', reason: 'orphan_linked_blog' };
        }

        if (ccRow.status === 'published') {
          await supabaseAdmin
            .from('blog_topic_queue')
            .update({
              status: 'done',
              content_creative_id: ccRow.id,
              meta: { ...(item.meta || {}), skip_reason: 'card_news_blog_already_published' },
            })
            .eq('id', item.id);
          return { id: item.id, topic: item.topic, status: 'done', reason: 'already_published' };
        }

        if (ccRow.status === 'draft' && (ccRow.blog_html || '').length >= 80) {
          promoteDraftId = ccRow.id;
          generated = {
            blog_html: ccRow.blog_html as string,
            slug: ccRow.slug as string,
            seo_title: (ccRow.seo_title as string) || item.topic,
            seo_description: (ccRow.seo_description as string) || '',
            og_image_url: ccRow.og_image_url,
          };
        } else {
          await handleFailure(
            item,
            `연결된 블로그 초안이 비어 있거나 상태가 비정상(status=${ccRow.status})`,
            null,
            true,
          );
          return { id: item.id, topic: item.topic, status: 'error', reason: 'invalid_linked_draft' };
        }
      } else {
        generated = await withGenerationBudget(startedAtMs, 'card_news_generation', () => generateFromCardNews(item, eligibleByCardNewsId));
      }
    } else if (contentBoundary.lane === 'product') {
      generated = await withGenerationBudget(startedAtMs, 'product_generation', () => generateFromProduct(item));
    } else {
      const remainingBeforeTopicGeneration = publisherRemainingMs(startedAtMs);
      if (!canStartPublisherQueueItem(item, remainingBeforeTopicGeneration)) {
        await deferAttemptedQueueItemForTimeBudget(item, remainingBeforeTopicGeneration);
        return {
          id: item.id,
          topic: item.topic,
          status: 'deferred_time_budget',
          reason: `publisher_deferred_before_generation_time_budget:${remainingBeforeTopicGeneration}ms`,
        };
      }

      try {
        if (attemptRevalidationRequest) {
          const revalidationCandidate = await loadBlogAttemptRevalidationCandidateV4(
            item,
            attemptRevalidationRequest,
          );
          generated = revalidationCandidate.generated;
          revalidatedAttemptId = revalidationCandidate.attemptId;
        } else {
          generated = await withGenerationBudget(startedAtMs, 'topic_generation', () => generateFromTopic(item, {
            validatedPrivateRegenerationRequest: privateRegenerationRequest ?? undefined,
          }));
        }
      } catch (error) {
        if (item.meta?.private_diagnostic_fallback === true) {
          generated = {
            blog_html: '',
            slug: buildQueueSlug(item),
            seo_title: item.topic || item.primary_keyword || '여행 준비 가이드',
            seo_description: '',
            generation_meta: {
              writer: 'info_writer',
              topic_generation_error: error instanceof Error ? error.message : String(error),
            },
          };
          await applyDeterministicInfoFallback(
            generated,
            item,
            item.primary_keyword ?? item.destination ?? item.topic,
            error instanceof Error ? error.message : String(error),
          );
        } else {
          throw error;
        }
      }
    }

    // Deterministic fallback copy is only an operational recovery artifact. It is
    // intentionally generic and therefore must never become a public/searchable
    // article, even if downstream shape/SEO gates happen to pass.
    if (
      generated.generation_meta?.deterministic_info_fallback === true
      || generated.generation_meta?.deterministic_fast_fallback === true
    ) {
      const reason = 'deterministic_info_fallback_not_publishable';
      const failureStatus = await handleFailure(item, reason, null, false, {
        deterministic_fallback_blocked: true,
        deterministic_fallback_reason: generated.generation_meta?.deterministic_fallback_reason ?? null,
      });
      return {
        id: item.id,
        topic: item.topic,
        status: failureStatus === 'skipped' ? 'skipped' : 'gate_failed',
        reason,
      };
    }

    generated.slug = preservePublishedBlogAtomicUpgradeSlug({
      publishedAtomicUpgrade,
      originalSlug: originalPublishedSlug,
      generatedSlug: generated.slug,
    });
    const evidenceContentKey = contentBoundary.lane === 'informational'
      ? buildQueueSlug(item)
      : generated.slug;

    if (replacementAssets?.ogImageUrl && !generated.og_image_url) {
      generated.og_image_url = replacementAssets.ogImageUrl;
    }
    const minimumInlineImages = 0;
    const maximumInlineImages = item.card_news_id ? 3 : 4;
    const reusableImageCount = replacementAssets
      ? new Set([
          ...replacementAssets.inlineImageUrls,
          ...(replacementAssets.ogImageUrl ? [replacementAssets.ogImageUrl] : []),
        ].filter((url) => /^https:\/\//i.test(url))).size
      : 0;
    const replacementImageShortfall = replacementAssets !== null
      ? Math.max(0, minimumInlineImages - reusableImageCount)
      : 0;
    const mayFillReplacementImageShortfall = replacementAssets !== null
      && replacementImageShortfall > 0;

    const slugNormalized = publishedAtomicUpgrade ? false : normalizeGeneratedSlug(generated, item);
    if (slugNormalized && promoteDraftId) {
      await supabaseAdmin
        .from('content_creatives')
        .update({
          slug: generated.slug,
          updated_at: new Date().toISOString(),
        })
        .eq('id', promoteDraftId);
    }

    // V3 evaluates authored links, CTAs, language, and evidence as-is. It does
    // not append or rewrite editorial content to satisfy a score.
    const blogType: 'product' | 'info' = item.product_id ? 'product' : 'info';
    // Pillar posts: skip keyword density (destination name dominates by design)
    // Compound destinations (X/Y/Z) stay broad enough to avoid single-city keyword stuffing.
    const generatedContentBrief =
      generated.generation_meta?.content_brief as { primary_keyword?: string; seo_keyword?: string } | undefined;
    const generatedSeoMeta =
      generated.generation_meta?.seo as { primary_keyword?: string; seo_keyword?: string } | undefined;
    const generatedPrimaryKeyword = item.product_id
      ? generatedSeoMeta?.seo_keyword
        || generatedSeoMeta?.primary_keyword
        || generatedContentBrief?.seo_keyword
        || generatedContentBrief?.primary_keyword
        || null
      : generatedContentBrief?.primary_keyword
        || generatedSeoMeta?.primary_keyword
        || null;
    const primaryKeyword = choosePublisherPrimaryKeyword({
      source: item.source,
      productId: item.product_id ?? null,
      destination: item.destination ?? null,
      itemPrimaryKeyword: item.primary_keyword ?? (item.meta?.keywords as string[] | undefined)?.[0] ?? null,
      generatedPrimaryKeyword,
      topic: item.topic ?? null,
    });

    {
      const safeRepair = repairBlogPublishFormattingV3(generated.blog_html);
      if (safeRepair.changed) generated.blog_html = safeRepair.markdown;
    }

    // 일반 정보성/상품 글도 카드뉴스 경로처럼 본문 안에 사진을 보유하게 만든다.
    // AI가 이미 섹션 이미지를 넣은 경우에는 건드리지 않고, 부족분만 Pexels/OG 이미지로 보강한다.
    try {
      const imageResult = await ensureBlogInlineImages({
        markdown: generated.blog_html,
        destination: item.destination,
        primaryKeyword,
        ogImageUrl: generated.og_image_url,
        minImages: minimumInlineImages,
        maxImages: maximumInlineImages,
        fallbackImageUrls: replacementAssets?.inlineImageUrls,
        preferFallbackImages: replacementAssets !== null,
        allowPexelsSearch: replacementAssets === null || mayFillReplacementImageShortfall,
        allowGeneratedFallback: replacementAssets === null || mayFillReplacementImageShortfall,
        maxExternalAssetAttempts: replacementAssets === null
          ? undefined
          : replacementImageShortfall,
      });
      if (imageResult.inserted > 0) {
        generated.blog_html = imageResult.markdown;
        console.log(`[blog-publisher] 본문 이미지 ${imageResult.inserted}장 자동 삽입`);
      }
      if (publishedAtomicUpgrade && !generated.og_image_url) {
        const [firstInlineImage] = extractBlogInlineImageUrls(generated.blog_html);
        if (firstInlineImage) {
          generated.og_image_url = firstInlineImage;
          generated.generation_meta = {
            ...(generated.generation_meta || {}),
            cover_image: {
              provider: 'inline_asset',
              disclosure: isGeneratedBlogImageUrl(firstInlineImage) ? 'AI 생성 참고 이미지' : null,
            },
          };
        }
      }
    } catch (e) {
      logWarning('[cron/blog-publisher] inline image insertion failed (non-blocking)', e);
    }

    // 이미지/CTA 후처리 이후에도 공식 외부 링크 기준을 최종 보장한다.

    generated.blog_html = sanitizeBlogCtaLinks(generated.blog_html, {
      destination: item.destination,
      slug: generated.slug,
      utmSource: 'naver_blog',
    });
    applyFinalCustomerSurfaceRepair(generated, item, primaryKeyword);

    const applyFinalResearchStructureRepair = (): void => {
      // Claim validation blocks publication; it does not synthesize prose.
    };
    const restoreFinalReusableImages = async (): Promise<void> => {
      const imageResult = await ensureBlogInlineImages({
        markdown: generated.blog_html,
        destination: item.destination,
        primaryKeyword,
        ogImageUrl: replacementAssets?.ogImageUrl ?? generated.og_image_url,
        minImages: minimumInlineImages,
        maxImages: maximumInlineImages,
        fallbackImageUrls: replacementAssets?.inlineImageUrls,
        preferFallbackImages: replacementAssets !== null,
        allowPexelsSearch: replacementAssets === null || mayFillReplacementImageShortfall,
        allowGeneratedFallback: replacementAssets === null || mayFillReplacementImageShortfall,
        maxExternalAssetAttempts: replacementAssets === null
          ? undefined
          : Math.max(replacementImageShortfall, minimumInlineImages),
      });
      if (imageResult.inserted > 0) {
        generated.blog_html = imageResult.markdown;
        console.log(`[blog-publisher] final inline images restored: ${imageResult.inserted}`);
      }
    };
    const applyFinalLiteralNewlineRepair = (): void => {
      const literalNewlineRepair = repairBlogLiteralNewlines(generated.blog_html);
      if (!literalNewlineRepair.changed) return;
      generated.blog_html = literalNewlineRepair.markdown;
      generated.generation_meta = {
        ...(generated.generation_meta || {}),
        literal_newline_repair: {
          applied: true,
          replacement_count: literalNewlineRepair.replacementCount,
        },
      };
      console.log(
        `[blog-publisher] literal newline repair: ${literalNewlineRepair.replacementCount}`,
      );
    };
    const applyFinalInlineSurfaceRepair = (): void => {
      // V3 does not rewrite prose at the inline surface stage.
    };
    const applyFinalGateCustomerSurfaceRepair = (): void => {
      const surfaceChanges = applyFinalCustomerSurfaceRepair(generated, item, primaryKeyword);
      if (surfaceChanges.length > 0) {
        console.log(`[blog-publisher] final gate customer surface repair: ${surfaceChanges.join(', ')}`);
      }
    };
    const applyFinalReadinessFloorRepair = (): void => {
      // Missing readiness content is a gate failure in V3.
    };
    const applyFinalInternalLinkFloor = (): void => {
      if (blogType !== 'info') return;
      const hasInternalLink = [...generated.blog_html.matchAll(
        /(?<!!)\[[^\]]+]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
      )].some((match) => {
        const href = match[1] || '';
        return href.startsWith('/') || /yeosonam\.com/i.test(href);
      });
      if (hasInternalLink) return;
      // Do not append generic internal links merely to satisfy a score.
    };
    const runQualityWithResearchStructure = async (): Promise<QualityGateReport> => {
      applyFinalGateCustomerSurfaceRepair();
      applyFinalResearchStructureRepair();
      applyFinalInternalLinkFloor();
      await restoreFinalReusableImages();
      applyFinalReadinessFloorRepair();
      applyFinalInlineSurfaceRepair();
      applyFinalLiteralNewlineRepair();
      return runGeneratedQualityGates(generated, item, blogType, primaryKeyword);
    };
    const runQualityAfterAiReadableRepair = async (): Promise<QualityGateReport> => {
      applyFinalGateCustomerSurfaceRepair();
      // Research-backed structure is the last structural body mutation so generic
      // cleanup cannot prune high-risk entry evidence from the customer article.
      applyFinalResearchStructureRepair();
      applyFinalInternalLinkFloor();
      await restoreFinalReusableImages();
      applyFinalReadinessFloorRepair();
      applyFinalInlineSurfaceRepair();
      applyFinalLiteralNewlineRepair();
      return runGeneratedQualityGates(generated, item, blogType, primaryKeyword);
    };
    const evaluateCurrentInformationClaimValidation = async () => {
      const writerClaimLedgerMeta = generated.generation_meta?.writer_claim_ledger;
      const writerClaimLedgerRecord = writerClaimLedgerMeta
        && typeof writerClaimLedgerMeta === 'object'
        && !Array.isArray(writerClaimLedgerMeta)
        ? writerClaimLedgerMeta as Record<string, unknown>
        : null;
      const writerClaimLedger = Array.isArray(writerClaimLedgerRecord?.claims)
        ? writerClaimLedgerRecord.claims as BlogInformationClaimLedgerEntry[]
        : [];
      const writerClaimLedgerIssues = Array.isArray(writerClaimLedgerRecord?.issues)
        ? writerClaimLedgerRecord.issues.filter((issue): issue is string => typeof issue === 'string').slice(0, 20)
        : (contentBoundary.lane === 'informational' ? ['claim_ledger_missing'] : []);
      const generatedPlanBrief = generated.generation_meta?.content_brief;
      const generatedPlanBriefRecord = generatedPlanBrief
        && typeof generatedPlanBrief === 'object'
        && !Array.isArray(generatedPlanBrief)
        ? generatedPlanBrief as Record<string, unknown>
        : null;
      const validation = await evaluateBlogInformationClaimPublishGate({
        creativeId: promoteDraftId,
        contentKey: evidenceContentKey,
        // Title and description are public factual surfaces too. Validate them
        // with the same claim ledger instead of checking only the article body.
        markdown: [generated.seo_title, generated.seo_description, generated.blog_html]
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
          .join('\n\n'),
        productId: item.product_id ?? null,
        tenantId: item.tenant_id ?? null,
        reviewStatus: queueReusableDraftReviewStatus,
        claimLedger: contentBoundary.lane === 'informational' ? writerClaimLedger : undefined,
        claimLedgerIssues: contentBoundary.lane === 'informational' ? writerClaimLedgerIssues : undefined,
        intentType: typeof generatedPlanBriefRecord?.intent_type === 'string'
          ? generatedPlanBriefRecord.intent_type
          : null,
        expectedScope: contentBoundary.lane === 'informational'
          ? {
              destination: item.destination ?? undefined,
              locale: typeof generatedPlanBriefRecord?.locale === 'string'
                ? generatedPlanBriefRecord.locale
                : undefined,
            }
          : undefined,
      });
      return {
        validation,
        summary: toBlogInformationClaimValidationMeta(validation),
        generatedPlanBrief,
        generatedPlanBriefRecord,
        writerClaimLedger,
        writerClaimLedgerIssues,
      };
    };

    let qa = await runQualityWithResearchStructure();

    if (!qa.passed && qa.gates.some(gate => gate.gate === 'ai_readability' && !gate.passed)) {
      qa = await runQualityAfterAiReadableRepair();
    }

    if (!qa.passed) {
      qa = await repairFailedQualityGates(generated, item, qa, blogType, primaryKeyword);
      qa = await runQualityWithResearchStructure();
    }

    if (!qa.passed && qa.gates.some(gate => gate.gate === 'ai_readability' && !gate.passed)) {
      qa = await runQualityAfterAiReadableRepair();
    }

    if (!qa.passed) {
      console.log(`[blog-publisher] quality gate failed; preserving generated content as a private review draft (${qa.summary})`);
    }

    const preSeoContentBrief = generated.generation_meta?.content_brief;
    const preSeoContentBriefRecord = preSeoContentBrief
      && typeof preSeoContentBrief === 'object'
      && !Array.isArray(preSeoContentBrief)
      ? preSeoContentBrief as Record<string, unknown>
      : null;
    const requiresPreSeoClaimValidation = blogType === 'info'
      && (preSeoContentBriefRecord?.requires_human_review === true || isHighRiskInformationalTopic({
        title: generated.seo_title ?? item.topic ?? null,
        category: item.category ?? null,
        contentType: item.source === 'pillar' ? 'pillar' : 'guide',
        topic: item.topic ?? null,
      }));
    if (requiresPreSeoClaimValidation) {
      const preSeoClaimValidation = await evaluateCurrentInformationClaimValidation();
      generated.generation_meta = {
        ...(generated.generation_meta || {}),
        information_claim_validation: preSeoClaimValidation.summary,
      };
    }

    // 🆕 GSC 키워드 연구 데이터 보강 (환경이 설정된 경우 Google Search Console 사용)
    if (
      primaryKeyword
      && canRunOptionalPublisherWork(publisherRemainingMs(startedAtMs), BLOG_PUBLISHER_OPTIONAL_WORK_MIN_MS)
    ) {
      try {
        const kwResearch = await researchKeyword(primaryKeyword);
        // GSC 데이터가 있으면 보강 (googleapis 의존성)
        try {
          const enriched = await enrichWithGscData(primaryKeyword, kwResearch);
          if (enriched.source === 'gsc') {
            console.log(`[blog-publisher] GSC 관측 신호: ${primaryKeyword} → ${enriched.observed_search_performance?.impressions ?? 0} impressions, competition=${enriched.competition_level}`);
          }
        } catch { /* GSC 보강 실패 — 계속 진행 */ }
      } catch { /* 키워드 리서치 실패 — 계속 진행 */ }
    }

    // 🆕 SEO 점수 측정 — 기준 미만이면 발행 보류 (qualify_gate 후 추가 게이트)
    const imgCount = (generated.blog_html.match(/!\[/g) || []).length;
    const imgWithAlt = (generated.blog_html.match(/!\[[^\]]+\]\(/g) || []).length;
    const buildSeoScoreInput = () => ({
      blogHtml: generated.blog_html,
      slug: generated.slug,
      seoTitle: generated.seo_title,
      seoDescription: generated.seo_description,
      primaryKeyword,
      secondaryKeywords: item.meta?.keywords ?? [],
      destination: item.destination,
      blogType,
      hasRenderedPageH1: true,
      hasRuntimeInformationalCta: contentBoundary.lane === 'informational',
      generationMeta: generated.generation_meta,
      imageCount: imgCount,
      imagesWithAlt: imgWithAlt,
      hasJsonLd: {
        blogPosting: true,
        faqPage: extractFaqItems(generated.blog_html).length > 0,
        howTo: extractHowToSteps(generated.blog_html).length >= 3,
        breadcrumbList: true,
      },
    });

    if (!publishedAtomicUpgrade) {
      const slugRepair = repairPublisherSeoSlug({
        currentSlug: generated.slug,
        item,
        primaryKeyword,
      });
      if (slugRepair.changed) {
        generated.slug = slugRepair.slug;
        generated.blog_html = sanitizeBlogCtaLinks(generated.blog_html, {
          destination: item.destination,
          slug: generated.slug,
          utmSource: 'naver_blog',
        });
        console.log(`[blog-publisher] SEO slug repair: ${slugRepair.reason || 'slug_quality'} -> ${generated.slug}`);
      }
    }

    let seoScore = computeSeoScore(buildSeoScoreInput());

    if (!seoScore.passed) {
      const failedDetails = seoScore.details.filter(d => d.status === 'fail').map(d => d.name).join(', ');
      console.log(`[blog-publisher] SEO score ${seoScore.score}/${seoScore.maxScore} - public publish blocked; private draft retained (${failedDetails || seoScore.summary})`);
    }

    const publishQuality = await runGeneratedPublishQuality(generated, item, blogType, primaryKeyword);

    if (!publishQuality.passed) {
      console.log(`[blog-publisher] publish quality failed; preserving generated content as a private review draft (${publishQuality.summary})`);
    }

    qa = publishQuality.qualityGate;
    seoScore = publishQuality.seoScore;
    const readability = publishQuality.readability;
    const now = new Date().toISOString();
    const successfulQueueMeta = {
      ...buildBlogQueueSuccessMeta({
        currentMeta: item.meta,
        qualityGate: qa,
        publishQuality,
        succeededAt: now,
      }),
      last_seo_score: {
        score: seoScore.score,
        max_score: seoScore.maxScore,
        summary: seoScore.summary,
        details: seoScore.details,
      },
    };
    const engineGate = qa.gates.find(gate => gate.gate === 'engine_v2');
    const engineEvaluation = engineGate?.evidence && typeof engineGate.evidence === 'object'
      ? (engineGate.evidence as Record<string, unknown>).evaluation as Record<string, unknown> | undefined
      : undefined;
    const engineMetrics = engineEvaluation?.metrics && typeof engineEvaluation.metrics === 'object'
      ? engineEvaluation.metrics as Record<string, unknown>
      : {};
    const engineCategoryScores = Array.isArray(engineEvaluation?.category_scores)
      ? engineEvaluation.category_scores
      : [];
    const engineBrief = engineEvaluation?.brief && typeof engineEvaluation.brief === 'object'
      ? engineEvaluation.brief as Record<string, unknown>
      : {};
    const destinationDecisionDetails = Array.isArray(item.meta?.destination_decision_details)
      ? item.meta.destination_decision_details
        .filter((detail: unknown) => detail && typeof detail === 'object')
        .map((detail: any) => ({ text: String(detail.text || ''), evidenceId: String(detail.evidence_id || detail.evidenceId || '') }))
      : [];
    const generatedContentBriefV3 = generated.generation_meta?.content_brief_v3;
    const contentBriefV3 = generatedContentBriefV3
      && typeof generatedContentBriefV3 === 'object'
      && !Array.isArray(generatedContentBriefV3)
      && (generatedContentBriefV3 as Record<string, unknown>).version === 'blog-quality-v3.1'
      ? generatedContentBriefV3 as BlogContentBriefV3
      : buildBlogContentBriefV3({
          topic: item.topic,
          destination: item.destination,
          primaryKeyword,
          audience: typeof item.meta?.audience === 'string' ? item.meta.audience : null,
          availableEvidenceTypes: Array.isArray(item.meta?.available_evidence_types) ? item.meta.available_evidence_types : [],
          // Legacy/fallback candidates have no validated research-packet
          // resolution at this boundary, so a queue meta ID cannot authorize
          // first-person experience language.
          firstPartySourceIds: [],
          customerQuestionIds: Array.isArray(item.meta?.customer_question_ids) ? item.meta.customer_question_ids : [],
          destinationDecisionDetails,
        });
    const generationMeta: Record<string, unknown> = {
      queue_item_id: item.id,
      information_evidence_content_key: evidenceContentKey,
      ...(promoteDraftId ? { promoted_from_draft: true } : {}),
      ...queueMetaWithoutResearchBundle(successfulQueueMeta),
      ...(generated.generation_meta || {}),
      last_seo_score: {
        score: seoScore.score,
        max_score: seoScore.maxScore,
        summary: seoScore.summary,
        details: seoScore.details,
      },
      engine_version: 'blog-quality-v3',
      content_brief_v3: contentBriefV3,
      writer: typeof generated.generation_meta?.writer === 'string'
        ? generated.generation_meta.writer
        : (item.product_id ? 'product_consultant_writer' : 'info_writer'),
      brief_score: typeof engineMetrics.task_completion === 'number' ? engineMetrics.task_completion : null,
      evidence_score: typeof engineMetrics.source_support === 'number' ? engineMetrics.source_support : null,
      engine_score: typeof engineEvaluation?.score === 'number' ? engineEvaluation.score : null,
      engine_category_scores: engineCategoryScores,
      failure_bucket: engineEvaluation?.failure_bucket ?? null,
      repair_attempts: Number(generated.generation_meta?.repair_attempts ?? 0),
      evidence_items: Array.isArray(engineBrief.evidence_items) ? engineBrief.evidence_items : [],
    };
    const representativeOwner = `blog_topic_queue:${item.id}`;
    let representativeDecision: BlogInformationDuplicateDecision | null = null;
    let representativeIdentity: BlogInformationRepresentativeIdentity | null = null;
    if (contentBoundary.lane === 'informational') {
      representativeIdentity = readBlogInformationRepresentativeIdentity(generated.generation_meta);
      if (!representativeIdentity) throw new Error('blog_information_representative_identity_missing');
      generationMeta.information_representative = {
        representative_key: buildBlogInformationRepresentativeKey(representativeIdentity),
        status: 'pending_publication',
        canonical_slug: null,
      };
    }
    const finalClaimValidation = await evaluateCurrentInformationClaimValidation();
    const claimValidation = finalClaimValidation.validation;
    const claimValidationSummary = finalClaimValidation.summary;
    const generatedPlanBrief = finalClaimValidation.generatedPlanBrief;
    const generatedPlanBriefRecord = finalClaimValidation.generatedPlanBriefRecord;
    const writerClaimLedger = finalClaimValidation.writerClaimLedger;
    const writerClaimLedgerIssues = finalClaimValidation.writerClaimLedgerIssues;
    generationMeta.information_claim_validation = claimValidationSummary;
    const plannedHumanReview = generatedPlanBrief
      && typeof generatedPlanBrief === 'object'
      && !Array.isArray(generatedPlanBrief)
      && (generatedPlanBrief as Record<string, unknown>).requires_human_review === true;
    const claimValidationPendingHumanApprovalOnly =
      isBlogInformationClaimValidationPendingHumanApprovalOnly(claimValidation);
    const requiresClaimReview = blogType === 'info'
      && !claimValidation.passed
      && !claimValidationPendingHumanApprovalOnly;
    const contentReviewStatus = typeof item.meta?.content_review_status === 'string'
      ? item.meta.content_review_status
      : null;
    const todayPublished = await getTodayBlogPublishCount();
    const isWeatherContent = /weather|날씨|옷차림/i.test(
      `${item.category || ''} ${item.topic || ''} ${generated.seo_title || ''}`,
    );
    const portfolio = await loadBlogPortfolioSaturationV3(
      contentBriefV3.archetype,
      isWeatherContent,
    );
    const latestMetricMs = demandPreflight.performance.latestMetricDate
      ? Date.parse(`${demandPreflight.performance.latestMetricDate}T00:00:00Z`)
      : Number.NaN;
    const sourceFreshness = Number.isFinite(latestMetricMs)
      ? Math.max(0, 1 - (Date.now() - latestMetricMs) / (90 * 24 * 60 * 60 * 1000))
      : (demandPreflight.acceptedProviders.length > 0 ? 1 : 0);
    const corpusDiversity = await loadBlogCorpusDiversityV3({
      queueItemId: item.id,
      excludeCreativeId: promoteDraftId,
      replacementTargetCreativeId: privateRegenerationRequest?.contentCreativeId ?? null,
      title: generated.seo_title,
      body: generated.blog_html,
      destination: item.destination,
    });
    const issueCodes = claimValidation.issues.map((issue) => issue.code);
    const unsupportedNumberCount = countUnsupportedNumericBlogInformationClaims(claimValidation);
    const staleClaimCount = issueCodes.filter((code) => code === 'stale_evidence').length;
    const engineScore01 = typeof engineEvaluation?.score === 'number'
      ? Math.max(0, Math.min(1, engineEvaluation.score / 100))
      : 0;
    const taskCompletion01 = typeof engineMetrics.task_completion === 'number'
      ? Math.max(0, Math.min(1, Number(engineMetrics.task_completion) / 100))
      : 0;
    const persistedResearchBundle = item.meta?.[BLOG_INFORMATION_RESEARCH_META_KEY]
      && typeof item.meta[BLOG_INFORMATION_RESEARCH_META_KEY] === 'object'
      && !Array.isArray(item.meta[BLOG_INFORMATION_RESEARCH_META_KEY])
      ? item.meta[BLOG_INFORMATION_RESEARCH_META_KEY] as BlogInformationResearchBundle
      : null;
    const researchSources: BlogInformationResearchBundle['sources'] = Array.isArray(
      persistedResearchBundle?.sources,
    ) ? persistedResearchBundle.sources : [];
    const sourceQuality01 = researchSources.length > 0
      ? researchSources.reduce((sum, source) => {
          if (isPrimaryInformationAuthority(source.authorityLevel)) return sum + 1;
          if (source.authorityLevel === 'official_secondary') return sum + 0.85;
          if (source.authorityLevel === 'field_observation') return sum + 0.75;
          if (source.authorityLevel === 'editorial_secondary') return sum + 0.7;
          return sum + 0.6;
        }, 0) / researchSources.length
      : (blogType === 'info' ? 0 : 1);
    const imageQualityGatePassed = publishQuality.qualityGate.gates
      .find((gate) => gate.gate === 'image_quality')?.passed ?? true;
    const linksGate = publishQuality.qualityGate.gates.find((gate) => gate.gate === 'links');
    const linksGateEvidence = linksGate?.evidence ?? {};
    const ctaDestinationGatePassed = publishQuality.qualityGate.gates
      .find((gate) => gate.gate === 'cta_destination_integrity')?.passed ?? true;
    const internalLinkRelevant = Number(linksGateEvidence.internal ?? 0) > 0
      && ctaDestinationGatePassed;
    const diversityReport = corpusDiversity.report;
    const storedDecisionArtifact = generationMeta.decision_artifact_v1
      && typeof generationMeta.decision_artifact_v1 === 'object'
      && !Array.isArray(generationMeta.decision_artifact_v1)
      ? generationMeta.decision_artifact_v1 as BlogDecisionArtifactV1
      : null;
    const storedLegacyBrief = generationMeta.content_brief
      && typeof generationMeta.content_brief === 'object'
      && !Array.isArray(generationMeta.content_brief)
      ? generationMeta.content_brief as Record<string, unknown>
      : null;
    const editorialIntentType = String(
      storedLegacyBrief?.intent_type || generatedPlanBriefRecord?.intent || '',
    );
    let editorialHarnessV5: BlogEditorialHarnessReportV1 | null = null;
    let editorialJudgeReceipt: BlogAiTextResult['receipt'] | null = null;
    if (blogType === 'info' && storedDecisionArtifact) {
      const editorialResult = await evaluatePublisherEditorialHarnessV5({
        queueId: item.id,
        attemptNumber: Math.max(1, Number(
          (generationMeta.ai_orchestration_v4 as Record<string, unknown> | undefined)?.attempt || 1,
        )),
        title: generated.seo_title,
        primaryQuery: contentBriefV3.primaryQuery,
        primaryDecision: contentBriefV3.primaryDecision,
        intentType: editorialIntentType,
        markdown: generated.blog_html,
        artifact: storedDecisionArtifact,
      });
      editorialHarnessV5 = editorialResult.report;
      editorialJudgeReceipt = editorialResult.receipt;
      const { error: editorialEvaluationError } = await supabaseAdmin
        .from('blog_quality_evaluations')
        .insert({
          queue_id: item.id,
          evaluator_version: editorialHarnessV5.version,
          passed: editorialHarnessV5.passed,
          score: editorialHarnessV5.passed ? 100 : 0,
          dimensions: {
            deterministic: editorialHarnessV5.deterministic,
            semantic: editorialHarnessV5.semantic,
            decision_artifact_version: storedDecisionArtifact.version,
            judge_receipt: editorialJudgeReceipt ? {
              provider: editorialJudgeReceipt.provider,
              model: editorialJudgeReceipt.model,
              latency_ms: editorialJudgeReceipt.latencyMs,
              finish_reason: editorialJudgeReceipt.finishReason,
              estimated_cost_usd: editorialJudgeReceipt.estimatedCostUsd,
            } : null,
          },
          failure_reasons: editorialHarnessV5.failureReasons,
          hard_blockers: editorialHarnessV5.failureReasons,
        });
      if (editorialEvaluationError) {
        editorialHarnessV5 = {
          ...editorialHarnessV5,
          passed: false,
          failureReasons: [...new Set([
            ...editorialHarnessV5.failureReasons,
            'evaluation_persistence_failed',
          ])],
        };
      }
    }
    generationMeta.editorial_harness_v5 = editorialHarnessV5;
    const demandScoreV3 = scoreBlogDemandCandidateV3({
      demand: demandPreflight.signal,
      impressions: demandPreflight.performance.impressions,
      clicks: demandPreflight.performance.clicks,
      ctr: demandPreflight.performance.ctr,
      averagePosition: demandPreflight.performance.averagePosition,
      customerQuestionFrequency: demandPreflight.signal.customerQuestionCount,
      activeProductRelevance: demandPreflight.signal.activeProductRelation ? 1 : 0,
      seasonality: Number(item.meta?.seasonality_score || 0),
      sourceFreshness,
      cannibalizationPenalty: ['refresh', 'merge'].includes(diversityReport?.disposition || '') ? 1 : 0,
      templateSaturationPenalty: (diversityReport?.normalizedTitleClusterSize ?? 0) >= 3 ? 1 : 0,
      staleInformationRisk: contentBriefV3.riskLevel === 'HIGH' ? 1 : contentBriefV3.riskLevel === 'MEDIUM' ? 0.5 : 0,
    });
    const qualityEvaluationV3 = evaluateBlogQualityV3({
      title: generated.seo_title,
      body: generated.blog_html,
      destination: item.destination,
      primaryDecision: contentBriefV3.primaryDecision,
      primaryQuery: contentBriefV3.primaryQuery,
      archetype: contentBriefV3.archetype,
      intentCompletionScore: taskCompletion01,
      supportedClaimCount: Math.floor(claimValidation.claims.length * claimValidation.coverage),
      factualClaimCount: claimValidation.claims.length,
      staleClaimCount,
      conflictingClaimCount: 0,
      unsupportedNumberCount,
      destinationSpecificDetailCount: contentBriefV3.destinationDecisionDetails.length,
      informationGainScore: engineScore01,
      titleUniqueness: diversityReport && diversityReport.normalizedTitleClusterSize < 3 ? 1 : 0,
      openingUniqueness: diversityReport ? 1 - diversityReport.maxOpeningSimilarity : 0,
      structureUniqueness: diversityReport ? 1 - diversityReport.maxHeadingSimilarity : 0,
      imageRelevance: imageQualityGatePassed ? 1 : 0,
      imageUniqueness: imageQualityGatePassed ? 1 : 0,
      sourceQuality: sourceQuality01,
      authorReviewTruthful: true,
      internalLinkRelevance: internalLinkRelevant ? 1 : 0,
      userActionability: taskCompletion01,
      serpIntentAlignment: taskCompletion01,
      decisionCompletion: taskCompletion01,
      queryClusterCoverage: generated.seo_title.includes(contentBriefV3.primaryQuery) ? 1 : taskCompletion01,
      comparativeInformationGain: engineScore01,
      competitorCopyRisk: Number(
        (generated.generation_meta?.competitor_copy_risk_v3 as Record<string, unknown> | undefined)?.match_count || 0,
      ) > 0 ? 1 : 0,
      titleSnippetCongruence: generated.seo_title === contentBriefV3.metadata.title ? 1 : 0,
      sectionPurposeCoverage: taskCompletion01,
      imageEntityMatch: imageQualityGatePassed ? 1 : 0,
      pillarSupportRelationship: representativeIdentity ? 1 : 0,
      itineraryEvidenceTexts: contentBriefV3.destinationDecisionDetails.map((detail) => detail.text),
      normalizedTitleClusterSize: diversityReport?.normalizedTitleClusterSize ?? 3,
      templateSaturation: !diversityReport || ['queue_reject', 'refresh', 'merge'].includes(diversityReport.disposition),
      firstPartySourceIds: contentBriefV3.verifiedFirstPartySourceIds ?? [],
    });
    const publishQualityFailureReasons = [
      ...publishQuality.publishContractIssues.map((issue) => `publish_contract:${issue.code}`),
      ...publishQuality.qualityGate.gates
        .filter((gate) => !gate.passed)
        .map((gate) => `publish_gate:${gate.gate}`),
      ...publishQuality.seoScore.details
        .filter((detail) => detail.status === 'fail'
          && isBlogSeoDetailBlockingForPublish(
            detail.name,
            Boolean(generated.generation_meta?.content_brief_v3),
          ))
        .map((detail) => `seo:${detail.name}`),
      ...publishQuality.publicCustomerQuality.issues
        .map((issue) => `public_customer:${issue.code}`),
      ...(publishQuality.renderedSeoQuality?.issues ?? [])
        .map((issue) => `rendered_seo:${issue.code}`),
    ].filter((value, index, values) => value && values.indexOf(value) === index);
    const orchestrationQualityScore = Math.min(
      qualityEvaluationV3.score,
      publishQuality.publicCustomerQuality.score,
      blogType === 'info' && editorialHarnessV5?.passed !== true ? 0 : 100,
    );
    const orchestrationFailureReasons = [
      ...qualityEvaluationV3.failureReasons.map((failure) => failure.code),
      ...publishQualityFailureReasons,
      ...(blogType === 'info'
        ? editorialHarnessV5
          ? editorialHarnessV5.failureReasons.map((reason) => `editorial_harness_v5:${reason}`)
          : ['editorial_harness_v5:decision_artifact_or_harness_missing']
        : []),
    ].filter((value, index, values) => value && values.indexOf(value) === index);
    const previousOrchestration = item.meta?.ai_orchestration_v4 as Record<string, unknown> | undefined;
    const aiOrchestrationMeta = generationMeta.ai_orchestration_v4 as Record<string, unknown> | undefined;
    const orchestrationAttempt = Math.max(1, Math.min(BLOG_QUALITY_MAX_ATTEMPTS_V4, Number(
      aiOrchestrationMeta?.attempt || Number(item.attempts || 0) + 1,
    )));
    const generationReceipt = aiOrchestrationMeta?.receipt as BlogAiTextResult['receipt'] | undefined;
    const qualityRouteV4: ReturnType<typeof decideBlogQualityRouteV4> = generationReceipt
      ? decideBlogQualityRouteV4({
          score: orchestrationQualityScore,
          hardBlockers: qualityEvaluationV3.hardBlockers,
          failureReasons: orchestrationFailureReasons,
          completedAttempts: orchestrationAttempt,
          previousScore: typeof previousOrchestration?.previous_score === 'number'
            ? previousOrchestration.previous_score
            : null,
          researchAttempts: Number(previousOrchestration?.research_attempts || 0),
          riskLevel: contentBriefV3.riskLevel,
          humanApproved: contentReviewStatus === 'approved',
          researchValid: (generated.generation_meta?.information_research_preflight as Record<string, unknown> | undefined)?.passed === true,
          claimLedgerValid: claimValidation.passed && writerClaimLedgerIssues.length === 0,
          lastStage: typeof aiOrchestrationMeta?.stage === 'string'
            ? aiOrchestrationMeta.stage as BlogDeepSeekStage
            : null,
        })
      : {
          route: qualityEvaluationV3.passed
            && publishQuality.passed
            && (blogType !== 'info' || editorialHarnessV5?.passed === true)
            ? 'approved_for_slot'
            : 'human_review',
          nextStage: null,
          publishable: qualityEvaluationV3.passed
            && publishQuality.passed
            && (blogType !== 'info' || editorialHarnessV5?.passed === true),
          reasons: qualityEvaluationV3.passed
            && publishQuality.passed
            && (blogType !== 'info' || editorialHarnessV5?.passed === true)
            ? ['non_model_candidate_quality_passed']
            : ['non_model_candidate_review_required', ...orchestrationFailureReasons],
          maxAttempts: BLOG_QUALITY_MAX_ATTEMPTS_V4,
        };
    generationMeta.ai_orchestration_v4 = {
      ...(aiOrchestrationMeta || {}),
      version: 'blog-deepseek-orchestrator-v4',
      attempt: orchestrationAttempt,
      score: orchestrationQualityScore,
      component_scores: {
        quality_v3: qualityEvaluationV3.score,
        publish_quality: publishQuality.blogQualityScore.score,
        public_customer: publishQuality.publicCustomerQuality.score,
      },
      publish_quality_passed: publishQuality.passed,
      route: qualityRouteV4.route,
      next_stage: qualityRouteV4.nextStage,
      failure_evidence: qualityRouteV4.reasons,
      evaluated_at: now,
    };
    if (generationReceipt && typeof generationReceipt.model === 'string') {
      const attemptPersistence = await recordBlogGenerationAttemptV4({
        queueId: item.id,
        tenantId: item.tenant_id ?? null,
        attemptNumber: orchestrationAttempt,
        stage: String(aiOrchestrationMeta?.stage || 'draft_flash') as BlogDeepSeekStage,
        route: qualityRouteV4.route,
        output: {
          title: generated.seo_title,
          description: generated.seo_description,
          slug: generated.slug,
          markdown: generated.blog_html,
          audit: {
            claim_validation: claimValidationSummary,
            writer_claim_ledger: writerClaimLedger,
            writer_claim_ledger_issues: writerClaimLedgerIssues,
            quality_evaluation_v3: qualityEvaluationV3,
            publish_quality: {
              passed: publishQuality.passed,
              score: publishQuality.blogQualityScore.score,
              public_customer_score: publishQuality.publicCustomerQuality.score,
              summary: publishQuality.summary,
              failed_gates: publishQuality.qualityGate.gates
                .filter((gate) => !gate.passed)
                .map((gate) => gate.gate),
            },
            links_gate: linksGate ?? null,
            rewrite_claim_packet_v4: generationMeta.rewrite_claim_packet_v4 ?? null,
            editorial_harness_v5: editorialHarnessV5,
            decision_artifact_v1: storedDecisionArtifact,
          },
        },
        qualityScore: orchestrationQualityScore,
        hardBlockers: qualityEvaluationV3.hardBlockers,
        failureReasons: orchestrationFailureReasons,
        researchFingerprint: typeof item.meta?.information_research_fingerprint === 'string'
          ? item.meta.information_research_fingerprint
          : null,
        claimFingerprint: typeof item.meta?.claim_fingerprint === 'string'
          ? item.meta.claim_fingerprint
          : null,
        promptTrace: generationMeta.prompt_trace_v1 as BlogPromptTraceV1 | undefined,
        receipt: generationReceipt,
      });
      if (attemptPersistence.error) {
        logWarning('[cron/blog-publisher] V4 generation attempt persistence failed', {
          queueId: item.id,
          error: attemptPersistence.error,
        });
        const reason = `generation_attempt_persistence_failed:${attemptPersistence.error}`;
        await handleFailure(item, reason, qa, true, {
          ai_orchestration_v4: {
            ...generationMeta.ai_orchestration_v4 as Record<string, unknown>,
            route: 'quarantine',
            persistence_error: attemptPersistence.error,
          },
        });
        return { id: item.id, topic: item.topic, status: 'quarantined', reason };
      }
    }
    generationMeta.corpus_diversity_v3 = corpusDiversity.error
      ? { passed: false, error: corpusDiversity.error }
      : diversityReport;
    generationMeta.quality_evaluation_v3 = qualityEvaluationV3;
    if (['rewrite_pro_high', 'rewrite_pro_max', 'reresearch', 'quarantine'].includes(qualityRouteV4.route)) {
      const researchAttempts = Number(previousOrchestration?.research_attempts || 0)
        + (qualityRouteV4.route === 'reresearch' ? 1 : 0);
      const reason = `blog_quality_v4_${qualityRouteV4.route}:${qualityRouteV4.reasons.join(',')}`;
      const failureStatus = await handleFailure(item, reason, qa, qualityRouteV4.route === 'quarantine', {
        ai_orchestration_v4: {
          version: 'blog-deepseek-orchestrator-v4',
          previous_score: orchestrationQualityScore,
          next_stage: qualityRouteV4.nextStage,
          route: qualityRouteV4.route,
          research_attempts: researchAttempts,
          failure_evidence: qualityRouteV4.reasons,
          last_attempted_at: now,
        },
        ...(qualityRouteV4.route === 'reresearch'
          ? {
              [BLOG_INFORMATION_RESEARCH_META_KEY]: null,
              auto_research: null,
              information_research_fingerprint: null,
              claim_fingerprint: null,
            }
          : {}),
      }, {
        forceQueue: qualityRouteV4.route !== 'quarantine',
      });
      return {
        id: item.id,
        topic: item.topic,
        status: qualityRouteV4.route === 'quarantine'
          ? 'quarantined'
          : failureStatus === 'queued' ? 'rewrite_queued' : failureStatus,
        reason,
      };
    }
    const autopublishDecision = evaluateBlogAutopublishDecisionV3(BLOG_AUTOPUBLISH_POLICY_V3, {
      reviewStatus: contentReviewStatus,
      allGatesPassed: publishQuality.passed
        && qa.passed
        && claimValidation.passed
        && contentBriefV3.passed
        && corpusDiversity.error === null
        && qualityEvaluationV3.passed
        && qualityRouteV4.publishable
        && (blogType !== 'info' || editorialHarnessV5?.passed === true)
        && demandScoreV3.eligible,
      deterministicFallback: generated.generation_meta?.private_diagnostic_fallback === true
        || generated.generation_meta?.deterministic_info_fallback === true,
      riskLevel: contentBriefV3.riskLevel,
      demand: demandPreflight.signal,
      publishedToday: todayPublished.count,
      weatherShare30d: portfolio.weatherShare30d,
      isWeatherContent,
      sameArchetypeInLast10: portfolio.sameArchetypeInLast10,
    });
    generationMeta.autopublish_policy_v3 = {
      ...autopublishDecision,
      mode: BLOG_AUTOPUBLISH_POLICY_V3.mode,
      evaluated_at: now,
      performance: demandPreflight.performance,
      score: demandScoreV3,
    };
    generationMeta.demand_evidence_v3 = {
      repository_ready: demandPreflight.repositoryReady,
      accepted_providers: demandPreflight.acceptedProviders,
      rejected_count: demandPreflight.rejectedCount,
      evaluated_at: now,
    };
    const contentRequiresHumanReview = blogType === 'info'
      && ((!publishedAtomicUpgrade && privateRegenerationRequest !== null) || requiresClaimReview || plannedHumanReview || isHighRiskInformationalTopic({
        title: generated.seo_title ?? item.topic ?? null,
        category: item.category ?? null,
        contentType: item.source === 'pillar' ? 'pillar' : 'guide',
        topic: item.topic ?? null,
      }));
    const approvedForDeferredPublication = Boolean(
      options.deferPublication
      && (generationReceipt || revalidatedAttemptId)
      && qualityRouteV4.publishable
      && autopublishDecision.publish
      && !contentRequiresHumanReview,
    );
    const requiresHumanReview = contentRequiresHumanReview
      || !autopublishDecision.publish
      || Boolean(options.deferPublication && !approvedForDeferredPublication);
    const publishAllowed = autopublishDecision.publish
      && !contentRequiresHumanReview
      && !options.deferPublication;
    const reviewedPublishedReplacement = publishedAtomicUpgrade
      && requiresHumanReview
      && !requiresClaimReview
      && privateRegenerationRequest !== null
      && Boolean(originalPublishedSlug);
    const automatedPublishedReplacement = publishedAtomicUpgrade
      && approvedForDeferredPublication
      && !contentRequiresHumanReview
      && privateRegenerationRequest !== null
      && Boolean(originalPublishedSlug);
    if (publishedAtomicUpgrade && requiresClaimReview) {
      const reason = 'published_atomic_upgrade_claim_gate_failed';
      await handleFailure(item, reason, qa, true, {
        published_atomic_upgrade_blocked: true,
        preserved_published_creative_id: privateRegenerationRequest?.contentCreativeId ?? null,
        information_claim_validation: claimValidationSummary,
      });
      return { id: item.id, topic: item.topic, status: 'upgrade_blocked', reason };
    }
    if (privateRegenerationRequest) {
      generationMeta.private_regeneration = {
        mode: privateRegenerationRequest.mode,
        replaced_creative_id: privateRegenerationRequest.contentCreativeId,
        forced_private_review: !publishedAtomicUpgrade,
        atomic_publish_replace: publishedAtomicUpgrade,
        regenerated_at: now,
      };
    }
    let reviewedReplacementDraftSlug: string | null = null;
    let automatedReplacementDraftSlug: string | null = null;
    if (reviewedPublishedReplacement && privateRegenerationRequest && originalPublishedSlug) {
      reviewedReplacementDraftSlug = buildReviewedPublishedBlogReplacementDraftSlug({
        canonicalSlug: originalPublishedSlug,
        queueId: item.id,
      });
      if (!reviewedReplacementDraftSlug) {
        const reason = 'published_atomic_upgrade_review_draft_slug_failed';
        await handleFailure(item, reason, qa, true, {
          published_atomic_upgrade_blocked: true,
          preserved_published_creative_id: privateRegenerationRequest.contentCreativeId,
        });
        return { id: item.id, topic: item.topic, status: 'upgrade_blocked', reason };
      }
      generationMeta.reviewed_published_replacement = {
        mode: REVIEWED_PUBLISHED_BLOG_REPLACEMENT_MODE,
        status: 'pending_review',
        target_creative_id: privateRegenerationRequest.contentCreativeId,
        canonical_slug: originalPublishedSlug,
        original_published_at: originalPublishedAt,
        queue_id: item.id,
        generated_at: now,
      };
      generationMeta.information_evidence_content_key = reviewedReplacementDraftSlug;
      if (representativeIdentity) {
        generationMeta.information_representative = {
          representative_key: buildBlogInformationRepresentativeKey(representativeIdentity),
          status: 'pending_replacement',
          canonical_slug: originalPublishedSlug,
          target_creative_id: privateRegenerationRequest.contentCreativeId,
        };
      }
    }
    if (automatedPublishedReplacement && privateRegenerationRequest && originalPublishedSlug) {
      automatedReplacementDraftSlug = buildAutomatedPublishedBlogReplacementDraftSlug({
        canonicalSlug: originalPublishedSlug,
        queueId: item.id,
      });
      if (!automatedReplacementDraftSlug) {
        const reason = 'published_atomic_upgrade_auto_draft_slug_failed';
        await handleFailure(item, reason, qa, true, {
          published_atomic_upgrade_blocked: true,
          preserved_published_creative_id: privateRegenerationRequest.contentCreativeId,
        });
        return { id: item.id, topic: item.topic, status: 'upgrade_blocked', reason };
      }
      generationMeta.automated_published_replacement = {
        mode: AUTOMATED_PUBLISHED_BLOG_REPLACEMENT_MODE,
        status: 'approved_for_slot',
        target_creative_id: privateRegenerationRequest.contentCreativeId,
        canonical_slug: originalPublishedSlug,
        draft_slug: automatedReplacementDraftSlug,
        original_published_at: originalPublishedAt,
        queue_id: item.id,
        generated_at: now,
      };
      generationMeta.information_evidence_content_key = automatedReplacementDraftSlug;
      if (representativeIdentity) {
        generationMeta.information_representative = {
          representative_key: buildBlogInformationRepresentativeKey(representativeIdentity),
          status: 'pending_automated_replacement',
          canonical_slug: originalPublishedSlug,
          target_creative_id: privateRegenerationRequest.contentCreativeId,
        };
      }
    }
    if (publishedAtomicUpgrade && representativeIdentity && privateRegenerationRequest) {
      representativeDecision = await reserveBlogInformationRepresentative({
        reservationOwner: representativeOwner,
        candidate: {
          ...representativeIdentity,
          slug: generated.slug,
          title: generated.seo_title,
          markdown: generated.blog_html,
        },
      });
      generationMeta.information_representative = {
        representative_key: representativeDecision.representativeKey,
        status: representativeDecision.action === 'UPDATE_EXISTING'
          ? 'active'
          : 'reserved',
        canonical_slug: representativeDecision.canonicalSlug,
        decision: representativeDecision.action,
      };
      if (!canUpgradePublishedBlogForRepresentative({
        decision: representativeDecision,
        targetCreativeId: privateRegenerationRequest.contentCreativeId,
      })) {
        const reason = `information_representative_duplicate_upgrade_review:${representativeDecision.canonicalSlug || representativeDecision.reason}`;
        const failureStatus = await handleFailure(item, reason, qa, false, {
          published_atomic_upgrade_blocked: true,
          preserved_published_creative_id: privateRegenerationRequest.contentCreativeId,
          information_representative: representativeDecision,
          proposed_action: 'MERGE_REVIEW',
        });
        return {
          id: item.id,
          topic: item.topic,
          status: failureStatus === 'skipped' ? 'skipped_duplicate' : 'upgrade_blocked',
          reason,
        };
      }
    }
    if (
      representativeIdentity
      && (requiresHumanReview || approvedForDeferredPublication)
      && !reviewedPublishedReplacement
      && !publishedAtomicUpgrade
    ) {
      representativeDecision = await reserveBlogInformationRepresentative({
        reservationOwner: representativeOwner,
        candidate: {
          ...representativeIdentity,
          slug: generated.slug,
          title: generated.seo_title,
          markdown: generated.blog_html,
        },
      });
      generationMeta.information_representative = {
        representative_key: representativeDecision.representativeKey,
        status: 'reserved',
        canonical_slug: representativeDecision.canonicalSlug,
        decision: representativeDecision.action,
      };
      if (!['RESERVE_CREATE', 'RESUME_RESERVATION'].includes(representativeDecision.action)) {
        await supabaseAdmin.from('blog_topic_queue').update({
          status: 'skipped',
          last_error: `information_representative:${representativeDecision.reason}`,
          meta: {
            ...(item.meta || {}),
            information_representative: representativeDecision,
            proposed_action: 'update_existing',
          },
        }).eq('id', item.id);
        return {
          id: item.id,
          topic: item.topic,
          status: 'skipped_duplicate',
          reason: representativeDecision.canonicalSlug ?? representativeDecision.reason,
        };
      }
    }
    const generationDedupClaim = await claimBlogGenerationDedup({
      candidate: {
        title: generated.seo_title,
        slug: reviewedReplacementDraftSlug ?? automatedReplacementDraftSlug ?? generated.slug,
        destination: item.destination ?? null,
        productId: item.product_id ?? null,
        contentKind: blogType === 'info' ? 'information' : 'product',
        allowExistingCreativeId: privateRegenerationRequest?.contentCreativeId ?? promoteDraftId,
      },
      claimOwner: representativeOwner,
      claimReview: false,
    });
    if (!generationDedupClaim.claimed) {
      const dedupMeta = buildBlogGenerationDedupMetadata({
        report: generationDedupClaim.report,
        claimOwner: generationDedupClaim.claimOwner,
      });
      const reason = `blog_generation_dedup:${generationDedupClaim.report.reason}`;
      if (generationDedupClaim.report.action === 'review') {
        await supabaseAdmin.from('blog_topic_queue').update({
          status: 'pending_review',
          last_error: reason,
          meta: {
            ...(item.meta || {}),
            blog_generation_dedup: dedupMeta,
            duplicate_review_required: true,
          },
        }).eq('id', item.id);
        return {
          id: item.id,
          topic: item.topic,
          status: 'duplicate_review',
          reason,
        };
      }
      const failureStatus = await handleFailure(item, reason, qa, false, {
        blog_generation_dedup: dedupMeta,
        skipped_duplicate: true,
      });
      return {
        id: item.id,
        topic: item.topic,
        status: failureStatus === 'skipped' ? 'skipped_duplicate' : failureStatus,
        reason,
      };
    }
    generationMeta.blog_generation_dedup = buildBlogGenerationDedupMetadata({
      report: generationDedupClaim.report,
      claimOwner: generationDedupClaim.claimOwner,
    });
    const publicationTimestamp = publishedAtomicUpgrade && originalPublishedAt
      ? originalPublishedAt
      : now;
    const rowPayload: Record<string, unknown> = {
      tenant_id: item.tenant_id ?? null,
      blog_html: generated.blog_html,
      slug: reviewedReplacementDraftSlug ?? automatedReplacementDraftSlug ?? generated.slug,
      title: generated.seo_title,
      description: generated.seo_description,
      seo_title: generated.seo_title,
      seo_description: generated.seo_description,
      og_image_url: generated.og_image_url,
      product_id: item.product_id ?? null,
      category: VALID_CATEGORIES.includes(item.category as (typeof VALID_CATEGORIES)[number]) ? item.category : (item.product_id ? 'product_intro' : 'travel_tips'),
      channel: 'naver_blog' as const,
      angle_type: normalizeAngleType(item.angle_type),
      status: publishAllowed ? 'published' : 'draft',
      published_at: publishAllowed ? publicationTimestamp : null,
      review_status: (publishAllowed || approvedForDeferredPublication) ? contentReviewStatus : 'pending_review',
      quality_gate: publishQuality.readingTimeMinutes == null
        ? qa
        : withPersistedBlogReadingTime(qa, publishQuality.readingTimeMinutes),
      seo_score: seoScore,
      topic_source: item.source,
      destination: item.destination ?? null,
      content_type: item.source === 'pillar' ? 'pillar' : (item.product_id ? 'package_intro' : 'guide'),
      pillar_for: item.source === 'pillar' ? item.destination : null,
      landing_enabled: !!(item.product_id || item.primary_keyword || item.destination || item.meta?.keywords?.length),
      target_ad_keywords: item.meta?.keywords ?? (item.primary_keyword ? [item.primary_keyword] : []),
      readability_score: readability.score,
      readability_issues: readability.issues,
      generation_meta: generationMeta,
    };

    // 카드뉴스 이미지 URL 배열 저장 (본문 마크다운에 삽입된 이미지도 원본 참조용으로 보관)
    if (generated.slide_image_urls?.length) {
      rowPayload.slide_image_urls = generated.slide_image_urls;
    }

    let creativeId: string;

    if (publishedAtomicUpgrade) {
      // A published target is never rewritten or demoted during generation.
      // Both reviewed and automated replacements are isolated shadow drafts;
      // the publication controller performs the only atomic public commit.
      promoteDraftId = null;
    }
    if (promoteDraftId) {
      const { error: upErr } = await supabaseAdmin
        .from('content_creatives')
        .update(rowPayload)
        .eq('id', promoteDraftId);

      if (upErr) {
        await releaseBlogGenerationDedup({
          dedupKey: generationDedupClaim.report.dedupKey,
          claimOwner: generationDedupClaim.claimOwner,
        }).catch((releaseError) => logWarning('[cron/blog-publisher] dedup claim release failed', releaseError));
        await handleFailure(item, `DB update(초안승격) 실패: ${upErr.message}`, qa);
        return { id: item.id, topic: item.topic, status: 'update_failed', reason: upErr.message };
      }
      creativeId = promoteDraftId;
    } else {
      const { data: inserted, error: insErr } = await supabaseAdmin
        .from('content_creatives')
        .insert(rowPayload)
        .select('id')
        .limit(1);

      if (insErr) {
        await releaseBlogGenerationDedup({
          dedupKey: generationDedupClaim.report.dedupKey,
          claimOwner: generationDedupClaim.claimOwner,
        }).catch((releaseError) => logWarning('[cron/blog-publisher] dedup claim release failed', releaseError));
        await handleFailure(item, `DB insert 실패: ${insErr.message}`, qa);
        return { id: item.id, topic: item.topic, status: 'insert_failed', reason: insErr.message };
      }

      creativeId = inserted?.[0]?.id as string;
    }
    await bindBlogGenerationDedup({
      dedupKey: generationDedupClaim.report.dedupKey,
      claimOwner: generationDedupClaim.claimOwner,
      creativeId,
      action: generationDedupClaim.report.action,
    });

    const decisionReasons = [
      ...autopublishDecision.reasons,
      ...contentBriefV3.issues,
      ...(corpusDiversity.error ? [corpusDiversity.error] : []),
      ...(diversityReport?.reasons || []),
      ...qualityEvaluationV3.hardBlockers,
      ...qualityEvaluationV3.failureReasons.map((failure) => failure.code),
      ...publishQualityFailureReasons,
      ...(editorialHarnessV5?.failureReasons ?? []).map((reason) => `editorial_harness_v5:${reason}`),
    ].filter((value, index, values) => value && values.indexOf(value) === index);
    const [qualityAuditResult, publicationAuditResult] = await Promise.all([
      supabaseAdmin.from('blog_quality_evaluations').insert({
        creative_id: creativeId,
        queue_id: item.id,
        evaluator_version: qualityEvaluationV3.version,
        passed: qualityEvaluationV3.passed,
        score: qualityEvaluationV3.score,
        dimensions: qualityEvaluationV3.dimensions,
        failure_reasons: qualityEvaluationV3.failureReasons,
        hard_blockers: qualityEvaluationV3.hardBlockers,
      }),
      supabaseAdmin.from('blog_publication_decisions').insert({
        creative_id: creativeId,
        queue_id: item.id,
        policy_version: 'blog-quality-v3',
        autopublish_mode: BLOG_AUTOPUBLISH_POLICY_V3.mode,
        decision: publishAllowed ? 'published' : (requiresHumanReview ? 'pending_review' : 'draft'),
        gate_evidence: {
          autopublish: autopublishDecision,
          quality: qualityEvaluationV3,
          editorial_harness_v5: editorialHarnessV5,
          decision_artifact_v1: storedDecisionArtifact,
          diversity: corpusDiversity.error ? { error: corpusDiversity.error } : diversityReport,
          claims: claimValidationSummary,
          content_brief: contentBriefV3,
        },
        reasons: decisionReasons,
      }),
    ]);
    const auditPersistenceError = qualityAuditResult.error?.message || publicationAuditResult.error?.message || null;
    if (auditPersistenceError) {
      logWarning('[cron/blog-publisher] V3 decision evidence persistence failed', {
        queueId: item.id,
        creativeId,
        error: auditPersistenceError,
      });
      if (publishAllowed) {
        await supabaseAdmin.from('content_creatives').update({
          status: 'draft',
          published_at: null,
          review_status: 'pending_review',
        }).eq('id', creativeId);
        await supabaseAdmin.from('blog_topic_queue').update({
          status: 'pending_review',
          content_creative_id: creativeId,
          last_error: `v3_decision_evidence_persistence_failed:${auditPersistenceError}`,
        }).eq('id', item.id);
        return {
          id: item.id,
          topic: item.topic,
          status: 'pending_review',
          reason: 'v3_decision_evidence_persistence_failed',
        };
      }
    }

    let reviewClaimValidation = claimValidation;
    const replacementDraftSlug = reviewedReplacementDraftSlug ?? automatedReplacementDraftSlug;
    const reviewEvidenceContentKey = replacementDraftSlug ?? evidenceContentKey;
    if ((reviewedPublishedReplacement || automatedPublishedReplacement) && replacementDraftSlug) {
      const replacementBrief = buildQueueContentBrief(item);
      const replacementResearch = evaluateBlogGenerationResearchReadiness({
        meta: item.meta,
        expectedContentKey: evidenceContentKey,
        destination: item.destination,
        intent: replacementBrief.intentType,
        locale: replacementBrief.plan.locale,
        sourcePolicy: replacementBrief.sourcePolicy,
      });
      if (!replacementBrief.passed || !replacementResearch.passed || !replacementResearch.bundle) {
        const reason = 'published_replacement_research_clone_failed';
        await handleFailure(item, reason, qa, true, {
          replacement_draft_id: creativeId,
          preserved_published_creative_id: privateRegenerationRequest?.contentCreativeId ?? null,
        });
        return { id: item.id, topic: item.topic, status: 'review_handoff_failed', reason };
      }
      await persistBlogInformationResearch({
        ...replacementResearch.bundle,
        contentKey: reviewEvidenceContentKey,
        creativeId,
        tenantId: item.tenant_id ?? replacementResearch.bundle.tenantId ?? null,
      });
      await markBlogInformationResearchClaimsSupported({
        contentKey: reviewEvidenceContentKey,
        claimFingerprints: replacementResearch.bundle.claims.map(
          (claim) => claim.claimFingerprint,
        ),
      });
      reviewClaimValidation = await evaluateBlogInformationClaimPublishGate({
        creativeId,
        contentKey: reviewEvidenceContentKey,
        markdown: [generated.seo_title, generated.seo_description, generated.blog_html]
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
          .join('\n\n'),
        productId: null,
        tenantId: item.tenant_id ?? null,
        claimLedger: writerClaimLedger,
        claimLedgerIssues: writerClaimLedgerIssues,
        intentType: typeof generatedPlanBriefRecord?.intent_type === 'string'
          ? generatedPlanBriefRecord.intent_type
          : null,
        expectedScope: {
          destination: item.destination ?? undefined,
          locale: typeof generatedPlanBriefRecord?.locale === 'string'
            ? generatedPlanBriefRecord.locale
            : undefined,
        },
      });
      if (!reviewClaimValidation.passed && (
        automatedPublishedReplacement
        || !isBlogInformationClaimValidationPendingHumanApprovalOnly(reviewClaimValidation)
      )) {
        const reason = 'published_replacement_claim_gate_failed';
        await handleFailure(item, reason, qa, true, {
          replacement_draft_id: creativeId,
          preserved_published_creative_id: privateRegenerationRequest?.contentCreativeId ?? null,
          information_claim_validation: reviewClaimValidation,
        });
        return { id: item.id, topic: item.topic, status: 'review_handoff_failed', reason };
      }
      generationMeta.information_claim_validation =
        toBlogInformationClaimValidationMeta(reviewClaimValidation);
    }

    if (blogType === 'info') {
      await persistBlogInformationClaimFindings({
        creativeId,
        contentKey: reviewEvidenceContentKey,
        tenantId: item.tenant_id ?? null,
        report: reviewClaimValidation,
      });
    }

    if (approvedForDeferredPublication) {
      if (representativeDecision && !automatedPublishedReplacement) {
        await attachBlogInformationRepresentativeDraft({
          representativeKey: representativeDecision.representativeKey,
          reservationOwner: representativeOwner,
          creativeId,
          canonicalSlug: generated.slug,
        });
      }
      if (revalidatedAttemptId) {
        if (!attemptRevalidationRequest) {
          const reason = 'generation_attempt_revalidation_request_missing';
          await handleFailure(item, reason, qa, true, { content_creative_id: creativeId });
          return { id: item.id, topic: item.topic, status: 'quarantined', reason };
        }
        const revalidationError = await revalidateBlogGenerationAttemptV4({
          queueId: item.id,
          attemptId: revalidatedAttemptId,
          attemptNumber: orchestrationAttempt,
          qualityScore: orchestrationQualityScore,
          reason: attemptRevalidationRequest.reason,
          output: {
            title: generated.seo_title,
            description: generated.seo_description,
            slug: generated.slug,
            markdown: generated.blog_html,
            audit: {
              claim_validation: claimValidationSummary,
              writer_claim_ledger: writerClaimLedger,
              writer_claim_ledger_issues: writerClaimLedgerIssues,
              quality_evaluation_v3: qualityEvaluationV3,
              publish_quality: {
                passed: publishQuality.passed,
                score: publishQuality.blogQualityScore.score,
                public_customer_score: publishQuality.publicCustomerQuality.score,
                summary: publishQuality.summary,
                failed_gates: publishQuality.qualityGate.gates
                  .filter((gate) => !gate.passed)
                  .map((gate) => gate.gate),
              },
              links_gate: linksGate ?? null,
              rewrite_claim_packet_v4: generationMeta.rewrite_claim_packet_v4 ?? null,
            },
          },
        });
        if (revalidationError) {
          await handleFailure(item, `generation_attempt_revalidation_failed:${revalidationError}`, qa, true, {
            content_creative_id: creativeId,
            revalidated_attempt_id: revalidatedAttemptId,
          });
          return { id: item.id, topic: item.topic, status: 'quarantined', reason: revalidationError };
        }
      }
      const scheduledPublishAt = nextBlogPublicationSlotKstV4(new Date(now));
      const approvalPersistenceError = await approveBlogGenerationRunForSlotV4({
        queueId: item.id,
        creativeId,
        scheduledPublishAt,
      });
      if (approvalPersistenceError) {
        await handleFailure(item, `generation_run_approval_persistence_failed:${approvalPersistenceError}`, qa, true, {
          content_creative_id: creativeId,
        });
        return { id: item.id, topic: item.topic, status: 'quarantined', reason: approvalPersistenceError };
      }
      await supabaseAdmin.from('blog_topic_queue').update({
        status: 'pending_review',
        content_creative_id: creativeId,
        last_error: null,
        attempts: 0,
        meta: {
          ...successfulQueueMeta,
          ai_orchestration_v4: generationMeta.ai_orchestration_v4,
          publication_deferred_v4: {
            status: 'approved_for_slot',
            scheduled_publish_at: scheduledPublishAt,
          },
        },
      }).eq('id', item.id);
      return {
        id: item.id,
        topic: item.topic,
        status: 'approved_for_slot',
        reason: scheduledPublishAt,
      };
    }

    if (representativeIdentity && !requiresHumanReview) {
      await publishBlogInformationAtomically({
        creativeId,
        contentFingerprint: createBlogInformationContentFingerprint({
          blogHtml: generated.blog_html,
          seoTitle: generated.seo_title,
          seoDescription: generated.seo_description,
          slug: generated.slug,
        }),
        validationMeta: {
          information_claim_validation: generationMeta.information_claim_validation as Record<string, unknown>,
        },
        qualityGate: rowPayload.quality_gate as Record<string, unknown>,
        publishedAt: publicationTimestamp,
        identity: representativeIdentity,
        reservationOwner: representativeOwner,
      });
      const { error: staleReviewQueueError } = await supabaseAdmin
        .from('content_review_queue')
        .update({ status: 'skipped' })
        .eq('creative_id', creativeId)
        .in('status', ['queued', 'assigned']);
      if (staleReviewQueueError) {
        logWarning('[cron/blog-publisher] stale review queue cleanup failed', staleReviewQueueError);
      }
    }
    if (representativeDecision && requiresHumanReview && !reviewedPublishedReplacement) {
      await attachBlogInformationRepresentativeDraft({
        representativeKey: representativeDecision.representativeKey,
        reservationOwner: representativeOwner,
        creativeId,
        canonicalSlug: generated.slug,
      });
    }

    if (item.card_news_id && creativeId && !promoteDraftId) {
      await supabaseAdmin
        .from('card_news')
        .update({ linked_blog_id: creativeId, updated_at: now })
        .eq('id', item.card_news_id);
    }

    if (requiresHumanReview) {
      const humanReviewReason = requiresClaimReview
        ? 'informational_claim_review_required'
        : reviewedPublishedReplacement
          ? 'published_atomic_upgrade_human_review_required'
          : autopublishDecision.reasons.join(',') || 'high_risk_human_review_required';
      const humanReviewRunError = await markBlogGenerationRunForHumanReviewV4({
        queueId: item.id,
        creativeId,
        reason: humanReviewReason,
      });
      if (humanReviewRunError) {
        logWarning('[cron/blog-publisher] human-review run transition failed', {
          queueId: item.id,
          creativeId,
          error: humanReviewRunError,
        });
      }
      try {
        const reviewBrief = buildQueueContentBrief(item);
        const reviewResearch = evaluateBlogGenerationResearchReadiness({
          meta: item.meta,
          expectedContentKey: evidenceContentKey,
          destination: item.destination,
          intent: reviewBrief.intentType,
          locale: reviewBrief.plan.locale,
          sourcePolicy: reviewBrief.sourcePolicy,
        });
        if (!reviewBrief.passed || !reviewResearch.passed || !reviewResearch.bundle) {
          throw new Error(
            `review_case_research_missing:${[
              ...reviewBrief.issues,
              ...reviewResearch.issues,
            ].slice(0, 8).join(',')}`,
          );
        }
        const reviewStore = createBlogInformationEvidenceWorkflowStore({
          creativeId,
          contentKey: reviewEvidenceContentKey,
          tenantId: item.tenant_id ?? null,
          generationMeta,
        });
        await reviewStore.save({
          plan: reviewBrief.plan,
          research: {
            ...reviewResearch.bundle,
            contentKey: reviewEvidenceContentKey,
            creativeId,
            tenantId: item.tenant_id ?? reviewResearch.bundle.tenantId ?? null,
          },
          report: reviewClaimValidation,
          state: 'pending_review',
          contentFingerprint: createBlogInformationContentFingerprint({
            blogHtml: generated.blog_html,
            seoTitle: generated.seo_title,
            seoDescription: generated.seo_description,
            slug: String(rowPayload.slug ?? generated.slug),
          }),
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        generationMeta.review_workflow_warning = `review_queue_deferred:${reason}`;
        logWarning('[cron/blog-publisher] review workflow deferred; draft remains private', {
          queueId: item.id,
          creativeId,
          reason,
        });
      }

      const { error: reviewStateError } = await supabaseAdmin.from('blog_topic_queue')
        .update({
          status: 'pending_review',
          content_creative_id: creativeId,
          last_error: null,
          attempts: 0,
          meta: {
            ...successfulQueueMeta,
            ai_orchestration_v4: generationMeta.ai_orchestration_v4,
            autopublish_policy_v3: generationMeta.autopublish_policy_v3,
            ...(generationMeta.review_workflow_warning
              ? { review_workflow_warning: generationMeta.review_workflow_warning }
              : {}),
            ...(reviewedPublishedReplacement && privateRegenerationRequest && originalPublishedSlug
              ? {
                  reviewed_published_replacement: {
                    mode: REVIEWED_PUBLISHED_BLOG_REPLACEMENT_MODE,
                    status: 'pending_review',
                    replacement_draft_id: creativeId,
                    target_creative_id: privateRegenerationRequest.contentCreativeId,
                    canonical_slug: originalPublishedSlug,
                  },
                }
              : {}),
          },
        })
        .eq('id', item.id);
      if (reviewStateError) {
        logWarning('[cron/blog-publisher] review state handoff failed', reviewStateError);
      }
      return {
        id: item.id,
        topic: item.topic,
        status: 'pending_review',
        reason: humanReviewReason,
      };
    }

    try {
      await ensureAutoAdMappingsForBlog({
        contentCreativeId: creativeId,
        slug: generated.slug,
        seoTitle: generated.seo_title,
        destination: item.destination ?? null,
        primaryKeyword,
        targetKeywords: item.meta?.keywords ?? null,
      });
    } catch (e) {
      logWarning('[cron/blog-publisher] auto ad mapping failed (non-blocking)', e);
    }

    // 큐 업데이트
    await supabaseAdmin.from('blog_topic_queue')
      .update({
        status: 'published',
        content_creative_id: creativeId,
        last_error: null,
        attempts: 0,
        meta: successfulQueueMeta,
      })
      .eq('id', item.id);

    const baseUrl = resolveBlogCanonicalOrigin();
    try {
      await recordAutoPublishLog({
        platform: 'blog',
        url: `${baseUrl}/blog/${generated.slug}`,
        productId: item.product_id ?? null,
        travelPackageId: item.travel_package_id ?? item.package_id ?? null,
      });
    } catch (e) {
      // 로그 저장 실패는 발행 성공을 롤백하지 않는다.
      logWarning('[cron/blog-publisher] marketing_logs record failed (non-blocking)', e);
    }

    try {
      await enqueuePublishedBlogCover(creativeId);
    } catch (e) {
      logWarning('[cron/blog-publisher] Codex cover enqueue failed (non-blocking)', e);
    }

    return {
      id: item.id,
      topic: item.topic,
      status: publishedAtomicUpgrade ? 'upgraded' : 'published',
      reason: generated.slug,
      atomicIndexing: contentBoundary.lane === 'informational',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '알수없음';

    const timeoutMatch = msg.match(/blog_ai_generation_timeout:(\d+)ms/);
    const providerFailureCode = classifyBlogAiProviderFailure(err);
    if (providerFailureCode) {
      const priorAttempt = await readLatestBlogGenerationAttemptV4(item.id);
      const attemptNumber = Math.max(1, Math.min(BLOG_QUALITY_MAX_ATTEMPTS_V4,
        await readLatestBlogModelCallAttemptNumberV4(
          item.id,
          priorAttempt?.attemptNumber ?? 0,
        ),
      ));
      const requestedStage = String(
        item.meta?.ai_orchestration_v4?.next_stage || 'draft_flash',
      ) as BlogDeepSeekStage;
      const stage: BlogDeepSeekStage = ['rewrite_pro_high', 'rewrite_pro_max'].includes(requestedStage)
        ? requestedStage
        : 'draft_flash';
      const terminal = attemptNumber >= 3;
      const retrySameStage = [
        'blog_ai_generation_timeout',
        'blog_ai_transport_error',
        'blog_ai_rate_limited',
        'blog_ai_provider_unavailable',
      ].includes(providerFailureCode);
      const route = terminal ? 'quarantine' : retrySameStage ? 'failed' : 'rewrite_pro_max';
      const timeoutDurationMs = Math.max(0, Number(timeoutMatch?.[1] || 0));
      const failureReceipt: BlogAiTextResult['receipt'] = err instanceof BlogAiResponseError
        ? err.receipt
        : {
            provider: resolveBlogGenerationModelV4(stage)?.provider ?? 'deepseek',
            model: resolveBlogGenerationModelV4(stage)?.model
              ?? (stage === 'draft_flash' ? BLOG_DEEPSEEK_MODELS.draft : BLOG_DEEPSEEK_MODELS.rewrite),
            startedAt: new Date(Date.now() - timeoutDurationMs).toISOString(),
            completedAt: new Date().toISOString(),
            latencyMs: timeoutDurationMs,
            finishReason: providerFailureCode === 'blog_ai_generation_timeout'
              ? 'timeout'
              : providerFailureCode,
            thinkingMode: 'disabled',
            deepseekCost: null,
          };
      const attemptPersistence = await recordBlogGenerationAttemptV4({
        queueId: item.id,
        tenantId: item.tenant_id ?? null,
        attemptNumber,
        stage,
        route,
        output: { title: '', description: '', slug: '', markdown: '' },
        qualityScore: 0,
        hardBlockers: ['model_output_incomplete'],
        failureReasons: [providerFailureCode],
        researchFingerprint: priorAttempt?.researchFingerprint ?? null,
        claimFingerprint: priorAttempt?.claimFingerprint ?? null,
        receipt: failureReceipt,
        attemptStatus: 'failed',
        errorCode: providerFailureCode,
      });
      const failureStatus = await handleFailure(item, msg, null, terminal, {
        ai_orchestration_v4: {
          version: 'blog-deepseek-orchestrator-v4',
          route,
          next_stage: terminal ? null : retrySameStage ? stage : 'rewrite_pro_max',
          failure_evidence: [providerFailureCode],
          provider_finish_reason: failureReceipt.finishReason,
          output_characters: err instanceof BlogAiResponseError ? err.outputCharacters : 0,
          attempt_persistence_error: attemptPersistence.error,
          last_attempted_at: new Date().toISOString(),
        },
      }, { forceQueue: !terminal });
      return {
        id: item.id,
        topic: item.topic,
        status: terminal ? 'quarantined' : failureStatus === 'queued' ? 'rewrite_queued' : failureStatus,
        reason: msg,
      };
    }

    // 정보성 컨텍스트 부족은 재시도해도 동일 결과 → 즉시 permanently failed
    const isUnrecoverable = msg.includes('컨텍스트 부족');
    const failureStatus = await handleFailure(item, msg, null, isUnrecoverable);
    const researchRetryQueued = msg.includes('auto_research_extraction_empty:')
      && failureStatus === 'queued';
    return {
      id: item.id,
      topic: item.topic,
      status: researchRetryQueued ? 'research_retry_queued' : 'error',
      reason: msg,
    };
  }
}

async function handleFailure(
  item: any,
  reason: string,
  qa: any,
  forceFailure = false,
  extraMeta?: Record<string, unknown>,
  retryPolicy?: { forceQueue?: boolean },
): Promise<'queued' | 'failed' | 'skipped'> {
  const attempts = (item.attempts || 0) + 1;
  const decision = classifyBlogQueueFailure(reason, qa);
  const isDuplicateFailure = isBlogDuplicateQueueFailure(reason) || decision.code === 'duplicate_content';
  // The DeepSeek orchestrator owns and bounds rewrite/reresearch attempts.
  // A generic queue classifier must not cancel an explicit next stage, while
  // terminal quarantine and real canonical duplicates remain authoritative.
  const forceOrchestratorQueue = retryPolicy?.forceQueue === true
    && !forceFailure
    && !isDuplicateFailure;
  const shouldForceFailure = forceFailure || (!decision.retryable && !forceOrchestratorQueue);
  const retryDelayMs = forceOrchestratorQueue || decision.selfHealAllowed ? 0 : 2 * 3600 * 1000;
  const currentSelfHealRetries = Number((item.meta || {}).self_heal_retry_count ?? 0);
  const keepSelfHealCandidateLive =
    decision.selfHealAllowed
    && !shouldForceFailure
    && !isDuplicateFailure
    && item.source !== 'manual'
    && currentSelfHealRetries < 4;
  const finalStatus = forceOrchestratorQueue
    ? 'queued'
    : (isDuplicateFailure || decision.skipped) && item.source !== 'manual'
      ? 'skipped'
      : shouldForceFailure || (attempts >= MAX_ATTEMPTS && !keepSelfHealCandidateLive) ? 'failed' : 'queued';
  const storedAttempts = forceOrchestratorQueue
    ? Math.min(attempts, Math.max(0, MAX_ATTEMPTS - 1))
    : keepSelfHealCandidateLive && finalStatus === 'queued'
    ? Math.min(attempts, Math.max(0, MAX_ATTEMPTS - 1))
    : attempts;
  const baseMeta = item.meta && typeof item.meta === 'object' && !Array.isArray(item.meta)
    ? { ...(item.meta as Record<string, unknown>) }
    : {};
  if (forceOrchestratorQueue) {
    delete baseMeta.quarantine_reason;
    delete baseMeta.skipped_duplicate;
  }

  const { error: queueUpdateError } = await supabaseAdmin.from('blog_topic_queue')
    .update({
      status: finalStatus,
      attempts: storedAttempts,
      last_error: reason,
      target_publish_at: finalStatus === 'queued'
        ? new Date(Date.now() + retryDelayMs).toISOString()
        : item.target_publish_at,
      meta: {
        ...baseMeta,
        last_qa: qa,
        failure_code: decision.code,
        failure_retryable: forceOrchestratorQueue || decision.retryable,
        self_heal_blocked: forceOrchestratorQueue ? false : !decision.selfHealAllowed,
        ...(forceOrchestratorQueue ? { orchestrator_retry_forced: true } : {}),
        ...(keepSelfHealCandidateLive
          ? {
              self_heal_retry_count: currentSelfHealRetries + 1,
              self_heal_last_kept_live_at: new Date().toISOString(),
            }
          : {}),
        ...(extraMeta || {}),
        ...(forceOrchestratorQueue || decision.selfHealAllowed
          ? {}
          : { quarantine_reason: 'non_retryable_failure' }),
        last_failed_at: new Date().toISOString(),
        ...(isDuplicateFailure ? { skipped_duplicate: true } : {}),
      },
    })
    .eq('id', item.id);
  if (queueUpdateError) {
    logWarning('[cron/blog-publisher] queue failure status update failed', {
      id: item.id,
      targetStatus: finalStatus,
      error: queueUpdateError.message,
    });
  }

  // `recordBlogGenerationAttemptV4` deliberately leaves a model-approved run
  // in `generating` until all publication gates have committed. If a later
  // gate fails (for example representative ownership), close that run here so
  // the publication controller can never publish a candidate whose queue was
  // failed or skipped.
  const blockedRunStatus = finalStatus === 'failed' ? 'quarantine' : 'human_review';
  const { error: runTransitionError } = await supabaseAdmin
    .from('blog_generation_runs')
    .update({
      status: blockedRunStatus,
      disposition: `publication_gate_${finalStatus}`,
      scheduled_publish_at: null,
      last_error: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('queue_id', item.id)
    .eq('generation_key', `queue:${item.id}`)
    .eq('status', 'generating');
  if (runTransitionError) {
    logWarning('[cron/blog-publisher] blocked generation run transition failed', {
      id: item.id,
      targetStatus: blockedRunStatus,
      error: runTransitionError.message,
    });
  }

  // 자기학습: 실패 원인을 error_patterns 에 누적 (있는 경우만)
  try {
    await supabaseAdmin.rpc('upsert_error_pattern', {
      p_error_code: `BLOG-GEN-${Date.now().toString(36)}`,
      p_category: 'blog_generation',
      p_title: `블로그 생성 실패: ${item.topic}`,
      p_description: reason,
      p_severity: 'medium',
      p_source: 'blog-publisher',
    });
  } catch { /* RPC 없어도 크리티컬 아님 */ }

  return finalStatus;
}

// ── 생성기 ────────────────────────────────────────────────

interface GeneratedBlog {
  blog_html: string;
  slug: string;
  seo_title: string;
  seo_description: string;
  og_image_url?: string | null;
  generation_meta?: Record<string, unknown>;
  /** 카드뉴스 슬라이드 PNG URL 배열 (섹션별 이미지 배치용) */
  slide_image_urls?: string[];
}

async function loadBlogAttemptRevalidationCandidateV4(
  item: any,
  request: BlogAttemptRevalidationRequestV4,
): Promise<{ generated: GeneratedBlog; attemptId: string }> {
  if (item.product_id || item.card_news_id || item.meta?.controlled_publish_canary !== true) {
    throw new Error('generation_attempt_revalidation_scope_blocked');
  }
  const [{ data: attempt, error: attemptError }, { data: run, error: runError }] = await Promise.all([
    supabaseAdmin
      .from('blog_generation_attempts')
      .select('id,run_id,queue_id,attempt_number,status,route,model,quality_score_after,hard_blockers,failure_reasons,output_document')
      .eq('id', request.attemptId)
      .eq('queue_id', item.id)
      .maybeSingle(),
    supabaseAdmin
      .from('blog_generation_runs')
      .select('id,status,attempt_count,selected_attempt_id')
      .eq('queue_id', item.id)
      .eq('generation_key', `queue:${item.id}`)
      .maybeSingle(),
  ]);
  if (attemptError || !attempt) throw new Error(attemptError?.message || 'generation_attempt_revalidation_attempt_missing');
  if (runError || !run) throw new Error(runError?.message || 'generation_attempt_revalidation_run_missing');
  const output = (attempt.output_document || {}) as {
    title?: string;
    description?: string;
    slug?: string;
    markdown?: string;
    audit?: Record<string, unknown>;
  };
  const normalizedOutput = {
    title: String(output.title || ''),
    description: String(output.description || ''),
    slug: String(output.slug || ''),
    markdown: String(output.markdown || ''),
    audit: output.audit || {},
  };
  const eligible = attempt.run_id === run.id
    && run.status === 'quarantine'
    && Number(run.attempt_count || 0) === Number(item.attempts || 0)
    && run.selected_attempt_id === null
    && isEligibleBlogGenerationAttemptRevalidationV4({
      snapshot: {
        attemptNumber: Number(attempt.attempt_number || 0),
        status: String(attempt.status || ''),
        route: String(attempt.route || ''),
        qualityScore: Number(attempt.quality_score_after || 0),
        hardBlockers: attempt.hard_blockers,
        failureReasons: attempt.failure_reasons,
        output: normalizedOutput,
      },
      expectedAttemptNumber: Number(item.attempts || 0),
      output: normalizedOutput,
      reason: request.reason,
    });
  if (!eligible) throw new Error('generation_attempt_revalidation_candidate_not_eligible');

  const contentBrief = buildQueueContentBrief(item);
  if (!contentBrief.passed) {
    throw new Error(`generation_attempt_revalidation_brief_failed:${contentBrief.issues.join(',')}`);
  }
  const researchReadiness = evaluateBlogGenerationResearchReadiness({
    meta: item.meta,
    expectedContentKey: buildQueueSlug(item),
    destination: item.destination,
    intent: contentBrief.intentType,
    locale: contentBrief.plan.locale,
    sourcePolicy: contentBrief.sourcePolicy,
  });
  if (!researchReadiness.passed || !researchReadiness.bundle) {
    throw new Error(`generation_attempt_revalidation_research_failed:${researchReadiness.issues.join(',')}`);
  }
  const contentBriefV3 = buildResearchBackedContentBriefV3({
    item,
    legacyBrief: contentBrief,
    researchBundle: researchReadiness.bundle,
    serpResearch: null,
  });
  let revalidatedOutput = normalizedOutput;
  let revalidatedWriterClaimLedger = Array.isArray(normalizedOutput.audit.writer_claim_ledger)
    ? normalizedOutput.audit.writer_claim_ledger as BlogInformationClaimLedgerEntry[]
    : [];
  let revalidatedWriterClaimLedgerIssues = Array.isArray(normalizedOutput.audit.writer_claim_ledger_issues)
    ? normalizedOutput.audit.writer_claim_ledger_issues.filter(
      (issue): issue is string => typeof issue === 'string',
    )
    : ['claim_ledger_missing'];
  if (request.reason === 'route_template_dedup_v2') {
    const decisionArtifact = buildBlogDecisionArtifactV1({
      title: contentBriefV3.metadata.title,
      question: contentBriefV3.primaryQuery,
      primaryDecision: contentBriefV3.primaryDecision,
      intentType: contentBrief.intentType,
      bundle: researchReadiness.bundle,
    });
    if (decisionArtifact.promiseType !== 'route_decision') {
      throw new Error('generation_attempt_revalidation_route_artifact_missing');
    }
    contentBriefV3.title = decisionArtifact.resolvedTitle;
    contentBriefV3.metadata.title = decisionArtifact.resolvedTitle;
    contentBriefV3.metadata.ogTitle = decisionArtifact.resolvedTitle;
    const repaired = applyBlogDecisionArtifactToWriterOutputV1({
      artifact: decisionArtifact,
      output: {
        markdown: normalizedOutput.markdown,
        claimLedger: revalidatedWriterClaimLedger,
        ledgerIssues: revalidatedWriterClaimLedgerIssues,
      },
    });
    revalidatedOutput = {
      ...normalizedOutput,
      title: decisionArtifact.resolvedTitle,
      markdown: repaired.markdown,
    };
    revalidatedWriterClaimLedger = repaired.claimLedger;
    revalidatedWriterClaimLedgerIssues = repaired.ledgerIssues;
  }
  if (!contentBriefV3.passed
    || revalidatedOutput.title !== contentBriefV3.metadata.title
    || revalidatedOutput.slug !== buildQueueSlug(item)
    || revalidatedOutput.markdown.length < 200) {
    throw new Error('generation_attempt_revalidation_public_output_mismatch');
  }
  if (revalidatedWriterClaimLedger.length === 0 || revalidatedWriterClaimLedgerIssues.length > 0) {
    throw new Error('generation_attempt_revalidation_claim_ledger_invalid');
  }

  return {
    attemptId: attempt.id,
    generated: {
      blog_html: revalidatedOutput.markdown,
      slug: revalidatedOutput.slug,
      seo_title: revalidatedOutput.title,
      seo_description: revalidatedOutput.description,
      og_image_url: null,
      generation_meta: {
        prompt_version: 'deterministic-attempt-revalidation-v4',
        writer: 'info_writer',
        editorial_voice: BLOG_EDITORIAL_VOICE,
        content_brief: {
          title: contentBrief.title,
          primary_keyword: contentBrief.primaryKeyword,
          secondary_keywords: contentBrief.secondaryKeywords,
          search_intent: contentBrief.searchIntent,
          intent_type: contentBrief.plan.intent,
          destination_id: contentBrief.plan.destinationId,
          audience: contentBrief.plan.audience,
          locale: contentBrief.plan.locale,
          traveler_nationality: contentBrief.plan.travelerNationality,
          risk_level: contentBrief.plan.riskLevel,
          required_sections: contentBrief.requiredSections,
          required_facts: contentBrief.plan.requiredFacts,
          planned_tables: contentBrief.plan.plannedTables,
          faq_questions: contentBrief.plan.faqQuestions,
          missing_inputs: contentBrief.plan.missingInputs,
          requires_human_review: contentBrief.plan.requiresHumanReview,
          source_policy: contentBrief.plan.sourcePolicy,
          forbidden_angles: contentBrief.forbiddenAngles,
          source_requirements: contentBrief.sourceRequirements,
          evidence: contentBrief.evidence,
          claim_ledger_policy: contentBrief.claimLedgerPolicy,
          editorial_variation: item.meta?.editorial_variation ?? null,
        },
        content_brief_v3: contentBriefV3,
        writer_claim_ledger: {
          version: 'v1',
          claims: revalidatedWriterClaimLedger,
          issues: revalidatedWriterClaimLedgerIssues,
        },
        writer_output_boundary: {
          version: 'v1',
          original_characters: normalizedOutput.markdown.length,
          final_characters: revalidatedOutput.markdown.length,
          truncated: false,
        },
        competitor_copy_risk_v3: {
          minimum_consecutive_tokens: 12,
          match_count: 0,
          passed: true,
        },
        rewrite_claim_packet_v4: normalizedOutput.audit.rewrite_claim_packet_v4 ?? null,
        information_research_preflight: summarizeBlogGenerationResearch(researchReadiness),
        information_research_structure_repair: {
          applied: false,
          changes: [],
          policy: 'v3_claim_gate_only_no_deterministic_prose_rewrite',
        },
        cover_image: { provider: 'none', disclosure: null },
        ai_orchestration_v4: {
          stage: 'rewrite_pro_max',
          attempt: Number(attempt.attempt_number || 0),
          model: attempt.model,
          deterministic_revalidation: true,
          source_attempt_id: attempt.id,
          revalidation_reason: request.reason,
          model_calls: 0,
        },
      },
    },
  };
}

/**
 * 카드뉴스 기반 블로그 — 확정된 card_news + 슬라이드 PNG.
 * `publisher_bridge` 로 본문만 받아 퍼블리셔가 게이트 통과 후 단일 INSERT (draft 선삽입 없음).
 */
async function generateFromCardNews(item: any, eligibleByCardNewsId: Map<string, number>): Promise<GeneratedBlog> {
  const { data: cn, error: cnErr } = await supabaseAdmin
    .from('card_news')
    .select('id, status')
    .eq('id', item.card_news_id)
    .limit(1);

  if (cnErr || !cn?.[0]) throw new Error(`카드뉴스 로드 실패: ${item.card_news_id}`);

  const slideUrls = await getSlideImagePublicUrlsForBlog(item.card_news_id, ['blog', '1x1']);
  if (slideUrls.length === 0) {
    throw new Error('카드뉴스 PNG 아직 렌더링 안 됨. 어드민에서 "확정+블로그 생성" 먼저 클릭하세요.');
  }

  const cnid = item.card_news_id as string;
  const eligibleMs =
    eligibleByCardNewsId.get(cnid) ?? Date.now() + getCardNewsRenderBufferMs();
  if (Date.now() < eligibleMs) {
    throw new Error(
      `카드뉴스 PNG 안정화 대기 중 (~${new Date(eligibleMs).toISOString()}). 크론이 자동으로 재시도합니다.`,
    );
  }

  const baseUrl = resolveBlogCanonicalOrigin();
  const cronSecret = getSecret('CRON_SECRET');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cronSecret) headers.Authorization = `Bearer ${cronSecret}`;

  const res = await withPublisherTimeout(
    fetch(`${baseUrl}/api/blog/from-card-news`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        card_news_id: item.card_news_id,
        slide_image_urls: slideUrls,
        publisher_bridge: true,
      }),
    }),
    BLOG_PUBLISHER_BRIDGE_TIMEOUT_MS,
    'card_news_bridge',
  );

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`from-card-news API 실패: ${res.status} ${errBody.substring(0, 200)}`);
  }

  const data = await res.json();
  const bridge = parsePublisherBridgeResponse(data);
  if (!bridge) {
    throw new Error('from-card-news: publisher_bridge 파싱 실패(필드 누락·어드민 응답 혼동). 배포·CRON_SECRET·요청 본문을 확인하세요.');
  }

  return {
    blog_html: bridge.blog_html,
    slug: bridge.slug || `cardnews-${item.card_news_id}`,
    seo_title: bridge.seo_title || item.topic,
    seo_description: bridge.seo_description || '',
    og_image_url: bridge.og_image_url ?? slideUrls[0] ?? null,
    slide_image_urls: slideUrls as string[],
  };
}

/**
 * Pillar compatibility entrypoint.
 *
 * Pillar generation uses the same research-backed V3 writer as every other
 * informational article. Broad queries therefore refresh their existing
 * representative and cannot create a fixed-template duplicate URL.
 */
async function generatePillar(item: any): Promise<GeneratedBlog> {
  return generateFromTopic(item);
}
// romanize()와 slugifyTopic()은 src/lib/slug-utils.ts로 이관 (SSOT 통합)

async function generateFromProduct(item: any): Promise<GeneratedBlog> {
  if (!hasBlogApiKey(BLOG_DEEPSEEK_MODELS.draft)) {
    throw new Error('AI API 키 미설정 — 상품 블로그 생성 불가');
  }
  const { data: pkg, error } = await supabaseAdmin
    .from('travel_packages')
    .select('*')
    .eq('id', item.product_id)
    .limit(1);

  if (error || !pkg || pkg.length === 0) {
    throw new Error(`상품 조회 실패: ${item.product_id}`);
  }

  const product = pkg[0];
  const openContract = await loadCustomerOpenContractForPackage(supabaseAdmin, item.product_id);
  if (!isCustomerOpenContractBlogPublishable(openContract)) {
    throw new Error(`product_customer_open_contract_failed:${customerOpenContractBlogBlockReason(openContract)}`);
  }
  const angle = normalizeAngleType(item.angle_type);

  // 관광지 매칭 (옵션)
  let attractions: any[] = [];
  if (product.destination) {
    const { data: attrs } = await supabaseAdmin
      .from('attractions')
      .select('name, short_desc, photos, badge_type, aliases')
      .eq('region', product.destination);
    attractions = attrs || [];
  }

  const productBrief = buildProductBlogBrief(product, angle);
  const productConsultBrief = buildProductConsultBrief(productBrief);
  let groundedDraft = generateProductConsultantBlogPost(product, productBrief);
  const reviewSnips = await fetchApprovedReviewSnippets({
    packageId: product.id,
    destination: product.destination,
    limit: 3,
  });
  groundedDraft += formatReviewQuotesAppendMarkdown(reviewSnips);
  const seo = generateBlogSeo(product, angle);
  // Append product facts to prevent same-destination products from burning duplicate slug candidates.
  const slug = `${seo.slug}-${buildProductSlugSuffix(product)}`;

  // og_image_url 폴백 체인 — null 비율 83% 문제 해결 (2026-05-12)
  // 1. 상품 대표사진 hero_image_url
  // 2. 상품 thumbnail_urls[0]
  // 3. 첫 매칭된 관광지의 첫 사진
  // 4. 어떤 관광지든 첫 가용 사진
  // 5. 브랜드 기본 OG (절대 null 반환 X)
  const baseUrl = resolveBlogCanonicalOrigin();
  const firstAttrPhoto =
    attractions[0]?.photos?.[0]?.src_medium ||
    attractions
      .flatMap((a: any) => (Array.isArray(a?.photos) ? a.photos : []))
      .find((p: any) => p?.src_medium)?.src_medium ||
    null;
  const og_image_url: string =
    (product as { hero_image_url?: string | null }).hero_image_url ||
    (Array.isArray((product as { thumbnail_urls?: string[] }).thumbnail_urls)
      ? (product as { thumbnail_urls?: string[] }).thumbnail_urls?.[0]
      : null) ||
    firstAttrPhoto ||
    `${baseUrl}/og-image.png`;

  const priorAttempt = await readLatestBlogGenerationAttemptV4(item.id);
  const latestModelCallAttemptNumber = await readLatestBlogModelCallAttemptNumberV4(
    item.id,
    priorAttempt?.attemptNumber ?? 0,
  );
  const requestedStage = String(
    item.meta?.ai_orchestration_v4?.next_stage
    || (item.meta?.ai_orchestration_v4?.route === 'reresearch'
      ? latestModelCallAttemptNumber >= 2 ? 'rewrite_pro_max' : 'rewrite_pro_high'
      : 'draft_flash'),
  ) as BlogDeepSeekStage;
  const generationStage: BlogDeepSeekStage = ['rewrite_pro_high', 'rewrite_pro_max'].includes(requestedStage)
    ? requestedStage
    : 'draft_flash';
  const generationAttemptNumber = nextBlogModelCallAttemptNumberV4(
    latestModelCallAttemptNumber,
  );
  const failureEvidence = Array.isArray(item.meta?.ai_orchestration_v4?.failure_evidence)
    ? item.meta.ai_orchestration_v4.failure_evidence.filter((value: unknown): value is string => typeof value === 'string')
    : [];
  const productPrompt = [
    '당신은 여소남의 여행상품 설명 에디터입니다.',
    '아래 저장된 상품 사실과 승인된 후기만 사용해 독자가 이 상품이 자신에게 맞는지 판단할 수 있는 한국어 글을 작성하세요.',
    '가격·날짜·항공·호텔·포함/불포함·좌석·혜택을 새로 만들거나 추정하지 마세요.',
    '과장, 허위 희소성, 운영팀 검증 표현, 입력에 없는 고객 경험을 쓰지 마세요.',
    '본문에 판매 URL을 만들지 마세요. 공개 렌더러가 의도 기반 CTA를 별도로 붙입니다.',
    `고정 제목: ${seo.seoTitle}`,
    `상품 계약: ${JSON.stringify(productConsultBrief)}`,
    '근거가 되는 초안:',
    groundedDraft,
  ].join('\n\n');
  const finalPrompt = generationStage === 'draft_flash'
    ? productPrompt
    : `${productPrompt}\n\n${buildDeepSeekRewritePromptV4({
        originalDraft: priorAttempt?.output.markdown || groundedDraft,
        failureEvidence,
        researchFingerprint: priorAttempt?.researchFingerprint || `product:${product.id}`,
        claimFingerprint: priorAttempt?.claimFingerprint || productBrief.dedup_key,
      })}`;
  const productGenerationOptions: {
    model: string;
    temperature: number;
    deepseekThinking?: 'disabled';
  } = generationStage === 'draft_flash'
    ? { model: BLOG_DEEPSEEK_MODELS.draft, deepseekThinking: 'disabled', temperature: 0.35 }
    : {
        model: BLOG_DEEPSEEK_MODELS.rewrite,
        temperature: 0.2,
      };
  const productPromptTrace = buildBlogPromptTraceV1({
    prompt: finalPrompt,
    templateVersion: `${productBrief.prompt_version}:${generationStage}`,
    brief: productConsultBrief,
    claimPacket: productBrief,
    model: productGenerationOptions.model,
    temperature: productGenerationOptions.temperature,
    stage: generationStage,
  });
  const generation = await generatePublisherBlogText(finalPrompt, productGenerationOptions, {
        queueId: item.id,
        attemptNumber: generationAttemptNumber,
        stage: generationStage,
      });
  const blog_html = generation.text
    .replace(/^```markdown\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  if (!blog_html) throw new Error('deepseek_product_generation_empty');

  return {
    blog_html: blog_html + `\n\n<!-- prompt_version: ${productBrief.prompt_version} -->`,
    slug,
    seo_title: seo.seoTitle,
    seo_description: seo.seoDescription,
    og_image_url,
    generation_meta: {
      prompt_version: productBrief.prompt_version,
      prompt_trace_v1: productPromptTrace,
      writer: 'product_consultant_writer',
      editorial_voice: BLOG_EDITORIAL_VOICE,
      product_consult_brief: productConsultBrief,
      prompt_contract: buildProductConsultantPromptBlock(productConsultBrief),
      content_brief: {
        title: productBrief.product_title,
        primary_keyword: productBrief.primary_keyword,
        seo_keyword: productBrief.seo_keyword,
        secondary_keywords: [productBrief.destination, productBrief.supplier_code, productBrief.departure_date]
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
        search_intent: 'commercial_package_comparison',
        required_sections: [
          'price_and_inclusions',
          'itinerary_summary',
          'fit_and_cautions',
          'consultation_cta',
        ],
        forbidden_angles: [
          'clickbait opening',
          'unsupported scarcity',
          'hidden excluded costs',
        ],
        source_requirements: [
          'use stored product fields only',
          'do not invent prices, dates, hotels, airlines, or inclusions',
        ],
        product: productBrief,
      },
      product_dedup_key: productBrief.dedup_key,
      ai_orchestration_v4: {
        stage: generationStage,
        attempt: generationAttemptNumber,
        model: generation.receipt.model,
        thinking: generation.receipt.thinkingMode ?? 'disabled',
        receipt: generation.receipt,
      },
      seo: {
        primary_keyword: seo.primaryKeyword,
        seo_keyword: productBrief.seo_keyword,
        secondary_keywords: seo.secondaryKeywords,
      },
    },
  };
}

async function generateFromTopic(
  item: any,
  options: {
    validatedPrivateRegenerationRequest?: PrivateBlogRegenerationRequest;
  } = {},
): Promise<GeneratedBlog> {
  if (!hasBlogApiKey(BLOG_DEEPSEEK_MODELS.draft)) {
    throw new Error('AI API 키 미설정 — 정보성 블로그 생성 불가');
  }

  const {
    content: informationWriterGuide,
    version: promptVersion,
    source: promptSource,
  } = await getActiveBlogInformationWriterGuide();
  const privateRegenerationRequest = options.validatedPrivateRegenerationRequest
    ?? readPrivateBlogRegenerationRequest(item);
  const privateRegeneration = privateRegenerationRequest !== null
    || hasPrivateBlogRegenerationIntent(item);
  const queueSlug = buildQueueSlug(item);
  const reviewSnips = await fetchApprovedReviewSnippets({
    packageId: item.product_id ?? null,
    destination: item.destination ?? null,
    limit: 4,
  });
  const reviewPromptBlock =
    reviewSnips.length > 0
      ? `\n## 실제 여행자 목소리 (본문 중간 H2 사이에 > 인용으로 1~3곳 반영)\n${formatReviewQuotesForPrompt(reviewSnips)}\n`
      : '';
  const freshnessRisk = classifyBlogFreshnessRisk(`${item.topic} ${item.primary_keyword || ''} ${item.category || ''}`);
  const freshnessPromptBlock = buildFreshnessPromptBlock(freshnessRisk);

  // 키워드 tier 기반 SEO 분기
  const tier = (item.keyword_tier as 'head' | 'mid' | 'longtail' | null) || 'mid';
  const contentBrief = buildQueueContentBrief(item);
  if (!contentBrief.passed) {
    throw new Error(`blog_content_brief_failed:${contentBrief.issues.join(',')}`);
  }
  let researchReadiness = evaluateBlogGenerationResearchReadiness({
    meta: item.meta,
    expectedContentKey: queueSlug,
    destination: item.destination,
    intent: contentBrief.intentType,
    locale: contentBrief.plan.locale,
    sourcePolicy: contentBrief.sourcePolicy,
  });
  const publishedAtomicUpgrade = isPublishedBlogAtomicUpgradeRequest(privateRegenerationRequest);
  if ((!privateRegeneration || publishedAtomicUpgrade) && !researchReadiness.passed) {
    const autoResearch = await researchBlogInformationAutomatically({
      contentKey: queueSlug,
      destination: item.destination,
      locale: contentBrief.plan.locale,
      brief: contentBrief,
    });
    if (!autoResearch.passed || !autoResearch.bundle) {
      const previousResearchFailure = item.meta?.auto_research_failure
        && typeof item.meta.auto_research_failure === 'object'
        && !Array.isArray(item.meta.auto_research_failure)
        ? item.meta.auto_research_failure as Record<string, unknown>
        : {};
      const researchFailureAttempt = Number(previousResearchFailure.attempt_count || 0) + 1;
      const extractionPayloadEmpty = autoResearch.directSourceCount > 0
        && autoResearch.responseTextLength > 0
        && autoResearch.observedSources.length === 0
        && ['missing_sources', 'missing_evidence', 'missing_claims']
          .every((issue) => autoResearch.issues.includes(issue));
      const retryableExtractionFailure = extractionPayloadEmpty && researchFailureAttempt < 2;
      item.meta = {
        ...(item.meta || {}),
        auto_research_failure: {
          version: 'reviewed-source-direct-fetch-v5',
          attempt_count: researchFailureAttempt,
          failed_at: new Date().toISOString(),
          model: autoResearch.model,
          issues: autoResearch.issues.slice(0, 8),
          grounding_source_count: autoResearch.groundingSourceCount,
          direct_source_count: autoResearch.directSourceCount,
          direct_source_failure_count: autoResearch.directSourceFailures.length,
          direct_source_failure_samples: autoResearch.directSourceFailures.slice(0, 5),
          critical_source_retry_count: autoResearch.criticalSourceRetryCount,
          critical_source_recovered_count: autoResearch.criticalSourceRecoveredCount,
          critical_source_snapshot_fallback_count:
            autoResearch.criticalSourceSnapshotFallbackCount,
          finish_reason: autoResearch.finishReason,
          response_text_length: autoResearch.responseTextLength,
          retryable_extraction_empty: retryableExtractionFailure,
        },
      };
      if (retryableExtractionFailure) {
        throw new Error(
          `auto_research_extraction_empty:${autoResearch.issues.slice(0, 8).join(',')}`,
        );
      }
      throw new Error(
        `evidence_insufficient:auto_research_failed:${autoResearch.issues.slice(0, 8).join(',')}`,
      );
    }
    item.meta = {
      ...(item.meta || {}),
      [BLOG_INFORMATION_RESEARCH_META_KEY]: autoResearch.bundle,
      auto_research: {
        version: 'reviewed-source-direct-fetch-v5',
        model: autoResearch.model,
        completed_at: new Date().toISOString(),
        grounding_source_count: autoResearch.groundingSourceCount,
        direct_source_count: autoResearch.directSourceCount,
        direct_source_failure_count: autoResearch.directSourceFailures.length,
        direct_source_failure_samples: autoResearch.directSourceFailures.slice(0, 5),
        critical_source_retry_count: autoResearch.criticalSourceRetryCount,
        critical_source_recovered_count: autoResearch.criticalSourceRecoveredCount,
        critical_source_snapshot_fallback_count:
          autoResearch.criticalSourceSnapshotFallbackCount,
        search_query_count: autoResearch.searchQueries.length,
      },
    };
    const { error: researchQueueUpdateError } = await supabaseAdmin
      .from('blog_topic_queue')
      .update({ meta: item.meta })
      .eq('id', item.id);
    if (researchQueueUpdateError) {
      throw new Error(`evidence_insufficient:auto_research_queue_persist:${researchQueueUpdateError.message}`);
    }
    researchReadiness = evaluateBlogGenerationResearchReadiness({
      meta: item.meta,
      expectedContentKey: queueSlug,
      destination: item.destination,
      intent: contentBrief.intentType,
      locale: contentBrief.plan.locale,
      sourcePolicy: contentBrief.sourcePolicy,
    });
  }
  if (!researchReadiness.passed || !researchReadiness.bundle) {
    throw new Error(
      `evidence_insufficient:research_preflight:${researchReadiness.issues.slice(0, 8).join(',')}`,
    );
  }
  let serpResearchV3: SerpResearchPacketV3 | null = null;
  const shouldAnalyzeSerp = !privateRegeneration && Boolean(
    item.primary_keyword || contentBrief.primaryKeyword,
  );
  if (shouldAnalyzeSerp) {
    try {
      serpResearchV3 = await researchSerpNaverFirstV3({
        primaryQuery: item.primary_keyword || contentBrief.primaryKeyword,
        secondaryQueries: [
          ...(Array.isArray(item.meta?.keywords) ? item.meta.keywords : []),
          ...contentBrief.secondaryKeywords,
        ].filter((value): value is string => typeof value === 'string'),
      });
    } catch (error) {
      console.warn('[blog-publisher] Naver-first research unavailable; continuing with verified demand and official evidence only:',
        error instanceof Error ? error.message : String(error));
    }
  }
  const contentBriefV3 = buildResearchBackedContentBriefV3({
    item,
    legacyBrief: contentBrief,
    researchBundle: researchReadiness.bundle,
    serpResearch: serpResearchV3,
  });
  if (!contentBriefV3.passed) {
    throw new Error(`blog_content_brief_v3_failed:${contentBriefV3.issues.join(',')}`);
  }
  if (contentBriefV3.publicationStrategy === 'refresh_representative' && !privateRegeneration) {
    throw new Error('information_representative_refresh_required:broad_query_new_url_blocked');
  }
  const decisionArtifact = buildBlogDecisionArtifactV1({
    title: contentBriefV3.metadata.title,
    question: contentBriefV3.primaryQuery,
    primaryDecision: contentBriefV3.primaryDecision,
    intentType: contentBrief.intentType,
    bundle: researchReadiness.bundle,
  });
  if (decisionArtifact.resolvedTitle !== contentBriefV3.metadata.title) {
    contentBriefV3.title = decisionArtifact.resolvedTitle;
    contentBriefV3.metadata.title = decisionArtifact.resolvedTitle;
    contentBriefV3.metadata.ogTitle = decisionArtifact.resolvedTitle;
    contentBriefV3.titleCandidates = [{
      title: decisionArtifact.resolvedTitle,
      rationale: '근거가 뒷받침하는 범위로 제목 약속을 축소함',
      primary: true,
    }];
  }
  const routeFactText = decisionArtifact.publicFacts.map((fact) => fact.claimText).join('\n');
  const hasGuamCanaryEvidence = decisionArtifact.promiseType === 'route_decision'
    && /GRTA/i.test(routeFactText)
    && /카카오\s*T|Kakao\s*T/i.test(routeFactText)
    && /택시\s*카운터|taxi\s*counter/i.test(routeFactText)
    && /택시\s*미터|미터\s*요금|taxi\s*meter/i.test(routeFactText);
  if (hasGuamCanaryEvidence) {
    const destinationLabel = String(item.destination || '').trim();
    contentBriefV3.metadata.description = `${destinationLabel ? `${destinationLabel} ` : ''}공항 교통을 준비할 때 확인할 GRTA 요금·운행 근거, 공항 택시 카운터와 현지 택시 미터요금, 카카오 T 괌택시 수하물·항공 지연 대응을 공식 출처별로 정리했습니다.`;
  }
  const artifactResearchBundle = withBlogDecisionArtifactClaimsV1(
    researchReadiness.bundle,
    decisionArtifact,
  );
  researchReadiness = { ...researchReadiness, bundle: artifactResearchBundle };
  item.meta = {
    ...(item.meta || {}),
    [BLOG_INFORMATION_RESEARCH_META_KEY]: artifactResearchBundle,
    decision_artifact_v1: decisionArtifact,
  };
  const { error: artifactQueuePersistError } = await supabaseAdmin
    .from('blog_topic_queue')
    .update({ meta: item.meta })
    .eq('id', item.id);
  if (artifactQueuePersistError) {
    throw new Error(`decision_artifact_queue_persist_failed:${artifactQueuePersistError.message}`);
  }
  await persistBlogInformationResearch({
    ...artifactResearchBundle,
    tenantId: item.tenant_id ?? artifactResearchBundle.tenantId ?? null,
  });
  await markBlogInformationResearchClaimsSupported({
    contentKey: artifactResearchBundle.contentKey,
    claimFingerprints: artifactResearchBundle.claims.map((claim) => claim.claimFingerprint),
  });
  const researchPromptBlock = buildBlogGenerationResearchPromptBlock(researchReadiness);
  const infoGuideBrief = buildInfoGuideBrief(contentBriefV3);
  const effectiveTopic = contentBriefV3.title;
  const primaryKw = contentBriefV3.primaryQuery;
  const trendScore = item.trend_score;
  const intentPromptBlock = buildBlogIntentPromptContract(classifyBlogIntent({
    title: effectiveTopic,
    slug: queueSlug,
    primaryKeyword: primaryKw,
    angleType: normalizeAngleType(item.angle_type),
    category: item.category,
    contentType: item.source === 'pillar' ? 'pillar' : (item.product_id ? 'package_intro' : 'guide'),
    productId: item.product_id ?? null,
  }));

  const trendBlock = trendScore && trendScore > 30
    ? `\n## Demand signal (planning context only)\n- Internal trend score: ${trendScore}/100.\n- Never expose this score or claim that searches are surging. Use it only to prioritize timely reader checks.\n` : '';

  // Search results guide decision coverage only. Facts still come exclusively
  // from the official research/claim packet above.
  const serpBlock = serpResearchV3 ? buildSerpResearchPromptBlockV3(serpResearchV3) : '';

  const assignmentBlock = [
    '## Assignment',
    `- Queue topic: ${item.topic}`,
    item.destination ? `- Destination: ${item.destination}` : '- Destination: intentionally generic only if the brief permits it',
    `- Category: ${item.category || 'travel_tips'}`,
    `- Primary keyword: ${primaryKw}`,
    `- Final content brief topic: ${effectiveTopic}`,
    `- Secondary keywords: ${contentBriefV3.secondaryQueries.join(', ') || 'none'}`,
    `- Optional related terms: ${(item.meta?.keywords || []).join(', ') || 'none'}`,
  ].join('\n');
  const editorialVariationBlock = buildEditorialVariationPromptBlock(item);
  const { prompt, manifest: promptManifest } = buildInformationalWriterPrompt({
    guide: informationWriterGuide,
    assignmentBlock,
    contextBlocks: [
      reviewPromptBlock,
      freshnessPromptBlock,
      intentPromptBlock,
      buildBlogContentBriefV3PromptBlock(contentBriefV3),
      buildBlogDecisionArtifactPromptBlockV1(decisionArtifact),
      editorialVariationBlock,
      buildInfoWriterPromptBlock(infoGuideBrief),
      researchPromptBlock,
      trendBlock,
      serpBlock,
    ],
    depthBlock: buildInformationalDepthBlock(tier),
    qualityBlock: buildInformationalQualityBlock({
      primaryKeyword: primaryKw,
      destination: item.destination,
    }),
  });

  const priorAttempt = await readLatestBlogGenerationAttemptV4(item.id);
  const latestModelCallAttemptNumber = await readLatestBlogModelCallAttemptNumberV4(
    item.id,
    priorAttempt?.attemptNumber ?? 0,
  );
  const requestedStage = String(
    item.meta?.ai_orchestration_v4?.next_stage
    || (item.meta?.ai_orchestration_v4?.route === 'reresearch'
      ? latestModelCallAttemptNumber >= 2 ? 'rewrite_pro_max' : 'rewrite_pro_high'
      : 'draft_flash'),
  ) as BlogDeepSeekStage;
  const generationStage: BlogDeepSeekStage = ['rewrite_pro_high', 'rewrite_pro_max'].includes(requestedStage)
    ? requestedStage
    : 'draft_flash';
  const generationAttemptNumber = nextBlogModelCallAttemptNumberV4(
    latestModelCallAttemptNumber,
  );
  const rewriteEvidence = Array.isArray(item.meta?.ai_orchestration_v4?.failure_evidence)
    ? item.meta.ai_orchestration_v4.failure_evidence.filter((value: unknown): value is string => typeof value === 'string')
    : [];
  const researchEvidenceByKey = new Map(
    artifactResearchBundle.evidence.map((evidence) => [evidence.evidenceKey, evidence]),
  );
  const researchSourceByKey = new Map(
    artifactResearchBundle.sources.map((source) => [source.sourceKey, source]),
  );
  const decisionPublicFactByFingerprint = new Map(
    decisionArtifact.publicFacts.map((fact) => [fact.claimFingerprint, fact]),
  );
  const rewriteClaimPacketAudit = artifactResearchBundle.claims.map((claim) => {
    const linkedEvidence = claim.evidenceKeys
      .map((key) => researchEvidenceByKey.get(key))
      .filter((evidence): evidence is BlogInformationResearchBundle['evidence'][number] => Boolean(evidence));
    const literalSupport = inspectBlogInformationClaimLiteralSupport({
      claimText: claim.claimText,
      evidence: linkedEvidence,
    });
    const sourceUrls = [...new Set(linkedEvidence.flatMap((evidence) => {
      const sourceUrl = researchSourceByKey.get(evidence.sourceKey)?.sourceUrl;
      return sourceUrl ? [sourceUrl] : [];
    }))];
    const typeCompatibility = inspectBlogInformationClaimTypeCompatibility(
      claim.claimText,
      claim.claimType,
    );
    return {
      claim,
      literalSupport,
      sourceUrls,
      typeCompatibility,
      publicFact: decisionPublicFactByFingerprint.get(claim.claimFingerprint) ?? null,
      derived: claim.extractedValue?.derivation?.version === 'blog-claim-derivation-v1',
    };
  });
  const rewriteApprovedClaims = selectDecisionRelevantRewriteClaimsV4({
    primaryQuery: contentBriefV3.primaryQuery,
    primaryDecision: contentBriefV3.primaryDecision,
    approvedClaims: rewriteClaimPacketAudit
    .filter((entry) =>
      !entry.derived
      && entry.literalSupport.passed
      && entry.typeCompatibility.passed
      && entry.sourceUrls.length > 0)
    .map((entry) => ({
      claimText: entry.claim.claimText,
      claimType: entry.claim.claimType,
      riskLevel: entry.claim.riskLevel,
      sourceUrls: entry.sourceUrls,
      citationLabel: entry.publicFact?.citationLabel ?? '확인한 원문',
      sourceLabels: entry.publicFact?.sourceLabels ?? ['확인한 원문'],
    })),
  });
  if (generationStage !== 'draft_flash' && rewriteApprovedClaims.length === 0) {
    throw new Error('blog_rewrite_approved_claims_missing');
  }
  const rewriteDecisionArtifact = restrictBlogDecisionArtifactFactsV1(
    decisionArtifact,
    rewriteApprovedClaims,
  );
  const generationPrompt = generationStage === 'draft_flash'
    ? prompt
    : `${buildDeepSeekRewritePromptV4({
        originalDraft: priorAttempt?.output.markdown || '(이전 초안 원문을 불러오지 못했습니다. 동일 연구·claim 범위에서만 새로 작성하세요.)',
        failureEvidence: rewriteEvidence,
        researchFingerprint: priorAttempt?.researchFingerprint || 'persisted-research-packet',
        claimFingerprint: priorAttempt?.claimFingerprint || 'persisted-claim-ledger',
        evidencePacket: {
          fixedTitle: contentBriefV3.metadata.title,
          primaryQuery: contentBriefV3.primaryQuery,
          primaryDecision: contentBriefV3.primaryDecision,
          archetype: contentBriefV3.archetype,
          // These remain purposes, not factual instructions. The rewrite
          // contract explicitly permits omission when the approved packet
          // cannot support a purpose.
          sectionPurposes: contentBriefV3.sectionPurposes.map((purpose) => purpose.purpose),
          approvedClaims: rewriteApprovedClaims,
          officialSourceUrls: [...new Set(artifactResearchBundle.sources
            .map((source) => source.sourceUrl)
            .filter((url): url is string => Boolean(url)))].slice(0, 6),
          internalLink: `${resolveBlogCanonicalOrigin()}/blog/destination/${encodeURIComponent(item.destination || '')}`,
          includeFaq: contentBriefV3.includeFaq,
          includeChecklist: contentBriefV3.includeChecklist,
        },
      })}\n\n${buildBlogDecisionArtifactPromptBlockV1(rewriteDecisionArtifact)}`;
  const generationOptions: {
    model: string;
    temperature: number;
    deepseekThinking?: 'disabled';
  } = generationStage === 'draft_flash'
    ? {
        model: BLOG_DEEPSEEK_MODELS.draft,
        deepseekThinking: 'disabled',
        temperature: hasPrivateBlogRegenerationIntent(item) ? 0.25 : 0.7,
      }
    : {
        model: BLOG_DEEPSEEK_MODELS.rewrite,
        temperature: 0.2,
      };
  const promptTrace = buildBlogPromptTraceV1({
    prompt: generationPrompt,
    templateVersion: `${promptVersion}:${generationStage}:decision-artifact-v1`,
    brief: contentBriefV3,
    claimPacket: rewriteClaimPacketAudit.map((entry) => ({
      fingerprint: entry.claim.claimFingerprint,
      sourceUrls: entry.sourceUrls,
      derived: entry.derived,
    })),
    model: generationOptions.model,
    temperature: generationOptions.temperature,
    stage: generationStage,
  });
  const generation = await generatePublisherBlogText(generationPrompt, generationOptions, {
        queueId: item.id,
        attemptNumber: generationAttemptNumber,
        stage: generationStage,
      });
  const parsedWriterOutput = parseBlogInformationWriterOutput(generation.text);
  const labelRepairedWriterOutput = generationStage === 'draft_flash'
    ? parsedWriterOutput
    : restoreApprovedRewriteClaimLabels(parsedWriterOutput, rewriteApprovedClaims);
  // The writer may return the fixed title as plain text. Normalize it before
  // opening repair so the repair can locate the H1/H2 boundary reliably.
  const headingNormalizedWriterOutput = {
    ...labelRepairedWriterOutput,
    markdown: normalizeBlogWriterHeadingV4(
      labelRepairedWriterOutput.markdown,
      contentBriefV3.metadata.title,
    ),
  };
  const writerOutput = applyBlogDecisionArtifactToWriterOutputV1({
    output: headingNormalizedWriterOutput,
    artifact: decisionArtifact,
  });
  let blog_html = writerOutput.markdown
    .replace(/^```markdown\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const writerOutputBoundary = boundBlogWriterOutput(blog_html);
  blog_html = writerOutputBoundary.markdown;
  const competitorPhraseMatches = serpResearchV3
    ? findCompetitorPhraseMatchesV3(blog_html, serpResearchV3.results)
    : [];
  if (competitorPhraseMatches.length > 0) {
    throw new Error(`competitor_copy_risk:${competitorPhraseMatches.map((match) => match.url).slice(0, 3).join(',')}`);
  }
  console.log(
    `[blog-publisher] writer output boundary: ${writerOutputBoundary.originalCharacters}`
    + ` -> ${writerOutputBoundary.finalCharacters}, truncated=${writerOutputBoundary.truncated}`,
  );
  // V5 owns arithmetic and the direct-answer surface; the claim gate below
  // independently verifies every persisted source-backed and derived claim.

  // slug 자동 — 오래된 큐에 잘못 들어간 expected_slug는 자동 무시
  const slug = queueSlug;

  // Title/H1/OG are fixed by the V3 brief. SERP frequency never adds a power
  // word, year, or visitor-specific variant at this boundary.
  const seo_title = contentBriefV3.metadata.title.trim().slice(0, 80);
  const seo_description = contentBriefV3.metadata.description;

  // og_image_url 자동 할당 — 목적지와 검색 의도에 맞는 상위 후보만 사용
  let og_image_url: string | null = null;
  const destForImage = item.destination || extractDestination(item.topic);
  if (destForImage && !privateRegeneration) {
    try {
      og_image_url = await findOrGenerateBlogCover({
        destination: destForImage,
        primaryKeyword: contentBriefV3.primaryQuery,
        sectionTitle: contentBriefV3.primaryDecision,
      });
    } catch { /* silent — og_image_url은 null로 유지 */ }
  }

  const generation_meta: Record<string, unknown> = {
    prompt_version: promptVersion,
    prompt_source: promptSource,
    prompt_manifest: promptManifest,
    prompt_trace_v1: promptTrace,
    decision_artifact_v1: decisionArtifact,
    micro_angle: getQueueMicroAngle(item) ?? microAngleForInformationIntent(contentBrief.plan.intent),
    writer: 'info_writer',
    ai_orchestration_v4: {
      stage: generationStage,
      attempt: generationAttemptNumber,
      model: generation.receipt.model,
      thinking: generation.receipt.thinkingMode ?? 'disabled',
      receipt: generation.receipt,
    },
    editorial_voice: BLOG_EDITORIAL_VOICE,
    info_guide_brief: infoGuideBrief,
    content_brief: {
      title: contentBrief.title,
      primary_keyword: contentBrief.primaryKeyword,
      secondary_keywords: contentBrief.secondaryKeywords,
      search_intent: contentBrief.searchIntent,
      intent_type: contentBrief.plan.intent,
      destination_id: contentBrief.plan.destinationId,
      audience: contentBrief.plan.audience,
      locale: contentBrief.plan.locale,
      traveler_nationality: contentBrief.plan.travelerNationality,
      risk_level: contentBrief.plan.riskLevel,
      required_sections: contentBrief.requiredSections,
      required_facts: contentBrief.plan.requiredFacts,
      planned_tables: contentBrief.plan.plannedTables,
      faq_questions: contentBrief.plan.faqQuestions,
      missing_inputs: contentBrief.plan.missingInputs,
      requires_human_review: contentBrief.plan.requiresHumanReview,
      source_policy: contentBrief.plan.sourcePolicy,
      forbidden_angles: contentBrief.forbiddenAngles,
      source_requirements: contentBrief.sourceRequirements,
      evidence: contentBrief.evidence,
      claim_ledger_policy: contentBrief.claimLedgerPolicy,
      editorial_variation: item.meta?.editorial_variation ?? null,
    },
    content_brief_v3: contentBriefV3,
    writer_claim_ledger: {
      version: 'v1',
      claims: writerOutput.claimLedger,
      issues: writerOutput.ledgerIssues,
    },
    writer_output_boundary: {
      version: 'v1',
      original_characters: writerOutputBoundary.originalCharacters,
      final_characters: writerOutputBoundary.finalCharacters,
      truncated: writerOutputBoundary.truncated,
    },
    competitor_copy_risk_v3: {
      minimum_consecutive_tokens: 12,
      match_count: competitorPhraseMatches.length,
      passed: competitorPhraseMatches.length === 0,
    },
    rewrite_claim_packet_v4: {
      approved_count: rewriteApprovedClaims.length,
      excluded: rewriteClaimPacketAudit.flatMap<Record<string, unknown>>((entry) => {
        if (!entry.literalSupport.passed) {
          return [{
            claim_fingerprint: entry.claim.claimFingerprint,
            reason: 'literal_support_missing',
            missing_numeric_tokens: entry.literalSupport.missingNumericTokens,
          }];
        }
        if (!entry.typeCompatibility.passed) {
          return [{
            claim_fingerprint: entry.claim.claimFingerprint,
            reason: 'claim_type_mismatch',
            declared_type: entry.typeCompatibility.declaredType,
            deterministic_type: entry.typeCompatibility.deterministicType,
            candidate_kind: entry.typeCompatibility.candidateKind,
          }];
        }
        return [];
      }),
    },
    information_research_preflight: summarizeBlogGenerationResearch(researchReadiness),
    ...(item.meta?.auto_research
      && typeof item.meta.auto_research === 'object'
      && !Array.isArray(item.meta.auto_research)
      ? { auto_research: item.meta.auto_research }
      : {}),
    information_research_structure_repair: {
      applied: false,
      changes: [],
      policy: 'v3_claim_gate_only_no_deterministic_prose_rewrite',
    },
    cover_image: {
      provider: isGeneratedBlogImageUrl(og_image_url) ? 'ai_generated' : (og_image_url ? 'pexels' : 'none'),
      disclosure: isGeneratedBlogImageUrl(og_image_url) ? 'AI 생성 참고 이미지' : null,
    },
    serp_analyzed: Boolean(serpResearchV3?.serpFeatures.editorialResultCount),
    freshness_risk: freshnessRisk,
    ...(serpResearchV3 ? {
      serp_analysis: {
        keyword: serpResearchV3.queryCluster.primaryQuery,
        source: 'naver_first',
        signal_source: serpResearchV3.mode,
        fetched_at: serpResearchV3.researchedAt,
        cached: serpResearchV3.mode === 'cached',
        intent: serpResearchV3.intent,
        structure_consensus: serpResearchV3.consensus,
        content_gaps: serpResearchV3.contentGaps,
      },
      serp_research_packet_v3: {
        ...serpResearchV3,
        results: serpResearchV3.results.map((result) => ({
          sampleRank: result.sampleRank,
          providerRank: result.providerRank,
          source: result.source,
          url: result.url,
          domain: result.domain,
        })),
      },
    } : {}),
  };

  return {
    blog_html: blog_html + `\n\n<!-- prompt_version: ${promptVersion} -->`,
    slug,
    seo_title,
    seo_description,
    og_image_url,
    generation_meta,
  };
}
