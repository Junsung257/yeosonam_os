import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  from: vi.fn(),
  eq: vi.fn(),
  queryError: null as { code?: string; message: string } | null,
  loadPackage: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabaseAdmin: { from: mocks.from },
}));

vi.mock('@/lib/affiliate/jwt-or-pin-auth', () => ({ authInfluencer: mocks.auth }));
vi.mock('@/lib/content-public-package', () => ({
  loadPublicContentPackageForGeneration: mocks.loadPackage,
}));

import { GET, POST } from './route';

function request(code = 'OWNER') {
  return new NextRequest(`http://localhost/api/influencer/content?code=${code}`);
}

function postRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/influencer/content', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost',
    },
    body: JSON.stringify(body),
  });
}

describe('GET /api/influencer/content', () => {
  beforeEach(() => {
    mocks.auth.mockReset();
    mocks.from.mockReset();
    mocks.eq.mockReset();
    mocks.queryError = null;
    mocks.loadPackage.mockReset();

    const limit = vi.fn(async () => ({
      data: [{ id: 'content-1', affiliate_id: 'affiliate-owner' }],
      error: mocks.queryError,
    }));
    const order = vi.fn(() => ({ limit }));
    mocks.eq.mockReturnValue({ order });
    mocks.from.mockReturnValue({
      select: vi.fn(() => ({ eq: mocks.eq })),
    });
  });

  it('returns 401 before querying content for an unauthenticated caller', async () => {
    mocks.auth.mockResolvedValue({ ok: false, error: 'PIN이 필요합니다.', status: 401 });
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('returns 403 before querying content for a cross-tenant caller', async () => {
    mocks.auth.mockResolvedValue({ ok: false, error: '다른 파트너의 데이터에는 접근할 수 없습니다.', status: 403 });
    const response = await GET(request('OTHER'));
    expect(response.status).toBe(403);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('queries only the authenticated affiliate content', async () => {
    mocks.auth.mockResolvedValue({
      ok: true,
      affiliate: { id: 'affiliate-owner', referral_code: 'OWNER' },
    });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(mocks.eq).toHaveBeenCalledWith('affiliate_id', 'affiliate-owner');
    expect(await response.json()).toEqual({
      contents: [{ id: 'content-1', affiliate_id: 'affiliate-owner' }],
    });
  });

  it('does not expose raw database failures', async () => {
    mocks.auth.mockResolvedValue({
      ok: true,
      affiliate: { id: 'affiliate-owner', referral_code: 'OWNER' },
    });
    mocks.queryError = { code: '42P01', message: 'relation public.secret_table does not exist' };

    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: '콘텐츠 조회에 실패했습니다.' });
  });
});
