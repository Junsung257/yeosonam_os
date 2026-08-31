import { billingChargeTenantEvent, inngest } from '../client';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import {
  billingPeriodFromTimestamp,
  buildInngestEventId,
  isInngestBillingEnabled,
} from '@/inngest/runtime-policy';

/**
 * 월별 자동결제 (Sprint 4-B: TossPayments)
 * 매월 1일 00:00 UTC에 실행
 * 활성 구독 테넌트에 TossPayments 빌링키로 자동결제
 */
export const monthlyBillingFn = inngest.createFunction(
  {
    id: 'monthly-billing',
    name: '월별 자동결제',
    retries: 3,
    timeouts: { finish: '30m' },
    triggers: [{ cron: '0 0 1 * *' }],
  },
  async ({ event, step }) => {
    if (!isInngestBillingEnabled()) {
      return { skipped: true, reason: 'inngest_billing_not_enabled' };
    }
    if (!isSupabaseConfigured) return { skipped: true };

    const billingPeriod = billingPeriodFromTimestamp(event.ts);

    const subscriptions = await step.run('get-active-subscriptions', async () => {
      const { data, error } = await supabaseAdmin
        .from('tenant_subscriptions')
        .select('id, tenant_id, toss_billing_key, monthly_price_krw, plan_type')
        .eq('status', 'active')
        .not('toss_billing_key', 'is', null)
        .neq('plan_type', 'free');

      if (error) throw new Error(`구독 조회 실패: ${error.message}`);
      return data ?? [];
    });

    if (!subscriptions.length) return { charged: 0 };

    await step.sendEvent(
      'fan-out-billing',
      subscriptions.map((sub: { id: string; tenant_id: string; monthly_price_krw: number }) => (
        billingChargeTenantEvent.create({
          tenantId: sub.tenant_id,
          amount: sub.monthly_price_krw,
          billingPeriod,
        }, { id: buildInngestEventId('billing-tenant', sub.tenant_id, billingPeriod) })
      )),
    );

    return { charged: subscriptions.length, billingPeriod };
  },
);
