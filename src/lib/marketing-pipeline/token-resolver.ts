/**
 * 멀티테넌트 OAuth 토큰 리졸버
 *
 * tenant_api_tokens 테이블에서 암호화된 토큰을 조회 후 복호화.
 * - expires_at 5분 이내: refresh 시도 후 DB 업데이트
 * - 미설정/만료/오류: null 반환 → 에이전트에서 graceful skip
 */
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { decrypt, encrypt } from '@/lib/encryption';
import { getSecret } from '@/lib/secret-registry';

export type OAuthProvider = 'google_ads' | 'meta' | 'naver' | 'google_analytics';

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
}

const REFRESH_BUFFER_MS = 5 * 60 * 1000; // 만료 5분 전에 갱신 시도

/**
 * 테넌트+프로바이더별 활성 토큰 조회.
 * 복호화 실패 또는 DB 오류 시 null 반환.
 */
export async function resolveOAuthToken(
  tenantId: string,
  provider: OAuthProvider,
): Promise<OAuthTokens | null> {
  if (!isSupabaseConfigured) return null;

  const { data, error } = await supabaseAdmin
    .from('tenant_api_tokens')
    .select('encrypted_access_token, encrypted_refresh_token, expires_at')
    .eq('tenant_id', tenantId)
    .eq('provider', provider)
    .eq('is_active', true)
    .limit(1);

  if (error || !data?.[0]) return null;

  const row = data[0];

  let accessToken: string;
  try {
    accessToken = decrypt(row.encrypted_access_token);
  } catch {
    return null;
  }

  const expiresAt = row.expires_at ? new Date(row.expires_at) : undefined;
  const refreshToken = row.encrypted_refresh_token
    ? tryDecrypt(row.encrypted_refresh_token)
    : undefined;

  // 만료 임박 시 refresh 시도
  // Meta는 refresh_token을 발급하지 않으므로 access_token으로 fb_exchange_token 재교환
  if (expiresAt && expiresAt.getTime() - Date.now() < REFRESH_BUFFER_MS) {
    const tokenForRefresh = provider === 'meta' ? accessToken : refreshToken;
    if (tokenForRefresh) {
      const refreshed = await tryRefreshToken(tenantId, provider, tokenForRefresh);
      if (refreshed) return refreshed;
    }
  }

  return { accessToken, refreshToken, expiresAt };
}

/**
 * 토큰 저장 (upsert) — OAuth 콜백에서 사용
 */
export async function saveOAuthToken(
  tenantId: string,
  provider: OAuthProvider,
  tokens: {
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number; // 초 단위
    scopes?: string[];
  },
): Promise<void> {
  const expiresAt = tokens.expiresIn
    ? new Date(Date.now() + tokens.expiresIn * 1000).toISOString()
    : null;

  const { error } = await supabaseAdmin.from('tenant_api_tokens').upsert(
    {
      tenant_id: tenantId,
      provider,
      encrypted_access_token: encrypt(tokens.accessToken),
      encrypted_refresh_token: tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
      expires_at: expiresAt,
      scopes: tokens.scopes ?? [],
      is_active: true,
    },
    { onConflict: 'tenant_id,provider' },
  );
  if (error) throw new Error(`[saveOAuthToken] ${provider} 토큰 저장 실패: ${error.message}`);
}

// ── 내부 헬퍼 ────────────────────────────────────────────────────────────────

async function saveRefreshedToken(
  tenantId: string,
  provider: OAuthProvider,
  accessToken: string,
  expiresAt: Date | undefined,
): Promise<void> {
  await supabaseAdmin
    .from('tenant_api_tokens')
    .update({
      encrypted_access_token: encrypt(accessToken),
      expires_at: expiresAt?.toISOString() ?? null,
    })
    .eq('tenant_id', tenantId)
    .eq('provider', provider);
}

function tryDecrypt(ciphertext: string): string | undefined {
  try {
    return decrypt(ciphertext);
  } catch {
    return undefined;
  }
}

async function tryRefreshToken(
  tenantId: string,
  provider: OAuthProvider,
  refreshToken: string,
): Promise<OAuthTokens | null> {
  try {
    if (provider === 'google_ads' || provider === 'google_analytics') {
      return await refreshGoogleToken(tenantId, provider, refreshToken);
    }
    if (provider === 'meta') {
      return await refreshMetaToken(tenantId, refreshToken);
    }
    return null;
  } catch (err) {
    console.warn(`[token-resolver] ${provider} refresh 실패:`, err);
    return null;
  }
}

async function refreshGoogleToken(tenantId: string, provider: OAuthProvider, refreshToken: string): Promise<OAuthTokens | null> {
  const clientId = getSecret('GOOGLE_ADS_CLIENT_ID');
  const clientSecret = getSecret('GOOGLE_ADS_CLIENT_SECRET');
  if (!clientId || !clientSecret) return null;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) return null;
  const json = await res.json() as { access_token?: string; expires_in?: number };
  if (!json.access_token) return null;

  const expiresAt = json.expires_in
    ? new Date(Date.now() + json.expires_in * 1000)
    : undefined;

  // DB 업데이트 (refresh_token은 Google에서 재발급 안 하므로 유지)
  await saveRefreshedToken(tenantId, provider, json.access_token, expiresAt);

  return { accessToken: json.access_token, refreshToken, expiresAt };
}

async function refreshMetaToken(tenantId: string, shortToken: string): Promise<OAuthTokens | null> {
  const appId = getSecret('META_APP_ID');
  const appSecret = getSecret('META_APP_SECRET');
  if (!appId || !appSecret) return null;

  const url = new URL('https://graph.facebook.com/v18.0/oauth/access_token');
  url.searchParams.set('grant_type', 'fb_exchange_token');
  url.searchParams.set('client_id', appId);
  url.searchParams.set('client_secret', appSecret);
  url.searchParams.set('fb_exchange_token', shortToken);

  const res = await fetch(url.toString());
  if (!res.ok) return null;
  const json = await res.json() as { access_token?: string; expires_in?: number };
  if (!json.access_token) return null;

  const expiresAt = json.expires_in
    ? new Date(Date.now() + json.expires_in * 1000)
    : undefined;

  await saveRefreshedToken(tenantId, 'meta', json.access_token, expiresAt);

  return { accessToken: json.access_token, expiresAt };
}
