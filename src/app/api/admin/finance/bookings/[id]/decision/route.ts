import { NextResponse, type NextRequest } from 'next/server';

import { getAdminContext } from '@/lib/admin-context';
import { requireAdminRequest } from '@/lib/admin-guard';
import {
  BOOKING_SETTLEMENT_DECISIONS,
  type BookingSettlementDecision,
} from '@/lib/finance-settlement-v3';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isDecision(value: unknown): value is BookingSettlementDecision {
  return typeof value === 'string' && BOOKING_SETTLEMENT_DECISIONS.includes(value as BookingSettlementDecision);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: '정산 데이터베이스가 연결되지 않았습니다.' }, { status: 503 });
  }

  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const idempotencyKey = request.headers.get('idempotency-key')
      ?? (typeof body.idempotencyKey === 'string' ? body.idempotencyKey : '');
    if (!isDecision(body.decision) || typeof body.expectedFingerprint !== 'string' || !idempotencyKey) {
      return NextResponse.json({ error: '정산 결정, 최신 지문, 중복방지 키가 필요합니다.' }, { status: 400 });
    }
    const contextValue = getAdminContext(request);
    const { data, error } = await supabaseAdmin.rpc('save_booking_settlement_review', {
      p_booking_id: id,
      p_decision: body.decision,
      p_expected_fingerprint: body.expectedFingerprint,
      p_idempotency_key: idempotencyKey,
      p_actor: contextValue.userId,
      p_actor_label: contextValue.actor,
      p_reason: typeof body.reason === 'string' ? body.reason.trim().slice(0, 1000) : null,
      p_assigned_to: typeof body.assignedTo === 'string' ? body.assignedTo.trim().slice(0, 120) : null,
      p_due_date: typeof body.dueDate === 'string' ? body.dueDate : null,
    });
    if (error) {
      const stale = /stale .*fingerprint/i.test(error.message);
      const missingEvidence = /requires bank evidence/i.test(error.message);
      const negativeMargin = /negative cash margin/i.test(error.message);
      const message = stale
        ? '화면을 연 뒤 거래나 메모가 바뀌었습니다. 최신 내역을 다시 확인해주세요.'
        : missingEvidence
          ? '연결된 Clobe 통장 근거가 없어 정산 확인할 수 없습니다. 메모·매칭을 확인하거나 오예약·보류로 처리해주세요.'
          : negativeMargin
            ? '출금이 입금보다 많은 예약은 바로 확정할 수 없습니다. 고객 취소·예약 아님·보류 중 실제 상황을 선택해주세요.'
            : error.message;
      return NextResponse.json(
        { error: message },
        { status: stale ? 409 : 400 },
      );
    }
    return NextResponse.json({ success: true, result: data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '예약 정산 결정을 저장하지 못했습니다.' },
      { status: 500 },
    );
  }
}
