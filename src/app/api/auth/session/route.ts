import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';

const IS_SECURE = process.env.NODE_ENV === 'production';

const ACCESS_COOKIE = {
  httpOnly: true,
  secure: IS_SECURE,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60,
};

const REFRESH_COOKIE = {
  httpOnly: true,
  secure: IS_SECURE,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 365,
};

const REFRESH_MARKER_COOKIE = {
  httpOnly: false,
  secure: IS_SECURE,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 365,
};

function fail(status: number, error: string) {
  const res = apiResponse({ error }, { status });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

function isLikelyJwt(token: string): boolean {
  return /^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/.test(token);
}

export async function POST(request: NextRequest) {
  try {
    const { access_token, refresh_token } = await request.json();
    if (!access_token || typeof access_token !== 'string' || access_token.length > 6000 || !isLikelyJwt(access_token)) {
      return fail(400, 'access_token은 필수입니다.');
    }
    if (refresh_token !== undefined) {
      if (typeof refresh_token !== 'string' || refresh_token.length < 8 || refresh_token.length > 6000) {
        return fail(400, 'refresh_token 형식이 올바르지 않습니다.');
      }
    }

    const res = apiResponse({ success: true });
    res.headers.set('Cache-Control', 'no-store');
    res.cookies.set('sb-access-token', access_token, ACCESS_COOKIE);
    if (refresh_token) {
      res.cookies.set('sb-refresh-token', refresh_token, REFRESH_COOKIE);
      res.cookies.set('sb-refresh-token-present', '1', REFRESH_MARKER_COOKIE);
    } else {
      res.cookies.delete('sb-refresh-token-present');
    }
    return res;
  } catch {
    return fail(500, '세션 저장에 실패했습니다.');
  }
}

export async function DELETE() {
  const res = apiResponse({ success: true });
  res.headers.set('Cache-Control', 'no-store');
  res.cookies.delete('sb-access-token');
  res.cookies.delete('sb-refresh-token');
  res.cookies.delete('sb-refresh-token-present');
  return res;
}
