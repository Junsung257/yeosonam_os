import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase';
import { rebuildAllClusters } from '@/lib/topical-authority';
import { seedProgrammaticTopics, promotePendingTopics } from '@/lib/programmatic-seo';
import { withCronLogging } from '@/lib/cron-observability';

/**
 * Topical Authority + Programmatic SEO 통합 cron — 매주 일요일 18:00 UTC (월 03:00 KST)
 *
 * 흐름:
 *   1) Programmatic SEO 매트릭스 시드 (idempotent — 이미 있는 건 무시)
 *   2) Pending 매트릭스에서 N개 promote → blog_topic_queue
 *   3) 모든 destination의 pillar↔cluster 재구성 (interlink 매핑)
 *
 * 일요일 밤에 실행 = 월요일 0시 blog-scheduler refillWeeklyQueue 직전.
 */

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

async function runTopicalRebuild(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!isSupabaseConfigured) {
    return { skipped: true, reason: 'Supabase 미설정', errors: [] as string[] };
  }

  const errors: string[] = [];

  // 1) Programmatic SEO 매트릭스 시드
  let seedResult: any = null;
  try {
    seedResult = await seedProgrammaticTopics();
  } catch (err) {
    errors.push(`seed 실패: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 2) Pending 토픽 promote (주당 7개 = 매일 1편 분량)
  let promoteResult: any = null;
  try {
    promoteResult = await promotePendingTopics({ limit: 7 });
  } catch (err) {
    errors.push(`promote 실패: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 3) Topical Authority cluster 재구성
  let clusterResult: any = null;
  try {
    clusterResult = await rebuildAllClusters();
  } catch (err) {
    errors.push(`cluster rebuild 실패: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    seed: seedResult,
    promote: promoteResult,
    clusters: clusterResult,
    errors,
    ranAt: new Date().toISOString(),
  };
}

export const GET = withCronLogging('topical-rebuild', runTopicalRebuild);
