import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api-auth', () => ({
  isValidAdminApiToken: vi.fn(),
}));

vi.mock('@/lib/supabase-jwt-verify', () => ({
  legacyJwtExpValid: vi.fn(),
  verifySupabaseAccessToken: vi.fn(),
}));

import { isValidAdminApiToken } from '@/lib/api-auth';
import { requireAdminRequest, requirePlatformAdminRequest } from '@/lib/admin-guard';
import { legacyJwtExpValid, verifySupabaseAccessToken } from '@/lib/supabase-jwt-verify';

const mockedAdminToken = vi.mocked(isValidAdminApiToken);
const mockedExpValid = vi.mocked(legacyJwtExpValid);
const mockedVerify = vi.mocked(verifySupabaseAccessToken);

function request(accessToken?: string): NextRequest {
  return new NextRequest('https://www.yeosonam.com/api/blog', {
    method: 'POST',
    headers: accessToken ? { cookie: `sb-access-token=${accessToken}` } : undefined,
  });
}

function platformRequest(accessToken = 'valid-platform-token'): NextRequest {
  return new NextRequest('https://www.yeosonam.com/api/admin/agent/office', {
    headers: { cookie: `sb-access-token=${accessToken}` },
  });
}

describe('requireAdminRequest', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ADMIN_EMAILS', 'admin@yeosonam.com');
    mockedAdminToken.mockReturnValue(false);
    mockedExpValid.mockReturnValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('returns 401 when the request is anonymous', async () => {
    const response = await requireAdminRequest(request());

    expect(response?.status).toBe(401);
    await expect(response?.json()).resolves.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(mockedVerify).not.toHaveBeenCalled();
  });

  it('returns 403 for an authenticated non-admin user', async () => {
    mockedVerify.mockResolvedValue({
      ok: true,
      payload: { email: 'traveler@example.com' },
    });

    const response = await requireAdminRequest(request('valid-user-token'));

    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('allows a verified administrator email', async () => {
    mockedVerify.mockResolvedValue({
      ok: true,
      payload: { email: 'ADMIN@YEOSONAM.COM' },
    });

    await expect(requireAdminRequest(request('valid-admin-token'))).resolves.toBeNull();
  });

  it('allows a valid server-to-server admin token', async () => {
    mockedAdminToken.mockReturnValue(true);

    await expect(requireAdminRequest(request())).resolves.toBeNull();
    expect(mockedVerify).not.toHaveBeenCalled();
  });

  it('returns 401 for an expired access token', async () => {
    mockedExpValid.mockReturnValue(false);

    const response = await requireAdminRequest(request('expired-token'));

    expect(response?.status).toBe(401);
    await expect(response?.json()).resolves.toMatchObject({ code: 'TOKEN_EXPIRED' });
    expect(mockedVerify).not.toHaveBeenCalled();
  });
});

describe('requirePlatformAdminRequest', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ADMIN_EMAILS', 'admin@yeosonam.com');
    mockedAdminToken.mockReturnValue(false);
    mockedExpValid.mockReturnValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('accepts a verified platform_admin JWT claim', async () => {
    mockedVerify.mockResolvedValue({ ok: true, payload: { email: 'admin@yeosonam.com', app_metadata: { role: 'platform_admin' } } });

    await expect(requirePlatformAdminRequest(platformRequest())).resolves.toBeNull();
  });

  it('accepts the legacy super_admin claim used by the existing admin model', async () => {
    mockedVerify.mockResolvedValue({ ok: true, payload: { email: 'admin@yeosonam.com', app_metadata: { role: 'super_admin' } } });

    await expect(requirePlatformAdminRequest(platformRequest())).resolves.toBeNull();
  });

  it('accepts a single exact ADMIN_EMAILS owner session when no role claim exists', async () => {
    mockedVerify.mockResolvedValue({ ok: true, payload: { email: 'ADMIN@YEOSONAM.COM' } });

    await expect(requirePlatformAdminRequest(platformRequest())).resolves.toBeNull();
  });

  it('does not upgrade an explicit tenant role through the legacy email fallback', async () => {
    mockedVerify.mockResolvedValue({ ok: true, payload: { email: 'admin@yeosonam.com', app_metadata: { role: 'tenant_admin' } } });

    const response = await requirePlatformAdminRequest(platformRequest());

    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toMatchObject({ code: 'PLATFORM_ADMIN_REQUIRED' });
  });

  it('uses PLATFORM_ADMIN_EMAILS when a multi-address admin allowlist is configured', async () => {
    vi.stubEnv('ADMIN_EMAILS', 'owner@yeosonam.com,tenant@yeosonam.com');
    vi.stubEnv('PLATFORM_ADMIN_EMAILS', 'owner@yeosonam.com');
    mockedVerify.mockResolvedValue({ ok: true, payload: { email: 'owner@yeosonam.com' } });

    await expect(requirePlatformAdminRequest(platformRequest())).resolves.toBeNull();
  });
});
