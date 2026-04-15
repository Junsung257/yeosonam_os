import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

/**
 * 블로그 체류 시간 / 스크롤 깊이 / CTA 클릭 수집
 * - BlogTracker에서 beforeunload/sendBeacon 호출
 */
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ ok: true, skipped: true });

  try {
    const body = await request.json();
    const { content_creative_id, session_id, user_id, time_on_page_seconds, max_scroll_depth_pct, cta_clicked } = body;

    if (!content_creative_id) {
      return NextResponse.json({ error: 'content_creative_id 필수' }, { status: 400 });
    }

    await supabaseAdmin.from('blog_engagement_logs').insert({
      content_creative_id,
      session_id: session_id || null,
      user_id: user_id || null,
      time_on_page_seconds: typeof time_on_page_seconds === 'number' ? Math.max(0, Math.min(3600, time_on_page_seconds)) : null,
      max_scroll_depth_pct: typeof max_scroll_depth_pct === 'number' ? Math.max(0, Math.min(100, Math.round(max_scroll_depth_pct))) : null,
      cta_clicked: !!cta_clicked,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[blog-engagement] 오류:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : '저장 실패' }, { status: 500 });
  }
}
