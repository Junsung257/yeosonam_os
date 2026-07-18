import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { isAdminRequest } from '@/lib/admin-guard';
import { verifySupabaseAccessToken } from '@/lib/supabase-jwt-verify';
import { safeEqualString } from '@/lib/timing-safe';

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
 * JWT app_metadata tenant binding. user_metadata is intentionally ignored
 * because a user can edit it and must not be allowed to choose a tenant.
 */
export async function resolveRfqActor(request: NextRequest): Promise<RfqRequestActor | null> {
  if (await isAdminRequest(request)) return { kind: 'admin' };

  const token = request.cookies.get('sb-access-token')?.value;
  if (!token) return null;

  const verified = await verifySupabaseAccessToken(token);
  if (!verified.ok) return null;

  const payload = verified.payload as Record<string, unknown>;
  const tenantId = trustedTenantId(payload);
  if (!tenantId) return null;

  return {
    kind: 'tenant',
    tenantId,
    userId: typeof payload.sub === 'string' && payload.sub ? payload.sub : undefined,
  };
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
