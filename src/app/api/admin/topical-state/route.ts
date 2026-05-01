import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

/**
 * 토픽 권위 + Programmatic SEO 상태 조회 + 즉시 실행 트리거
 *   GET   → 통계 + 매트릭스 진행률
 *   POST  { action: 'rebuild' } → cron 즉시 실행
 *   POST  { action: 'seed' }    → 매트릭스 시드만
 *   POST  { action: 'promote', limit: N } → pending → queue 즉시 promote
 */

export async function GET() {
  if (!isSupabaseConfigured) return NextResponse.json({ items: [] });

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

  const clusters = clustersRes.data || [];
  const byDest = new Map<string, number>();
  for (const c of clusters) {
    byDest.set((c as any).destination, (byDest.get((c as any).destination) || 0) + 1);
  }

  const matrixStats: Record<string, number> = {};
  for (const r of matrixStatsRes.data || []) {
    matrixStats[(r as any).status] = (matrixStats[(r as any).status] || 0) + 1;
  }

  return NextResponse.json({
    pillars: pillarRes.data || [],
    pillar_count: pillarRes.count || 0,
    cluster_total: clusters.length,
    cluster_by_destination: Array.from(byDest.entries()).map(([destination, count]) => ({ destination, count })),
    matrix: matrixStats,
    matrix_pending_sample: matrixSampleRes.data || [],
  });
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  const body = await request.json().catch(() => ({}));
  const action = body.action;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

  if (action === 'rebuild') {
    const res = await fetch(`${baseUrl}/api/cron/topical-rebuild`);
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
