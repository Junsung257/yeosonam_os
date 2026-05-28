import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { getAdminContext } from '@/lib/admin-context';
import { notifySlack } from '@/lib/slack-notifier';
import { requireAuthenticatedRoute } from '@/lib/session-guard';
import { successResponse, errorResponse } from '@/lib/api-response';

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
    return errorResponse('SERVICE_UNAVAILABLE', 'Supabase 미설정', 503);
  }

  // P0 보안: admin 인증 필수
  const guard = await requireAuthenticatedRoute(req);
  if (guard instanceof NextResponse) return guard;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse('INVALID_JSON', '잘못된 JSON', 400);
  }

  const { settlementId, reason } = body as { settlementId?: string; reason?: string };
  if (!settlementId) {
    return errorResponse('MISSING_FIELD', 'settlementId 필수', 400);
  }

  try {
    const { data, error } = await supabaseAdmin.rpc('reverse_land_settlement', {
      p_settlement_id: settlementId,
      p_reason: reason ?? null,
      p_reversed_by: getAdminContext(req).actor,
    });

    if (error) {
      const errCode = error as { code?: string; message?: string };
      const status =
        errCode.code === 'P0001'
          ? 400
          : errCode.code === 'P0002'
            ? 404
            : 500;
      return errorResponse('RPC_ERROR', error.message, status);
    }

    // best-effort Slack 알림 (회계 사고 신호)
    notifySlack('reverse', `정산 reverse — settlement ${settlementId}`, {
      reason: reason ?? '-',
      bookings_reverted: (data as Record<string, unknown>)?.bookings_reverted ?? '?',
      amount_reverted: (data as Record<string, unknown>)?.amount_reverted ?? '?',
      by: getAdminContext(req).actor,
    }).catch((e: unknown) => {
      console.warn('[Settlement Reverse] Slack 알림 실패:', e instanceof Error ? e.message : e);
    });

    return successResponse(data);
  } catch (err) {
    return errorResponse(
      'REVERSE_FAILED',
      err instanceof Error ? err.message : 'reverse 실패',
      500,
    );
  }
}
