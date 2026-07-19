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

  it('guards product mutations with admin authorization', () => {
    const route = routeSource();

    for (const method of ['POST', 'PATCH', 'DELETE']) {
      const methodStart = route.indexOf(`export async function ${method}`);
      const guardStart = route.indexOf('requireAdminRequest(request)', methodStart);
      const writeStart = route.indexOf(method === 'DELETE' ? ".delete()" : method === 'PATCH' ? '.update(' : '.insert(', methodStart);

      expect(methodStart).toBeGreaterThanOrEqual(0);
      expect(guardStart).toBeGreaterThan(methodStart);
      expect(writeStart).toBeGreaterThan(guardStart);
    }
  });
});
