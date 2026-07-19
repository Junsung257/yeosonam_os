import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  bookProduct: vi.fn(),
  cancelProduct: vi.fn(),
  deductInventory: vi.fn(),
  getSupabaseAdmin: vi.fn(),
  getTransaction: vi.fn(),
  updateApiOrder: vi.fn(),
  updateTransaction: vi.fn(),
  upsertCart: vi.fn(),
}));

vi.mock('@/lib/mock-apis', () => ({
  bookProduct: mocks.bookProduct,
  cancelProduct: mocks.cancelProduct,
}));

vi.mock('@/lib/db/tenant', () => ({
  deductInventory: mocks.deductInventory,
}));

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: mocks.getSupabaseAdmin,
  getTransaction: mocks.getTransaction,
  isSupabaseConfigured: true,
  updateApiOrder: mocks.updateApiOrder,
  updateTransaction: mocks.updateTransaction,
  upsertCart: mocks.upsertCart,
}));

function request(body: unknown) {
  return new Request('http://localhost/api/checkout/complete', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function createAdminClient(options: {
  confirmation?: Record<string, unknown> | null;
  confirmationError?: { message: string; code?: string } | null;
  claimError?: { message: string; code?: string } | null;
}) {
  const paymentQuery = {
    select: vi.fn(() => paymentQuery),
    eq: vi.fn(() => paymentQuery),
    order: vi.fn(() => paymentQuery),
    limit: vi.fn(() => paymentQuery),
    maybeSingle: vi.fn(async () => ({
      data: options.confirmation ?? null,
      error: options.confirmationError ?? null,
    })),
  };

  const claimsTable = {
    insert: vi.fn(async () => ({ error: options.claimError ?? null })),
    update: vi.fn(() => ({
      eq: vi.fn(async () => ({ error: null })),
    })),
  };

  return {
    from: vi.fn((table: string) => {
      if (table === 'checkout_payment_confirmations') return paymentQuery;
      if (table === 'checkout_completion_claims') return claimsTable;
      throw new Error(`unexpected table ${table}`);
    }),
  };
}

function pendingTransaction() {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    idempotency_key: 'idem-1',
    session_id: 'session-1',
    status: 'PENDING',
    total_cost: 70000,
    total_price: 100000,
    net_margin: 30000,
    saga_log: [],
    api_orders: [
      {
        id: 'order-1',
        transaction_id: '00000000-0000-0000-0000-000000000001',
        api_name: 'tenant_product',
        product_type: 'ACTIVITY',
        product_category: 'FIXED',
        product_id: 'pkg-1',
        product_name: 'Verified package',
        cost: 70000,
        price: 100000,
        quantity: 2,
        status: 'PENDING',
        attrs: { tenant_id: 'tenant-1', date: '2026-08-01' },
        created_at: '2026-07-19T00:00:00.000Z',
      },
    ],
    created_at: '2026-07-19T00:00:00.000Z',
    updated_at: '2026-07-19T00:00:00.000Z',
  };
}

describe('POST /api/checkout/complete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.bookProduct.mockResolvedValue({ external_ref: 'provider-booking-1' });
    mocks.updateApiOrder.mockResolvedValue(undefined);
    mocks.updateTransaction.mockResolvedValue(undefined);
    mocks.upsertCart.mockResolvedValue(null);
    mocks.deductInventory.mockResolvedValue(undefined);
  });

  it('rejects caller-controlled completion without a transaction id', async () => {
    const { POST } = await import('./route');
    const response = await POST(request({ total_price: 1, customer_phone: '010-0000-0000' }) as never);

    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toContain('no-store');
    await expect(response.json()).resolves.toMatchObject({
      code: 'CHECKOUT_COMPLETE_INVALID_INPUT',
    });
    expect(mocks.getTransaction).not.toHaveBeenCalled();
  });

  it('does not complete when there is no verified server-side payment confirmation', async () => {
    mocks.getTransaction.mockResolvedValue(pendingTransaction());
    mocks.getSupabaseAdmin.mockReturnValue(createAdminClient({ confirmation: null }));

    const { POST } = await import('./route');
    const response = await POST(request({ transactionId: '00000000-0000-0000-0000-000000000001' }) as never);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'CHECKOUT_PAYMENT_NOT_VERIFIED',
    });
    expect(mocks.updateTransaction).not.toHaveBeenCalled();
    expect(mocks.bookProduct).not.toHaveBeenCalled();
  });

  it('completes only from transaction rows and matching verified payment evidence', async () => {
    mocks.getTransaction.mockResolvedValue(pendingTransaction());
    mocks.getSupabaseAdmin.mockReturnValue(createAdminClient({
      confirmation: {
        id: 'payment-1',
        transaction_id: '00000000-0000-0000-0000-000000000001',
        provider: 'toss',
        provider_payment_id: 'pay-1',
        provider_order_id: 'order-1',
        amount_krw: 100000,
        currency: 'KRW',
        status: 'verified',
        verified_at: '2026-07-19T00:00:00.000Z',
      },
    }));

    const { POST } = await import('./route');
    const response = await POST(request({
      transactionId: '00000000-0000-0000-0000-000000000001',
      total_price: 1,
      customer_phone: '010-0000-0000',
      vouchers: [{ code: 'caller-voucher' }],
    }) as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      transaction_id: '00000000-0000-0000-0000-000000000001',
      status: 'COMPLETED',
      total_price: 100000,
      payment_confirmation_id: 'payment-1',
    });
    expect(mocks.bookProduct).toHaveBeenCalledWith('tenant_product', 'pkg-1', 2);
    expect(mocks.updateApiOrder).toHaveBeenCalledWith('order-1', {
      status: 'CONFIRMED',
      external_ref: 'provider-booking-1',
    });
    expect(mocks.deductInventory).toHaveBeenCalledWith('pkg-1', '2026-08-01', 2);
    expect(mocks.upsertCart).toHaveBeenCalledWith('session-1', []);
    expect(mocks.updateTransaction).toHaveBeenLastCalledWith(
      '00000000-0000-0000-0000-000000000001',
      expect.objectContaining({
        status: 'COMPLETED',
        tenant_cost_breakdown: { 'tenant-1': 70000 },
      }),
    );
  });

  it('rolls back provider bookings when fixed inventory cannot be deducted', async () => {
    mocks.getTransaction.mockResolvedValue(pendingTransaction());
    mocks.getSupabaseAdmin.mockReturnValue(createAdminClient({
      confirmation: {
        id: 'payment-1',
        transaction_id: '00000000-0000-0000-0000-000000000001',
        provider: 'toss',
        provider_payment_id: 'pay-1',
        provider_order_id: 'order-1',
        amount_krw: 100000,
        currency: 'KRW',
        status: 'verified',
        verified_at: '2026-07-19T00:00:00.000Z',
      },
    }));
    mocks.deductInventory.mockRejectedValue(new Error('sold out'));

    const { POST } = await import('./route');
    const response = await POST(request({
      transactionId: '00000000-0000-0000-0000-000000000001',
    }) as never);

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      transaction_id: '00000000-0000-0000-0000-000000000001',
      status: 'PARTIAL_FAIL',
      failed_reason: 'inventory',
    });
    expect(mocks.cancelProduct).toHaveBeenCalledWith('tenant_product', 'provider-booking-1');
    expect(mocks.updateApiOrder).toHaveBeenCalledWith('order-1', { status: 'REFUNDED' });
    expect(mocks.updateTransaction).toHaveBeenLastCalledWith(
      '00000000-0000-0000-0000-000000000001',
      expect.objectContaining({ status: 'PARTIAL_FAIL' }),
    );
  });
});
