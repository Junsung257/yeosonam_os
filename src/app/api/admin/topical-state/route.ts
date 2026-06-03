import { type NextRequest, type NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withAdminGuard } from '@/lib/admin-guard';
import { getSecret } from '@/lib/secret-registry';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';

/**
 * 토픽 권위 + Programmatic SEO 상태 조회 + 즉시 실행 트리거
 *   GET   → 통계 + 매트릭스 진행률
 *   POST  { action: 'rebuild' } → cron 즉시 실행
 *   POST  { action: 'seed' }    → 매트릭스 시드만
 *   POST  { action: 'promote', limit: N } → pending → queue 즉시 promote
 */

const getHandler = async (): Promise<NextResponse> => {
  if (!isSupabaseConfigured) return apiResponse({ items: [] });

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
    const clusterByDestination = Array.from(byDest.entries()).map(([destination, count]) => ({ destination, count }));
    const weakDestinations = clusterByDestination
      .filter((row) => row.count < 3)
      .sort((a, b) => a.count - b.count)
      .slice(0, 10);
    const averageClustersPerPillar = (pillarRes.count || 0) > 0 ? clusters.length / (pillarRes.count || 1) : 0;
    const authorityScore = Math.min(
      100,
      Math.round(
        Math.min(40, (pillarRes.count || 0) * 8) +
        Math.min(35, averageClustersPerPillar * 7) +
        Math.min(15, (matrixStats.queued || 0) * 1.5) +
        Math.min(10, (matrixStats.published || 0) * 0.5),
      ),
    );
    const nextActions = [
      (pillarRes.count || 0) === 0 ? '대표 여행지별 Pillar 페이지를 먼저 생성하세요.' : null,
      weakDestinations.length > 0 ? `${weakDestinations[0].destination} 등 Cluster 3개 미만 여행지부터 보강하세요.` : null,
      (matrixStats.pending || 0) > 0 ? '대기 중 매트릭스 토픽을 큐로 승격해 장기 검색 수요를 채우세요.' : null,
      clusters.length === 0 ? 'Cluster 재구성을 실행해 Pillar와 하위 글을 내부링크로 묶으세요.' : null,
    ].filter(Boolean);

    return apiResponse({
      pillars: pillarRes.data || [],
      pillar_count: pillarRes.count || 0,
      cluster_total: clusters.length,
      cluster_by_destination: clusterByDestination,
      authority_score: authorityScore,
      weak_destinations: weakDestinations,
      next_actions: nextActions,
      matrix: matrixStats,
      matrix_pending_sample: matrixSampleRes.data || [],
    });
  } catch (err) {
    return apiResponse({
      pillars: [],
      pillar_count: 0,
      cluster_total: 0,
      cluster_by_destination: [],
      authority_score: 0,
      weak_destinations: [],
      next_actions: ['토픽 권위 상태 조회 오류를 먼저 해결하세요.'],
      matrix: { pending: 0, queued: 0, skipped: 0, failed: 0, dropped: 0, published: 0 },
      matrix_pending_sample: [],
      error: sanitizeDbError(err, '토픽 권위 상태 조회 실패'),
    }, { status: 500 });
  }
}

const postHandler = async (request: NextRequest): Promise<NextResponse> => {
  if (!isSupabaseConfigured) return apiResponse({ error: 'DB 미설정' }, { status: 503 });

  try {
    const body = await request.json().catch(() => ({}));
    const action = body.action;
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

    if (action === 'rebuild') {
      const headers: Record<string, string> = {};
      const secret = getSecret('CRON_SECRET');
      if (secret) headers.Authorization = `Bearer ${secret}`;
      const res = await fetch(`${baseUrl}/api/cron/topical-rebuild`, { headers });
      const result = await res.json().catch(() => null);
      if (!res.ok) {
        return apiResponse(
          { error: 'topical rebuild failed', result },
          { status: 502 },
        );
      }
      return apiResponse({ result });
    }

    if (action === 'seed') {
      const { seedProgrammaticTopics } = await import('@/lib/programmatic-seo');
      return apiResponse({ result: await seedProgrammaticTopics() });
    }

    if (action === 'promote') {
      const { promotePendingTopics } = await import('@/lib/programmatic-seo');
      const limit = typeof body.limit === 'number'
        ? Math.min(100, Math.max(1, body.limit))
        : 7;
      return apiResponse({ result: await promotePendingTopics({ limit }) });
    }

    if (action === 'rebuild_clusters') {
      const { rebuildAllClusters } = await import('@/lib/topical-authority');
      return apiResponse({ result: await rebuildAllClusters() });
    }

    return apiResponse({ error: 'unknown action' }, { status: 400 });
  } catch (err) {
    return apiResponse(
      { error: sanitizeDbError(err, '토픽 권위 작업 실패') },
      { status: 500 },
    );
  }
}

export const GET = withAdminGuard(getHandler);

export const POST = withAdminGuard(postHandler);
