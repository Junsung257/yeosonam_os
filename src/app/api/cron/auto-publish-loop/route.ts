import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import {
  runCriticGate,
  extractCardNewsFeatures,
  detectAndPauseIfAnomaly,
  type CardNewsCriticInput,
} from '@/lib/content-pipeline/critic';
import { applyPendingBanditRewards } from '@/lib/content-pipeline/bandit';
import { withCronLogging } from '@/lib/cron-observability';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { getSecret } from '@/lib/secret-registry';
import { evaluateThreadsDistribution } from '@/lib/content-pipeline/threads-automation';
import { publishDistribution, type ScheduledDistributionRow } from '@/lib/social-publishing/distribution-publisher';

/**
 * Auto Publish Loop — 2시간당 1회
 *
 * 흐름:
 *   1. detectAndPauseIfAnomaly — 이상치 검사 (24h 평균 ER < baseline 30% → 24h pause)
 *   2. applyPendingBanditRewards — 7일 지난 카드뉴스 reward 일괄 업데이트
 *   3. card_news_publish_guards 확인 — auto_publish_enabled 와 dry_run 플래그
 *   4. status='confirmed' 이고 ig_publish_status NOT IN ('queued','publishing','published','failed')
 *      이면서 ig_post_id IS NULL인 카드뉴스 후보 select
 *   5. 후보별 critic gate → 통과 시 (dry_run=false 일 때만) 실제 발행
 *   6. dry_run 모드에서는 critic 결정만 로그 (실 발행 X)
 *
 * 안전 가드 4중:
 *   (1) auto_publish_enabled = false 면 즉시 종료 (출고 시 디폴트)
 *   (2) anomaly_paused_until > now() 면 즉시 종료
 *   (3) critic 일일 한도(card_news_publish_decisions 카운트)
 *   (4) auto_publish_dry_run = true 면 발행 X
 */

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

const MAX_PUBLISH_PER_RUN = intEnv('AUTO_PUBLISH_LOOP_MAX_PUBLISH_PER_RUN', 1, 1, 3);
const MAX_THREADS_PER_RUN = intEnv('AUTO_PUBLISH_LOOP_MAX_THREADS_PER_RUN', 1, 1, 5);

function currentPostingHourKst(): number {
  return (new Date().getUTCHours() + 9) % 24;
}

async function runAutoPublishLoop(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }
  if (!isSupabaseConfigured) {
    return { skipped: true, reason: 'Supabase 미설정', errors: [] as string[] };
  }

  const errors: string[] = [];
  const summary = {
    auto_publish_enabled: false,
    dry_run: true,
    anomaly_check: '',
    bandit_rewards_applied: 0,
    candidates_evaluated: 0,
    approved: 0,
    rejected_bait: 0,
    rejected_critic: 0,
    rejected_quota: 0,
    auto_paused: 0,
    actually_published: 0,
    dry_run_logged: 0,
    threads_candidates_evaluated: 0,
    threads_approved: 0,
    threads_published: 0,
    threads_rejected: 0,
    threads_dry_run_logged: 0,
    errors,
  };

  // 1) anomaly 자동 검사
  const ap = await detectAndPauseIfAnomaly();
  summary.anomaly_check = ap.paused ? `paused (${ap.reason})` : 'ok';

  // 2) bandit reward 일괄 업데이트 (7일 경과)
  const banditResult = await applyPendingBanditRewards();
  summary.bandit_rewards_applied = banditResult.applied;
  errors.push(...banditResult.errors);

  // 3) guard flags
  const { data: guardRows } = await supabaseAdmin
    .from('card_news_publish_guards')
    .select('auto_publish_enabled, auto_publish_dry_run, anomaly_paused_until')
    .eq('scope_label', 'global')
    .limit(1);
  const guard = (guardRows?.[0] ?? {}) as {
    auto_publish_enabled?: boolean;
    auto_publish_dry_run?: boolean;
    anomaly_paused_until?: string | null;
  };
  summary.auto_publish_enabled = !!guard.auto_publish_enabled;
  summary.dry_run = guard.auto_publish_dry_run !== false;          // 명시적 false 만 활성

  if (!summary.auto_publish_enabled) {
    return { ...summary, message: 'auto_publish_enabled=false → 종료' };
  }

  if (guard.anomaly_paused_until && new Date(guard.anomaly_paused_until) > new Date()) {
    return { ...summary, message: `anomaly_paused_until=${guard.anomaly_paused_until} → 종료` };
  }

  const threadsResult = await processThreadsCandidates(summary.dry_run);
  summary.threads_candidates_evaluated = threadsResult.evaluated;
  summary.threads_approved = threadsResult.approved;
  summary.threads_published = threadsResult.published;
  summary.threads_rejected = threadsResult.rejected;
  summary.threads_dry_run_logged = threadsResult.dryRunLogged;
  errors.push(...threadsResult.errors);

  // 4) 후보 select
  const { data: candidates, error: fetchErr } = await supabaseAdmin
    .from('card_news')
    .select('id, title, ig_caption, hook_type, palette_category, design_archetype_id, slides_v2, generation_config')
    .eq('status', 'confirmed')
    .or('ig_publish_status.is.null,ig_publish_status.eq.draft')
    .is('ig_post_id', null)
    .limit(MAX_PUBLISH_PER_RUN);

  if (fetchErr) {
    return { ...summary, errors: [...errors, `fetch ${fetchErr.message}`] };
  }
  const list = (candidates ?? []) as Array<{
    id: string;
    title: string;
    ig_caption: string | null;
    hook_type: string | null;
    palette_category: string | null;
    design_archetype_id: string | null;
    slides_v2: unknown;
    generation_config: Record<string, unknown> | null;
  }>;
  summary.candidates_evaluated = list.length;

  if (list.length === 0) {
    return { ...summary, message: '후보 없음' };
  }

  // 5) critic gate
  for (const card of list) {
    const slides = Array.isArray(card.slides_v2) ? (card.slides_v2 as Array<Record<string, unknown>>) : [];
    const cover = (slides[0] ?? {}) as Record<string, unknown>;
    const cover_headline = String(cover.headline ?? card.title ?? '');
    const cover_body = String(cover.body ?? '');
    const slide_roles = slides
      .map((s) => (typeof s.role === 'string' ? s.role : null))
      .filter((r): r is string => Boolean(r));

    const featuresInput: CardNewsCriticInput = {
      card_news_id: card.id,
      cover_headline,
      cover_body,
      slide_count: slides.length,
      caption: card.ig_caption ?? '',
      slide_roles,
      hook_type: card.hook_type,
      palette_category: card.palette_category,
      posting_hour_kst: currentPostingHourKst(),
    };
    const features = extractCardNewsFeatures(featuresInput);
    const fullText = [cover_headline, cover_body, card.ig_caption ?? '', ...slides.map((s) => `${s.headline ?? ''} ${s.body ?? ''}`)]
      .filter(Boolean).join('\n');

    const decision = await runCriticGate({
      cardNewsId: card.id,
      platform: 'instagram',
      features,
      fullText,
    });

    if (!decision.approved) {
      switch (decision.rejected_reason) {
        case 'bait': summary.rejected_bait += 1; break;
        case 'low_predicted_er': summary.rejected_critic += 1; break;
        case 'quota_exceeded': summary.rejected_quota += 1; break;
        case 'anomaly_paused': summary.auto_paused += 1; break;
      }
      continue;
    }

    summary.approved += 1;

    // 6) dry_run 처리
    if (summary.dry_run) {
      summary.dry_run_logged += 1;
      // 실제 발행 X — 결정 로그만 critic 모듈이 이미 남김
      continue;
    }

    // 실제 발행 — 기존 publish API 호출 (재사용)
    try {
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || '';
      if (!baseUrl) {
        errors.push(`base url 미설정 — ${card.id} 발행 스킵`);
        continue;
      }
      const cronSecret = getSecret('CRON_SECRET') || getSecret('ADMIN_API_TOKEN') || '';
      const res = await fetch(`${baseUrl}/api/card-news/${card.id}/publish-instagram`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cronSecret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ source: 'auto-publish-loop' }),
      });
      if (res.ok) {
        summary.actually_published += 1;
      } else {
        const t = await res.text().catch(() => '');
        errors.push(`publish ${card.id} ${res.status}: ${t.slice(0, 200)}`);
      }
    } catch (err) {
      errors.push(`publish ${card.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { ...summary, ranAt: new Date().toISOString() };
}

export const GET = withCronLogging('auto-publish-loop', runAutoPublishLoop);

async function processThreadsCandidates(dryRun: boolean): Promise<{
  evaluated: number;
  approved: number;
  published: number;
  rejected: number;
  dryRunLogged: number;
  errors: string[];
}> {
  const result = {
    evaluated: 0,
    approved: 0,
    published: 0,
    rejected: 0,
    dryRunLogged: 0,
    errors: [] as string[],
  };

  const { data, error } = await supabaseAdmin
    .from('content_distributions')
    .select('id, product_id, card_news_id, blog_post_id, platform, payload, scheduled_for, engagement, tenant_id, retry_count, max_retries')
    .eq('platform', 'threads_post')
    .in('status', ['draft', 'approved'])
    .order('created_at', { ascending: true })
    .limit(MAX_THREADS_PER_RUN);

  if (error) {
    result.errors.push(`threads candidates: ${error.message}`);
    return result;
  }

  const rows = (data ?? []) as ScheduledDistributionRow[];
  result.evaluated = rows.length;
  for (const row of rows) {
    try {
      const gate = await evaluateThreadsDistribution({
        distributionId: row.id,
        payload: row.payload,
        scheduledFor: row.scheduled_for,
        dryRun,
      });
      if (!gate.approved) {
        result.rejected += 1;
        await supabaseAdmin
          .from('content_distributions')
          .update({
            error_message: `Threads critic gate: ${gate.reason ?? 'rejected'}`,
            engagement: { ...(row.engagement ?? {}), predicted_er: gate.predicted_er },
          })
          .eq('id', row.id);
        continue;
      }

      result.approved += 1;
      if (dryRun) {
        result.dryRunLogged += 1;
        await supabaseAdmin
          .from('content_distributions')
          .update({
            engagement: { ...(row.engagement ?? {}), predicted_er: gate.predicted_er, auto_publish_dry_run_at: new Date().toISOString() },
          })
          .eq('id', row.id);
        continue;
      }

      const publishResult = await publishDistribution({
        ...row,
        scheduled_for: row.scheduled_for ?? new Date().toISOString(),
      }, {
        precomputedGate: gate,
      });
      if (publishResult.status === 'published') {
        result.published += 1;
      } else {
        result.rejected += 1;
      }
    } catch (err) {
      result.errors.push(`threads ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}
