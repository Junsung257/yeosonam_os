'use client';

import useSWR from 'swr';
import type { AdminRole, AdminSessionUser } from '@/app/api/admin/session/route';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface UseUserRoleReturn {
  user: AdminSessionUser | null;
  role: AdminRole;
  isPlatformAdmin: boolean;
  isTenantAdmin: boolean;
  isTenantStaff: boolean;
  isLoading: boolean;
  error: Error | undefined;
}

/**
 * 현재 로그인한 사용자의 역할 정보를 SWR로 가져오는 훅.
 * AdminLayout에서 사이드바 메뉴 필터링 등에 사용.
 */
export function useUserRole(): UseUserRoleReturn {
  const { data, error, isLoading } = useSWR<{ user: AdminSessionUser | null }>(
    '/api/admin/session',
    fetcher,
    {
      dedupingInterval: 60_000,    // 1분 중복 요청 방지
      refreshInterval: 5 * 60_000, // 5분마다 재검증
      revalidateOnFocus: true,
    },
  );

  const user = data?.user ?? null;
  const role: AdminRole = user?.role ?? 'unknown';

  return {
    user,
    role,
    isPlatformAdmin: role === 'platform_admin',
    isTenantAdmin: role === 'tenant_admin',
    isTenantStaff: role === 'tenant_staff',
    isLoading,
    error,
  };
}
