import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const shareMaybeSingle = vi.fn();
  const shareEq = vi.fn(() => ({ maybeSingle: shareMaybeSingle }));
  const eqStatus = vi.fn(() => ({ maybeSingle }));
  const eqId = vi.fn(() => ({ eq: eqStatus }));
  const select = vi.fn((columns: string) => columns === 'id, share_token' ? { eq: shareEq } : { eq: eqId });
  const from = vi.fn(() => ({ select }));
  const getSupabase = vi.fn();
  const getSupabaseAdmin = vi.fn(() => ({ from }));
  return { maybeSingle, shareMaybeSingle, shareEq, eqStatus, eqId, select, from, getSupabase, getSupabaseAdmin };
});

vi.mock('../supabase', () => ({
  getSupabase: mocks.getSupabase,
  getSupabaseAdmin: mocks.getSupabaseAdmin,
}));

import { getRfqShareIdentity, getRfqTenantForAuthorizedRequest } from './rfq-server';

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

  it('uses only the minimal id and share-token projection for capability validation', async () => {
    mocks.shareMaybeSingle.mockResolvedValue({ data: { id: 'rfq-1', share_token: 'share-1' }, error: null });

    await expect(getRfqShareIdentity('rfq-1')).resolves.toEqual({ id: 'rfq-1', share_token: 'share-1' });
    expect(mocks.getSupabaseAdmin).toHaveBeenCalledOnce();
    expect(mocks.getSupabase).not.toHaveBeenCalled();
    expect(mocks.select).toHaveBeenCalledWith('id, share_token');
    expect(mocks.shareEq).toHaveBeenCalledWith('id', 'rfq-1');
  });
});
