/**
 * 개발 전용: 쿠키·JWT 검증 상태 요약 (비밀 값·전체 토큰 미노출).
 */
import { verifySupabaseAccessToken } from '@/lib/supabase-jwt-verify';

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const pad = '==='.slice((b64.length + 3) % 4);
    const json = JSON.parse(atob(b64 + pad));
    return typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function refFromSupabaseUrl(): string | null {
  const u = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const m = u.match(/https?:\/\/([a-z0-9-]+)\.supabase\.co/i);
  return m ? m[1].toLowerCase() : null;
}

export type AuthSessionDebugReport = {
  runtime: 'nodejs' | 'edge';
  env: {
    NEXT_PUBLIC_SUPABASE_URL_host: string | null;
    jwt_secret_configured: boolean;
    jwt_secret_length: number;
  };
  cookies: {
    has_sb_access_token: boolean;
    has_sb_refresh_token: boolean;
    access_token_preview: string | null;
  };
  token_payload: {
    ref: string | null;
    exp: number | null;
    exp_ok: boolean | null;
    sub: string | null;
  };
  alignment: {
    url_project_ref: string | null;
    token_ref_matches_url: boolean | null;
  };
  verify: {
    ok: boolean | null;
    note: string;
  };
};

export async function getAuthSessionDebugReport(
  accessToken: string | undefined,
  refreshToken: string | undefined,
  runtime: AuthSessionDebugReport['runtime'],
): Promise<AuthSessionDebugReport> {
  const secret = process.env.SUPABASE_JWT_SECRET;
  const trimmed = typeof secret === 'string' ? secret.trim() : '';
  const urlHost = refFromSupabaseUrl();
  const decoded = accessToken ? decodeJwtPayload(accessToken) : null;
  const ref = decoded && typeof decoded.ref === 'string' ? decoded.ref : null;
  const sub = decoded && typeof decoded.sub === 'string' ? decoded.sub : null;
  const exp = decoded && typeof decoded.exp === 'number' ? decoded.exp : null;
  const expOk = exp != null ? exp > Date.now() / 1000 : null;

  let verifyOk: boolean | null = null;
  let verifyNote = '';
  if (!accessToken) {
    verifyNote = '액세스 토큰 쿠키 없음 — 로그인 직후가 아니면 refresh 로 갱신 필요';
  } else {
    const v = await verifySupabaseAccessToken(accessToken);
    verifyOk = v.ok;
    verifyNote = v.ok
      ? 'verifySupabaseAccessToken 통과 (미들웨어와 동일 로직)'
      : 'verifySupabaseAccessToken 실패 — 시크릿 불일치·만료·손상 토큰 가능';
  }

  const tokenRefLower = ref?.toLowerCase() ?? null;
  const urlRefLower = urlHost;
  const refMatches =
    tokenRefLower != null && urlRefLower != null ? tokenRefLower === urlRefLower : null;

  return {
    runtime,
    env: {
      NEXT_PUBLIC_SUPABASE_URL_host: urlHost,
      jwt_secret_configured: trimmed.length > 0,
      jwt_secret_length: trimmed.length,
    },
    cookies: {
      has_sb_access_token: Boolean(accessToken),
      has_sb_refresh_token: Boolean(refreshToken),
      access_token_preview: accessToken ? `${accessToken.slice(0, 12)}…` : null,
    },
    token_payload: {
      ref: ref,
      exp,
      exp_ok: expOk,
      sub,
    },
    alignment: {
      url_project_ref: urlHost,
      token_ref_matches_url: refMatches,
    },
    verify: {
      ok: verifyOk,
      note: verifyNote,
    },
  };
}
