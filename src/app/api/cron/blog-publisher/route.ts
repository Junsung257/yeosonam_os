import { NextRequest, NextResponse } from 'next/server';
import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import { logWarning } from '@/lib/sentry-logger';
import { revalidatePath, revalidateTag } from 'next/cache';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { BANNED_CLICHES, runQualityGates, type QualityGateReport } from '@/lib/blog-quality-gate';
import { generateBlogText, hasBlogApiKey } from '@/lib/blog-ai-caller';
import { generateBlogPost, generateBlogSeo, ANGLE_PRESETS, type AngleType } from '@/lib/content-generator';
import { notifyIndexing } from '@/lib/indexing';
import { withCronLogging } from '@/lib/cron-observability';
import { analyzeSerp, buildSerpPromptBlock, buildOptimalTitle } from '@/lib/serp-analyzer';
import { researchKeyword, enrichWithGscData } from '@/lib/keyword-research';
import { appendInterlinkSection } from '@/lib/topical-authority';
import { computeReadability } from '@/lib/blog-readability';
import { computeSeoScore } from '@/lib/blog-seo-scorer';
import { repairBlogSeoMetadata } from '@/lib/blog-seo-repair';
import { ensureBlogInlineImages } from '@/lib/blog-inline-images';
import { optimizeImageSeoInHtml } from '@/lib/blog-image-seo';
import { indexBlog } from '@/lib/jarvis/rag/indexer';
import { parsePublisherBridgeResponse } from '@/lib/blog-card-news-bridge';
import { buildStandardBlogCtaMarkdown } from '@/lib/blog-cta';
import { appendOfficialReferenceLinksIfNeeded, forceAppendOfficialReferenceLinks } from '@/lib/blog-official-links';
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
import { getRandomPexelsPhoto, destToEnKeyword, isPexelsConfigured } from '@/lib/pexels';
import { buildFreshnessPromptBlock, classifyBlogFreshnessRisk } from '@/lib/blog-freshness-risk';
import { buildOriginalityPromptBlock, fetchBlogOriginalitySignals } from '@/lib/blog-originality-signals';
import { buildBlogIntentPromptContract, classifyBlogIntent } from '@/lib/blog-content-intent';
import {
  repairBlogEditorialQuality,
  repairBlogStructureQuality,
  repairKeywordDensityToTarget,
} from '@/lib/blog-editorial-repair';
import { normalizeDailyPostTarget } from '@/lib/blog-scheduler';
import {
  buildGoogleVisibilitySnapshot,
  buildNaverVisibilitySnapshot,
  recordBlogVisibilitySnapshot,
} from '@/lib/blog-visibility-snapshots';
import { classifyBlogQueueFailure } from '@/lib/blog-queue-failure-policy';

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
 *         - product      → content-generator.generateBlogPost (템플릿)
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

const MAX_BATCH = 4; // daily quality quota: 3-4 posts/day, never bulk-publish beyond the target.
const CLAIM_POOL_MULTIPLIER = 5;
const MAX_CANDIDATE_POOL = 20;
const MAX_QUALITY_REPAIR_ROUNDS = 3;
const MAX_ATTEMPTS = 2;
const MAX_EXEC_MS = 240_000; // 240s — Vercel 300s 제한보다 여유 있게

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
let blogStyleGuideCache: { content: string; version: string } | null = null;

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
  '만끽': '즐기기',
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
  return /^[a-z0-9][a-z0-9-]{2,79}$/.test(slug)
    && /[a-z]/.test(slug)
    && !slug.endsWith('-')
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
  const fallback = [destination || 'travel', categorySlugSuffix(item), idPart].filter(Boolean).join('-');
  return isUsableBlogSlug(fallback) ? fallback : `travel-guide-${idPart || 'auto'}`;
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
  return typeof value === 'string' && value in ANGLE_PRESETS ? value as AngleType : 'value';
}

function strengthenIntroHook(markdown: string, item: any, primaryKeyword?: string | null): string {
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
  const lines = markdown.split('\n');
  const h1Index = lines.findIndex(line => /^#\s+\S/.test(line.trim()));
  const definition = `${keyword}은 여행 전 비용, 이동 시간, 현지 결제 조건을 먼저 확인해야 시행착오를 줄일 수 있는 핵심 준비 항목입니다.`;
  if (h1Index >= 0) {
    lines.splice(h1Index + 1, 0, '', definition);
  }
  let repaired = lines.join('\n');

  if (!/^##\s+.+[?？]\s*$/m.test(repaired)) {
    repaired += `\n\n## ${keyword}에서 가장 먼저 확인할 것은?\n\n1. 현지 결제 가능 수단\n2. 공항·호텔 이동 시간\n3. 예약 전 추가 비용 여부\n`;
  }

  if (!/##\s*(자주\s*묻는\s*질문|FAQ|Q\s*&\s*A|자주\s*하는\s*질문)/i.test(repaired)) {
    repaired += `\n\n## 자주 묻는 질문\n\nQ. ${keyword}은 언제 준비하면 좋나요?\nA. 출발 2주 전에는 결제 수단, 여권 정보, 이동 동선을 함께 확인하는 편이 좋습니다.\n\nQ. 현지에서 바로 바꿔도 되나요?\nA. 가능하지만 공항·호텔 환율 차이가 있을 수 있어 최소 2곳 이상 비교하는 것이 안전합니다.\n\nQ. 여소남 상담은 어떤 점을 확인해주나요?\nA. 상품 포함사항, 일정 동선, 현지 추가 비용을 예약 전 기준으로 함께 점검합니다.\n`;
  }

  return repaired;
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
    angle_type: item.angle_type,
    blog_type: blogType,
    primary_keyword: primaryKeyword,
    category: item.category,
    content_type: item.source === 'pillar' ? 'pillar' : (item.product_id ? 'package_intro' : 'guide'),
    product_id: item.product_id ?? null,
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

    if (failed.has('structure_integrity') || failed.has('intent_quality') || failed.has('render_integrity')) {
      const structureRepair = repairBlogStructureQuality({
        title: generated.seo_title,
        slug: generated.slug,
        primaryKeyword,
        angleType: item.angle_type,
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

    if (!changed) break;

    generated.blog_html = softenKeywordDensity(generated.blog_html, primaryKeyword, blogType);
    qa = await runGeneratedQualityGates(generated, item, blogType, primaryKeyword);
    console.log(`[blog-publisher] quality repair round ${round}: ${changes.join(', ')} -> passed=${qa.passed}`);
  }

  return qa;
}

async function getActiveBlogStyleGuide(): Promise<{ content: string; version: string }> {
  if (blogStyleGuideCache) return blogStyleGuideCache;
  const { data: promptRow } = await supabaseAdmin
    .from('prompt_versions')
    .select('content, version')
    .eq('domain', 'blog_style_guide')
    .eq('is_active', true)
    .limit(1);
  blogStyleGuideCache = {
    content: promptRow?.[0]?.content || '',
    version: promptRow?.[0]?.version || 'v1.0',
  };
  return blogStyleGuideCache;
}

async function runBlogPublisher(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }

  if (!isSupabaseConfigured) {
    return { skipped: true, reason: 'Supabase 미설정', errors: [] as string[] };
  }

  const results: Array<{ id: string; topic: string; status: string; reason?: string }> = [];
  const errors: string[] = [];
  const startTime = Date.now();

  try {
    blogStyleGuideCache = null;
    const targetPostsToday = normalizeDailyPostTarget(process.env.BLOG_DAILY_PUBLISH_TARGET);
    const todayQuota = await getTodayBlogPublishCount();
    const remainingToday = Math.max(0, targetPostsToday - todayQuota.count);
    if (remainingToday <= 0) {
      return {
        processed: 0,
        published: 0,
        skipped: true,
        reason: 'daily_publish_quota_reached',
        dailyQuota: {
          day: todayQuota.dayKey,
          target: targetPostsToday,
          alreadyPublished: todayQuota.count,
          remaining: remainingToday,
        },
        errors,
      };
    }

    // 원자적 큐 클레임 — FOR UPDATE SKIP LOCKED 로 중복 발행 방지
    const claimLimit = Math.min(
      MAX_CANDIDATE_POOL,
      Math.max(MAX_BATCH, remainingToday * CLAIM_POOL_MULTIPLIER),
    );
    const { data: queue } = await supabaseAdmin.rpc('claim_queue_items', {
      limit_rows: claimLimit,
    });

    if (!queue || queue.length === 0) {
      return {
        processed: 0,
        message: '발행할 토픽 없음',
        dailyQuota: {
          day: todayQuota.dayKey,
          target: targetPostsToday,
          alreadyPublished: todayQuota.count,
          remaining: remainingToday,
        },
        errors,
      };
    }

    const cardNewsIds = [...new Set(queue.map((q: { card_news_id?: string | null }) => q.card_news_id).filter(Boolean))] as string[];
    const eligibleByCardNewsId =
      cardNewsIds.length > 0 ? await getEarliestBlogPublishEligibleMsBatch(cardNewsIds) : new Map<string, number>();

    let publishedThisRun = 0;
    for (const item of queue) {
      if (publishedThisRun >= remainingToday) {
        break;
      }
      // 남은 시간 체크 — 30초 미만이면 중단
      const elapsed = Date.now() - startTime;
      const remaining = MAX_EXEC_MS - elapsed;
      if (remaining < 30000) {
        console.log(`[blog-publisher] 남은 시간 ${Math.round(remaining / 1000)}초 미만 — 중단`);
        break;
      }
      try {
        const r = await processQueueItem(item, eligibleByCardNewsId);
        results.push(r);
        if (r.status === 'published') {
          publishedThisRun += 1;
        }
        if (r.status !== 'published' && r.status !== 'done' && r.status !== 'deferred_buffer' && r.status !== 'skipped') {
          errors.push(`${r.id} (${r.topic}): ${r.reason ?? r.status}`);
        }
      } catch (err) {
        errors.push(`${item.id} fatal: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com';
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

    // notifyIndexing + revalidatePath — allSettled로 모든 결과를 기다림
    const indexingPromises: Promise<void>[] = [];
    for (const r of results) {
      if (r.status === 'published' && r.reason) {
        const slug = r.reason;
        const contentCreativeId = creativeIdBySlug.get(slug) ?? null;
        indexingPromises.push(
          Promise.resolve(
            notifyIndexing(`${baseUrl}/blog/${slug}`, baseUrl)
              .then(async (report) => {
                await supabaseAdmin.from('indexing_reports').insert({
                  url: report.url,
                  content_creative_id: contentCreativeId,
                  google_status: report.google,
                  google_error: report.google_error ?? null,
                  indexnow_status: report.indexnow,
                  indexnow_error: report.indexnow_error ?? null,
                  sitemap_pings: report.sitemap_pings,
                  duration_ms: report.duration_ms,
                });
                const naverIndexNowOk = report.sitemap_pings.some(
                  (ping) => ping.provider === 'naver_indexnow' && ping.ok === true,
                );
                await Promise.allSettled([
                  recordBlogVisibilitySnapshot(
                    supabaseAdmin,
                    buildGoogleVisibilitySnapshot({
                      slug,
                      url: report.url,
                      requestStatus: report.google === 'failed' ? 'request_failed' : 'requested',
                      evidence: {
                        request_status: report.google,
                        request_error: report.google_error ?? null,
                        sitemap_pings: report.sitemap_pings,
                      },
                      source: 'publish_indexing_request',
                    }),
                  ),
                  recordBlogVisibilitySnapshot(
                    supabaseAdmin,
                    buildNaverVisibilitySnapshot({
                      slug,
                      url: report.url,
                      indexNowOk: naverIndexNowOk,
                      evidence: {
                        request_status: report.indexnow,
                        request_error: report.indexnow_error ?? null,
                        sitemap_pings: report.sitemap_pings,
                      },
                      source: 'publish_indexnow_request',
                    }),
                  ),
                ]);
              })
              .catch(() => { /* noop — 색인 실패는 발행을 막지 않음 */ }),
          ),
        );
        try { revalidatePath(`/blog/${slug}`); } catch { /* noop */ }
      }
    }
    const indexingResults = await Promise.allSettled(indexingPromises);
    const indexingFailed = indexingResults.filter(r => r.status === 'rejected').length;

    if (publishedSlugs.length > 0) {
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
    try { revalidatePath('/blog'); } catch { /* noop */ }
    try { revalidateTag('blog-list'); } catch { /* noop */ }

    return {
      processed: results.length,
      published: results.filter(r => r.status === 'published').length,
      dailyQuota: {
        day: todayQuota.dayKey,
        target: targetPostsToday,
        alreadyPublishedBeforeRun: todayQuota.count,
        remainingBeforeRun: remainingToday,
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

export const GET = withCronLogging('blog-publisher', runBlogPublisher);

async function processQueueItem(
  item: any,
  eligibleByCardNewsId: Map<string, number>,
): Promise<{ id: string; topic: string; status: string; reason?: string }> {
  // 동시성 방지 — generating 락
  const { error: lockErr } = await supabaseAdmin
    .from('blog_topic_queue')
    .update({ status: 'generating', attempts: (item.attempts || 0) + 1 })
    .eq('id', item.id)
    .eq('status', 'queued');

  if (lockErr) {
    return { id: item.id, topic: item.topic, status: 'lock_failed', reason: lockErr.message };
  }

  try {
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
    //   3) product_id 있음 → generateBlogPost (템플릿)
    //   4) 나머지 → Gemini 정보성 글
    let generated: GeneratedBlog;
    /** 카드뉴스로 이미 만든 draft 행을 published 로 승격할 때 사용 */
    let promoteDraftId: string | null = null;

    if (item.source === 'pillar' && item.destination) {
      const { buildPillarContext } = await import('@/lib/blog-pillar-generator');
      const pillarContext = await buildPillarContext(item.destination);
      if (!pillarContext) {
        const reason = `${item.destination} context missing: attractions+packages 0`;
        await handleFailure(item, reason, null, true);
        return { id: item.id, topic: item.topic, status: 'error', reason };
      }
      generated = await generatePillar(item, pillarContext);
    } else if (item.card_news_id) {
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
        generated = await generateFromCardNews(item, eligibleByCardNewsId);
      }
    } else if (item.source === 'product' && item.product_id) {
      generated = await generateFromProduct(item);
    } else {
      generated = await generateFromTopic(item);
    }

    const slugNormalized = normalizeGeneratedSlug(generated, item);
    if (slugNormalized && promoteDraftId) {
      await supabaseAdmin
        .from('content_creatives')
        .update({
          slug: generated.slug,
          updated_at: new Date().toISOString(),
        })
        .eq('id', promoteDraftId);
    }

    // 🆕 Topical Authority interlink 자동 주입 (본문 끝 "이 글과 함께 읽기" 섹션)
    try {
      generated.blog_html = await appendInterlinkSection(generated.blog_html, generated.slug, item.destination);
    } catch { /* interlink 실패는 발행을 막지 않음 */ }

    // Cold-start safety: AI가 internal link / CTA를 빠뜨렸을 때 표준 CTA 블록을 주입
    // links-gate(내부링크 ≥1) + cta-gate(링크 ≥2) 동시 통과
    const internalLinkCount = (generated.blog_html.match(/\[([^\]]+)\]\(\/[^)]*\)/g) || []).length;
    const mdLinkCount = (generated.blog_html.match(/\[([^\]]+)\]\((?:\/|https?:\/\/)[^)]*\)/g) || []).length;
    if (internalLinkCount < 1 || mdLinkCount < 2) {
      generated.blog_html += `\n\n---\n\n${buildStandardBlogCtaMarkdown({
        destination: item.destination,
        slug: generated.slug,
        utmSource: 'naver_blog',
      })}`;
    }

    // 생성기가 스타일 가이드 금지 표현을 섞어도 자동발행 큐가 멈추지 않도록
    // 의미가 과장되지 않는 중립 표현으로 발행 직전에 정규화한다.
    generated.blog_html = neutralizeBannedCliches(generated.blog_html);

    // 외부 공식 링크가 빠지면 links-gate 에서 자동발행이 막힌다.
    // 기준은 유지하되, 발행 직전 최소 공식 출처를 보강한다.
    generated.blog_html = appendOfficialReferenceLinksIfNeeded(generated.blog_html);

    // 4-Gate (length · cliche · duplicate · keyword_density)
    const blogType: 'product' | 'info' = item.product_id ? 'product' : 'info';
    // Pillar posts: skip keyword density (destination name dominates by design)
    // Compound destinations (X/Y/Z): use only first city to avoid inflated density
    const rawKeyword = item.source === 'pillar'
      ? null
      : (item.primary_keyword
          || item.destination
          || (item.meta?.keywords as string[] | undefined)?.[0]
          || null);
    const primaryKeyword = rawKeyword?.includes('/')
      ? rawKeyword.split('/')[0].trim()
      : rawKeyword;

    generated.blog_html = strengthenIntroHook(generated.blog_html, item, primaryKeyword);
    generated.blog_html = softenKeywordDensity(generated.blog_html, primaryKeyword, blogType);

    // 일반 정보성/상품 글도 카드뉴스 경로처럼 본문 안에 사진을 보유하게 만든다.
    // AI가 이미 섹션 이미지를 넣은 경우에는 건드리지 않고, 부족분만 Pexels/OG 이미지로 보강한다.
    try {
      const imageResult = await ensureBlogInlineImages({
        markdown: generated.blog_html,
        destination: item.destination,
        primaryKeyword,
        ogImageUrl: generated.og_image_url,
        minImages: item.card_news_id ? 2 : 3,
        maxImages: item.card_news_id ? 3 : 4,
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
      angleType: item.angle_type,
      category: item.category,
      contentType: item.source === 'pillar' ? 'pillar' : (item.product_id ? 'package_intro' : 'guide'),
      productId: item.product_id ?? null,
      blogHtml: generated.blog_html,
    });
    if (editorialRepair.changed) {
      generated.blog_html = editorialRepair.blogHtml;
      console.log(`[blog-publisher] 에디토리얼 자동 보강: ${editorialRepair.changes.join(', ')}`);
    }

    // 🆕 가독성 점수 계산 (한국어 휴리스틱)
    const readability = computeReadability(generated.blog_html);

    let qa = await runGeneratedQualityGates(generated, item, blogType, primaryKeyword);

    if (!qa.passed && qa.gates.some(gate => gate.gate === 'links' && !gate.passed)) {
      generated.blog_html = forceAppendOfficialReferenceLinks(generated.blog_html);
      qa = await runQualityGates({
        blog_html: generated.blog_html,
        slug: generated.slug,
        destination: item.destination,
        angle_type: item.angle_type,
        blog_type: blogType,
        primary_keyword: primaryKeyword,
        category: item.category,
        content_type: item.source === 'pillar' ? 'pillar' : (item.product_id ? 'package_intro' : 'guide'),
        product_id: item.product_id ?? null,
      });
    }

    if (!qa.passed && qa.gates.some(gate => gate.gate === 'hook' && !gate.passed)) {
      generated.blog_html = strengthenIntroHook(generated.blog_html, item, primaryKeyword);
      qa = await runQualityGates({
        blog_html: generated.blog_html,
        slug: generated.slug,
        destination: item.destination,
        angle_type: item.angle_type,
        blog_type: blogType,
        primary_keyword: primaryKeyword,
        category: item.category,
        content_type: item.source === 'pillar' ? 'pillar' : (item.product_id ? 'package_intro' : 'guide'),
        product_id: item.product_id ?? null,
      });
    }

    if (!qa.passed && qa.gates.some(gate => gate.gate === 'ai_readability' && !gate.passed)) {
      generated.blog_html = repairAiReadableStructure(generated.blog_html, item, primaryKeyword);
      generated.blog_html = softenKeywordDensity(generated.blog_html, primaryKeyword, blogType);
      qa = await runQualityGates({
        blog_html: generated.blog_html,
        slug: generated.slug,
        destination: item.destination,
        angle_type: item.angle_type,
        blog_type: blogType,
        primary_keyword: primaryKeyword,
        category: item.category,
        content_type: item.source === 'pillar' ? 'pillar' : (item.product_id ? 'package_intro' : 'guide'),
        product_id: item.product_id ?? null,
      });
    }

    if (!qa.passed) {
      qa = await repairFailedQualityGates(generated, item, qa, blogType, primaryKeyword);
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
    if (primaryKeyword) {
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
      imageCount: imgCount,
      imagesWithAlt: imgWithAlt,
      hasJsonLd: {
        blogPosting: true,
        faqPage: generated.blog_html.includes('**Q.') || generated.blog_html.includes('Q. '),
        howTo: generated.blog_html.includes('Day ') || generated.blog_html.includes('일차'),
        breadcrumbList: true,
      },
    });
    let seoScore = computeSeoScore(buildSeoScoreInput());

    if (!seoScore.passed && seoScore.details.some(d => d.status === 'fail' && ['title', 'meta_description'].includes(d.name))) {
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

    if (!seoScore.passed) {
      const failedDetails = seoScore.details.filter(d => d.status === 'fail').map(d => d.name).join(', ');
      console.log(`[blog-publisher] SEO score ${seoScore.score}/${seoScore.maxScore} - publish blocked (${seoScore.summary})`);
      await handleFailure(item, `SEO score ${seoScore.score}/${seoScore.maxScore} - ${failedDetails || seoScore.summary}`, null);
      return { id: item.id, topic: item.topic, status: 'seo_score_failed', reason: seoScore.summary };
    }

    const now = new Date().toISOString();
    const generationMeta: Record<string, unknown> = {
      queue_item_id: item.id,
      ...(promoteDraftId ? { promoted_from_draft: true } : {}),
      ...(item.meta || {}),
      ...(generated.generation_meta || {}),
    };
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
      angle_type: item.angle_type || 'value',
      status: 'published' as const,
      published_at: now,
      quality_gate: qa,
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

    if (item.card_news_id && creativeId && !promoteDraftId) {
      await supabaseAdmin
        .from('card_news')
        .update({ linked_blog_id: creativeId, updated_at: now })
        .eq('id', item.card_news_id);
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
      })
      .eq('id', item.id);

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com';
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

    try { revalidatePath(`/blog/${generated.slug}`); } catch { /* noop */ }

    return { id: item.id, topic: item.topic, status: 'published', reason: generated.slug };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '알수없음';

    // 컨텍스트 부족(관광지+상품 0)은 재시도해도 동일 결과 → 즉시 permanently failed
    const isUnrecoverable = msg.includes('컨텍스트 부족');
    await handleFailure(item, msg, null, isUnrecoverable);
    return { id: item.id, topic: item.topic, status: 'error', reason: msg };
  }
}

async function handleFailure(item: any, reason: string, qa: any, forceFailure = false): Promise<'queued' | 'failed' | 'skipped'> {
  const attempts = (item.attempts || 0) + 1;
  const duplicateFailure = /동일 slug|유사 slug|이미 발행됨|최근 \d+일 내/i.test(reason);
  const duplicateTaggedFailure = /\[duplicate\]|duplicate|slug already|slug .*exists/i.test(reason);
  const decision = classifyBlogQueueFailure(reason, qa);
  const isDuplicateFailure = duplicateFailure || duplicateTaggedFailure || decision.code === 'duplicate_content';
  const shouldForceFailure = forceFailure || !decision.retryable;
  const finalStatus = (isDuplicateFailure || decision.skipped) && item.source !== 'manual'
    ? 'skipped'
    : shouldForceFailure || attempts >= MAX_ATTEMPTS ? 'failed' : 'queued';

  await supabaseAdmin.from('blog_topic_queue')
    .update({
      status: finalStatus,
      attempts,
      last_error: reason,
      // 재시도 시 2시간 뒤로 미룸
      target_publish_at: finalStatus === 'queued'
        ? new Date(Date.now() + 2 * 3600 * 1000).toISOString()
        : item.target_publish_at,
      meta: {
        ...(item.meta || {}),
        last_qa: qa,
        failure_code: decision.code,
        failure_retryable: decision.retryable,
        self_heal_blocked: !decision.selfHealAllowed,
        ...(decision.selfHealAllowed ? {} : { quarantine_reason: 'non_retryable_failure' }),
        last_failed_at: new Date().toISOString(),
        ...(isDuplicateFailure ? { skipped_duplicate: true } : {}),
      },
    })
    .eq('id', item.id);

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
  packageSummary: string;
  priceRange: string;
  airlines: string[];
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

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  const cronSecret = getSecret('CRON_SECRET');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cronSecret) headers.Authorization = `Bearer ${cronSecret}`;

  const res = await fetch(`${baseUrl}/api/blog/from-card-news`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      card_news_id: item.card_news_id,
      slide_image_urls: slideUrls,
      publisher_bridge: true,
    }),
  });

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
  if (!ctx) throw new Error(`${item.destination} 컨텍스트 부족 (관광지+상품 0)`);

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

# ${item.destination} 여행 완벽 가이드

## 1. ${item.destination}는 어디인가요?
(위치·역사·문화적 특징 3~4문단, 여소남 큐레이터 관점)

## 2. ${item.destination}의 매력 포인트
(여기서 ==핵심 문장== 하이라이트 2개 필수. 주요 관광지 3~5개 언급: ${ctx.attractions.slice(0, 6).join(', ')})

## 3. 언제 가면 좋을까요?
(월별/계절별 날씨·옷차림·추천시기 표 형태 권장. 현재 ${ctx.seasonHint})

## 4. 추천 여행 일정
(3박4일, 4박5일 두 가지 추천. Day 1~5 타임라인으로)

## 5. 예상 비용과 가성비 분석
(항공 ${ctx.airlines.join(', ')} · 숙소 · 식비 · 현지 이동 · 전체 예산 가이드)
여소남 엄선 패키지 ${ctx.packageSummary}

## 6. 여행 준비 체크리스트
(:::tip 블록으로 준비물·비자·환전 등 꿀팁)

## 7. 자주 묻는 질문
(Q&A 4~6개. **Q. 질문** 형식)

## 8. 여소남과 함께 떠나는 ${item.destination}
(CTA: 카카오톡 상담 + 상품 리스트 링크)

## 작성 규칙
- 총 2,500~3,500자 (장문 Pillar)
- 마크다운만, H1 1개, H2 8개 고정
- 운영팀 직접 답사 톤 ("여소남이 검토한 결과", "운영팀이 확인한 일정")
- 체크 가능한 구체 수치 (기온·시간·거리·가격)
- 출력 마지막에 \`<!-- pillar_for:${item.destination} prompt_version:${promptVersion} -->\` HTML 주석 남기기
- 마크다운 코드블록으로 감싸지 말 것`;

  const raw = await generateBlogText(prompt, { temperature: 0.65 });
  const blog_html = raw
    .replace(/^```markdown\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  const dest = item.destination || extractDestination(item.topic) || 'destination';
  const destEn = romanize(dest) || slugifyTopic(dest);
  const slug = `${destEn}-complete-guide`;
  const destDisplay = item.destination || dest;
  const seoTitle = `${destDisplay} 여행 완벽 가이드 | 관광지·일정·비용`.substring(0, 60);
  const seoDescription = `${destDisplay} 여행의 모든 것 — 운영팀 검증 관광지, 추천 일정, 예상 비용, 계절별 팁까지 정리한 완벽 가이드.`.substring(0, 160);

  // OG 이미지: Pexels에서 destination 기반 이미지 할당
  let og_image_url: string | null = null;
  try {
    const destForOg = item.destination || extractDestination(item.topic);
    if (destForOg && isPexelsConfigured()) {
      const kw = destToEnKeyword(destForOg);
      const photo = await getRandomPexelsPhoto(kw);
      if (photo?.src?.medium) og_image_url = photo.src.medium;
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
  const angle = normalizeAngleType(item.angle_type);

  // 관광지 매칭 (옵션)
  let attractions: any[] = [];
  if (product.destination) {
    const { data: attrs } = await supabaseAdmin
      .from('attractions')
      .select('name, short_desc, photos, badge_type, aliases')
      .eq('destination', product.destination);
    attractions = attrs || [];
  }

  let blog_html = generateBlogPost(product, angle, attractions);
  const reviewSnips = await fetchApprovedReviewSnippets({
    packageId: product.id,
    destination: product.destination,
    limit: 3,
  });
  blog_html += formatReviewQuotesAppendMarkdown(reviewSnips);
  const seo = generateBlogSeo(product, angle);
  // Append product ID suffix to prevent slug collisions between same-destination products
  const slug = `${seo.slug}-${product.id.slice(-6)}`;

  // og_image_url 폴백 체인 — null 비율 83% 문제 해결 (2026-05-12)
  // 1. 상품 대표사진 hero_image_url
  // 2. 상품 thumbnail_urls[0]
  // 3. 첫 매칭된 관광지의 첫 사진
  // 4. 어떤 관광지든 첫 가용 사진
  // 5. 브랜드 기본 OG (절대 null 반환 X)
  const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com').replace(/\/$/, '');
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
    blog_html,
    slug,
    seo_title: seo.seoTitle,
    seo_description: seo.seoDescription,
    og_image_url,
  };
}

async function generateFromTopic(item: any): Promise<GeneratedBlog> {
  if (!hasBlogApiKey()) {
    throw new Error('AI API 키 미설정 — 정보성 블로그 생성 불가');
  }

  const { content: styleGuide, version: promptVersion } = await getActiveBlogStyleGuide();
  const baseForUtm = (process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com').replace(/\/$/, '');
  const queueSlug = buildQueueSlug(item);
  const utmCamp = encodeURIComponent(queueSlug);
  const utmSrc = 'naver_blog';
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
  const originalitySignals = await fetchBlogOriginalitySignals({
    destination: item.destination || extractDestination(item.topic),
    productId: item.product_id,
  });
  const originalityPromptBlock = buildOriginalityPromptBlock(originalitySignals);

  // 키워드 tier 기반 SEO 분기
  const tier = (item.keyword_tier as 'head' | 'mid' | 'longtail' | null) || 'mid';
  const primaryKw = item.primary_keyword || item.destination || item.topic.split(' ')[0];
  const volume = item.monthly_search_volume;
  const trendScore = item.trend_score;
  const intentPromptBlock = buildBlogIntentPromptContract(classifyBlogIntent({
    title: item.topic,
    slug: queueSlug,
    primaryKeyword: primaryKw,
    angleType: item.angle_type,
    category: item.category,
    contentType: item.source === 'pillar' ? 'pillar' : (item.product_id ? 'package_intro' : 'guide'),
    productId: item.product_id ?? null,
  }));

  const tierGuidance: Record<string, string> = {
    head: `
## SEO Tier: HEAD (고경쟁 · 검색량 ${volume ?? '?'})
- 본문 2,500~3,500자 (Pillar 수준 장문)
- H2 7~9개 (목차로 구조화 — TOC 자동 생성됨)
- 첫 H2 안에 ${primaryKw} 정의/위치/한 줄 요약
- 내부링크 ≥3 (관련 longtail 글로 분산)
- E-E-A-T 강화: "여소남이 직접 검토한", "운영팀이 ${new Date().getFullYear()}년 ${new Date().getMonth() + 1}월 확인" 1회 이상
- FAQ schema 호환 H2 1개 ("자주 묻는 질문")
`,
    mid: `
## SEO Tier: MID (중경쟁 · 검색량 ${volume ?? '?'})
- 본문 1,800~2,500자
- H2 5~7개
- 검색 의도 직답 — 첫 200자 안에 ${primaryKw}의 핵심 답 제시
- 비교/리스트형 구조 권장 (월별 표·체크리스트·Top N)
- 내부링크 ≥2 (head 글 + 다른 mid 글)
`,
    longtail: `
## SEO Tier: LONGTAIL (저경쟁 · 검색량 ${volume ?? '?'})
- 본문 1,500자 이상
- H2 5개
- 매우 구체적 사용자 시나리오에 1:1 답변 (예: "${primaryKw} 검색하는 사람의 1순위 궁금증 = 가격/일정/포함")
- 상품 랜딩(/packages?destination=...)으로 강한 CTA
- 내부링크 ≥1 (head pillar로)
`,
  };

  const trendBlock = trendScore && trendScore > 30
    ? `\n## ⚡ 트렌드 신호\n- 트렌드 점수: ${trendScore}/100 — "지금 검색되는" 토픽\n- 도입부에 "최근 ${new Date().getMonth() + 1}월 검색 급증", "지금 한국인이 가장 많이 묻는" 같은 신선도 트리거 포함\n- 데이터 출처 추정 → 출처 한 줄 명시 ("트렌드 분석 기준")\n` : '';

  // SERP analysis: always for head/mid, selectively for proven longtail opportunities.
  let serpBlock = '';
  let serpGapBlock = '';
  let serpData: import('@/lib/serp-analyzer').SerpAnalysis | null = null;
  const shouldAnalyzeSerp = Boolean(
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
            item.topic,
            [primaryKw, ...serpData.recommended_entities_to_include.slice(0, 5)],
          );
          if (gapResult.missingTopics.length > 0) {
            serpGapBlock = `
## 경쟁사 대비 부족한 주제 (반드시 H2로 추가)

아래는 경쟁사 상위 글이 공통으로 다루지만 이 글에는 없는 주제입니다.
각각을 **추가 H2 섹션**으로 본문에 포함하세요. (기존 H2 순서는 유지하며 적절한 위치에 삽입)

${gapResult.missingTopics.map((t, i) => `${i + 1}. ${t} — ${gapResult.suggestions[i] || '관련 내용으로 H2 섹션 추가'}`).join('\n')}

커버리지 점수: ${gapResult.coverageScore}/100 (낮을수록 보강 필요)
`;
          }
        } catch { /* SERP 갭 분석 실패 시 미주입 — 발행은 계속 */ }
      }
    } catch { /* SERP 실패 시 미주입 — 발행은 계속 */ }
  }

  const prompt = `${styleGuide}

---

## 이번 작성 지시

**주제**: ${item.topic}
${item.destination ? `**목적지**: ${item.destination}` : ''}
**카테고리**: ${item.category || 'travel_tips'}
**Primary Keyword**: ${primaryKw}
**부가 키워드**: ${(item.meta?.keywords || []).join(', ')}

${reviewPromptBlock}
${originalityPromptBlock}
${freshnessPromptBlock}
${intentPromptBlock}

${tierGuidance[tier]}
${trendBlock}
${serpBlock}
${serpGapBlock}

## 공통 출력 규칙
- 마크다운 형식만 (코드블록 감싸지 말 것)
- H1 첫 줄에 ${primaryKw} 포함
- 핵심 문장은 ==...== 로 감싸 하이라이트 처리 (H2당 1개)
- 구체 수치(원/km/분/℃)는 숫자 그대로 작성
- 키워드 ${primaryKw}는 자연스럽게 5~8회 반복 (밀도 ${tier === 'head' ? '1.5%' : '1.2%'} 이하)
- 3-Tier CTA 분산:
  - 도입부: [관련 패키지 보기](${baseForUtm}/packages?destination=${encodeURIComponent(item.destination || '')}&utm_source=${utmSrc}&utm_medium=organic&utm_campaign=${utmCamp}&utm_content=intro_cta)
  - 중간: [여소남 큐레이터에게 문의](${baseForUtm}/?utm_source=${utmSrc}&utm_medium=organic&utm_campaign=${utmCamp}&utm_content=mid_cta)
  - 마지막: [여소남에서 안심 여행 준비하세요](${baseForUtm}/?utm_source=${utmSrc}&utm_medium=organic&utm_campaign=${utmCamp}&utm_content=bottom_cta)`;

  const raw = await generateBlogText(prompt, { temperature: 0.7 });
  let blog_html = raw
    .replace(/^```markdown\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  blog_html = await maybeApplyChainOfDensity(blog_html);

  // slug 자동 — 오래된 큐에 잘못 들어간 expected_slug는 자동 무시
  const slug = queueSlug;

  // SEO 제목: SERP 분석 결과 있으면 power word·연도 패턴 반영, 없으면 단순 절삭
  const seo_title = serpData
    ? buildOptimalTitle(item.topic, serpData, tier)
    : item.topic.substring(0, 55);
  // SEO 설명: 주제 기반 맞춤형 (카테고리별 템플릿 다양화)
  const cat = (item.category || '').toLowerCase();
  let descTemplate: string;
  if (cat.includes('visa') || cat.includes('입국')) {
    descTemplate = `${item.topic} | ${new Date().getFullYear()}년 최신 입국 정보·필요 서류·면세 한도·비자 필수 사항을 여소남이 정리했습니다.`;
  } else if (cat.includes('itinerary') || cat.includes('일정')) {
    descTemplate = `${item.topic} | 추천 일정·예상 경비·필수 방문지·맛집 정보를 여소남의 현지 경험으로 엄선했습니다.`;
  } else if (cat.includes('preparation') || cat.includes('준비')) {
    descTemplate = `${item.topic} | 여행 준비물·체크리스트·예약 꿀팁·주의사항까지 여소남이 꼼꼼하게 정리한 가이드.`;
  } else if (cat.includes('local') || cat.includes('현지')) {
    descTemplate = `${item.topic} | 현지인 추천 맛집·교통 꿀팁·쇼핑 명소·숨은 여행지 정보를 여소남이 전해드립니다.`;
  } else {
    descTemplate = `${item.topic} | 실용적인 여행 정보와 팁을 여소남이 정리한 완벽 가이드. 준비부터 현지까지 한 번에 해결.`;
  }
  const seo_description = descTemplate.substring(0, 160);

  // og_image_url 자동 할당 — Pexels에서 destination 관련 이미지 검색
  let og_image_url: string | null = null;
  const destForImage = item.destination || extractDestination(item.topic);
  if (destForImage && isPexelsConfigured()) {
    try {
      const keyword = destToEnKeyword(destForImage);
      const photo = await getRandomPexelsPhoto(keyword);
      if (photo?.src?.large2x) og_image_url = photo.src.large2x;
      else if (photo?.src?.large) og_image_url = photo.src.large;
    } catch { /* silent — og_image_url은 null로 유지 */ }
  }

  const generation_meta: Record<string, unknown> = {
    serp_analyzed: Boolean(serpData),
    freshness_risk: freshnessRisk,
    originality_signals: {
      destination: originalitySignals.destination,
      package_count: originalitySignals.packageCount,
      active_package_count: originalitySignals.activePackageCount,
      booking_count: originalitySignals.bookingCount,
      min_price: originalitySignals.minPrice,
      max_price: originalitySignals.maxPrice,
      latest_package_updated_at: originalitySignals.latestPackageUpdatedAt,
    },
    ...(serpData ? {
      serp_analysis: {
        keyword: serpData.keyword,
        source: serpData.source,
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
