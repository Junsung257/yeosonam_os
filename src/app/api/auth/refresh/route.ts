import { NextRequest, NextResponse } from 'next/server';
import { createSingleFlight } from '@/lib/async-single-flight';

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

const singleFlightRefresh = createSingleFlight<string, Response>();

function buildAccessCookie(expiresAt?: number) {
  if (!expiresAt || !Number.isFinite(expiresAt)) return ACCESS_COOKIE;
  const nowSec = Math.floor(Date.now() / 1000);
  // 네트워크/클럭 오차를 감안해 30초 여유를 둔다.
  const computed = Math.max(60, Math.min(60 * 60, expiresAt - nowSec - 30));
  return { ...ACCESS_COOKIE, maxAge: computed };
}

function fail(status: number, error: string, extra?: Record<string, unknown>) {
  const res = NextResponse.json({ error, ...(extra || {}) }, { status });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

// refresh token 쿠키로 Supabase에 새 access token 발급 요청 → 쿠키 재설정
// Supabase JS SDK를 경유하지 않고 REST Auth 엔드포인트를 직접 호출하여
// HttpOnly 쿠키 체계를 그대로 유지한다.
export async function POST(request: NextRequest) {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    return fail(500, 'Supabase 설정 없음');
  }

  const refreshTokenRaw = request.cookies.get('sb-refresh-token')?.value;
  const refreshToken = typeof refreshTokenRaw === 'string' ? refreshTokenRaw.trim() : '';
  if (!refreshToken) {
    return fail(401, 'refresh_token 없음');
  }
  // Supabase refresh token은 충분히 긴 난수 문자열이다.
  if (refreshToken.length < 20 || refreshToken.length > 6000) {
    return fail(400, 'refresh_token 형식 오류');
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let upstream: Response;
    try {
      upstream = await singleFlightRefresh(refreshToken, async () =>
        fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: anonKey,
          },
          body: JSON.stringify({ refresh_token: refreshToken }),
          signal: controller.signal,
        }),
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!upstream.ok) {
      let body: { error?: string; error_description?: string } = {};
      try {
        body = (await upstream.clone().json()) as typeof body;
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
      res.headers.set('Cache-Control', 'no-store');
      if (!isRotatedRace) {
        res.cookies.delete('sb-access-token');
        res.cookies.delete('sb-refresh-token');
      }
      return res;
    }

    const payload = (await upstream.clone().json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_at?: number;
    };

    if (!payload.access_token) {
      return fail(502, 'access_token 누락');
    }

    const res = NextResponse.json({
      success: true,
      expires_at: payload.expires_at,
    });
    res.headers.set('Cache-Control', 'no-store');
    res.cookies.set('sb-access-token', payload.access_token, buildAccessCookie(payload.expires_at));
    if (payload.refresh_token) {
      res.cookies.set('sb-refresh-token', payload.refresh_token, REFRESH_COOKIE);
    }
    return res;
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    // 외부 Auth API 타임아웃/예외 메시지를 그대로 노출하지 않음.
    return fail(isAbort ? 504 : 500, isAbort ? 'refresh timeout' : 'refresh 처리 실패');
  }
}
