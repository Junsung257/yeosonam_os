import { NextRequest, NextResponse } from 'next/server';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 7, // 7일
};

// 로그인 - 토큰을 HttpOnly 쿠키로 저장
export async function POST(request: NextRequest) {
  try {
    const { access_token, refresh_token } = await request.json();
    if (!access_token) {
      return NextResponse.json({ error: 'access_token이 필요합니다.' }, { status: 400 });
    }

    const res = NextResponse.json({ success: true });
    res.cookies.set('sb-access-token', access_token, COOKIE_OPTIONS);
    if (refresh_token) {
      res.cookies.set('sb-refresh-token', refresh_token, COOKIE_OPTIONS);
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
