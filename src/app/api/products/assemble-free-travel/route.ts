import { NextRequest, NextResponse } from 'next/server';

import { requireAdminRequest } from '@/lib/admin-guard';

export const maxDuration = 30;

/**
 * Provider-composed products used to bypass source evidence and write a
 * mutable products row directly. Keep the endpoint closed until MRT inputs
 * have a first-class Registration Kernel adapter and immutable revision
 * contract. This is intentionally fail-closed, not a legacy fallback.
 */
export async function POST(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;

  return NextResponse.json({
    error: 'MRT 조립 등록은 통합 상품등록 엔진 연결 전까지 중단되었습니다.',
    code: 'PRODUCT_REGISTRATION_KERNEL_ADAPTER_REQUIRED',
    next: '/admin/upload',
  }, { status: 410 });
}
