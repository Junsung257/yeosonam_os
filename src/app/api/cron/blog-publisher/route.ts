import { NextRequest, NextResponse } from 'next/server';
import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import { revalidatePath, revalidateTag } from 'next/cache';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { runQualityGates } from '@/lib/blog-quality-gate';
import { generateBlogText, hasBlogApiKey } from '@/lib/blog-ai-caller';
import { generateBlogPost, generateBlogSeo, AngleType } from '@/lib/content-generator';
import { notifyIndexing } from '@/lib/indexing';
import { withCronLogging } from '@/lib/cron-observability';
import { analyzeSerp, buildSerpPromptBlock, buildOptimalTitle } from '@/lib/serp-analyzer';
import { appendInterlinkSection } from '@/lib/topical-authority';
import { computeReadability } from '@/lib/blog-readability';
import { indexBlog } from '@/lib/jarvis/rag/indexer';
import { parsePublisherBridgeResponse } from '@/lib/blog-card-news-bridge';
import { buildStandardBlogCtaMarkdown } from '@/lib/blog-cta';
import { getCardNewsRenderBufferMs, getEarliestBlogPublishEligibleMsBatch } from '@/lib/card-news-render-readiness';
import { recordAutoPublishLog } from '@/lib/publish-orchestration';

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

const MAX_BATCH = 3; // 10건×20초=200s → Vercel 300s 한계 근접, 3건으로 안전마진 확보
const MAX_ATTEMPTS = 2;

/** 크론 1회 실행당 스타일 가이드 1회만 로드 (N+1 방지) */
let blogStyleGuideCache: { content: string; version: string } | null = null;

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

  try {
    blogStyleGuideCache = null;
    const nowIso = new Date().toISOString();
    const { data: queue } = await supabaseAdmin
      .from('blog_topic_queue')
      .select('*')
      .eq('status', 'queued')
      .lte('target_publish_at', nowIso)
      .not('target_publish_at', 'is', null)
      .order('priority', { ascending: false })
      .limit(MAX_BATCH);

    if (!queue || queue.length === 0) {
      return { processed: 0, message: '발행할 토픽 없음', errors };
    }

    const cardNewsIds = [...new Set(queue.map((q: { card_news_id?: string | null }) => q.card_news_id).filter(Boolean))] as string[];
    const eligibleByCardNewsId =
      cardNewsIds.length > 0 ? await getEarliestBlogPublishEligibleMsBatch(cardNewsIds) : new Map<string, number>();

    for (const item of queue) {
      try {
        const r = await processQueueItem(item, eligibleByCardNewsId);
        results.push(r);
        if (r.status !== 'published' && r.status !== 'done' && r.status !== 'deferred_buffer') {
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

    for (const r of results) {
      if (r.status === 'published' && r.reason) {
        const slug = r.reason;
        notifyIndexing(`${baseUrl}/blog/${slug}`, baseUrl)
          .then(report => {
            return supabaseAdmin.from('indexing_reports').insert({
              url: report.url,
              google_status: report.google,
              google_error: report.google_error ?? null,
              indexnow_status: report.indexnow,
              indexnow_error: report.indexnow_error ?? null,
              sitemap_pings: report.sitemap_pings,
              duration_ms: report.duration_ms,
            });
          })
          .catch(() => { /* noop — 색인 실패는 발행을 막지 않음 */ });
        try { revalidatePath(`/blog/${slug}`); } catch { /* noop */ }
      }
    }

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
              console.warn('[blog-publisher] RAG 인덱싱 실패 (비중단):', e instanceof Error ? e.message : e);
            }
          }),
        );
      } catch (e) {
        console.warn('[blog-publisher] RAG 배치 조회 실패:', e instanceof Error ? e.message : e);
      }
    }
    try { revalidatePath('/blog'); } catch { /* noop */ }
    try { revalidateTag('blog-list'); } catch { /* noop */ }

    return {
      processed: results.length,
      published: results.filter(r => r.status === 'published').length,
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
      generated = await generatePillar(item);
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
      })}`;
    }

    // 🆕 가독성 점수 계산 (한국어 휴리스틱)
    const readability = computeReadability(generated.blog_html);

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

    const qa = await runQualityGates({
      blog_html: generated.blog_html,
      slug: generated.slug,
      destination: item.destination,
      angle_type: item.angle_type,
      blog_type: blogType,
      primary_keyword: primaryKeyword,
    });

    if (!qa.passed) {
      await handleFailure(item, qa.summary, qa);
      return { id: item.id, topic: item.topic, status: 'gate_failed', reason: qa.summary };
    }

    const now = new Date().toISOString();
    const rowPayload = {
      tenant_id: item.tenant_id ?? null,
      blog_html: generated.blog_html,
      slug: generated.slug,
      seo_title: generated.seo_title,
      seo_description: generated.seo_description,
      og_image_url: generated.og_image_url,
      product_id: item.product_id ?? null,
      category: item.category || (item.product_id ? 'product_intro' : 'travel_tips'),
      channel: 'naver_blog' as const,
      angle_type: item.angle_type || 'value',
      status: 'published' as const,
      published_at: now,
      quality_gate: qa,
      topic_source: item.source,
      destination: item.destination ?? null,
      content_type: item.source === 'pillar' ? 'pillar' : (item.product_id ? 'package_intro' : 'guide'),
      pillar_for: item.source === 'pillar' ? item.destination : null,
      landing_enabled: !!item.product_id,
      target_ad_keywords: item.meta?.keywords ?? [],
      readability_score: readability.score,
      readability_issues: readability.issues,
      generation_meta: promoteDraftId
        ? { queue_item_id: item.id, promoted_from_draft: true, ...(item.meta || {}) }
        : { queue_item_id: item.id, ...(item.meta || {}) },
    };

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

    // 큐 업데이트
    await supabaseAdmin.from('blog_topic_queue')
      .update({
        status: 'published',
        content_creative_id: creativeId,
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
      console.warn('[blog-publisher] marketing_logs 기록 실패(비중단):', e instanceof Error ? e.message : e);
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

async function handleFailure(item: any, reason: string, qa: any, forceFailure = false) {
  const attempts = (item.attempts || 0) + 1;
  const finalStatus = forceFailure || attempts >= MAX_ATTEMPTS ? 'failed' : 'queued';

  await supabaseAdmin.from('blog_topic_queue')
    .update({
      status: finalStatus,
      attempts,
      last_error: reason,
      // 재시도 시 2시간 뒤로 미룸
      target_publish_at: finalStatus === 'queued'
        ? new Date(Date.now() + 2 * 3600 * 1000).toISOString()
        : item.target_publish_at,
      meta: { ...(item.meta || {}), last_qa: qa, last_failed_at: new Date().toISOString() },
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
}

// ── 생성기 ────────────────────────────────────────────────

interface GeneratedBlog {
  blog_html: string;
  slug: string;
  seo_title: string;
  seo_description: string;
  og_image_url?: string | null;
}

/**
 * 카드뉴스 기반 블로그 — 확정된 card_news + 슬라이드 PNG.
 * `publisher_bridge` 로 본문만 받아 퍼블리셔가 게이트 통과 후 단일 INSERT (draft 선삽입 없음).
 */
async function generateFromCardNews(item: any, eligibleByCardNewsId: Map<string, number>): Promise<GeneratedBlog> {
  const { data: cn, error: cnErr } = await supabaseAdmin
    .from('card_news')
    .select('id, slide_image_urls, slides, status')
    .eq('id', item.card_news_id)
    .limit(1);

  if (cnErr || !cn?.[0]) throw new Error(`카드뉴스 로드 실패: ${item.card_news_id}`);
  const card = cn[0];

  const slideUrls = (card.slide_image_urls as string[]) || [];
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
  const cronSecret = process.env.CRON_SECRET;
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
  };
}

/**
 * Pillar 글 생성 — /destinations/[city] 허브 본문
 * 결과는 content_type='pillar', pillar_for=destination 으로 저장됨 (publisher가 처리)
 */
async function generatePillar(item: any): Promise<GeneratedBlog> {
  if (!hasBlogApiKey()) throw new Error('AI API 키 없음 — pillar 생성 불가');

  const { buildPillarContext } = await import('@/lib/blog-pillar-generator');
  const ctx = await buildPillarContext(item.destination);
  if (!ctx) throw new Error(`${item.destination} 컨텍스트 부족 (관광지+상품 0)`);

  const { content: styleGuide, version: promptVersion } = await getActiveBlogStyleGuide();

  // Pillar는 head tier — SERP 경쟁 분석 주입 (7일 캐시 활용)
  let serpBlock = '';
  const serpKw = item.primary_keyword || item.destination;
  if (serpKw) {
    try {
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

  const slug = `${romanize(item.destination)}-complete-guide`;
  const seoTitle = `${item.destination} 여행 완벽 가이드 | 관광지·일정·비용`.substring(0, 60);
  const seoDescription = `${item.destination} 여행의 모든 것 — 운영팀 검증 관광지, 추천 일정, 예상 비용, 계절별 팁까지 정리한 완벽 가이드.`.substring(0, 160);

  return {
    blog_html,
    slug,
    seo_title: seoTitle,
    seo_description: seoDescription,
    og_image_url: null,
  };
}

function romanize(dest: string): string {
  const MAP: Record<string, string> = {
    '다낭': 'danang', '나트랑': 'nhatrang', '방콕': 'bangkok', '타이베이': 'taipei',
    '도쿄': 'tokyo', '오사카': 'osaka', '후쿠오카': 'fukuoka', '삿포로': 'sapporo', '북해도': 'hokkaido',
    '홍콩': 'hongkong', '마카오': 'macau', '싱가포르': 'singapore',
    '호찌민': 'hochiminh', '하노이': 'hanoi', '세부': 'cebu', '보라카이': 'boracay',
    '푸켓': 'phuket', '발리': 'bali', '호화호특': 'hohhot', '후허하오터': 'hohhot',
    '장가계': 'zhangjiajie', '황산': 'huangshan', '서안': 'xian', '청도': 'qingdao', '칭다오': 'qingdao',
    '하얼빈': 'harbin', '상하이': 'shanghai', '베이징': 'beijing',
  };
  return MAP[dest] || dest.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function slugifyTopic(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .substring(0, 80);
}

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
  const angle = (item.angle_type || 'value') as AngleType;

  // 관광지 매칭 (옵션)
  let attractions: any[] = [];
  if (product.destination) {
    const { data: attrs } = await supabaseAdmin
      .from('attractions')
      .select('name, short_desc, photos, badge_type, aliases')
      .eq('destination', product.destination);
    attractions = attrs || [];
  }

  const blog_html = generateBlogPost(product, angle, attractions);
  const seo = generateBlogSeo(product, angle);
  // Append product ID suffix to prevent slug collisions between same-destination products
  const slug = `${seo.slug}-${product.id.slice(-6)}`;

  return {
    blog_html,
    slug,
    seo_title: seo.seoTitle,
    seo_description: seo.seoDescription,
    og_image_url: product.hero_image_url || attractions[0]?.photos?.[0]?.src_medium || null,
  };
}

async function generateFromTopic(item: any): Promise<GeneratedBlog> {
  if (!hasBlogApiKey()) {
    throw new Error('AI API 키 미설정 — 정보성 블로그 생성 불가');
  }

  const { content: styleGuide, version: promptVersion } = await getActiveBlogStyleGuide();
  const baseForUtm = (process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com').replace(/\/$/, '');
  const utmCamp = encodeURIComponent(
    (item.meta?.expected_slug as string | undefined) || slugifyTopic(item.topic) || 'blog',
  );

  // 키워드 tier 기반 SEO 분기
  const tier = (item.keyword_tier as 'head' | 'mid' | 'longtail' | null) || 'mid';
  const primaryKw = item.primary_keyword || item.destination || item.topic.split(' ')[0];
  const volume = item.monthly_search_volume;
  const trendScore = item.trend_score;

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

  // SERP 분석 (HEAD/MID tier만 — longtail은 SERP 가치 낮음 + API 쿼터 절약)
  let serpBlock = '';
  let serpData: import('@/lib/serp-analyzer').SerpAnalysis | null = null;
  if ((tier === 'head' || tier === 'mid') && primaryKw) {
    try {
      serpData = await analyzeSerp(primaryKw, 'naver_blog');
      serpBlock = buildSerpPromptBlock(serpData);
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

${tierGuidance[tier]}
${trendBlock}
${serpBlock}

## 공통 출력 규칙
- 마크다운 형식만 (코드블록 감싸지 말 것)
- H1 첫 줄에 ${primaryKw} 포함
- 핵심 문장은 ==...== 로 감싸 하이라이트 처리 (H2당 1개)
- 구체 수치(원/km/분/℃)는 숫자 그대로 작성
- 키워드 ${primaryKw}는 자연스럽게 5~8회 반복 (밀도 ${tier === 'head' ? '1.5%' : '1.2%'} 이하)
- 3-Tier CTA 분산:
  - 도입부: [관련 패키지 보기](${baseForUtm}/packages?destination=${encodeURIComponent(item.destination || '')}&utm_source=blog&utm_medium=organic&utm_campaign=${utmCamp}&utm_content=intro_cta)
  - 중간: [여소남 큐레이터에게 문의](${baseForUtm}/?utm_source=blog&utm_medium=organic&utm_campaign=${utmCamp}&utm_content=mid_cta)
  - 마지막: [여소남에서 안심 여행 준비하세요](${baseForUtm}/?utm_source=blog&utm_medium=organic&utm_campaign=${utmCamp}&utm_content=bottom_cta)`;

  const raw = await generateBlogText(prompt, { temperature: 0.7 });
  const blog_html = raw
    .replace(/^```markdown\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  // slug 자동 — expected_slug 있으면 우선
  const expected = item.meta?.expected_slug;
  const slug = expected || slugifyTopic(item.topic);

  // SEO 제목: SERP 분석 결과 있으면 power word·연도 패턴 반영, 없으면 단순 절삭
  const seo_title = serpData
    ? buildOptimalTitle(item.topic, serpData, tier)
    : item.topic.substring(0, 55);
  const seo_description = `${item.topic} · 여소남이 정리한 실전 가이드. 준비물·비용·일정까지 꼼꼼하게.`.substring(0, 160);

  return {
    blog_html: blog_html + `\n\n<!-- prompt_version: ${promptVersion} -->`,
    slug,
    seo_title,
    seo_description,
    og_image_url: null,
  };
}
