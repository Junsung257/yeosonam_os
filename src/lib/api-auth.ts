import { NextRequest, NextResponse } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { getSecret } from '@/lib/secret-registry';
import { safeEqualString } from '@/lib/timing-safe';

export function isValidAdminApiToken(request: NextRequest): boolean {
  const token = getSecret('ADMIN_API_TOKEN');
  if (!token) return false;
  return safeEqualString(request.headers.get('x-admin-token'), token);
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
