/**
 * GET /api/cron/free-travel-retarget
 *
 * 자유여행 견적 Abandoned-Cart 리타게팅 크론.
 *
 * 트리거: 매일 KST 10:00 (UTC 01:00) — vercel.json 등록.
 *
 * 조건:
 *   - free_travel_sessions.status = 'new'
 *   - 생성 2h~24h 이내 (2h: 너무 빠른 발송 방지, 24h: stale 제외)
 *   - customer_phone IS NOT NULL
 *   - admin_notes NOT LIKE '%retarget_sent%' (중복 방지)
 *
 * 알림톡 링크: /free-travel?session={세션id} (저장 견적 복원)
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { sendFreeTravelRetarget } from '@/lib/kakao';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET;
const BASE_URL    = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://yeosonam.com';

interface FtsRow {
  id:              string;
  destination:     string;
  customer_phone:  string;
  customer_name:   string | null;
  admin_notes:     string | null;
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: '인증 실패' }, { status: 401 });
  }
  if (!isSupabaseConfigured || !supabaseAdmin) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  const now   = new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(); // 24h 전
  const until = new Date(now.getTime() -  2 * 60 * 60 * 1000).toISOString(); // 2h 전

  const { data: sessions, error } = await supabaseAdmin
    .from('free_travel_sessions')
    .select('id, destination, customer_phone, customer_name, admin_notes')
    .eq('status', 'new')
    .not('customer_phone', 'is', null)
    .gt('created_at', since)
    .lt('created_at', until)
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const targets = ((sessions ?? []) as FtsRow[]).filter(
    s => !s.admin_notes?.includes('retarget_sent'),
  );

  if (targets.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, reason: '대상 없음' });
  }

  let sent = 0;
  let failed = 0;

  for (const session of targets) {
    const plannerUrl = `${BASE_URL}/free-travel?session=${encodeURIComponent(session.id)}`;
    try {
      await sendFreeTravelRetarget({
        phone:       session.customer_phone,
        name:        session.customer_name ?? undefined,
        destination: session.destination,
        plannerUrl,
      });

      // 발송 기록 (중복 방지 플래그)
      const prevNotes = session.admin_notes ?? '';
      await supabaseAdmin
        .from('free_travel_sessions')
        .update({
          admin_notes: prevNotes
            ? `${prevNotes} | retarget_sent:${now.toISOString().slice(0, 10)}`
            : `retarget_sent:${now.toISOString().slice(0, 10)}`,
        })
        .eq('id', session.id);

      sent++;
    } catch {
      failed++;
    }

    // Rate-limit 방어: 300ms 간격
    await new Promise(r => setTimeout(r, 300));
  }

  return NextResponse.json({ ok: true, sent, failed, total: targets.length });
}
