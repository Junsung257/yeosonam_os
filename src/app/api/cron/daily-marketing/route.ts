import { NextRequest } from 'next/server';
import { requireCronBearer } from '@/lib/cron-auth';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { runMarketingPipeline } from '@/lib/marketing-pipeline/orchestrator';
import { withCronLogging } from '@/lib/cron-observability';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * 데일리 마케팅 파이프라인 크론
 * Schedule: 20 0 * * * (매일 00:20 UTC = 09:20 KST)
 */
const handleDailyMarketing = async (request: NextRequest) => {
  const t0 = Date.now();

  const authErr = requireCronBearer(request);
  if (authErr) return authErr;

  if (!isSupabaseConfigured) {
    return { ok: true, skipped: true, reason: 'Supabase 미설정', errors: [] as string[] };
  }

  const { data: tenants, error } = await supabaseAdmin
    .from('tenants')
    .select('id, name')
    .eq('status', 'active')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[daily-marketing] 테넌트 조회 실패:', error);
    return { ok: false, error: error.message, errors: [error.message] };
  }

  if (!tenants?.length) {
    return { ok: true, tenants: 0, results: [] };
  }

  const settled = await Promise.allSettled(
    tenants.map(async (tenant: { id: string; name: string }) => {
      console.log(`[daily-marketing] 테넌트 시작: ${tenant.name} (${tenant.id?.slice(0, 8) ?? '?'})`);
      const result = await runMarketingPipeline(tenant.id);
      console.log(`[daily-marketing] 테넌트 완료: ${tenant.name} → ${result.status} (${result.elapsed_ms}ms)`);
      return { tenantId: tenant.id, tenantName: tenant.name, status: result.status, elapsed_ms: result.elapsed_ms };
    }),
  );

  const errors: string[] = [];
  const results = settled.map((s, i) => {
    if (s.status === 'fulfilled') return s.value;
    const errMsg = s.reason instanceof Error ? s.reason.message : String(s.reason);
    console.error(`[daily-marketing] 테넌트 예외 (${tenants[i].name}):`, s.reason);
    void Promise.resolve(supabaseAdmin.from('agent_incidents').insert({
      tenant_id: tenants[i].id,
      severity: 'error',
      category: 'unknown',
      message: `[daily-marketing] ${tenants[i].name}: ${errMsg}`,
      details: { tenantId: tenants[i].id },
      detected_by: 'cron/daily-marketing',
    })).catch(() => null);
    errors.push(`${tenants[i].name}: ${errMsg}`);
    return { tenantId: tenants[i].id, tenantName: tenants[i].name, status: 'failed', elapsed_ms: 0, error: errMsg };
  });

  const total_ms = Date.now() - t0;
  const failed = results.filter(r => r.status === 'failed').length;

  return { ok: failed === 0, tenants: results.length, failed, total_ms, results, errors };
};

export const GET = withCronLogging('daily-marketing', handleDailyMarketing);
