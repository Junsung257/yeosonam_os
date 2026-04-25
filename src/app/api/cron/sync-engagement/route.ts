/**
 * GET /api/cron/sync-engagement
 *
 * 24h 주기 Vercel Cron (매일 04:00 UTC).
 *
 * 대상:
 *   [A] content_distributions WHERE status='published' AND external_id NOT NULL (최근 30일)
 *   [B] card_news WHERE ig_publish_status='published' AND ig_post_id NOT NULL (최근 30일)
 *       — V1/V2 에디터 예약 발행 루트. content_distributions 에 없음.
 *
 * 처리:
 *   1. 플랫폼별 Graph API 로 metrics fetch
 *   2. post_engagement_snapshots 에 append (시계열 history)
 *   3. content_distributions.engagement JSONB 업데이트 (latest view)
 *   4. 성과 상위 20% → brand-voice.appendVoiceSample() 자동 학습
 *
 * Meta 지표 변경:
 *   - 2025-04 `impressions` deprecated (2024-07 이전 미디어만 제공)
 *   - 신규 미디어는 `views` + `reach` 사용
 *
 * env:
 *   - META_GRAPH_ACCESS_TOKEN (선호) 또는 META_ACCESS_TOKEN (publish 용과 공유) fallback
 *   - META_ADS_ACCESS_TOKEN
 *   - CRON_SECRET
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { appendVoiceSample } from '@/lib/content-pipeline/brand-voice';
import { withCronLogging } from '@/lib/cron-observability';

export const runtime = 'nodejs';
export const maxDuration = 300;

type NormalizedMetrics = {
  views?: number;
  reach?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  clicks?: number;
  replies?: number;
  reposts?: number;
  quotes?: number;
  ctr?: number;
  spend?: number;
  impressions_legacy?: number;
  raw?: unknown;
};

interface DistributionRow {
  id: string;
  platform: string;
  external_id: string | null;
  external_url: string | null;
  payload: Record<string, unknown>;
  engagement: Record<string, unknown>;
  published_at: string | null;
  card_news_id: string | null;
}

interface CardNewsPublishedRow {
  id: string;
  title: string;
  ig_post_id: string;
  ig_published_at: string;
  ig_caption: string | null;
}

async function runSyncEngagement(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  const startedAt = Date.now();
  const summary = {
    distributions: { checked: 0, updated: 0, snapshots: 0 },
    card_news_ig: { checked: 0, updated: 0, snapshots: 0 },
    webhook_consumed: { checked: 0, processed: 0, skipped: 0 },
    top_performers_added: 0,
    errors: [] as string[],
  };

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // ── [A] content_distributions 처리 ───────────────────────
  try {
    const { data, error } = await supabaseAdmin
      .from('content_distributions')
      .select('id, platform, external_id, external_url, payload, engagement, published_at, card_news_id')
      .eq('status', 'published')
      .gte('published_at', thirtyDaysAgo)
      .not('external_id', 'is', null)
      .limit(200);
    if (error) throw error;
    const rows = (data ?? []) as DistributionRow[];
    summary.distributions.checked = rows.length;

    const performanceScores: Array<{ row: DistributionRow; score: number }> = [];

    // PERF-02: Promise.allSettled 청크 병렬화 (10개씩). Meta Graph API 동시 호출이지만
    // 대상 계정이 여소남 하나이므로 계정 단위 rate limit 내에서 안전.
    // Meta BUC limit: 계정당 200 calls / 1 hour. 하루 200개 < 200 여유.
    const CHUNK_SIZE = 10;
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      const results = await Promise.allSettled(
        chunk.map(async (row) => {
          const { metrics, score } = await fetchPlatformMetrics(row.platform, row.external_id!);
          if (!metrics) return { row, metrics: null, score: 0 };
          return { row, metrics, score };
        }),
      );

      // DB write 는 순차 (동일 행 업데이트 충돌 방지)
      for (const res of results) {
        if (res.status === 'rejected') {
          summary.errors.push(`dist fetch fatal: ${res.reason instanceof Error ? res.reason.message : String(res.reason)}`);
          continue;
        }
        const { row, metrics, score } = res.value;
        if (!metrics) continue;

        try {
          const { error: snapErr } = await supabaseAdmin
            .from('post_engagement_snapshots')
            .insert({
              distribution_id: row.id,
              card_news_id: row.card_news_id,
              platform: normalizePlatform(row.platform),
              external_id: row.external_id,
              views: metrics.views ?? null,
              reach: metrics.reach ?? null,
              likes: metrics.likes ?? null,
              comments: metrics.comments ?? null,
              shares: metrics.shares ?? null,
              saves: metrics.saves ?? null,
              clicks: metrics.clicks ?? null,
              replies: metrics.replies ?? null,
              reposts: metrics.reposts ?? null,
              quotes: metrics.quotes ?? null,
              ctr: metrics.ctr ?? null,
              spend: metrics.spend ?? null,
              impressions_legacy: metrics.impressions_legacy ?? null,
              performance_score: score,
              raw_response: metrics.raw ?? null,
            });
          if (!snapErr) summary.distributions.snapshots += 1;

          const merged = {
            ...(row.engagement ?? {}),
            views: metrics.views ?? null,
            reach: metrics.reach ?? null,
            likes: metrics.likes ?? null,
            comments: metrics.comments ?? null,
            shares: metrics.shares ?? null,
            saves: metrics.saves ?? null,
            clicks: metrics.clicks ?? null,
            ctr: metrics.ctr ?? null,
            spend: metrics.spend ?? null,
            performance_score: score,
            synced_at: new Date().toISOString(),
          };
          await supabaseAdmin
            .from('content_distributions')
            .update({ engagement: merged })
            .eq('id', row.id);
          summary.distributions.updated += 1;
          if (score > 0) performanceScores.push({ row, score });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          summary.errors.push(`dist ${row.id} (${row.platform}): ${msg}`);
        }
      }
    }

    // 상위 20% → voice_samples
    if (performanceScores.length > 0) {
      performanceScores.sort((a, b) => b.score - a.score);
      const topCount = Math.max(1, Math.floor(performanceScores.length * 0.2));
      for (const { row, score } of performanceScores.slice(0, topCount)) {
        if (score < 0.5) continue;
        try {
          const content = extractContentFromPayload(row);
          if (!content) continue;
          const added = await appendVoiceSample('yeosonam', {
            platform: row.platform,
            content,
            performance_score: Math.round(score * 100) / 100,
            captured_at: new Date().toISOString().slice(0, 10),
          });
          if (added) summary.top_performers_added += 1;
        } catch (err) {
          summary.errors.push(`voice_sample ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  } catch (err) {
    summary.errors.push(`[A] fatal: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── [B] card_news IG 직접 발행 처리 ──────────────────────
  // V1/V2 예약 발행 루트는 content_distributions 에 레코드가 없음.
  try {
    const { data, error } = await supabaseAdmin
      .from('card_news')
      .select('id, title, ig_post_id, ig_published_at, ig_caption')
      .eq('ig_publish_status', 'published')
      .not('ig_post_id', 'is', null)
      .gte('ig_published_at', thirtyDaysAgo)
      .limit(200);
    if (error) throw error;
    const rows = (data ?? []) as CardNewsPublishedRow[];
    summary.card_news_ig.checked = rows.length;

    const CHUNK_SIZE = 10;
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      const results = await Promise.allSettled(
        chunk.map(async (row) => {
          const { metrics, score } = await fetchPlatformMetrics('instagram_caption', row.ig_post_id);
          return { row, metrics, score };
        }),
      );
      for (const res of results) {
        if (res.status === 'rejected') {
          summary.errors.push(`card_news fetch fatal: ${res.reason instanceof Error ? res.reason.message : String(res.reason)}`);
          continue;
        }
        const { row, metrics, score } = res.value;
        if (!metrics) continue;
        try {
          const { error: snapErr } = await supabaseAdmin
            .from('post_engagement_snapshots')
            .insert({
              card_news_id: row.id,
              platform: 'instagram',
              external_id: row.ig_post_id,
              views: metrics.views ?? null,
              reach: metrics.reach ?? null,
              likes: metrics.likes ?? null,
              comments: metrics.comments ?? null,
              shares: metrics.shares ?? null,
              saves: metrics.saves ?? null,
              impressions_legacy: metrics.impressions_legacy ?? null,
              performance_score: score,
              raw_response: metrics.raw ?? null,
            });
          if (!snapErr) summary.card_news_ig.snapshots += 1;
          summary.card_news_ig.updated += 1;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          summary.errors.push(`card_news ${row.id}: ${msg}`);
        }
      }
    }
  } catch (err) {
    summary.errors.push(`[B] fatal: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── [C] Webhook 이벤트 consume ───────────────────────────
  // social_webhook_events.processed=false 인 이벤트를 집계해서 engagement 증분 반영.
  // 주로 comments/replies/publish 이벤트 → card_news 에 연결된 경우만 처리.
  try {
    const { data: events, error: evErr } = await supabaseAdmin
      .from('social_webhook_events')
      .select('id, platform, event_type, external_id, raw_payload, received_at')
      .eq('processed', false)
      .order('received_at', { ascending: true })
      .limit(500);
    if (evErr) throw evErr;
    const eventList = (events ?? []) as Array<{
      id: string; platform: string; event_type: string | null;
      external_id: string | null; raw_payload: Record<string, unknown>;
    }>;
    summary.webhook_consumed.checked = eventList.length;

    const processedIds: string[] = [];
    const skippedIds: string[] = [];

    for (const ev of eventList) {
      // external_id 없으면 스킵 (매핑 불가)
      if (!ev.external_id) { skippedIds.push(ev.id); continue; }

      // 외부 ID로 card_news 역조회 (ig_post_id 또는 threads_post_id)
      const { data: cn } = await supabaseAdmin
        .from('card_news')
        .select('id')
        .or(`ig_post_id.eq.${ev.external_id},threads_post_id.eq.${ev.external_id}`)
        .maybeSingle();
      if (!cn) { skippedIds.push(ev.id); continue; }

      // 증분 snapshot — platform 정규화 + raw 보존. 실제 수치는 Graph API 폴링이 메인,
      // webhook 은 event_type='comments'|'replies' 일 때 해당 카운터만 +1 로 힌트.
      const incrementField =
        ev.event_type === 'comments' ? 'comments'
        : ev.event_type === 'replies' ? 'replies'
        : ev.event_type === 'mentions' ? 'comments'
        : null;

      if (incrementField) {
        // 마지막 snapshot 에 +1 한 새 snapshot INSERT
        const { data: last } = await supabaseAdmin
          .from('post_engagement_snapshots')
          .select('views,reach,likes,comments,shares,saves,clicks,replies,reposts,quotes,impressions_legacy,performance_score')
          .eq('card_news_id', (cn as Record<string, string>).id)
          .order('captured_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        const prev = (last ?? {}) as Record<string, number | null>;
        const insertRow: Record<string, unknown> = {
          card_news_id: (cn as Record<string, string>).id,
          platform: ev.platform,
          external_id: ev.external_id,
          views: prev.views ?? null,
          reach: prev.reach ?? null,
          likes: prev.likes ?? null,
          comments: prev.comments ?? null,
          shares: prev.shares ?? null,
          saves: prev.saves ?? null,
          clicks: prev.clicks ?? null,
          replies: prev.replies ?? null,
          reposts: prev.reposts ?? null,
          quotes: prev.quotes ?? null,
          impressions_legacy: prev.impressions_legacy ?? null,
          performance_score: prev.performance_score ?? null,
          raw_response: { webhook_event_id: ev.id, event_type: ev.event_type, payload: ev.raw_payload },
        };
        insertRow[incrementField] = (prev[incrementField] ?? 0) + 1;
        await supabaseAdmin.from('post_engagement_snapshots').insert(insertRow as never);
      }
      processedIds.push(ev.id);
    }

    // 배치 update processed=true
    if (processedIds.length > 0) {
      await supabaseAdmin
        .from('social_webhook_events')
        .update({ processed: true } as never)
        .in('id', processedIds);
    }
    if (skippedIds.length > 0) {
      await supabaseAdmin
        .from('social_webhook_events')
        .update({ processed: true, processing_error: 'no_matching_card_news_or_event_type' } as never)
        .in('id', skippedIds);
    }
    summary.webhook_consumed.processed = processedIds.length;
    summary.webhook_consumed.skipped = skippedIds.length;
  } catch (err) {
    summary.errors.push(`[C] webhook consume fatal: ${err instanceof Error ? err.message : String(err)}`);
  }

  const elapsedMs = Date.now() - startedAt;
  console.log('[sync-engagement]', JSON.stringify({ ...summary, elapsed_ms: elapsedMs }));
  return { ...summary, elapsed_ms: elapsedMs };
}

export const GET = withCronLogging('sync-engagement', runSyncEngagement);

// ──────────────────────────────────────────────────────
// Platform dispatch
// ──────────────────────────────────────────────────────
async function fetchPlatformMetrics(
  platform: string,
  externalId: string,
): Promise<{ metrics: NormalizedMetrics | null; score: number }> {
  if (platform === 'instagram_caption' || platform === 'instagram_carousel') {
    const m = await fetchInstagramMetrics(externalId);
    if (!m) return { metrics: null, score: 0 };
    return { metrics: m, score: computeInstagramScore(m) };
  }
  if (platform === 'threads_post') {
    const m = await fetchThreadsMetrics(externalId);
    if (!m) return { metrics: null, score: 0 };
    return { metrics: m, score: computeThreadsScore(m) };
  }
  if (platform === 'meta_ads') {
    const m = await fetchMetaAdsMetrics(externalId);
    if (!m) return { metrics: null, score: 0 };
    return { metrics: m, score: Math.min(1, (m.ctr ?? 0) * 20) };
  }
  // kakao_channel: 공식 수신 리포트 API 없음 → skip
  return { metrics: null, score: 0 };
}

function normalizePlatform(platform: string): string {
  if (platform.startsWith('instagram')) return 'instagram';
  if (platform === 'threads_post') return 'threads';
  if (platform === 'meta_ads') return 'meta_ads';
  return platform;
}

// IG Media Insights v21
// 2025-04 이후 `impressions` 는 2024-07 이전 미디어에만 제공.
// 신규 미디어는 `views` 로 대체. `reach` + `saved` + `likes` + `comments` + `shares` 는 계속 지원.
// docs: https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights/
async function fetchInstagramMetrics(mediaId: string): Promise<NormalizedMetrics | null> {
  const accessToken = process.env.META_GRAPH_ACCESS_TOKEN ?? process.env.META_ACCESS_TOKEN;
  if (!accessToken) return null;
  try {
    const metricList = ['views', 'reach', 'saved', 'likes', 'comments', 'shares'].join(',');
    const url = `https://graph.facebook.com/v21.0/${mediaId}/insights?metric=${metricList}&access_token=${encodeURIComponent(accessToken)}`;
    const res = await fetch(url);
    if (!res.ok) {
      // views 가 지원 안 되는 구형 미디어 → impressions 로 fallback
      const legacyList = ['impressions', 'reach', 'saved', 'likes', 'comments', 'shares'].join(',');
      const legacyUrl = `https://graph.facebook.com/v21.0/${mediaId}/insights?metric=${legacyList}&access_token=${encodeURIComponent(accessToken)}`;
      const legacyRes = await fetch(legacyUrl);
      if (!legacyRes.ok) return null;
      const legacyData = await legacyRes.json();
      return parseIGInsights(legacyData, /* legacy */ true);
    }
    const data = await res.json();
    return parseIGInsights(data, false);
  } catch {
    return null;
  }
}

function parseIGInsights(data: unknown, legacy: boolean): NormalizedMetrics | null {
  if (!data || typeof data !== 'object' || !('data' in data)) return null;
  const entries = (data as { data: Array<{ name: string; values: Array<{ value: number }> }> }).data ?? [];
  const get = (name: string) => entries.find(e => e.name === name)?.values?.[0]?.value ?? null;
  const normalized: NormalizedMetrics = {
    reach: get('reach') ?? undefined,
    saves: get('saved') ?? undefined,
    likes: get('likes') ?? undefined,
    comments: get('comments') ?? undefined,
    shares: get('shares') ?? undefined,
    raw: data,
  };
  if (legacy) {
    normalized.impressions_legacy = get('impressions') ?? undefined;
  } else {
    normalized.views = get('views') ?? undefined;
  }
  return normalized;
}

function computeInstagramScore(m: NormalizedMetrics): number {
  // 분모: views (신규) > reach (구형 fallback)
  const denom = (m.views ?? m.reach ?? m.impressions_legacy ?? 1) || 1;
  const numer = (m.saves ?? 0) * 5 + (m.shares ?? 0) * 3 + (m.likes ?? 0) + (m.comments ?? 0) * 2;
  return Math.min(1, numer / denom);
}

// Threads Media Insights
// docs: https://developers.facebook.com/docs/threads/insights
async function fetchThreadsMetrics(mediaId: string): Promise<NormalizedMetrics | null> {
  const accessToken = process.env.THREADS_ACCESS_TOKEN ?? process.env.META_ACCESS_TOKEN;
  if (!accessToken) return null;
  try {
    const metricList = ['views', 'likes', 'replies', 'reposts', 'quotes'].join(',');
    const url = `https://graph.threads.net/v1.0/${mediaId}/insights?metric=${metricList}&access_token=${encodeURIComponent(accessToken)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const entries = (data.data ?? []) as Array<{ name: string; values: Array<{ value: number }> }>;
    const get = (name: string) => entries.find(e => e.name === name)?.values?.[0]?.value ?? null;
    return {
      views: get('views') ?? undefined,
      likes: get('likes') ?? undefined,
      replies: get('replies') ?? undefined,
      reposts: get('reposts') ?? undefined,
      quotes: get('quotes') ?? undefined,
      raw: data,
    };
  } catch {
    return null;
  }
}

function computeThreadsScore(m: NormalizedMetrics): number {
  const denom = (m.views ?? 1) || 1;
  const numer = (m.reposts ?? 0) * 5 + (m.quotes ?? 0) * 3 + (m.replies ?? 0) * 2 + (m.likes ?? 0);
  return Math.min(1, numer / denom);
}

async function fetchMetaAdsMetrics(adId: string): Promise<NormalizedMetrics | null> {
  const accessToken = process.env.META_ADS_ACCESS_TOKEN ?? process.env.META_ACCESS_TOKEN;
  if (!accessToken) return null;
  try {
    const fields = ['impressions', 'clicks', 'ctr', 'spend'].join(',');
    const url = `https://graph.facebook.com/v21.0/${adId}/insights?fields=${fields}&access_token=${encodeURIComponent(accessToken)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const first = (data.data ?? [])[0] as Record<string, string | number> | undefined;
    if (!first) return null;
    return {
      views: Number(first.impressions ?? 0),  // Ads 쪽은 impressions 여전히 사용
      clicks: Number(first.clicks ?? 0),
      ctr: Number(first.ctr ?? 0) / 100,
      spend: Number(first.spend ?? 0),
      raw: data,
    };
  } catch {
    return null;
  }
}

function extractContentFromPayload(row: DistributionRow): string | null {
  const p = row.payload as Record<string, unknown>;
  if (row.platform === 'instagram_caption') return (p.caption as string) ?? null;
  if (row.platform === 'threads_post') {
    const main = (p.main as string) ?? '';
    const thread = (p.thread as string[]) ?? [];
    return [main, ...thread].join('\n\n');
  }
  if (row.platform === 'meta_ads') {
    const pt = (p.primary_texts as string[]) ?? [];
    return pt[0] ?? null;
  }
  if (row.platform === 'kakao_channel') return (p.message_text as string) ?? null;
  return null;
}
