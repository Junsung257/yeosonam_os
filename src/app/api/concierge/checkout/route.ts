import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

/**
 * POST /api/concierge/checkout
 *
 * Disabled for public launch until this flow is backed by a verified payment
 * confirmation. Concierge may collect consultation/share intent, but it must
 * not mark a transaction as paid, book provider inventory, issue vouchers, or
 * deduct fixed inventory from a customer-submitted request.
 */
export async function POST(_request: NextRequest) {
  return apiResponse(
    {
      code: 'CONCIERGE_CHECKOUT_DISABLED',
      error: '결제 기능은 아직 준비 중입니다. 상담 요청으로 진행해 주세요.',
    },
    {
      status: 503,
      headers: { 'Cache-Control': 'private, no-store' },
    },
  );
}
