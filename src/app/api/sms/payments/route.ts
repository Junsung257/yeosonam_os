/**
 * sms_payments 테이블 조회 & 수동 매칭 API
 *
 * GET  /api/sms/payments           - 전체 입금 내역 조회
 * PATCH /api/sms/payments          - 수동 매칭 (paymentId + bookingId)
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

export async function GET() {
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

    // 해당 예약의 paid_amount 누적 + payment_status 갱신
    const depositAmount = payment?.amount || 0;
    if (depositAmount > 0) {
      const { data: booking } = await supabase
        .from('bookings')
        .select('paid_amount, total_price')
        .eq('id', bookingId)
        .single();

      if (booking) {
        const newPaidAmount = (booking.paid_amount || 0) + depositAmount;
        const newPaymentStatus = newPaidAmount >= (booking.total_price || 0) && (booking.total_price || 0) > 0
          ? '완납'
          : '일부입금';

        await supabase
          .from('bookings')
          .update({
            paid_amount: newPaidAmount,
            payment_status: newPaymentStatus,
            ...(newPaymentStatus === '완납' ? { status: 'completed' } : {}),
            updated_at: new Date().toISOString(),
          })
          .eq('id', bookingId);
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
