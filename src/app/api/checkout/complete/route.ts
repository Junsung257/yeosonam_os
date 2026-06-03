import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { signGuidebookToken } from '@/lib/guidebook-token';
import { sendGuidebookReadyAlimtalk } from '@/lib/kakao';
import { earnMileage } from '@/lib/mileage-service';
import { getSecret } from '@/lib/secret-registry';
import { isSupabaseConfigured } from '@/lib/supabase';

interface CheckoutCompleteBody {
  session_id: string;
  booking_id: string;
  user_id?: string;
  final_sales_price: number;
  base_cost: number;
  customer_phone?: string;
  raw_voucher_data?: Record<string, unknown>;
}

/**
 * POST /api/checkout/complete
 *
 * Handles post-payment tracking, mileage, voucher generation, and guidebook notification.
 * Cost fields are used server-side only and are not returned to the client.
 */
export async function POST(request: NextRequest) {
  let body: CheckoutCompleteBody;

  try {
    body = await request.json() as CheckoutCompleteBody;
  } catch {
    return apiResponse({ error: 'invalid json' }, { status: 400 });
  }

  const { session_id, booking_id, user_id, final_sales_price, base_cost } = body;

  if (!session_id || !booking_id || !final_sales_price || base_cost === undefined) {
    return apiResponse(
      { error: 'session_id, booking_id, final_sales_price, base_cost are required' },
      { status: 400 },
    );
  }

  let netProfit = 0;
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
      netProfit = trackData.net_profit ?? (final_sales_price - base_cost);
      attributedSource = trackData.attributed_source ?? 'organic';
    } else {
      netProfit = final_sales_price - base_cost;
    }
  } catch (error) {
    console.warn('[checkout/complete] tracking failed:', sanitizeDbError(error));
    netProfit = final_sales_price - base_cost;
  }

  let mileageResult: { earned: number; transaction_id: string } | null = null;

  if (user_id && netProfit > 0) {
    try {
      mileageResult = await earnMileage({
        userId: user_id,
        bookingId: booking_id,
        netProfit,
        sellingPrice: final_sales_price,
      });
    } catch (error) {
      console.error('[checkout/complete] mileage earn failed:', sanitizeDbError(error));
    }
  }

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
            total_cost: base_cost,
          },
          customer_id: user_id,
          customer_phone: body.customer_phone,
        }),
      });
      if (voucherRes.ok) {
        const voucherData = await voucherRes.json();
        voucherId = voucherData.voucher?.id ?? null;
      }
    } catch (error) {
      console.error('[checkout/complete] voucher creation failed:', sanitizeDbError(error));
    }
  }

  const guideToken = signGuidebookToken({
    bookingId: booking_id,
    voucherId,
    sessionId: session_id,
  });
  guidebookUrl = `${request.nextUrl.origin}/m/guide/${guideToken}`;

  if (body.customer_phone && body.raw_voucher_data) {
    void sendGuidebookReadyAlimtalk({
      phone: body.customer_phone,
      name: String(body.raw_voucher_data.customer_name ?? '고객'),
      productTitle: String(body.raw_voucher_data.product_title ?? body.raw_voucher_data.destination ?? '여행 상품'),
      departureDate: String(body.raw_voucher_data.departure_date ?? ''),
      guidebookUrl,
    }).catch((error) => {
      console.warn('[checkout/complete] guidebook alimtalk failed:', sanitizeDbError(error));
    });
  }

  if (attributedSource === 'naver') {
    const naverAnalyticsId = getSecret('NEXT_PUBLIC_NAVER_ANALYTICS_ID');
    if (naverAnalyticsId) {
      const naverConvUrl = `https://wcs.naver.net/wcsc.con?wo=${naverAnalyticsId}&co=${final_sales_price}&rc=100&gr=booking`;
      fetch(naverConvUrl, { signal: AbortSignal.timeout(5000) })
        .then(() => console.log('[checkout/complete] Naver conversion tracked'))
        .catch((error) => console.warn('[checkout/complete] Naver conversion failed:', sanitizeDbError(error)));
    }
  }

  return apiResponse({
    ok: true,
    booking_id,
    attributed_source: attributedSource,
    purchase_event: {
      value: final_sales_price,
      booking_id,
    },
    mileage: mileageResult
      ? { earned: mileageResult.earned, transaction_id: mileageResult.transaction_id }
      : null,
    voucher_id: voucherId,
    guidebook_url: guidebookUrl,
  });
}
