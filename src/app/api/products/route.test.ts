import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function routeSource(): string {
  return readFileSync(join(process.cwd(), 'src/app/api/products/route.ts'), 'utf8');
}

function methodSource(route: string, method: 'POST' | 'PATCH' | 'DELETE'): string {
  const methodStart = route.indexOf(`export async function ${method}`);
  const nextMethodStart = ['POST', 'PATCH', 'DELETE']
    .map((candidate) => route.indexOf(`export async function ${candidate}`, methodStart + 1))
    .filter((index) => index > methodStart)
    .sort((a, b) => a - b)[0] ?? route.length;
  return route.slice(methodStart, nextMethodStart);
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

  it('guards and retires direct product mutations fail-closed', () => {
    const route = routeSource();
    const retirementCodes = {
      POST: 'PRODUCT_DIRECT_CREATE_RETIRED',
      PATCH: 'PRODUCT_DIRECT_UPDATE_RETIRED',
      DELETE: 'PRODUCT_DIRECT_DELETE_RETIRED',
    } as const;

    for (const method of ['POST', 'PATCH', 'DELETE'] as const) {
      const body = methodSource(route, method);
      const guardStart = body.indexOf('requireAdminRequest(request)');

      expect(body, method).toContain(`export async function ${method}`);
      expect(guardStart, method).toBeGreaterThanOrEqual(0);
      expect(body, method).toContain(retirementCodes[method]);
      expect(body, method).toContain('{ status: 410');
      expect(body, method).not.toContain(".from('products')");
      expect(body, method).not.toMatch(/\.(insert|update|delete)\(/);
    }

    expect(route).not.toContain('.insert(');
    expect(route).not.toContain('.update(');
    expect(route).not.toContain('.delete()');
  });
});
