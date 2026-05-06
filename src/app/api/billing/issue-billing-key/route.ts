/**
 * POST /api/billing/issue-billing-key
 *
 * TossPayments 빌링키 발급 (최초 카드 등록 시 호출).
 *
 * Body: { tenant_id, customer_key, auth_key }
 *   - customer_key: 사전에 생성한 UUID (테넌트별 1개)
 *   - auth_key: TossPayments 위젯에서 콜백으로 받은 인증키
 *
 * 환경변수: TOSS_SECRET_KEY
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSecret } from '@/lib/secret-registry';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { encrypt } from '@/lib/encryption';

const TOSS_BASE = 'https://api.tosspayments.com/v1';

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  const secretKey = getSecret('TOSS_SECRET_KEY');
  if (!secretKey) return NextResponse.json({ error: 'TOSS_SECRET_KEY 미설정' }, { status: 503 });

  const { tenant_id, customer_key, auth_key } = await request.json() as {
    tenant_id?: string;
    customer_key?: string;
    auth_key?: string;
  };

  if (!tenant_id || !customer_key || !auth_key) {
    return NextResponse.json({ error: 'tenant_id, customer_key, auth_key 필수' }, { status: 400 });
  }

  // TossPayments 빌링키 발급
  const tossRes = await fetch(`${TOSS_BASE}/billing/authorizations/${auth_key}`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ customerKey: customer_key }),
  });

  if (!tossRes.ok) {
    const detail = await tossRes.text();
    console.error('[issue-billing-key] Toss 빌링키 발급 실패:', detail);
    return NextResponse.json({ error: '빌링키 발급 실패', detail }, { status: 502 });
  }

  const tossJson = await tossRes.json() as { billingKey: string; customerKey: string };

  // 빌링키 암호화 후 DB 저장
  const encryptedKey = encrypt(tossJson.billingKey);

  const { error } = await supabaseAdmin
    .from('tenant_subscriptions')
    .upsert(
      {
        tenant_id,
        toss_billing_key: encryptedKey,
        toss_customer_key: customer_key,
        status: 'active',
      },
      { onConflict: 'tenant_id' },
    );

  if (error) throw error;

  return NextResponse.json({ ok: true, customer_key });
}
