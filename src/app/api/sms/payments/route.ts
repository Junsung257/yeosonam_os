/**
 * sms_payments 테이블 조회 & 수동 매칭 API
 *
 * GET  /api/sms/payments           - 전체 입금 내역 조회
 * PATCH /api/sms/payments          - 수동 매칭 (paymentId + bookingId)
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { isAdminRequest } from '@/lib/admin-guard';

export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'admin 권한 필요' }, { status: 403 });
  }
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });
  }

  const { data: payments, error } = await supabase
    .from('sms_payments')
    .select(`
      *,
      bookings (
        id,
        booking_no,
        package_title,
        customers!lead_customer_id(name)
      )
    `)
    .order('received_at', { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ payments: payments || [] });
}

export async function PATCH(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'admin 권한 필요' }, { status: 403 });
  }
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });
  }

  try {
    const { paymentId, bookingId } = await request.json();
    if (!paymentId || !bookingId) {
      return NextResponse.json({ error: 'paymentId, bookingId 필요' }, { status: 400 });
    }

    // sms_payments 업데이트
    const { data: payment, error: paymentError } = await supabase
      .from('sms_payments')
      .update({ booking_id: bookingId, status: 'manual', match_confidence: 1.0 })
      .eq('id', paymentId)
      .select('amount')
      .single();

    if (paymentError) throw paymentError;

    // Phase 2a — paid_amount 누적은 update_booking_ledger RPC 로 atomic + ledger 이중쓰기
    const depositAmount = payment?.amount || 0;
    if (depositAmount > 0) {
      const { error: rpcErr } = await supabase.rpc('update_booking_ledger', {
        p_booking_id: bookingId,
        p_paid_delta: depositAmount,
        p_payout_delta: 0,
        p_source: 'sms_payment',
        p_source_ref_id: paymentId,
        p_idempotency_key: `sms:manual:${paymentId}`,
        p_memo: 'SMS manual confirm',
        p_created_by: 'admin',
      });
      if (rpcErr) {
        return NextResponse.json({ error: rpcErr.message }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '처리 실패' },
      { status: 500 }
    );
  }
}
