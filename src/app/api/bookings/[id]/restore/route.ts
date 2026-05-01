import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin, createMessageLog } from '@/lib/supabase';

/**
 * 취소된 예약 복구 (Restore)
 *
 * 동작:
 * - status = 'pending' (paid_amount > 0 이면 'confirmed' 권장)
 * - voided_at, void_reason 클리어 (활성 행으로 복귀)
 * - cancelled_at, cancel_reason, refund_amount, penalty_fee 는 보존 (이력 추적)
 * - settlements VOID → PENDING 복원 (현재 정산 기간 한정)
 * - message_logs RESTORATION 이벤트
 * - audit_logs BOOKING_RESTORE
 *
 * 데이터 손실 없음 — 복구 후에도 cancelled_at, cancel_reason 은 남아 "이 예약은 한 번 취소됐다 복구됨"을 알 수 있음.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }
  try {
    const body = await request.json().catch(() => ({}));
    const restoreReason  = (body.reason as string) || '관리자 복구';
    const targetStatusIn = body.status as string | undefined;

    // 현재 예약 조회
    const { data: current, error: selectErr } = await supabaseAdmin
      .from('bookings')
      .select('id, booking_no, status, paid_amount, cancelled_at, refund_amount, penalty_fee, affiliate_id')
      .eq('id', params.id)
      .single();
    if (selectErr) {
      console.error('[restore] select error:', selectErr);
      return NextResponse.json({ error: `예약 조회 실패: ${selectErr.message}` }, { status: 500 });
    }

    if (!current) {
      return NextResponse.json({ error: '예약을 찾을 수 없습니다.' }, { status: 404 });
    }
    const cur = current as unknown as {
      id: string; booking_no?: string; status: string;
      paid_amount?: number; cancelled_at?: string | null;
      refund_amount?: number; penalty_fee?: number;
      affiliate_id?: string | null;
    };
    if (cur.status !== 'cancelled') {
      return NextResponse.json({ error: '취소 상태인 예약만 복구할 수 있습니다.' }, { status: 422 });
    }

    // 복구 status 결정: 명시 > 입금이 있으면 'confirmed' > 없으면 'pending'
    const targetStatus =
      (targetStatusIn === 'pending' || targetStatusIn === 'confirmed' || targetStatusIn === 'waiting_deposit'
        || targetStatusIn === 'deposit_paid' || targetStatusIn === 'waiting_balance' || targetStatusIn === 'fully_paid')
        ? targetStatusIn
        : ((cur.paid_amount ?? 0) > 0 ? 'confirmed' : 'pending');

    // bookings UPDATE — voided_at·void_reason 만 클리어. 취소 이력은 보존.
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('bookings')
      .update({
        status:      targetStatus,
        voided_at:   null,
        void_reason: null,
        updated_at:  new Date().toISOString(),
      } as never)
      .eq('id', params.id)
      .select()
      .single();

    if (updateErr) {
      console.error('[restore] update error:', updateErr);
      return NextResponse.json({ error: `복구 처리 실패: ${updateErr.message}` }, { status: 500 });
    }

    // RESTORATION 로그
    const before = {
      status: 'cancelled',
      cancelled_at:  cur.cancelled_at,
      refund_amount: cur.refund_amount,
      penalty_fee:   cur.penalty_fee,
    };
    const after = { status: targetStatus, voided_at: null };

    await createMessageLog({
      booking_id: params.id,
      log_type:   'system',
      event_type: 'MANUAL_MEMO',
      title:      '예약 복구 처리',
      content:    `${restoreReason} | 복구 status: ${targetStatus} | 환불액·위약금·취소사유는 이력 보존`,
      is_mock:    false,
      created_by: 'admin',
    });

    // settlements VOID → PENDING (해당 affiliate, 현재 정산 기간)
    (async () => {
      try {
        if (!cur.affiliate_id) return;
        const currentPeriod = new Date().toISOString().slice(0, 7);
        await supabaseAdmin
          .from('settlements')
          .update({ status: 'PENDING' } as never)
          .eq('affiliate_id', cur.affiliate_id)
          .eq('settlement_period', currentPeriod)
          .eq('status', 'VOID');
      } catch (e) { console.warn('[settlements 복구 실패]', e); }
    })();

    // audit_logs
    (async () => {
      try {
        await supabaseAdmin.from('audit_logs').insert({
          action:      'BOOKING_RESTORE',
          target_type: 'booking',
          target_id:   params.id,
          description: restoreReason,
          before_value: before,
          after_value:  after,
        } as never);
      } catch (e) { console.warn('[audit_logs 기록 실패]', e); }
    })();

    return NextResponse.json({ booking: updated, restored_to: targetStatus });
  } catch (error) {
    console.error('[restore] unexpected error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? `${error.name}: ${error.message}` : '복구 처리 실패' },
      { status: 500 },
    );
  }
}
