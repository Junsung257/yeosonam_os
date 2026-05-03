/**
 * Phase 2-F: 어드민 환차손익 분석 API
 * GET /api/admin/analytics/fx
 *
 * 최근 30일 ledger_entries 중 currency != 'KRW' 항목 집계
 * 반환: 총 환차익 / 환차손 / 순 환차손익
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ data: null, reason: 'Supabase 미설정' });
  }

  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // 외화 원장 항목 조회 (최근 30일)
    const { data: entries, error } = await supabaseAdmin
      .from('ledger_entries')
      .select(
        'id, amount, currency, foreign_amount, fx_rate, fx_gain_loss, entry_type, created_at',
      )
      .neq('currency', 'KRW')
      .gte('created_at', since)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const rows = entries ?? [];

    let totalGain = 0;   // 환차익 합계 (양수 fx_gain_loss)
    let totalLoss = 0;   // 환차손 합계 (음수 fx_gain_loss, 절댓값)
    let pendingCount = 0; // fx_gain_loss 미계산 항목

    for (const row of rows) {
      if (row.fx_gain_loss == null) {
        pendingCount++;
        continue;
      }
      if (row.fx_gain_loss > 0) {
        totalGain += row.fx_gain_loss;
      } else if (row.fx_gain_loss < 0) {
        totalLoss += Math.abs(row.fx_gain_loss);
      }
    }

    const netFxGainLoss = totalGain - totalLoss;

    // 통화별 집계
    const byCurrency: Record<string, { count: number; total_foreign: number }> = {};
    for (const row of rows) {
      const cur = row.currency as string;
      if (!byCurrency[cur]) byCurrency[cur] = { count: 0, total_foreign: 0 };
      byCurrency[cur].count++;
      byCurrency[cur].total_foreign += Number(row.foreign_amount ?? 0);
    }

    return NextResponse.json({
      period: {
        since,
        until: new Date().toISOString(),
        days: 30,
      },
      summary: {
        total_gain_krw: totalGain,
        total_loss_krw: totalLoss,
        net_fx_gain_loss_krw: netFxGainLoss,
        entry_count: rows.length,
        pending_fx_calc_count: pendingCount,
      },
      by_currency: byCurrency,
      entries: rows,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '처리 실패';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
