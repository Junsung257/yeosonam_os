import { NextRequest, NextResponse } from 'next/server';

const IS_SECURE = process.env.NODE_ENV === 'production';

const ACCESS_COOKIE = {
  httpOnly: true,
  secure: IS_SECURE,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60, // 1시간
};

const REFRESH_COOKIE = {
  httpOnly: true,
  secure: IS_SECURE,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 365, // 365일
};

// refresh token 쿠키로 Supabase에 새 access token 발급 요청 → 쿠키 재설정
// Supabase JS SDK를 경유하지 않고 REST Auth 엔드포인트를 직접 호출하여
// HttpOnly 쿠키 체계를 그대로 유지한다.
export async function POST(request: NextRequest) {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    return NextResponse.json({ error: 'Supabase 설정 없음' }, { status: 500 });
  }

  const refreshToken = request.cookies.get('sb-refresh-token')?.value;
  if (!refreshToken) {
    return NextResponse.json({ error: 'refresh_token 없음' }, { status: 401 });
  }

  try {
    const upstream = await fetch(
      `${supabaseUrl}/auth/v1/token?grant_type=refresh_token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: anonKey,
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
      },
    );

    if (!upstream.ok) {
      let body: { error?: string; error_description?: string } = {};
      try {
        body = (await upstream.json()) as typeof body;
      } catch {
        /* ignore */
      }
      const desc = (body.error_description || '').toLowerCase();
      const isRotatedRace =
        body.error === 'invalid_grant' &&
        (desc.includes('already used') || desc.includes('already been used'));

      const res = NextResponse.json(
        {
          error: isRotatedRace ? 'refresh_in_flight' : 'refresh 실패',
          status: upstream.status,
        },
        { status: isRotatedRace ? 409 : 401 },
      );
      // 동시 refresh 로 이미 다른 요청이 토큰을 회전시킨 경우 쿠키를 지우면 갱신 성공분까지 날아간다.
      if (!isRotatedRace) {
        res.cookies.delete('sb-access-token');
        res.cookies.delete('sb-refresh-token');
      }
      return res;
    }

    const payload = (await upstream.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_at?: number;
    };

    if (!payload.access_token) {
      return NextResponse.json({ error: 'access_token 누락' }, { status: 502 });
    }

    const res = NextResponse.json({
      success: true,
      expires_at: payload.expires_at,
    });
    res.cookies.set('sb-access-token', payload.access_token, ACCESS_COOKIE);
    if (payload.refresh_token) {
      res.cookies.set('sb-refresh-token', payload.refresh_token, REFRESH_COOKIE);
    }
    return res;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '처리 실패' },
      { status: 500 },
    );
  }
}
