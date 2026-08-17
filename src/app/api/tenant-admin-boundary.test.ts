import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function routeSource(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

function expectGuardBefore(source: string, method: string, operation: string, requestName = 'request') {
  const methodStart = source.indexOf(`export async function ${method}`);
  const guardStart = source.indexOf(`requireAdminRequest(${requestName})`, methodStart);
  const operationStart = source.indexOf(operation, methodStart);

  expect(methodStart).toBeGreaterThanOrEqual(0);
  expect(guardStart).toBeGreaterThan(methodStart);
  expect(operationStart).toBeGreaterThan(guardStart);
}

describe('tenant/admin API boundary', () => {
  it('guards tenant token metadata and encrypted token mutation routes', () => {
    const source = routeSource('src/app/api/tenant-tokens/route.ts');

    expectGuardBefore(source, 'GET', ".from('tenant_api_tokens')");
    expectGuardBefore(source, 'POST', '.upsert(');
    expectGuardBefore(source, 'DELETE', '.update({ is_active: false })');
  });

  it('guards tenant product and inventory routes before trusting caller tenant_id', () => {
    const products = routeSource('src/app/api/tenant/products/route.ts');
    const inventory = routeSource('src/app/api/tenant/inventory/route.ts');

    expectGuardBefore(products, 'GET', "searchParams.get('tenant_id')");
    expectGuardBefore(products, 'POST', 'TENANT_PRODUCT_DIRECT_WRITE_RETIRED');
    expectGuardBefore(products, 'PUT', 'TENANT_PRODUCT_DIRECT_WRITE_RETIRED');

    expectGuardBefore(inventory, 'GET', "searchParams.get('tenant_id')");
    expectGuardBefore(inventory, 'POST', 'await request.json()');
    expectGuardBefore(inventory, 'PUT', 'await request.json()');
  });

  it('guards land-operator contact and mutation routes', () => {
    const source = routeSource('src/app/api/land-operators/route.ts');

    expectGuardBefore(source, 'GET', ".from('land_operators')", 'req');
    expectGuardBefore(source, 'POST', 'await req.json()', 'req');
    expectGuardBefore(source, 'PATCH', 'await req.json()', 'req');
  });

  it('guards platform tenant management routes', () => {
    const tenants = routeSource('src/app/api/tenants/route.ts');
    const tenantDetail = routeSource('src/app/api/tenants/[id]/route.ts');

    expectGuardBefore(tenants, 'GET', 'listTenants()');
    expectGuardBefore(tenants, 'POST', 'await request.json()');
    expectGuardBefore(tenantDetail, 'GET', 'getTenant(params.id)');
    expectGuardBefore(tenantDetail, 'PUT', 'await request.json()');
  });
});
