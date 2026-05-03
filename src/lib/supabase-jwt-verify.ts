/**
 * Supabase access_token(JWT) 검증 — 미들웨어·어드민 가드에서 공통 사용.
 *
 * - 신규 JWT Signing Keys(ECC P-256 등): 액세스 토큰이 ES256 → 프로젝트 JWKS 로 검증.
 * - 레거시: HS256 + SUPABASE_JWT_SECRET(Legacy JWT secret 문자열).
 *
 * Legacy secret 은 Key ID / ECC 공개키 / anon 키가 아니라, 대시보드에서 reveal 한 공유 비밀 한 덩어리다.
 */
import * as jose from 'jose';

function supabaseOrigin(): string | null {
  const u = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  if (!u || !/^https?:\/\//.test(u)) return null;
  return u.replace(/\/$/, '');
}

/**
 * iss 당 JWKS 한 번만 생성 (Supabase 권장: project…/auth/v1 + /.well-known/jwks.json)
 * @see https://supabase.com/docs/guides/auth/jwts
 */
const jwksByIssuer = new Map<string, jose.JWTVerifyGetKey>();

function getJwksForIssuer(iss: string): jose.JWTVerifyGetKey {
  let jwks = jwksByIssuer.get(iss);
  if (!jwks) {
    const base = iss.replace(/\/$/, '');
    jwks = jose.createRemoteJWKSet(new URL(`${base}/.well-known/jwks.json`));
    jwksByIssuer.set(iss, jwks);
  }
  return jwks;
}

/** 토큰 payload 의 iss 우선, 없으면 env 로 auth/v1 issuer 조합 */
function resolveIssuer(token: string): string | null {
  try {
    const { iss } = jose.decodeJwt(token) as { iss?: string };
    if (typeof iss === 'string' && /^https:\/\//i.test(iss)) return iss;
  } catch {
    /* fall through */
  }
  const origin = supabaseOrigin();
  return origin ? `${origin}/auth/v1` : null;
}

function base64UrlToJson(token: string): Record<string, unknown> | null {
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

/** 개발 전용: 서명 없이 exp 만 확인 */
export function legacyJwtExpValid(token: string): boolean {
  const p = base64UrlToJson(token);
  if (!p || typeof p.exp !== 'number') return false;
  return p.exp > Date.now() / 1000;
}

export async function verifySupabaseAccessToken(
  token: string
): Promise<{ ok: true; payload: jose.JWTPayload } | { ok: false }> {
  let alg: string | undefined;
  try {
    alg = jose.decodeProtectedHeader(token).alg;
  } catch {
    return { ok: false };
  }

  // ── ES256 / RS256 (JWT Signing Keys — ECC·RSA 등) ───────────────────────
  // 공개키는 SUPABASE_JWT_SECRET 이 아니라 JWKS. issuer 는 토큰 iss 와 일치해야 함.
  if (alg === 'ES256' || alg === 'RS256') {
    const iss = resolveIssuer(token);
    if (!iss) return { ok: false };
    const jwks = getJwksForIssuer(iss);
    try {
      const { payload } = await jose.jwtVerify(token, jwks, {
        algorithms: ['ES256', 'RS256'],
        issuer: iss,
      });
      return { ok: true, payload };
    } catch {
      return { ok: false };
    }
  }

  // ── HS256 (Legacy JWT secret) ─────────────────────────────────
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret?.trim()) {
    if (process.env.NODE_ENV === 'production') {
      return { ok: false };
    }
    if (!legacyJwtExpValid(token)) return { ok: false };
    const raw = base64UrlToJson(token);
    return { ok: true, payload: (raw ?? {}) as jose.JWTPayload };
  }
  try {
    const { payload } = await jose.jwtVerify(
      token,
      new TextEncoder().encode(secret.trim()),
      { algorithms: ['HS256'] },
    );
    return { ok: true, payload };
  } catch {
    if (process.env.NODE_ENV !== 'production' && legacyJwtExpValid(token)) {
      const raw = base64UrlToJson(token);
      if (!(globalThis as unknown as { __ysJwtDevWarn?: boolean }).__ysJwtDevWarn) {
        (globalThis as unknown as { __ysJwtDevWarn?: boolean }).__ysJwtDevWarn = true;
        console.warn(
          '[supabase-jwt-verify] HS256 검증 실패 후 개발 폴백(exp만 확인). ' +
            '토큰이 ES256이면 JWKS 경로를 쓰는지·Legacy secret 은 reveal 한 문자열인지 확인하세요.',
        );
      }
      return { ok: true, payload: (raw ?? {}) as jose.JWTPayload };
    }
    return { ok: false };
  }
}
