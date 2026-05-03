import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { notifySlack } from '@/lib/slack-notifier';

/**
 * GET /api/cron/payment-stale-alert
 *
 * 24h+ 방치된 미매칭 거래 카운트 → Slack 알림. 매일 오전 호출.
 *
 * 입금 / 출금 분리 표시 (사장님이 어느 쪽에 손 댈지 판단).
 */
export const dynamic = 'force-dynamic';
export async function GET(_req: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase 미설정' }, { status: 500 });
  }

  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabaseAdmin
      .from('bank_transactions')
      .select('id, transaction_type, amount, counterparty_name, received_at')
      .eq('match_status', 'unmatched')
      .eq('status', 'active')
      .lt('received_at', cutoff)
      .order('received_at', { ascending: true });

    if (error) throw error;

    type Row = {
      id: string;
      transaction_type: string;
      amount: number;
      counterparty_name: string | null;
      received_at: string;
    };
    const rows = (data ?? []) as Row[];

    const inflow = rows.filter(r => r.transaction_type === '입금');
    const outflow = rows.filter(r => r.transaction_type === '출금');
    const totalAmount = rows.reduce((s: number, r: Record<string, unknown>) => s + Math.abs(Number(r.amount)), 0);

    if (rows.length === 0) {
      return NextResponse.json({ ok: true, total: 0, sent: false, reason: 'no stale tx' });
    }

    const oldest = rows[0];
    const oldestDays = Math.floor(
      (Date.now() - new Date(oldest.received_at).getTime()) / (1000 * 60 * 60 * 24),
    );

    const result = await notifySlack(
      'stale',
      `24h+ 미매칭 거래 ${rows.length}건 — 합계 ${totalAmount.toLocaleString()}원`,
      {
        입금: `${inflow.length}건`,
        출금: `${outflow.length}건`,
        가장_오래된: `${oldestDays}일 (${oldest.counterparty_name ?? '?'})`,
        링크: '/admin/payments',
      },
    );

    return NextResponse.json({
      ok: true,
      total: rows.length,
      inflow: inflow.length,
      outflow: outflow.length,
      total_amount: totalAmount,
      sent: result.sent,
      reason: result.reason,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'stale alert 실패' },
      { status: 500 },
    );
  }
}
