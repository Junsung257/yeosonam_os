/**
 * POST /api/billing/charge
 *
 * 빌링키로 자동결제 실행 (Inngest monthly cron에서 호출).
 * 한 테넌트에 대해 한 달치 요금 청구.
 *
 * Body: { tenant_id, amount_krw, order_id?, order_name? }
 *
 * 환경변수: TOSS_SECRET_KEY
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSecret } from '@/lib/secret-registry';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { decrypt } from '@/lib/encryption';

const TOSS_BASE = 'https://api.tosspayments.com/v1';

interface SubscriptionRow {
  toss_billing_key: string | null;
  toss_customer_key: string | null;
  monthly_price_krw: number | null;
  plan_type: string;
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  const secretKey = getSecret('TOSS_SECRET_KEY');
  if (!secretKey) return NextResponse.json({ error: 'TOSS_SECRET_KEY 미설정' }, { status: 503 });

  let body: { tenant_id?: string; amount_krw?: number; order_id?: string; order_name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON 파싱 실패' }, { status: 400 });
  }

  const { tenant_id, amount_krw: overrideAmount, order_id, order_name } = body;

  if (!tenant_id) {
    return NextResponse.json({ error: 'tenant_id 필수' }, { status: 400 });
  }

  // 구독 정보 조회
  const { data: sub, error: subErr } = await supabaseAdmin
    .from('tenant_subscriptions')
    .select('toss_billing_key, toss_customer_key, monthly_price_krw, plan_type')
    .eq('tenant_id', tenant_id)
    .eq('status', 'active')
    .maybeSingle();

  if (subErr) return NextResponse.json({ error: subErr.message }, { status: 500 });
  if (!sub) return NextResponse.json({ error: '활성 구독 없음' }, { status: 404 });

  const { toss_billing_key, toss_customer_key, monthly_price_krw } = sub as SubscriptionRow;
  if (!toss_billing_key || !toss_customer_key) {
    return NextResponse.json({ error: '빌링키 미등록' }, { status: 422 });
  }

  const amount = overrideAmount ?? monthly_price_krw ?? 0;
  if (amount <= 0) return NextResponse.json({ error: '결제 금액 0원 이하' }, { status: 400 });

  const billingKey = decrypt(toss_billing_key);
  const now = new Date();
  const chargeOrderId = order_id ?? `${tenant_id.slice(0, 8)}-${now.toISOString().slice(0, 7)}`;
  const chargeOrderName = order_name ?? `여소남 OS 구독 (${now.toISOString().slice(0, 7)})`;

  // TossPayments 자동결제 실행
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
    const msg = fetchErr instanceof Error ? fetchErr.message : 'Toss 네트워크 오류';
    console.error('[billing/charge] Toss fetch 실패:', msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const tossJson = await tossRes.json() as {
    paymentKey?: string;
    status?: string;
    message?: string;
    code?: string;
  };

  const billedStatus = tossRes.ok && tossJson.status === 'DONE' ? 'done' : 'failed';

  // 결제 이력 기록
  await supabaseAdmin.from('billing_history').insert({
    tenant_id,
    toss_payment_key: tossJson.paymentKey ?? null,
    amount_krw: amount,
    status: billedStatus,
    failure_message: billedStatus === 'failed' ? (tossJson.message ?? '결제 실패') : null,
  });

  if (billedStatus === 'done') {
    // 다음 결제일 업데이트 (+1개월)
    const nextBilling = new Date(now);
    nextBilling.setMonth(nextBilling.getMonth() + 1);

    await supabaseAdmin
      .from('tenant_subscriptions')
      .update({ next_billing_date: nextBilling.toISOString().slice(0, 10) })
      .eq('tenant_id', tenant_id);

    return NextResponse.json({
      ok: true,
      payment_key: tossJson.paymentKey,
      amount,
      next_billing_date: nextBilling.toISOString().slice(0, 10),
    });
  }

  // 결제 실패 → past_due 상태로 전환
  await supabaseAdmin
    .from('tenant_subscriptions')
    .update({ status: 'past_due' })
    .eq('tenant_id', tenant_id);

  return NextResponse.json(
    { error: tossJson.message ?? '자동결제 실패', code: tossJson.code },
    { status: 502 },
  );
}
