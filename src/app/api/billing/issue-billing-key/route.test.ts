import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAdminRequest: vi.fn(),
  getSecret: vi.fn(),
  upsert: vi.fn(),
  encrypt: vi.fn(() => 'encrypted-key'),
}));

vi.mock('@/lib/admin-guard', () => ({ requireAdminRequest: mocks.requireAdminRequest }));
vi.mock('@/lib/secret-registry', () => ({ getSecret: mocks.getSecret }));
vi.mock('@/lib/encryption', () => ({ encrypt: mocks.encrypt }));
vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabaseAdmin: { from: vi.fn(() => ({ upsert: mocks.upsert })) },
}));

import { POST } from './route';

function request() {
  return new NextRequest('http://localhost/api/billing/issue-billing-key', {
    method: 'POST',
    body: JSON.stringify({ tenant_id: 'tenant-1', customer_key: 'customer-1', auth_key: 'auth-1' }),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/billing/issue-billing-key admin boundary', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('rejects an unauthenticated caller before Toss or DB side effects', async () => {
    mocks.requireAdminRequest.mockResolvedValueOnce(
      NextResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 }),
    );
    mocks.getSecret.mockReturnValue('toss-secret');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('preserves a legitimate admin/server billing-key exchange', async () => {
    mocks.requireAdminRequest.mockResolvedValueOnce(null);
    mocks.getSecret.mockReturnValue('toss-secret');
    mocks.upsert.mockResolvedValueOnce({ error: null });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ billingKey: 'billing-key' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ));

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.encrypt).toHaveBeenCalledWith('billing-key');
    expect(mocks.upsert).toHaveBeenCalledOnce();
  });
});
