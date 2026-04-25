/**
 * @file src/app/api/cron/variant-winner-decide/route.ts
 *
 * 매일 1회 — 변형 그룹의 winner 자동 결정.
 *
 * 처리:
 *   1. 아직 winner 미결정 그룹 (winner_decided_at IS NULL) 조회
 *   2. 그룹 내 모든 카드가 발행 후 72h+ 경과한 경우만 시도
 *   3. detectVariantWinner 호출 — 변별력(1.2x)이 있을 때만 결정
 *   4. winner = is_winner=true, 나머지 ARCHIVED (자동)
 *
 * Vercel cron: 매일 05:00 UTC (sync-engagement 04:00 UTC 직후).
 * 인증: x-vercel-cron 헤더 또는 CRON_SECRET.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { detectVariantWinner } from '@/lib/card-news-html/winner-detector';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MIN_GROUP_HOURS = 72;

export async function GET(request: NextRequest) {
  // 인증
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  const authorized =
    isVercelCron ||
    (cronSecret && authHeader === `Bearer ${cronSecret}`);
  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  const startedAt = Date.now();
  const cutoff = new Date(Date.now() - MIN_GROUP_HOURS * 60 * 60 * 1000).toISOString();

  // 1. 아직 결정 안 된 그룹 조회 (그룹 내 가장 늦은 발행이 72h+ 경과)
  const { data: candidates, error } = await supabaseAdmin
    .from('card_news')
    .select('variant_group_id, ig_published_at')
    .not('variant_group_id', 'is', null)
    .not('ig_published_at', 'is', null)
    .is('is_winner', false)
    .is('winner_decided_at', null);

  if (error) {
    console.error('[variant-winner-decide]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 2. variant_group_id 별로 그룹 + 가장 늦은 발행 시간 계산
  const groupLatest = new Map<string, string>(); // group_id → latest published_at
  for (const row of candidates ?? []) {
    if (!row.variant_group_id || !row.ig_published_at) continue;
    const prev = groupLatest.get(row.variant_group_id);
    if (!prev || row.ig_published_at > prev) {
      groupLatest.set(row.variant_group_id, row.ig_published_at);
    }
  }

  // 3. 72h 경과한 그룹만 처리
  const eligibleGroups: string[] = [];
  for (const [gid, latest] of groupLatest.entries()) {
    if (latest < cutoff) eligibleGroups.push(gid);
  }

  // 4. 각 그룹 winner 결정 (병렬 가능하지만 안전하게 순차)
  const decisions: Array<{
    group_id: string;
    decided: boolean;
    winner_id?: string | null;
    winner_angle?: string | null;
    archived_count: number;
    reason: string;
  }> = [];

  for (const groupId of eligibleGroups) {
    try {
      const report = await detectVariantWinner({
        variantGroupId: groupId,
        archiveLosers: true,
        dryRun: false,
      });
      decisions.push({
        group_id: groupId,
        decided: report.decided,
        winner_id: report.winner?.id ?? null,
        winner_angle: report.winner?.variant_angle ?? null,
        archived_count: report.archived_ids.length,
        reason: report.reason,
      });
    } catch (e) {
      decisions.push({
        group_id: groupId,
        decided: false,
        archived_count: 0,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return NextResponse.json({
    eligible_groups: eligibleGroups.length,
    decided_count: decisions.filter((d) => d.decided).length,
    decisions,
    duration_ms: Date.now() - startedAt,
  });
}
