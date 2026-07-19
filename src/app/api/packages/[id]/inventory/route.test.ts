import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPublicInventoryBlocks: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  getPublicInventoryBlocks: mocks.getPublicInventoryBlocks,
}));

import { GET } from './route';

const context = { params: Promise.resolve({ id: 'package-a' }) };

describe('public package inventory route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns only allowlisted availability fields', async () => {
    mocks.getPublicInventoryBlocks.mockResolvedValue([{
      id: 'internal-row-id',
      tenant_id: 'private-tenant-id',
      product_id: 'package-a',
      date: '2026-08-01',
      total_seats: 10,
      booked_seats: 6,
      available_seats: 4,
      price_override: 120000,
      status: 'OPEN',
      created_at: '2026-07-19T00:00:00.000Z',
      updated_at: '2026-07-19T00:00:00.000Z',
    }]);

    const response = await GET(
      new NextRequest('https://www.yeosonam.com/api/packages/package-a/inventory?from=2026-08-01&to=2026-08-31'),
      context,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      blocks: [{ date: '2026-08-01', available_seats: 4, price_override: 120000 }],
    });
  });

  it('does not reveal whether inventory exists for a non-public product', async () => {
    mocks.getPublicInventoryBlocks.mockResolvedValue(null);

    const response = await GET(
      new NextRequest('https://www.yeosonam.com/api/packages/draft-package/inventory'),
      { params: Promise.resolve({ id: 'draft-package' }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: '상품을 찾을 수 없습니다.' });
  });
});
