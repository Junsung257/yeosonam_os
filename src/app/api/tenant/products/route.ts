import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import {
  getTenantProducts,
  upsertTenantProduct,
  isSupabaseAdminConfigured,
} from '@/lib/supabase';
import {
  isTenantPortalAuthError,
  requireTenantPortalRequest,
} from '@/lib/tenant-portal-auth';

type ProductBody = {
  id?: string;
  tenant_id?: string;
  title?: string;
  destination?: string;
  category?: string;
  product_type?: string;
  cost_price?: number;
  price?: number;
  min_participants?: number;
  notes?: string;
};

function productPayload(body: ProductBody, tenantId: string) {
  return {
    ...(body.id ? { id: body.id } : {}),
    tenant_id: tenantId,
    title: body.title?.trim() ?? '',
    destination: body.destination,
    category: body.category,
    product_type: body.product_type,
    cost_price: Number(body.cost_price ?? 0),
    price: Number(body.price ?? 0),
    min_participants: body.min_participants,
    notes: body.notes,
  };
}

export async function GET(request: NextRequest) {
  const requestedTenantId = request.nextUrl.searchParams.get('tenant_id') ?? '';
  const authorization = await requireTenantPortalRequest(request, requestedTenantId);
  if (isTenantPortalAuthError(authorization)) return authorization;
  if (!isSupabaseAdminConfigured) {
    return apiResponse({ error: '테넌트 저장소를 사용할 수 없습니다.' }, { status: 503 });
  }

  const products = await getTenantProducts(authorization.tenantId);
  return apiResponse(
    { products },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as ProductBody;
    const authorization = await requireTenantPortalRequest(request, body.tenant_id ?? '');
    if (isTenantPortalAuthError(authorization)) return authorization;
    if (!isSupabaseAdminConfigured) {
      return apiResponse({ error: '테넌트 저장소를 사용할 수 없습니다.' }, { status: 503 });
    }
    if (!body.title?.trim()) {
      return apiResponse({ error: 'title이 필요합니다.' }, { status: 400 });
    }

    const product = await upsertTenantProduct(productPayload(body, authorization.tenantId));
    if (!product) {
      return apiResponse({ error: '상품을 저장하지 못했습니다.' }, { status: 500 });
    }
    return apiResponse({ product }, { status: 201 });
  } catch (error) {
    return apiResponse(
      { error: sanitizeDbError(error, '상품 저장에 실패했습니다.') },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json() as ProductBody;
    const authorization = await requireTenantPortalRequest(request, body.tenant_id ?? '');
    if (isTenantPortalAuthError(authorization)) return authorization;
    if (!isSupabaseAdminConfigured) {
      return apiResponse({ error: '테넌트 저장소를 사용할 수 없습니다.' }, { status: 503 });
    }
    if (!body.id || !body.title?.trim()) {
      return apiResponse({ error: 'id와 title이 필요합니다.' }, { status: 400 });
    }

    const product = await upsertTenantProduct(productPayload(body, authorization.tenantId));
    if (!product) {
      return apiResponse({ error: '해당 테넌트 상품을 찾지 못했습니다.' }, { status: 404 });
    }
    return apiResponse({ product });
  } catch (error) {
    return apiResponse(
      { error: sanitizeDbError(error, '상품 수정에 실패했습니다.') },
      { status: 500 },
    );
  }
}
