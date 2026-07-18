import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/admin-guard', () => ({
  isAdminRequest: vi.fn(),
}));

vi.mock('@/lib/supabase-jwt-verify', () => ({
  verifySupabaseAccessToken: vi.fn(),
}));

vi.mock('@/lib/db/rfq-server', () => ({
  getActiveRfqTenantMembership: vi.fn(),
}));

import { isAdminRequest } from '@/lib/admin-guard';
import { verifySupabaseAccessToken } from '@/lib/supabase-jwt-verify';
import { getActiveRfqTenantMembership } from '@/lib/db/rfq-server';
import {
  hasValidRfqShareToken,
  resolveRfqActor,
} from '@/lib/rfq-request-auth';

const mockedIsAdminRequest = vi.mocked(isAdminRequest);
const mockedVerifyToken = vi.mocked(verifySupabaseAccessToken);
const mockedMembership = vi.mocked(getActiveRfqTenantMembership);
const USER_ID = '11111111-1111-4111-8111-111111111111';

function request(options?: {
  accessToken?: string;
  shareToken?: string;
  queryToken?: string;
}): NextRequest {
  const url = new URL('https://www.yeosonam.com/api/rfq/rfq-1');
  if (options?.queryToken) url.searchParams.set('share_token', options.queryToken);

  const headers = new Headers();
  if (options?.accessToken) headers.set('cookie', `sb-access-token=${options.accessToken}`);
  if (options?.shareToken) headers.set('x-rfq-share-token', options.shareToken);
  return new NextRequest(url, { headers });
}

describe('RFQ request authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedIsAdminRequest.mockResolvedValue(false);
    mockedVerifyToken.mockResolvedValue({ ok: false });
    mockedMembership.mockResolvedValue(null);
  });

  it('recognizes an administrator before tenant claims', async () => {
    mockedIsAdminRequest.mockResolvedValue(true);

    await expect(resolveRfqActor(request())).resolves.toEqual({ kind: 'admin' });
    expect(mockedVerifyToken).not.toHaveBeenCalled();
  });

  it('accepts only a verified subject with an active membership and matching metadata hint', async () => {
    mockedVerifyToken.mockResolvedValue({
      ok: true,
      payload: {
        sub: USER_ID,
        app_metadata: { tenant_id: 'tenant-a', role: 'tenant_staff' },
      },
    });
    mockedMembership.mockResolvedValue({ tenantId: 'tenant-a', userId: USER_ID, role: 'tenant_staff' });

    await expect(resolveRfqActor(request({ accessToken: 'verified' }))).resolves.toEqual({
      kind: 'tenant',
      tenantId: 'tenant-a',
      userId: USER_ID,
    });
    expect(mockedMembership).toHaveBeenCalledWith(USER_ID, 'tenant-a');
  });

  it('rejects user_metadata tenant spoofing', async () => {
    mockedVerifyToken.mockResolvedValue({
      ok: true,
      payload: {
        sub: USER_ID,
        user_metadata: { tenant_id: 'victim-tenant', role: 'tenant_admin' },
      },
    });

    await expect(resolveRfqActor(request({ accessToken: 'verified' }))).resolves.toBeNull();
    expect(mockedMembership).toHaveBeenCalledWith(USER_ID, null);
  });

  it.each([
    ['revoked membership', null],
    ['suspended tenant', null],
    ['unmapped subject', null],
  ])('rejects %s', async (_label, membership) => {
    mockedVerifyToken.mockResolvedValue({ ok: true, payload: { sub: USER_ID } });
    mockedMembership.mockResolvedValue(membership);

    await expect(resolveRfqActor(request({ accessToken: 'verified' }))).resolves.toBeNull();
  });

  it('rejects stale metadata and cross-tenant membership results', async () => {
    mockedVerifyToken.mockResolvedValue({
      ok: true,
      payload: { sub: USER_ID, app_metadata: { tenant_id: 'tenant-stale' } },
    });
    mockedMembership.mockResolvedValue({ tenantId: 'tenant-current', userId: USER_ID, role: 'tenant_admin' });

    await expect(resolveRfqActor(request({ accessToken: 'verified' }))).resolves.toBeNull();
    expect(mockedMembership).toHaveBeenCalledWith(USER_ID, 'tenant-stale');
  });

  it('accepts an unambiguous active membership without app metadata', async () => {
    mockedVerifyToken.mockResolvedValue({ ok: true, payload: { sub: USER_ID } });
    mockedMembership.mockResolvedValue({ tenantId: 'tenant-current', userId: USER_ID, role: 'tenant_admin' });

    await expect(resolveRfqActor(request({ accessToken: 'verified' }))).resolves.toEqual({
      kind: 'tenant', tenantId: 'tenant-current', userId: USER_ID,
    });
  });

  it('requires a non-empty timing-safe share-token match', () => {
    expect(hasValidRfqShareToken(request({ shareToken: 'share-1' }), 'share-1')).toBe(true);
    expect(hasValidRfqShareToken(request({ queryToken: 'share-1' }), 'share-1')).toBe(true);
    expect(hasValidRfqShareToken(request({ shareToken: 'wrong' }), 'share-1')).toBe(false);
    expect(hasValidRfqShareToken(request(), '')).toBe(false);
  });
});
