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

vi.mock('@/lib/itinerary-entity-resolution-engine', () => ({
  resolveItineraryEntityCandidate: vi.fn(),
}));

vi.mock('@/lib/google-places-entity-verifier', () => ({
  getGooglePlacesBudgetFromEnv: vi.fn(),
}));

vi.mock('@/lib/package-reenrich-on-attraction-change', () => ({
  reEnrichAffectedPackages: vi.fn(),
}));

import { dynamic, GET, PATCH } from './route';

function request(method: 'GET' | 'PATCH', admin = false): NextRequest {
  return new NextRequest('http://localhost/api/admin/entity-master-candidates', {
    method,
    headers: admin ? { cookie: 'ys-dev-admin=1' } : undefined,
  });
}

function expectPrivateNoStore(response: Response): void {
  const cacheControl = response.headers.get('cache-control') ?? '';
  expect(cacheControl).toContain('private');
  expect(cacheControl).toContain('no-store');
}

describe('/api/admin/entity-master-candidates authorization', () => {
  beforeEach(() => {
    supabaseMocks.from.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ['GET', GET],
    ['PATCH', PATCH],
  ] as const)('rejects unauthenticated %s before handler or DB access', async (method, handler) => {
    vi.stubEnv('NODE_ENV', 'production');

    const response = await handler(request(method));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ code: 'UNAUTHORIZED' });
    expectPrivateNoStore(response);
    expect(supabaseMocks.from).not.toHaveBeenCalled();
  });

  it('marks authenticated handler responses private and non-cacheable', async () => {
    vi.stubEnv('NODE_ENV', 'test');

    const getResponse = await GET(request('GET', true));
    const patchResponse = await PATCH(request('PATCH', true));

    expect(getResponse.status).toBe(200);
    expect(patchResponse.status).toBe(500);
    expect(dynamic).toBe('force-dynamic');
    expectPrivateNoStore(getResponse);
    expectPrivateNoStore(patchResponse);
  });
});
