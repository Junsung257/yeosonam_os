/**
 * @file /api/admin/fraud-quarantine/route.ts
 * @description fraud_signals_log 어드민 API — GET 목록, POST resolve.
 *
 * 박제 (2026-05-13 Phase 9 Final):
 * AA-1 자동 격리된 booking 을 사장님이 한 화면에서 검토 + 1-click resolve.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withAdminGuard } from '@/lib/admin-guard';

async function getHandler(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });

  const url = new URL(request.url);
  const status = url.searchParams.get('status') ?? 'unresolved'; // unresolved | resolved | all

  try {
    let query = supabaseAdmin
      .from('fraud_signals_log')
      .select(`
        id, booking_id, detected_at, severity, signal_codes, signal_descs,
        auto_action, resolved_at, resolved_by, notes,
        bookings!booking_id (
          id, booking_no, total_price, status, departure_date,
          internal_memo, lead_customer_id,
          customers!lead_customer_id ( name, phone )
        )
      `)
      .order('detected_at', { ascending: false })
      .limit(100);

    if (status === 'unresolved') query = query.is('resolved_at', null);
    else if (status === 'resolved') query = query.not('resolved_at', 'is', null);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ items: data ?? [] });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/** POST: 격리 해결 (resolved_at + resolved_by + notes) */
async function postHandler(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });
  try {
    const body = await request.json() as { id?: number; action?: 'resolve' | 'unresolve' | 'block'; resolved_by?: string; notes?: string };
    if (!body.id) return NextResponse.json({ error: 'id 필수' }, { status: 400 });

    if (body.action === 'unresolve') {
      const { error } = await supabaseAdmin
        .from('fraud_signals_log')
        .update({ resolved_at: null, resolved_by: null, notes: body.notes ?? null })
        .eq('id', body.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, action: 'unresolved' });
    }

    if (body.action === 'block') {
      // 1) fraud_signals_log: action=blocked 로 marker 후 resolved 처리
      const { data: signalRow } = await supabaseAdmin
        .from('fraud_signals_log')
        .select('booking_id')
        .eq('id', body.id)
        .maybeSingle();
      const bookingId = (signalRow as { booking_id?: string } | null)?.booking_id;

      const { error: updateLogErr } = await supabaseAdmin
        .from('fraud_signals_log')
        .update({
          auto_action: 'blocked',
          resolved_at: new Date().toISOString(),
          resolved_by: body.resolved_by ?? 'admin',
          notes: body.notes ?? '사장님 차단 결정',
        })
        .eq('id', body.id);
      if (updateLogErr) return NextResponse.json({ error: updateLogErr.message }, { status: 500 });

      // 2) booking status='cancelled' (block 의미 — 운영적 취소)
      if (bookingId) {
        await supabaseAdmin
          .from('bookings')
          .update({ status: 'cancelled', updated_at: new Date().toISOString() })
          .eq('id', bookingId);
      }
      return NextResponse.json({ ok: true, action: 'blocked', booking_id: bookingId });
    }

    // 기본: resolve (false positive 또는 해결)
    const { error } = await supabaseAdmin
      .from('fraud_signals_log')
      .update({
        resolved_at: new Date().toISOString(),
        resolved_by:  body.resolved_by ?? 'admin',
        notes:       body.notes ?? null,
      })
      .eq('id', body.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, action: 'resolved' });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export const GET = withAdminGuard(getHandler);
export const POST = withAdminGuard(postHandler);
