import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { POST } from './route';

describe('POST /api/concierge/checkout launch boundary', () => {
  it('fails closed instead of creating paid transactions without provider verification', async () => {
    const response = await POST(new Request('http://localhost/api/concierge/checkout', { method: 'POST' }) as never);

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toContain('no-store');
    await expect(response.json()).resolves.toMatchObject({
      code: 'CONCIERGE_CHECKOUT_DISABLED',
    });
  });

  it('does not contain the old paid-state booking side effects', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/api/concierge/checkout/route.ts'), 'utf8');

    expect(source).not.toContain('CUSTOMER_PAID');
    expect(source).not.toContain('bookProduct(');
    expect(source).not.toContain('deductInventory(');
    expect(source).not.toContain('createApiOrder(');
  });
});
