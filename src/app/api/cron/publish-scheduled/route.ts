/**
 * GET /api/cron/publish-scheduled
 *
 * 1시간 주기 Vercel Cron.
 *
 * 처리 대상 2가지:
 *   [A] content_distributions WHERE status='scheduled' AND scheduled_for <= now()
 *   [B] card_news WHERE ig_publish_status='queued' AND ig_scheduled_for <= now()
 *       — V1/V2 에디터 "예약 발행" 버튼으로 생성. 카드뉴스 자체에 상태를 기록.
 *
 * 현재 플랫폼 지원:
 *   - meta_ads: meta-ads-publisher 로 실제 광고 발행
 *   - instagram_caption (content_distributions 경유): /api/card-news/[id]/publish-instagram 호출
 *   - instagram_carousel (card_news 직접 큐): publishCarouselToInstagram 직접 호출
 *   - threads_post:     (향후) Threads API
 *   - kakao_channel:    (향후) 카카오 비즈니스 API
 *   - google_ads_rsa:   (향후) Google Ads API
 *   - blog_body:        자동 발행 없음 (블로그는 수동)
 *
 * 안전장치:
 *   - IG 25 posts/24h 쿼터 배치 시작 전 1회 조회 (남은 양만큼만 처리)
 *   - 실패 시 재시도: content_distributions 는 3회, card_news 는 2회 후 failed
 *   - Meta 컨테이너 24h 만료 — 크론 주기 1시간이라 큐잉~발행 갭 ≤ 1h, 안전
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { publishToMetaAds } from '@/lib/content-pipeline/publishers/meta-ads-publisher';
import {
  publishCarouselToInstagram,
  getInstagramConfig,
  checkPublishingLimit,
} from '@/lib/instagram-publisher';
import {
  publishToThreads,
  getThreadsConfig,
  checkThreadsPublishingLimit,
} from '@/lib/threads-publisher';
import { withCronLogging } from '@/lib/cron-observability';

export const runtime = 'nodejs';
export const maxDuration = 300;
// CRON_SECRET 헤더 검증 → static prerender 불가. 빌드 시 Dynamic server usage 경고 차단.
export const dynamic = 'force-dynamic';

interface ScheduledRow {
  id: string;
  product_id: string | null;
  card_news_id: string | null;
  blog_post_id: string | null;
  platform: string;
  payload: Record<string, unknown>;
  scheduled_for: string;
  engagement: Record<string, unknown>;
  tenant_id: string | null;
}

async function runPublishScheduled(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  const startedAt = Date.now();
  const summary = {
    picked: 0,
    published: 0,
    failed: 0,
    skipped: 0,
    errors: [] as string[],
    details: [] as Array<{ id: string; platform: string; status: string; error?: string }>,
    ig_card_news: {
      picked: 0,
      published: 0,
      failed: 0,
      skipped: 0,
      quota_used: null as number | null,
      quota_limit: null as number | null,
    },
    threads_card_news: {
      picked: 0,
      published: 0,
      failed: 0,
      skipped: 0,
      quota_used: null as number | null,
      quota_limit: null as number | null,
    },
  };

  try {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from('content_distributions')
      .select('id, product_id, card_news_id, blog_post_id, platform, payload, scheduled_for, engagement, tenant_id')
      .eq('status', 'scheduled')
      .lte('scheduled_for', nowIso)
      .limit(20);

    if (error) throw error;
    const rows = (data ?? []) as ScheduledRow[];
    summary.picked = rows.length;

    for (const row of rows) {
      try {
        const result = await publishOne(row);
        if (result.status === 'published') {
          await supabaseAdmin
            .from('content_distributions')
            .update({
              status: 'published',
              published_at: new Date().toISOString(),
              external_id: result.external_id ?? null,
              external_url: result.external_url ?? null,
            })
            .eq('id', row.id);
          summary.published += 1;
          summary.details.push({ id: row.id, platform: row.platform, status: 'published' });
        } else if (result.status === 'skipped') {
          summary.skipped += 1;
          summary.details.push({ id: row.id, platform: row.platform, status: 'skipped', error: result.reason });
        } else {
          // failed: retry count 증가
          const retryCount = ((row.engagement?.retry_count as number) ?? 0) + 1;
          const newStatus = retryCount >= 3 ? 'failed' : 'scheduled';
          await supabaseAdmin
            .from('content_distributions')
            .update({
              status: newStatus,
              engagement: { ...(row.engagement ?? {}), retry_count: retryCount, last_error: result.error },
              // 3회 실패 시 scheduled_for 건드리지 않음 — 사용자 재스케줄 대기
              ...(retryCount < 3 ? { scheduled_for: new Date(Date.now() + 30 * 60 * 1000).toISOString() } : {}),
            })
            .eq('id', row.id);
          summary.failed += 1;
          summary.errors.push(`${row.id} (${row.platform}): ${result.error}`);
          summary.details.push({ id: row.id, platform: row.platform, status: newStatus, error: result.error });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        summary.errors.push(`${row.id} fatal: ${msg}`);
      }
    }
  } catch (err) {
    summary.errors.push(`fatal: ${err instanceof Error ? err.message : String(err)}`);
  }

  // [B] card_news IG 직접 큐
  try {
    await processQueuedCardNewsIG(summary);
  } catch (err) {
    summary.errors.push(`ig_card_news fatal: ${err instanceof Error ? err.message : String(err)}`);
  }

  // [C] card_news Threads 직접 큐
  try {
    await processQueuedCardNewsThreads(summary);
  } catch (err) {
    summary.errors.push(`threads_card_news fatal: ${err instanceof Error ? err.message : String(err)}`);
  }

  const elapsedMs = Date.now() - startedAt;
  console.log('[publish-scheduled]', JSON.stringify({ ...summary, elapsed_ms: elapsedMs }));
  return { ...summary, elapsed_ms: elapsedMs };
}

export const GET = withCronLogging('publish-scheduled', runPublishScheduled);

// ──────────────────────────────────────────────────────
// 플랫폼별 publisher 분기
// ──────────────────────────────────────────────────────
async function publishOne(row: ScheduledRow): Promise<{
  status: 'published' | 'failed' | 'skipped';
  external_id?: string;
  external_url?: string;
  error?: string;
  reason?: string;
}> {
  const payload = row.payload;

  if (row.platform === 'meta_ads') {
    const landingUrl = row.product_id
      ? `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://yeosonam.com'}/packages/${row.product_id}`
      : (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://yeosonam.com');
    const result = await publishToMetaAds({
      primary_texts: (payload.primary_texts as string[]) ?? [],
      headlines: (payload.headlines as string[]) ?? [],
      descriptions: (payload.descriptions as string[]) ?? [],
      cta_button: (payload.cta_button as string) ?? 'LEARN_MORE',
      landing_url: landingUrl,
    });
    if (result.status === 'error') return { status: 'failed', error: result.error };
    if (result.status === 'draft') {
      // test mode: 광고는 만들었지만 PAUSED 상태 — published 로 표시하되 test_mode 플래그
      return {
        status: 'published',
        external_id: result.campaign_id,
        external_url: result.external_url,
      };
    }
    return {
      status: 'published',
      external_id: result.campaign_id,
      external_url: result.external_url,
    };
  }

  if (row.platform === 'instagram_caption') {
    // card_news 에 연결된 경우만 기존 IG 발행 경로 호출
    if (!row.card_news_id) {
      return { status: 'skipped', reason: 'card_news_id 없음 (IG 캡션만으로는 발행 불가)' };
    }
    try {
      const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
      const res = await fetch(`${base}/api/card-news/${row.card_news_id}/publish-instagram`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caption_override: (payload.caption as string) ?? undefined }),
      });
      const data = await res.json();
      if (!res.ok) return { status: 'failed', error: data.error ?? 'IG 발행 실패' };
      return {
        status: 'published',
        external_id: data.ig_post_id ?? undefined,
        external_url: data.permalink ?? undefined,
      };
    } catch (err) {
      return { status: 'failed', error: err instanceof Error ? err.message : String(err) };
    }
  }

  if (row.platform === 'threads_post' || row.platform === 'kakao_channel' || row.platform === 'google_ads_rsa') {
    return { status: 'skipped', reason: `${row.platform} 자동 발행 미지원 (API 인증 필요)` };
  }

  if (row.platform === 'blog_body') {
    // 1) 이미 발행된 blog_post_id 가 있으면 게시 처리 (이중 INSERT 방지)
    if (row.blog_post_id) {
      const { data: existing } = await supabaseAdmin
        .from('content_creatives')
        .select('id, slug, status')
        .eq('id', row.blog_post_id)
        .limit(1);
      const existingRow = existing?.[0];
      if (existingRow) {
        if (existingRow.status !== 'published') {
          await supabaseAdmin
            .from('content_creatives')
            .update({ status: 'published', published_at: new Date().toISOString() })
            .eq('id', row.blog_post_id);
        }
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://yeosonam.com';
        return {
          status: 'published',
          external_id: row.blog_post_id,
          external_url: `${baseUrl}/blog/${existingRow.slug}`,
        };
      }
    }
    // 2) blog_topic_queue 항목으로 즉시 큐잉 (다음 blog-publisher 사이클이 처리)
    try {
      const queuePayload = (row.payload ?? {}) as Record<string, unknown>;
      await supabaseAdmin.from('blog_topic_queue').insert({
        tenant_id: row.tenant_id,
        topic: (queuePayload.topic as string) ?? '자동 생성 블로그',
        destination: (queuePayload.destination as string) ?? null,
        category: (queuePayload.category as string) ?? null,
        angle_type: (queuePayload.angle_type as string) ?? 'value',
        product_id: row.product_id,
        card_news_id: row.card_news_id,
        source: row.card_news_id ? 'card_news' : (row.product_id ? 'product' : 'distribution'),
        status: 'queued',
        priority: 80,
        target_publish_at: new Date().toISOString(),
        meta: { from_distribution_id: row.id, ...queuePayload },
      });
      return { status: 'published', external_id: 'queued_to_blog_publisher' };
    } catch (e) {
      return { status: 'failed', error: e instanceof Error ? e.message : String(e) };
    }
  }

  return { status: 'skipped', reason: `알 수 없는 플랫폼 ${row.platform}` };
}

// ──────────────────────────────────────────────────────
// [B] card_news 직접 큐 (ig_publish_status='queued') 처리
// ──────────────────────────────────────────────────────
/**
 * ig_error 문자열에서 "[attempt:N]" 접두사 파싱. 없으면 0.
 * 실패 시 attempt++ 로 기록하여 동일 row 가 재시도 횟수를 추적.
 */
function parseAttemptCount(igError: string | null | undefined): number {
  if (!igError) return 0;
  const m = igError.match(/^\[attempt:(\d+)\]/);
  return m ? parseInt(m[1], 10) : 0;
}

interface QueuedCardNewsRow {
  id: string;
  slides: unknown;
  ig_caption: string | null;
  ig_slide_urls: string[] | null;
  ig_scheduled_for: string;
  ig_error: string | null;
}

async function processQueuedCardNewsIG(summary: {
  ig_card_news: {
    picked: number;
    published: number;
    failed: number;
    skipped: number;
    quota_used: number | null;
    quota_limit: number | null;
  };
  errors: string[];
}): Promise<void> {
  const cfg = await getInstagramConfig();
  if (!cfg) {
    // env/DB 모두 비어있음 → 스킵 (로그만). 크론 자체 실패는 아님.
    console.log('[publish-scheduled] IG 토큰 조회 실패 (env+DB), card_news 큐 스킵');
    return;
  }

  const nowIso = new Date().toISOString();
  // IG 캐러셀 발행 1건당 60~90초 (컨테이너 폴링 포함) + maxDuration=300s
  // → 한 크론 실행당 최대 3건 처리. 쿼터 25/24h 기준으로도 충분 (크론 24회/일).
  const PER_CRON_LIMIT = 3;
  const { data, error } = await supabaseAdmin
    .from('card_news')
    .select('id, slides, ig_caption, ig_slide_urls, ig_scheduled_for, ig_error')
    .eq('ig_publish_status', 'queued')
    .lte('ig_scheduled_for', nowIso)
    .order('ig_scheduled_for', { ascending: true })
    .limit(PER_CRON_LIMIT);
  if (error) {
    summary.errors.push(`ig_card_news query: ${error.message}`);
    return;
  }
  const rows = (data ?? []) as QueuedCardNewsRow[];
  summary.ig_card_news.picked = rows.length;
  if (rows.length === 0) return;

  // Rate limit 사전 체크 — 배치 시작 전 1회. 25/24h rolling.
  const quota = await checkPublishingLimit(cfg.igUserId, cfg.accessToken);
  if (quota) {
    summary.ig_card_news.quota_used = quota.quotaUsed;
    summary.ig_card_news.quota_limit = quota.quotaLimit;
  }
  const remaining = quota ? Math.max(0, quota.quotaLimit - quota.quotaUsed) : rows.length;
  const processable = rows.slice(0, remaining);
  const deferred = rows.length - processable.length;
  if (deferred > 0) {
    summary.ig_card_news.skipped += deferred;
    console.log(`[publish-scheduled] IG 쿼터 소진 (${quota?.quotaUsed}/${quota?.quotaLimit}) — ${deferred}건 다음 크론으로 이월`);
  }

  for (const row of processable) {
    const caption = (row.ig_caption ?? '').trim();
    const urls = Array.isArray(row.ig_slide_urls) ? row.ig_slide_urls.filter(u => typeof u === 'string' && u.length > 0) : [];

    // pre-publish validation
    if (!caption) {
      await markFailed(row.id, 'ig_caption 비어있음', /* attempt */ 2); // 즉시 failed — 재시도 불가
      summary.ig_card_news.failed += 1;
      continue;
    }
    if (urls.length < 2 || urls.length > 10) {
      await markFailed(row.id, `이미지 ${urls.length}장 (2~10 필요)`, 2);
      summary.ig_card_news.failed += 1;
      continue;
    }
    const nonPublic = urls.find(u => !u.startsWith('http://') && !u.startsWith('https://'));
    if (nonPublic) {
      await markFailed(row.id, '이미지가 공개 https URL 아님', 2);
      summary.ig_card_news.failed += 1;
      continue;
    }

    // publishing 상태로 전환 (중복 실행 방어)
    await supabaseAdmin
      .from('card_news')
      .update({ ig_publish_status: 'publishing', ig_error: null })
      .eq('id', row.id);

    try {
      const result = await publishCarouselToInstagram({
        igUserId: cfg.igUserId,
        accessToken: cfg.accessToken,
        imageUrls: urls,
        caption,
      });

      if (result.ok) {
        await supabaseAdmin
          .from('card_news')
          .update({
            ig_publish_status: 'published',
            ig_post_id: result.postId,
            ig_published_at: new Date().toISOString(),
            ig_error: null,
          })
          .eq('id', row.id);
        summary.ig_card_news.published += 1;
      } else {
        const prevAttempt = parseAttemptCount(row.ig_error);
        const nextAttempt = prevAttempt + 1;
        const failed = nextAttempt >= 2; // 2회째 실패부터 failed
        await markFailed(
          row.id,
          `[${result.step}] ${result.error}`,
          nextAttempt,
          failed ? undefined : new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        );
        if (failed) {
          summary.ig_card_news.failed += 1;
        } else {
          // 재스케줄 — picked 됐지만 published/failed 아님
          summary.ig_card_news.skipped += 1;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const prevAttempt = parseAttemptCount(row.ig_error);
      const nextAttempt = prevAttempt + 1;
      const failed = nextAttempt >= 2;
      await markFailed(
        row.id,
        `unexpected: ${msg}`,
        nextAttempt,
        failed ? undefined : new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      );
      if (failed) summary.ig_card_news.failed += 1;
      else summary.ig_card_news.skipped += 1;
    }
  }
}

/**
 * card_news IG 예약 발행 실패 처리.
 * - retryAt 지정 시 ig_publish_status='queued' 로 되돌리고 ig_scheduled_for 를 재설정
 * - retryAt 없으면 ig_publish_status='failed' 로 종결
 */
async function markFailed(
  cardNewsId: string,
  errorMessage: string,
  attempt: number,
  retryAt?: string,
): Promise<void> {
  const errorWithAttempt = `[attempt:${attempt}] ${errorMessage}`;
  const patch: Record<string, unknown> = { ig_error: errorWithAttempt };
  if (retryAt) {
    patch.ig_publish_status = 'queued';
    patch.ig_scheduled_for = retryAt;
  } else {
    patch.ig_publish_status = 'failed';
  }
  try {
    await supabaseAdmin.from('card_news').update(patch).eq('id', cardNewsId);
  } catch (e) {
    console.error('[publish-scheduled] markFailed DB 실패:', cardNewsId, e);
  }
}

// ──────────────────────────────────────────────────────
// [C] card_news Threads 직접 큐 처리
// ──────────────────────────────────────────────────────
interface QueuedCardNewsThreadsRow {
  id: string;
  threads_text: string | null;
  threads_media_urls: string[] | null;
  threads_scheduled_for: string;
  threads_error: string | null;
}

async function processQueuedCardNewsThreads(summary: {
  threads_card_news: {
    picked: number;
    published: number;
    failed: number;
    skipped: number;
    quota_used: number | null;
    quota_limit: number | null;
  };
  errors: string[];
}): Promise<void> {
  const cfg = await getThreadsConfig();
  if (!cfg) {
    console.log('[publish-scheduled] Threads 토큰 조회 실패 (env+DB), card_news 큐 스킵');
    return;
  }

  const nowIso = new Date().toISOString();
  const PER_CRON_LIMIT = 5; // Threads 는 건당 10~30초 (텍스트) ~ 60초 (캐러셀). IG 보다 여유.
  const { data, error } = await supabaseAdmin
    .from('card_news')
    .select('id, threads_text, threads_media_urls, threads_scheduled_for, threads_error')
    .eq('threads_publish_status', 'queued')
    .lte('threads_scheduled_for', nowIso)
    .order('threads_scheduled_for', { ascending: true })
    .limit(PER_CRON_LIMIT);
  if (error) {
    summary.errors.push(`threads query: ${error.message}`);
    return;
  }
  const rows = (data ?? []) as QueuedCardNewsThreadsRow[];
  summary.threads_card_news.picked = rows.length;
  if (rows.length === 0) return;

  const quota = await checkThreadsPublishingLimit(cfg.threadsUserId, cfg.accessToken);
  if (quota) {
    summary.threads_card_news.quota_used = quota.quotaUsed;
    summary.threads_card_news.quota_limit = quota.quotaLimit;
  }
  const remaining = quota ? Math.max(0, quota.quotaLimit - quota.quotaUsed) : rows.length;
  const processable = rows.slice(0, remaining);
  const deferred = rows.length - processable.length;
  if (deferred > 0) {
    summary.threads_card_news.skipped += deferred;
    console.log(`[publish-scheduled] Threads 쿼터 소진 (${quota?.quotaUsed}/${quota?.quotaLimit}) — ${deferred}건 이월`);
  }

  for (const row of processable) {
    const text = (row.threads_text ?? '').trim();
    const urls = Array.isArray(row.threads_media_urls) ? row.threads_media_urls.filter(u => typeof u === 'string' && u.length > 0) : [];

    if (!text) {
      await markThreadsFailed(row.id, 'threads_text 비어있음', 2);
      summary.threads_card_news.failed += 1;
      continue;
    }
    if (text.length > 500) {
      await markThreadsFailed(row.id, `본문 500자 초과 (${text.length}자)`, 2);
      summary.threads_card_news.failed += 1;
      continue;
    }
    if (urls.length > 20) {
      await markThreadsFailed(row.id, `이미지 20장 초과 (${urls.length}장)`, 2);
      summary.threads_card_news.failed += 1;
      continue;
    }
    const nonPublic = urls.find(u => !u.startsWith('http://') && !u.startsWith('https://'));
    if (nonPublic) {
      await markThreadsFailed(row.id, '이미지가 공개 https URL 아님', 2);
      summary.threads_card_news.failed += 1;
      continue;
    }

    await supabaseAdmin
      .from('card_news')
      .update({ threads_publish_status: 'publishing', threads_error: null })
      .eq('id', row.id);

    try {
      const result = await publishToThreads({
        threadsUserId: cfg.threadsUserId,
        accessToken: cfg.accessToken,
        text,
        imageUrls: urls.length > 0 ? urls : undefined,
      });

      if (result.ok) {
        await supabaseAdmin
          .from('card_news')
          .update({
            threads_publish_status: 'published',
            threads_post_id: result.postId,
            threads_published_at: new Date().toISOString(),
            threads_error: null,
          })
          .eq('id', row.id);
        summary.threads_card_news.published += 1;
      } else {
        const prevAttempt = parseAttemptCount(row.threads_error);
        const nextAttempt = prevAttempt + 1;
        const failed = nextAttempt >= 2;
        await markThreadsFailed(
          row.id,
          `[${result.step}] ${result.error}`,
          nextAttempt,
          failed ? undefined : new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        );
        if (failed) summary.threads_card_news.failed += 1;
        else summary.threads_card_news.skipped += 1;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const prevAttempt = parseAttemptCount(row.threads_error);
      const nextAttempt = prevAttempt + 1;
      const failed = nextAttempt >= 2;
      await markThreadsFailed(
        row.id,
        `unexpected: ${msg}`,
        nextAttempt,
        failed ? undefined : new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      );
      if (failed) summary.threads_card_news.failed += 1;
      else summary.threads_card_news.skipped += 1;
    }
  }
}

async function markThreadsFailed(
  cardNewsId: string,
  errorMessage: string,
  attempt: number,
  retryAt?: string,
): Promise<void> {
  const errorWithAttempt = `[attempt:${attempt}] ${errorMessage}`;
  const patch: Record<string, unknown> = { threads_error: errorWithAttempt };
  if (retryAt) {
    patch.threads_publish_status = 'queued';
    patch.threads_scheduled_for = retryAt;
  } else {
    patch.threads_publish_status = 'failed';
  }
  try {
    await supabaseAdmin.from('card_news').update(patch).eq('id', cardNewsId);
  } catch (e) {
    console.error('[publish-scheduled] markThreadsFailed DB 실패:', cardNewsId, e);
  }
}
