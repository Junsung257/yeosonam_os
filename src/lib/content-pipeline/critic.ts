/**
 * Pre-publish Critic Gate (PR-5)
 *
 * 발행 직전 "이거 망할 게시물 같은가" 예측 + 거부/통과 결정.
 *
 * MVP: 룰 기반 (데이터 부족 단계). 100건 이상 쌓이면 XGBoost 전환.
 *
 * 통과 흐름:
 *   1. extractCriticFeatures(card or threads input) → CriticFeatures
 *   2. predictEngagementRate(features) → predicted_er
 *   3. checkBaitBlacklist(text) → bait match
 *   4. checkDailyQuota(platform, brand_id) → quota_used / limit
 *   5. runCriticGate(...) → 통과/거부 결정 + DB 로그
 *
 * 모든 결정은 card_news_publish_decisions 테이블에 영구 로그.
 */

import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import {
  detectEngagementBait,
  countWordsForThreadsHook,
  CAROUSEL_SWEET_SPOT_MIN,
  CAROUSEL_SWEET_SPOT_MAX,
  THREADS_HOOK_SWEET_SPOT_MIN,
  THREADS_HOOK_SWEET_SPOT_MAX,
} from '@/lib/card-news/tokens';

export type CriticPlatform = 'instagram' | 'threads';

export interface CriticFeatures {
  platform: CriticPlatform;
  cover_hook_words: number;
  slide_count: number;
  hashtag_count: number;
  has_numbers: boolean;
  has_question_mark: boolean;
  hook_type: string | null;
  palette_category: string | null;
  posting_hour_kst: number | null;
  total_text_length: number;
  has_save_hook_slide: boolean;
  has_contrarian_slide: boolean;
}

export interface CriticDecisionInput {
  cardNewsId?: string | null;
  brandId?: string | null;
  platform: CriticPlatform;
  features: CriticFeatures;
  fullText: string;                       // 전체 본문 (caption + slide texts)
  iteration?: number;
  banditArm?: string | null;
}

export interface CriticDecisionOutput {
  approved: boolean;
  predicted_er: number;
  reason?: string;
  rejected_reason?: 'bait' | 'low_predicted_er' | 'quota_exceeded' | 'anomaly_paused';
  bait_match?: string | null;
}

/**
 * baseline ER (IG carousel 2026 industry avg ≈ 1.92%, Threads ≈ 6.25%).
 */
const BASELINE_ER: Record<CriticPlatform, number> = {
  instagram: 0.0192,
  threads: 0.0625,
};

/**
 * 룰 기반 ER 예측 — 각 신호마다 +/- 가산.
 * 데이터 100건 누적되면 XGBoost로 교체.
 */
export function predictEngagementRate(features: CriticFeatures): number {
  let score = BASELINE_ER[features.platform];

  // cover hook 단어수 (cover가 첫 슬라이드)
  if (features.platform === 'instagram') {
    if (features.cover_hook_words <= 6) score += 0.0050;
    else if (features.cover_hook_words <= 10) score += 0.0020;
    else if (features.cover_hook_words >= 15) score -= 0.0030;
  } else {
    if (features.cover_hook_words >= THREADS_HOOK_SWEET_SPOT_MIN
        && features.cover_hook_words <= THREADS_HOOK_SWEET_SPOT_MAX) score += 0.0080;
    else if (features.cover_hook_words > THREADS_HOOK_SWEET_SPOT_MAX) score -= 0.0030;
    else if (features.cover_hook_words < THREADS_HOOK_SWEET_SPOT_MIN) score -= 0.0010;
  }

  // slide_count sweet spot
  if (features.platform === 'instagram') {
    if (features.slide_count >= CAROUSEL_SWEET_SPOT_MIN && features.slide_count <= CAROUSEL_SWEET_SPOT_MAX) {
      score += 0.0040;
    } else if (features.slide_count < CAROUSEL_SWEET_SPOT_MIN) {
      score -= 0.0030;
    } else if (features.slide_count > CAROUSEL_SWEET_SPOT_MAX) {
      score -= 0.0020;
    }
  }

  // 숫자/질문 — Loewenstein info-gap effect
  if (features.has_numbers) score += 0.0030;
  if (features.has_question_mark) score += 0.0020;

  // hook_type — contrarian/gap이 saves driver
  if (features.hook_type === 'contrarian' || features.hook_type === 'gap') score += 0.0050;
  if (features.hook_type === 'data_story') score += 0.0040;
  if (features.hook_type === 'urgency' || features.hook_type === 'fomo') score += 0.0020;

  // palette × engagement (Annals of Tourism Research)
  if (features.palette_category === 'data_story') score += 0.0030;
  if (features.palette_category === 'urgency') score += 0.0020;

  // posting_hour KST sweet spot (Buffer 9.6M / Later 6M data)
  if (features.posting_hour_kst != null) {
    const h = features.posting_hour_kst;
    if (h >= 9 && h <= 11) score += 0.0050;
    else if (h >= 18 && h <= 21) score += 0.0030;
    else if (h >= 0 && h <= 5) score -= 0.0030;
  }

  // 카드뉴스 구조 보너스
  if (features.has_save_hook_slide) score += 0.0040;
  if (features.has_contrarian_slide) score += 0.0030;

  // 해시태그 적정선 (3~5)
  if (features.hashtag_count >= 3 && features.hashtag_count <= 5) score += 0.0010;
  else if (features.hashtag_count >= 20) score -= 0.0050;            // hashtag stuffing 페널티

  return Math.max(0, Math.min(score, 1));
}

/**
 * extractCriticFeatures — 카드뉴스 row + slides 에서 features 추출.
 */
export interface CardNewsCriticInput {
  card_news_id: string;
  cover_headline: string;
  cover_body?: string;
  slide_count: number;
  caption: string;
  slide_roles?: string[];                 // ['hook','benefit','...','save_hook','contrarian','cta']
  hook_type: string | null;
  palette_category: string | null;
  posting_hour_kst: number | null;
}

export function extractCardNewsFeatures(
  input: CardNewsCriticInput,
): CriticFeatures {
  const cover = `${input.cover_headline} ${input.cover_body ?? ''}`.trim();
  const cover_words = countWordsForThreadsHook(cover);
  const fullText = `${input.cover_headline}\n${input.cover_body ?? ''}\n${input.caption}`;
  const hashtag_count = (fullText.match(/#[\p{L}\p{N}_]+/gu) ?? []).length;
  const has_numbers = /\d+/.test(input.cover_headline);
  const has_q = /\?/.test(input.cover_headline);
  const roles = input.slide_roles ?? [];

  return {
    platform: 'instagram',
    cover_hook_words: cover_words,
    slide_count: input.slide_count,
    hashtag_count,
    has_numbers,
    has_question_mark: has_q,
    hook_type: input.hook_type,
    palette_category: input.palette_category,
    posting_hour_kst: input.posting_hour_kst,
    total_text_length: fullText.length,
    has_save_hook_slide: roles.includes('save_hook'),
    has_contrarian_slide: roles.includes('contrarian') || roles.includes('objection'),
  };
}

export function extractThreadsFeatures(args: {
  text: string;
  hook_type: string | null;
  posting_hour_kst: number | null;
}): CriticFeatures {
  const firstLine = (args.text.split(/[.!?\n]/)[0] ?? args.text).trim();
  const cover_words = countWordsForThreadsHook(firstLine);
  const hashtag_count = (args.text.match(/#[\p{L}\p{N}_]+/gu) ?? []).length;

  return {
    platform: 'threads',
    cover_hook_words: cover_words,
    slide_count: 1,
    hashtag_count,
    has_numbers: /\d+/.test(firstLine),
    has_question_mark: /\?/.test(firstLine),
    hook_type: args.hook_type,
    palette_category: null,
    posting_hour_kst: args.posting_hour_kst,
    total_text_length: args.text.length,
    has_save_hook_slide: false,
    has_contrarian_slide: false,
  };
}

/**
 * 일일 quota 체크. card_news_publish_decisions WHERE decision='approved' 카운트.
 */
async function checkDailyQuota(
  platform: CriticPlatform,
  brandId: string | null,
): Promise<{ used: number; limit: number; over: boolean }> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const { data: guard } = await supabaseAdmin
    .from('card_news_publish_guards')
    .select('max_per_day_per_brand, max_per_day_threads')
    .eq('scope_label', 'global')
    .limit(1);
  const g = (guard?.[0] ?? {}) as { max_per_day_per_brand?: number; max_per_day_threads?: number };
  const limit = platform === 'threads' ? (g.max_per_day_threads ?? 10) : (g.max_per_day_per_brand ?? 5);

  const { count } = await supabaseAdmin
    .from('card_news_publish_decisions')
    .select('id', { count: 'exact', head: true })
    .eq('platform', platform)
    .eq('decision', 'approved')
    .gte('decided_at', startOfDay.toISOString());

  const used = count ?? 0;
  return { used, limit, over: used >= limit };
}

async function checkAnomalyPause(): Promise<{ paused: boolean; until?: string; reason?: string }> {
  const { data } = await supabaseAdmin
    .from('card_news_publish_guards')
    .select('anomaly_paused_until, anomaly_reason')
    .eq('scope_label', 'global')
    .limit(1);
  const row = data?.[0] as { anomaly_paused_until?: string | null; anomaly_reason?: string | null } | undefined;
  if (!row?.anomaly_paused_until) return { paused: false };
  if (new Date(row.anomaly_paused_until) < new Date()) return { paused: false };
  return { paused: true, until: row.anomaly_paused_until, reason: row.anomaly_reason ?? undefined };
}

/**
 * runCriticGate — 발행 직전 critic. 통과 시 자동 approve 로그 기록, 거부 시 reject 로그.
 */
export async function runCriticGate(input: CriticDecisionInput): Promise<CriticDecisionOutput> {
  if (!isSupabaseConfigured) {
    return { approved: true, predicted_er: predictEngagementRate(input.features) };
  }

  // 1. anomaly pause
  const ap = await checkAnomalyPause();
  if (ap.paused) {
    await logDecision(input, {
      decision: 'auto_paused',
      predicted_er: 0,
      rejected_reason: `anomaly_paused (${ap.reason ?? '?'} until ${ap.until})`,
    });
    return { approved: false, predicted_er: 0, rejected_reason: 'anomaly_paused', reason: `anomaly until ${ap.until}` };
  }

  // 2. bait blacklist
  const bait = detectEngagementBait(input.fullText);
  if (bait) {
    await logDecision(input, {
      decision: 'rejected_bait',
      predicted_er: 0,
      bait_match: bait,
      rejected_reason: `bait: ${bait}`,
    });
    return { approved: false, predicted_er: 0, rejected_reason: 'bait', bait_match: bait, reason: `engagement-bait pattern: ${bait}` };
  }

  // 3. quota
  const quota = await checkDailyQuota(input.platform, input.brandId ?? null);
  if (quota.over) {
    await logDecision(input, {
      decision: 'rejected_quota',
      predicted_er: 0,
      rejected_reason: `quota ${quota.used}/${quota.limit}`,
    });
    return { approved: false, predicted_er: 0, rejected_reason: 'quota_exceeded', reason: `daily quota ${quota.used}/${quota.limit}` };
  }

  // 4. predicted ER
  const predicted_er = predictEngagementRate(input.features);

  // 5. min_predicted_er gate (옵션 — guard.min_predicted_er null이면 비활성)
  const { data: guardRows } = await supabaseAdmin
    .from('card_news_publish_guards')
    .select('min_predicted_er')
    .eq('scope_label', 'global')
    .limit(1);
  const minEr = (guardRows?.[0] as { min_predicted_er?: number | null } | undefined)?.min_predicted_er ?? null;

  if (minEr != null && predicted_er < minEr) {
    await logDecision(input, {
      decision: 'rejected_critic',
      predicted_er,
      rejected_reason: `predicted_er ${predicted_er.toFixed(4)} < min ${minEr}`,
    });
    return {
      approved: false,
      predicted_er,
      rejected_reason: 'low_predicted_er',
      reason: `predicted ER ${(predicted_er * 100).toFixed(2)}% < min ${(minEr * 100).toFixed(2)}%`,
    };
  }

  // 통과
  await logDecision(input, { decision: 'approved', predicted_er });
  return { approved: true, predicted_er };
}

async function logDecision(
  input: CriticDecisionInput,
  decision: { decision: string; predicted_er: number; bait_match?: string; rejected_reason?: string },
): Promise<void> {
  try {
    await supabaseAdmin.from('card_news_publish_decisions').insert({
      card_news_id: input.cardNewsId ?? null,
      platform: input.platform,
      decision: decision.decision,
      predicted_er: decision.predicted_er,
      features: input.features as unknown as Record<string, unknown>,
      bait_match: decision.bait_match ?? null,
      bandit_arm: input.banditArm ?? null,
      iteration: input.iteration ?? 0,
      rejected_reason: decision.rejected_reason ?? null,
    });
  } catch (err) {
    console.warn('[critic] log 실패:', err instanceof Error ? err.message : String(err));
  }
}

/**
 * 이상치 감지 → 자동 정지. (sync-engagement 또는 별도 cron에서 호출)
 *   - 최근 24h 발행 게시물의 평균 performance_score < baseline의 30% 이면 24h pause.
 */
export async function detectAndPauseIfAnomaly(): Promise<{ paused: boolean; reason?: string }> {
  if (!isSupabaseConfigured) return { paused: false };

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabaseAdmin
    .from('post_engagement_snapshots')
    .select('performance_score, platform')
    .gte('captured_at', since);

  const rows = (data ?? []) as Array<{ performance_score: number | null; platform: string }>;
  const igRows = rows.filter((r) => r.platform === 'instagram' && r.performance_score != null);
  if (igRows.length < 5) return { paused: false };          // 표본 부족

  const avg = igRows.reduce((a, b) => a + (b.performance_score ?? 0), 0) / igRows.length;
  const threshold = BASELINE_ER.instagram * 0.3;
  if (avg < threshold) {
    const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await supabaseAdmin
      .from('card_news_publish_guards')
      .update({
        anomaly_paused_until: until,
        anomaly_reason: `24h avg score ${avg.toFixed(4)} < threshold ${threshold.toFixed(4)}`,
      })
      .eq('scope_label', 'global');
    return { paused: true, reason: `IG 24h avg ${avg.toFixed(4)}` };
  }
  return { paused: false };
}
