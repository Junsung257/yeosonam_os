import { describe, expect, it } from 'vitest';
import {
  getSafeLoginRedirect,
  tenantIdFromLoginRedirect,
} from '@/lib/login-redirect';

const TENANT_ID = '00000000-0000-4000-8000-00000000000a';

describe('login redirect authorization routing', () => {
  it.each([null, 'https://evil.example', '//evil.example', '/\\evil']) (
    'falls back to admin for an unsafe redirect: %s',
    (value) => {
      expect(getSafeLoginRedirect(value)).toBe('/admin');
    },
  );

  it('preserves an internal tenant portal redirect', () => {
    expect(getSafeLoginRedirect(`/tenant/${TENANT_ID}/products`))
      .toBe(`/tenant/${TENANT_ID}/products`);
  });

  it('extracts only a valid tenant UUID from a tenant redirect', () => {
    expect(tenantIdFromLoginRedirect(`/tenant/${TENANT_ID}/inventory`)).toBe(TENANT_ID);
    expect(tenantIdFromLoginRedirect('/tenant/not-a-tenant/products')).toBeNull();
    expect(tenantIdFromLoginRedirect('/admin')).toBeNull();
  });
});
