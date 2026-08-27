import type { NextRequest } from 'next/server';

import { withAdminGuard } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import {
  loadAdminPackagePublicationTruth,
  parseProductRegistrationTenantId,
} from '@/lib/product-registration-authority';
import { getSupabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function platformTenantId(): string | null {
  return parseProductRegistrationTenantId(
    process.env.PRODUCT_REGISTRATION_PLATFORM_TENANT_ID,
  );
}

function boundedInteger(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0
    ? Math.min(parsed, max)
    : fallback;
}

const getHandler = async (request: NextRequest) => {
  const supabase = getSupabaseAdmin();
  const tenantId = platformTenantId();
  if (!supabase || !tenantId) {
    return apiResponse(
      { success: false, code: 'REGISTRATION_AUTHORITY_UNAVAILABLE' },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  try {
    const rows = await loadAdminPackagePublicationTruth({
      supabase,
      tenantId,
      catalogProductId: request.nextUrl.searchParams.get('catalogProductId'),
      limit: boundedInteger(request.nextUrl.searchParams.get('limit'), 100, 200),
      offset: boundedInteger(request.nextUrl.searchParams.get('offset'), 0, 10_000),
    });
    return apiResponse(
      { success: true, data: { tenantId, rows } },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    console.error('[Product Registration] publication truth read failed', error);
    return apiResponse(
      { success: false, code: 'REGISTRATION_PUBLICATION_TRUTH_FAILED' },
      { status: 502, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
};

export const GET = withAdminGuard(getHandler);
