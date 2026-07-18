import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/admin-guard', () => ({
  isAdminRequest: vi.fn(),
}));

vi.mock('@/lib/supabase-jwt-verify', () => ({
  verifySupabaseAccessToken: vi.fn(),
}));

import { isAdminRequest } from '@/lib/admin-guard';
import { verifySupabaseAccessToken } from '@/lib/supabase-jwt-verify';
import {
  hasValidRfqShareToken,
  resolveRfqActor,
} from '@/lib/rfq-request-auth';

const mockedIsAdminRequest = vi.mocked(isAdminRequest);
const mockedVerifyToken = vi.mocked(verifySupabaseAccessToken);

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
  });

  it('recognizes an administrator before tenant claims', async () => {
    mockedIsAdminRequest.mockResolvedValue(true);

    await expect(resolveRfqActor(request())).resolves.toEqual({ kind: 'admin' });
    expect(mockedVerifyToken).not.toHaveBeenCalled();
  });

  it('accepts a verified app_metadata tenant binding', async () => {
    mockedVerifyToken.mockResolvedValue({
      ok: true,
      payload: {
        sub: 'user-1',
        app_metadata: { tenant_id: 'tenant-a', role: 'tenant_staff' },
      },
    });

    await expect(resolveRfqActor(request({ accessToken: 'verified' }))).resolves.toEqual({
      kind: 'tenant',
      tenantId: 'tenant-a',
      userId: 'user-1',
    });
  });

  it('rejects user_metadata tenant spoofing', async () => {
    mockedVerifyToken.mockResolvedValue({
      ok: true,
      payload: {
        sub: 'attacker',
        user_metadata: { tenant_id: 'victim-tenant', role: 'tenant_admin' },
      },
    });

    await expect(resolveRfqActor(request({ accessToken: 'verified' }))).resolves.toBeNull();
  });

  it('requires a non-empty timing-safe share-token match', () => {
    expect(hasValidRfqShareToken(request({ shareToken: 'share-1' }), 'share-1')).toBe(true);
    expect(hasValidRfqShareToken(request({ queryToken: 'share-1' }), 'share-1')).toBe(true);
    expect(hasValidRfqShareToken(request({ shareToken: 'wrong' }), 'share-1')).toBe(false);
    expect(hasValidRfqShareToken(request(), '')).toBe(false);
  });
});
