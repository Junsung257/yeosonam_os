import { NextRequest, NextResponse } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { getSecret } from '@/lib/secret-registry';
import { safeEqualString } from '@/lib/timing-safe';

export function isValidAdminApiToken(request: NextRequest): boolean {
  const token = getSecret('ADMIN_API_TOKEN');
  if (!token) return false;
  return safeEqualString(request.headers.get('x-admin-token'), token);
}

/**
 * Internal source-ingestion authentication. This token is intentionally
 * limited to the upload route by middleware; it does not grant general admin
 * access or permission to mutate existing products.
 */
export function isValidProductRegistrationUploadToken(request: NextRequest): boolean {
  // Keep this environment read static: the function is also imported by the
  // Edge middleware, where dynamic `process.env[key]` access is not reliable
  // after bundling. The route-local Node guard still receives the same value.
  const token = process.env.PRODUCT_REGISTRATION_UPLOAD_TOKEN?.trim() || getSecret('PRODUCT_REGISTRATION_UPLOAD_TOKEN');
  if (!token) return false;
  const customHeader = request.headers.get('x-product-registration-upload-token');
  const authorization = request.headers.get('authorization');
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
  return safeEqualString(customHeader, token) || safeEqualString(bearer, token);
}

export function requireAdminApiToken(request: NextRequest): NextResponse | null {
  if (isValidAdminApiToken(request)) return null;

  const response = apiResponse(
    { code: 'FORBIDDEN', error: '관리자 권한이 필요합니다.' },
    { status: 403 },
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
