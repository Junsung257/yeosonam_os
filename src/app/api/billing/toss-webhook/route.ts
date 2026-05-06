/**
 * POST /api/billing/toss-webhook
 *
 * TossPayments Webhook 수신 처리.
 *
 * 검증: Authorization 헤더의 Basic 시크릿키 비교
 * 처리:
 *   - PAYMENT_STATUS_CHANGED → billing_history 및 tenant_subscriptions 상태 동기화
 *   - BILLING_KEY_DELETED    → 빌링키 제거 + 구독 cancelled
 *
 * 환경변수: TOSS_SECRET_KEY
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSecret } from '@/lib/secret-registry';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

interface TossWebhookBody {
  eventType: string;
  createdAt: string;
  data: {
    paymentKey?: string;
    orderId?: string;
    status?: string;     // DONE | CANCELED | PARTIAL_CANCELED | ABORTED | EXPIRED
    totalAmount?: number;
    billingKey?: string;
    customerKey?: string;
  };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 서명 검증: Basic {base64(secretKey:)} 형식
  const secretKey = getSecret('TOSS_SECRET_KEY');
  if (!secretKey) {
    console.error('[toss-webhook] TOSS_SECRET_KEY 미설정 — 요청 거부');
    return NextResponse.json({ error: 'TOSS_SECRET_KEY 미설정' }, { status: 503 });
  }
  const authHeader = request.headers.get('Authorization') ?? '';
  const expected = `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`;
  if (authHeader !== expected) {
    return NextResponse.json({ error: '인증 실패' }, { status: 401 });
  }

  let body: TossWebhookBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  if (!isSupabaseConfigured) {
    console.log('[toss-webhook] Supabase 미설정, 이벤트 무시:', body.eventType);
    return NextResponse.json({ ok: true });
  }

  try {
    switch (body.eventType) {
      case 'PAYMENT_STATUS_CHANGED': {
        const { paymentKey, status, totalAmount, orderId } = body.data;
        if (!paymentKey) break;

        const billedStatus =
          status === 'DONE' ? 'done' :
          status === 'CANCELED' || status === 'PARTIAL_CANCELED' ? 'cancelled' :
          'failed';

        // billing_history upsert (paymentKey UNIQUE 기준)
        await supabaseAdmin.from('billing_history').upsert(
          {
            toss_payment_key: paymentKey,
            amount_krw: totalAmount ?? 0,
            status: billedStatus,
          },
          { onConflict: 'toss_payment_key', ignoreDuplicates: false },
        );

        // orderId에서 tenant_id 추출 (issue-billing-key에서 {tenant_id_prefix}-{month} 형식)
        if (orderId && billedStatus === 'cancelled') {
          const tenantPrefix = orderId.split('-')[0];
          if (tenantPrefix) {
            // prefix 매칭으로 구독 상태 업데이트 (옵션 — 비정확할 수 있어 로그만)
            console.warn(`[toss-webhook] 결제 취소: orderId=${orderId}`);
          }
        }
        break;
      }

      case 'BILLING_KEY_DELETED': {
        const { customerKey } = body.data;
        if (!customerKey) break;

        await supabaseAdmin
          .from('tenant_subscriptions')
          .update({
            toss_billing_key: null,
            status: 'cancelled',
          })
          .eq('toss_customer_key', customerKey);
        break;
      }

      default:
        // 미지원 이벤트는 200 즉시 반환 (Toss는 실패 시 재시도)
        break;
    }
  } catch (err) {
    console.error('[toss-webhook] 처리 오류:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: '처리 실패' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
