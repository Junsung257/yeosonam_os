import { inngest, marketingTenantRunEvent } from '../client';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabase';
import {
  buildInngestEventId,
  isInngestScheduleExecutionEnabled,
  utcDayFromTimestamp,
} from '@/inngest/runtime-policy';

/**
 * 데일리 마케팅 파이프라인 오케스트레이터 (Inngest Cron)
 * Schedule: 20 0 * * * (매일 00:20 UTC = 09:20 KST)
 *
 * 활성 테넌트를 조회한 뒤 각각 marketing/tenant.run 이벤트를 발행.
 * tenantMarketingFn이 테넌트별로 독립 실행.
 */
export const dailyMarketingFn = inngest.createFunction(
  {
    id: 'daily-marketing-orchestrator',
    name: '데일리 마케팅 오케스트레이터',
    concurrency: { limit: 1 },
    triggers: [{ cron: '20 0 * * *' }],
  },
  async ({ event, step }) => {
    if (!isInngestScheduleExecutionEnabled()) {
      return { skipped: true, reason: 'inngest_schedule_cutover_not_enabled' };
    }
    if (!isSupabaseAdminConfigured) return { skipped: true, reason: 'Supabase admin 미설정' };

    const runDate = utcDayFromTimestamp(event.ts);

    const tenants = await step.run('get-active-tenants', async () => {
      const { data, error } = await supabaseAdmin
        .from('tenants')
        .select('id, name')
        .eq('status', 'active')
        .order('created_at', { ascending: true });

      if (error) throw new Error(`테넌트 조회 실패: ${error.message}`);
      return data ?? [];
    });

    if (!tenants.length) return { tenants: 0 };

    await step.sendEvent(
      'fan-out-tenants',
      tenants.map((t: { id: string; name: string }) => marketingTenantRunEvent.create(
        { tenantId: t.id, tenantName: t.name, runDate },
        { id: buildInngestEventId('marketing-tenant', t.id, runDate) },
      )),
    );

    return { tenants: tenants.length, runDate, fanned_out: true };
  },
);
