import { describe, expect, it } from 'vitest';
import { POST } from './route';

describe('POST /api/checkout/complete release fallback', () => {
  it('fails closed before accepting caller-controlled financial or PII data', async () => {
    const response = await POST();

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toContain('no-store');
    await expect(response.json()).resolves.toMatchObject({
      code: 'CHECKOUT_COMPLETE_DISABLED',
    });
  });
});
