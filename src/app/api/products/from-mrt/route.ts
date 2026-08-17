import { NextRequest, NextResponse } from 'next/server';

import { requireAdminRequest } from '@/lib/admin-guard';

/**
 * MRT rows are external observations, not source-backed sellable products.
 * Direct mutable registration is retired until the provider adapter emits an
 * evidence-bound immutable revision through the Registration Kernel.
 */
export async function POST(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;

  return NextResponse.json({
    error: 'MRT 직접 등록은 통합 상품등록 엔진 연결 전까지 중단되었습니다.',
    code: 'PRODUCT_REGISTRATION_KERNEL_ADAPTER_REQUIRED',
    next: '/admin/upload',
  }, { status: 410 });
}
