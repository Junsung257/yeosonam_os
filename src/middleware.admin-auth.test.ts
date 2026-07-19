import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const adminGuardMocks = vi.hoisted(() => ({
  requireAdminRequest: vi.fn(),
}));

vi.mock('@/lib/admin-guard', () => ({
  requireAdminRequest: adminGuardMocks.requireAdminRequest,
}));

import { middleware } from './middleware';

function adminRequest(
  path: '/admin' | '/m/admin',
  cookies?: string,
): NextRequest {
  return new NextRequest(`https://www.yeosonam.com${path}`, {
    headers: cookies ? { cookie: cookies } : undefined,
  });
}

describe('middleware admin page authorization', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    adminGuardMocks.requireAdminRequest.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('allows a verified administrator to continue to the page', async () => {
    adminGuardMocks.requireAdminRequest.mockResolvedValue(null);

    const response = await middleware(adminRequest('/admin', 'sb-access-token=valid-admin'));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it.each([
    ['expired access with refresh', 'sb-access-token=expired; sb-refresh-token=refresh'],
    ['refresh only', 'sb-refresh-token=refresh'],
  ])('redirects %s to re-authentication without exposing the admin page', async (_case, cookies) => {
    adminGuardMocks.requireAdminRequest.mockResolvedValue(NextResponse.json(
      { code: 'TOKEN_EXPIRED' },
      { status: 401 },
    ));

    const response = await middleware(adminRequest('/admin', cookies));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://www.yeosonam.com/login?redirect=%2Fadmin');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.cookies.get('sb-access-token')?.value).toBe('');
  });

  it('keeps an authenticated non-admin fail-closed with 403', async () => {
    adminGuardMocks.requireAdminRequest.mockResolvedValue(NextResponse.json(
      { code: 'FORBIDDEN' },
      { status: 403 },
    ));

    const response = await middleware(adminRequest('/admin', 'sb-access-token=valid-user'));

    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('uses the mobile admin login route for mobile re-authentication', async () => {
    adminGuardMocks.requireAdminRequest.mockResolvedValue(NextResponse.json(
      { code: 'UNAUTHORIZED' },
      { status: 401 },
    ));

    const response = await middleware(adminRequest('/m/admin'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://www.yeosonam.com/m/admin/login?redirect=%2Fm%2Fadmin',
    );
  });
});
