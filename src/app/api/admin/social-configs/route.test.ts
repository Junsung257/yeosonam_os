import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  adminConfigured: true,
}));

vi.mock('@/lib/admin-guard', () => ({
  isAdminRequest: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseAdminConfigured() {
    return mocks.adminConfigured;
  },
  supabaseAdmin: { from: mocks.from },
}));

import { GET, PATCH, POST } from './route';

const SECRET_ROW = {
  id: 'config-1',
  platform: 'threads',
  enabled: true,
  account_id: 'account-1',
  access_token: 'access-token-must-never-leave-server',
  refresh_token: 'refresh-token-must-never-leave-server',
  client_secret: 'client-secret-must-never-leave-server',
  token_expires_at: null,
  default_post_type: 'image',
  daily_post_limit: 3,
  posts_today: 1,
  last_post_at: null,
  created_at: '2026-07-23T00:00:00.000Z',
  updated_at: '2026-07-23T00:00:00.000Z',
};

function request(method: 'GET' | 'POST' | 'PATCH', body?: unknown) {
  return new NextRequest('http://localhost/api/admin/social-configs', {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('/api/admin/social-configs secret boundary', () => {
  beforeEach(() => {
    mocks.from.mockReset();
    mocks.adminConfigured = true;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns only the explicit safe projection even if the database object contains secrets', async () => {
    const order = vi.fn().mockResolvedValue({ data: [SECRET_ROW], error: null });
    const select = vi.fn().mockReturnValue({ order });
    mocks.from.mockReturnValue({ select });

    const response = await GET(request('GET'));
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(select).toHaveBeenCalledOnce();
    expect(select.mock.calls[0][0]).not.toContain('access_token');
    expect(select.mock.calls[0][0]).not.toContain('refresh_token');
    expect(serialized).not.toContain('access-token-must-never-leave-server');
    expect(serialized).not.toContain('refresh-token-must-never-leave-server');
    expect(serialized).not.toContain('client-secret-must-never-leave-server');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('rejects refresh token changes before any database write', async () => {
    const response = await PATCH(request('PATCH', {
      platform: 'threads',
      updates: { refresh_token: 'attacker-controlled-token', enabled: true },
    }));

    expect(response.status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('requires the service-role client configuration before database access', async () => {
    mocks.adminConfigured = false;

    const response = await GET(request('GET'));

    expect(response.status).toBe(503);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('uses the same safe projection for successful PATCH responses', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: SECRET_ROW, error: null });
    const select = vi.fn().mockReturnValue({ maybeSingle });
    const eq = vi.fn().mockReturnValue({ select });
    const update = vi.fn().mockReturnValue({ eq });
    mocks.from.mockReturnValue({ update });

    const response = await PATCH(request('PATCH', {
      platform: 'threads',
      updates: { enabled: false },
    }));
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(200);
    expect(select.mock.calls[0][0]).not.toContain('access_token');
    expect(serialized).not.toContain('access-token-must-never-leave-server');
    expect(serialized).not.toContain('refresh-token-must-never-leave-server');
  });

  it('does not issue an OAuth URL when the state secret is missing', async () => {
    vi.stubEnv('THREADS_APP_ID', 'threads-app');
    vi.stubEnv('OAUTH_STATE_SECRET', '');

    const response = await POST(request('POST', { platform: 'threads' }));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).not.toHaveProperty('oauth_url');
  });
});
