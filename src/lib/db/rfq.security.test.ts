import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const eqStatus = vi.fn(() => ({ maybeSingle }));
  const eqId = vi.fn(() => ({ eq: eqStatus }));
  const select = vi.fn(() => ({ eq: eqId }));
  const from = vi.fn(() => ({ select }));
  const getSupabase = vi.fn();
  const getSupabaseAdmin = vi.fn(() => ({ from }));
  return { maybeSingle, eqStatus, eqId, select, from, getSupabase, getSupabaseAdmin };
});

vi.mock('../supabase', () => ({
  getSupabase: mocks.getSupabase,
  getSupabaseAdmin: mocks.getSupabaseAdmin,
}));

import { getRfqTenantForAuthorizedRequest } from './rfq-server';

describe('RFQ server tenant lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSupabaseAdmin.mockReturnValue({ from: mocks.from });
    mocks.maybeSingle.mockResolvedValue({ data: { id: 'tenant-a', tier: 'GOLD' }, error: null });
  });

  it('uses only the service-role client and requires an active tenant', async () => {
    await expect(getRfqTenantForAuthorizedRequest('tenant-a')).resolves.toEqual({
      id: 'tenant-a',
      tier: 'GOLD',
    });

    expect(mocks.getSupabaseAdmin).toHaveBeenCalledOnce();
    expect(mocks.getSupabase).not.toHaveBeenCalled();
    expect(mocks.from).toHaveBeenCalledWith('tenants');
    expect(mocks.select).toHaveBeenCalledWith('id, tier');
    expect(mocks.eqId).toHaveBeenCalledWith('id', 'tenant-a');
    expect(mocks.eqStatus).toHaveBeenCalledWith('status', 'active');
  });

  it('fails closed when the service-role client is unavailable', async () => {
    mocks.getSupabaseAdmin.mockReturnValueOnce(null as never);

    await expect(getRfqTenantForAuthorizedRequest('tenant-a')).rejects.toThrow('service-role');
    expect(mocks.getSupabase).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
