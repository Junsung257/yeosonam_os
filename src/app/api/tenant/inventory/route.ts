import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import {
  getInventoryByTenant,
  getTenantInventoryBlocks,
  isSupabaseAdminConfigured,
  tenantProductBelongsToTenant,
  upsertInventoryBlock,
} from '@/lib/supabase';
import {
  isTenantPortalAuthError,
  requireTenantPortalRequest,
} from '@/lib/tenant-portal-auth';

type InventoryInput = Parameters<typeof upsertInventoryBlock>[0];
type InventoryBody = Partial<InventoryInput> & {
  blocks?: Array<Partial<InventoryInput>>;
};

async function ownsEveryProduct(tenantId: string, productIds: string[]): Promise<boolean> {
  const uniqueIds = [...new Set(productIds.filter(Boolean))];
  if (uniqueIds.length === 0) return false;
  const ownership = await Promise.all(
    uniqueIds.map((productId) => tenantProductBelongsToTenant(productId, tenantId)),
  );
  return ownership.every(Boolean);
}

function scopedBlock(input: Partial<InventoryInput>, tenantId: string): InventoryInput {
  return {
    tenant_id: tenantId,
    product_id: input.product_id ?? '',
    date: input.date ?? '',
    total_seats: Number(input.total_seats ?? 0),
    booked_seats: input.booked_seats,
    price_override: input.price_override,
    status: input.status,
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const requestedTenantId = searchParams.get('tenant_id') ?? '';
  const authorization = await requireTenantPortalRequest(request, requestedTenantId);
  if (isTenantPortalAuthError(authorization)) return authorization;
  if (!isSupabaseAdminConfigured) {
    return apiResponse({ error: '테넌트 저장소를 사용할 수 없습니다.' }, { status: 503 });
  }

  const productId = searchParams.get('product_id');
  const from = searchParams.get('from') ?? `${new Date().toISOString().slice(0, 7)}-01`;
  const to = searchParams.get('to') ?? `${new Date().toISOString().slice(0, 7)}-31`;

  if (productId) {
    if (!(await tenantProductBelongsToTenant(productId, authorization.tenantId))) {
      return apiResponse({ error: '해당 테넌트 상품을 찾지 못했습니다.' }, { status: 404 });
    }
    const blocks = await getTenantInventoryBlocks(
      authorization.tenantId,
      productId,
      from,
      to,
    );
    return apiResponse({ blocks }, { headers: { 'Cache-Control': 'private, no-store' } });
  }

  const blocks = await getInventoryByTenant(authorization.tenantId, from, to);
  return apiResponse({ blocks }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as InventoryBody;
    const authorization = await requireTenantPortalRequest(request, body.tenant_id ?? '');
    if (isTenantPortalAuthError(authorization)) return authorization;
    if (!isSupabaseAdminConfigured) {
      return apiResponse({ error: '테넌트 저장소를 사용할 수 없습니다.' }, { status: 503 });
    }
    if (!body.product_id || !body.date || body.total_seats === undefined) {
      return apiResponse(
        { error: 'product_id, date, total_seats가 필요합니다.' },
        { status: 400 },
      );
    }
    if (!(await tenantProductBelongsToTenant(body.product_id, authorization.tenantId))) {
      return apiResponse({ error: '해당 테넌트 상품을 찾지 못했습니다.' }, { status: 404 });
    }

    const block = await upsertInventoryBlock(scopedBlock(body, authorization.tenantId));
    if (!block) {
      return apiResponse({ error: '재고를 저장하지 못했습니다.' }, { status: 500 });
    }
    return apiResponse({ block }, { status: 201 });
  } catch (error) {
    return apiResponse(
      { error: sanitizeDbError(error, '재고 저장에 실패했습니다.') },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json() as InventoryBody;
    const authorization = await requireTenantPortalRequest(request, body.tenant_id ?? '');
    if (isTenantPortalAuthError(authorization)) return authorization;
    if (!isSupabaseAdminConfigured) {
      return apiResponse({ error: '테넌트 저장소를 사용할 수 없습니다.' }, { status: 503 });
    }
    if (!Array.isArray(body.blocks) || body.blocks.length === 0) {
      return apiResponse({ error: 'blocks 배열이 필요합니다.' }, { status: 400 });
    }

    const productIds = body.blocks.map((block) => block.product_id ?? '');
    if (!(await ownsEveryProduct(authorization.tenantId, productIds))) {
      return apiResponse(
        { error: '다른 테넌트 상품의 재고는 변경할 수 없습니다.' },
        { status: 403 },
      );
    }

    const normalized = body.blocks.map((block) => scopedBlock(block, authorization.tenantId));
    if (normalized.some((block) => !block.product_id || !block.date)) {
      return apiResponse({ error: '모든 재고에 product_id와 date가 필요합니다.' }, { status: 400 });
    }

    const results = await Promise.allSettled(normalized.map(upsertInventoryBlock));
    const succeeded = results.filter(
      (result) => result.status === 'fulfilled' && result.value !== null,
    ).length;
    return apiResponse({ ok: succeeded === normalized.length, succeeded, total: normalized.length });
  } catch (error) {
    return apiResponse(
      { error: sanitizeDbError(error, '재고 일괄 저장에 실패했습니다.') },
      { status: 500 },
    );
  }
}
