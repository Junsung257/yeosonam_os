import { NextRequest, NextResponse } from 'next/server';

const IS_SECURE = process.env.NODE_ENV === 'production';

// access token: Supabase JWT 자체는 1시간 만료. 서버 쿠키 수명은 짧게 유지.
const ACCESS_COOKIE = {
  httpOnly: true,
  secure: IS_SECURE,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60, // 1시간
};

// refresh token: 장기 보관. 폰에서 재로그인 없이 쓰기 위함.
const REFRESH_COOKIE = {
  httpOnly: true,
  secure: IS_SECURE,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 365, // 365일
};

function fail(status: number, error: string) {
  const res = NextResponse.json({ error }, { status });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

function isLikelyJwt(token: string): boolean {
  // JWT 기본 형태: xxxxx.yyyyy.zzzzz
  return /^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/.test(token);
}

// 로그인 - 토큰을 HttpOnly 쿠키로 저장
export async function POST(request: NextRequest) {
  try {
    const { access_token, refresh_token } = await request.json();
    if (!access_token || typeof access_token !== 'string' || access_token.length > 6000 || !isLikelyJwt(access_token)) {
      return fail(400, 'access_token이 필요합니다.');
    }
    if (refresh_token !== undefined) {
      if (typeof refresh_token !== 'string' || refresh_token.length < 20 || refresh_token.length > 6000) {
        return fail(400, 'refresh_token 형식이 올바르지 않습니다.');
      }
    }

    const res = NextResponse.json({ success: true });
    res.headers.set('Cache-Control', 'no-store');
    res.cookies.set('sb-access-token', access_token, ACCESS_COOKIE);
    if (refresh_token) {
      res.cookies.set('sb-refresh-token', refresh_token, REFRESH_COOKIE);
    }
    return res;
  } catch {
    return fail(500, '세션 저장 실패');
  }
}

// 로그아웃 - 쿠키 삭제
export async function DELETE() {
  const res = NextResponse.json({ success: true });
  res.headers.set('Cache-Control', 'no-store');
  res.cookies.delete('sb-access-token');
  res.cookies.delete('sb-refresh-token');
  return res;
}
