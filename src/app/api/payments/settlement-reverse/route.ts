import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { getAdminContext } from '@/lib/admin-context';
import { notifySlack } from '@/lib/slack-notifier';

/**
 * POST /api/payments/settlement-reverse
 *
 * land_settlements 1건 atomic reverse.
 *  - bookings.total_paid_out 차감 (junction amount 만큼)
 *  - bank_transactions.match_status='unmatched' 복원
 *  - settlements.status='reversed' + 사유/감사
 *
 * 잘못 묶었거나 환불·재정산이 필요할 때 사용. RPC 안에서 모두 같은 트랜잭션.
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

  const { settlementId, reason } = body as { settlementId: string; reason?: string };
  if (!settlementId) {
    return NextResponse.json({ error: 'settlementId 필수' }, { status: 400 });
  }

  try {
    const { data, error } = await supabaseAdmin.rpc('reverse_land_settlement', {
      p_settlement_id: settlementId,
      p_reason: reason ?? null,
      p_reversed_by: getAdminContext(req).actor,
    });

    if (error) {
      const status =
        (error as any).code === 'P0001'
          ? 400
          : (error as any).code === 'P0002'
            ? 404
            : 500;
      return NextResponse.json({ error: error.message }, { status });
    }

    // best-effort Slack 알림 (회계 사고 신호)
    notifySlack('reverse', `정산 reverse — settlement ${settlementId}`, {
      reason: reason ?? '-',
      bookings_reverted: (data as any)?.bookings_reverted ?? '?',
      amount_reverted: (data as any)?.amount_reverted ?? '?',
      by: getAdminContext(req).actor,
    }).catch(() => {});

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'reverse 실패' },
      { status: 500 },
    );
  }
}
