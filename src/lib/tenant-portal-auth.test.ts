import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isValidAdminApiToken: vi.fn(),
  verifySupabaseAccessToken: vi.fn(),
  maybeSingle: vi.fn(),
  eqActive: vi.fn(),
  eqStatus: vi.fn(),
  eqUser: vi.fn(),
  eqTenant: vi.fn(),
  select: vi.fn(),
  from: vi.fn(),
  getSupabaseAdmin: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({
  isValidAdminApiToken: mocks.isValidAdminApiToken,
}));

vi.mock('@/lib/supabase-jwt-verify', () => ({
  verifySupabaseAccessToken: mocks.verifySupabaseAccessToken,
}));

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: mocks.getSupabaseAdmin,
}));

import { requireTenantPortalRequest } from '@/lib/tenant-portal-auth';

const TENANT_A = '00000000-0000-4000-8000-00000000000a';
const TENANT_B = '00000000-0000-4000-8000-00000000000b';
const USER_ID = '00000000-0000-4000-8000-0000000000aa';

function request(token?: string, headers?: Record<string, string>) {
  return new NextRequest(`https://www.yeosonam.com/api/tenant/products?tenant_id=${TENANT_A}`, {
    headers: {
      ...(token ? { cookie: `sb-access-token=${token}` } : {}),
      ...headers,
    },
  });
}

function expectResponse(value: unknown): asserts value is NextResponse {
  expect(value).toBeInstanceOf(NextResponse);
}

describe('requireTenantPortalRequest', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ADMIN_EMAILS', 'admin@yeosonam.com');
    mocks.isValidAdminApiToken.mockReturnValue(false);
    mocks.eqTenant.mockReturnValue({ eq: mocks.eqUser });
    mocks.eqUser.mockReturnValue({ eq: mocks.eqActive });
    mocks.eqActive.mockReturnValue({ eq: mocks.eqStatus });
    mocks.eqStatus.mockReturnValue({ maybeSingle: mocks.maybeSingle });
    mocks.select.mockReturnValue({ eq: mocks.eqTenant });
    mocks.from.mockReturnValue({ select: mocks.select });
    mocks.getSupabaseAdmin.mockReturnValue({ from: mocks.from });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('returns 401 before any database lookup for an anonymous request', async () => {
    const result = await requireTenantPortalRequest(request(), TENANT_A);

    expectResponse(result);
    expect(result.status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('returns 401 for an invalid access token', async () => {
    mocks.verifySupabaseAccessToken.mockResolvedValue({ ok: false });

    const result = await requireTenantPortalRequest(request('invalid'), TENANT_A);

    expectResponse(result);
    expect(result.status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('allows an active membership for the exact requested tenant', async () => {
    mocks.verifySupabaseAccessToken.mockResolvedValue({
      ok: true,
      payload: { sub: USER_ID, email: 'staff@example.com' },
    });
    mocks.maybeSingle.mockResolvedValue({
      data: {
        tenant_id: TENANT_A,
        role: 'tenant_staff',
        is_active: true,
        tenants: { status: 'active' },
      },
      error: null,
    });

    const result = await requireTenantPortalRequest(request('valid'), TENANT_A);

    expect(result).toMatchObject({
      tenantId: TENANT_A,
      userId: USER_ID,
      role: 'tenant_staff',
      isPlatformAdmin: false,
    });
    expect(mocks.eqTenant).toHaveBeenCalledWith('tenant_id', TENANT_A);
    expect(mocks.eqUser).toHaveBeenCalledWith('user_id', USER_ID);
    expect(mocks.eqStatus).toHaveBeenCalledWith('tenants.status', 'active');
  });

  it('ignores a spoofed user_metadata tenant and denies without a DB membership', async () => {
    mocks.verifySupabaseAccessToken.mockResolvedValue({
      ok: true,
      payload: {
        sub: USER_ID,
        email: 'staff@example.com',
        user_metadata: { tenant_id: TENANT_A },
      },
    });
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });

    const result = await requireTenantPortalRequest(request('valid'), TENANT_A);

    expectResponse(result);
    expect(result.status).toBe(403);
  });

  it('denies cross-tenant URL spoofing', async () => {
    mocks.verifySupabaseAccessToken.mockResolvedValue({
      ok: true,
      payload: { sub: USER_ID, email: 'staff@example.com' },
    });
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });

    const result = await requireTenantPortalRequest(request('valid'), TENANT_B);

    expectResponse(result);
    expect(result.status).toBe(403);
    expect(mocks.eqTenant).toHaveBeenCalledWith('tenant_id', TENANT_B);
  });

  it('denies a suspended tenant even when the membership row is still active', async () => {
    mocks.verifySupabaseAccessToken.mockResolvedValue({
      ok: true,
      payload: { sub: USER_ID, email: 'staff@example.com' },
    });
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });

    const result = await requireTenantPortalRequest(request('valid'), TENANT_A);

    expectResponse(result);
    expect(result.status).toBe(403);
  });

  it('allows a verified platform admin without a membership lookup', async () => {
    mocks.verifySupabaseAccessToken.mockResolvedValue({
      ok: true,
      payload: { sub: USER_ID, email: 'ADMIN@YEOSONAM.COM' },
    });

    const result = await requireTenantPortalRequest(request('admin'), TENANT_B);

    expect(result).toMatchObject({ tenantId: TENANT_B, isPlatformAdmin: true });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('allows the existing server-to-server admin token contract', async () => {
    mocks.isValidAdminApiToken.mockReturnValue(true);

    const result = await requireTenantPortalRequest(request(undefined, {
      'x-admin-token': 'valid-admin-token',
    }), TENANT_A);

    expect(result).toMatchObject({ tenantId: TENANT_A, isPlatformAdmin: true });
    expect(mocks.verifySupabaseAccessToken).not.toHaveBeenCalled();
  });

  it('fails closed when membership storage is unavailable', async () => {
    mocks.verifySupabaseAccessToken.mockResolvedValue({
      ok: true,
      payload: { sub: USER_ID, email: 'staff@example.com' },
    });
    mocks.getSupabaseAdmin.mockReturnValue(null);

    const result = await requireTenantPortalRequest(request('valid'), TENANT_A);

    expectResponse(result);
    expect(result.status).toBe(503);
  });
});
