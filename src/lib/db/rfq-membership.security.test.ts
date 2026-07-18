import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const limit = vi.fn();
  const query = { eq: vi.fn(), limit };
  query.eq.mockReturnValue(query);
  const select = vi.fn(() => query);
  const from = vi.fn(() => ({ select }));
  const getSupabaseAdmin = vi.fn(() => ({ from }));
  const getSupabase = vi.fn();
  return { limit, query, select, from, getSupabaseAdmin, getSupabase };
});

vi.mock('../supabase', () => ({
  getSupabaseAdmin: mocks.getSupabaseAdmin,
  getSupabase: mocks.getSupabase,
}));

import { getActiveRfqTenantMembership } from './rfq-server';

const USER_ID = '11111111-1111-4111-8111-111111111111';

describe('RFQ tenant membership repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.eq.mockReturnValue(mocks.query);
    mocks.getSupabaseAdmin.mockReturnValue({ from: mocks.from });
  });

  it('requires one active membership joined to an active tenant and matching metadata', async () => {
    mocks.limit.mockResolvedValue({
      data: [{
        tenant_id: 'tenant-a', user_id: USER_ID, role: 'tenant_staff', is_active: true,
        tenants: { status: 'active' },
      }],
      error: null,
    });

    await expect(getActiveRfqTenantMembership(USER_ID, 'tenant-a')).resolves.toEqual({
      tenantId: 'tenant-a', userId: USER_ID, role: 'tenant_staff',
    });
    expect(mocks.getSupabaseAdmin).toHaveBeenCalledOnce();
    expect(mocks.getSupabase).not.toHaveBeenCalled();
    expect(mocks.from).toHaveBeenCalledWith('tenant_memberships');
    expect(mocks.select).toHaveBeenCalledWith('tenant_id, user_id, role, is_active, tenants!inner(status)');
    expect(mocks.query.eq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(mocks.query.eq).toHaveBeenCalledWith('is_active', true);
    expect(mocks.query.eq).toHaveBeenCalledWith('tenants.status', 'active');
    expect(mocks.query.eq).toHaveBeenCalledWith('tenant_id', 'tenant-a');
  });

  it('rejects revoked, suspended, ambiguous, stale, and unsupported-role rows', async () => {
    const invalidRows = [
      [{ tenant_id: 'tenant-a', user_id: USER_ID, role: 'tenant_staff', is_active: false, tenants: { status: 'active' } }],
      [{ tenant_id: 'tenant-a', user_id: USER_ID, role: 'tenant_staff', is_active: true, tenants: { status: 'suspended' } }],
      [
        { tenant_id: 'tenant-a', user_id: USER_ID, role: 'tenant_staff', is_active: true, tenants: { status: 'active' } },
        { tenant_id: 'tenant-b', user_id: USER_ID, role: 'tenant_staff', is_active: true, tenants: { status: 'active' } },
      ],
      [{ tenant_id: 'tenant-b', user_id: USER_ID, role: 'tenant_staff', is_active: true, tenants: { status: 'active' } }],
      [{ tenant_id: 'tenant-a', user_id: USER_ID, role: 'viewer', is_active: true, tenants: { status: 'active' } }],
    ];

    for (const rows of invalidRows) {
      mocks.limit.mockResolvedValueOnce({ data: rows, error: null });
      await expect(getActiveRfqTenantMembership(USER_ID, 'tenant-a')).resolves.toBeNull();
    }
  });
});
