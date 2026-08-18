import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function routeSource(): string {
  return readFileSync(join(process.cwd(), 'src/app/api/products/route.ts'), 'utf8');
}

describe('/api/products route boundary', () => {
  it('guards GET before reading the raw products table', () => {
    const route = routeSource();
    const getStart = route.indexOf('export async function GET');
    const queryStart = route.indexOf("supabaseAdmin.from('products').select('*'", getStart);
    const guardStart = route.indexOf('requireAdminRequest(request)', getStart);

    expect(getStart).toBeGreaterThanOrEqual(0);
    expect(guardStart).toBeGreaterThan(getStart);
    expect(queryStart).toBeGreaterThan(guardStart);
  });

  it('guards and retires product mutations instead of writing mutable rows', () => {
    const route = routeSource();

    for (const method of ['POST', 'PATCH', 'DELETE']) {
      const methodStart = route.indexOf(`export async function ${method}`);
      const guardStart = route.indexOf('requireAdminRequest(request)', methodStart);

      expect(methodStart).toBeGreaterThanOrEqual(0);
      expect(guardStart).toBeGreaterThan(methodStart);
      expect(route.slice(methodStart, methodStart + 1200)).toContain('status: 410');
    }
    expect(route).toContain('PRODUCT_DIRECT_CREATE_RETIRED');
    expect(route).toContain('PRODUCT_DIRECT_UPDATE_RETIRED');
    expect(route).toContain('PRODUCT_DIRECT_DELETE_RETIRED');
  });
});
