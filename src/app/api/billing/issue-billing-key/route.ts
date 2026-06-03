/**
 * POST /api/billing/issue-billing-key
 *
 * Exchanges a TossPayments auth key for a billing key and stores it encrypted.
 *
 * Body: { tenant_id, customer_key, auth_key }
 */

import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { encrypt } from '@/lib/encryption';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { getSecret } from '@/lib/secret-registry';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

const TOSS_BASE = 'https://api.tosspayments.com/v1';

interface IssueBillingKeyBody {
  tenant_id?: string;
  customer_key?: string;
  auth_key?: string;
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'DB가 설정되지 않았습니다.' }, { status: 503 });
  }

  const secretKey = getSecret('TOSS_SECRET_KEY');
  if (!secretKey) {
    return apiResponse({ error: '결제 설정이 완료되지 않았습니다.' }, { status: 503 });
  }

  let body: IssueBillingKeyBody;
  try {
    body = await request.json() as IssueBillingKeyBody;
  } catch {
    return apiResponse({ error: 'JSON 파싱에 실패했습니다.' }, { status: 400 });
  }

  const { tenant_id, customer_key, auth_key } = body;
  if (!tenant_id || !customer_key || !auth_key) {
    return apiResponse({ error: 'tenant_id, customer_key, auth_key는 필수입니다.' }, { status: 400 });
  }

  let tossRes: Response;
  try {
    tossRes = await fetch(`${TOSS_BASE}/billing/authorizations/${auth_key}`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ customerKey: customer_key }),
    });
  } catch (error) {
    console.error('[issue-billing-key] Toss fetch failed:', sanitizeDbError(error));
    return apiResponse({ error: '결제사 호출에 실패했습니다.' }, { status: 502 });
  }

  if (!tossRes.ok) {
    const detail = await tossRes.text().catch(() => '');
    console.error('[issue-billing-key] Toss billing authorization failed:', sanitizeDbError(detail));
    return apiResponse({ error: '빌링키 발급에 실패했습니다.' }, { status: 502 });
  }

  const tossJson = await tossRes.json() as { billingKey?: string; customerKey?: string };
  if (!tossJson.billingKey) {
    return apiResponse({ error: '빌링키 발급 응답이 올바르지 않습니다.' }, { status: 502 });
  }

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

  if (error) {
    console.error('[issue-billing-key] subscription upsert failed:', sanitizeDbError(error));
    return apiResponse({ error: '빌링키 저장에 실패했습니다.' }, { status: 500 });
  }

  return apiResponse({ ok: true, customer_key });
}
