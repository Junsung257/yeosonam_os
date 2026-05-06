import { inngest } from '../client';
import { getSecret } from '@/lib/secret-registry';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { decrypt } from '@/lib/encryption';

const TOSS_BASE = 'https://api.tosspayments.com/v1';

/**
 * 테넌트별 자동결제 실행 — monthly-billing 팬아웃에서 호출
 * 독립 함수로 분리: 실패 시 테넌트별 재시도, 다른 테넌트에 영향 없음
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const tenantBillingFn = inngest.createFunction(
  {
    id: 'tenant-billing-charge',
    name: '테넌트 자동결제',
    retries: 2,
    timeouts: { finish: '5m' },
    event: 'billing/charge.tenant',
  } as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ event, step }: any) => {
    if (!isSupabaseConfigured) return { skipped: true };

    const secretKey = getSecret('TOSS_SECRET_KEY');
    if (!secretKey) return { skipped: true, reason: 'TOSS_SECRET_KEY 미설정' };

    const { tenantId, amount } = event.data as { tenantId: string; amount: number };

    const sub = await step.run('get-subscription', async () => {
      const { data, error } = await supabaseAdmin
        .from('tenant_subscriptions')
        .select('toss_billing_key, toss_customer_key')
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data as { toss_billing_key: string | null; toss_customer_key: string | null } | null;
    });

    if (!sub?.toss_billing_key || !sub?.toss_customer_key) {
      return { skipped: true, reason: '빌링키 없음' };
    }

    const result = await step.run('charge', async () => {
      const billingKey = decrypt(sub.toss_billing_key as string);
      const now = new Date();
      const orderId = `${tenantId.slice(0, 8)}-${now.toISOString().slice(0, 7)}`;
      const orderName = `여소남 OS 구독 (${now.toISOString().slice(0, 7)})`;

      const tossRes = await fetch(`${TOSS_BASE}/billing/${billingKey}`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customerKey: sub.toss_customer_key,
          amount,
          orderId,
          orderName,
          currency: 'KRW',
        }),
      });

      const json = await tossRes.json() as { paymentKey?: string; status?: string; message?: string };
      const ok = tossRes.ok && json.status === 'DONE';

      await supabaseAdmin.from('billing_history').insert({
        tenant_id: tenantId,
        toss_payment_key: json.paymentKey ?? null,
        amount_krw: amount,
        status: ok ? 'done' : 'failed',
        failure_message: ok ? null : (json.message ?? '결제 실패'),
      });

      if (ok) {
        const nextBilling = new Date(now);
        nextBilling.setMonth(nextBilling.getMonth() + 1);
        await supabaseAdmin
          .from('tenant_subscriptions')
          .update({ next_billing_date: nextBilling.toISOString().slice(0, 10) })
          .eq('tenant_id', tenantId);
      } else {
        await supabaseAdmin
          .from('tenant_subscriptions')
          .update({ status: 'past_due' })
          .eq('tenant_id', tenantId);
      }

      return { ok, payment_key: json.paymentKey, message: json.message };
    });

    return { tenantId, amount, ...result };
  },
);
