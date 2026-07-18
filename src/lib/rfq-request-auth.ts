import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { isAdminRequest } from '@/lib/admin-guard';
import { verifySupabaseAccessToken } from '@/lib/supabase-jwt-verify';
import { safeEqualString } from '@/lib/timing-safe';
import { isUuid } from '@/lib/uuid';
import { getActiveRfqTenantMembership } from '@/lib/db/rfq-server';

export type RfqRequestActor =
  | { kind: 'admin' }
  | { kind: 'tenant'; tenantId: string; userId?: string };

function trustedTenantId(payload: Record<string, unknown>): string | null {
  const appMetadata = payload.app_metadata;
  if (!appMetadata || typeof appMetadata !== 'object') return null;

  const tenantId = (appMetadata as Record<string, unknown>).tenant_id;
  return typeof tenantId === 'string' && tenantId.trim() ? tenantId.trim() : null;
}

/**
 * Resolve an RFQ actor only from an administrator check or a verified Supabase
 * JWT subject plus an active tenant_memberships row joined to an active tenant.
 * app_metadata is only an optional consistency hint and never grants access.
 */
export async function resolveRfqActor(request: NextRequest): Promise<RfqRequestActor | null> {
  if (await isAdminRequest(request)) return { kind: 'admin' };

  const token = request.cookies.get('sb-access-token')?.value;
  if (!token) return null;

  const verified = await verifySupabaseAccessToken(token);
  if (!verified.ok) return null;

  const payload = verified.payload as Record<string, unknown>;
  const userId = typeof payload.sub === 'string' ? payload.sub : '';
  if (!isUuid(userId)) return null;

  try {
    const metadataTenantId = trustedTenantId(payload);
    const membership = await getActiveRfqTenantMembership(userId, metadataTenantId);
    if (!membership) return null;
    if (metadataTenantId && membership.tenantId !== metadataTenantId) return null;
    return { kind: 'tenant', tenantId: membership.tenantId, userId };
  } catch (error) {
    console.error('[rfq-request-auth] membership lookup failed', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    return null;
  }
}

export function presentedRfqShareToken(request: NextRequest, explicitToken?: unknown): string | null {
  if (typeof explicitToken === 'string' && explicitToken.trim()) return explicitToken.trim();

  const headerToken = request.headers.get('x-rfq-share-token');
  if (headerToken?.trim()) return headerToken.trim();

  const queryToken = request.nextUrl.searchParams.get('share_token');
  return queryToken?.trim() || null;
}

export function hasValidRfqShareToken(
  request: NextRequest,
  storedToken: unknown,
  explicitToken?: unknown,
): boolean {
  if (typeof storedToken !== 'string' || !storedToken.trim()) return false;
  const presented = presentedRfqShareToken(request, explicitToken);
  return Boolean(presented && safeEqualString(presented, storedToken.trim()));
}

export function rfqUnauthorizedResponse() {
  const response = apiResponse(
    { code: 'UNAUTHORIZED', error: '인증이 필요합니다.' },
    { status: 401 },
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export function rfqForbiddenResponse() {
  const response = apiResponse(
    { code: 'FORBIDDEN', error: '이 RFQ에 접근할 권한이 없습니다.' },
    { status: 403 },
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
