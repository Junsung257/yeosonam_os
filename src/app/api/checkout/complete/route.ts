import { apiResponse } from '@/lib/api-response';

/**
 * POST /api/checkout/complete
 *
 * Temporarily disabled for the customer launch. The legacy endpoint accepted
 * caller-supplied booking, user, price, cost, phone, and voucher data without
 * binding them to a verified payment record. Restore this route only after it
 * derives every financial and ownership field from server-side payment data.
 */
export async function POST() {
  return apiResponse(
    {
      code: 'CHECKOUT_COMPLETE_DISABLED',
      error: 'checkout completion is temporarily unavailable',
    },
    {
      status: 503,
      headers: { 'Cache-Control': 'private, no-store' },
    },
  );
}
