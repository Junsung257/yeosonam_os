import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireAdminRequest, resolveAdminActorLabel } from '@/lib/admin-guard';

const PROJECT_ISSUER = 'https://project-ref.supabase.co/auth/v1';
const LEGACY_SECRET = 'legacy-secret-that-is-long-enough-for-tests';
const USER_ID = '00000000-0000-4000-8000-0000000000aa';

async function adminAccessToken() {
  return new SignJWT({ role: 'authenticated', email: 'admin@yeosonam.com' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(PROJECT_ISSUER)
    .setAudience('authenticated')
    .setSubject(USER_ID)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(LEGACY_SECRET));
}

describe('pinned Supabase JWT caller regression', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project-ref.supabase.co');
    vi.stubEnv('SUPABASE_JWT_SECRET', LEGACY_SECRET);
    vi.stubEnv('ADMIN_EMAILS', 'admin@yeosonam.com');
  });

  afterEach(() => vi.unstubAllEnvs());

  it('keeps the admin guard compatible with a normally signed project access token', async () => {
    const token = await adminAccessToken();
    const request = new NextRequest('https://www.yeosonam.com/api/admin/session', {
      headers: { cookie: `sb-access-token=${token}` },
    });

    await expect(requireAdminRequest(request)).resolves.toBeNull();
  });

  it('keeps admin actor resolution compatible with the pinned verifier', async () => {
    const token = await adminAccessToken();
    const request = new NextRequest('https://www.yeosonam.com/api/admin/session', {
      headers: { cookie: `sb-access-token=${token}` },
    });

    await expect(resolveAdminActorLabel(request)).resolves.toBe('admin@yeosonam.com');
  });
});
