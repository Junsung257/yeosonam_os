/**
 * @file /api/cron/card-news-auto-live/route.ts
 * @description 카드뉴스 자동 발행 dry_run → live 자동 전환 cron.
 */

import { NextRequest } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withCronLogging } from '@/lib/cron-observability';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { sendSlackAlert } from '@/lib/slack-alert';
import { sanitizeDbError } from '@/lib/error-sanitizer';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DRY_RUN_WINDOW_HOURS = 24;
const MIN_CRITIC_DECISIONS = 5;

const handleCardNewsAutoLive = async (request: NextRequest) => {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();
  if (!isSupabaseConfigured) {
    return { ok: false, error: 'Supabase not configured', errors: ['Supabase not configured'] };
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

      const note = `${new Date().toISOString().slice(0, 16)} 자동 전환 — 24h 모니터링 + critic ${decCount}건 통과`;
      const { error: updateErr } = await supabaseAdmin
        .from('card_news_publish_guards')
        .update({
          auto_publish_dry_run: false,
          notes: note,
          updated_at: new Date().toISOString(),
        })
        .eq('id', g.id);
      if (updateErr) {
        skipped.push({ id: g.id, reason: `update failed: ${sanitizeDbError(updateErr)}` });
        continue;
      }
      transitioned.push(g.id);
      await sendSlackAlert(`✅ 카드뉴스 자동 발행 live 전환 (${g.scope_label}): ${note}`, {});
    }

    return {
      ok: true,
      checked: rows.length,
      transitioned: transitioned.length,
      transitioned_ids: transitioned,
      skipped,
    };
  } catch (err) {
    const message = sanitizeDbError(err);
    return { ok: false, error: message, errors: [message] };
  }
};

export const GET = withCronLogging('card-news-auto-live', handleCardNewsAutoLive);
