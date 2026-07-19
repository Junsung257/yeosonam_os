import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireTenantPortalRequest: vi.fn(),
  getTenantProducts: vi.fn(),
  upsertTenantProduct: vi.fn(),
  tenantProductBelongsToTenant: vi.fn(),
  getTenantInventoryBlocks: vi.fn(),
  getInventoryByTenant: vi.fn(),
  upsertInventoryBlock: vi.fn(),
  getTenantSettlements: vi.fn(),
  getTenantPortalTenant: vi.fn(),
  listTenantPortalRfqs: vi.fn(),
  getTenantPortalRfq: vi.fn(),
  getTenantPortalBid: vi.fn(),
  sanitizeTenantPortalRfq: vi.fn(),
}));

vi.mock('@/lib/tenant-portal-auth', () => ({
  requireTenantPortalRequest: mocks.requireTenantPortalRequest,
  isTenantPortalAuthError: (value: unknown) => value instanceof NextResponse,
}));

vi.mock('@/lib/supabase', () => ({
  isSupabaseAdminConfigured: true,
  getTenantProducts: mocks.getTenantProducts,
  upsertTenantProduct: mocks.upsertTenantProduct,
  tenantProductBelongsToTenant: mocks.tenantProductBelongsToTenant,
  getTenantInventoryBlocks: mocks.getTenantInventoryBlocks,
  getInventoryByTenant: mocks.getInventoryByTenant,
  upsertInventoryBlock: mocks.upsertInventoryBlock,
  getTenantSettlements: mocks.getTenantSettlements,
}));

vi.mock('@/lib/tenant-portal-rfq', () => ({
  getTenantPortalTenant: mocks.getTenantPortalTenant,
  listTenantPortalRfqs: mocks.listTenantPortalRfqs,
  getTenantPortalRfq: mocks.getTenantPortalRfq,
  getTenantPortalBid: mocks.getTenantPortalBid,
  sanitizeTenantPortalRfq: mocks.sanitizeTenantPortalRfq,
}));

import { GET as getProducts, PUT as putProduct } from '@/app/api/tenant/products/route';
import { POST as postInventory, PUT as putInventory } from '@/app/api/tenant/inventory/route';
import { GET as getSettlements } from '@/app/api/tenant/settlements/route';
import { GET as getTenantRfqs } from '@/app/api/tenant/rfqs/route';
import { GET as getTenantRfqDetail } from '@/app/api/tenant/rfqs/[rfqId]/route';

const TENANT_A = '00000000-0000-4000-8000-00000000000a';
const TENANT_B = '00000000-0000-4000-8000-00000000000b';
const PRODUCT_A = '10000000-0000-4000-8000-00000000000a';
const PRODUCT_B = '10000000-0000-4000-8000-00000000000b';

const actorA = {
  tenantId: TENANT_A,
  userId: '00000000-0000-4000-8000-0000000000aa',
  role: 'tenant_staff' as const,
  isPlatformAdmin: false,
};

function jsonRequest(path: string, method: string, body: unknown) {
  return new NextRequest(`https://www.yeosonam.com${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('tenant portal route authorization', () => {
  beforeEach(() => {
    mocks.requireTenantPortalRequest.mockResolvedValue(actorA);
    mocks.getTenantProducts.mockResolvedValue([]);
    mocks.upsertTenantProduct.mockResolvedValue({ id: PRODUCT_A, tenant_id: TENANT_A });
    mocks.tenantProductBelongsToTenant.mockImplementation(
      async (productId: string, tenantId: string) => productId === PRODUCT_A && tenantId === TENANT_A,
    );
    mocks.upsertInventoryBlock.mockResolvedValue({ id: 'block-a' });
    mocks.getTenantSettlements.mockResolvedValue({ rows: [], total_cost: 0 });
    mocks.getTenantPortalTenant.mockResolvedValue({
      id: TENANT_A,
      name: 'Tenant A',
      status: 'active',
      tier: 'BRONZE',
    });
    mocks.listTenantPortalRfqs.mockResolvedValue([]);
    mocks.getTenantPortalBid.mockResolvedValue(null);
    mocks.sanitizeTenantPortalRfq.mockImplementation((rfq: Record<string, unknown>) => {
      const safe = { ...rfq };
      delete safe.share_token;
      delete safe.customer_name;
      delete safe.customer_phone;
      delete safe.customer_id;
      delete safe.ai_interview_log;
      delete safe.custom_requirements;
      return { ...safe, customer_name: '고객 (익명)' };
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('stops a denied products request before data access', async () => {
    mocks.requireTenantPortalRequest.mockResolvedValue(
      NextResponse.json({ code: 'FORBIDDEN' }, { status: 403 }),
    );

    const response = await getProducts(new NextRequest(
      `https://www.yeosonam.com/api/tenant/products?tenant_id=${TENANT_B}`,
    ));

    expect(response.status).toBe(403);
    expect(mocks.getTenantProducts).not.toHaveBeenCalled();
  });

  it('overwrites a product mutation tenant with the authorized tenant scope', async () => {
    const response = await putProduct(jsonRequest('/api/tenant/products', 'PUT', {
      id: PRODUCT_A,
      tenant_id: TENANT_B,
      title: 'Scoped product',
      cost_price: 100,
      price: 120,
    }));

    expect(response.status).toBe(200);
    expect(mocks.upsertTenantProduct).toHaveBeenCalledWith(expect.objectContaining({
      id: PRODUCT_A,
      tenant_id: TENANT_A,
    }));
  });

  it('rejects a foreign product ID before an inventory write', async () => {
    const response = await postInventory(jsonRequest('/api/tenant/inventory', 'POST', {
      tenant_id: TENANT_A,
      product_id: PRODUCT_B,
      date: '2026-08-01',
      total_seats: 10,
    }));

    expect(response.status).toBe(404);
    expect(mocks.upsertInventoryBlock).not.toHaveBeenCalled();
  });

  it('rejects a mixed-tenant bulk inventory payload atomically', async () => {
    const response = await putInventory(jsonRequest('/api/tenant/inventory', 'PUT', {
      tenant_id: TENANT_A,
      blocks: [
        { product_id: PRODUCT_A, date: '2026-08-01', total_seats: 10 },
        { product_id: PRODUCT_B, date: '2026-08-02', total_seats: 10 },
      ],
    }));

    expect(response.status).toBe(403);
    expect(mocks.upsertInventoryBlock).not.toHaveBeenCalled();
  });

  it('queries settlements with the authorized tenant, not the spoofed query value', async () => {
    const response = await getSettlements(new NextRequest(
      `https://www.yeosonam.com/api/tenant/settlements?tenant_id=${TENANT_B}&month=2026-07`,
    ));

    expect(response.status).toBe(200);
    expect(mocks.getTenantSettlements).toHaveBeenCalledWith(TENANT_A, '2026-07');
  });

  it('returns 500 instead of a false zero settlement when storage fails', async () => {
    mocks.getTenantSettlements.mockRejectedValue(new Error('postgrest unavailable'));

    const response = await getSettlements(new NextRequest(
      `https://www.yeosonam.com/api/tenant/settlements?tenant_id=${TENANT_A}&month=2026-07`,
    ));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: '정산 조회에 실패했습니다.',
    });
  });

  it('loads tenant RFQ bid state only for the authorized tenant', async () => {
    mocks.listTenantPortalRfqs.mockResolvedValue([{
      id: '20000000-0000-4000-8000-000000000001',
      status: 'published',
      share_token: 'must-not-leak',
      customer_name: 'real customer',
      customer_phone: '010-1234-5678',
      ai_interview_log: [{ answer: 'sensitive transcript' }],
      custom_requirements: {
        customer_email: 'customer@example.com',
        privacy_consent: true,
        utm: { source: 'campaign' },
      },
      created_at: '2026-07-19T00:00:00.000Z',
      updated_at: '2026-07-19T00:00:00.000Z',
    }]);

    const response = await getTenantRfqs(new NextRequest(
      `https://www.yeosonam.com/api/tenant/rfqs?tenant_id=${TENANT_B}`,
    ));

    expect(response.status).toBe(200);
    expect(mocks.getTenantPortalTenant).toHaveBeenCalledWith(TENANT_A);
    expect(mocks.getTenantPortalBid).toHaveBeenCalledWith(
      '20000000-0000-4000-8000-000000000001',
      TENANT_A,
    );
    const payload = await response.json();
    expect(payload.rfqs[0]).toMatchObject({ customer_name: '고객 (익명)' });
    expect(payload.rfqs[0]).not.toHaveProperty('share_token');
    expect(payload.rfqs[0]).not.toHaveProperty('customer_phone');
    expect(payload.rfqs[0]).not.toHaveProperty('ai_interview_log');
    expect(payload.rfqs[0]).not.toHaveProperty('custom_requirements');
  });

  it('does not return a locked RFQ detail before this tenant tier unlocks', async () => {
    const rfqId = '20000000-0000-4000-8000-000000000001';
    mocks.getTenantPortalRfq.mockResolvedValue({
      id: rfqId,
      status: 'published',
      destination: 'private destination',
      bronze_unlock_at: '2099-01-01T00:00:00.000Z',
      created_at: '2026-07-19T00:00:00.000Z',
      updated_at: '2026-07-19T00:00:00.000Z',
    });

    const response = await getTenantRfqDetail(
      new NextRequest(
        `https://www.yeosonam.com/api/tenant/rfqs/${rfqId}?tenant_id=${TENANT_A}`,
      ),
      { params: Promise.resolve({ rfqId }) },
    );

    expect(response.status).toBe(403);
    const payload = await response.json();
    expect(payload).toMatchObject({ code: 'RFQ_TIER_LOCKED' });
    expect(payload).not.toHaveProperty('rfq');
    expect(mocks.sanitizeTenantPortalRfq).not.toHaveBeenCalled();
  });

  it.each(['draft', 'cancelled'] as const)(
    'does not reveal a %s RFQ by guessed UUID without this tenant bid ownership',
    async (status) => {
      const rfqId = '20000000-0000-4000-8000-000000000001';
      mocks.getTenantPortalRfq.mockResolvedValue({
        id: rfqId,
        status,
        customer_name: 'real customer',
        created_at: '2026-07-19T00:00:00.000Z',
        updated_at: '2026-07-19T00:00:00.000Z',
      });
      mocks.getTenantPortalBid.mockResolvedValue(null);

      const response = await getTenantRfqDetail(
        new NextRequest(
          `https://www.yeosonam.com/api/tenant/rfqs/${rfqId}?tenant_id=${TENANT_A}`,
        ),
        { params: Promise.resolve({ rfqId }) },
      );

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({
        error: 'RFQ를 찾을 수 없습니다.',
      });
    },
  );

  it('allows a non-public RFQ detail only when this tenant already owns a bid', async () => {
    const rfqId = '20000000-0000-4000-8000-000000000001';
    mocks.getTenantPortalRfq.mockResolvedValue({
      id: rfqId,
      status: 'draft',
      customer_name: 'real customer',
      created_at: '2026-07-19T00:00:00.000Z',
      updated_at: '2026-07-19T00:00:00.000Z',
    });
    mocks.getTenantPortalBid.mockResolvedValue({
      id: '30000000-0000-4000-8000-000000000001',
      rfq_id: rfqId,
      tenant_id: TENANT_A,
      status: 'locked',
      locked_at: '2026-07-19T00:00:00.000Z',
      submit_deadline: '2026-07-20T00:00:00.000Z',
    });

    const response = await getTenantRfqDetail(
      new NextRequest(
        `https://www.yeosonam.com/api/tenant/rfqs/${rfqId}?tenant_id=${TENANT_A}`,
      ),
      { params: Promise.resolve({ rfqId }) },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      rfq: { id: rfqId, customer_name: '고객 (익명)' },
      my_bid: { id: '30000000-0000-4000-8000-000000000001' },
    });
    expect(payload.my_bid).not.toHaveProperty('tenant_id');
  });
});
