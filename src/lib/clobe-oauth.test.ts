import crypto from 'crypto';
import { describe, expect, it, beforeEach } from 'vitest';
import {
  buildClobeAuthorizationUrl,
  createPkcePair,
  sealClobeOAuthState,
  unsealClobeOAuthState,
  type ClobeOAuthMetadata,
} from './clobe-oauth';

describe('clobe oauth helpers', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_SECRET_KEY = crypto.randomBytes(32).toString('hex');
  });

  it('seals PKCE state without losing callback fields', () => {
    const sealed = sealClobeOAuthState({
      tenant_id: '11111111-1111-4111-8111-111111111111',
      client_id: 'clobe-client',
      code_verifier: 'verifier',
      token_endpoint: 'https://api.clobe.ai/oauth/token',
      resource: 'https://api.clobe.ai/mcp',
      ts: Date.now(),
    });

    expect(sealed).not.toContain('verifier');
    expect(unsealClobeOAuthState(sealed)).toMatchObject({
      tenant_id: '11111111-1111-4111-8111-111111111111',
      client_id: 'clobe-client',
      code_verifier: 'verifier',
    });
  });

  it('builds a PKCE authorization URL for Clobe MCP OAuth', () => {
    const metadata: ClobeOAuthMetadata = {
      issuer: 'https://api.clobe.ai',
      authorization_endpoint: 'https://api.clobe.ai/oauth/authorize',
      token_endpoint: 'https://api.clobe.ai/oauth/token',
      registration_endpoint: 'https://api.clobe.ai/oauth/register',
      scopes_supported: ['mcp', 'offline_access'],
    };
    const pkce = createPkcePair();
    const url = new URL(buildClobeAuthorizationUrl({
      metadata,
      clientId: 'client-id',
      redirectUri: 'https://www.yeosonam.com/api/auth/clobe-callback',
      state: 'state',
      codeChallenge: pkce.codeChallenge,
    }));

    expect(url.origin + url.pathname).toBe('https://api.clobe.ai/oauth/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('mcp offline_access');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('resource')).toBe('https://api.clobe.ai/mcp');
  });
});
