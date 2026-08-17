import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRequest } from '@/lib/admin-guard';

export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;

  const params = await props.params;
  const { id } = params;

  if (!id) {
    return NextResponse.json({ error: 'id 파라미터가 필요합니다.' }, { status: 400 });
  }

  return NextResponse.json({
    ok: false,
    code: 'MUTABLE_COPY_REGENERATION_RETIRED',
    error: '고객 문구는 사실 revision과 함께 자동 생성·검증·proof 됩니다. 기존 공개 row를 직접 변경할 수 없습니다.',
    packageId: id,
    next: '/api/admin/product-registration/products/{catalogProductId}/corrections',
  }, { status: 410, headers: { 'Cache-Control': 'private, no-store' } });
}
