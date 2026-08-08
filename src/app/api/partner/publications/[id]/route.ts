import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { authAffiliate } from '@/lib/affiliate/auth-service';
import { isAllowedPartnerWriteOrigin } from '@/lib/affiliate/write-origin';
import { buildPublicUrl } from '@/lib/public-app-origin';
import { supabaseAdmin } from '@/lib/supabase';
import { isValidUuid } from '@/lib/supabase-filter-safe';

const PARTNER_STATUSES = new Set(['DRAFT', 'TESTED', 'PUBLISHED', 'PAUSED', 'RETIRED']);

function commandKey(request: NextRequest): string | null {
  const key = request.headers.get('idempotency-key')?.trim() || '';
  return /^[A-Za-z0-9:_-]{8,100}$/.test(key) ? key : null;
}

function safePublishedUrl(value: unknown): string | null | 'INVALID' {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > 2_000) return 'INVALID';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return 'INVALID';
    return url.toString();
  } catch {
    return 'INVALID';
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!isAllowedPartnerWriteOrigin(request)) {
    return apiResponse({ error: 'ORIGIN_REJECTED' }, { status: 403 });
  }
  const auth = await authAffiliate(request);
  if (!auth.ok) return apiResponse({ error: auth.error, code: auth.code }, { status: auth.status });
  const { id } = await context.params;
  if (!isValidUuid(id)) return apiResponse({ error: 'INVALID_PUBLICATION_ID' }, { status: 400 });

  const idempotencyKey = commandKey(request);
  if (!idempotencyKey) return apiResponse({ error: 'IDEMPOTENCY_KEY_REQUIRED' }, { status: 400 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const status = typeof body.status === 'string' ? body.status.toUpperCase() : '';
  const publishedUrl = safePublishedUrl(body.published_url);
  if (!PARTNER_STATUSES.has(status) || publishedUrl === 'INVALID') {
    return apiResponse({ error: 'INVALID_PUBLICATION_UPDATE' }, { status: 400 });
  }

  const requestHash = crypto
    .createHash('sha256')
    .update(JSON.stringify({ id, status, published_url: publishedUrl }))
    .digest('hex');
  const { data, error } = await supabaseAdmin.rpc('update_affiliate_publication_v2', {
    p_affiliate_id: String(auth.affiliate.id),
    p_publication_id: id,
    p_idempotency_key: idempotencyKey,
    p_request_hash: requestHash,
    p_status: status,
    p_published_url: publishedUrl,
  });
  if (error) {
    const message = String((error as { message?: string }).message || '');
    const notFound = message.includes('PUBLICATION_NOT_FOUND');
    const conflict = /IDEMPOTENCY_KEY_REUSED|INVALID_PUBLICATION_TRANSITION|PUBLISHED_URL_REQUIRED/.test(message);
    return apiResponse({
      error: notFound ? 'PUBLICATION_NOT_FOUND' : conflict ? 'PUBLICATION_UPDATE_CONFLICT' : 'PUBLICATION_UPDATE_FAILED',
    }, { status: notFound ? 404 : conflict ? 409 : 500 });
  }

  const publication = Array.isArray(data) ? data[0] : data;
  return apiResponse({
    publication,
    short_url: buildPublicUrl(`/go/${id}`),
  });
}
