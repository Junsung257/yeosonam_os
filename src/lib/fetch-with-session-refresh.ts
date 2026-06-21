/**
 * Supabase HttpOnly 쿠키 세션: access 만료 시 middleware 가 API 에 401 + { error: 'token expired' } 를 준다.
 * 병렬 fetch 가 동시에 /api/auth/refresh 를 호출하면 refresh token 회전으로 일부만 성공하고,
 * 실패 응답의 Set-Cookie 삭제가 성공한 세션까지 덮어쓸 수 있으므로 refresh 는 단일 비행으로 직렬화한다.
 */

let refreshInFlight: Promise<boolean> | null = null;
const REFRESH_MARKER_COOKIE = 'sb-refresh-token-present';
const DEV_ADMIN_COOKIE = 'ys-dev-admin';
const SESSION_EXPIRED_PAYLOAD = {
  code: 'SESSION_EXPIRED_NEEDS_LOGIN',
  error: '관리자 로그인 시간이 만료되었습니다. 페이지를 새로고침하거나 다시 로그인한 뒤 같은 원문을 재시도하세요.',
  action: 'RELOGIN_AND_RETRY',
};

function hasCookie(name: string): boolean {
  if (typeof document === 'undefined') return true;
  return document.cookie
    .split(';')
    .map((part) => part.trim())
    .some((part) => part === name || part.startsWith(`${name}=`));
}

function shouldAttemptSessionRefresh(): boolean {
  if (typeof document === 'undefined') return true;
  if (hasCookie(DEV_ADMIN_COOKIE)) return false;
  return hasCookie(REFRESH_MARKER_COOKIE);
}

export function ensureSessionRefreshed(): Promise<boolean> {
  if (!shouldAttemptSessionRefresh()) {
    return Promise.resolve(false);
  }

  if (!refreshInFlight) {
    refreshInFlight = fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'same-origin',
    })
      // 409: 다른 병렬 refresh 가 이미 토큰을 회전시킨 경우 — 쿠키는 유지되므로 원 요청 재시도 가능
      .then((r) => r.ok || r.status === 409)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

function isTokenExpiredPayload(data: unknown): boolean {
  const payload = data as { code?: string; error?: string } | null;
  return payload?.code === 'TOKEN_EXPIRED' || payload?.error === 'token expired';
}

function sessionExpiredResponse(): Response {
  return new Response(JSON.stringify(SESSION_EXPIRED_PAYLOAD), {
    status: 401,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });
}

export async function fetchWithSessionRefresh(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const credentials = init?.credentials ?? 'same-origin';
  const res = await fetch(input, { ...init, credentials });

  if (res.status !== 401) return res;

  let data: unknown = {};
  try {
    data = await res.clone().json();
  } catch {
    /* non-JSON 401 */
  }
  if (!isTokenExpiredPayload(data)) return res;

  const refreshed = await ensureSessionRefreshed().catch(() => false);
  if (!refreshed) return sessionExpiredResponse();

  // 일부 환경에서 Set-Cookie 적용이 다음 틱까지 미뤄지는 경우 대비
  let retry = await fetch(input, { ...init, credentials });
  if (retry.status === 401) {
    const d = await retry.clone().json().catch(() => ({}));
    if (isTokenExpiredPayload(d)) {
      await new Promise((r) => setTimeout(r, 80));
      retry = await fetch(input, { ...init, credentials });
    }
  }
  if (retry.status === 401) {
    const d = await retry.clone().json().catch(() => ({}));
    if (isTokenExpiredPayload(d)) return sessionExpiredResponse();
  }
  return retry;
}
