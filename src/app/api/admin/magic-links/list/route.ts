/**
 * GET /api/admin/magic-links/list?bookingId=...&limit=20
 *
 * 발급된 매직링크 목록 (rawToken 미노출 — 발급 시 1회만 노출 후 SHA-256 hash 만 저장).
 * 검색 옵션: bookingId. 없으면 최근 발급 50개.
 */

import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { supabaseAdmin } from '@/lib/supabase';

export const GET = withAdminGuard(async (req: NextRequest) => {
  const { searchParams } = req.nextUrl;
  const bookingId = searchParams.get('bookingId');
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '20', 10) || 20, 1), 100);

  let q = supabaseAdmin
    .from('magic_action_tokens')
    .select(
      'id, action_type, booking_id, tenant_id, metadata, recipient_channel, single_use, confirm_required, confirmed_at, used_at, use_count, expires_at, revoked_at, revoked_reason, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(limit);

  if (bookingId) q = q.eq('booking_id', bookingId);

  const { data, error } = await q;
  if (error) {
    return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });
  }
  return apiResponse({ tokens: data ?? [] });
});
