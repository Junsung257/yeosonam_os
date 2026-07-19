import {
  exportJWK,
  generateKeyPair,
  SignJWT,
  createLocalJWKSet,
  type JWK,
  type KeyLike,
} from 'jose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createRemoteJWKSet: vi.fn(),
}));

vi.mock('jose', async (importOriginal) => ({
  ...(await importOriginal<typeof import('jose')>()),
  createRemoteJWKSet: mocks.createRemoteJWKSet,
}));

import { verifySupabaseAccessToken } from '@/lib/supabase-jwt-verify';

const PROJECT_ORIGIN = 'https://project-ref.supabase.co';
const PROJECT_ISSUER = `${PROJECT_ORIGIN}/auth/v1`;
const ATTACKER_ISSUER = 'https://attacker.example/auth/v1';
const USER_ID = '00000000-0000-4000-8000-0000000000aa';
const LEGACY_SECRET = 'legacy-secret-that-is-long-enough-for-tests';

let projectPrivateKey: KeyLike;
let attackerPrivateKey: KeyLike;
let projectJwk: JWK;
let attackerJwk: JWK;

function esToken(privateKey: KeyLike, issuer: string, audience = 'authenticated') {
  return new SignJWT({ role: 'authenticated', email: 'staff@example.com' })
    .setProtectedHeader({ alg: 'ES256', kid: issuer === PROJECT_ISSUER ? 'project-key' : 'attacker-key' })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(USER_ID)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
}

function hsToken(issuer = PROJECT_ISSUER, audience = 'authenticated') {
  return new SignJWT({ role: 'authenticated', email: 'staff@example.com' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(USER_ID)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(LEGACY_SECRET));
}

describe('verifySupabaseAccessToken', () => {
  beforeAll(async () => {
    const projectKeys = await generateKeyPair('ES256');
    const attackerKeys = await generateKeyPair('ES256');
    projectPrivateKey = projectKeys.privateKey;
    attackerPrivateKey = attackerKeys.privateKey;
    projectJwk = {
      ...(await exportJWK(projectKeys.publicKey)),
      alg: 'ES256',
      kid: 'project-key',
      use: 'sig',
    };
    attackerJwk = {
      ...(await exportJWK(attackerKeys.publicKey)),
      alg: 'ES256',
      kid: 'attacker-key',
      use: 'sig',
    };

    mocks.createRemoteJWKSet.mockImplementation((input: URL) => {
      const url = String(input);
      const keys = url.startsWith(ATTACKER_ISSUER) ? [attackerJwk] : [projectJwk];
      return createLocalJWKSet({ keys });
    });
  });

  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', PROJECT_ORIGIN);
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_JWT_SECRET', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(() => vi.restoreAllMocks());

  it('accepts a normally signed project token with the expected issuer and audience', async () => {
    const token = await esToken(projectPrivateKey, PROJECT_ISSUER);

    await expect(verifySupabaseAccessToken(token)).resolves.toMatchObject({
      ok: true,
      payload: { iss: PROJECT_ISSUER, aud: 'authenticated', sub: USER_ID },
    });
    expect(mocks.createRemoteJWKSet).toHaveBeenCalledWith(
      new URL(`${PROJECT_ISSUER}/.well-known/jwks.json`),
    );
  });

  it('never follows an unverified token issuer to attacker-controlled JWKS', async () => {
    const token = await esToken(attackerPrivateKey, ATTACKER_ISSUER);

    await expect(verifySupabaseAccessToken(token)).resolves.toEqual({ ok: false });
    expect(mocks.createRemoteJWKSet.mock.calls.map(([input]) => String(input)))
      .not.toContain(`${ATTACKER_ISSUER}/.well-known/jwks.json`);
  });

  it('rejects a project-signed token for the wrong audience', async () => {
    const token = await esToken(projectPrivateKey, PROJECT_ISSUER, 'anon');

    await expect(verifySupabaseAccessToken(token)).resolves.toEqual({ ok: false });
  });

  it('accepts a valid legacy token only with the configured issuer and audience', async () => {
    vi.stubEnv('SUPABASE_JWT_SECRET', LEGACY_SECRET);

    await expect(verifySupabaseAccessToken(await hsToken())).resolves.toMatchObject({
      ok: true,
      payload: { iss: PROJECT_ISSUER, aud: 'authenticated', sub: USER_ID },
    });
    await expect(verifySupabaseAccessToken(await hsToken(ATTACKER_ISSUER)))
      .resolves.toEqual({ ok: false });
    await expect(verifySupabaseAccessToken(await hsToken(PROJECT_ISSUER, 'anon')))
      .resolves.toEqual({ ok: false });
  });

  it('rejects expired legacy access tokens', async () => {
    vi.stubEnv('SUPABASE_JWT_SECRET', LEGACY_SECRET);
    const token = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(PROJECT_ISSUER)
      .setAudience('authenticated')
      .setSubject(USER_ID)
      .setIssuedAt()
      .setExpirationTime('-1s')
      .sign(new TextEncoder().encode(LEGACY_SECRET));

    await expect(verifySupabaseAccessToken(token)).resolves.toEqual({ ok: false });
  });

  it('rejects access tokens without the authenticated role', async () => {
    vi.stubEnv('SUPABASE_JWT_SECRET', LEGACY_SECRET);
    const token = await new SignJWT({ role: 'anon' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(PROJECT_ISSUER)
      .setAudience('authenticated')
      .setSubject(USER_ID)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(LEGACY_SECRET));

    await expect(verifySupabaseAccessToken(token)).resolves.toEqual({ ok: false });
  });

  it('rejects access tokens whose subject is not a user UUID', async () => {
    vi.stubEnv('SUPABASE_JWT_SECRET', LEGACY_SECRET);
    const token = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(PROJECT_ISSUER)
      .setAudience('authenticated')
      .setSubject('not-a-user-id')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(LEGACY_SECRET));

    await expect(verifySupabaseAccessToken(token)).resolves.toEqual({ ok: false });
  });
  it('rejects an otherwise valid token that uses an unsupported algorithm', async () => {
    vi.stubEnv('SUPABASE_JWT_SECRET', LEGACY_SECRET);
    const token = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS384' })
      .setIssuer(PROJECT_ISSUER)
      .setAudience('authenticated')
      .setSubject(USER_ID)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(LEGACY_SECRET));

    await expect(verifySupabaseAccessToken(token)).resolves.toEqual({ ok: false });
  });
});
