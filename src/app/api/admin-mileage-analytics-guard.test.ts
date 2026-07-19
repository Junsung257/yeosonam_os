import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('admin mileage analytics API boundary', () => {
  it('uses the standard request-bound admin guard before service-role analytics queries', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/api/admin/mileage-analytics/route.ts'),
      'utf8',
    );

    const methodStart = source.indexOf('export async function GET');
    const guardStart = source.indexOf('requireAdminRequest(request)', methodStart);
    const serviceRoleQueryStart = source.indexOf(".from('mileage_transactions')", methodStart);

    expect(methodStart).toBeGreaterThanOrEqual(0);
    expect(guardStart).toBeGreaterThan(methodStart);
    expect(serviceRoleQueryStart).toBeGreaterThan(guardStart);
    expect(source).not.toContain('getSupabase');
    expect(source).not.toContain('auth.getUser()');
  });
});
