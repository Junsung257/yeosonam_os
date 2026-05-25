'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect, useCallback, useMemo } from 'react';
import useSWR from 'swr';
import {
  LayoutDashboard, Inbox, BookOpenCheck, Users, Wallet, FileText,
  Package, ClipboardCheck, Upload, Building2, ScrollText, MapPinned, Mountain, Globe,
  Handshake, BarChart3, BarChart4, UserPlus, FileQuestion, Headset, Layers, Compass,
  BookCopy, Coins, Calculator,
  Megaphone, Sparkles as Sparkle, Newspaper, FolderKanban, ListChecks, TrendingUp, AlertTriangle, Search as SearchIcon, BookOpen,
  Bot, Wand2, MessageCircle, MessageSquare, FilePlus2, LibraryBig,
  Activity, Siren, Timer,
  LogOut, Star, StarOff, Menu as MenuIcon, Eye,
  ArrowLeftRight, Unlink, FileSearch, PackagePlus, Combine,
  Receipt, Plane, Palette, Target, Zap, Send, Link2,
  Tags, BadgeDollarSign, Settings, PencilLine, GitBranch, SlidersHorizontal, Shield,
  ChevronRight, ChevronDown, X,
  type LucideIcon,
} from 'lucide-react';
import { useAutoRefreshSession } from '@/hooks/useAutoRefreshSession';
import AdminSwrProvider from './admin/SwrProvider';
import {
  DensityProvider,
  DensityToggle,
  SearchInput,
  useDensity,
  CommandPalette,
  ShortcutsProvider,
  KeyboardShortcutsHelp,
  useShortcuts,
} from '@/components/admin/ui';
import type { AdminCommand } from '@/lib/admin-commands/registry';
import AlertsBadge from './admin/AlertsBadge';
import { useUserRole } from '@/hooks/useUserRole';
import { useNavLogger, readNavUsage } from '@/hooks/useNavLogger';
import SidebarAIWidget from './admin/SidebarAIWidget';
import { IntentRecommendationsBar } from './admin/IntentRecommendations';

// ── 역할 기반 접근 제어 타입 ─────────────────────────────
/** 최소 필요 역할 (낮을수록 더 많은 접근) */
export type MenuRoleLevel = 'platform_admin' | 'tenant_admin' | 'tenant_staff';

/** 역할 계층 (숫자가 높을수록 더 broad) */
const ROLE_HIERARCHY: Record<MenuRoleLevel, number> = {
  platform_admin: 3,
  tenant_admin: 2,
  tenant_staff: 1,
};

/** 사용자 역할이 minRole 조건을 만족하는지 검사 */
export function hasMenuAccess(
  userRole: string | undefined,
  minRole: MenuRoleLevel | undefined,
): boolean {
  if (!minRole) return true; // 제한 없음 → 모두 접근 가능
  if (!userRole) return false;
  const userLevel = ROLE_HIERARCHY[userRole as MenuRoleLevel] ?? 0;
  const requiredLevel = ROLE_HIERARCHY[minRole];
  return userLevel >= requiredLevel;
}

// ── 카테고리 그룹핑 사이드바 메뉴 ─────────────────────────────
interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  /** 최소 필요 역할 (없으면 모두 접근 가능) */
  minRole?: MenuRoleLevel;
}

interface NavDivider {
  divider: true;
  label: string;
}

interface NavGroup {
  title: string;
  icon: LucideIcon;
  items: (NavItem | NavDivider)[];
  /** 그룹 전체의 최소 필요 역할 (개별 항목보다 우선) */
  minRole?: MenuRoleLevel;
}

const navGroups: NavGroup[] = [
  {
    title: '운영',
    icon: Inbox,
    items: [
      { href: '/admin',                    label: '대시보드',     icon: LayoutDashboard, exact: true },
      { href: '/admin/inbox',              label: '고객 문의',    icon: Inbox },
      { href: '/admin/bookings',           label: '예약 관리',    icon: BookOpenCheck },
      { href: '/admin/customers',          label: '고객 관리',    icon: Users },
      { href: '/admin/leads',              label: '예약 문의',    icon: MessageSquare },
      { href: '/admin/reviews',            label: '리뷰 감정분석', icon: Star },
      { href: '/admin/flight-alerts',      label: '항공 지연',    icon: Plane },
      { href: '/admin/payments',           label: '입금/정산',    icon: Wallet, minRole: 'tenant_admin' },
    ],
  },
  {
    title: '상품',
    icon: Package,
    items: [
      { href: '/admin/packages',                      label: '상품 관리',          icon: Package },
      { href: '/admin/upload',                        label: '업로드',             icon: Upload },
      { href: '/admin/land-operators',                label: '랜드사 관리',        icon: Building2, minRole: 'tenant_admin' },
      { href: '/admin/attractions',                   label: '여행지/관광지',       icon: Mountain },
      { href: '/admin/destinations',                  label: '출발지 관리',        icon: MapPinned },
      { href: '/admin/terms-templates',               label: '약관 템플릿',        icon: ScrollText, minRole: 'tenant_admin' },
      { href: '/admin/products/assemble-free-travel', label: '자유여행 상품 조립', icon: Combine, minRole: 'tenant_admin' },
    ],
  },
  {
    title: '영업',
    icon: BarChart3,
    minRole: 'tenant_admin',
    items: [
      { href: '/admin/affiliates',          label: '제휴/인플루언서',        icon: Handshake },
      { href: '/admin/affiliate-analytics', label: '제휴 분석',              icon: BarChart3 },
      { href: '/admin/affiliate-promo-report', label: '프로모코드 성과',      icon: Tags },
      { href: '/admin/applications',        label: '파트너 신청',            icon: UserPlus },
      { href: '/admin/partner-preview',     label: '파트너 프론트 미리보기', icon: Eye },
      { href: '/admin/rfqs',                label: '단체 RFQ',               icon: FileQuestion },
      { href: '/admin/competitor-prices',   label: '경쟁사 가격',            icon: TrendingUp },
      { href: '/admin/analytics',           label: 'LTV 코호트',             icon: BarChart3 },
      { href: '/admin/concierge',           label: '컨시어지',               icon: Headset },
      { href: '/admin/free-travel',         label: '자유여행 플래너',        icon: Compass },
      { href: '/admin/tenants',             label: '테넌트 관리',            icon: Layers, minRole: 'platform_admin' },
    ],
  },
  {
    title: '재무',
    icon: Wallet,
    minRole: 'tenant_admin',
    items: [
      { href: '/admin/ledger',                  label: '통합 장부',    icon: BookCopy },
      { href: '/admin/settlements',             label: '정산 관리',    icon: Coins },
      { href: '/admin/tax',                     label: '세무 관리',    icon: Calculator },
      { href: '/admin/invoice',                 label: '인보이스 파싱', icon: Receipt },
    ],
  },
  {
    title: '마케팅',
    icon: Megaphone,
    items: [
      { href: '/admin/marketing',              label: '통합 광고 대시보드',  icon: Megaphone },
      { href: '/admin/marketing/card-news',    label: '카드뉴스',           icon: Newspaper },
      { href: '/admin/content-hub',            label: '콘텐츠',             icon: FolderKanban },
      { href: '/admin/search-ads',             label: '검색광고',           icon: SearchIcon },
      { href: '/admin/blog',                   label: '블로그',             icon: BookOpen },
      { href: '/admin/marketing-intelligence', label: '마케팅 인텔리전스',   icon: BarChart4, minRole: 'tenant_admin' },
      { href: '/admin/tmp-pipeline',           label: 'TMP 파이프라인',     icon: GitBranch, minRole: 'tenant_admin' },
      { href: '/admin/marketing/creatives',    label: '크리에이티브',       icon: Sparkle },
      { href: '/admin/tenant-tokens',          label: 'API 토큰 관리',      icon: SlidersHorizontal, minRole: 'tenant_admin' },
    ],
  },
  {
    title: 'AI',
    icon: Bot,
    minRole: 'tenant_admin',
    items: [
      { href: '/admin/jarvis',                  label: '자비스 AI',         icon: Bot },
      { href: '/admin/jarvis/rag',              label: 'RAG 검색',          icon: SearchIcon },
      { href: '/admin/mcp',                     label: 'MCP 게이트웨이',    icon: Link2 },
      { href: '/admin/generate',                label: 'AI 생성',           icon: Wand2 },
      { href: '/admin/qa',                      label: 'Q&A 챗봇',          icon: MessageCircle },
      { href: '/admin/platform-learning',       label: 'AI 플라이휠',       icon: LibraryBig, minRole: 'platform_admin' },
      { href: '/admin/agent-mas',               label: 'MAS 관제',          icon: GitBranch, minRole: 'platform_admin' },
      { href: '/admin/extractions/corrections', label: 'AI 파싱 교정 이력', icon: PencilLine, minRole: 'platform_admin' },
      { href: '/admin/prompts',                 label: '프롬프트 레지스트리', icon: SlidersHorizontal, minRole: 'platform_admin' },
    ],
  },
  {
    title: '시스템',
    icon: Activity,
    minRole: 'platform_admin',
    items: [
      { href: '/admin/control-tower',  label: 'OS 관제탑',     icon: Activity },
      { href: '/admin/ops',            label: '크론·작업',     icon: Timer },
      { href: '/admin/scoring',        label: '점수 정책',     icon: Star },
      { href: '/admin/escalations',    label: '에스컬레이션',  icon: Siren },
      { href: '/admin/alerts',         label: '운영 알림',     icon: AlertTriangle },
      { href: '/admin/gdpr',           label: '개인정보 삭제', icon: Shield },
      { href: '/admin/settings/integrations', label: '외부 플랫폼 연동', icon: Settings },
    ],
  },
];

const FAV_STORAGE_KEY = 'admin.favorites';
const FAV_LIMIT = 7;

/** navGroups 중 사용자 역할에 접근 가능한 그룹/아이템만 필터링 */
function filterNavGroups(groups: NavGroup[], role: string | undefined): NavGroup[] {
  return groups
    .filter((g) => hasMenuAccess(role, g.minRole))
    .map((g) => ({
      ...g,
      items: g.items.filter((it) => {
        if ('divider' in it) return false; // divider는 필터에서 제외 (현재 사용 안 함)
        return hasMenuAccess(role, (it as NavItem).minRole);
      }),
    }))
    .filter((g) => g.items.length > 0);
}

/** allItems는 항상 전체 목록 (즐겨찾기·⌘K용). 역할에 따른 필터링은 render 타임에서 별도 처리. */
const allItems: NavItem[] = navGroups.flatMap((g) => g.items.filter((it): it is NavItem => !('divider' in it)));

function useFavorites() {
  const [favs, setFavs] = useState<string[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(FAV_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setFavs(parsed.filter((v) => typeof v === 'string'));
      }
    } catch {
      // ignore
    }
  }, []);

  const persist = useCallback((next: string[]) => {
    setFavs(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(FAV_STORAGE_KEY, JSON.stringify(next));
    }
  }, []);

  const toggle = useCallback(
    (href: string) => {
      const exists = favs.includes(href);
      if (exists) {
        persist(favs.filter((h) => h !== href));
      } else if (favs.length < FAV_LIMIT) {
        persist([...favs, href]);
      } else {
        // 한도 초과 — 가장 오래된 것을 빼고 새 항목 추가
        persist([...favs.slice(1), href]);
      }
    },
    [favs, persist],
  );

  const isFav = useCallback((href: string) => favs.includes(href), [favs]);

  return { favs, isFav, toggle };
}

interface SidebarItemProps {
  item: NavItem;
  active: boolean;
  isFavorite: boolean;
  onToggleFav: (href: string) => void;
  onNavClick: (href: string) => void;
  badge?: number;
  slim?: boolean;
}

function SidebarItem({ item, active, isFavorite, onToggleFav, onNavClick, badge, slim }: SidebarItemProps) {
  const Icon = item.icon;

  if (slim) {
    return (
      <Link
        href={item.href}
        title={item.label}
        onClick={() => onNavClick(item.href)}
        className={`relative flex items-center justify-center h-9 w-9 mx-auto rounded-admin-md transition-colors duration-160 ${
          active ? 'bg-brand-light text-brand' : 'text-admin-muted hover:bg-admin-surface-2 hover:text-admin-text'
        }`}
      >
        <Icon size={16} strokeWidth={2} />
        {badge != null && badge > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-danger text-white text-[8px] font-semibold w-3.5 h-3.5 rounded-full flex items-center justify-center leading-none">
            {badge > 9 ? '9+' : badge}
          </span>
        )}
      </Link>
    );
  }

  return (
    <div className="group relative">
      <Link
        href={item.href}
        title={item.label}
        onClick={() => onNavClick(item.href)}
        className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-admin-sm text-admin-sm transition-colors duration-160 relative ${
          active
            ? 'bg-brand-light text-brand font-semibold'
            : 'text-admin-text-2 hover:bg-admin-surface-2 hover:text-admin-text'
        }`}
      >
        <Icon size={15} strokeWidth={2} className="shrink-0" />
        <span className="truncate">{item.label}</span>
        {badge != null && badge > 0 && (
          <span className="ml-auto bg-danger text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-full min-w-[18px] text-center leading-none">
            {badge}
          </span>
        )}
      </Link>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggleFav(item.href);
        }}
        title={isFavorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
        className={`absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded transition ${
          isFavorite
            ? 'text-warning opacity-90'
            : 'text-admin-muted-2 opacity-0 group-hover:opacity-100 hover:text-warning'
        }`}
      >
        {isFavorite ? <Star size={12} fill="currentColor" /> : <StarOff size={12} />}
      </button>
    </div>
  );
}

function AdminLayoutInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { density } = useDensity();
  const [sidebarMode, setSidebarMode] = useState<'full' | 'slim'>(() => {
    if (typeof window === 'undefined') return 'full';
    return (window.localStorage.getItem('admin.sidebar-mode') as 'full' | 'slim') ?? 'full';
  });
  const [cmdOpen, setCmdOpen] = useState(false);
  const { favs, isFav, toggle: toggleFav } = useFavorites();
  const { role: userRole, isLoading: roleLoading } = useUserRole();
  const { trackNavClick } = useNavLogger();
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    // 처음엔 빈 Set — 초기 상태는 frequency 기반으로 아래 useMemo에서 결정
    return new Set();
  });

  useAutoRefreshSession();

  /** 사용자 역할에 따라 필터링된 메뉴 */
  const visibleGroups = useMemo(
    () => filterNavGroups(navGroups, userRole),
    [userRole],
  );

  /** 사용 빈도 데이터 읽기 + 동적 정렬 */
  const { sortedGroups, usageCounts } = useMemo(() => {
    const counts = readNavUsage();
    const sorted = [...visibleGroups].sort((a, b) => {
      // 그룹 title별 총 방문 횟수
      const aCount = a.items
        .filter((it): it is NavItem => !('divider' in it))
        .reduce((sum, it) => sum + (counts[it.href] ?? 0), 0);
      const bCount = b.items
        .filter((it): it is NavItem => !('divider' in it))
        .reduce((sum, it) => sum + (counts[it.href] ?? 0), 0);
      return bCount - aCount; // 내림차순
    });
    return { sortedGroups: sorted, usageCounts: counts };
  }, [visibleGroups]);

  /** 접힘 상태 초기화 — 방문 빈도 0인 그룹은 기본 접힘 */
  useEffect(() => {
    const zeroFreq = new Set<string>();
    for (const g of sortedGroups) {
      const total = g.items
        .filter((it): it is NavItem => !('divider' in it))
        .reduce((sum, it) => sum + (usageCounts[it.href] ?? 0), 0);
      if (total === 0 && g.title !== '운영' && g.title !== '상품') {
        // 운영/상품은 기본 펼침, 나머지는 빈도 0이면 접힘
        zeroFreq.add(g.title);
      }
    }
    setCollapsedGroups((prev) => {
      // 이미 접힘 상태가 있다면 유지, 없으면 기본값
      const next = new Set(prev);
      for (const title of zeroFreq) {
        if (!prev.has(title) && !prev.has(`exp:${title}`)) next.add(title);
      }
      return next;
    });
  }, [sortedGroups, usageCounts]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('admin.sidebar-mode', sidebarMode);
    }
  }, [sidebarMode]);

  // ── 사이드바 배지 통합 fetch (SWR 60초 폴링) ──────────────────────────
  // 감사: docs/audits/2026-05-11-admin-perf-audit.md
  // 기존 5개 fetch + setInterval → 단일 RPC + SWR dedup + 30s 캐시.
  const { data: badges } = useSWR<{
    pendingActions: number;
    unmatchedPending: number;
    pendingPackages: number;
    ledgerDrift: number;
    blogQueue: number;
  }>('/api/admin/badge-counts', {
    refreshInterval: 60_000,
    dedupingInterval: 30_000,
  });
  const pendingActionsCount = badges?.pendingActions ?? 0;
  const unmatchedAttrCount  = badges?.unmatchedPending ?? 0;
  const pendingReviewCount  = badges?.pendingPackages ?? 0;
  const ledgerDriftCount    = badges?.ledgerDrift ?? 0;
  const blogQueueCount      = badges?.blogQueue ?? 0;

  // ShortcutsBridge → CommandPalette 토글 이벤트 수신
  useEffect(() => {
    const handler = () => setCmdOpen((v) => !v);
    window.addEventListener('admin:toggle-cmd', handler);
    return () => window.removeEventListener('admin:toggle-cmd', handler);
  }, []);

  const handleLogout = async () => {
    await fetch('/api/auth/session', { method: 'DELETE' });
    router.push('/login');
  };

  const isActive = useCallback(
    (item: NavItem) => {
      if (item.exact) return pathname === item.href;
      return pathname === item.href || pathname.startsWith(item.href + '/');
    },
    [pathname],
  );

  const currentPage = useMemo(
    () => visibleGroups.flatMap((g) => g.items as NavItem[]).find((item) => isActive(item))?.label || '대시보드',
    [isActive, visibleGroups],
  );

  const favoriteItems = useMemo(
    () => favs.map((href) => allItems.find((it) => it.href === href)).filter(Boolean) as NavItem[],
    [favs],
  );

  const itemBadge = (item: NavItem): number | undefined => {
    if (item.href === '/admin/jarvis' && pendingActionsCount > 0) return pendingActionsCount;
    if (item.href === '/admin/attractions/unmatched' && unmatchedAttrCount > 0) return unmatchedAttrCount;
    if (item.href === '/admin/payments/reconcile' && ledgerDriftCount > 0) return ledgerDriftCount;
    if (item.href === '/admin/products/review' && pendingReviewCount > 0) return pendingReviewCount;
    if (item.href === '/admin/blog/queue' && blogQueueCount > 0) return blogQueueCount;
    return undefined;
  };

  // ── ⌘K 명령 카탈로그 (네비 + 액션) ──────────────────────────
  const staticCommands: AdminCommand[] = useMemo(() => {
    const navCmds: AdminCommand[] = visibleGroups.flatMap((g) =>
      g.items
        .filter((it): it is NavItem => !('divider' in it))
        .map((it) => ({
          id: `nav:${it.href}`,
          kind: 'navigate' as const,
          label: it.label,
          group: g.title,
          icon: it.icon,
          href: it.href,
        })),
    );
    const actionCmds: AdminCommand[] = [
      {
        id: 'action:density-toggle',
        kind: 'action',
        label: '행 밀도 토글 (편안함 ↔ 컴팩트)',
        keywords: ['density', '밀도', 'compact', 'comfortable'],
        group: '뷰',
        shortcut: 'D',
      },
      {
        id: 'action:help',
        kind: 'action',
        label: '단축키 도움말 보기',
        keywords: ['help', 'shortcut', '단축키', '도움말'],
        group: '검색·도움',
        shortcut: '?',
      },
      {
        id: 'action:logout',
        kind: 'action',
        label: '로그아웃',
        keywords: ['logout', 'signout', '로그아웃'],
        group: '시스템',
      },
    ];
    return [...navCmds, ...actionCmds];
  }, [visibleGroups]);

  return (
    <div className="admin-scope min-h-screen bg-admin-bg flex">
      {/* ── 사이드바 ─────────────────────────────────── */}
      <aside
        className={`fixed top-0 left-0 h-full bg-admin-surface border-r border-admin-border z-40 transition-all duration-200 flex flex-col overflow-hidden ${
          sidebarMode === 'slim' ? 'w-14' : 'w-52'
        }`}
      >
        {/* 로고 */}
        <div className={`h-14 flex items-center border-b border-admin-border ${sidebarMode === 'slim' ? 'justify-center px-2' : 'px-4 gap-2'}`}>
          {sidebarMode === 'slim' ? (
            <span className="text-brand font-bold text-sm leading-none">OS</span>
          ) : (
            <>
              <span className="text-admin-base font-bold tracking-tight text-brand">여소남 OS</span>
              <span className="text-admin-2xs text-admin-muted font-medium uppercase tracking-wider">ERP</span>
            </>
          )}
        </div>

        {/* 메뉴 */}
        <nav className={`flex-1 overflow-y-auto py-3 space-y-1 ${sidebarMode === 'slim' ? 'px-1' : 'px-2'}`}>
          {/* 즐겨찾기 — slim 모드에서 숨김 */}
          {sidebarMode === 'full' && favoriteItems.length > 0 && (
            <div className="pb-2 mb-2 border-b border-admin-border">
              <div className="px-2 pb-1.5 flex items-center gap-1.5 text-admin-2xs font-semibold text-warning uppercase tracking-[0.08em]">
                <Star size={11} fill="currentColor" />
                즐겨찾기
              </div>
              <div className="space-y-0.5">
                {favoriteItems.map((item) => (
                  <SidebarItem
                    key={`fav-${item.href}`}
                    item={item}
                    active={isActive(item)}
                    isFavorite
                    onToggleFav={toggleFav}
                    badge={itemBadge(item)}
                    onNavClick={trackNavClick}
                  />
                ))}
              </div>
            </div>
          )}

          {/* 그룹별 메뉴 — 동적 정렬 + 접힘 가능 */}
          {sortedGroups.map((group, gi) => {
            const GroupIcon = group.icon;
            const slim = sidebarMode === 'slim';
            const isCollapsed = collapsedGroups.has(group.title);
            const showToggle = group.items.length > 3; // 항목이 4개 이상일 때만 접기 가능

            if (slim) {
              // slim 모드: 접힘 없음, 아이템만 표시
              return (
                <div
                  key={group.title}
                  className={gi > 0 ? 'pt-1 mt-1 border-t border-admin-border' : ''}
                >
                  <div className="flex flex-col items-center gap-0.5">
                    {group.items.map((item, idx) =>
                      'divider' in item ? null : (
                        <SidebarItem
                          key={item.href}
                          item={item}
                          active={isActive(item)}
                          isFavorite={isFav(item.href)}
                          onToggleFav={toggleFav}
                          badge={itemBadge(item)}
                          slim
                          onNavClick={trackNavClick}
                        />
                      )
                    )}
                  </div>
                </div>
              );
            }

            return (
              <div
                key={group.title}
                className={gi > 0 ? 'pt-1 mt-1 border-t border-admin-border' : ''}
              >
                {/* 그룹 헤더 */}
                <div
                  className={`px-2 pb-1.5 flex items-center gap-1.5 text-admin-2xs font-semibold text-admin-muted uppercase tracking-[0.08em] ${
                    showToggle ? 'cursor-pointer select-none hover:text-admin-text' : ''
                  }`}
                  onClick={() => {
                    if (!showToggle) return;
                    setCollapsedGroups((prev) => {
                      const next = new Set(prev);
                      if (next.has(group.title)) {
                        next.delete(group.title);
                        next.add(`exp:${group.title}`); // 명시적 펼침 기록
                      } else {
                        next.delete(`exp:${group.title}`);
                        next.add(group.title);
                      }
                      return next;
                    });
                  }}
                >
                  <GroupIcon size={11} />
                  {group.title}
                  {showToggle && (
                    <span className="ml-auto text-admin-2xs text-admin-muted-2">
                      {isCollapsed ? (
                        <ChevronRight size={11} />
                      ) : (
                        <ChevronDown size={11} />
                      )}
                    </span>
                  )}
                </div>

                {/* 아이템 목록 */}
                {!isCollapsed && (
                  <div className="space-y-0.5">
                    {group.items.map((item, idx) =>
                      'divider' in item ? (
                        <div key={`div-${idx}`} className="px-2 pt-2.5 pb-0.5 text-[10px] font-semibold text-admin-muted-2 uppercase tracking-[0.06em]">
                          {item.label}
                        </div>
                      ) : (
                        <SidebarItem
                          key={item.href}
                          item={item}
                          active={isActive(item)}
                          isFavorite={isFav(item.href)}
                          onToggleFav={toggleFav}
                          badge={itemBadge(item)}
                          onNavClick={trackNavClick}
                        />
                      )
                    )}
                  </div>
                )}

                {/* 접힌 상태에서 더보기 버튼 */}
                {isCollapsed && (
                  <button
                    onClick={() => {
                      setCollapsedGroups((prev) => {
                        const next = new Set(prev);
                        next.delete(group.title);
                        next.add(`exp:${group.title}`);
                        return next;
                      });
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-admin-sm text-admin-xs text-admin-muted-2 hover:text-admin-text hover:bg-admin-surface-2 transition-colors"
                  >
                    <ChevronRight size={12} />
                    더보기 ({group.items.length}개)
                  </button>
                )}
              </div>
            );
          })}
        </nav>

        {/* ── AI 추천 메뉴 (full 모드, 방문 기록 있을 때) ────── */}
        {sidebarMode === 'full' && (
          <NavRecommendations
            groups={sortedGroups}
            usageCounts={usageCounts}
            onNavClick={trackNavClick}
          />
        )}

        {/* ── 사이드바 AI 명령 위젯 ──────────────────── */}
        {sidebarMode === 'full' && <SidebarAIWidget />}

        {/* 하단 — Density Toggle + 로그아웃 */}
        {sidebarMode === 'slim' ? (
          <div className="border-t border-admin-border px-1 py-3 flex flex-col items-center gap-1">
            <button
              onClick={handleLogout}
              title="로그아웃"
              className="p-2 rounded-admin-sm text-admin-muted hover:text-admin-text hover:bg-admin-surface-2 transition-colors duration-160"
            >
              <LogOut size={16} />
            </button>
          </div>
        ) : (
          <div className="px-3 py-3 border-t border-admin-border space-y-1.5">
            <div className="px-1">
              <DensityToggle className="!text-admin-muted hover:!text-admin-text hover:!bg-admin-surface-2 w-full justify-center" />
            </div>
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2 px-3 py-1.5 rounded-admin-sm text-admin-sm text-admin-text-2 hover:text-admin-text hover:bg-admin-surface-2 transition-colors duration-160"
            >
              <LogOut size={14} />
              로그아웃
            </button>
          </div>
        )}
      </aside>

      {/* ── 메인 영역 ────────────────────────────────── */}
      <div
        className={`flex-1 flex flex-col min-h-screen transition-all duration-200 ${
          sidebarMode === 'slim' ? 'ml-14' : 'ml-52'
        }`}
      >
        {/* 상단바 */}
        <header className="sticky top-0 z-30 bg-admin-surface border-b border-admin-border h-14 px-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarMode(m => m === 'full' ? 'slim' : 'full')}
              className="p-1.5 rounded-admin-sm hover:bg-admin-surface-2 text-admin-muted hover:text-admin-text transition-colors duration-160"
              aria-label="사이드바 토글"
            >
              <MenuIcon size={18} />
            </button>
            <h1 className="text-admin-h3 tracking-tight text-admin-text">
              {currentPage}
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <AlertsBadge />
            <SearchInput
              variant="topbar"
              placeholder="통합검색..."
              kbd="⌘K"
              width="280px"
              onClick={() => setCmdOpen(true)}
              className="hidden sm:flex"
            />
          </div>
        </header>

        {/* 콘텐츠 */}
        <main
          className="flex-1 px-4 lg:px-6 py-5"
          data-density={density}
        >
          {/* 인텐트 기반 AI 추천 바 */}
          {sidebarMode === 'full' && (
            <IntentRecommendationsBar
              pathname={pathname}
              usageCounts={usageCounts}
              onNavClick={trackNavClick}
            />
          )}
          {children}
        </main>
      </div>

      {/* ── 글로벌 ⌘K 명령 팔레트 ─────────────────── */}
      <CommandPalette
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        staticCommands={staticCommands}
        onRunAction={(cmd) => {
          if (cmd.id === 'action:density-toggle') {
            // density toggle은 ShortcutsBridge 안에서 처리되도록 이벤트 위임
            window.dispatchEvent(new CustomEvent('admin:toggle-density'));
          } else if (cmd.id === 'action:help') {
            window.dispatchEvent(new CustomEvent('admin:open-help'));
          } else if (cmd.id === 'action:logout') {
            handleLogout();
          }
        }}
      />

      {/* ── 단축키 도움말 모달 ─────────────────── */}
      <KeyboardShortcutsHelp />
    </div>
  );
}

/**
 * ShortcutsBridge — DensityProvider 안에서 useDensity()를 호출해
 * ShortcutsProvider 에 onToggleDensity 핸들러를 주입한다.
 * cmdOpen 토글은 'admin:toggle-cmd' 커스텀 이벤트로 위임 (단방향, 디커플드).
 */
function ShortcutsBridge({ children }: { children: React.ReactNode }) {
  const { toggle: toggleDensity } = useDensity();

  return (
    <ShortcutsProvider
      onOpenCommandPalette={() => {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('admin:toggle-cmd'));
        }
      }}
      onToggleDensity={toggleDensity}
    >
      <HelpEventBridge />
      {children}
    </ShortcutsProvider>
  );
}

/** CommandPalette 의 'action:help' 이벤트를 useShortcuts.setHelpOpen 으로 변환 */
function HelpEventBridge() {
  const { setHelpOpen } = useShortcuts();
  useEffect(() => {
    const onOpen = () => setHelpOpen(true);
    window.addEventListener('admin:open-help', onOpen);
    return () => window.removeEventListener('admin:open-help', onOpen);
  }, [setHelpOpen]);
  return null;
}

/**
 * AI 메뉴 추천 — 사용 빈도가 낮지만 중요할 수 있는 메뉴를 추천.
 * 모든 항목 중 방문 횟수 0~1회이고, 즐겨찾기에 없는 항목 중에서 최대 3개 추천.
 */
function NavRecommendations({
  groups,
  usageCounts,
  onNavClick,
}: {
  groups: NavGroup[];
  usageCounts: Record<string, number>;
  onNavClick: (href: string) => void;
}) {
  const [dismissed, setDismissed] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem('admin.nav-recs-dismissed');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });

  // 방문 3회 미만 + 즐겨찾기 없는 항목 중 랜덤 추천
  const recs = useMemo(() => {
    const all: NavItem[] = [];
    for (const g of groups) {
      for (const it of g.items) {
        if (!('divider' in it)) all.push(it);
      }
    }

    const totalVisits = Object.values(usageCounts).reduce((s, c) => s + c, 0);
    // 전체 방문이 5회 미만이면 아직 학습 중 — 추천 숨김
    if (totalVisits < 5) return [];

    const candidates = all.filter(
      (it) => (usageCounts[it.href] ?? 0) < 3 && !dismissed.includes(it.href),
    );

    // 최대 3개, 우선순위: 사이드바에서 먼 그룹/아이템 중 랜덤
    return candidates
      .sort(() => Math.random() - 0.5)
      .slice(0, 3);
  }, [groups, usageCounts, dismissed]);

  if (recs.length === 0) return null;

  return (
    <div className="border-t border-admin-border px-2 py-2">
      <div className="px-2 pb-1 flex items-center gap-1.5 text-admin-2xs font-semibold text-brand uppercase tracking-[0.08em]">
        <Sparkle size={10} />
        추천 메뉴
      </div>
      <div className="space-y-0.5">
        {recs.map((item) => {
          const Icon = item.icon;
          return (
            <div key={`rec-${item.href}`} className="group relative">
              <Link
                href={item.href}
                onClick={() => onNavClick(item.href)}
                className="flex items-center gap-2.5 px-2.5 py-1 rounded-admin-sm text-admin-xs text-admin-text-2 hover:text-admin-text hover:bg-admin-surface-2 transition-colors duration-160"
              >
                <Icon size={12} strokeWidth={2} className="shrink-0 text-brand" />
                <span className="truncate">{item.label}</span>
              </Link>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDismissed((prev) => {
                    const next = [...prev, item.href];
                    try {
                      window.localStorage.setItem('admin.nav-recs-dismissed', JSON.stringify(next));
                    } catch { /* ignore */ }
                    return next;
                  });
                }}
                title="이 추천 닫기"
                className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded text-admin-muted-2 opacity-0 group-hover:opacity-100 hover:text-admin-text transition-opacity"
              >
                <X size={10} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminSwrProvider>
      <DensityProvider>
        <ShortcutsBridge>
          <AdminLayoutInner>{children}</AdminLayoutInner>
        </ShortcutsBridge>
      </DensityProvider>
    </AdminSwrProvider>
  );
}
