import type { NextRequest } from 'next/server';

import {
  resolveAdminActorId,
  resolveAdminActorLabel,
  withAdminGuard,
} from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import {
  loadAdminPackagePublicationTruth,
  parseProductRegistrationTenantId,
  requestProductRegistrationPublication,
} from '@/lib/product-registration-authority';
import { getSupabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ catalogProductId: string }> | { catalogProductId: string };
};

type PublicationPointerRow = {
  channel: string;
  pointer_version: number | string | null;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function string(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function platformTenantId(): string | null {
  return parseProductRegistrationTenantId(
    process.env.PRODUCT_REGISTRATION_PLATFORM_TENANT_ID,
  );
}

async function catalogProductId(context?: RouteContext): Promise<string> {
  if (!context?.params) return '';
  const resolved = typeof (context.params as Promise<unknown>).then === 'function'
    ? await context.params
    : context.params;
  const params = resolved as { catalogProductId: string };
  return string(params.catalogProductId);
}

const postHandler = async (request: NextRequest, context?: RouteContext) => {
  const supabase = getSupabaseAdmin();
  const tenantId = platformTenantId();
  const productId = await catalogProductId(context);
  if (!supabase || !tenantId) {
    return apiResponse(
      { success: false, code: 'REGISTRATION_AUTHORITY_UNAVAILABLE' },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
  if (!productId) {
    return apiResponse(
      { success: false, code: 'CATALOG_PRODUCT_ID_REQUIRED' },
      { status: 400, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  const body = object(await request.json().catch(() => null));
  const expectedRevisionId = string(body.expectedRevisionId);
  const expectedRevisionNo = Number(body.expectedRevisionNo);
  const expectedSourceHash = string(body.expectedSourceHash);
  const requestReason = string(body.requestReason);
  if (!expectedRevisionId || !Number.isInteger(expectedRevisionNo)
    || expectedRevisionNo < 1 || !/^[0-9a-f]{64}$/u.test(expectedSourceHash)
    || requestReason.length < 4 || requestReason.length > 500) {
    return apiResponse(
      { success: false, code: 'EXACT_PUBLICATION_REQUEST_REQUIRED' },
      { status: 400, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  try {
    const [truth] = await loadAdminPackagePublicationTruth({
      supabase,
      tenantId,
      catalogProductId: productId,
      limit: 1,
    });
    if (!truth) {
      return apiResponse(
        { success: false, code: 'CATALOG_PRODUCT_NOT_FOUND' },
        { status: 404, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
    if (!truth.packageId || truth.latestRevisionId !== expectedRevisionId
      || truth.latestRevisionNo !== expectedRevisionNo
      || truth.sourceHash !== expectedSourceHash) {
      return apiResponse(
        {
          success: false,
          code: 'REVISION_CHANGED_REVALIDATION_REQUIRED',
          nextAction: '상품 내용이 변경되었습니다. 새로고침 후 다시 검수하세요.',
        },
        { status: 409, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }

    const { data: pointerData, error: pointerError } = await supabase
      .from('product_registration_v5_publication_pointers')
      .select('channel,pointer_version')
      .eq('tenant_id', tenantId)
      .eq('catalog_product_id', productId)
      .eq('package_id', truth.packageId)
      .eq('locale', 'ko-KR')
      .in('channel', ['customer', 'b2b', 'partner']);
    if (pointerError) throw new Error(pointerError.message);

    const expectedPointerVersions = { customer: 0, b2b: 0, partner: 0 };
    for (const row of (pointerData ?? []) as PublicationPointerRow[]) {
      if (row.channel !== 'customer' && row.channel !== 'b2b' && row.channel !== 'partner') continue;
      const version = Number(row.pointer_version);
      if (!Number.isInteger(version) || version < 0) {
        throw new Error(`REGISTRATION_PUBLICATION_POINTER_VERSION_INVALID:${row.channel}`);
      }
      expectedPointerVersions[row.channel] = version;
    }

    const actor = await resolveAdminActorLabel(request);
    const actorId = await resolveAdminActorId(request);
    const result = await requestProductRegistrationPublication({
      supabase,
      request: {
        tenantId,
        catalogProductId: productId,
        packageId: truth.packageId,
        expectedRevisionId,
        expectedRevisionNo,
        expectedSourceHash,
        expectedPointerVersions,
        requestedBy: actorId,
        requestedActor: actor,
        requestReason,
        idempotencyKey: `publish:${productId}:${expectedRevisionId}`,
      },
    });

    return apiResponse(
      { success: true, data: result },
      { status: result.replayed ? 200 : 202, headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : 'REGISTRATION_PUBLICATION_REQUEST_FAILED';
    const conflict = code.includes('REVISION_CHANGED')
      || code.includes('MISMATCH')
      || code.includes('CONFLICT');
    console.error('[Product Registration] publication request failed', { productId, code });
    return apiResponse(
      { success: false, code },
      { status: conflict ? 409 : 502, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
};

export const POST = withAdminGuard(postHandler);
