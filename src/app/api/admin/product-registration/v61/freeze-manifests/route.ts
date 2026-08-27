import type { NextRequest } from 'next/server';

import { resolveAdminActorLabel, withAdminGuard } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import { parseProductRegistrationTenantId } from '@/lib/product-registration-authority/types';
import { getSupabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function tenantId(): string | null {
  return parseProductRegistrationTenantId(process.env.PRODUCT_REGISTRATION_PLATFORM_TENANT_ID);
}

type AuthorityRpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

const postHandler = async (request: NextRequest) => {
  const supabase = getSupabaseAdmin();
  const platformTenantId = tenantId();
  if (!supabase || !platformTenantId) {
    return apiResponse({ success: false, code: 'REGISTRATION_AUTHORITY_UNAVAILABLE' }, { status: 503 });
  }
  const rpc = (supabase as unknown as AuthorityRpcClient).rpc.bind(supabase);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = body?.action;
  const actor = await resolveAdminActorLabel(request);

  if (action === 'capture') {
    const expectedCount = Number(body?.expectedPointerCount);
    if (!Number.isInteger(expectedCount) || expectedCount < 0) {
      return apiResponse({ success: false, code: 'EXPECTED_POINTER_COUNT_REQUIRED' }, { status: 400 });
    }
    const { data, error } = await rpc('capture_product_registration_freeze_manifest', {
      p_payload: {
        tenant_id: platformTenantId,
        channel: 'customer',
        locale: 'ko-KR',
        query_version: 'publication-freeze-manifest-v61.1',
        captured_by: actor,
        expected_count: expectedCount,
      },
    });
    if (error) return apiResponse({ success: false, code: error.message }, { status: 409 });
    return apiResponse({ success: true, manifest: data }, { status: 201 });
  }

  if (action === 'apply') {
    const manifestId = typeof body?.manifestId === 'string' ? body.manifestId : '';
    const manifestHash = typeof body?.manifestHash === 'string' ? body.manifestHash : '';
    if (!manifestId || !/^[0-9a-f]{64}$/u.test(manifestHash)) {
      return apiResponse({ success: false, code: 'MANIFEST_ID_AND_HASH_REQUIRED' }, { status: 400 });
    }
    const { data, error } = await rpc('apply_product_registration_freeze_manifest', {
      p_manifest_id: manifestId,
      p_manifest_hash: manifestHash,
    });
    if (error) return apiResponse({ success: false, code: error.message }, { status: 409 });
    return apiResponse({ success: true, result: data });
  }

  return apiResponse({ success: false, code: 'FREEZE_MANIFEST_ACTION_INVALID' }, { status: 400 });
};

export const POST = withAdminGuard(postHandler);
