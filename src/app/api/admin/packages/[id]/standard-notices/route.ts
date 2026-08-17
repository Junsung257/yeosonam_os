import { NextResponse, type NextRequest } from 'next/server';

import { withAdminGuard } from '@/lib/admin-guard';

type RouteContext = { params?: Promise<{ id: string }> };

export const PATCH = withAdminGuard(async (_request: NextRequest, context?: RouteContext) => {
  const params = await context?.params;
  if (!params?.id) return NextResponse.json({ error: 'missing_id' }, { status: 400 });
  return NextResponse.json({
    ok: false,
    code: 'MUTABLE_STANDARD_NOTICE_UPDATE_RETIRED',
    error: '포함·불포함·안내문은 상품 사실입니다. 변경 원문을 첨부한 correction revision으로만 수정할 수 있습니다.',
    packageId: params.id,
    next: '/api/admin/product-registration/products/{catalogProductId}/corrections',
  }, { status: 410, headers: { 'Cache-Control': 'private, no-store' } });
});
