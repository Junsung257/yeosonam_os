import type { NextRequest } from 'next/server';

import {
  resolveAdminActorId,
  resolveAdminActorLabel,
  withAdminGuard,
} from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import { PRODUCT_REGISTRATION_V6_POLICY_VERSION } from '@/lib/product-registration-v6/types';
import { getSupabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function string(body: Record<string, unknown>, key: string): string {
  return typeof body[key] === 'string' ? body[key].trim() : '';
}

type AuthorityRpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

const postHandler = async (request: NextRequest) => {
  const supabase = getSupabaseAdmin();
  if (!supabase) return apiResponse({ success: false, code: 'REGISTRATION_AUTHORITY_UNAVAILABLE' }, { status: 503 });
  const rpc = (supabase as unknown as AuthorityRpcClient).rpc.bind(supabase);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return apiResponse({ success: false, code: 'REQUEST_BODY_REQUIRED' }, { status: 400 });

  if (body.action === 'authorize') {
    const required = [
      'tenantId', 'productId', 'packageId', 'revisionId', 'revisionHash',
      'snapshotId', 'snapshotHash', 'proofId', 'proofHash', 'approvalReason',
    ] as const;
    if (required.some(key => !string(body, key)) || !Number.isInteger(Number(body.expectedPointerVersion))) {
      return apiResponse({ success: false, code: 'RELEASE_AUTHORIZATION_LINEAGE_REQUIRED' }, { status: 400 });
    }
    const actor = await resolveAdminActorLabel(request);
    const actorId = await resolveAdminActorId(request);
    const expiresAt = typeof body.expiresAt === 'string'
      ? body.expiresAt
      : new Date(Date.now() + 30 * 60_000).toISOString();
    const { data, error } = await rpc('issue_product_registration_release_authorization', {
      p_payload: {
        tenant_id: string(body, 'tenantId'),
        product_id: string(body, 'productId'),
        package_id: string(body, 'packageId'),
        revision_id: string(body, 'revisionId'),
        revision_hash: string(body, 'revisionHash'),
        snapshot_id: string(body, 'snapshotId'),
        snapshot_hash: string(body, 'snapshotHash'),
        proof_id: string(body, 'proofId'),
        proof_hash: string(body, 'proofHash'),
        expected_pointer_version: Number(body.expectedPointerVersion),
        policy_version: PRODUCT_REGISTRATION_V6_POLICY_VERSION,
        approved_by: actorId,
        approved_actor: actor,
        approval_reason: string(body, 'approvalReason'),
        expires_at: expiresAt,
        channel: 'customer',
        locale: 'ko-KR',
      },
    });
    if (error) return apiResponse({ success: false, code: error.message }, { status: 409 });
    return apiResponse({ success: true, authorization: data }, { status: 201 });
  }

  if (body.action === 'publish') {
    const required = [
      'authorizationId', 'tenantId', 'productId', 'packageId', 'revisionId',
      'snapshotId', 'snapshotHash', 'proofId', 'operationKey',
    ] as const;
    if (required.some(key => !string(body, key)) || !Number.isInteger(Number(body.expectedPointerVersion))) {
      return apiResponse({ success: false, code: 'EXACT_RELEASE_PAYLOAD_REQUIRED' }, { status: 400 });
    }
    const { data, error } = await rpc('publish_product_registration_snapshot_atomic', {
      p_payload: {
        tenant_id: string(body, 'tenantId'),
        catalog_product_id: string(body, 'productId'),
        package_id: string(body, 'packageId'),
        revision_id: string(body, 'revisionId'),
        snapshot_id: string(body, 'snapshotId'),
        snapshot_hash: string(body, 'snapshotHash'),
        proof_run_id: string(body, 'proofId'),
        expected_pointer_version: Number(body.expectedPointerVersion),
        operation_key: string(body, 'operationKey'),
        policy_version: PRODUCT_REGISTRATION_V6_POLICY_VERSION,
        outcome: body.outcome === 'published_degraded' ? 'published_degraded' : 'published_verified',
        release_authorization_id: string(body, 'authorizationId'),
        channel: 'customer',
        locale: 'ko-KR',
      },
    });
    if (error) return apiResponse({ success: false, code: error.message }, { status: 409 });
    return apiResponse({ success: true, publication: data });
  }

  return apiResponse({ success: false, code: 'RELEASE_ACTION_INVALID' }, { status: 400 });
};

export const POST = withAdminGuard(postHandler);
