/**
 * GET /api/admin/ledger/reconcile-status
 *
 * Phase 2a 이중쓰기 정합성 라이브 조회.
 *   - 현재 drift 건수 + 절대합
 *   - 최근 7일 ledger 등록 추이 (entry 수, 거래액)
 *   - 가장 최근 entry 의 created_at (마지막 활동)
 *
 * 응답:
 *   {
 *     ok: boolean,
 *     drift_count: number,
 *     total_abs_drift: number,
 *     last_entry_at: string | null,
 *     daily: [{ date: 'YYYY-MM-DD', count: number, paid_total: number, payout_total: number }]
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface DriftRow {
  booking_id: string;
  account: 'paid_amount' | 'total_paid_out';
  bookings_balance: number;
  ledger_sum: number;
  drift: number;
}

export async function GET(_req: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase 미설정' }, { status: 500 });
  }

  // [1] 현재 drift 검출 (RPC)
  const { data: driftData, error: driftErr } = await supabaseAdmin.rpc('reconcile_ledger');
  if (driftErr) {
    return NextResponse.json(
      { ok: false, error: driftErr.message, code: driftErr.code },
      { status: 500 },
    );
  }
  const drifts = (driftData ?? []) as DriftRow[];
  const totalAbsDrift = drifts.reduce((s: number, r: DriftRow) => s + Math.abs(Number(r.drift) || 0), 0);

  // [2] 최근 7일 ledger 활동 (entry 수 + 거래액)
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: entries } = await supabaseAdmin
    .from('ledger_entries')
    .select('created_at, account, amount')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(5000);

  const dailyMap = new Map<string, { count: number; paid_total: number; payout_total: number }>();
  let lastEntryAt: string | null = null;
  for (const row of (entries ?? []) as Array<{ created_at: string; account: string; amount: number | string }>) {
    if (!lastEntryAt) lastEntryAt = row.created_at;
    const date = row.created_at.slice(0, 10);
    if (!dailyMap.has(date)) dailyMap.set(date, { count: 0, paid_total: 0, payout_total: 0 });
    const e = dailyMap.get(date)!;
    e.count += 1;
    const amt = Number(row.amount) || 0;
    if (row.account === 'paid_amount') e.paid_total += amt;
    else if (row.account === 'total_paid_out') e.payout_total += amt;
  }
  const daily = Array.from(dailyMap.entries())
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // [3] drift 상위 20건 sample
  const driftSample = drifts.slice(0, 20).map(r => ({
    booking_id: r.booking_id,
    account: r.account,
    bookings_balance: Number(r.bookings_balance) || 0,
    ledger_sum: Number(r.ledger_sum) || 0,
    drift: Number(r.drift) || 0,
  }));

  return NextResponse.json({
    ok: drifts.length === 0,
    drift_count: drifts.length,
    total_abs_drift: totalAbsDrift,
    last_entry_at: lastEntryAt,
    drift_sample: driftSample,
    daily,
    checked_at: new Date().toISOString(),
  });
}
