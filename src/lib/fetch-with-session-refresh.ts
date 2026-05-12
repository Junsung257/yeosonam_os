/**
 * Supabase HttpOnly 쿠키 세션: access 만료 시 middleware 가 API 에 401 + { error: 'token expired' } 를 준다.
 * 병렬 fetch 가 동시에 /api/auth/refresh 를 호출하면 refresh token 회전으로 일부만 성공하고,
 * 실패 응답의 Set-Cookie 삭제가 성공한 세션까지 덮어쓸 수 있으므로 refresh 는 단일 비행으로 직렬화한다.
 */

let refreshInFlight: Promise<boolean> | null = null;

export function ensureSessionRefreshed(): Promise<boolean> {
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
  if ((data as { error?: string }).error !== 'token expired') return res;

  const refreshed = await ensureSessionRefreshed();
  if (!refreshed) return res;

  // 일부 환경에서 Set-Cookie 적용이 다음 틱까지 미뤄지는 경우 대비
  let retry = await fetch(input, { ...init, credentials });
  if (retry.status === 401) {
    const d = await retry.clone().json().catch(() => ({}));
    if ((d as { error?: string }).error === 'token expired') {
      await new Promise((r) => setTimeout(r, 80));
      retry = await fetch(input, { ...init, credentials });
    }
  }
  return retry;
}
