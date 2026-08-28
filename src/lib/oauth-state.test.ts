import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const ADMIN_ACTOR = '11111111-1111-4111-8111-111111111111';
const TENANT_ID = '22222222-2222-4222-8222-222222222222';

const mocks = vi.hoisted(() => {
  const query = {
    update: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    gt: vi.fn(),
    select: vi.fn(),
    maybeSingle: vi.fn(),
  };
  for (const method of ['update', 'eq', 'is', 'gt', 'select'] as const) {
    query[method].mockReturnValue(query);
  }
  return { query, getSupabaseAdmin: vi.fn() };
});

const { query, getSupabaseAdmin } = mocks;
vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: mocks.getSupabaseAdmin }));

import {
  OAUTH_STATE_TTL_MS,
  consumeOAuthState,
  createOAuthState,
  verifyOAuthState,
} from '@/lib/oauth-state';

describe('OAuth state contract', () => {
  beforeEach(() => {
    vi.stubEnv('OAUTH_STATE_SECRET', 'test-only-secret-with-enough-entropy');
    getSupabaseAdmin.mockReset();
    query.eq.mockClear();
    query.update.mockClear();
    query.is.mockClear();
    query.gt.mockClear();
    query.select.mockClear();
    query.maybeSingle.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('fails closed when the signing secret is missing', () => {
    vi.stubEnv('OAUTH_STATE_SECRET', '');
    expect(() => createOAuthState({ provider: 'google', tenantId: TENANT_ID })).toThrow(
      'OAUTH_STATE_SECRET is not configured',
    );
  });

  it('binds provider, scope, tenant and a full-length HMAC signature', () => {
    const now = 1_750_000_000_000;
    const state = createOAuthState({ provider: 'google', tenantId: TENANT_ID, now });
    const [payload, signature] = state.split('.');

    expect(payload).toBeTruthy();
    expect(signature).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(signature).not.toBe('dev');
    expect(verifyOAuthState(state, 'google', now)).toMatchObject({
      provider: 'google',
      scope: 'tenant',
      tenant_id: TENANT_ID,
    });
    expect(verifyOAuthState(state, 'meta', now)).toBeNull();
  });

  it('rejects expired and more-than-one-minute future states', () => {
    const now = 1_750_000_000_000;
    const expired = createOAuthState({
      provider: 'google',
      tenantId: TENANT_ID,
      now: now - OAUTH_STATE_TTL_MS - 1,
    });
    const future = createOAuthState({
      provider: 'google',
      tenantId: TENANT_ID,
      now: now + 60_001,
    });

    expect(verifyOAuthState(expired, 'google', now)).toBeNull();
    expect(verifyOAuthState(future, 'google', now)).toBeNull();
  });

  it('consumes only an unconsumed state for the initiating actor', async () => {
    const now = 1_750_000_000_000;
    const state = createOAuthState({ provider: 'google', tenantId: TENANT_ID, now });
    query.maybeSingle.mockResolvedValue({ data: { state_hash: 'hash' }, error: null });
    getSupabaseAdmin.mockReturnValue({ from: vi.fn().mockReturnValue(query) });

    const result = await consumeOAuthState(state, 'google', now, ADMIN_ACTOR);

    expect(result?.tenant_id).toBe(TENANT_ID);
    expect(query.eq).toHaveBeenCalledWith('actor_user_id', ADMIN_ACTOR);
    expect(query.is).toHaveBeenCalledWith('consumed_at', null);
    expect(query.gt).toHaveBeenCalledWith('expires_at', new Date(now).toISOString());
  });
});
