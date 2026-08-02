import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabaseAdmin: {
    from: mocks.from,
  },
}));

import { PATCH, POST } from './route';

const props = {
  params: Promise.resolve({ city: encodeURIComponent('괌') }),
};

describe('/api/destinations/[city] mutation authorization', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it.each([
    ['PATCH', PATCH],
    ['POST', POST],
  ] as const)('rejects unauthenticated %s before resolving or writing metadata', async (method, handler) => {
    vi.stubEnv('NODE_ENV', 'production');
    const request = new NextRequest('http://localhost/api/destinations/guam', {
      method,
      headers: method === 'PATCH' ? { 'content-type': 'application/json' } : undefined,
      body: method === 'PATCH' ? JSON.stringify({ photo_approved: true }) : undefined,
    });

    const response = await handler(request, props);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ code: 'UNAUTHORIZED' });
    expect(response.headers.get('cache-control')).toContain('private');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
