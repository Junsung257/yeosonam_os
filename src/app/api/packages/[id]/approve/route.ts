import { NextResponse, type NextRequest } from 'next/server';

import { withAdminGuard } from '@/lib/admin-guard';

type RouteContext = { params?: Promise<{ id: string }> };

const patchHandler = async (_request: NextRequest, context?: RouteContext) => {
  const params = await context?.params;
  if (!params?.id) return NextResponse.json({ error: 'missing_id' }, { status: 400 });
  return NextResponse.json({
    ok: false,
    code: 'LEGACY_PACKAGE_APPROVAL_RETIRED',
    error: '기존 상품 row 강제 승인은 종료되었습니다. 검증된 snapshot은 proof 완료 후 CAS publication pointer로만 공개됩니다.',
    packageId: params.id,
    next: '/admin/product-registration',
  }, { status: 410, headers: { 'Cache-Control': 'private, no-store' } });
};

export const PATCH = withAdminGuard(patchHandler);
