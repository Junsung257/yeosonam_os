import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { FEE_TOLERANCE } from '@/lib/payment-matcher';
import { getAdminContext } from '@/lib/admin-context';

/**
 * POST /api/payments/settlement-bundle
 *
 * 출금 거래 1건을 N개 booking 정산으로 묶는다.
 * 자동매칭이 아닌 — 사장님이 ☑ 체크박스로 선택한 booking 묶음을 받아
 * Postgres RPC `create_land_settlement` 로 **atomic** 적용.
 *
 * 안전 가드 (RPC 내부):
 *   - bank_transactions FOR UPDATE 로 동시 매칭 방지
 *   - 합계 검증, booking 중복/미삭제 검증, 랜드사 존재 검증 모두 서버 강제
 *   - bookings.total_paid_out atomic increment (read-modify-write 제거)
 *   - 검증·INSERT·UPDATE·audit 가 같은 트랜잭션 — 중간 실패 시 전체 롤백
 *
 * 정책: transaction_type='출금' 만 받음. 입금이면 RPC 가 거부.
 */
export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '잘못된 JSON' }, { status: 400 });
  }

  const {
    transactionId,
    landOperatorId,
    bookingAmounts,
    notes,
    isRefund,
  } = body as {
    transactionId: string;
    landOperatorId: string;
    bookingAmounts: { bookingId: string; amount: number }[];
    notes?: string;
    isRefund?: boolean;
  };

  if (!transactionId || !landOperatorId || !Array.isArray(bookingAmounts) || bookingAmounts.length === 0) {
    return NextResponse.json(
      { error: 'transactionId, landOperatorId, bookingAmounts(>=1) 필수' },
      { status: 400 },
    );
  }

  const validated = bookingAmounts.map(b => ({
    booking_id: String(b.bookingId),
    amount: Number(b.amount),
  }));
  if (validated.some(b => !b.booking_id || !Number.isFinite(b.amount) || b.amount <= 0)) {
    return NextResponse.json(
      { error: '각 항목은 bookingId + 양수 amount 필수' },
      { status: 400 },
    );
  }

  try {
    const { data, error } = await supabaseAdmin.rpc('create_land_settlement', {
      p_transaction_id: transactionId,
      p_land_operator_id: landOperatorId,
      p_booking_amounts: validated,
      p_notes: notes ?? null,
      p_is_refund: isRefund ?? null,
      p_created_by: getAdminContext(req).actor,
      p_fee_tolerance: FEE_TOLERANCE,
    });

    if (error) {
      // P0001 = 검증 실패(400), P0002 = 리소스 없음(404)
      const status =
        (error as any).code === 'P0001'
          ? 400
          : (error as any).code === 'P0002'
            ? 404
            : 500;
      return NextResponse.json({ error: error.message }, { status });
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '묶기 실패' },
      { status: 500 },
    );
  }
}
