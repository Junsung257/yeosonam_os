import { type NextRequest } from 'next/server';

import { apiResponse } from '@/lib/api-response';
import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';

export const maxDuration = 30;

/**
 * Dynamic pricing may not mutate a published package row. It stays fail-closed
 * until the pricing workflow can create a new evidence-bearing price revision,
 * snapshot, proof, and CAS pointer transition.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();
  return apiResponse({
    skipped: true,
    code: 'DYNAMIC_PRICING_REVISION_REQUIRED',
    reason: '가격 변경은 immutable price revision과 새 모바일 proof가 필요합니다.',
  });
}
