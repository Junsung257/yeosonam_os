import { NextRequest, NextResponse } from 'next/server';
import { getSecret } from '@/lib/secret-registry';

export function isValidAdminApiToken(request: NextRequest): boolean {
  const token = getSecret('ADMIN_API_TOKEN');
  if (!token) return false;
  return request.headers.get('x-admin-token') === token;
}

export function requireAdminApiToken(request: NextRequest): NextResponse | null {
  if (isValidAdminApiToken(request)) return null;
  return NextResponse.json({ code: 'FORBIDDEN', error: '관리자 권한이 필요합니다.' }, { status: 403 });
}

