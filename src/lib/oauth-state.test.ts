import { createHmac } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createOAuthState,
  OAuthStateConfigurationError,
  verifyOAuthState,
} from './oauth-state';

const NOW = Date.UTC(2026, 6, 23, 0, 0, 0);
const SECRET = 'test-oauth-state-secret-with-at-least-32-characters';

describe('OAuth state', () => {
  beforeEach(() => {
    vi.stubEnv('OAUTH_STATE_SECRET', SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('round-trips a valid provider-bound state with a full SHA-256 HMAC', () => {
    const state = createOAuthState({ tenantId: 'tenant-1', provider: 'google', now: NOW });
    const [, signature] = state.split('.');

    expect(Buffer.from(signature, 'base64url')).toHaveLength(32);
    expect(verifyOAuthState(state, 'google', { now: NOW })).toMatchObject({
      tenant_id: 'tenant-1',
      provider: 'google',
      ts: NOW,
    });
  });

  it('rejects tampering, provider confusion, expiration, and far-future timestamps', () => {
    const state = createOAuthState({ tenantId: 'tenant-1', provider: 'meta', now: NOW });
    const [payload, signature] = state.split('.');

    expect(verifyOAuthState(`${payload}x.${signature}`, 'meta', { now: NOW })).toBeNull();
    expect(verifyOAuthState(state, 'google', { now: NOW })).toBeNull();
    expect(verifyOAuthState(state, 'meta', { now: NOW + 10 * 60 * 1000 + 1 })).toBeNull();

    const futureState = createOAuthState({ tenantId: 'tenant-1', provider: 'meta', now: NOW + 30_001 });
    expect(verifyOAuthState(futureState, 'meta', { now: NOW })).toBeNull();
  });

  it('fails closed when OAUTH_STATE_SECRET is missing, including a state forged with the former dev key', () => {
    vi.stubEnv('OAUTH_STATE_SECRET', '');
    const encoded = Buffer.from(JSON.stringify({
      tenant_id: 'attacker-tenant',
      provider: 'google',
      nonce: 'attacker-controlled-nonce',
      ts: NOW,
    })).toString('base64url');
    const forgedSignature = createHmac('sha256', 'dev').update(encoded).digest('base64url');

    expect(() => createOAuthState({ tenantId: 'tenant-1', provider: 'google', now: NOW }))
      .toThrow(OAuthStateConfigurationError);
    expect(() => verifyOAuthState(`${encoded}.${forgedSignature}`, 'google', { now: NOW }))
      .toThrow(OAuthStateConfigurationError);
  });
});
