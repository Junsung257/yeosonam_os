import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { parseCommandInput } from '@/lib/payment-command-parser';
import {
  resolvePaymentCommand,
  buildPatternSignature,
  type MatchBranch,
} from '@/lib/payment-command-resolver';
import { getAdminContext } from '@/lib/admin-context';

/**
 * POST /api/payments/match-confirm
 *
 * ⌘K 후보 중 하나를 1-click 확정. 안전 가드:
 *  - 서버에서 input 재 parse + 재 resolve → 클라이언트 score/branch/reasons 신뢰 금지
 *  - userCorrected 서버 기준 재계산 ((branch != 'A') OR top-1 외 선택)
 *  - 거래 동반 매칭은 confirm_payment_match RPC 로 atomic 적용 (paid_amount 누적 포함)
 *  - 일반 출금(은 환불 아님)은 RPC 안에서 거부 — 정책 위반 차단
 *  - audit log 는 best-effort (실패해도 매칭 유지)
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

  const { input, bookingId, transactionId } = body as {
    input: string;
    bookingId: string;
    transactionId?: string;
  };

  if (!input?.trim() || !bookingId) {
    return NextResponse.json({ error: 'input, bookingId 필수' }, { status: 400 });
  }

  const ctx = getAdminContext(req);

  try {
    const parsed = parseCommandInput(input);
    const resolved = await resolvePaymentCommand(parsed);

    const chosen = resolved.bookings.find(b => b.id === bookingId);
    if (!chosen) {
      return NextResponse.json(
        { error: '선택한 예약이 현재 후보에 없습니다 — 입력을 확인하세요' },
        { status: 400 },
      );
    }

    const top = resolved.bookings[0];
    // userCorrected 정의: 분기 A의 top-1 그대로 1-click 한 경우만 자동, 그 외는 모두 사장님 정정.
    // 학습 룰 자동 등록 시 user_corrected=false 만 사용 (정책).
    const userCorrected = !(resolved.branch === 'A' && top && top.id === bookingId);

    let rpcInfo: any = null;
    if (transactionId) {
      const { data, error } = await supabaseAdmin.rpc('confirm_payment_match', {
        p_transaction_id: transactionId,
        p_booking_id: bookingId,
        p_score: chosen.score,
        p_created_by: ctx.actor,
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
      rpcInfo = data;
    }

    let logId: string | null = null;
    try {
      const { data: logRow } = await supabaseAdmin
        .from('payment_command_log')
        .insert({
          raw_input: input,
          parsed_date: parsed.date ?? null,
          parsed_customer_name: parsed.customerName ?? null,
          parsed_operator_alias: parsed.operatorAlias ?? null,
          parsed_booking_id: parsed.bookingId ?? null,
          resolved_branch: resolved.branch as MatchBranch,
          resolved_booking_id: bookingId,
          resolved_inflow_tx_id: transactionId && rpcInfo?.transaction_type === '입금' ? transactionId : null,
          resolved_outflow_tx_id: transactionId && rpcInfo?.transaction_type === '출금' ? transactionId : null,
          user_corrected: userCorrected,
          pattern_signature: buildPatternSignature(parsed),
          score: chosen.score,
          reasons: chosen.reasons ?? [],
          action: 'confirm',
          created_by: ctx.actor,
        })
        .select('id')
        .limit(1);
      logId = (logRow as any[] | null)?.[0]?.id ?? null;
    } catch {
      // audit 실패는 매칭을 무효화하지 않음
    }

    return NextResponse.json({
      ok: true,
      log_id: logId,
      transaction_updated: !!transactionId,
      server_branch: resolved.branch,
      server_score: chosen.score,
      user_corrected: userCorrected,
      rpc: rpcInfo,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '확정 실패' },
      { status: 500 },
    );
  }
}

