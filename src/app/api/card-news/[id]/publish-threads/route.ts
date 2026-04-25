import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import {
  publishToThreads,
  isThreadsConfigured,
  getThreadsConfig,
} from '@/lib/threads-publisher';

export const maxDuration = 120;

/**
 * POST /api/card-news/[id]/publish-threads
 *
 * Body:
 *   when: 'now' | 'scheduled'
 *   scheduled_for?: ISO (when='scheduled' 필수)
 *   text: string (≤ 500자)
 *   image_urls?: string[] (선택, 20장 이내 — 카드뉴스 렌더 PNG 재사용)
 *
 * 동작:
 *   - when='now' → 즉시 Threads Graph API 호출 (동기, 캐러셀 1~2분)
 *   - when='scheduled' → DB queued, /api/cron/publish-scheduled 가 매시간 처리
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }
  const { id } = params;

  try {
    const body = await request.json();
    const { when, scheduled_for, text, image_urls } = body as {
      when: 'now' | 'scheduled';
      scheduled_for?: string;
      text: string;
      image_urls?: string[];
    };

    if (!text || !text.trim()) {
      return NextResponse.json({ error: '본문 필수' }, { status: 400 });
    }
    if (text.length > 500) {
      return NextResponse.json({ error: `본문 500자 초과 (${text.length}자)` }, { status: 400 });
    }
    if (when !== 'now' && when !== 'scheduled') {
      return NextResponse.json({ error: 'when은 now 또는 scheduled' }, { status: 400 });
    }
    if (when === 'scheduled' && !scheduled_for) {
      return NextResponse.json({ error: '예약 발행은 scheduled_for 필수' }, { status: 400 });
    }

    const urls = Array.isArray(image_urls) ? image_urls.filter(u => typeof u === 'string' && u.length > 0) : [];
    if (urls.length > 20) {
      return NextResponse.json({ error: `이미지 20장 초과 (${urls.length}장)` }, { status: 400 });
    }
    const nonPublic = urls.find(u => !u.startsWith('http://') && !u.startsWith('https://'));
    if (nonPublic) {
      return NextResponse.json({ error: '이미지가 공개 https URL 이 아닙니다' }, { status: 400 });
    }

    // 카드뉴스 존재 확인
    const { data: cn, error: cnErr } = await supabaseAdmin
      .from('card_news')
      .select('id, title, threads_publish_status')
      .eq('id', id)
      .single();
    if (cnErr || !cn) {
      return NextResponse.json({ error: '카드뉴스 없음' }, { status: 404 });
    }

    // ── 예약 ────────────────────────────────────────────────
    if (when === 'scheduled') {
      const scheduledAt = new Date(scheduled_for!);
      if (isNaN(scheduledAt.getTime())) {
        return NextResponse.json({ error: 'scheduled_for 파싱 실패' }, { status: 400 });
      }
      const { error } = await supabaseAdmin
        .from('card_news')
        .update({
          threads_publish_status: 'queued',
          threads_scheduled_for: scheduledAt.toISOString(),
          threads_text: text,
          threads_media_urls: urls.length > 0 ? urls : null,
          threads_error: null,
        })
        .eq('id', id);
      if (error) throw error;
      return NextResponse.json({
        ok: true,
        mode: 'scheduled',
        scheduled_for: scheduledAt.toISOString(),
      });
    }

    // ── 즉시 발행 ──────────────────────────────────────────
    if (!isThreadsConfigured()) {
      return NextResponse.json(
        { error: 'THREADS_ACCESS_TOKEN 또는 THREADS_USER_ID 미설정' },
        { status: 503 },
      );
    }
    const cfg = await getThreadsConfig();
    if (!cfg) {
      return NextResponse.json(
        { error: 'Threads 토큰 조회 실패 (env/DB 모두 비어있음)' },
        { status: 503 },
      );
    }

    await supabaseAdmin
      .from('card_news')
      .update({
        threads_publish_status: 'publishing',
        threads_text: text,
        threads_media_urls: urls.length > 0 ? urls : null,
        threads_error: null,
      })
      .eq('id', id);

    const result = await publishToThreads({
      threadsUserId: cfg.threadsUserId,
      accessToken: cfg.accessToken,
      text,
      imageUrls: urls.length > 0 ? urls : undefined,
    });

    if (!result.ok) {
      await supabaseAdmin
        .from('card_news')
        .update({
          threads_publish_status: 'failed',
          threads_error: `[${result.step}] ${result.error}`,
        })
        .eq('id', id);
      return NextResponse.json(
        { ok: false, step: result.step, error: result.error },
        { status: 500 },
      );
    }

    await supabaseAdmin
      .from('card_news')
      .update({
        threads_publish_status: 'published',
        threads_post_id: result.postId,
        threads_published_at: new Date().toISOString(),
        threads_error: null,
      })
      .eq('id', id);

    return NextResponse.json({ ok: true, mode: 'now', post_id: result.postId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[publish-threads] unexpected', msg);
    try {
      await supabaseAdmin
        .from('card_news')
        .update({ threads_publish_status: 'failed', threads_error: msg })
        .eq('id', id);
    } catch { /* noop */ }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
