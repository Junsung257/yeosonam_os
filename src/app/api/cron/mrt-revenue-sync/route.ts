/**
 * GET /api/cron/mrt-revenue-sync
 *
 * MRT 수익·예약 내역 자동 집계 + 세션 자동 매칭.
 *
 * 트리거: 매일 KST 01:30 (UTC 16:30 전일) — vercel.json 등록.
 *
 * 흐름:
 *   1. 최근 7일치 revenues + reservations 조회
 *   2. utmContent(= 세션 ID) 있는 항목 → free_travel_sessions 자동 매칭
 *   3. 매칭된 세션 status = 'booked', mrt_booking_ref 업데이트
 *   4. 집계 결과를 JSON으로 반환 (Slack 연동 예정)
 */

import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { getMrtRevenues, getMrtReservations } from '@/lib/mrt-partner-api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }
  if (!isSupabaseConfigured || !supabaseAdmin) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  const endDate   = new Date().toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);

  // ── 1. MRT API 조회 (병렬) ──────────────────────────────────────────────────
  const [revPage, resPage] = await Promise.all([
    getMrtRevenues({ startDate, endDate, pageSize: 100 }),
    getMrtReservations({ startDate, endDate, statuses: ['confirmed', 'completed'], pageSize: 100 }),
  ]);

  const revenues     = revPage?.items     ?? [];
  const reservations = resPage?.items     ?? [];

  // ── 2. utmContent로 세션 매칭 ────────────────────────────────────────────────
  const sessionIds = [
    ...revenues.map(r => r.utmContent).filter(Boolean) as string[],
    ...reservations.map(r => r.utmContent).filter(Boolean) as string[],
  ];
  const uniqueSessionIds = [...new Set(sessionIds)];

  let matched = 0;
  let errors  = 0;

  if (uniqueSessionIds.length > 0) {
    for (const sessionId of uniqueSessionIds) {
      // 예약 내역에서 해당 세션 찾기
      const rev = reservations.find(r => r.utmContent === sessionId);
      const rvn = revenues.find(r => r.utmContent === sessionId);

      const mrtRef  = rev?.reservationNo ?? rvn?.reservationNo ?? null;
      const newStatus = rev ? 'booked' : undefined;

      if (!mrtRef && !newStatus) continue;

      const updatePayload: Record<string, unknown> = {};
      if (mrtRef)     updatePayload.mrt_booking_ref = mrtRef;
      if (newStatus)  updatePayload.status          = newStatus;
      if (mrtRef)     updatePayload.booked_at       = rev?.reservedAt ?? rvn?.reservedAt ?? new Date().toISOString();

      const { error } = await supabaseAdmin
        .from('free_travel_sessions')
        .update(updatePayload)
        .eq('id', sessionId)
        .eq('status', 'new');  // status=new 인 세션만 업데이트 (이미 처리된 것 보호)

      if (error) {
        errors++;
      } else {
        matched++;
      }
    }
  }

  // ── 3. 집계 결과 ─────────────────────────────────────────────────────────────
  const totalCommission = revenues.reduce((s, r) => s + (r.commission ?? 0), 0);

  return NextResponse.json({
    ok: true,
    period:          { startDate, endDate },
    revenues:        revenues.length,
    reservations:    reservations.length,
    sessionMatched:  matched,
    errors,
    totalCommission,
  });
}
