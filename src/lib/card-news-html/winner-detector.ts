/**
 * @file winner-detector.ts — Variant 그룹 내 winner 자동 결정
 *
 * Smartly.io / AdCreative.ai 의 Auto-rotation 패턴.
 *
 * 입력: variant_group_id
 * 처리:
 *   1. 그룹 내 모든 카드의 최신 post_engagement_snapshots 조회
 *   2. 가중 engagement_score 계산 (likes·comments·saves·shares 가중)
 *   3. 그룹 내 max 대비 정규화 (0-100)
 *   4. 상위 1개 → is_winner=true / 나머지 → ARCHIVED (옵션)
 *
 * 발행 후 24h 미만이면 결정 보류 (데이터 부족).
 */

import { supabaseAdmin } from '@/lib/supabase';
import { selectBayesianWinner, snapshotToVariant } from '@/lib/creative-engine/ab-bayesian';

const MIN_HOURS_AFTER_PUBLISH = 24;

interface VariantWithScore {
  id: string;
  variant_angle: string | null;
  ig_post_id: string | null;
  ig_published_at: string | null;
  status: string | null;
  engagement_raw: {
    views?: number;
    reach?: number;
    likes?: number;
    comments?: number;
    shares?: number;
    saves?: number;
  } | null;
  engagement_score_raw: number; // 가중 합
  engagement_score: number;     // 그룹 max 대비 0-100
  hours_since_publish: number;
  variant_score: number | null; // 사전 critic 점수
}

export interface WinnerDecisionReport {
  variant_group_id: string;
  variants: VariantWithScore[];
  winner: VariantWithScore | null;
  decided: boolean;
  reason: string;
  archived_ids: string[];
}

/**
 * IG/Threads engagement 가중 점수.
 * 공유·저장이 단순 좋아요보다 강한 시그널.
 */
function calcEngagementScore(m: VariantWithScore['engagement_raw']): number {
  if (!m) return 0;
  const likes = m.likes ?? 0;
  const comments = m.comments ?? 0;
  const shares = m.shares ?? 0;
  const saves = m.saves ?? 0;
  return likes * 1 + comments * 3 + shares * 5 + saves * 5;
}

export async function detectVariantWinner(input: {
  variantGroupId: string;
  archiveLosers?: boolean;     // true 면 winner 외 ARCHIVED 처리
  dryRun?: boolean;            // true 면 DB 변경 없이 분석만
}): Promise<WinnerDecisionReport> {
  const { variantGroupId, archiveLosers = false, dryRun = false } = input;

  // 1. 그룹의 모든 카드 조회
  const { data: cards, error: cardsErr } = await supabaseAdmin
    .from('card_news')
    .select(
      'id, variant_angle, ig_post_id, ig_published_at, status, variant_score, is_winner',
    )
    .eq('variant_group_id', variantGroupId);
  if (cardsErr) throw new Error(`카드 조회 실패: ${cardsErr.message}`);
  if (!cards || cards.length === 0) {
    return {
      variant_group_id: variantGroupId,
      variants: [],
      winner: null,
      decided: false,
      reason: '그룹이 비어있음',
      archived_ids: [],
    };
  }

  // 2. 각 카드의 최신 engagement snapshot 조회 (병렬)
  type CardRow = {
    id: string;
    variant_angle: string | null;
    ig_post_id: string | null;
    ig_published_at: string | null;
    status: string | null;
    variant_score: number | null;
    is_winner: boolean | null;
  };
  const enriched: VariantWithScore[] = await Promise.all(
    (cards as CardRow[]).map(async (c) => {
      let raw: VariantWithScore['engagement_raw'] = null;
      if (c.ig_post_id) {
        const { data: snaps } = await supabaseAdmin
          .from('post_engagement_snapshots')
          .select('views, reach, likes, comments, shares, saves')
          .eq('card_news_id', c.id)
          .eq('platform', 'instagram')
          .order('captured_at', { ascending: false })
          .limit(1);
        raw = snaps?.[0] ?? null;
      }
      const score_raw = calcEngagementScore(raw);
      const publishedAt = c.ig_published_at ? new Date(c.ig_published_at) : null;
      const hoursSince = publishedAt
        ? (Date.now() - publishedAt.getTime()) / (1000 * 60 * 60)
        : 0;
      return {
        id: c.id,
        variant_angle: c.variant_angle,
        ig_post_id: c.ig_post_id,
        ig_published_at: c.ig_published_at,
        status: c.status,
        engagement_raw: raw,
        engagement_score_raw: score_raw,
        engagement_score: 0, // 정규화 후 채움
        hours_since_publish: hoursSince,
        variant_score: c.variant_score,
      };
    }),
  );

  // 3. 정규화 (그룹 내 max 대비)
  const maxRaw = Math.max(...enriched.map((e) => e.engagement_score_raw), 1);
  for (const e of enriched) {
    e.engagement_score = (e.engagement_score_raw / maxRaw) * 100;
  }

  // 4. 발행 + 24h 경과한 후보만 winner 후보
  const eligible = enriched.filter(
    (e) =>
      e.ig_post_id &&
      e.ig_published_at &&
      e.hours_since_publish >= MIN_HOURS_AFTER_PUBLISH &&
      e.engagement_score_raw > 0,
  );

  if (eligible.length < 2) {
    return {
      variant_group_id: variantGroupId,
      variants: enriched,
      winner: null,
      decided: false,
      reason: `발행+24h+engagement>0 인 후보 ${eligible.length}개. 최소 2개 필요`,
      archived_ids: [],
    };
  }

  // 5. Bayesian A/B 결정 (Thompson Sampling, prob_best >= 0.95)
  const bayesVariants = eligible.map((e) =>
    snapshotToVariant({ id: e.id, engagement_raw: e.engagement_raw }),
  );
  const bayesResult = selectBayesianWinner(bayesVariants);

  if (!bayesResult.decided || !bayesResult.winnerId) {
    return {
      variant_group_id: variantGroupId,
      variants: enriched,
      winner: null,
      decided: false,
      reason: bayesResult.reason,
      archived_ids: [],
    };
  }

  const winner = eligible.find((e) => e.id === bayesResult.winnerId) ?? eligible[0];

  // 6. 실제 DB 업데이트
  const archived_ids: string[] = [];
  if (!dryRun) {
    await supabaseAdmin
      .from('card_news')
      .update({
        is_winner: true,
        winner_decided_at: new Date().toISOString(),
        engagement_score: 100,
        engagement_measured_at: new Date().toISOString(),
      })
      .eq('id', winner.id);

    // 나머지 engagement_score 기록 + (옵션) ARCHIVED
    for (const v of enriched) {
      if (v.id === winner.id) continue;
      const update: Record<string, unknown> = {
        engagement_score: v.engagement_score,
        engagement_measured_at: new Date().toISOString(),
      };
      if (archiveLosers && v.status !== 'ARCHIVED' && v.status !== 'LAUNCHED') {
        update.status = 'ARCHIVED';
        archived_ids.push(v.id);
      }
      await supabaseAdmin.from('card_news').update(update).eq('id', v.id);
    }
  }

  return {
    variant_group_id: variantGroupId,
    variants: enriched,
    winner,
    decided: true,
    reason: bayesResult.reason,
    archived_ids,
  };
}
