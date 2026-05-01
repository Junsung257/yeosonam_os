import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin, createMessageLog } from '@/lib/supabase';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }
  try {
    const body = await request.json();
    const refundAmount  = typeof body.refund_amount  === 'number' ? body.refund_amount  : 0;
    const penaltyFee    = typeof body.penalty_fee    === 'number' ? body.penalty_fee    : 0;
    const cancelReason  = (body.reason as string) || '관리자 취소';

    // 현재 예약 조회 (이미 취소된 경우 방지)
    const { data: current, error: selectErr } = await supabaseAdmin
      .from('bookings')
      .select('id, booking_no, status')
      .eq('id', params.id)
      .single();
    if (selectErr) {
      console.error('[cancel] select error:', selectErr);
      return NextResponse.json({ error: `예약 조회 실패: ${selectErr.message}` }, { status: 500 });
    }

    if (!current) {
      return NextResponse.json({ error: '예약을 찾을 수 없습니다.' }, { status: 404 });
    }
    if ((current as { status: string }).status === 'cancelled') {
      return NextResponse.json({ error: '이미 취소된 예약입니다.' }, { status: 422 });
    }

    // bookings 업데이트
    const { data: booking, error: updateErr } = await supabaseAdmin
      .from('bookings')
      .update({
        status:       'cancelled',
        refund_amount: refundAmount,
        penalty_fee:   penaltyFee,
        cancel_reason: cancelReason,
        cancelled_at:  new Date().toISOString(),
        updated_at:    new Date().toISOString(),
      })
      .eq('id', params.id)
      .select()
      .single();

    if (updateErr) {
      console.error('[cancel] update error:', updateErr);
      return NextResponse.json({ error: `취소 처리 실패: ${updateErr.message}` }, { status: 500 });
    }

    // CANCELLATION 로그 생성
    const logContent = [
      cancelReason,
      refundAmount > 0 ? `환불액: ${refundAmount.toLocaleString()}원` : null,
      penaltyFee   > 0 ? `위약금: ${penaltyFee.toLocaleString()}원`   : null,
    ].filter(Boolean).join(' | ');

    await createMessageLog({
      booking_id: params.id,
      log_type:   'system',
      event_type: 'CANCELLATION',
      title:      '예약 취소 처리',
      content:    logContent,
      is_mock:    false,
      created_by: 'admin',
    });

    // 기존 Void 연쇄 처리 (fire-and-forget)
    (async () => {
      try {
        const { voidBooking } = await import('@/lib/supabase');
        await voidBooking(params.id, cancelReason);
      } catch (e) {
        console.warn('[Void 처리 실패]', e);
      }
    })();

    // booking_tasks 연쇄 종결 (fire-and-forget — 실패해도 취소는 성공)
    (async () => {
      try {
        const { supabaseAdmin } = await import('@/lib/supabase');
        const { data: superseded } = await supabaseAdmin.rpc('supersede_booking_tasks', {
          p_booking_id: params.id,
          p_reason: 'booking_cancelled',
        });
        if (typeof superseded === 'number' && superseded > 0) {
          console.log(`[booking-tasks/supersede] ${params.id} → ${superseded}건 종결`);
        }
      } catch (e) {
        console.warn('[booking-tasks/supersede 실패]', e);
      }
    })();

    return NextResponse.json({ booking });
  } catch (error) {
    console.error('[cancel] unexpected error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? `${error.name}: ${error.message}` : '취소 처리 실패' },
      { status: 500 }
    );
  }
}
