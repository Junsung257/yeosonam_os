/**
 * Supabase access_token(JWT) 검증 — 미들웨어·어드민 가드에서 공통 사용.
 *
 * - 신규 JWT Signing Keys(ECC P-256 등): 액세스 토큰이 ES256 → 프로젝트 JWKS 로 검증.
 * - 레거시: HS256 + SUPABASE_JWT_SECRET(Legacy JWT secret 문자열).
 *
 * Legacy secret 은 Key ID / ECC 공개키 / anon 키가 아니라, 대시보드에서 reveal 한 공유 비밀 한 덩어리다.
 */
import * as jose from 'jose';
import { getSecret } from '@/lib/secret-registry';
import { isUuid } from '@/lib/uuid';

type SupabaseAuthConfiguration = {
  issuer: string;
  jwksUrl: URL;
};

function supabaseAuthConfiguration(): SupabaseAuthConfiguration | null {
  const u = getSecret('NEXT_PUBLIC_SUPABASE_URL') || getSecret('SUPABASE_URL');
  if (!u) return null;

  try {
    const configured = new URL(u);
    const isLocalHttp = process.env.NODE_ENV !== 'production'
      && configured.protocol === 'http:'
      && ['localhost', '127.0.0.1', '::1'].includes(configured.hostname);
    if (configured.protocol !== 'https:' && !isLocalHttp) return null;
    if (configured.username || configured.password) return null;

    // Supabase project URLs are origins. Discard accidental path/query/hash
    // suffixes so neither configuration drift nor token claims can redirect
    // key discovery to another host.
    const issuer = `${configured.origin}/auth/v1`;
    return {
      issuer,
      jwksUrl: new URL(`${issuer}/.well-known/jwks.json`),
    };
  } catch {
    return null;
  }
}

/**
 * Configured project issuer 당 JWKS 한 번만 생성.
 * @see https://supabase.com/docs/guides/auth/jwts
 */
const jwksByIssuer = new Map<string, jose.JWTVerifyGetKey>();

function getConfiguredJwks(configuration: SupabaseAuthConfiguration): jose.JWTVerifyGetKey {
  let jwks = jwksByIssuer.get(configuration.issuer);
  if (!jwks) {
    jwks = jose.createRemoteJWKSet(configuration.jwksUrl);
    jwksByIssuer.set(configuration.issuer, jwks);
  }
  return jwks;
}

function isAuthenticatedAudience(audience: jose.JWTPayload['aud']): boolean {
  return audience === 'authenticated'
    || (Array.isArray(audience) && audience.includes('authenticated'));
}

function isVerifiedUserAccessPayload(
  payload: jose.JWTPayload,
  expectedIssuer: string,
): boolean {
  return payload.iss === expectedIssuer
    && isAuthenticatedAudience(payload.aud)
    && payload.role === 'authenticated'
    && typeof payload.sub === 'string'
    && isUuid(payload.sub);
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

  const configuration = supabaseAuthConfiguration();
  if (!configuration) return { ok: false };

  // ── ES256 / RS256 (JWT Signing Keys — ECC·RSA 등) ───────────────────────
  // 공개키와 issuer 모두 configured Supabase project 에 고정한다. 서명 전
  // token payload 의 iss 는 네트워크 목적지나 trust root 로 사용하지 않는다.
  if (alg === 'ES256' || alg === 'RS256') {
    const jwks = getConfiguredJwks(configuration);
    try {
      const { payload } = await jose.jwtVerify(token, jwks, {
        algorithms: ['ES256', 'RS256'],
        issuer: configuration.issuer,
        audience: 'authenticated',
        requiredClaims: ['iss', 'aud', 'exp', 'sub', 'role'],
      });
      if (!isVerifiedUserAccessPayload(payload, configuration.issuer)) {
        return { ok: false };
      }
      return { ok: true, payload };
    } catch {
      return { ok: false };
    }
  }

  // ── HS256 (Legacy JWT secret) ─────────────────────────────────
  if (alg !== 'HS256') return { ok: false };

  const secret = getSecret('SUPABASE_JWT_SECRET');
  if (!secret?.trim()) {
    if (process.env.NODE_ENV === 'production') {
      return { ok: false };
    }
    const raw = base64UrlToJson(token);
    if (
      !raw
      || !legacyJwtExpValid(token)
      || !isVerifiedUserAccessPayload(raw as jose.JWTPayload, configuration.issuer)
    ) return { ok: false };
    return { ok: true, payload: raw as jose.JWTPayload };
  }
  try {
    const { payload } = await jose.jwtVerify(
      token,
      new TextEncoder().encode(secret.trim()),
      {
        algorithms: ['HS256'],
        issuer: configuration.issuer,
        audience: 'authenticated',
        requiredClaims: ['iss', 'aud', 'exp', 'sub', 'role'],
      },
    );
    if (!isVerifiedUserAccessPayload(payload, configuration.issuer)) {
      return { ok: false };
    }
    return { ok: true, payload };
  } catch {
    const raw = base64UrlToJson(token);
    if (
      process.env.NODE_ENV !== 'production'
      && raw
      && legacyJwtExpValid(token)
      && isVerifiedUserAccessPayload(raw as jose.JWTPayload, configuration.issuer)
    ) {
      if (!(globalThis as unknown as { __ysJwtDevWarn?: boolean }).__ysJwtDevWarn) {
        (globalThis as unknown as { __ysJwtDevWarn?: boolean }).__ysJwtDevWarn = true;
        console.warn(
          '[supabase-jwt-verify] HS256 검증 실패 후 개발 폴백(exp만 확인). ' +
            '토큰이 ES256이면 JWKS 경로를 쓰는지·Legacy secret 은 reveal 한 문자열인지 확인하세요.',
        );
      }
      return { ok: true, payload: raw as jose.JWTPayload };
    }
    return { ok: false };
  }
}
