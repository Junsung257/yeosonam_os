/**
 * GET /api/cron/ledger-reconcile
 *
 * 🎯 목적: Phase 2a 이중쓰기 정합성 일일 검증
 *
 * 동작:
 *   1. reconcile_ledger() RPC 호출 → SUM(ledger_entries) ≠ bookings.<account> 인 booking 행 반환
 *   2. drift 0건  → ok=true 로 단순 응답 (정상)
 *   3. drift 1건+ → 상위 20건 응답 + 어드민 푸시 알림 (롤백 트리거)
 *
 * Vercel Cron: 매일 03:30 UTC (= 12:30 KST)
 *
 * Phase 2a 운영 가이드:
 *   - 이중쓰기 1주일간 drift 0건이 유지돼야 Phase 2b (읽기 경로 전환) 진입.
 *   - drift 발생 시 즉시 메모리 project_phase2_ledger_pending.md 의 롤백 트리거 발동.
 *
 * 응답 포맷:
 *   { ok: true,  drift_count: 0 }
 *   { ok: false, drift_count: N, sample: [{ booking_id, account, drift }, ...] }
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

interface DriftRow {
  booking_id: string;
  account: 'paid_amount' | 'total_paid_out';
  bookings_balance: number;
  ledger_sum: number;
  drift: number;
}

export async function GET(_request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase 미설정' }, { status: 500 });
  }

  const startedAt = Date.now();

  // reconcile_ledger() 는 불일치 booking 만 반환하는 STABLE 함수
  const { data, error } = await supabaseAdmin.rpc('reconcile_ledger');

  if (error) {
    console.error('[ledger-reconcile] RPC 실패:', error);
    return NextResponse.json(
      { ok: false, error: error.message, code: error.code },
      { status: 500 },
    );
  }

  const drifts = (data ?? []) as DriftRow[];
  const driftCount = drifts.length;
  const elapsedMs = Date.now() - startedAt;

  if (driftCount === 0) {
    console.log(`[ledger-reconcile] ok — drift 0건 (${elapsedMs}ms)`);
    return NextResponse.json({
      ok: true,
      drift_count: 0,
      elapsed_ms: elapsedMs,
      checked_at: new Date().toISOString(),
    });
  }

  // drift 발생 — 상위 20건만 응답에 포함, 전체는 로그
  const sample = drifts.slice(0, 20);
  const totalAbsDrift = drifts.reduce((s: number, r: DriftRow) => s + Math.abs(Number(r.drift) || 0), 0);

  console.error(
    `[ledger-reconcile] ⚠️ drift ${driftCount}건 발견 (절대합 ${totalAbsDrift.toLocaleString()}원, ${elapsedMs}ms)`,
  );
  for (const row of drifts.slice(0, 50)) {
    console.error(
      `  - booking=${row.booking_id} account=${row.account} bookings=${row.bookings_balance} ledger=${row.ledger_sum} drift=${row.drift}`,
    );
  }

  // 어드민 푸시 알림 (best-effort)
  try {
    const { dispatchPushAsync } = await import('@/lib/push-dispatcher');
    dispatchPushAsync({
      title: 'Ledger drift 경보',
      body: `Phase 2a 대조 불일치 ${driftCount}건 / 절대합 ${totalAbsDrift.toLocaleString()}원`,
      deepLink: '/admin/payments/reconcile',
      kind: 'ledger_drift',
      tag: `ledger-drift-${new Date().toISOString().slice(0, 10)}`,
    });
  } catch {
    /* push 실패는 무시 */
  }

  // Slack 운영 채널 알림 — drift 발생은 즉시 사장님 인지 필요
  try {
    const { sendSlackAlert } = await import('@/lib/slack-alert');
    await sendSlackAlert(
      `🚨 *Ledger drift 발생* — Phase 2a 이중쓰기 정합성 경보`,
      {
        drift_count: driftCount,
        total_abs_drift_krw: totalAbsDrift,
        sample: sample.slice(0, 5),
        link: '/admin/payments/reconcile',
        checked_at: new Date().toISOString(),
      },
    );
  } catch {
    /* slack 실패는 무시 */
  }

  return NextResponse.json(
    {
      ok: false,
      drift_count: driftCount,
      total_abs_drift: totalAbsDrift,
      sample,
      elapsed_ms: elapsedMs,
      checked_at: new Date().toISOString(),
    },
    { status: 200 },
  );
}
