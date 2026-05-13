/**
 * @file /api/cron/card-news-auto-live/route.ts
 * @description 카드뉴스 자동 발행 dry_run → live 자동 전환 cron.
 *
 * 박제 사유 (2026-05-13 Phase 9):
 * 카드뉴스 자동 발행은 사장님 1줄 SQL 로 활성화 가능하지만, 안전을 위해
 * dry_run=true 로 시작. 24시간 모니터링 후 사장님 SQL 없이 자동으로
 * dry_run=false 로 전환 (이상 신호 0 + critic 통과율 정상).
 *
 * 동작:
 *   1. card_news_publish_guards 의 auto_publish_enabled=true AND dry_run=true 행 조회
 *   2. dry_run_activated_at + 24h < now() 이면 자동 전환 후보
 *   3. 안전 가드: anomaly_paused_until 활성 시 skip + 최근 24h critic 결정 ≥ 5건
 *   4. dry_run=false 로 UPDATE + notes 기록
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { sendSlackAlert } from '@/lib/slack-alert';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DRY_RUN_WINDOW_HOURS = 24;
const MIN_CRITIC_DECISIONS = 5;

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase 미설정' }, { status: 503 });
  }

  try {
    const { data: guards, error } = await supabaseAdmin
      .from('card_news_publish_guards')
      .select('*')
      .eq('auto_publish_enabled', true)
      .eq('auto_publish_dry_run', true);
    if (error) throw error;

    const rows = (guards ?? []) as Array<{
      id: string;
      scope_label: string;
      anomaly_paused_until: string | null;
      dry_run_activated_at: string | null;
    }>;

    const transitioned: string[] = [];
    const skipped: Array<{ id: string; reason: string }> = [];

    for (const g of rows) {
      if (!g.dry_run_activated_at) {
        skipped.push({ id: g.id, reason: 'dry_run_activated_at 없음' });
        continue;
      }
      const elapsedH = (Date.now() - new Date(g.dry_run_activated_at).getTime()) / (60 * 60 * 1000);
      if (elapsedH < DRY_RUN_WINDOW_HOURS) {
        skipped.push({ id: g.id, reason: `${elapsedH.toFixed(1)}h < ${DRY_RUN_WINDOW_HOURS}h` });
        continue;
      }
      if (g.anomaly_paused_until && new Date(g.anomaly_paused_until) > new Date()) {
        skipped.push({ id: g.id, reason: 'anomaly_paused_until 활성' });
        continue;
      }
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count: decCount } = await supabaseAdmin
        .from('card_news_publish_decisions')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', since);

      if ((decCount ?? 0) < MIN_CRITIC_DECISIONS) {
        skipped.push({ id: g.id, reason: `critic 결정 ${decCount}건 < ${MIN_CRITIC_DECISIONS}` });
        continue;
      }

      const note = `${new Date().toISOString().slice(0,16)} 자동 전환 — 24h 모니터링 + critic ${decCount}건 통과`;
      const { error: updateErr } = await supabaseAdmin
        .from('card_news_publish_guards')
        .update({
          auto_publish_dry_run: false,
          notes: note,
          updated_at: new Date().toISOString(),
        })
        .eq('id', g.id);
      if (updateErr) {
        skipped.push({ id: g.id, reason: `update 실패: ${updateErr.message}` });
        continue;
      }
      transitioned.push(g.id);
      await sendSlackAlert(`✅ 카드뉴스 자동 발행 live 전환 (${g.scope_label}): ${note}`, {});
    }

    return NextResponse.json({
      ok: true,
      checked: rows.length,
      transitioned: transitioned.length,
      transitioned_ids: transitioned,
      skipped,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '처리 실패';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
