'use client';

import { SWRConfig } from 'swr';

/**
 * 어드민 영역 전용 SWR Provider.
 *
 * 정책:
 *   - 30초 dedupingInterval — 같은 키 30초 동안 재요청 차단 (사이드바 배지 등)
 *   - revalidateOnFocus: false — 어드민에서 탭 전환마다 폭격 방지
 *   - keepPreviousData: true — 필터 변경 시 깜빡임 제거
 *   - errorRetryCount: 2 — 끝없는 재시도 방지
 *
 * 감사: docs/audits/2026-05-11-admin-perf-audit.md
 */
export default function AdminSwrProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher: async (key: string) => {
          const res = await fetch(key, { credentials: 'same-origin' });
          if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`fetch ${res.status}: ${text.slice(0, 200)}`);
          }
          return res.json();
        },
        dedupingInterval: 30_000,
        revalidateOnFocus: false,
        revalidateOnReconnect: true,
        keepPreviousData: true,
        errorRetryCount: 2,
        errorRetryInterval: 2000,
      }}
    >
      {children}
    </SWRConfig>
  );
}
