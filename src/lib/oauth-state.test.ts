import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOAuthState, verifyOAuthState } from './oauth-state';

describe('OAuth state signing boundary', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('creates and verifies state with the dedicated secret', () => {
    vi.stubEnv('OAUTH_STATE_SECRET', 'oauth-state-test-secret');
    const state = createOAuthState({ tenant_id: 'tenant-a', ts: Date.now() });

    expect(state).not.toBeNull();
    expect(verifyOAuthState<{ tenant_id: string; ts: number }>(state!, 60_000))
      .toMatchObject({ tenant_id: 'tenant-a' });
  });

  it('fails closed instead of signing with a predictable development key', () => {
    vi.stubEnv('OAUTH_STATE_SECRET', '');

    expect(createOAuthState({ tenant_id: 'tenant-a', ts: Date.now() })).toBeNull();
    expect(verifyOAuthState('payload.signature', 60_000)).toBeNull();
  });

  it('rejects tampered and expired state', () => {
    vi.stubEnv('OAUTH_STATE_SECRET', 'oauth-state-test-secret');
    const state = createOAuthState({ tenant_id: 'tenant-a', ts: Date.now() - 120_000 });

    expect(verifyOAuthState(`${state}tampered`, 60_000)).toBeNull();
    expect(verifyOAuthState(state!, 60_000)).toBeNull();
  });
});
