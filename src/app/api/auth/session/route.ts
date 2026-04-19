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

// 로그인 - 토큰을 HttpOnly 쿠키로 저장
export async function POST(request: NextRequest) {
  try {
    const { access_token, refresh_token } = await request.json();
    if (!access_token) {
      return NextResponse.json({ error: 'access_token이 필요합니다.' }, { status: 400 });
    }

    const res = NextResponse.json({ success: true });
    res.cookies.set('sb-access-token', access_token, ACCESS_COOKIE);
    if (refresh_token) {
      res.cookies.set('sb-refresh-token', refresh_token, REFRESH_COOKIE);
    }
    return res;
  } catch {
    return NextResponse.json({ error: '세션 저장 실패' }, { status: 500 });
  }
}

// 로그아웃 - 쿠키 삭제
export async function DELETE() {
  const res = NextResponse.json({ success: true });
  res.cookies.delete('sb-access-token');
  res.cookies.delete('sb-refresh-token');
  return res;
}
