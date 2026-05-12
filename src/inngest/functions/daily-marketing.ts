import { inngest } from '../client';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

/**
 * 데일리 마케팅 파이프라인 오케스트레이터 (Inngest Cron)
 * Schedule: 20 0 * * * (매일 00:20 UTC = 09:20 KST)
 *
 * 활성 테넌트를 조회한 뒤 각각 marketing/tenant.run 이벤트를 발행.
 * tenantMarketingFn이 테넌트별로 독립 실행.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const dailyMarketingFn = inngest.createFunction(
  {
    id: 'daily-marketing-orchestrator',
    name: '데일리 마케팅 오케스트레이터',
    concurrency: { limit: 1 },
    cron: '20 0 * * *',
  } as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ step }: any) => {
    if (!isSupabaseConfigured) return { skipped: true, reason: 'Supabase 미설정' };

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
      tenants.map((t: { id: string; name: string }) => ({
        name: 'marketing/tenant.run',
        data: { tenantId: t.id, tenantName: t.name },
      })),
    );

    return { tenants: tenants.length, fanned_out: true };
  },
);
