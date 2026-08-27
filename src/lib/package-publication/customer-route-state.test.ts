import { describe, expect, it } from 'vitest';

import { resolveCustomerRouteState } from './customer-route-state';

function supabaseFor(data: unknown, error: Error | null = null) {
  return {
    rpc(name: string) {
      expect(name).toBe('get_product_registration_customer_route_state');
      return Promise.resolve({ data, error });
    },
  } as never;
}

const input = {
  tenantId: 'tenant-1',
  packageRef: 'package-1',
};

describe('customer publication preflight', () => {
  it('returns under-review before any snapshot payload can be selected', async () => {
    await expect(resolveCustomerRouteState(supabaseFor({
      state: 'UNDER_REVIEW',
      catalog_product_id: 'catalog-1',
      package_id: 'package-1',
      pointer_version: 7,
    }), input)).resolves.toEqual({
      state: 'UNDER_REVIEW',
      catalogProductId: 'catalog-1',
      packageId: 'package-1',
      pointerVersion: 7,
    });
  });

  it('fails closed when the preflight RPC is unavailable', async () => {
    await expect(resolveCustomerRouteState(supabaseFor(null, new Error('db unavailable')), input))
      .resolves.toEqual({ state: 'UNAVAILABLE' });
  });

  it('requires revision and snapshot identity for a public route', async () => {
    await expect(resolveCustomerRouteState(supabaseFor({
      state: 'PUBLIC',
      catalog_product_id: 'catalog-1',
      package_id: 'package-1',
      pointer_version: 8,
    }), input)).resolves.toEqual({ state: 'UNAVAILABLE' });
  });
});
