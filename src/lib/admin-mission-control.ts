export type MenuRoleLevel = 'platform_admin' | 'tenant_admin' | 'tenant_staff';

export type AdminMissionTone = 'danger' | 'warning' | 'info';

export type AdminMissionDomain =
  | 'ai'
  | 'finance'
  | 'marketing'
  | 'products';

export type AdminMissionMetricKey =
  | 'pendingActions'
  | 'pendingPackages'
  | 'unmatchedPending'
  | 'paymentUnmatched'
  | 'blogQueue';

export type AdminMissionId =
  | 'jarvis-actions'
  | 'package-review'
  | 'attraction-matching'
  | 'payment-matching'
  | 'blog-queue';

export interface AdminBadgeCounts {
  pendingActions: number;
  unmatchedPending: number;
  pendingPackages: number;
  paymentUnmatched?: number;
  ledgerDrift?: number;
  blogQueue: number;
  computedAt?: string;
}

export interface AdminMissionDefinition {
  id: AdminMissionId;
  metric: AdminMissionMetricKey;
  href: string;
  label: string;
  actionLabel: string;
  description: string;
  domain: AdminMissionDomain;
  owner: string;
  sloMinutes: number;
  tone: AdminMissionTone;
  priority: number;
  minRole?: MenuRoleLevel;
}

export interface AdminMissionItem extends AdminMissionDefinition {
  count: number;
}

export const ROLE_HIERARCHY: Record<MenuRoleLevel, number> = {
  platform_admin: 3,
  tenant_admin: 2,
  tenant_staff: 1,
};

export function hasMenuAccess(
  userRole: string | undefined,
  minRole: MenuRoleLevel | undefined,
): boolean {
  if (!minRole) return true;
  if (!userRole) return false;
  const userLevel = ROLE_HIERARCHY[userRole as MenuRoleLevel] ?? 0;
  const requiredLevel = ROLE_HIERARCHY[minRole];
  return userLevel >= requiredLevel;
}

export const ADMIN_MISSION_DEFINITIONS: AdminMissionDefinition[] = [
  {
    id: 'jarvis-actions',
    metric: 'pendingActions',
    href: '/admin/jarvis?tab=actions',
    label: '자비스 결재',
    actionLabel: '승인/반려',
    description: 'AI가 제안한 운영 액션을 사람이 확정해야 합니다.',
    domain: 'ai',
    owner: 'jarvis-ops',
    sloMinutes: 30,
    tone: 'danger',
    priority: 10,
    minRole: 'tenant_admin',
  },
  {
    id: 'payment-matching',
    metric: 'paymentUnmatched',
    href: '/admin/payments?filter=unmatched',
    label: '입금 매칭',
    actionLabel: '수동 매칭',
    description: '예약과 연결되지 않은 입금 또는 검토 건입니다.',
    domain: 'finance',
    owner: 'finance-ops',
    sloMinutes: 30,
    tone: 'danger',
    priority: 20,
    minRole: 'tenant_admin',
  },
  {
    id: 'package-review',
    metric: 'pendingPackages',
    href: '/admin/packages?status=pending',
    label: '상품 검수',
    actionLabel: '공개 전 확인',
    description: '공개 대기 중인 상품을 검수합니다.',
    domain: 'products',
    owner: 'product-ops',
    sloMinutes: 180,
    tone: 'warning',
    priority: 30,
  },
  {
    id: 'attraction-matching',
    metric: 'unmatchedPending',
    href: '/admin/attractions/unmatched',
    label: '관광지 매칭',
    actionLabel: 'DB 연결',
    description: '일정 원문에서 DB 관광지와 연결되지 않은 항목입니다.',
    domain: 'products',
    owner: 'content-data',
    sloMinutes: 240,
    tone: 'info',
    priority: 40,
  },
  {
    id: 'blog-queue',
    metric: 'blogQueue',
    href: '/admin/blog/queue',
    label: '블로그 큐',
    actionLabel: '발행 준비',
    description: '네이버 블로그 초안 여부를 확인합니다.',
    domain: 'marketing',
    owner: 'marketing-ops',
    sloMinutes: 1440,
    tone: 'info',
    priority: 50,
  },
];

export function buildAdminMissionItems(counts: AdminBadgeCounts | undefined): AdminMissionItem[] {
  return ADMIN_MISSION_DEFINITIONS
    .map((definition) => ({
      ...definition,
      count: getMissionCount(definition.metric, counts),
    }))
    .sort((a, b) => a.priority - b.priority);
}

export function filterActiveMissionItems(
  items: AdminMissionItem[],
  userRole: string | undefined,
): AdminMissionItem[] {
  return items.filter((item) => item.count > 0 && hasMenuAccess(userRole, item.minRole));
}

export function getMissionCount(
  metric: AdminMissionMetricKey,
  counts: AdminBadgeCounts | undefined,
): number {
  if (!counts) return 0;
  if (metric === 'paymentUnmatched') {
    return counts.paymentUnmatched ?? counts.ledgerDrift ?? 0;
  }
  return counts[metric] ?? 0;
}

export function getMissionTotal(items: AdminMissionItem[]): number {
  return items.reduce((sum, item) => sum + Math.max(0, item.count), 0);
}
