import { NextRequest, NextResponse } from 'next/server';
import { getSecret } from '@/lib/secret-registry';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabase';
import { classifySearchIntent, intentPriorityDelta } from '@/lib/blog-search-intent';
import { computeSeasonalTargetPublishAt } from '@/lib/blog-season-publish';
import { attachTopicFitMeta, evaluateBlogTopicFit } from '@/lib/blog-topic-fit-gate';
import { normalizeBlogTopicQueueRow } from '@/lib/blog-queue-normalize';
import { getBlogQueueOperationalState } from '@/lib/blog-queue-operational-health';

/** 서버에서 자기 호스트 크론 URL 호출 시 CRON_SECRET 전달 (프로덕션에서 발행자·트렌드 마이너 401 방지) */
async function fetchCronEndpoint(path: string): Promise<Response> {
  const base = (process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
  const headers: Record<string, string> = {};
  const secret = getSecret('CRON_SECRET');
  if (secret) headers.Authorization = `Bearer ${secret}`;
  return fetch(`${base}${path}`, { headers });
}

/**
 * 블로그 자동 발행 큐 관리 API
 *   GET  /api/blog/queue              → 큐 목록 (status 필터)
 *   POST /api/blog/queue   (action=run_scheduler)     → 스케줄러 즉시 실행
 *   POST /api/blog/queue   (action=run_publisher)     → 발행자 즉시 실행
 *   PATCH /api/blog/queue  { id, priority?, status? } → 항목 수정
 *   DELETE /api/blog/queue?id=xxx                     → 큐에서 제거
 */

type QueueScope = 'active' | 'attention' | 'manual' | 'history' | 'all';

const EMPTY_QUEUE_RESPONSE = {
  items: [],
  total: 0,
  counts: {},
  summary: {
    scope: 'active' as QueueScope,
    total_rows: 0,
    returned: 0,
    active_count: 0,
    attention_count: 0,
    manual_review_count: 0,
    retryable_failed_count: 0,
    history_hidden: 0,
    overdue_queued: 0,
    stale_generating: 0,
    issue_counts: {},
  },
};

function isQueueHistory(row: any, now = new Date()): boolean {
  return getBlogQueueOperationalState(row, now).history;
}

function isManualReviewQueue(row: any): boolean {
  return getBlogQueueOperationalState(row).manualReview;
}

function enrichQueueItem(row: any, now = new Date()) {
  const state = getBlogQueueOperationalState(row, now);
  const manualReview = state.manualReview;
  const attention = state.attention;
  const history = state.history;
  const target = row.target_publish_at ? new Date(row.target_publish_at) : null;
  const urgency =
    manualReview ? 'manual_review'
    : row.status === 'failed' ? 'blocked'
    : row.status === 'generating' && attention ? 'stale'
    : target && target < now ? 'overdue'
    : history ? 'history'
    : 'normal';
  return {
    ...row,
    ops: {
      attention,
      history,
      manual_review: manualReview,
      urgency,
      issue: state.issue,
      action: state.action,
      retryable: state.retryable,
      terminal: state.terminal,
    },
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const status = searchParams.get('status');
  const scope = (searchParams.get('scope') || (status ? 'all' : 'active')) as QueueScope;
  const source = searchParams.get('source');
  const q = searchParams.get('q')?.trim().toLowerCase() || '';
  const age = searchParams.get('age') || 'all';
  const limit = Math.min(300, parseInt(searchParams.get('limit') ?? '120'));
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({
      ...EMPTY_QUEUE_RESPONSE,
      summary: { ...EMPTY_QUEUE_RESPONSE.summary, scope },
    });
  }

  try {
    let query = supabaseAdmin
      .from('blog_topic_queue')
      .select('*', { count: 'exact' })
      .order('target_publish_at', { ascending: true, nullsFirst: false })
      .order('priority', { ascending: false })
      .limit(500);

    if (status && status !== 'all') query = query.eq('status', status);
    if (source && source !== 'all') query = query.eq('source', source);

    const { data, count, error } = await query;
    if (error) throw error;

    // 간단 집계
    const { data: stats } = await supabaseAdmin
      .from('blog_topic_queue')
      .select('status', { count: 'exact' });

    const counts: Record<string, number> = {};
    (stats || []).forEach((r: any) => {
      counts[r.status] = (counts[r.status] || 0) + 1;
    });

    const now = new Date();
    const enriched = (data || []).map((row: any) => enrichQueueItem(row, now));
    let filtered = enriched;

    if (scope === 'active') filtered = filtered.filter((row: any) => !row.ops.history && !row.ops.manual_review && ['queued', 'generating', 'failed'].includes(row.status));
    if (scope === 'attention') filtered = filtered.filter((row: any) => row.ops.attention && !row.ops.manual_review);
    if (scope === 'manual') filtered = filtered.filter((row: any) => row.ops.manual_review);
    if (scope === 'history') filtered = filtered.filter((row: any) => row.ops.history);
    if (q) {
      filtered = filtered.filter((row: any) => {
        const haystack = [row.topic, row.destination, row.primary_keyword, row.source, row.last_error].filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(q);
      });
    }
    if (age !== 'all') {
      const createdAt = (row: any) => row.created_at ? new Date(row.created_at).getTime() : 0;
      const dayMs = 24 * 60 * 60 * 1000;
      if (age === 'today') filtered = filtered.filter((row: any) => now.getTime() - createdAt(row) <= dayMs);
      if (age === '7d') filtered = filtered.filter((row: any) => now.getTime() - createdAt(row) <= 7 * dayMs);
      if (age === '30d') filtered = filtered.filter((row: any) => now.getTime() - createdAt(row) <= 30 * dayMs);
      if (age === 'stale') filtered = filtered.filter((row: any) => row.ops.history || row.ops.urgency === 'stale' || row.ops.urgency === 'overdue');
    }

    const issueCounts: Record<string, number> = {};
    enriched.forEach((row: any) => {
      if (!row.ops.attention || row.ops.manual_review) return;
      issueCounts[row.ops.issue] = (issueCounts[row.ops.issue] || 0) + 1;
    });

    const summary = {
      scope,
      total_rows: count ?? enriched.length,
      returned: Math.min(filtered.length, limit),
      active_count: enriched.filter((row: any) => !row.ops.history && !row.ops.manual_review && ['queued', 'generating', 'failed'].includes(row.status)).length,
      attention_count: enriched.filter((row: any) => row.ops.attention && !row.ops.manual_review).length,
      manual_review_count: enriched.filter((row: any) => row.ops.manual_review).length,
      retryable_failed_count: enriched.filter((row: any) => row.status === 'failed' && !row.ops.manual_review).length,
      history_hidden: enriched.filter((row: any) => row.ops.history).length,
      overdue_queued: enriched.filter((row: any) => row.ops.urgency === 'overdue').length,
      stale_generating: enriched.filter((row: any) => row.ops.urgency === 'stale').length,
      issue_counts: issueCounts,
    };

    return NextResponse.json({ items: filtered.slice(0, limit), total: filtered.length, counts, summary });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '조회 실패' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!isSupabaseAdminConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  try {
    const body = await request.json();
    const action = body.action;

    if (action === 'run_scheduler') {
      const res = await fetchCronEndpoint('/api/cron/blog-scheduler');
      const data = await res.json();
      return NextResponse.json({ triggered: 'scheduler', result: data });
    }

    if (action === 'run_publisher') {
      const res = await fetchCronEndpoint('/api/cron/blog-publisher');
      const data = await res.json();
      return NextResponse.json({ triggered: 'publisher', result: data });
    }

    if (action === 'run_lifecycle') {
      const res = await fetchCronEndpoint('/api/cron/blog-lifecycle');
      const data = await res.json();
      return NextResponse.json({ triggered: 'lifecycle', result: data });
    }

    if (action === 'run_trend_miner') {
      const res = await fetchCronEndpoint('/api/cron/trend-topic-miner');
      const data = await res.json();
      return NextResponse.json({ triggered: 'trend_miner', result: data });
    }

    // 카드뉴스로부터 블로그 큐에 투입 (linked_blog_id 없는 CONFIRMED 카드뉴스만)
    if (action === 'enqueue_from_card_news') {
      const { card_news_id, target_publish_at } = body;
      if (!card_news_id) return NextResponse.json({ error: 'card_news_id 필수' }, { status: 400 });

      const { data: cn } = await supabaseAdmin
        .from('card_news')
        .select('id, package_id, slide_image_urls, linked_blog_id, status, slides')
        .eq('id', card_news_id)
        .limit(1);

      if (!cn?.[0]) return NextResponse.json({ error: '카드뉴스 없음' }, { status: 404 });
      if (cn[0].linked_blog_id) {
        return NextResponse.json({ error: '이미 연결된 블로그 있음', linked_blog_id: cn[0].linked_blog_id }, { status: 409 });
      }
      if (!cn[0].slide_image_urls || (cn[0].slide_image_urls as string[]).length === 0) {
        return NextResponse.json({
          error: '카드뉴스 PNG 렌더링 전. 어드민 /marketing/card-news/[id] 에서 "확정+블로그 생성" 먼저 실행.',
        }, { status: 400 });
      }

      const slides = cn[0].slides as Array<{ headline?: string }>;
      const topic = slides?.[0]?.headline || `카드뉴스 기반 블로그 ${card_news_id.slice(0, 8)}`;

      const queueRow = normalizeBlogTopicQueueRow(attachTopicFitMeta({
        topic,
        source: 'card_news',
        priority: 85,
        product_id: cn[0].package_id ?? null,
        card_news_id: card_news_id,
        target_publish_at: target_publish_at ?? new Date().toISOString(),
        meta: { slide_count: (cn[0].slide_image_urls as string[]).length },
      }));
      const topicFit = queueRow.meta?.topic_fit_gate as ReturnType<typeof evaluateBlogTopicFit> | undefined;
      if (!topicFit?.passed) {
        return NextResponse.json({ error: 'topic_fit_failed', topic_fit_gate: topicFit }, { status: 422 });
      }

      const { data, error } = await supabaseAdmin.from('blog_topic_queue').insert(queueRow).select();

      if (error) throw error;
      return NextResponse.json({ item: data?.[0] });
    }

    // 수동 토픽 추가
    if (action === 'add_topic') {
      const { topic, destination, angle_type, category, target_publish_at, priority, seasonal_month } = body;
      if (!topic) return NextResponse.json({ error: 'topic 필수' }, { status: 400 });

      // 검색 의도 분류 → 우선순위 보정 (informational +5, commercial -2)
      const intent = classifySearchIntent(topic + (destination ?? ''));
      const basePriority = typeof priority === 'number' ? priority : 90;
      const effectivePriority = Math.max(1, Math.min(100, basePriority + intentPriorityDelta(intent)));

      // 시즌성 목표 발행 시각 (seasonal_month 있으면 D-60 계산, 없으면 수동 입력값 또는 null)
      const resolvedPublishAt =
        target_publish_at ??
        computeSeasonalTargetPublishAt(seasonal_month) ??
        new Date().toISOString();

      const queueRow = normalizeBlogTopicQueueRow(attachTopicFitMeta({
        topic,
        source: 'user_seed',
        priority: effectivePriority,
        destination: destination ?? null,
        angle_type: angle_type ?? null,
        category: category ?? null,
        target_publish_at: resolvedPublishAt,
        search_intent: intent,
      }));
      const topicFit = queueRow.meta?.topic_fit_gate as ReturnType<typeof evaluateBlogTopicFit> | undefined;
      if (!topicFit?.passed) {
        return NextResponse.json({ error: 'topic_fit_failed', topic_fit_gate: topicFit }, { status: 422 });
      }

      const { data, error } = await supabaseAdmin.from('blog_topic_queue').insert(queueRow).select();
      if (error) throw error;
      return NextResponse.json({ item: data?.[0] });
    }

    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '실행 실패' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!isSupabaseAdminConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  try {
    const { id, priority, status, target_publish_at, action } = await request.json();
    if (!id) return NextResponse.json({ error: 'id 필수' }, { status: 400 });

    const update: Record<string, unknown> = {};
    if (action === 'requeue') {
      update.status = 'queued';
      update.attempts = 0;
      update.last_error = null;
      update.target_publish_at = target_publish_at ?? new Date().toISOString();
    }
    if (action === 'hide') {
      update.status = 'skipped';
    }
    if (priority !== undefined) update.priority = priority;
    if (status !== undefined) update.status = status;
    if (target_publish_at !== undefined) update.target_publish_at = target_publish_at;

    const { data, error } = await supabaseAdmin
      .from('blog_topic_queue')
      .update(update)
      .eq('id', id)
      .select();

    if (error) throw error;
    return NextResponse.json({ item: data?.[0] });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '수정 실패' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!isSupabaseAdminConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id 필수' }, { status: 400 });

  try {
    const { error } = await supabaseAdmin.from('blog_topic_queue').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '삭제 실패' }, { status: 500 });
  }
}
