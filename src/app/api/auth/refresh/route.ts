import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { createSingleFlight } from '@/lib/async-single-flight';
import { getSupabasePublicConfig } from '@/lib/app-config';

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

const singleFlightRefresh = createSingleFlight<string, Response>();

function buildAccessCookie(expiresAt?: number) {
  if (!expiresAt || !Number.isFinite(expiresAt)) return ACCESS_COOKIE;
  const nowSec = Math.floor(Date.now() / 1000);
  const computed = Math.max(60, Math.min(60 * 60, expiresAt - nowSec - 30));
  return { ...ACCESS_COOKIE, maxAge: computed };
}

function fail(status: number, error: string, extra?: Record<string, unknown>) {
  const res = apiResponse({ error, ...(extra || {}) }, { status });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

export async function POST(request: NextRequest) {
  const { url: supabaseUrl, anonKey } = getSupabasePublicConfig();

  if (!supabaseUrl || !anonKey) {
    return fail(500, 'Supabase 설정이 없습니다.');
  }

  const refreshTokenRaw = request.cookies.get('sb-refresh-token')?.value;
  const refreshToken = typeof refreshTokenRaw === 'string' ? refreshTokenRaw.trim() : '';
  if (!refreshToken) {
    return fail(401, 'refresh_token이 없습니다.');
  }
  if (refreshToken.length < 8 || refreshToken.length > 6000) {
    return fail(400, 'refresh_token 형식 오류입니다.');
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
        /* ignore malformed upstream error */
      }
      const desc = (body.error_description || '').toLowerCase();
      const isRotatedRace =
        body.error === 'invalid_grant' &&
        (desc.includes('already used') || desc.includes('already been used'));

      const res = apiResponse(
        {
          error: isRotatedRace ? 'refresh_in_flight' : 'refresh failed',
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
      return fail(502, 'access_token이 누락되었습니다.');
    }

    const res = apiResponse({
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
    return fail(isAbort ? 504 : 500, isAbort ? 'refresh timeout' : 'refresh 처리에 실패했습니다.');
  }
}
