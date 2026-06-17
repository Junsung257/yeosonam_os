import { apiResponse } from '@/lib/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  if (process.env.NODE_ENV === 'production') {
    return apiResponse({ error: 'Not found' }, { status: 404 });
  }

  const response = apiResponse(
    {
      ok: true,
      user: {
        id: 'dev-admin',
        email: 'dev-admin@localhost',
        role: 'platform_admin',
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );

  response.cookies.set('ys-dev-admin', '1', {
    path: '/',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24,
  });
  response.cookies.set('sb-access-token', '', {
    path: '/',
    maxAge: 0,
  });
  response.cookies.set('sb-admin', '', {
    path: '/',
    maxAge: 0,
  });
  response.cookies.set('sb-refresh-token-present', '', {
    path: '/',
    maxAge: 0,
  });

  return response;
}
