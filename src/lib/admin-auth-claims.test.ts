import { describe, expect, it } from 'vitest';
import { inferTrustedAdminRole, inferTrustedTenantId } from './admin-auth-claims';

describe('trusted admin claims', () => {
  it('accepts platform and tenant roles from app_metadata', () => {
    expect(inferTrustedAdminRole({ app_metadata: { role: 'platform_admin' } })).toBe('platform_admin');
    expect(inferTrustedAdminRole({ app_metadata: { role: 'tenant_admin' } })).toBe('tenant_admin');
    expect(inferTrustedTenantId({ app_metadata: { tenant_id: 'tenant-1' } })).toBe('tenant-1');
  });

  it('ignores user-editable metadata for authorization', () => {
    expect(inferTrustedAdminRole({ user_metadata: { role: 'platform_admin' } })).toBe('unknown');
    expect(inferTrustedTenantId({ user_metadata: { tenant_id: 'tenant-1' } })).toBeUndefined();
  });
});
