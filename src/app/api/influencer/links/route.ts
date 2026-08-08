import crypto from 'node:crypto';
import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { authInfluencer } from '@/lib/affiliate/jwt-or-pin-auth';
import { isAllowedPartnerWriteOrigin } from '@/lib/affiliate/write-origin';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isCustomerPubliclyOpenable } from '@/lib/package-public-eligibility';
import { buildPublicUrl } from '@/lib/public-app-origin';
import { supabaseAdmin } from '@/lib/supabase';
import { isValidUuid } from '@/lib/supabase-filter-safe';
import { CUSTOMER_VISIBLE_STATUSES } from '@/lib/visibility-status';

export async function GET(request: NextRequest) {
  const referralCode = request.nextUrl.searchParams.get('code') || '';
  if (!referralCode) return apiResponse({ error: 'REFERRAL_CODE_REQUIRED' }, { status: 400 });
  const auth = await authInfluencer(request, referralCode);
  if (!auth.ok) return apiResponse({ error: auth.error }, { status: auth.status });

  const { data, error } = await supabaseAdmin
    .from('affiliate_publications')
    .select('id, product_id, channel_type, placement_name, sub_id, status, published_url, click_count, unique_visitor_count, conversion_count, health_status, created_at, updated_at')
    .eq('affiliate_id', String(auth.affiliate.id))
    .order('created_at', { ascending: false });
  if (error) return apiResponse({ error: sanitizeDbError(error), code: 'LINKS_UNAVAILABLE' }, { status: 503 });
  return apiResponse({
    links: (data || []).map(publication => ({
      ...publication,
      package_id: publication.product_id,
      short_url: buildPublicUrl(`/go/${publication.id}`),
      publication_id: publication.id,
    })),
    canonical_entity: 'affiliate_publications',
  });
}

export async function POST(request: NextRequest) {
  if (!isAllowedPartnerWriteOrigin(request)) {
    return apiResponse({ error: 'ORIGIN_REJECTED' }, { status: 403 });
  }
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const referralCode = typeof body.referral_code === 'string' ? body.referral_code : '';
  const productId = typeof body.package_id === 'string' ? body.package_id : '';
  if (!referralCode || !isValidUuid(productId)) {
    return apiResponse({ error: 'INVALID_LINK_INPUT' }, { status: 400 });
  }
  const auth = await authInfluencer(request, referralCode);
  if (!auth.ok) return apiResponse({ error: auth.error }, { status: auth.status });

  const normalizedSub = typeof body.sub_id === 'string'
    ? body.sub_id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40)
    : '';
  const { data: product, error: productError } = await supabaseAdmin
    .from('travel_packages')
    .select('id, title, status, publication_state, package_revision, audit_status, audit_report, updated_at, optional_tours, itinerary_data')
    .eq('id', productId)
    .in('status', [...CUSTOMER_VISIBLE_STATUSES])
    .in('publication_state', ['approved', 'published'])
    .maybeSingle();
  if (productError) return apiResponse({ error: 'PRODUCT_ELIGIBILITY_UNAVAILABLE' }, { status: 503 });
  if (!product || !isCustomerPubliclyOpenable(product as Record<string, unknown>)) {
    return apiResponse({ error: 'PRODUCT_NOT_PUBLISHABLE' }, { status: 409 });
  }

  const commandKey = request.headers.get('idempotency-key')?.trim()
    || `legacy-link:${crypto.createHash('sha256').update(`${auth.affiliate.id}:${productId}:${normalizedSub}`).digest('hex')}`;
  const row = {
    affiliate_id: String(auth.affiliate.id),
    product_id: productId,
    channel_type: 'OTHER',
    placement_name: normalizedSub ? `기존 링크 · ${normalizedSub}` : '기존 링크',
    sub_id: normalizedSub || null,
    destination_url: buildPublicUrl(`/packages/${productId}`),
    disclosure_version: 'affiliate-disclosure-v1',
    status: 'DRAFT',
    idempotency_key: commandKey.slice(0, 100),
  };
  const { data, error } = await supabaseAdmin
    .from('affiliate_publications')
    .insert(row as never)
    .select('id, product_id, placement_name, sub_id, status, created_at')
    .single();
  if (error) {
    const { data: existing } = await supabaseAdmin
      .from('affiliate_publications')
      .select('id, product_id, placement_name, sub_id, status, created_at')
      .eq('affiliate_id', String(auth.affiliate.id))
      .eq('idempotency_key', commandKey.slice(0, 100))
      .maybeSingle();
    if (existing) {
      return apiResponse({
        link: { ...existing, package_id: existing.product_id, publication_id: existing.id },
        short_url: buildPublicUrl(`/go/${existing.id}`),
        idempotent_replay: true,
      });
    }
    return apiResponse({ error: sanitizeDbError(error), code: 'LINK_CREATE_FAILED' }, { status: 500 });
  }
  return apiResponse({
    link: { ...data, package_id: data.product_id, publication_id: data.id },
    short_url: buildPublicUrl(`/go/${data.id}`),
    idempotent_replay: false,
  }, { status: 201 });
}
