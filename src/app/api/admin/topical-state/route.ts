import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withAdminGuard } from '@/lib/admin-guard';
import { getSecret } from '@/lib/secret-registry';

/**
 * 토픽 권위 + Programmatic SEO 상태 조회 + 즉시 실행 트리거
 *   GET   → 통계 + 매트릭스 진행률
 *   POST  { action: 'rebuild' } → cron 즉시 실행
 *   POST  { action: 'seed' }    → 매트릭스 시드만
 *   POST  { action: 'promote', limit: N } → pending → queue 즉시 promote
 */

const getHandler = async () => {
  if (!isSupabaseConfigured) return NextResponse.json({ items: [] });

  try {
    const [
      pillarRes,
      clustersRes,
      matrixStatsRes,
      matrixSampleRes,
    ] = await Promise.all([
      supabaseAdmin.from('content_creatives').select('slug, pillar_for', { count: 'exact' })
        .eq('content_type', 'pillar').eq('status', 'published').limit(50),
      supabaseAdmin.from('topical_clusters').select('pillar_slug, cluster_slug, destination'),
      supabaseAdmin.from('programmatic_seo_topics').select('status', { count: 'exact' }),
      supabaseAdmin.from('programmatic_seo_topics').select('*')
        .eq('status', 'pending').order('priority', { ascending: false }).limit(20),
    ]);

    const firstError = pillarRes.error || clustersRes.error || matrixStatsRes.error || matrixSampleRes.error;
    if (firstError) throw firstError;

    const clusters = clustersRes.data || [];
    const byDest = new Map<string, number>();
    for (const c of clusters) {
      const destination = (c as Record<string, unknown>).destination as string | null;
      if (!destination) continue;
      byDest.set(destination, (byDest.get(destination) || 0) + 1);
    }

    const matrixStats: Record<string, number> = { pending: 0, queued: 0, skipped: 0, failed: 0, dropped: 0, published: 0 };
    for (const r of matrixStatsRes.data || []) {
      const status = (r as Record<string, unknown>).status as string;
      matrixStats[status] = (matrixStats[status] || 0) + 1;
    }

    return NextResponse.json({
      pillars: pillarRes.data || [],
      pillar_count: pillarRes.count || 0,
      cluster_total: clusters.length,
      cluster_by_destination: Array.from(byDest.entries()).map(([destination, count]) => ({ destination, count })),
      matrix: matrixStats,
      matrix_pending_sample: matrixSampleRes.data || [],
    });
  } catch (err) {
    return NextResponse.json({
      pillars: [],
      pillar_count: 0,
      cluster_total: 0,
      cluster_by_destination: [],
      matrix: { pending: 0, queued: 0, skipped: 0, failed: 0, dropped: 0, published: 0 },
      matrix_pending_sample: [],
      error: err instanceof Error ? err.message : '토픽 권위 상태 조회 실패',
    }, { status: 500 });
  }
}

const postHandler = async (request: NextRequest) => {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  const body = await request.json().catch(() => ({}));
  const action = body.action;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

  if (action === 'rebuild') {
    const headers: Record<string, string> = {};
    const secret = getSecret('CRON_SECRET');
    if (secret) headers.Authorization = `Bearer ${secret}`;
    const res = await fetch(`${baseUrl}/api/cron/topical-rebuild`, { headers });
    return NextResponse.json({ result: await res.json() });
  }

  if (action === 'seed') {
    const { seedProgrammaticTopics } = await import('@/lib/programmatic-seo');
    return NextResponse.json({ result: await seedProgrammaticTopics() });
  }

  if (action === 'promote') {
    const { promotePendingTopics } = await import('@/lib/programmatic-seo');
    return NextResponse.json({ result: await promotePendingTopics({ limit: body.limit || 7 }) });
  }

  if (action === 'rebuild_clusters') {
    const { rebuildAllClusters } = await import('@/lib/topical-authority');
    return NextResponse.json({ result: await rebuildAllClusters() });
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}

export const GET = withAdminGuard(getHandler);

export const POST = withAdminGuard(postHandler);
