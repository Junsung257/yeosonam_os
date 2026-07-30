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
import { requireAdminRequest } from '@/lib/admin-guard';
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

  it('allows a trusted platform_admin app_metadata role without an email allowlist match', async () => {
    mockedVerify.mockResolvedValue({
      ok: true,
      payload: { email: 'owner@example.com', app_metadata: { role: 'platform_admin' } },
    });

    await expect(requireAdminRequest(request('valid-platform-admin-token'))).resolves.toBeNull();
  });

  it('does not trust a platform_admin role from user_metadata', async () => {
    mockedVerify.mockResolvedValue({
      ok: true,
      payload: { email: 'owner@example.com', user_metadata: { role: 'platform_admin' } },
    });

    const response = await requireAdminRequest(request('forged-user-metadata-token'));
    expect(response?.status).toBe(403);
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
