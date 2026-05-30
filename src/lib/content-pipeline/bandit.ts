/**
 * Thompson Sampling Bandit — 카드뉴스 변형 선택기 (PR-6)
 *
 * 4-arm bandit:
 *   arm_key = "{hook_type}::{palette_category}::{slide_bucket}::{hour_bucket}"
 *
 * 동작:
 *   1. sampleArm() — 모든 active arm에서 Beta(α, β) 샘플 → 최댓값 arm 선택
 *   2. (발행 후 7일) updateArmReward(arm_key, reward 0~1) — α += reward, β += 1 − reward
 *
 * Cold start: 신규 arm은 Beta(2, 2) prior로 시작 → 자연스러운 exploration.
 *
 * 정합성:
 *   - feature dimensions이 critic.ts와 일치해야 함 (hook_type/palette/slide_count/posting_hour)
 *   - critic gate가 fail하면 bandit pull은 무효 (reward 미업데이트)
 */

import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export type SlideBucket = '7-8' | '9-10' | 'other';
export type HourBucket = 'night' | 'morning' | 'lunch' | 'afternoon' | 'evening' | 'late';

export interface ArmDimensions {
  hook_type: string;
  palette_category: string;
  slide_bucket: SlideBucket;
  hour_bucket: HourBucket;
}

export function bucketSlideCount(n: number): SlideBucket {
  if (n >= 7 && n <= 8) return '7-8';
  if (n >= 9 && n <= 10) return '9-10';
  return 'other';
}

export function bucketHourKst(h: number | null): HourBucket {
  if (h == null) return 'morning';                          // default
  if (h >= 0 && h <= 5) return 'night';
  if (h >= 6 && h <= 11) return 'morning';
  if (h >= 12 && h <= 13) return 'lunch';
  if (h >= 14 && h <= 17) return 'afternoon';
  if (h >= 18 && h <= 21) return 'evening';
  return 'late';                                            // 22-23
}

export function makeArmKey(d: ArmDimensions): string {
  return `${d.hook_type}::${d.palette_category}::${d.slide_bucket}::${d.hour_bucket}`;
}

export function parseArmKey(key: string): ArmDimensions | null {
  const [hook_type, palette_category, slide_bucket, hour_bucket] = key.split('::');
  if (!hook_type || !palette_category || !slide_bucket || !hour_bucket) return null;
  return {
    hook_type,
    palette_category,
    slide_bucket: slide_bucket as SlideBucket,
    hour_bucket: hour_bucket as HourBucket,
  };
}

/**
 * Beta(α, β) 샘플링 — Marsaglia & Tsang 게임마 분포 통한 표준 구현.
 * 의존성 없이 작성 (npm beta-distribution 패키지 회피).
 */
function sampleBeta(alpha: number, beta: number): number {
  const x = sampleGamma(alpha);
  const y = sampleGamma(beta);
  return x / (x + y);
}

function sampleGamma(shape: number): number {
  // Marsaglia & Tsang 2000 — works for shape >= 1, 그렇지 않으면 boost
  if (shape < 1) {
    const u = Math.random();
    return sampleGamma(shape + 1) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x: number;
    let v: number;
    do {
      x = sampleNormal();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function sampleNormal(): number {
  // Box-Muller
  const u1 = Math.random() || 1e-9;
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

interface ArmRow {
  arm_key: string;
  alpha: number;
  beta: number;
  total_pulls: number;
}

/**
 * 모든 active arm에서 Beta 샘플 → 최댓값 arm 선택.
 * candidates 가 주어지면 그 차원 안에서만 선택 (예: hook_type 강제).
 */
export async function sampleArm(filter?: Partial<ArmDimensions>): Promise<ArmDimensions | null> {
  if (!isSupabaseConfigured) return null;

  let query = supabaseAdmin
    .from('bandit_arms')
    .select('arm_key, alpha, beta, total_pulls, hook_type, palette_category, slide_bucket, hour_bucket')
    .eq('is_active', true);

  if (filter?.hook_type) query = query.eq('hook_type', filter.hook_type);
  if (filter?.palette_category) query = query.eq('palette_category', filter.palette_category);
  if (filter?.slide_bucket) query = query.eq('slide_bucket', filter.slide_bucket);
  if (filter?.hour_bucket) query = query.eq('hour_bucket', filter.hour_bucket);

  const { data, error } = await query;
  if (error || !data || data.length === 0) return null;

  let best: { armKey: string; sample: number; row: Record<string, unknown> } | null = null;
  for (const row of data as Record<string, unknown>[]) {
    const sample = sampleBeta(Number(row.alpha) || 2, Number(row.beta) || 2);
    if (!best || sample > best.sample) best = { armKey: row.arm_key as string, sample, row };
  }
  if (!best) return null;
  await supabaseAdmin
    .from('bandit_arms')
    .update({
      total_pulls: ((best.row.total_pulls as number) ?? 0) + 1,
      last_pull_at: new Date().toISOString(),
    })
    .eq('arm_key', best.armKey);
  return parseArmKey(best.armKey);
}

/**
 * 신규 arm 자동 생성 (cold start). 호출 시 row 없으면 default Beta(2,2) row 생성.
 */
export async function getOrCreateArm(d: ArmDimensions): Promise<string> {
  const arm_key = makeArmKey(d);
  if (!isSupabaseConfigured) return arm_key;

  const { data: existing } = await supabaseAdmin
    .from('bandit_arms')
    .select('arm_key')
    .eq('arm_key', arm_key)
    .limit(1);
  if (existing && existing.length > 0) return arm_key;

  await supabaseAdmin
    .from('bandit_arms')
    .insert({
      arm_key,
      hook_type: d.hook_type,
      palette_category: d.palette_category,
      slide_bucket: d.slide_bucket,
      hour_bucket: d.hour_bucket,
      alpha: 2.0,
      beta: 2.0,
    });
  return arm_key;
}

/**
 * arm reward 업데이트. reward는 0~1 범위 (performance_score).
 * sync-engagement가 발행 후 7일 시점에 호출.
 */
export async function updateArmReward(arm_key: string, reward: number): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  const r = Math.max(0, Math.min(1, reward));
  try {
    const { data: row } = await supabaseAdmin
      .from('bandit_arms')
      .select('alpha, beta, total_rewards')
      .eq('arm_key', arm_key)
      .maybeSingle();
    if (!row) return false;
    const r0 = row as { alpha: number; beta: number; total_rewards: number };

    await supabaseAdmin
      .from('bandit_arms')
      .update({
        alpha: Number(r0.alpha) + r,
        beta: Number(r0.beta) + (1 - r),
        total_rewards: Number(r0.total_rewards) + r,
        last_reward_at: new Date().toISOString(),
      })
      .eq('arm_key', arm_key);
    return true;
  } catch (err) {
    console.warn('[bandit] update reward 실패:', err instanceof Error ? err.message : String(err));
    return false;
  }
}

/**
 * 7일 이상 ig_published_at 지난 카드뉴스 reward 일괄 업데이트.
 * sync-engagement가 매일 호출.
 */
export async function applyPendingBanditRewards(): Promise<{ applied: number; errors: string[] }> {
  if (!isSupabaseConfigured) return { applied: 0, errors: ['supabase 미설정'] };

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('card_news')
    .select('id, bandit_arm, ig_post_id')
    .eq('bandit_reward_applied', false)
    .not('bandit_arm', 'is', null)
    .not('ig_post_id', 'is', null)
    .lt('ig_published_at', sevenDaysAgo)
    .limit(50);
  if (error) return { applied: 0, errors: [error.message] };

  const errors: string[] = [];
  let applied = 0;

  for (const row of (data ?? []) as Array<{ id: string; bandit_arm: string; ig_post_id: string }>) {
    // 7일 후 평균 performance_score
    const { data: snaps } = await supabaseAdmin
      .from('post_engagement_snapshots')
      .select('performance_score')
      .eq('card_news_id', row.id)
      .gte('captured_at', sevenDaysAgo)
      .not('performance_score', 'is', null);

    const scores = ((snaps ?? []) as Array<{ performance_score: number }>)
      .map((s) => Number(s.performance_score) || 0)
      .filter((n) => n > 0);
    if (scores.length === 0) continue;

    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const ok = await updateArmReward(row.bandit_arm, avg);
    if (ok) {
      await supabaseAdmin
        .from('card_news')
        .update({ bandit_reward_applied: true })
        .eq('id', row.id);
      applied += 1;
    } else {
      errors.push(`reward apply 실패 ${row.id} ${row.bandit_arm}`);
    }
  }

  return { applied, errors };
}
