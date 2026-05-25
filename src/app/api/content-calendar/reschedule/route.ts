/**
 * POST /api/content-calendar/reschedule
 *
 * 캘린더 드래그 앤 드롭 → 예약 일정 변경
 *
 * Body:
 *   { id, source: 'card_news' | 'distribution', platform: string, scheduled_for: string }
 *
 * source='card_news' 이면:
 *   - platform='instagram' → card_news.ig_scheduled_for 업데이트
 *   - platform='threads'   → card_news.threads_scheduled_for 업데이트
 *   - 동시에 ig_publish_status='queued' / threads_publish_status='queued' 로 변경 (재예약)
 *
 * source='distribution' 이면:
 *   - content_distributions.scheduled_for 업데이트
 *   - status='scheduled' 로 변경
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  try {
    const body = await request.json();
    const { id, source, platform, scheduled_for } = body;

    if (!id || !source || !scheduled_for) {
      return NextResponse.json(
        { error: '필수 필드 누락: id, source, scheduled_for' },
        { status: 400 },
      );
    }

    if (!['card_news', 'distribution'].includes(source)) {
      return NextResponse.json({ error: 'source 는 card_news 또는 distribution' }, { status: 400 });
    }

    const newDate = new Date(scheduled_for);
    if (isNaN(newDate.getTime())) {
      return NextResponse.json({ error: 'scheduled_for 가 유효한 날짜가 아닙니다' }, { status: 400 });
    }

    const scheduledIso = newDate.toISOString();

    if (source === 'card_news') {
      // card_news 예약 시간 업데이트
      const updateData: Record<string, unknown> = {};

      if (platform === 'instagram' || !platform) {
        updateData.ig_scheduled_for = scheduledIso;
        updateData.ig_publish_status = 'queued';
        updateData.ig_error = null;
      }
      if (platform === 'threads' || !platform) {
        updateData.threads_scheduled_for = scheduledIso;
        updateData.threads_publish_status = 'queued';
        updateData.threads_error = null;
      }

      const { error } = await supabaseAdmin
        .from('card_news')
        .update(updateData)
        .eq('id', id);

      if (error) throw error;

      return NextResponse.json({
        success: true,
        source: 'card_news',
        id,
        updated: updateData,
      });
    } else {
      // content_distributions 업데이트
      const { error } = await supabaseAdmin
        .from('content_distributions')
        .update({
          scheduled_for: scheduledIso,
          status: 'scheduled',
          error_message: null,
        })
        .eq('id', id);

      if (error) throw error;

      return NextResponse.json({
        success: true,
        source: 'distribution',
        id,
        scheduled_for: scheduledIso,
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
