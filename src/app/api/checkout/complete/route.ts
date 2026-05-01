import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase';
import { earnMileage } from '@/lib/mileage-service';
import { signGuidebookToken } from '@/lib/guidebook-token';

/**
 * POST /api/checkout/complete
 *
 * 결제 완료 후 프론트엔드에서 호출하는 통합 처리 엔드포인트.
 *
 * 처리 순서:
 *   1. ConversionLog 기록 (/api/tracking — session + UTM 포함)
 *   2. 마일리지 자동 적립 (net_profit × 5%)
 *   3. Voucher 생성 트리거 (/api/voucher)
 *
 * 프론트엔드 호출 예시 (결제 완료 페이지에서):
 * ```ts
 * await fetch('/api/checkout/complete', {
 *   method: 'POST',
 *   body: JSON.stringify({
 *     session_id,           // tracker.getSessionId()
 *     booking_id,
 *     user_id,
 *     final_sales_price,    // 판매가 (고객 결제액)
 *     base_cost,            // 원가 (서버 계산값 — 클라이언트 미노출)
 *     raw_voucher_data,     // VoucherGenerator용 원시 데이터 (선택)
 *     customer_phone,       // 알림톡 발송용 (선택)
 *   })
 * });
 * ```
 *
 * ※ base_cost(원가)는 서버에서만 처리하며 클라이언트 응답에 절대 포함되지 않는다.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: {
    session_id: string;
    booking_id: string;
    user_id?: string;
    final_sales_price: number;
    base_cost: number;           // 원가 — 서버 전용, 응답에 미포함
    customer_phone?: string;
    raw_voucher_data?: Record<string, unknown>;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const { session_id, booking_id, user_id, final_sales_price, base_cost } = body;

  if (!session_id || !booking_id || !final_sales_price || base_cost === undefined) {
    return NextResponse.json(
      { error: 'session_id, booking_id, final_sales_price, base_cost 는 필수입니다' },
      { status: 400 }
    );
  }

  // ── STEP 1. ConversionLog 기록 (광고 UTM + 순수익 자동 계산) ──

  let netProfit = 0;
  let allocatedAdSpend = 0;
  let attributedSource = 'organic';

  try {
    const trackRes = await fetch(`${request.nextUrl.origin}/api/tracking`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'conversion',
        session_id,
        user_id,
        booking_id,
        final_sales_price,
        base_cost,
      }),
    });

    if (trackRes.ok) {
      const trackData = await trackRes.json();
      // API가 계산한 net_profit 수신
      netProfit        = trackData.net_profit ?? (final_sales_price - base_cost);
      allocatedAdSpend = final_sales_price - base_cost - netProfit;
      attributedSource = trackData.attributed_source ?? 'organic';
    } else {
      // fallback: 광고비 차감 없이 단순 계산
      netProfit = final_sales_price - base_cost;
    }
  } catch {
    netProfit = final_sales_price - base_cost;
  }

  // ── STEP 2. 마일리지 자동 적립 (net_profit의 5%) ──────────────

  let mileageResult: { earned: number; transaction_id: string } | null = null;

  if (user_id && netProfit > 0) {
    try {
      mileageResult = await earnMileage({
        userId: user_id,
        bookingId: booking_id,
        netProfit,
        sellingPrice: final_sales_price,
      });
    } catch (err) {
      console.error('[checkout/complete] 마일리지 적립 실패', err);
    }
  }

  // ── STEP 3. Voucher 생성 (원시 데이터 제공 시) ────────────────

  let voucherId: string | null = null;
  let guidebookUrl: string | null = null;

  if (body.raw_voucher_data && isSupabaseConfigured) {
    try {
      const voucherRes = await fetch(`${request.nextUrl.origin}/api/voucher`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          raw: {
            ...body.raw_voucher_data,
            booking_id,
            total_selling_price: final_sales_price,
            // total_cost(원가)는 Voucher 내부 계산용으로만 전달 — PDF에 미포함
            total_cost: base_cost,
          },
          customer_id: user_id,
          customer_phone: body.customer_phone,
        }),
      });
      if (voucherRes.ok) {
        const vData = await voucherRes.json();
        voucherId = vData.voucher?.id ?? null;
      }
    } catch (err) {
      console.error('[checkout/complete] Voucher 생성 실패', err);
    }
  }

  const guideToken = signGuidebookToken({
    bookingId: booking_id,
    voucherId,
    sessionId: session_id,
  });
  guidebookUrl = `${request.nextUrl.origin}/m/guide/${guideToken}`;

  // ── 응답 — 원가(base_cost) 절대 미포함 ───────────────────────

  return NextResponse.json({
    ok: true,
    booking_id,
    attributed_source: attributedSource,
    mileage: mileageResult
      ? { earned: mileageResult.earned, transaction_id: mileageResult.transaction_id }
      : null,
    voucher_id: voucherId,
    guidebook_url: guidebookUrl,
    // net_profit, base_cost, allocated_ad_spend → 클라이언트 응답 미포함 (서버 내부 전용)
  });
}
