import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

/** 서버에서 자기 호스트 크론 URL 호출 시 CRON_SECRET 전달 (프로덕션에서 발행자·트렌드 마이너 401 방지) */
async function fetchCronEndpoint(path: string): Promise<Response> {
  const base = (process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
  const headers: Record<string, string> = {};
  const secret = process.env.CRON_SECRET;
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

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ items: [] });

  const { searchParams } = request.nextUrl;
  const status = searchParams.get('status');
  const limit = Math.min(200, parseInt(searchParams.get('limit') ?? '100'));

  try {
    let query = supabaseAdmin
      .from('blog_topic_queue')
      .select('*', { count: 'exact' })
      .order('target_publish_at', { ascending: true, nullsFirst: false })
      .order('priority', { ascending: false })
      .limit(limit);

    if (status && status !== 'all') query = query.eq('status', status);

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

    return NextResponse.json({ items: data || [], total: count ?? 0, counts });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '조회 실패' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  try {
    const body = await request.json();
    const action = body.action;

    if (action === 'run_scheduler') {
      const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/cron/blog-scheduler`);
      const data = await res.json();
      return NextResponse.json({ triggered: 'scheduler', result: data });
    }

    if (action === 'run_publisher') {
      const res = await fetchCronEndpoint('/api/cron/blog-publisher');
      const data = await res.json();
      return NextResponse.json({ triggered: 'publisher', result: data });
    }

    if (action === 'run_lifecycle') {
      const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/cron/blog-lifecycle`);
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

      const { data, error } = await supabaseAdmin.from('blog_topic_queue').insert({
        topic,
        source: 'card_news',
        priority: 85,
        product_id: cn[0].package_id ?? null,
        card_news_id: card_news_id,
        target_publish_at: target_publish_at ?? null,
        meta: { slide_count: (cn[0].slide_image_urls as string[]).length },
      }).select();

      if (error) throw error;
      return NextResponse.json({ item: data?.[0] });
    }

    // 수동 토픽 추가
    if (action === 'add_topic') {
      const { topic, destination, angle_type, category, target_publish_at, priority } = body;
      if (!topic) return NextResponse.json({ error: 'topic 필수' }, { status: 400 });

      const { data, error } = await supabaseAdmin.from('blog_topic_queue').insert({
        topic,
        source: 'user_seed',
        priority: priority ?? 90,
        destination: destination ?? null,
        angle_type: angle_type ?? null,
        category: category ?? null,
        target_publish_at: target_publish_at ?? null,
      }).select();
      if (error) throw error;
      return NextResponse.json({ item: data?.[0] });
    }

    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '실행 실패' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  try {
    const { id, priority, status, target_publish_at } = await request.json();
    if (!id) return NextResponse.json({ error: 'id 필수' }, { status: 400 });

    const update: Record<string, unknown> = {};
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
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
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
