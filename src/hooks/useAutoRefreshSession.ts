'use client';

import { useEffect, useRef } from 'react';
import { ensureSessionRefreshed } from '@/lib/fetch-with-session-refresh';

const REFRESH_INTERVAL_MS = 50 * 60 * 1000; // 50분. access token 1시간 만료 직전 갱신.

// /api/auth/refresh 를 주기적으로 호출하여 access-token 쿠키를 살아있는 상태로 유지.
// HttpOnly 쿠키라 클라이언트가 직접 읽을 수 없으므로, 실패는 조용히 무시하고
// 비인증 상태가 되면 다음 보호 라우트 진입 시 middleware 가 로그인으로 보낸다.
export function useAutoRefreshSession(options: { enabled?: boolean } = {}) {
  const { enabled = true } = options;
  const lastRefreshAt = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    async function refresh(reason: string) {
      if (cancelled) return;
      const now = Date.now();
      if (now - lastRefreshAt.current < 30 * 1000) return; // 30초 내 중복 방지
      lastRefreshAt.current = now;
      try {
        await ensureSessionRefreshed();
      } catch {
        // 네트워크 실패는 조용히 무시 — 다음 트리거에서 재시도
      }
      // 디버그: reason 은 개발자 도구에서 network 탭과 대조할 때만 참고
      void reason;
    }

    refresh('mount');

    const intervalId = window.setInterval(() => {
      refresh('interval');
    }, REFRESH_INTERVAL_MS);

    function onVisibility() {
      if (document.visibilityState === 'visible') {
        refresh('visibility');
      }
    }
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled]);
}
