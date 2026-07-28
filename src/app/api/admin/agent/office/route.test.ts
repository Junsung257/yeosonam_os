import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const supabaseMocks = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: false,
  supabaseAdmin: {
    from: supabaseMocks.from,
  },
}));

import { dynamic, GET } from './route';

function request(admin = false): NextRequest {
  return new NextRequest('http://localhost/api/admin/agent/office', {
    headers: admin ? { cookie: 'ys-dev-admin=1' } : undefined,
  });
}

function expectPrivateNoStore(response: Response): void {
  const cacheControl = response.headers.get('cache-control') ?? '';
  expect(cacheControl).toContain('private');
  expect(cacheControl).toContain('no-store');
}

describe('/api/admin/agent/office authorization', () => {
  beforeEach(() => {
    supabaseMocks.from.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects unauthenticated requests before DB access', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ code: 'UNAUTHORIZED' });
    expectPrivateNoStore(response);
    expect(supabaseMocks.from).not.toHaveBeenCalled();
  });

  it('returns an empty private snapshot when Supabase is unavailable', async () => {
    vi.stubEnv('NODE_ENV', 'test');

    const response = await GET(request(true));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(dynamic).toBe('force-dynamic');
    expectPrivateNoStore(response);
    expect(supabaseMocks.from).not.toHaveBeenCalled();
    expect(body).toMatchObject({
      sourceCounts: {
        tasks: 0,
        approvals: 0,
        incidents: 0,
        traces: 0,
      },
      sourceIssues: ['Supabase 미설정으로 운영 원장을 읽을 수 없습니다.'],
    });
  });
});
