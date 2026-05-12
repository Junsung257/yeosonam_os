/**
 * admin-rbac.ts — 어드민 RBAC (Role-Based Access Control)
 *
 * 역할별 접근 가능한 어드민 메뉴/경로를 정의한다.
 * 미들웨어 및 어드민 사이드바 메뉴 렌더링에서 소비한다.
 *
 * SSOT: 이 파일 하나에서 모든 역할-권한 매핑을 관리.
 */

export const ROLE_PERMISSIONS = {
  /** 모든 경로 접근 가능 */
  super_admin: ['*'],

  /** CS 상담원: 예약·고객·에스컬레이션·인박스 */
  cs_agent: [
    '/admin/bookings',
    '/admin/customers',
    '/admin/escalations',
    '/admin/inbox',
  ],

  /** 마케터: 블로그·콘텐츠·마케팅·분석·검색광고 */
  marketer: [
    '/admin/blog',
    '/admin/content-hub',
    '/admin/marketing',
    '/admin/analytics',
    '/admin/search-ads',
  ],

  /** 재무담당: 원장·정산·랜드사정산·결제·세금 */
  finance: [
    '/admin/ledger',
    '/admin/settlements',
    '/admin/land-settlements',
    '/admin/payments',
    '/admin/tax',
  ],
} as const;

export type AdminRole = keyof typeof ROLE_PERMISSIONS;

/**
 * 해당 role이 path에 접근 가능한지 확인.
 *
 * - super_admin: 항상 true
 * - 그 외: ROLE_PERMISSIONS[role] 배열에 path가 포함되거나
 *   배열 내 항목 중 하나가 path의 prefix인 경우 true
 */
export function hasPermission(role: AdminRole, path: string): boolean {
  if (role === 'super_admin') return true;

  const allowed = ROLE_PERMISSIONS[role] as readonly string[];

  return allowed.some((allowedPath) => {
    // 정확 일치
    if (path === allowedPath) return true;
    // prefix 매칭 (예: '/admin/bookings/123' → '/admin/bookings' 허용)
    if (path.startsWith(allowedPath + '/')) return true;
    return false;
  });
}

/**
 * 해당 role이 접근 가능한 메뉴 경로 목록 반환.
 * super_admin이면 모든 역할의 경로를 합산해 반환.
 */
export function getMenuForRole(role: AdminRole): string[] {
  if (role === 'super_admin') {
    // super_admin은 전체 경로를 중복 없이 반환
    const all = new Set<string>();
    for (const r of Object.keys(ROLE_PERMISSIONS) as AdminRole[]) {
      if (r === 'super_admin') continue;
      const paths = ROLE_PERMISSIONS[r] as readonly string[];
      for (const p of paths) all.add(p);
    }
    return Array.from(all).sort();
  }

  return [...(ROLE_PERMISSIONS[role] as readonly string[])];
}
