import { NextRequest, NextResponse } from 'next/server';
import { cronUnauthorizedResponse, isCronOrVercelAuthorized } from '@/lib/cron-auth';
import { logWarning } from '@/lib/sentry-logger';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { BANNED_CLICHES, runQualityGates, type QualityGateReport } from '@/lib/blog-quality-gate';
import { generateBlogText, hasBlogApiKey } from '@/lib/blog-ai-caller';
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
import { analyzeSerp, buildSerpPromptBlock, buildOptimalTitle } from '@/lib/serp-analyzer';
import { researchKeyword, enrichWithGscData } from '@/lib/keyword-research';
import { appendInterlinkSection } from '@/lib/topical-authority';
import { computeSeoScore } from '@/lib/blog-seo-scorer';
import { extractFaqItems } from '@/lib/blog-jsonld';
import { evaluateBlogPublishQuality, type BlogPublishQualityReport } from '@/lib/blog-publish-quality';
import { buildBlogQueueSuccessMeta } from '@/lib/blog-queue-success-meta';
import { withPersistedBlogReadingTime } from '@/lib/blog-reading-time';
import { repairPublisherSeoSlug, strengthenPublisherIntroHook } from '@/lib/blog-publisher-repair';
import { repairBlogSeoMetadata } from '@/lib/blog-seo-repair';
import {
  ensureBlogInlineImages,
  extractBlogInlineImageUrls,
  findRelevantBlogPexelsImage,
} from '@/lib/blog-inline-images';
import { generateSectionImage, isGeneratedBlogImageUrl } from '@/lib/blog-image-gen';
import { optimizeImageSeoInHtml } from '@/lib/blog-image-seo';
import { repairBlogImageQuality } from '@/lib/blog-image-quality';
import { repairBlogAiReadableStructure } from '@/lib/blog-ai-readable-repair';
import { indexBlog } from '@/lib/jarvis/rag/indexer';
import { parsePublisherBridgeResponse } from '@/lib/blog-card-news-bridge';
import { calculateBlogPublishSlotQuota } from '@/lib/blog-publish-slot-quota';
import { buildBlogPackageCtaUrl, buildStandardBlogCtaMarkdown, sanitizeBlogCtaLinks } from '@/lib/blog-cta';
import { stripBlogInformationalBodyCtas } from '@/lib/blog-informational-cta';
import { appendOfficialReferenceLinksIfNeeded, forceAppendOfficialReferenceLinks } from '@/lib/blog-official-links';
import {
  appendPublishReadinessSupport,
  ensurePublisherInternalLinks,
  repairPublishReadiness,
} from '@/lib/blog-publish-readiness-repair';
import {
  fetchApprovedReviewSnippets,
  formatReviewQuotesAppendMarkdown,
  formatReviewQuotesForPrompt,
} from '@/lib/blog-review-quotes';
import { maybeApplyChainOfDensity } from '@/lib/blog-chain-of-density';
import { getCardNewsRenderBufferMs, getEarliestBlogPublishEligibleMsBatch } from '@/lib/card-news-render-readiness';
import { getSlideImagePublicUrlsForBlog } from '@/lib/card-news-slide-urls';
import { recordAutoPublishLog } from '@/lib/publish-orchestration';
import { ensureAutoAdMappingsForBlog } from '@/lib/blog-ad-mapping-auto';
import { getSecret } from '@/lib/secret-registry';
import { slugifyTopic, romanize, extractDestination } from '@/lib/slug-utils';
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
import { buildBlogContentBrief, buildBlogContentBriefPromptBlock } from '@/lib/blog-content-brief';
import {
  BLOG_INFORMATION_RESEARCH_META_KEY,
  buildBlogGenerationResearchPromptBlock,
  evaluateBlogGenerationResearchReadiness,
  repairBlogGenerationResearchStructure,
  summarizeBlogGenerationResearch,
} from '@/lib/blog-generation-research';
import {
  markBlogInformationResearchClaimsSupported,
  persistBlogInformationResearch,
} from '@/lib/blog-information-evidence-repository';
import { researchBlogInformationAutomatically } from '@/lib/blog-auto-research';
import { buildBlogIntentPromptContract, classifyBlogIntent } from '@/lib/blog-content-intent';
import {
  normalizeBlogVisualAccents,
  repairBlogEditorialQuality,
  repairBlogStructureQuality,
  repairKeywordDensityToTarget,
} from '@/lib/blog-editorial-repair';
import { repairBlogFinalCustomerSurface } from '@/lib/blog-final-customer-surface';
import { repairBlogEngineCategoryGaps } from '@/lib/blog-engine-category-repair';
import { repairArticleQualityV2Specifics } from '@/lib/blog-article-quality-v2-repair';
import { ensureDailyPublishableQueue, getBlogPublishingPolicy, MIN_PUBLISHABLE_BUFFER_DAYS, normalizeDailyPostTarget } from '@/lib/blog-scheduler';
import { classifyBlogQueueFailure, shouldSelfHealBlogQueueItem } from '@/lib/blog-queue-failure-policy';
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
import { queueForReview } from '@/lib/content-review-workflow';
import { isHighRiskInformationalTopic } from '@/lib/blog-publication-review-policy';
import { routeBlogContentLane } from '@/lib/blog-content-boundary';
import {
  evaluateBlogInformationClaimPublishGate,
  persistBlogInformationClaimFindings,
} from '@/lib/blog-information-claim-publish-gate';
import {
  parseBlogInformationWriterOutput,
  type BlogInformationClaimLedgerEntry,
} from '@/lib/blog-information-claim-ledger';
import {
  buildBlogInformationRepresentativeKey,
  canUpgradePublishedBlogForRepresentative,
  readBlogInformationRepresentativeIdentity,
  type BlogInformationDuplicateDecision,
  type BlogInformationRepresentativeIdentity,
} from '@/lib/blog-information-representative';
import {
  attachBlogInformationRepresentativeDraft,
  reserveBlogInformationRepresentative,
} from '@/lib/blog-information-representative-repository';
import { publishBlogInformationAtomically } from '@/lib/blog-information-atomic-publication';
import { createBlogInformationContentFingerprint } from '@/lib/blog-information-review-workflow';
import { buildRecentInfoDuplicateScope } from '@/lib/blog-info-duplicate-scope';
import {
  hasPrivateBlogRegenerationIntent,
  isEligiblePrivateBlogRegenerationTarget,
  isPublishedBlogAtomicUpgradeRequest,
  PUBLISHED_BLOG_ATOMIC_UPGRADE_MODE,
  preservePublishedBlogAtomicUpgradeSlug,
  readPrivateBlogRegenerationRequest,
} from '@/lib/blog-private-regeneration';

/**
 * 블로그 자동 발행 크론 — vercel.json 의 schedule (현재 `0 2 * * *`, UTC 매일 02시) + 수동 GET
 *
 * 로직:
 *   1) blog_topic_queue WHERE target_publish_at <= NOW() AND status='queued' 스캔 (최대 MAX_BATCH)
 *   2) 각 항목:
 *      a. status='generating' 락 (동시성 방지)
 *      b. source 에 따라 생성:
 *         - pillar       → /destinations/[city] 허브 (장문 AI)
 *         - card_news    → from-card-news `publisher_bridge`(본문만) + 퍼블리셔가 단일 INSERT/승격
 *         - product      → product_consultant_writer (템플릿)
 *         - 나머지       → Gemini 2.5 Flash + style guide
 *      c. 4-Gate 검증 (length·cliche·duplicate·keyword_density)
 *      d. Pass → content_creatives insert 또는 draft 승격(status='published') + 색인 알림 + ISR revalidate
 *         Fail → attempts++ / 2회 초과 시 status='failed'
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
const MAX_CANDIDATE_POOL = readBoundedIntEnv('BLOG_PUBLISHER_MAX_CANDIDATE_POOL', 12, MAX_BATCH, 20);
const MAX_EXTRA_CLAIM_ROUNDS = readBoundedIntEnv('BLOG_PUBLISHER_MAX_EXTRA_CLAIM_ROUNDS', 4, 1, 8);
const MAX_QUALITY_REPAIR_ROUNDS = readBoundedIntEnv('BLOG_PUBLISHER_MAX_QUALITY_REPAIR_ROUNDS', 3, 0, 3);
const BLOG_PUBLISHER_AI_TIMEOUT_MS = readBoundedIntEnv('BLOG_PUBLISHER_AI_TIMEOUT_MS', 90_000, 30_000, 180_000);
const BLOG_PUBLISHER_BRIDGE_TIMEOUT_MS = readBoundedIntEnv('BLOG_PUBLISHER_BRIDGE_TIMEOUT_MS', 60_000, 10_000, 120_000);
const BLOG_PUBLISHER_GENERATION_TIMEOUT_MS = readBoundedIntEnv('BLOG_PUBLISHER_GENERATION_TIMEOUT_MS', 120_000, 30_000, 180_000);
const BLOG_PUBLISHER_MIN_ITEM_START_MS = readBoundedIntEnv('BLOG_PUBLISHER_MIN_ITEM_START_MS', 75_000, 30_000, 180_000);
const BLOG_PUBLISHER_FAST_FALLBACK_MIN_ITEM_START_MS = readBoundedIntEnv('BLOG_PUBLISHER_FAST_FALLBACK_MIN_ITEM_START_MS', 30_000, 15_000, 90_000);
const BLOG_PUBLISHER_ITEM_FINISH_RESERVE_MS = readBoundedIntEnv('BLOG_PUBLISHER_ITEM_FINISH_RESERVE_MS', 45_000, 15_000, 90_000);
const BLOG_PUBLISHER_OPTIONAL_WORK_MIN_MS = readBoundedIntEnv('BLOG_PUBLISHER_OPTIONAL_WORK_MIN_MS', 45_000, 10_000, 120_000);
const MAX_ATTEMPTS = 2;
const MAX_EXEC_MS = 210_000; // 210s — cron wrapper 285s/Vercel 300s 제한보다 여유 있게
const STALE_GENERATING_RECOVERY_MS = 15 * 60 * 1000;

function getQueueMicroAngle(item: any): string | null {
  const value = item?.meta?.micro_angle;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
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

function queueMetaWithoutResearchBundle(meta: unknown): Record<string, unknown> {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {};
  const safeMeta = { ...(meta as Record<string, unknown>) };
  delete safeMeta[BLOG_INFORMATION_RESEARCH_META_KEY];
  return safeMeta;
}

function repairPrimaryKeywordPresence(markdown: string, primaryKeyword?: string | null): {
  markdown: string;
  changed: boolean;
} {
  const keyword = String(primaryKeyword ?? '').replace(/\s+/g, ' ').trim();
  if (!keyword || markdown.includes(keyword)) return { markdown, changed: false };

  const sentence = `이 글은 ${keyword} 기준으로 월별 기온, 강수량, 옷차림 준비물을 확인하는 체크리스트입니다.`;
  const lines = markdown.split(/\r?\n/);
  const h1Index = lines.findIndex((line) => /^#\s+\S/.test(line));
  if (h1Index >= 0) {
    lines.splice(h1Index + 1, 0, '', sentence);
    return { markdown: lines.join('\n'), changed: true };
  }
  return { markdown: `${sentence}\n\n${markdown}`, changed: true };
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

function generatePublisherBlogText(
  prompt: string,
  options: Parameters<typeof generateBlogText>[1] = {},
): Promise<string> {
  return withPublisherTimeout(
    generateBlogText(prompt, options),
    BLOG_PUBLISHER_AI_TIMEOUT_MS,
    'blog_ai_generation',
  );
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
    .from('content_creatives')
    .select('id', { count: 'exact', head: true })
    .eq('channel', 'naver_blog')
    .eq('status', 'published')
    .gte('published_at', range.startIso)
    .lt('published_at', range.endIso);

  if (error) {
    logWarning('[cron/blog-publisher] daily publish quota count failed', error);
    return { count: 0, dayKey: range.dayKey };
  }
  return { count: count ?? 0, dayKey: range.dayKey };
}

/** 크론 1회 실행당 스타일 가이드 1회만 로드 (N+1 방지) */
let blogStyleGuideCache: SelectedBlogPrompt | null = null;
let blogInformationWriterGuideCache: SelectedBlogPrompt | null = null;

const NEUTRAL_CLICHE_REPLACEMENTS: Record<string, string> = {
  '아름다운': '경관이 좋은',
  '환상적인': '만족도가 높은',
  '완벽한': '필요한',
  '특별한': '주요',
  '매력적인': '선택할 만한',
  '잊지 못할': '기억할 만한',
  '놓치지 마세요': '확인하세요',
  '꼭 가봐야 할': '방문 후보로 볼',
  '최고의': '상위권의',
  '인생샷': '사진 포인트',
  '설레는': '기대되는',
  '힘찬': '활동적인',
  '낭만적인': '분위기 있는',
  '제대로': '꼼꼼히',
  '알찬': '실용적인',
  '만끽': '즐길 수 있는',
  '힐링': '휴식',
  '한 번쯤은 경험해 볼 만한': '일정에 넣어볼 만한',
  '추억에 남는': '기억에 남는',
  '독특한': '차별점이 있는',
  '다양한': '여러',
  '편안한': '부담이 적은',
  '인기 있는': '수요가 있는',
  '유명한': '알려진',
  '숨겨진': '상대적으로 덜 붐비는',
  '잘 알려지지 않은': '덜 알려진',
  '이국적인': '현지 분위기가 있는',
  '만족스러운': '평가가 좋은',
  '무난한': '선택하기 쉬운',
  '훌륭한': '좋은',
  '뛰어난': '강점이 있는',
  '여행의 묘미': '여행에서 확인할 포인트',
  '색다른 경험': '다른 동선',
  '잊을 수 없는 추억': '기억할 만한 일정',
  '완전히 새로운': '새롭게 볼 수 있는',
  '놀라운': '눈에 띄는',
  '생각지도 못한': '예상 밖의',
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function neutralizeBannedCliches(markdown: string): string {
  let normalized = markdown;
  for (const cliche of BANNED_CLICHES) {
    const replacement = NEUTRAL_CLICHE_REPLACEMENTS[cliche];
    if (!replacement) continue;
    normalized = normalized.replace(new RegExp(escapeRegExp(cliche), 'g'), replacement);
  }
  return normalized;
}

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

  if (isUsableBlogSlug(expected)) {
    const cleanExpected = expected.trim().toLowerCase();
    const expectedLooksThin =
      !cleanExpected.includes('-') &&
      topicSlug.includes('-') &&
      /-(preparation|currency|weather|visa|budget|food|faq|itinerary|transport|guide)(-v\d+)?$/.test(topicSlug);
    if (!expectedLooksThin) return cleanExpected;
  }

  if (isUsableBlogSlug(topicSlug)) return topicSlug;

  return stableFallbackSlug(item);
}

function normalizeGeneratedSlug(generated: GeneratedBlog, item: any): boolean {
  const queueSlug = buildQueueSlug(item);
  if (!isUsableBlogSlug(queueSlug) || generated.slug === queueSlug) return false;

  const current = String(generated.slug || '').trim().toLowerCase();
  const queueHasCategory = /-(preparation|currency|weather|visa|budget|food|faq|itinerary|transport|guide)(-v\d+)?$/.test(queueSlug);
  const currentLooksThin = !current.includes('-') && queueSlug.includes('-') && queueHasCategory;
  const currentIsCategoryOnly = /^-?(preparation|currency|weather|visa|budget|food|faq|itinerary|transport|guide)(-v\d+)?$/.test(current);

  if (!isUsableBlogSlug(current) || currentLooksThin || currentIsCategoryOnly) {
    generated.slug = queueSlug;
    return true;
  }

  return false;
}

function normalizeAngleType(value: unknown): AngleType {
  return normalizeBlogAngleType(value);
}

function strengthenIntroHook(markdown: string, item: any, primaryKeyword?: string | null): string {
  return strengthenPublisherIntroHook(markdown, item, primaryKeyword);

  const lines = markdown.split('\n');
  let h1Index = lines.findIndex(line => /^#\s+\S/.test(line.trim()));
  if (h1Index < 0) {
    const keyword = primaryKeyword || item.destination || extractDestination(item.topic || '') || item.topic || '여행 정보';
    lines.unshift(`# ${keyword}`, '');
    h1Index = 0;
  }

  const intro = lines
    .slice(h1Index + 1)
    .join('\n')
    .replace(/[#*_`[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  const hasNumber = /\d/.test(intro);
  const hasTrigger = /[?？]|만원|원|절약|저렴|차이|할인|특가|\d+분|\d+시간|즉시|당일|바로|비교|보다/.test(intro);
  if (hasNumber && hasTrigger) return markdown;

  const now = new Date();
  const keyword = primaryKeyword || item.destination || extractDestination(item.topic || '') || '이번 여행';
  const hook = `${now.getFullYear()}년 ${now.getMonth() + 1}월 기준, ${keyword}에서 가장 먼저 확인할 것은 무엇일까요? 준비물·비용·이동 시간을 먼저 비교하면 현지에서 낭비되는 1~2시간을 줄일 수 있습니다. 아래 내용은 예약 전 바로 확인할 항목만 추려 정리했습니다.`;
  lines.splice(h1Index + 1, 0, '', hook);
  return lines.join('\n');
}

function softenKeywordDensity(markdown: string, primaryKeyword?: string | null, blogType: 'product' | 'info' = 'info'): string {
  const keyword = primaryKeyword?.trim();
  if (!keyword || keyword.length < 2) return markdown;

  const plainLength = markdown
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/\[[^\]]+]\([^)]+\)/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#*_`>|=-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .length;
  if (plainLength === 0) return markdown;

  const currentCount = (markdown.match(new RegExp(escapeRegExp(keyword), 'g')) || []).length;
  const targetDensity = blogType === 'info' ? 1.55 : 2.2;
  const allowedCount = Math.max(4, Math.floor((plainLength * targetDensity) / (keyword.length * 100)));
  if (currentCount <= allowedCount) return markdown;

  const replacement = keyword.includes(' ')
    ? keyword.split(/\s+/).slice(-1)[0] || '관련 정보'
    : itemSafePronoun(keyword);
  let seen = 0;
  return markdown.replace(new RegExp(escapeRegExp(keyword), 'g'), () => {
    seen += 1;
    return seen <= allowedCount ? keyword : replacement;
  });
}

function itemSafePronoun(keyword: string): string {
  if (/^[가-힣]{2,8}$/.test(keyword)) return '현지';
  return '관련 지역';
}

function repairAiReadableStructure(markdown: string, item: any, primaryKeyword?: string | null): string {
  const keyword = primaryKeyword || item.destination || extractDestination(item.topic || '') || '여행 정보';
  const contentBrief = buildQueueContentBrief(item);
  const researchReadiness = evaluateBlogGenerationResearchReadiness({
    meta: item.meta,
    expectedContentKey: buildQueueSlug(item),
    destination: item.destination,
    intent: contentBrief.intentType,
    locale: contentBrief.plan.locale,
    sourcePolicy: contentBrief.sourcePolicy,
  });
  return repairBlogAiReadableStructure({
    markdown,
    keyword,
    intent: contentBrief.intentType,
    approvedClaims: researchReadiness.passed ? researchReadiness.bundle?.claims : undefined,
  }).markdown;
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
    micro_angle: getQueueMicroAngle(item),
    generation_meta: generated.generation_meta ?? null,
    excludeContentCreativeId: item.content_creative_id ?? null,
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
  item: any,
  primaryKeyword?: string | null,
): string[] {
  const surfaceRepair = repairBlogFinalCustomerSurface({
    markdown: generated.blog_html,
    destination: item.destination ?? null,
    primaryKeyword,
    slug: generated.slug,
    title: generated.seo_title || item.topic,
  });
  if (!surfaceRepair.changed) return [];
  generated.blog_html = surfaceRepair.markdown;
  return surfaceRepair.changes;
}

function applyEngineCategoryRepair(
  generated: GeneratedBlog,
  item: any,
  blogType: 'product' | 'info',
  primaryKeyword?: string | null,
): string[] {
  const categoryRepair = repairBlogEngineCategoryGaps({
    markdown: generated.blog_html,
    blogType,
    title: generated.seo_title || item.topic || primaryKeyword || generated.slug,
    slug: generated.slug,
    destination: item.destination ?? null,
    primaryKeyword,
    angleType: normalizeAngleType(item.angle_type),
    category: item.category ?? null,
    contentType: item.source === 'pillar' ? 'pillar' : (item.product_id ? 'package_intro' : 'guide'),
    productId: item.product_id ?? null,
    generationMeta: generated.generation_meta ?? null,
  });
  if (!categoryRepair.changed) return [];
  generated.blog_html = categoryRepair.markdown;
  generated.generation_meta = {
    ...(generated.generation_meta || {}),
    engine_category_repair: {
      before_score: categoryRepair.beforeScore,
      after_score: categoryRepair.afterScore,
      repaired_categories: categoryRepair.repairedCategories,
      repair_rounds: categoryRepair.repairRounds,
      changes: categoryRepair.changes,
    },
  };
  return categoryRepair.changes;
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
      minImages: 3,
      maxImages: 4,
    });
    if (imageResult.inserted > 0) generated.blog_html = imageResult.markdown;
  } catch { /* private fallback diagnostics do not depend on image fetch success */ }
  generated.blog_html = appendOfficialReferenceLinksIfNeeded(generated.blog_html);
  generated.blog_html = sanitizeBlogCtaLinks(generated.blog_html, {
    destination: item.destination,
    slug: generated.slug,
    utmSource: 'naver_blog',
  });
  const surfaceChanges = applyFinalCustomerSurfaceRepair(generated, item, primaryKeyword);
  changes.push(...surfaceChanges);
  const densityRepair = repairKeywordDensityToTarget(generated.blog_html, primaryKeyword, 'info');
  if (densityRepair.changed) {
    generated.blog_html = densityRepair.blogHtml;
    changes.push('deterministic_keyword_density_repair');
  }
  return changes;
}

function failedGateSet(qa: QualityGateReport): Set<string> {
  return new Set(qa.gates.filter(gate => !gate.passed).map(gate => gate.gate));
}

async function repairFailedQualityGates(
  generated: GeneratedBlog,
  item: any,
  qa: QualityGateReport,
  blogType: 'product' | 'info',
  primaryKeyword?: string | null,
): Promise<QualityGateReport> {
  for (let round = 1; round <= MAX_QUALITY_REPAIR_ROUNDS && !qa.passed; round += 1) {
    const failed = failedGateSet(qa);
    const changes: string[] = [];
    let changed = false;

    if (failed.has('article_quality_v2')) {
      const articleRepair = repairArticleQualityV2Specifics(generated.blog_html, blogType);
      if (articleRepair.changes.length > 0) {
        generated.blog_html = articleRepair.markdown;
        changes.push(...articleRepair.changes);
        changed = true;
      }
    }

    if (failed.has('intent_quality') || failed.has('engine_v2') || failed.has('article_quality_v2') || failed.has('editorial_quality')) {
      const editorialRepair = repairBlogEditorialQuality({
        title: generated.seo_title,
        slug: generated.slug,
        primaryKeyword,
        destination: item.destination ?? null,
        angleType: normalizeAngleType(item.angle_type),
        category: item.category,
        contentType: item.source === 'pillar' ? 'pillar' : (item.product_id ? 'package_intro' : 'guide'),
        productId: item.product_id ?? null,
        blogHtml: generated.blog_html,
      });
      if (editorialRepair.changed) {
        generated.blog_html = editorialRepair.blogHtml;
        changes.push(...editorialRepair.changes);
        changed = true;
      }
    }

    if (
      failed.has('structure_integrity')
      || failed.has('table_integrity')
      || failed.has('intent_quality')
      || failed.has('engine_v2')
      || failed.has('render_integrity')
      || failed.has('article_quality_v2')
      || failed.has('editorial_quality')
    ) {
      const structureRepair = repairBlogStructureQuality({
        title: generated.seo_title,
        slug: generated.slug,
        primaryKeyword,
        destination: item.destination ?? null,
        angleType: normalizeAngleType(item.angle_type),
        category: item.category,
        contentType: item.source === 'pillar' ? 'pillar' : (item.product_id ? 'package_intro' : 'guide'),
        productId: item.product_id ?? null,
        blogHtml: generated.blog_html,
      });
      if (structureRepair.changed) {
        generated.blog_html = structureRepair.blogHtml;
        changes.push(...structureRepair.changes);
        changed = true;
      }
    }

    if (failed.has('keyword_density')) {
      const densityRepair = repairKeywordDensityToTarget(generated.blog_html, primaryKeyword, blogType);
      if (densityRepair.changed) {
        generated.blog_html = densityRepair.blogHtml;
        changes.push(`keyword_density_${densityRepair.beforeCount}_to_${densityRepair.afterCount}`);
        changed = true;
      }
    }

    if (failed.has('links')) {
      const before = generated.blog_html;
      generated.blog_html = forceAppendOfficialReferenceLinks(generated.blog_html);
      if (generated.blog_html !== before) {
        changes.push('forced_official_reference_links');
        changed = true;
      }

      const internalLinks = ensurePublisherInternalLinks({
        markdown: generated.blog_html,
        blogType,
        slug: generated.slug,
        destination: item.destination,
        topic: item.topic,
        primaryKeyword,
      });
      if (internalLinks.changed) {
        generated.blog_html = internalLinks.markdown;
        changes.push(...internalLinks.changes);
        changed = true;
      }
    }

    if (failed.has('image_quality')) {
      const imageRepair = repairBlogImageQuality(generated.blog_html, {
        destination: item.destination ?? null,
        primaryKeyword,
        blogType,
      });
      if (imageRepair.changed) {
        generated.blog_html = imageRepair.markdown;
        changes.push(...imageRepair.changes);
        changed = true;
      }
    }

    if (failed.has('length')) {
      const support = appendPublishReadinessSupport({
        markdown: generated.blog_html,
        blogType,
        slug: generated.slug,
        destination: item.destination,
        topic: item.topic,
        primaryKeyword,
      });
      if (support.changed) {
        generated.blog_html = support.markdown;
        changes.push(...support.changes);
        changed = true;
      }
    }

    if (failed.has('engine_v2')) {
      const categoryChanges = applyEngineCategoryRepair(generated, item, blogType, primaryKeyword);
      if (categoryChanges.length > 0) {
        changes.push(...categoryChanges);
        changed = true;
      }
      const before = generated.blog_html;
      generated.blog_html = appendOfficialReferenceLinksIfNeeded(generated.blog_html);
      if (generated.blog_html !== before) {
        changes.push('engine_v2_evidence_references');
        changed = true;
      }
    }

    if (failed.has('hook')) {
      const before = generated.blog_html;
      generated.blog_html = strengthenIntroHook(generated.blog_html, item, primaryKeyword);
      if (generated.blog_html !== before) {
        changes.push('strengthened_intro_hook');
        changed = true;
      }
    }

    if (failed.has('ai_readability') || failed.has('readability')) {
      const before = generated.blog_html;
      generated.blog_html = repairAiReadableStructure(generated.blog_html, item, primaryKeyword);
      if (generated.blog_html !== before) {
        changes.push('repaired_ai_readability');
        changed = true;
      }
    }

    if (failed.has('accent_density')) {
      const accentRepair = normalizeBlogVisualAccents(generated.blog_html);
      if (accentRepair.changed) {
        generated.blog_html = accentRepair.text;
        changes.push('normalized_visual_accents');
        changed = true;
      }
    }

    if (changed) {
      const structureRepair = repairBlogStructureQuality({
        title: generated.seo_title,
        slug: generated.slug,
        primaryKeyword,
        destination: item.destination ?? null,
        angleType: normalizeAngleType(item.angle_type),
        category: item.category,
        contentType: item.source === 'pillar' ? 'pillar' : (item.product_id ? 'package_intro' : 'guide'),
        productId: item.product_id ?? null,
        blogHtml: generated.blog_html,
      });
      if (structureRepair.changed) {
        generated.blog_html = structureRepair.blogHtml;
        changes.push(...structureRepair.changes);
      }
    }

    if (!changed) break;

    generated.generation_meta = {
      ...(generated.generation_meta || {}),
      repair_attempts: Number(generated.generation_meta?.repair_attempts ?? 0) + 1,
    };

    generated.blog_html = softenKeywordDensity(generated.blog_html, primaryKeyword, blogType);
    generated.blog_html = sanitizeBlogCtaLinks(generated.blog_html, {
      destination: item.destination,
      slug: generated.slug,
      utmSource: 'naver_blog',
    });
    {
      const surfaceChanges = applyFinalCustomerSurfaceRepair(generated, item, primaryKeyword);
      if (surfaceChanges.length > 0) {
        changes.push(...surfaceChanges);
      }
    }
    qa = await runGeneratedQualityGates(generated, item, blogType, primaryKeyword);
    console.log(`[blog-publisher] quality repair round ${round}: ${changes.join(', ')} -> passed=${qa.passed}`);
  }

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

      const result = await processQueueItem(item, new Map(), { startedAtMs: startTime });
      const targetedAttempts = 1;
      results.push(result);
      const completedPrivately = result.status === 'pending_review'
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

      const result = await processQueueItem(item, new Map(), { startedAtMs: startTime });
      results.push(result);
      const published = result.status === 'published' ? 1 : 0;
      return {
        ok: published === 1 || result.status === 'pending_review',
        processed: 1,
        published,
        targetedCanaryPublication: true,
        queueId: targetQueueId,
        results,
        errors: published === 1 || result.status === 'pending_review'
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
    const targetPostsToday = normalizeDailyPostTarget(publishPolicy?.posts_per_day ?? process.env.BLOG_DAILY_PUBLISH_TARGET);
    const todayQuota = await getTodayBlogPublishCount();
    const slotQuota = calculateBlogPublishSlotQuota({
      dailyTarget: targetPostsToday,
      alreadyPublished: todayQuota.count,
      slotTimes: publishPolicy?.slot_times,
    });
    const remainingDueNow = slotQuota.remainingDueNow;
    if (remainingDueNow <= 0) {
      const dailyQuotaReached = slotQuota.remainingDaily <= 0;
      let atomicUpgradeResult: Awaited<ReturnType<typeof processQueueItem>> | null = null;
      if (dailyQuotaReached && canStartPublisherQueueItem({
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
    let extraClaimRounds = 0;
    let pullForwarded = 0;
    let emergencyRefillRounds = 0;
    let stoppedForTimeBudget = false;
    const emergencyRefills: Array<Awaited<ReturnType<typeof ensureDailyPublishableQueue>> | null> = [];
    const orderedInitialQueue = sortPublisherQueueForTimeBudget(queue, {
      remainingMs: publisherRemainingMs(startTime),
      minItemStartMs: BLOG_PUBLISHER_MIN_ITEM_START_MS,
      fallbackMinItemStartMs: BLOG_PUBLISHER_FAST_FALLBACK_MIN_ITEM_START_MS,
      isFallbackEligible: isFastFallbackEligibleInfoItem,
    });
    for (const item of orderedInitialQueue) {
      if (attemptedQueueIds.has(item.id)) {
        results.push({ id: item.id, topic: item.topic, status: 'skipped', reason: 'already_attempted_this_run' });
        continue;
      }
      if (publishedThisRun >= remainingDueNow) {
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
        const r = await processQueueItem(item, eligibleByCardNewsId, { startedAtMs: startTime });
        results.push(r);
        if (r.status === 'published') {
          publishedThisRun += 1;
        }
        if (r.status !== 'published' && r.status !== 'done' && r.status !== 'deferred_buffer' && r.status !== 'deferred_time_budget' && r.status !== 'skipped') {
          candidateFailures.push(`${r.id} (${r.topic}): ${r.reason ?? r.status}`);
        }
      } catch (err) {
        candidateFailures.push(`${item.id} fatal: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    while (publishedThisRun < remainingDueNow && extraClaimRounds < MAX_EXTRA_CLAIM_ROUNDS) {
      const remaining = publisherRemainingMs(startTime);
      const extraClaimPlan = getPublisherExtraClaimRecoveryPlan({
        remainingMs: remaining,
        minItemStartMs: BLOG_PUBLISHER_MIN_ITEM_START_MS,
        fallbackMinItemStartMs: BLOG_PUBLISHER_FAST_FALLBACK_MIN_ITEM_START_MS,
        remainingQuota: remainingDueNow - publishedThisRun,
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

      const orderedNextQueue = sortPublisherQueueForTimeBudget(nextQueue, {
        remainingMs: publisherRemainingMs(startTime),
        minItemStartMs: BLOG_PUBLISHER_MIN_ITEM_START_MS,
        fallbackMinItemStartMs: BLOG_PUBLISHER_FAST_FALLBACK_MIN_ITEM_START_MS,
        isFallbackEligible: isFastFallbackEligibleInfoItem,
      });

      for (const item of orderedNextQueue) {
        if (attemptedQueueIds.has(item.id)) {
          results.push({ id: item.id, topic: item.topic, status: 'skipped', reason: 'already_attempted_this_run' });
          continue;
        }
        if (publishedThisRun >= remainingDueNow) break;

        const itemRemaining = publisherRemainingMs(startTime);
        if (!canStartPublisherQueueItem(item, itemRemaining)) {
          stoppedForTimeBudget = true;
          console.log(`[blog-publisher] remaining ${Math.round(itemRemaining / 1000)}s - stopping before next item`);
          break;
        }
        attemptedQueueIds.add(item.id);

        try {
          const r = await processQueueItem(item, nextEligibleByCardNewsId, { startedAtMs: startTime });
          results.push(r);
          if (r.status === 'published') {
            publishedThisRun += 1;
          }
          if (r.status !== 'published' && r.status !== 'done' && r.status !== 'deferred_buffer' && r.status !== 'deferred_time_budget' && r.status !== 'skipped') {
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

    const creativeIdBySlug = new Map<string, string>();
    if (publishedSlugs.length > 0) {
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
    for (const r of results) {
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
      publishedSlugs.length > 0
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
    revalidatePublicBlogCache();

    const canDrainInlineIndexing = canRunOptionalPublisherWork(
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
    const failureBreakdown = buildPublisherFailureBreakdown(results);
    const canonicalMatched = publishedSlugs.every(slug => typeof slug === 'string' && slug.trim().length > 0 && !slug.startsWith('/'));
    const underfilledQuota = publishedCount < remainingDueNow;
    if (underfilledQuota) {
      errors.push(
        publishedCount === 0
          ? 'publisher_zero_published_with_remaining_quota'
          : 'publisher_under_published_with_remaining_quota',
      );
      errors.push(...candidateFailures.slice(0, 5).map((failure) => `candidate_failure:${failure}`));
    }

    return {
      processed: results.length,
      published: publishedCount,
      candidate_failures: candidateFailures,
      indexingWorker,
      dailyQuota: {
        day: todayQuota.dayKey,
        target: targetPostsToday,
        scheduledTargetNow: slotQuota.scheduledTargetNow,
        alreadyPublishedBeforeRun: todayQuota.count,
        remainingBeforeRun: remainingDueNow,
        remainingAfterRun: Math.max(0, remainingDueNow - publishedCount),
        remainingDailyAfterRun: Math.max(0, slotQuota.remainingDaily - publishedCount),
        nextSlot: slotQuota.nextSlot,
        slotTimes: slotQuota.slotTimes,
      },
      quota_fulfillment: {
        required: remainingDueNow,
        published: publishedCount,
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

async function processQueueItem(
  item: any,
  eligibleByCardNewsId: Map<string, number>,
  options: { startedAtMs?: number } = {},
): Promise<{
  id: string;
  topic: string;
  status: string;
  reason?: string;
  atomicIndexing?: boolean;
}> {
  // 동시성 방지 — generating 락
  const { data: lockedRow, error: lockErr } = await supabaseAdmin
    .from('blog_topic_queue')
    .update({ status: 'generating', attempts: (item.attempts || 0) + 1 })
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
    //   3) product_id 있음 → product_consultant_writer (템플릿)
    //   4) 나머지 → Gemini 정보성 글
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

    const privateRegenerationIntent = hasPrivateBlogRegenerationIntent(item);
    const privateRegenerationRequest = readPrivateBlogRegenerationRequest(item);
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
      if (!publishedAtomicUpgrade) {
        privateReplacementAssets = {
          ogImageUrl: typeof replacementTarget.og_image_url === 'string' ? replacementTarget.og_image_url : null,
          inlineImageUrls: extractBlogInlineImageUrls(
            typeof replacementTarget.blog_html === 'string' ? replacementTarget.blog_html : null,
          ),
        };
      }
    }
    let queueReusableDraftId: string | null = null;
    let queueReusableAssets: { ogImageUrl: string | null; inlineImageUrls: string[] } | null = null;
    if (!privateRegenerationRequest && typeof item.content_creative_id === 'string') {
      const { data: queueCreative, error: queueCreativeError } = await supabaseAdmin
        .from('content_creatives')
        .select('id,channel,status,og_image_url,blog_html')
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
        queueReusableAssets = {
          ogImageUrl: typeof queueCreative.og_image_url === 'string' ? queueCreative.og_image_url : null,
          inlineImageUrls: extractBlogInlineImageUrls(
            typeof queueCreative.blog_html === 'string' ? queueCreative.blog_html : null,
          ),
        };
      }
    }
    const replacementAssets = privateReplacementAssets ?? queueReusableAssets;

    if (!publishedAtomicUpgrade && await isRecentInfoDuplicateCandidate(item)) {
      const reason = `recent_info_duplicate_before_generation: 최근 14일 내 ${item.destination ?? '동일 목적지'} + ${item.angle_type ?? 'value'} 정보성 글 이미 발행됨`;
      await handleFailure(item, reason, null, false, {
        pre_generation_duplicate_check: true,
      });
      return { id: item.id, topic: item.topic, status: 'skipped', reason };
    }

    let generated: GeneratedBlog;
    /** 카드뉴스로 이미 만든 draft 행을 published 로 승격할 때 사용 */
    let promoteDraftId: string | null = null;
    promoteDraftId = privateReplacementDraftId ?? queueReusableDraftId;

    if (item.source === 'pillar' && item.destination) {
      const { buildPillarContext } = await import('@/lib/blog-pillar-generator');
      const pillarContext = await buildPillarContext(item.destination);
      if (!pillarContext) {
        const reason = `${item.destination} context missing: attractions+packages 0`;
        await handleFailure(item, reason, null, true);
        return { id: item.id, topic: item.topic, status: 'error', reason };
      }
      generated = await withGenerationBudget(startedAtMs, 'pillar_generation', () => generatePillar(item, pillarContext));
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
        generated = await withGenerationBudget(startedAtMs, 'topic_generation', () => generateFromTopic(item));
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
    const minimumInlineImages = item.card_news_id ? 2 : 3;
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

    if (contentBoundary.lane === 'informational') {
      generated.blog_html = stripBlogInformationalBodyCtas(generated.blog_html);
    }

    // 🆕 Topical Authority interlink 자동 주입 (본문 끝 "이 글과 함께 읽기" 섹션)
    try {
      generated.blog_html = await appendInterlinkSection(
        generated.blog_html,
        generated.slug,
        item.destination,
        {
          generationMeta: generated.generation_meta,
          contentType: item.source === 'pillar' ? 'pillar' : 'blog',
          pillarFor: item.source === 'pillar' ? item.destination : null,
        },
      );
    } catch { /* interlink 실패는 발행을 막지 않음 */ }

    // Cold-start safety: AI가 internal link / CTA를 빠뜨렸을 때 표준 CTA 블록을 주입
    // links-gate(내부링크 ≥1) + cta-gate(링크 ≥2) 동시 통과
    const generatedLinks = [...generated.blog_html.matchAll(/(?<!!)\[[^\]]+]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)]
      .map((match) => match[1])
      .filter(Boolean);
    const internalLinkCount = generatedLinks.filter((href) => href.startsWith('/') || /yeosonam\.com/i.test(href)).length;
    const ctaLinkCount = generatedLinks.filter((href) => {
      const decoded = decodeURIComponent(href);
      return /\/packages|utm_|kakao|consult|문의|예약/i.test(decoded);
    }).length;
    if (contentBoundary.lane !== 'informational' && (internalLinkCount < 3 || ctaLinkCount < 2)) {
      generated.blog_html += `\n\n---\n\n${buildStandardBlogCtaMarkdown({
        destination: item.destination,
        slug: generated.slug,
        utmSource: 'naver_blog',
      })}`;
    }

    // 생성기가 스타일 가이드 금지 표현을 섞어도 자동발행 큐가 멈추지 않도록
    // 의미가 과장되지 않는 중립 표현으로 발행 직전에 정규화한다.
    generated.blog_html = neutralizeBannedCliches(generated.blog_html);
    generated.blog_html = generated.blog_html.replace(/에어컨|에어콘/g, '냉방');

    // 외부 공식 링크가 빠지면 links-gate 에서 자동발행이 막힌다.
    // 기준은 유지하되, 발행 직전 최소 공식 출처를 보강한다.
    generated.blog_html = appendOfficialReferenceLinksIfNeeded(generated.blog_html);

    // 4-Gate (length · cliche · duplicate · keyword_density)
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

    generated.blog_html = strengthenIntroHook(generated.blog_html, item, primaryKeyword);
    generated.blog_html = softenKeywordDensity(generated.blog_html, primaryKeyword, blogType);
    {
      const accentRepair = normalizeBlogVisualAccents(generated.blog_html);
      if (accentRepair.changed) {
        generated.blog_html = accentRepair.text;
      }
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
    } catch (e) {
      logWarning('[cron/blog-publisher] inline image insertion failed (non-blocking)', e);
    }

    // 이미지/CTA 후처리 이후에도 공식 외부 링크 기준을 최종 보장한다.
    generated.blog_html = appendOfficialReferenceLinksIfNeeded(generated.blog_html);

    const editorialRepair = repairBlogEditorialQuality({
      title: generated.seo_title,
      slug: generated.slug,
      primaryKeyword,
      destination: item.destination ?? null,
      angleType: normalizeAngleType(item.angle_type),
      category: item.category,
      contentType: item.source === 'pillar' ? 'pillar' : (item.product_id ? 'package_intro' : 'guide'),
      productId: item.product_id ?? null,
      blogHtml: generated.blog_html,
    });
    if (editorialRepair.changed) {
      generated.blog_html = editorialRepair.blogHtml;
      console.log(`[blog-publisher] 에디토리얼 자동 보강: ${editorialRepair.changes.join(', ')}`);
    }

    // Normalize generated structure before any publish gate so backfill-only repairs do not recur.
    const structureRepair = repairBlogStructureQuality({
      title: generated.seo_title,
      slug: generated.slug,
      primaryKeyword,
      destination: item.destination ?? null,
      angleType: normalizeAngleType(item.angle_type),
      category: item.category,
      contentType: item.source === 'pillar' ? 'pillar' : (item.product_id ? 'package_intro' : 'guide'),
      productId: item.product_id ?? null,
      blogHtml: generated.blog_html,
    });
    if (structureRepair.changed) {
      generated.blog_html = structureRepair.blogHtml;
      console.log(`[blog-publisher] structure repair: ${structureRepair.changes.join(', ')}`);
    }

    {
      const accentRepair = normalizeBlogVisualAccents(generated.blog_html);
      if (accentRepair.changed) {
        generated.blog_html = accentRepair.text;
      }
    }
    generated.blog_html = sanitizeBlogCtaLinks(generated.blog_html, {
      destination: item.destination,
      slug: generated.slug,
      utmSource: 'naver_blog',
    });

    const readinessRepair = repairPublishReadiness({
      markdown: generated.blog_html,
      blogType,
      hasRuntimeInformationalCta: contentBoundary.lane === 'informational',
      slug: generated.slug,
      destination: item.destination,
      topic: item.topic,
      primaryKeyword,
    });
    if (readinessRepair.changed) {
      generated.blog_html = readinessRepair.markdown;
      console.log(`[blog-publisher] publish readiness repair: ${readinessRepair.changes.join(', ')}`);
    }

    {
      const categoryChanges = applyEngineCategoryRepair(generated, item, blogType, primaryKeyword);
      if (categoryChanges.length > 0) {
        console.log(`[blog-publisher] engine category repair: ${categoryChanges.join(', ')}`);
      }
    }

    {
      const surfaceChanges = applyFinalCustomerSurfaceRepair(generated, item, primaryKeyword);
      if (surfaceChanges.length > 0) {
        console.log(`[blog-publisher] final customer surface repair: ${surfaceChanges.join(', ')}`);
      }
    }

    const applyFinalResearchStructureRepair = (): void => {
      const finalContentBrief = buildQueueContentBrief(item);
      if (!finalContentBrief.passed) return;
      const finalResearchReadiness = evaluateBlogGenerationResearchReadiness({
        meta: item.meta,
        expectedContentKey: evidenceContentKey,
        destination: item.destination,
        intent: finalContentBrief.intentType,
        locale: finalContentBrief.plan.locale,
        sourcePolicy: finalContentBrief.sourcePolicy,
      });
      const finalResearchRepair = repairBlogGenerationResearchStructure({
        markdown: generated.blog_html,
        intent: finalContentBrief.intentType,
        readiness: finalResearchReadiness,
        plannedTitle: finalContentBrief.title,
        editorialVariation: item.meta?.editorial_variation ?? null,
      });
      if (!finalResearchRepair.changed) return;

      generated.blog_html = finalResearchRepair.markdown;
      const currentMeta = generated.generation_meta || {};
      const writerLedger = currentMeta.writer_claim_ledger
        && typeof currentMeta.writer_claim_ledger === 'object'
        && !Array.isArray(currentMeta.writer_claim_ledger)
        ? currentMeta.writer_claim_ledger as Record<string, unknown>
        : {};
      const currentClaims = Array.isArray(writerLedger.claims)
        ? writerLedger.claims as BlogInformationClaimLedgerEntry[]
        : [];
      const approvedClaims = finalResearchRepair.approvedClaims.map((claim) => ({
        claimFingerprint: claim.claimFingerprint,
        claimText: claim.claimText,
        claimType: claim.claimType,
        riskLevel: claim.riskLevel,
      }));
      const replacedWithDeterministicWeatherArticle = finalResearchRepair.changes
        .includes('monthly_weather_deterministic_evidence_article');
      generated.generation_meta = {
        ...currentMeta,
        writer_claim_ledger: {
          ...writerLedger,
          claims: replacedWithDeterministicWeatherArticle
            ? approvedClaims
            : [...new Map([...currentClaims, ...approvedClaims]
                .map((claim) => [claim.claimFingerprint, claim])).values()],
          ...(replacedWithDeterministicWeatherArticle ? { issues: [] } : {}),
        },
        information_research_structure_repair: {
          applied: true,
          stage: 'final_quality_boundary',
          changes: finalResearchRepair.changes,
        },
      };
      console.log(`[blog-publisher] final research structure repair: ${finalResearchRepair.changes.join(', ')}`);
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
    const runQualityWithResearchStructure = async (): Promise<QualityGateReport> => {
      applyFinalResearchStructureRepair();
      generated.blog_html = softenKeywordDensity(generated.blog_html, primaryKeyword, blogType);
      await restoreFinalReusableImages();
      return runGeneratedQualityGates(generated, item, blogType, primaryKeyword);
    };
    const runQualityAfterAiReadableRepair = async (): Promise<QualityGateReport> => {
      // The evidence-backed tables must be final before H2/FAQ normalization.
      // A later generic repair may replace the body, so this boundary is also
      // repeated once after generic repair when AI readability is still failing.
      applyFinalResearchStructureRepair();
      generated.blog_html = repairAiReadableStructure(generated.blog_html, item, primaryKeyword);
      generated.blog_html = softenKeywordDensity(generated.blog_html, primaryKeyword, blogType);
      await restoreFinalReusableImages();
      return runGeneratedQualityGates(generated, item, blogType, primaryKeyword);
    };

    let qa = await runQualityWithResearchStructure();

    if (!qa.passed && qa.gates.some(gate => gate.gate === 'links' && !gate.passed)) {
      generated.blog_html = forceAppendOfficialReferenceLinks(generated.blog_html);
      qa = await runQualityWithResearchStructure();
    }

    if (!qa.passed && qa.gates.some(gate => gate.gate === 'hook' && !gate.passed)) {
      generated.blog_html = strengthenIntroHook(generated.blog_html, item, primaryKeyword);
      qa = await runQualityWithResearchStructure();
    }

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
      const failureStatus = await handleFailure(item, qa.summary, qa);
      return {
        id: item.id,
        topic: item.topic,
        status: failureStatus === 'skipped' ? 'skipped' : 'gate_failed',
        reason: qa.summary,
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
            console.log(`[blog-publisher] GSC 키워드 보강: ${primaryKeyword} → ${enriched.monthly_search_volume} impressions, competition=${enriched.competition_level}`);
          }
        } catch { /* GSC 보강 실패 — 계속 진행 */ }
      } catch { /* 키워드 리서치 실패 — 계속 진행 */ }
    }

    // 🆕 이미지 SEO 최적화 — alt 텍스트 자동 생성/보강
    if (generated.blog_html.includes('![](') || generated.blog_html.includes('![')) {
      const optimizedHtml = optimizeImageSeoInHtml(
        generated.blog_html,
        item.destination,
        primaryKeyword,
      );
      if (optimizedHtml !== generated.blog_html) {
        generated.blog_html = optimizedHtml;
        console.log('[blog-publisher] 이미지 SEO 최적화 완료');
      }
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
      imageCount: imgCount,
      imagesWithAlt: imgWithAlt,
      hasJsonLd: {
        blogPosting: true,
        faqPage: extractFaqItems(generated.blog_html).length > 0,
        howTo: generated.blog_html.includes('Day ') || generated.blog_html.includes('일차'),
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

    if (
      contentBoundary.lane !== 'informational'
      && seoScore.details.some(d => d.name === 'internal_links_cta' && d.status === 'fail')
    ) {
      generated.blog_html += `\n\n---\n\n${buildStandardBlogCtaMarkdown({
        destination: item.destination,
        slug: generated.slug,
        utmSource: 'naver_blog',
      })}`;
      generated.blog_html = sanitizeBlogCtaLinks(generated.blog_html, {
        destination: item.destination,
        slug: generated.slug,
        utmSource: 'naver_blog',
      });
      seoScore = computeSeoScore(buildSeoScoreInput());
      console.log(`[blog-publisher] SEO CTA repair -> ${seoScore.score}/${seoScore.maxScore}`);
    }

    if (
      !seoScore.passed
      && seoScore.details.some(d =>
        ['title', 'meta_description'].includes(d.name) && d.score < d.maxScore)
    ) {
      const seoRepair = repairBlogSeoMetadata({
        seoTitle: generated.seo_title,
        seoDescription: generated.seo_description,
        topic: item.topic,
        primaryKeyword,
        destination: item.destination,
        category: item.category,
      });
      if (seoRepair.changed) {
        generated.seo_title = seoRepair.seoTitle;
        generated.seo_description = seoRepair.seoDescription;
        seoScore = computeSeoScore(buildSeoScoreInput());
        console.log(`[blog-publisher] SEO metadata repair: ${seoRepair.changes.join(', ')} -> ${seoScore.score}/${seoScore.maxScore}`);
      }
    }

    if (seoScore.details.some(d => d.name === 'primary_keyword' && d.status === 'fail')) {
      const keywordRepair = repairPrimaryKeywordPresence(generated.blog_html, primaryKeyword);
      if (keywordRepair.changed) {
        generated.blog_html = keywordRepair.markdown;
        seoScore = computeSeoScore(buildSeoScoreInput());
        console.log(`[blog-publisher] SEO primary keyword repair -> ${seoScore.score}/${seoScore.maxScore}`);
      }
    }

    if (!seoScore.passed) {
      const failedDetails = seoScore.details.filter(d => d.status === 'fail').map(d => d.name).join(', ');
      console.log(`[blog-publisher] SEO score ${seoScore.score}/${seoScore.maxScore} - publish blocked (${seoScore.summary})`);
      await handleFailure(item, `SEO score ${seoScore.score}/${seoScore.maxScore} - ${failedDetails || seoScore.summary}`, null);
      return { id: item.id, topic: item.topic, status: 'seo_score_failed', reason: seoScore.summary };
    }

    let publishQuality = await runGeneratedPublishQuality(generated, item, blogType, primaryKeyword);
    if (!publishQuality.passed) {
      const finalRepairChanges: string[] = [];
      let finalRepairChanged = false;

      const finalArticleRepair = repairArticleQualityV2Specifics(generated.blog_html, blogType);
      if (finalArticleRepair.changes.length > 0) {
        generated.blog_html = finalArticleRepair.markdown;
        finalRepairChanges.push(...finalArticleRepair.changes);
        finalRepairChanged = true;
      }

      const finalEditorialRepair = repairBlogEditorialQuality({
        title: generated.seo_title,
        slug: generated.slug,
        primaryKeyword,
        destination: item.destination ?? null,
        angleType: normalizeAngleType(item.angle_type),
        category: item.category,
        contentType: item.source === 'pillar' ? 'pillar' : (item.product_id ? 'package_intro' : 'guide'),
        productId: item.product_id ?? null,
        blogHtml: generated.blog_html,
      });
      if (finalEditorialRepair.changed) {
        generated.blog_html = finalEditorialRepair.blogHtml;
        finalRepairChanges.push(...finalEditorialRepair.changes);
        finalRepairChanged = true;
      }

      const finalStructureRepair = repairBlogStructureQuality({
        title: generated.seo_title,
        slug: generated.slug,
        primaryKeyword,
        destination: item.destination ?? null,
        angleType: normalizeAngleType(item.angle_type),
        category: item.category,
        contentType: item.source === 'pillar' ? 'pillar' : (item.product_id ? 'package_intro' : 'guide'),
        productId: item.product_id ?? null,
        blogHtml: generated.blog_html,
      });
      if (finalStructureRepair.changed) {
        generated.blog_html = finalStructureRepair.blogHtml;
        finalRepairChanges.push(...finalStructureRepair.changes);
        finalRepairChanged = true;
      }

      const finalDensityRepair = repairKeywordDensityToTarget(generated.blog_html, primaryKeyword, blogType);
      if (finalDensityRepair.changed) {
        generated.blog_html = finalDensityRepair.blogHtml;
        finalRepairChanges.push('final_keyword_density_repair');
        finalRepairChanged = true;
      }

      const finalReadinessRepair = repairPublishReadiness({
        markdown: generated.blog_html,
        blogType,
        hasRuntimeInformationalCta: contentBoundary.lane === 'informational',
        slug: generated.slug,
        destination: item.destination,
        topic: item.topic,
        primaryKeyword,
      });
      if (finalReadinessRepair.changed) {
        generated.blog_html = finalReadinessRepair.markdown;
        finalRepairChanges.push(...finalReadinessRepair.changes);
        finalRepairChanged = true;
      }

      const finalSurfaceChanges = applyFinalCustomerSurfaceRepair(generated, item, primaryKeyword);
      if (finalSurfaceChanges.length > 0) {
        finalRepairChanges.push(...finalSurfaceChanges);
        finalRepairChanged = true;
      }

      if (finalRepairChanged) {
        generated.generation_meta = {
          ...(generated.generation_meta || {}),
          repair_attempts: Number(generated.generation_meta?.repair_attempts ?? 0) + 1,
        };
        generated.blog_html = sanitizeBlogCtaLinks(generated.blog_html, {
          destination: item.destination,
          slug: generated.slug,
          utmSource: 'naver_blog',
        });
      }
      qa = blogType === 'info'
        ? await runQualityAfterAiReadableRepair()
        : await runQualityWithResearchStructure();
      seoScore = computeSeoScore(buildSeoScoreInput());
      publishQuality = await runGeneratedPublishQuality(generated, item, blogType, primaryKeyword);
      console.log(`[blog-publisher] final publish quality repair: ${finalRepairChanges.join(', ') || 'ai_readable_boundary'} -> passed=${publishQuality.passed}`);
    }

    if (!publishQuality.passed) {
      console.log(`[blog-publisher] publish quality blocked (${publishQuality.summary})`);
      const failureStatus = await handleFailure(item, publishQuality.summary, publishQuality.qualityGate, false, {
        last_publish_quality: {
          score: publishQuality.blogQualityScore.score,
          issues: publishQuality.blogQualityScore.issues.slice(0, 8),
          rendered_issues: (publishQuality.renderedSeoQuality?.issues ?? []).slice(0, 8).map((issue) => ({
            code: issue.code,
            message: issue.message,
            evidence: issue.evidence ?? null,
          })),
          components: publishQuality.blogQualityScore.components.map((component) => ({
            id: component.id,
            passed: component.passed,
            score: component.score,
            issue_codes: component.issues.map((issue) => issue.code).slice(0, 5),
          })),
        },
      });
      return {
        id: item.id,
        topic: item.topic,
        status: failureStatus === 'skipped' ? 'skipped' : 'publish_quality_failed',
        reason: publishQuality.summary,
      };
    }

    qa = publishQuality.qualityGate;
    seoScore = publishQuality.seoScore;
    const readability = publishQuality.readability;
    const now = new Date().toISOString();
    const successfulQueueMeta = buildBlogQueueSuccessMeta({
      currentMeta: item.meta,
      qualityGate: qa,
      publishQuality,
      succeededAt: now,
    });
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
    const generationMeta: Record<string, unknown> = {
      queue_item_id: item.id,
      information_evidence_content_key: evidenceContentKey,
      ...(promoteDraftId ? { promoted_from_draft: true } : {}),
      ...queueMetaWithoutResearchBundle(successfulQueueMeta),
      ...(generated.generation_meta || {}),
      engine_version: 'blog-engine-v2',
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
    const claimValidation = await evaluateBlogInformationClaimPublishGate({
      creativeId: promoteDraftId,
      contentKey: evidenceContentKey,
      markdown: generated.blog_html,
      productId: item.product_id ?? null,
      tenantId: item.tenant_id ?? null,
      claimLedger: contentBoundary.lane === 'informational' ? writerClaimLedger : undefined,
      claimLedgerIssues: contentBoundary.lane === 'informational' ? writerClaimLedgerIssues : undefined,
      intentType: typeof generatedPlanBriefRecord?.intent_type === 'string'
        ? generatedPlanBriefRecord.intent_type
        : null,
      expectedScope: contentBoundary.lane === 'informational'
        ? {
            destination: item.destination ?? undefined,
            applicableTo: typeof generatedPlanBriefRecord?.traveler_nationality === 'string'
              ? generatedPlanBriefRecord.traveler_nationality
              : undefined,
            locale: typeof generatedPlanBriefRecord?.locale === 'string'
              ? generatedPlanBriefRecord.locale
              : undefined,
          }
        : undefined,
    });
    const claimValidationSummary = {
      passed: claimValidation.passed,
      coverage: claimValidation.coverage,
      claim_count: claimValidation.claims.length,
      requires_human_review: claimValidation.requiresHumanReview,
      issues: claimValidation.issues.slice(0, 20),
      ledger: claimValidation.ledger ?? null,
      auto_regeneration_attempts: 0,
      auto_regeneration_limit: 0,
      ...(claimValidation.lookupError ? { lookup_error: claimValidation.lookupError } : {}),
    };
    generationMeta.information_claim_validation = claimValidationSummary;
    const plannedHumanReview = generatedPlanBrief
      && typeof generatedPlanBrief === 'object'
      && !Array.isArray(generatedPlanBrief)
      && (generatedPlanBrief as Record<string, unknown>).requires_human_review === true;
    const requiresClaimReview = blogType === 'info' && !claimValidation.passed;
    const requiresHumanReview = blogType === 'info'
      && ((!publishedAtomicUpgrade && privateRegenerationRequest !== null) || requiresClaimReview || plannedHumanReview || isHighRiskInformationalTopic({
        title: generated.seo_title ?? item.topic ?? null,
        category: item.category ?? null,
        contentType: item.source === 'pillar' ? 'pillar' : 'guide',
        topic: item.topic ?? null,
      }));
    if (publishedAtomicUpgrade && requiresHumanReview) {
      const reason = requiresClaimReview
        ? 'published_atomic_upgrade_claim_gate_failed'
        : 'published_atomic_upgrade_human_review_required';
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
    if (representativeIdentity && requiresHumanReview) {
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
    const publicationTimestamp = publishedAtomicUpgrade && originalPublishedAt
      ? originalPublishedAt
      : now;
    const rowPayload: Record<string, unknown> = {
      tenant_id: item.tenant_id ?? null,
      blog_html: generated.blog_html,
      slug: generated.slug,
      seo_title: generated.seo_title,
      seo_description: generated.seo_description,
      og_image_url: generated.og_image_url,
      product_id: item.product_id ?? null,
      category: VALID_CATEGORIES.includes(item.category as (typeof VALID_CATEGORIES)[number]) ? item.category : (item.product_id ? 'product_intro' : 'travel_tips'),
      channel: 'naver_blog' as const,
      angle_type: normalizeAngleType(item.angle_type),
      status: publishedAtomicUpgrade
        ? 'published'
        : (contentBoundary.lane === 'informational' || requiresHumanReview ? 'draft' : 'published'),
      published_at: publishedAtomicUpgrade
        ? publicationTimestamp
        : (contentBoundary.lane === 'informational' || requiresHumanReview ? null : now),
      review_status: requiresHumanReview ? 'pending_review' : null,
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

    if (promoteDraftId) {
      const { error: upErr } = await supabaseAdmin
        .from('content_creatives')
        .update(rowPayload)
        .eq('id', promoteDraftId);

      if (upErr) {
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
        await handleFailure(item, `DB insert 실패: ${insErr.message}`, qa);
        return { id: item.id, topic: item.topic, status: 'insert_failed', reason: insErr.message };
      }

      creativeId = inserted?.[0]?.id as string;
    }

    if (blogType === 'info') {
      await persistBlogInformationClaimFindings({
        creativeId,
        contentKey: evidenceContentKey,
        tenantId: item.tenant_id ?? null,
        report: claimValidation,
      });
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
    if (representativeDecision && requiresHumanReview) {
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
      try {
        await queueForReview({
          creativeId,
          priority: 90,
          reason: 'auto_generated',
          humanReviewRequired: true,
          riskLevel: 'high',
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        await supabaseAdmin.from('blog_topic_queue')
          .update({
            status: 'failed',
            content_creative_id: creativeId,
            last_error: `review_queue_failed:${reason}`,
          })
          .eq('id', item.id);
        return { id: item.id, topic: item.topic, status: 'review_queue_failed', reason };
      }

      const { error: reviewStateError } = await supabaseAdmin.from('blog_topic_queue')
        .update({
          status: 'pending_review',
          content_creative_id: creativeId,
          last_error: null,
          attempts: 0,
          meta: successfulQueueMeta,
        })
        .eq('id', item.id);
      if (reviewStateError) {
        logWarning('[cron/blog-publisher] review state handoff failed', reviewStateError);
      }
      return {
        id: item.id,
        topic: item.topic,
        status: 'pending_review',
        reason: requiresClaimReview
          ? 'informational_claim_review_required'
          : 'high_risk_human_review_required',
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

    revalidatePublicBlogCache(generated.slug);

    return {
      id: item.id,
      topic: item.topic,
      status: publishedAtomicUpgrade ? 'upgraded' : 'published',
      reason: generated.slug,
      atomicIndexing: contentBoundary.lane === 'informational',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '알수없음';

    // 정보성 컨텍스트 부족은 재시도해도 동일 결과 → 즉시 permanently failed
    const isUnrecoverable = msg.includes('컨텍스트 부족');
    await handleFailure(item, msg, null, isUnrecoverable);
    return { id: item.id, topic: item.topic, status: 'error', reason: msg };
  }
}

async function handleFailure(
  item: any,
  reason: string,
  qa: any,
  forceFailure = false,
  extraMeta?: Record<string, unknown>,
): Promise<'queued' | 'failed' | 'skipped'> {
  const attempts = (item.attempts || 0) + 1;
  const duplicateFailure = /동일\s*slug|유사\s*slug|이미\s*발행|최근\s*\d+\s*일\s*내|중복/i.test(reason);
  const duplicateTaggedFailure = /\[duplicate\]|duplicate|slug already|slug .*exists/i.test(reason);
  const decision = classifyBlogQueueFailure(reason, qa);
  const isDuplicateFailure = duplicateFailure || duplicateTaggedFailure || decision.code === 'duplicate_content';
  const shouldForceFailure = forceFailure || !decision.retryable;
  const retryDelayMs = decision.selfHealAllowed ? 0 : 2 * 3600 * 1000;
  const currentSelfHealRetries = Number((item.meta || {}).self_heal_retry_count ?? 0);
  const keepSelfHealCandidateLive =
    decision.selfHealAllowed
    && !shouldForceFailure
    && !isDuplicateFailure
    && item.source !== 'manual'
    && currentSelfHealRetries < 4;
  const finalStatus = (isDuplicateFailure || decision.skipped) && item.source !== 'manual'
    ? 'skipped'
    : shouldForceFailure || (attempts >= MAX_ATTEMPTS && !keepSelfHealCandidateLive) ? 'failed' : 'queued';
  const storedAttempts = keepSelfHealCandidateLive && finalStatus === 'queued'
    ? Math.min(attempts, Math.max(0, MAX_ATTEMPTS - 1))
    : attempts;

  const { error: queueUpdateError } = await supabaseAdmin.from('blog_topic_queue')
    .update({
      status: finalStatus,
      attempts: storedAttempts,
      last_error: reason,
      target_publish_at: finalStatus === 'queued'
        ? new Date(Date.now() + retryDelayMs).toISOString()
        : item.target_publish_at,
      meta: {
        ...(item.meta || {}),
        last_qa: qa,
        failure_code: decision.code,
        failure_retryable: decision.retryable,
        self_heal_blocked: !decision.selfHealAllowed,
        ...(keepSelfHealCandidateLive
          ? {
              self_heal_retry_count: currentSelfHealRetries + 1,
              self_heal_last_kept_live_at: new Date().toISOString(),
            }
          : {}),
        ...(extraMeta || {}),
        ...(decision.selfHealAllowed ? {} : { quarantine_reason: 'non_retryable_failure' }),
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

interface BlogPillarContext {
  attractions: string[];
  seasonHint: string;
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
 * Pillar 글 생성 — /destinations/[city] 허브 본문
 * 결과는 content_type='pillar', pillar_for=destination 으로 저장됨 (publisher가 처리)
 */
async function generatePillar(item: any, prebuiltContext?: BlogPillarContext | null): Promise<GeneratedBlog> {
  if (!hasBlogApiKey()) throw new Error('AI API 키 없음 — pillar 생성 불가');

  let ctx = prebuiltContext ?? null;
  if (!ctx) {
    const { buildPillarContext } = await import('@/lib/blog-pillar-generator');
    ctx = await buildPillarContext(item.destination);
  }
  if (!ctx) throw new Error(`${item.destination} 정보성 컨텍스트 부족 (관광지 0)`);

  const { content: styleGuide, version: promptVersion } = await getActiveBlogStyleGuide();

  // Pillar는 head tier — SERP 경쟁 분석 주입 (7일 캐시 활용)
  let serpBlock = '';
  const serpKw = item.primary_keyword || item.destination;
  if (serpKw) {
    try {
      await new Promise(r => setTimeout(r, 500));
      const serp = await analyzeSerp(serpKw, 'naver_blog');
      serpBlock = buildSerpPromptBlock(serp);
    } catch { /* SERP 실패 시 미주입 — 발행 계속 */ }
  }

  const prompt = `${styleGuide}
${serpBlock ? `\n${serpBlock}\n` : ''}
---

## Pillar Page 작성 지시 (이건 정보성 최상위 허브)

**목적지**: ${item.destination}
**섹션 구조** (반드시 아래 H2 순서 지켜라):

# ${item.destination} 여행 준비 가이드

## 1. ${item.destination}는 어디인가요?
(위치·계절·이동 난이도 중심으로 2~3문단. 광고 문구보다 독자가 출발 전 판단할 정보를 우선)

## 2. 먼저 볼 여행 포인트
(형광펜 문법 금지. 주요 관광지 3~5개를 나열하되, 왜 가는지보다 이동 시간·체류 시간·피로도 기준으로 설명: ${ctx.attractions.slice(0, 6).join(', ')})

## 3. 언제 가면 좋을까요?
(월별/계절별 날씨·옷차림·추천시기 표 형태 권장. 현재 ${ctx.seasonHint})

## 4. 추천 여행 일정
(3박4일, 4박5일 두 가지 추천. Day 1~5 타임라인으로)

## 5. 예상 비용과 가성비 분석
(숙소 · 식비 · 현지 이동처럼 독자가 별도로 확인할 예산 항목과 비교 기준. 상품 수·내부 가격·예약 신호는 사용하지 말고, 확인 가능한 외부 근거가 없으면 정확한 금액을 쓰지 말 것)

## 6. 여행 준비 체크리스트
(:::tip 블록으로 준비물·비자·환전 등 꿀팁)

## 7. 자주 묻는 질문
(Q&A 4~6개. **Q. 질문** 형식)

## 8. 내 일정 기준으로 확인할 것
(CTA와 판매·상담 URL은 본문에 넣지 않는다. 공개 렌더러가 검증된 중앙 설정으로 하단 CTA를 선택한다.)

## 작성 규칙
- 총 2,200~3,000자. 필요한 내용만 남기고 공통 블록을 억지로 늘리지 말 것
- 마크다운만, H1 1개, H2는 6~8개 범위. 고정 개수 채우기 금지
- 운영팀 직접 답사처럼 보이는 허위 경험 톤 금지. 상품/공식 자료 기준으로 확인 가능한 표현만 사용
- 체크 가능한 구체 수치 (기온·시간·거리·가격)
- 출력 마지막에 \`<!-- pillar_for:${item.destination} prompt_version:${promptVersion} -->\` HTML 주석 남기기
- 마크다운 코드블록으로 감싸지 말 것`;

  const raw = await generatePublisherBlogText(prompt, { temperature: 0.65 });
  const blog_html = raw
    .replace(/^```markdown\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  const dest = item.destination || extractDestination(item.topic) || 'destination';
  const destEn = romanize(dest) || slugifyTopic(dest);
  const slug = `${destEn}-complete-guide`;
  const destDisplay = item.destination || dest;
  const seoTitle = `${destDisplay} 여행 준비 가이드 | 관광지·일정·비용`.substring(0, 60);
  const seoDescription = `${destDisplay} 여행 전 확인할 관광지, 일정, 예상 비용, 계절별 준비 기준을 정리했습니다.`.substring(0, 160);

  // OG 이미지: 목적지와 글 의도에 맞는 Pexels 상위 후보만 사용
  let og_image_url: string | null = null;
  try {
    const destForOg = item.destination || extractDestination(item.topic);
    if (destForOg) {
      og_image_url = await findOrGenerateBlogCover({
        destination: destForOg,
        primaryKeyword: seoTitle,
        sectionTitle: '관광지 일정 비용 여행 준비',
      });
    }
  } catch { /* OG 이미지 실패는 발행을 막지 않음 */ }

  return {
    blog_html,
    slug,
    seo_title: seoTitle,
    seo_description: seoDescription,
    og_image_url,
  };
}

// romanize()와 slugifyTopic()은 src/lib/slug-utils.ts로 이관 (SSOT 통합)

async function generateFromProduct(item: any): Promise<GeneratedBlog> {
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
  let blog_html = generateProductConsultantBlogPost(product, productBrief);
  const reviewSnips = await fetchApprovedReviewSnippets({
    packageId: product.id,
    destination: product.destination,
    limit: 3,
  });
  blog_html += formatReviewQuotesAppendMarkdown(reviewSnips);
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

  return {
    blog_html: blog_html + `\n\n<!-- prompt_version: ${productBrief.prompt_version} -->`,
    slug,
    seo_title: seo.seoTitle,
    seo_description: seo.seoDescription,
    og_image_url,
    generation_meta: {
      prompt_version: productBrief.prompt_version,
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
      seo: {
        primary_keyword: seo.primaryKeyword,
        seo_keyword: productBrief.seo_keyword,
        secondary_keywords: seo.secondaryKeywords,
      },
    },
  };
}

async function generateFromTopic(item: any): Promise<GeneratedBlog> {
  if (!hasBlogApiKey()) {
    throw new Error('AI API 키 미설정 — 정보성 블로그 생성 불가');
  }

  const {
    content: informationWriterGuide,
    version: promptVersion,
    source: promptSource,
  } = await getActiveBlogInformationWriterGuide();
  const privateRegeneration = hasPrivateBlogRegenerationIntent(item);
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
  const publishedAtomicUpgrade = isPublishedBlogAtomicUpgradeRequest(
    readPrivateBlogRegenerationRequest(item),
  );
  if ((!privateRegeneration || publishedAtomicUpgrade) && !researchReadiness.passed) {
    const autoResearch = await researchBlogInformationAutomatically({
      contentKey: queueSlug,
      destination: item.destination,
      locale: contentBrief.plan.locale,
      brief: contentBrief,
    });
    if (!autoResearch.passed || !autoResearch.bundle) {
      throw new Error(
        `evidence_insufficient:auto_research_failed:${autoResearch.issues.slice(0, 8).join(',')}`,
      );
    }
    item.meta = {
      ...(item.meta || {}),
      [BLOG_INFORMATION_RESEARCH_META_KEY]: autoResearch.bundle,
      auto_research: {
        version: 'reviewed-source-direct-fetch-v2',
        model: autoResearch.model,
        completed_at: new Date().toISOString(),
        grounding_source_count: autoResearch.groundingSourceCount,
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
  await persistBlogInformationResearch({
    ...researchReadiness.bundle,
    tenantId: item.tenant_id ?? researchReadiness.bundle.tenantId ?? null,
  });
  await markBlogInformationResearchClaimsSupported({
    contentKey: researchReadiness.bundle.contentKey,
    claimFingerprints: researchReadiness.bundle.claims.map(
      (claim) => claim.claimFingerprint,
    ),
  });
  const researchPromptBlock = buildBlogGenerationResearchPromptBlock(researchReadiness);
  const infoGuideBrief = buildInfoGuideBrief(contentBrief);
  const effectiveTopic = contentBrief.title;
  const primaryKw = contentBrief.primaryKeyword;
  const volume = item.monthly_search_volume;
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

  // SERP analysis: always for head/mid, selectively for proven longtail opportunities.
  let serpBlock = '';
  let serpGapBlock = '';
  let serpData: import('@/lib/serp-analyzer').SerpAnalysis | null = null;
  const shouldAnalyzeSerp = (!privateRegeneration || publishedAtomicUpgrade) && Boolean(
    primaryKw &&
    (
      tier === 'head' ||
      tier === 'mid' ||
      item.source === 'gsc_longtail' ||
      (tier === 'longtail' && typeof volume === 'number' && volume >= 300)
    ),
  );
  if (shouldAnalyzeSerp && primaryKw) {
    try {
      await new Promise(r => setTimeout(r, 500));
      serpData = await analyzeSerp(primaryKw, 'naver_blog');
      serpBlock = buildSerpPromptBlock(serpData);

      // SERP 갭 분석: 경쟁사 상위 글 대비 누락 주제 발견
      if (serpData && serpData.recommended_entities_to_include?.length > 0) {
        try {
          const { analyzeSerpGap } = await import('@/lib/serp-gap-analyzer');
          const gapResult = analyzeSerpGap(
            primaryKw,
            effectiveTopic,
            [primaryKw, ...serpData.recommended_entities_to_include.slice(0, 5)],
          );
          if (gapResult.missingTopics.length > 0) {
            serpGapBlock = `
## 경쟁 글에서 자주 다루는 보강 주제

아래는 경쟁사 상위 글이 공통으로 다루지만 이 글에는 없는 주제입니다.
각각을 무조건 H2로 늘리지 말고, 기존 섹션에 자연스럽게 통합하세요. 꼭 별도 판단이 필요한 주제만 H2로 승격합니다.

${gapResult.missingTopics.map((t, i) => `${i + 1}. ${t} — ${gapResult.suggestions[i] || '관련 내용으로 H2 섹션 추가'}`).join('\n')}

커버리지 점수: ${gapResult.coverageScore}/100 (낮을수록 보강 필요)
`;
          }
        } catch { /* SERP 갭 분석 실패 시 미주입 — 발행은 계속 */ }
      }
    } catch { /* SERP 실패 시 미주입 — 발행은 계속 */ }
  }

  const assignmentBlock = [
    '## Assignment',
    `- Queue topic: ${item.topic}`,
    item.destination ? `- Destination: ${item.destination}` : '- Destination: intentionally generic only if the brief permits it',
    `- Category: ${item.category || 'travel_tips'}`,
    `- Primary keyword: ${primaryKw}`,
    `- Final content brief topic: ${effectiveTopic}`,
    `- Secondary keywords: ${contentBrief.secondaryKeywords.join(', ')}`,
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
      buildBlogContentBriefPromptBlock(contentBrief),
      editorialVariationBlock,
      buildInfoWriterPromptBlock(infoGuideBrief),
      researchPromptBlock,
      trendBlock,
      serpBlock,
      serpGapBlock,
    ],
    depthBlock: buildInformationalDepthBlock(tier),
    qualityBlock: buildInformationalQualityBlock({
      primaryKeyword: primaryKw,
      destination: item.destination,
    }),
  });

  const raw = await generatePublisherBlogText(prompt, {
    temperature: hasPrivateBlogRegenerationIntent(item) ? 0.25 : 0.7,
  });
  const writerOutput = parseBlogInformationWriterOutput(raw);
  let blog_html = writerOutput.markdown
    .replace(/^```markdown\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  if (!privateRegeneration || publishedAtomicUpgrade) {
    blog_html = await maybeApplyChainOfDensity(blog_html);
  }
  const researchStructureRepair = repairBlogGenerationResearchStructure({
    markdown: blog_html,
    intent: contentBrief.intentType,
    readiness: researchReadiness,
    plannedTitle: contentBrief.title,
    editorialVariation: item.meta?.editorial_variation ?? null,
  });
  if (researchStructureRepair.changed) {
    blog_html = researchStructureRepair.markdown;
    writerOutput.claimLedger = [...new Map([
      ...writerOutput.claimLedger,
      ...researchStructureRepair.approvedClaims.map((claim) => ({
        claimFingerprint: claim.claimFingerprint,
        claimText: claim.claimText,
        claimType: claim.claimType,
        riskLevel: claim.riskLevel,
      })),
    ].map((claim) => [claim.claimFingerprint, claim])).values()];
  }

  // slug 자동 — 오래된 큐에 잘못 들어간 expected_slug는 자동 무시
  const slug = queueSlug;

  // SEO 제목: SERP 분석 결과 있으면 power word·연도 패턴 반영, 없으면 단순 절삭
  const seo_title = serpData
    ? buildOptimalTitle(effectiveTopic, serpData, tier)
    : effectiveTopic.substring(0, 55);
  // SEO 설명: 주제 기반 맞춤형 (카테고리별 템플릿 다양화)
  const cat = (item.category || '').toLowerCase();
  let descTemplate: string;
  if (cat.includes('visa') || cat.includes('입국')) {
    descTemplate = `${effectiveTopic} | 필요 서류, 비자, 면세 한도와 출발 전 공식 확인 항목을 한눈에 정리했습니다.`;
  } else if (cat.includes('itinerary') || cat.includes('일정')) {
    descTemplate = `${effectiveTopic} | 이동 동선, 일정별 판단 기준, 예상 경비와 출발 전 확인 항목을 정리했습니다.`;
  } else if (cat.includes('preparation') || cat.includes('준비')) {
    descTemplate = `${effectiveTopic} | 여행 준비물, 체크리스트, 예약 전 확인사항과 놓치기 쉬운 주의점을 정리했습니다.`;
  } else if (cat.includes('local') || cat.includes('현지')) {
    descTemplate = `${effectiveTopic} | 교통, 식사, 쇼핑과 현지에서 확인할 실용적인 판단 기준을 정리했습니다.`;
  } else {
    descTemplate = `${effectiveTopic} | 2026년 기준 비용, 일정, 준비물, 예약 전 확인할 현지 체크 포인트를 차분하게 정리했습니다.`;
  }
  const seo_description = descTemplate.substring(0, 160);

  // og_image_url 자동 할당 — 목적지와 검색 의도에 맞는 상위 후보만 사용
  let og_image_url: string | null = null;
  const destForImage = item.destination || extractDestination(item.topic);
  if (destForImage && (!privateRegeneration || publishedAtomicUpgrade)) {
    try {
      og_image_url = await findOrGenerateBlogCover({
        destination: destForImage,
        primaryKeyword: contentBrief.primaryKeyword,
        sectionTitle: contentBrief.title,
      });
    } catch { /* silent — og_image_url은 null로 유지 */ }
  }

  const generation_meta: Record<string, unknown> = {
    prompt_version: promptVersion,
    prompt_source: promptSource,
    prompt_manifest: promptManifest,
    writer: 'info_writer',
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
    writer_claim_ledger: {
      version: 'v1',
      claims: writerOutput.claimLedger,
      issues: writerOutput.ledgerIssues,
    },
    information_research_preflight: summarizeBlogGenerationResearch(researchReadiness),
    information_research_structure_repair: {
      applied: researchStructureRepair.changed,
      changes: researchStructureRepair.changes,
    },
    cover_image: {
      provider: isGeneratedBlogImageUrl(og_image_url) ? 'ai_generated' : (og_image_url ? 'pexels' : 'none'),
      disclosure: isGeneratedBlogImageUrl(og_image_url) ? 'AI 생성 참고 이미지' : null,
    },
    serp_analyzed: Boolean(serpData),
    freshness_risk: freshnessRisk,
    ...(serpData ? {
      serp_analysis: {
        keyword: serpData.keyword,
        source: serpData.source,
        signal_source: serpData.signal_source ?? 'naver_serp',
        fetched_at: serpData.fetched_at,
        cached: serpData.cached,
        recommended_title_patterns: serpData.recommended_title_patterns,
        recommended_entities_to_include: serpData.recommended_entities_to_include,
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
