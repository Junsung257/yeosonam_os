import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { getBookingPortalSessionFromRequest } from '@/lib/booking-portal-request-auth';

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: '서버 설정 오류' }, { status: 503 });
  }

  const session = await getBookingPortalSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: '세션이 필요합니다. 링크를 다시 여세요.' }, { status: 401 });
  }

  const [{ data, error }, pausedRes] = await Promise.all([
    supabaseAdmin
      .from('booking_concierge_messages')
      .select('id, role, content, created_at')
      .eq('booking_id', session.bookingId)
      .order('created_at', { ascending: true })
      .limit(300),
    supabaseAdmin
      .from('bookings')
      .select('concierge_ai_paused')
      .eq('id', session.bookingId)
      .maybeSingle(),
  ]);

  if (error) {
    console.error('[booking-concierge/messages]', error);
    return NextResponse.json({ error: '메시지를 불러오지 못했습니다.' }, { status: 500 });
  }

  let aiPaused = false;
  if (pausedRes.error) {
    console.warn('[booking-concierge/messages] aiPaused 조회 생략:', pausedRes.error.message);
  } else {
    aiPaused = Boolean((pausedRes.data as { concierge_ai_paused?: boolean } | null)?.concierge_ai_paused);
  }

  return NextResponse.json({ messages: data ?? [], aiPaused });
}
