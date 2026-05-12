import { NextRequest, NextResponse } from 'next/server';
import { requireCronBearer } from '@/lib/cron-auth';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { runMarketingPipeline } from '@/lib/marketing-pipeline/orchestrator';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5분
export const dynamic = 'force-dynamic';

/**
 * 데일리 마케팅 파이프라인 크론
 * Schedule: 20 0 * * * (매일 00:20 UTC = 09:20 KST)
 *
 * 활성 테넌트 각각에 대해 순차로 마케팅 파이프라인 실행:
 *   ContentAgent → AdAgent → EngagementAgent → OptimizationAgent → ReportingAgent
 */
export async function GET(request: NextRequest) {
  const t0 = Date.now();

  const authErr = requireCronBearer(request);
  if (authErr) return authErr;

  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'Supabase 미설정' });
  }

  // 활성 테넌트 목록
  const { data: tenants, error } = await supabaseAdmin
    .from('tenants')
    .select('id, name')
    .eq('status', 'active')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[daily-marketing] 테넌트 조회 실패:', error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  if (!tenants?.length) {
    return NextResponse.json({ ok: true, tenants: 0, results: [] });
  }

  // 테넌트별 병렬 실행 — 독립 파이프라인이므로 동시 실행 가능, 한 테넌트 실패가 나머지 차단 안 함
  const settled = await Promise.allSettled(
    tenants.map(async (tenant: { id: string; name: string }) => {
      console.log(`[daily-marketing] 테넌트 시작: ${tenant.name} (${tenant.id?.slice(0, 8) ?? '?'})`);
      const result = await runMarketingPipeline(tenant.id);
      console.log(`[daily-marketing] 테넌트 완료: ${tenant.name} → ${result.status} (${result.elapsed_ms}ms)`);
      return { tenantId: tenant.id, tenantName: tenant.name, status: result.status, elapsed_ms: result.elapsed_ms };
    }),
  );

  const results = settled.map((s, i) => {
    if (s.status === 'fulfilled') return s.value;
    const error = s.reason instanceof Error ? s.reason.message : String(s.reason);
    console.error(`[daily-marketing] 테넌트 예외 (${tenants[i].name}):`, s.reason);
    void supabaseAdmin.from('agent_incidents').insert({
      tenant_id: tenants[i].id,
      severity: 'error',
      category: 'unknown',
      message: `[daily-marketing] ${tenants[i].name}: ${error}`,
      details: { tenantId: tenants[i].id },
      detected_by: 'cron/daily-marketing',
    }).catch(() => null);
    return { tenantId: tenants[i].id, tenantName: tenants[i].name, status: 'failed', elapsed_ms: 0, error };
  });

  const total_ms = Date.now() - t0;
  const failed = results.filter(r => r.status === 'failed').length;

  return NextResponse.json({
    ok: failed === 0,
    tenants: results.length,
    failed,
    total_ms,
    results,
  });
}
