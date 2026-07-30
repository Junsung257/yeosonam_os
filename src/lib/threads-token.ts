import { getSecret } from '@/lib/secret-registry';

const THREADS_ORIGIN = 'https://graph.threads.net';
const THREADS_API_BASE = `${THREADS_ORIGIN}/v1.0`;
const REQUIRED_AUTOPILOT_SCOPES = [
  'threads_basic',
  'threads_content_publish',
  'threads_read_replies',
  'threads_manage_replies',
] as const;
const OPTIONAL_AUTOPILOT_SCOPES = [
  'threads_manage_mentions',
  'threads_keyword_search',
  'threads_manage_insights',
] as const;

interface TokenPayload {
  access_token?: string;
  token_type?: string;
  user_id?: string | number;
  expires_in?: number;
  error?: { message?: string; code?: number; error_subcode?: number };
}

async function readJson<T>(response: Response, label: string): Promise<T> {
  const raw = await response.text();
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    const message = (parsed as TokenPayload | null)?.error?.message;
    throw new Error(`${label} failed (HTTP ${response.status})${message ? `: ${message.slice(0, 200)}` : ''}`);
  }
  if (!parsed || typeof parsed !== 'object') throw new Error(`${label} returned invalid JSON`);
  return parsed as T;
}

export interface ThreadsTokenResult {
  accessToken: string;
  userId?: string;
  expiresIn?: number;
  expiresAt?: string;
}

function normalizeTokenResult(data: TokenPayload): ThreadsTokenResult {
  if (!data.access_token) throw new Error('Threads token response did not include access_token');
  const expiresIn = Number.isFinite(Number(data.expires_in)) ? Number(data.expires_in) : undefined;
  return {
    accessToken: data.access_token,
    userId: data.user_id == null ? undefined : String(data.user_id),
    expiresIn,
    expiresAt: expiresIn
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : undefined,
  };
}

export async function exchangeThreadsAuthorizationCode(input: {
  code: string;
  redirectUri: string;
  appId: string;
  appSecret: string;
}): Promise<ThreadsTokenResult> {
  const body = new URLSearchParams({
    client_id: input.appId,
    client_secret: input.appSecret,
    grant_type: 'authorization_code',
    redirect_uri: input.redirectUri,
    code: input.code,
  });
  const response = await fetch(`${THREADS_ORIGIN}/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  return normalizeTokenResult(await readJson<TokenPayload>(response, 'Threads code exchange'));
}

export async function exchangeThreadsLongLivedToken(
  shortLivedToken: string,
  appSecret: string,
): Promise<ThreadsTokenResult> {
  const url = new URL(`${THREADS_ORIGIN}/access_token`);
  url.searchParams.set('grant_type', 'th_exchange_token');
  url.searchParams.set('client_secret', appSecret);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${shortLivedToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  return normalizeTokenResult(await readJson<TokenPayload>(response, 'Threads long-lived token exchange'));
}

export async function refreshThreadsLongLivedToken(
  accessToken: string,
): Promise<ThreadsTokenResult> {
  const url = new URL(`${THREADS_ORIGIN}/refresh_access_token`);
  url.searchParams.set('grant_type', 'th_refresh_token');
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  return normalizeTokenResult(await readJson<TokenPayload>(response, 'Threads token refresh'));
}

export async function fetchThreadsTokenProfile(
  accessToken: string,
): Promise<{ id: string; username: string }> {
  const response = await fetch(`${THREADS_API_BASE}/me?fields=id,username`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  const data = await readJson<{ id?: string; username?: string }>(response, 'Threads profile lookup');
  if (!data.id || !data.username) throw new Error('Threads profile response is incomplete');
  return { id: data.id, username: data.username };
}

export interface ThreadsTokenInspection {
  valid: boolean;
  userId?: string;
  username?: string;
  expiresAt?: string;
  scopes: string[];
  missingRequiredScopes: string[];
  optionalScopes: Record<(typeof OPTIONAL_AUTOPILOT_SCOPES)[number], boolean>;
  error?: string;
}

export async function inspectThreadsToken(accessToken: string): Promise<ThreadsTokenInspection> {
  let profile: { id: string; username: string };
  try {
    profile = await fetchThreadsTokenProfile(accessToken);
  } catch (error) {
    return {
      valid: false,
      scopes: [],
      missingRequiredScopes: [...REQUIRED_AUTOPILOT_SCOPES],
      optionalScopes: Object.fromEntries(
        OPTIONAL_AUTOPILOT_SCOPES.map((scope) => [scope, false]),
      ) as ThreadsTokenInspection['optionalScopes'],
      error: error instanceof Error ? error.message : 'Threads profile lookup failed',
    };
  }

  const appId = getSecret('THREADS_APP_ID') || getSecret('META_APP_ID');
  const appSecret = getSecret('THREADS_APP_SECRET') || getSecret('META_APP_SECRET');
  let scopes: string[] = [];
  let expiresAt: string | undefined;
  let debugError: string | undefined;
  if (appId && appSecret) {
    try {
      const url = new URL('https://graph.facebook.com/v21.0/debug_token');
      url.searchParams.set('input_token', accessToken);
      url.searchParams.set('access_token', `${appId}|${appSecret}`);
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      const data = await readJson<{
        data?: { is_valid?: boolean; scopes?: string[]; expires_at?: number };
      }>(response, 'Threads token inspection');
      if (data.data?.is_valid === false) {
        return {
          valid: false,
          userId: profile.id,
          username: profile.username,
          scopes: [],
          missingRequiredScopes: [...REQUIRED_AUTOPILOT_SCOPES],
          optionalScopes: Object.fromEntries(
            OPTIONAL_AUTOPILOT_SCOPES.map((scope) => [scope, false]),
          ) as ThreadsTokenInspection['optionalScopes'],
          error: 'Threads token debugger reported an invalid token',
        };
      }
      scopes = data.data?.scopes ?? [];
      if (data.data?.expires_at) {
        expiresAt = new Date(data.data.expires_at * 1000).toISOString();
      }
    } catch (error) {
      debugError = error instanceof Error ? error.message : 'Token inspection failed';
    }
  } else {
    debugError = 'Threads app credentials are missing; permissions could not be inspected';
  }

  const missingRequiredScopes = REQUIRED_AUTOPILOT_SCOPES.filter(
    (scope) => !scopes.includes(scope),
  );
  return {
    valid: true,
    userId: profile.id,
    username: profile.username,
    expiresAt,
    scopes,
    missingRequiredScopes,
    optionalScopes: Object.fromEntries(
      OPTIONAL_AUTOPILOT_SCOPES.map((scope) => [scope, scopes.includes(scope)]),
    ) as ThreadsTokenInspection['optionalScopes'],
    error: debugError,
  };
}

export { REQUIRED_AUTOPILOT_SCOPES, OPTIONAL_AUTOPILOT_SCOPES };
