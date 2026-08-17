import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRequest } from '@/lib/admin-guard';
import { getTenantProducts, isSupabaseConfigured } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;

  const tenantId = request.nextUrl.searchParams.get('tenant_id');
  if (!tenantId) return NextResponse.json({ error: 'tenant_id 필수' }, { status: 400 });
  if (!isSupabaseConfigured) return NextResponse.json({ products: [] });
  const products = await getTenantProducts(tenantId);
  return NextResponse.json({ products });
}

export async function POST(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;

  return NextResponse.json({
    error: '테넌트 상품도 원문 업로드를 통한 통합 상품등록 엔진에서만 생성할 수 있습니다.',
    code: 'TENANT_PRODUCT_DIRECT_WRITE_RETIRED',
    next: '/admin/upload',
  }, { status: 410 });
}

export async function PUT(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;

  return NextResponse.json({
    error: '상품 사실 수정은 correction revision으로만 처리할 수 있습니다.',
    code: 'TENANT_PRODUCT_DIRECT_WRITE_RETIRED',
    next: '/api/admin/product-registration/products/{catalogProductId}/corrections',
  }, { status: 410 });
}
