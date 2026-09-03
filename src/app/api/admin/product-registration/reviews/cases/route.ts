import type { NextRequest } from 'next/server';

import { ApiErrors, apiResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { assertReviewPacket, type ReviewPacketV1 } from '@/lib/product-registration-v6/human-review';
import { callProductReviewRpc } from '@/lib/product-registration-v6/human-review-rpc';
import { getSupabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const postHandler = async (request: NextRequest) => {
  const supabase = getSupabaseAdmin();
  if (!supabase) return ApiErrors.unavailable('검수 저장소가 연결되지 않았습니다.');
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return ApiErrors.badRequest('검수 케이스 형식이 올바르지 않습니다.');
  }
  try {
    const packet = body.packet;
    if (!packet || typeof packet !== 'object' || Array.isArray(packet)) {
      return ApiErrors.badRequest('검수 패킷이 필요합니다.');
    }
    assertReviewPacket(packet as ReviewPacketV1);
    const data = await callProductReviewRpc<unknown>(supabase, 'create_product_registration_review_case', {
      p_payload: body,
    });
    return apiResponse({ ok: true, data }, {
      status: 202,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    console.error('[product-review-case-create]', error);
    const message = sanitizeDbError(error, '검수 케이스를 만들지 못했습니다.');
    if (/LINEAGE|PAYLOAD|IDEMPOTENCY/iu.test(message)) return ApiErrors.conflict(message);
    return ApiErrors.internalError(message);
  }
};

export const POST = withAdminGuard(postHandler);
