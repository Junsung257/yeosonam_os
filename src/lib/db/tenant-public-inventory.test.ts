import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSupabaseAdmin: vi.fn(),
}));

vi.mock('../supabase', () => ({
  getSupabase: vi.fn(),
  getSupabaseAdmin: mocks.getSupabaseAdmin,
}));

import { getPublicInventoryBlocks } from './tenant';

function queryChain(result: { data: unknown; error: unknown }, terminal: 'maybeSingle' | 'order') {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ['select', 'eq', 'in', 'gte', 'lte', 'gt']) {
    chain[method] = vi.fn(() => chain);
  }
  chain[terminal] = vi.fn(async () => result);
  return chain;
}

describe('getPublicInventoryBlocks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('gates by public package state and selects only the public inventory DTO', async () => {
    const productQuery = queryChain({ data: { id: 'package-a' }, error: null }, 'maybeSingle');
    const inventoryQuery = queryChain({
      data: [{ date: '2026-08-01', available_seats: 4, price_override: 120000 }],
      error: null,
    }, 'order');
    const from = vi.fn((table: string) => (
      table === 'travel_packages' ? productQuery : inventoryQuery
    ));
    mocks.getSupabaseAdmin.mockReturnValue({ from });

    await expect(getPublicInventoryBlocks('package-a', '2026-08-01', '2026-08-31'))
      .resolves.toEqual([
        { date: '2026-08-01', available_seats: 4, price_override: 120000 },
      ]);

    expect(productQuery.select).toHaveBeenCalledWith('id');
    expect(productQuery.in).toHaveBeenCalledWith(
      'publication_state',
      ['approved', 'published'],
    );
    expect(inventoryQuery.select).toHaveBeenCalledWith(
      'date, available_seats, price_override',
    );
    expect(inventoryQuery.eq).toHaveBeenCalledWith('status', 'OPEN');
    expect(inventoryQuery.gt).toHaveBeenCalledWith('available_seats', 0);
  });

  it('returns no inventory and never reaches the privileged table for a non-public product', async () => {
    const productQuery = queryChain({ data: null, error: null }, 'maybeSingle');
    const from = vi.fn(() => productQuery);
    mocks.getSupabaseAdmin.mockReturnValue({ from });

    await expect(getPublicInventoryBlocks('draft-package', '2026-08-01', '2026-08-31'))
      .resolves.toBeNull();
    expect(from).toHaveBeenCalledTimes(1);
  });

  it('does not misreport missing privileged storage as a non-public product', async () => {
    mocks.getSupabaseAdmin.mockReturnValue(null);

    await expect(getPublicInventoryBlocks('package-a', '2026-08-01', '2026-08-31'))
      .rejects.toThrow('Public inventory storage is unavailable');
  });
});
