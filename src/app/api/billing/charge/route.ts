/**
 * POST /api/billing/charge
 *
 * Runs a TossPayments billing-key charge for an active tenant subscription.
 * Intended callers are trusted schedulers or admin automation with ADMIN_API_TOKEN.
 *
 * Body: { tenant_id, amount_krw?, order_id?, order_name? }
 */

import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { isValidAdminApiToken } from '@/lib/api-auth';
import { decrypt } from '@/lib/encryption';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { getSecret } from '@/lib/secret-registry';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

const TOSS_BASE = 'https://api.tosspayments.com/v1';

interface SubscriptionRow {
  toss_billing_key: string | null;
  toss_customer_key: string | null;
  monthly_price_krw: number | null;
  plan_type: string;
}

interface ChargeRequestBody {
  tenant_id?: string;
  amount_krw?: number;
  order_id?: string;
  order_name?: string;
}

interface TossBillingResponse {
  paymentKey?: string;
  status?: string;
  message?: string;
  code?: string;
}

export async function POST(request: NextRequest) {
  if (!isValidAdminApiToken(request)) {
    return apiResponse(
      { error: '관리자 API 토큰이 필요합니다.' },
      { status: 401 },
    );
  }

  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'DB가 설정되지 않았습니다.' }, { status: 503 });
  }

  const secretKey = getSecret('TOSS_SECRET_KEY');
  if (!secretKey) {
    return apiResponse({ error: '결제 설정이 완료되지 않았습니다.' }, { status: 503 });
  }

  let body: ChargeRequestBody;
  try {
    body = await request.json();
  } catch {
    return apiResponse({ error: 'JSON 파싱에 실패했습니다.' }, { status: 400 });
  }

  const { tenant_id, amount_krw: overrideAmount, order_id, order_name } = body;

  if (!tenant_id) {
    return apiResponse({ error: 'tenant_id는 필수입니다.' }, { status: 400 });
  }

  const { data: sub, error: subErr } = await supabaseAdmin
    .from('tenant_subscriptions')
    .select('toss_billing_key, toss_customer_key, monthly_price_krw, plan_type')
    .eq('tenant_id', tenant_id)
    .eq('status', 'active')
    .maybeSingle();

  if (subErr) {
    console.error('[billing/charge] subscription lookup failed:', sanitizeDbError(subErr));
    return apiResponse({ error: '구독 조회에 실패했습니다.' }, { status: 500 });
  }

  if (!sub) {
    return apiResponse({ error: '활성 구독이 없습니다.' }, { status: 404 });
  }

  const { toss_billing_key, toss_customer_key, monthly_price_krw } = sub as SubscriptionRow;
  if (!toss_billing_key || !toss_customer_key) {
    return apiResponse({ error: '빌링키가 등록되지 않았습니다.' }, { status: 422 });
  }

  const amount = overrideAmount ?? monthly_price_krw ?? 0;
  if (amount <= 0) {
    return apiResponse({ error: '결제 금액은 0보다 커야 합니다.' }, { status: 400 });
  }

  const billingKey = decrypt(toss_billing_key);
  const now = new Date();
  const chargeOrderId = order_id ?? `${tenant_id.slice(0, 8)}-${now.toISOString().slice(0, 7)}`;
  const chargeOrderName = order_name ?? `여소남OS 구독 (${now.toISOString().slice(0, 7)})`;

  let tossRes: Response;
  try {
    tossRes = await fetch(`${TOSS_BASE}/billing/${billingKey}`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        customerKey: toss_customer_key,
        amount,
        orderId: chargeOrderId,
        orderName: chargeOrderName,
        currency: 'KRW',
      }),
    });
  } catch (fetchErr) {
    console.error('[billing/charge] Toss fetch failed:', sanitizeDbError(fetchErr));
    return apiResponse({ error: '결제사 호출에 실패했습니다.' }, { status: 502 });
  }

  const tossJson = await tossRes.json() as TossBillingResponse;
  const billedStatus = tossRes.ok && tossJson.status === 'DONE' ? 'done' : 'failed';

  await supabaseAdmin.from('billing_history').insert({
    tenant_id,
    toss_payment_key: tossJson.paymentKey ?? null,
    amount_krw: amount,
    status: billedStatus,
    failure_message: billedStatus === 'failed' ? (tossJson.message ?? '결제 실패') : null,
  });

  if (billedStatus === 'done') {
    const nextBilling = new Date(now);
    nextBilling.setMonth(nextBilling.getMonth() + 1);

    await supabaseAdmin
      .from('tenant_subscriptions')
      .update({ next_billing_date: nextBilling.toISOString().slice(0, 10) })
      .eq('tenant_id', tenant_id);

    return apiResponse({
      ok: true,
      payment_key: tossJson.paymentKey,
      amount,
      next_billing_date: nextBilling.toISOString().slice(0, 10),
    });
  }

  await supabaseAdmin
    .from('tenant_subscriptions')
    .update({ status: 'past_due' })
    .eq('tenant_id', tenant_id);

  console.error('[billing/charge] Toss billing failed:', sanitizeDbError(tossJson.message ?? tossJson.code));
  return apiResponse(
    { error: '자동결제에 실패했습니다.', code: tossJson.code },
    { status: 502 },
  );
}
