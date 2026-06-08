'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect, useCallback, useMemo } from 'react';
import useSWR from 'swr';
import {
  Sparkles as Sparkle, Newspaper,
  Bot, ClipboardCheck,
  LogOut, Star, StarOff, Menu as MenuIcon,
  ArrowLeftRight, Unlink,
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
import {
  buildAdminMissionItems,
  filterActiveMissionItems,
  getMissionTotal,
  type AdminBadgeCounts,
  type AdminMissionId,
  type AdminMissionItem,
  type AdminMissionTone,
} from '@/lib/admin-mission-control';
import {
  adminNavGroups,
  allAdminNavItems,
  filterNavGroups,
  getNavItemBadge,
  type NavGroup,
  type NavItem,
} from '@/lib/admin-navigation';

// ── 역할 기반 접근 제어 타입 ─────────────────────────────
export type { MenuRoleLevel } from '@/lib/admin-mission-control';

const FAV_STORAGE_KEY = 'admin.favorites';
const FAV_LIMIT = 7;

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

const missionIconMap: Record<AdminMissionId, LucideIcon> = {
  'jarvis-actions': Bot,
  'package-review': ClipboardCheck,
  'attraction-matching': Unlink,
  'payment-matching': ArrowLeftRight,
  'blog-queue': Newspaper,
};

const missionToneClass: Record<AdminMissionTone, string> = {
  danger: 'border-red-200 bg-red-50 text-red-700 hover:border-red-300',
  warning: 'border-amber-200 bg-amber-50 text-amber-800 hover:border-amber-300',
  info: 'border-blue-200 bg-blue-50 text-blue-700 hover:border-blue-300',
};

const missionSlimToneClass: Record<AdminMissionTone, string> = {
  danger: 'bg-red-50 text-red-700 hover:bg-red-100',
  warning: 'bg-amber-50 text-amber-800 hover:bg-amber-100',
  info: 'bg-blue-50 text-blue-700 hover:bg-blue-100',
};

function formatMissionComputedAt(value: string | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function formatMissionSlo(minutes: number) {
  if (minutes >= 1440) return `${Math.round(minutes / 1440)}d`;
  if (minutes >= 60) return `${Math.round(minutes / 60)}h`;
  return `${minutes}m`;
}

function MissionControlRail({
  items,
  userRole,
  onNavClick,
  computedAt,
}: {
  items: AdminMissionItem[];
  userRole: string | undefined;
  onNavClick: (href: string) => void;
  computedAt?: string;
}) {
  const activeItems = filterActiveMissionItems(items, userRole);
  const total = getMissionTotal(activeItems);
  const computedAtLabel = formatMissionComputedAt(computedAt);

  if (activeItems.length === 0) return null;

  return (
    <div className="mb-2 border-b border-admin-border pb-2">
      <div className="flex items-center gap-2 px-2 pb-1.5 text-admin-2xs font-semibold uppercase tracking-[0.08em] text-admin-muted">
        <span>오늘 처리</span>
        <span className="ml-auto rounded-full bg-admin-surface-2 px-1.5 py-0.5 text-[10px] font-bold text-admin-text tabular-nums">
          {total}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-1">
        {activeItems.map((item) => {
          const Icon = missionIconMap[item.id];
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.description}
              onClick={() => onNavClick(item.href)}
              className={`flex min-h-10 items-center gap-2 rounded-admin-sm border px-2 py-1.5 text-admin-xs font-medium transition-colors ${missionToneClass[item.tone]}`}
            >
              <Icon size={13} className="shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{item.label}</span>
                <span className="block truncate text-[10px] font-normal opacity-80">{item.actionLabel}</span>
                <span className="block truncate text-[10px] font-normal opacity-70">
                  {item.owner} · SLA {formatMissionSlo(item.sloMinutes)}
                </span>
              </span>
              <span className="rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] font-bold tabular-nums">
                {item.count}
              </span>
            </Link>
          );
        })}
      </div>
      {computedAtLabel && (
        <div className="px-2 pt-1.5 text-[10px] text-admin-muted-2">
          갱신 {computedAtLabel}
        </div>
      )}
    </div>
  );
}

function MissionControlSlimRail({
  items,
  userRole,
  onNavClick,
}: {
  items: AdminMissionItem[];
  userRole: string | undefined;
  onNavClick: (href: string) => void;
}) {
  const activeItems = filterActiveMissionItems(items, userRole).slice(0, 5);

  if (activeItems.length === 0) return null;

  return (
    <div className="mb-2 border-b border-admin-border pb-2">
      <div className="flex flex-col items-center gap-1">
        {activeItems.map((item) => {
          const Icon = missionIconMap[item.id];
          return (
            <Link
              key={item.href}
              href={item.href}
              title={`${item.label} ${item.count}건 - ${item.actionLabel}`}
              onClick={() => onNavClick(item.href)}
              className={`relative flex h-9 w-9 items-center justify-center rounded-admin-md transition-colors ${missionSlimToneClass[item.tone]}`}
            >
              <Icon size={15} />
              <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-danger px-0.5 text-[8px] font-bold leading-none text-white">
                {item.count > 9 ? '9+' : item.count}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
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
  const [sidebarMode, setSidebarMode] = useState<'full' | 'slim'>('full');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [usageCounts, setUsageCounts] = useState<Record<string, number>>({});
  const [hasHydrated, setHasHydrated] = useState(false);
  const { favs, isFav, toggle: toggleFav } = useFavorites();
  const { role: userRole } = useUserRole();
  const { trackNavClick } = useNavLogger();
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    // 처음엔 빈 Set — 초기 상태는 frequency 기반으로 아래 useMemo에서 결정
    return new Set();
  });

  useAutoRefreshSession();

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  const navRole = hasHydrated ? userRole : undefined;

  /** 사용자 역할에 따라 필터링된 메뉴 */
  const visibleGroups = useMemo(
    () => filterNavGroups(adminNavGroups, navRole),
    [navRole],
  );

  /** 그룹 위치는 안정적으로 유지하고, 방문 빈도는 hydration 이후 추천/접힘 판단에만 사용한다. */
  const sortedGroups = visibleGroups;

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('admin.sidebar-mode');
      if (saved === 'full' || saved === 'slim') setSidebarMode(saved);
    } catch {
      // ignore
    }
    setUsageCounts(readNavUsage());
  }, []);

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
  const { data: badges } = useSWR<AdminBadgeCounts>('/api/admin/badge-counts', {
    refreshInterval: 60_000,
    dedupingInterval: 30_000,
  });

  const visibleBadges = hasHydrated ? badges : undefined;
  const missionItems = useMemo(() => buildAdminMissionItems(visibleBadges), [visibleBadges]);

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

  const handleNavClick = useCallback((href: string) => {
    trackNavClick(href);
    setUsageCounts((prev) => ({ ...prev, [href]: (prev[href] ?? 0) + 1 }));
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setMobileSidebarOpen(false);
    }
  }, [trackNavClick]);

  const isActive = useCallback(
    (item: NavItem) => {
      const hrefPath = item.href.split('?')[0];
      if (item.exact) return pathname === hrefPath;
      return pathname === hrefPath || pathname.startsWith(hrefPath + '/');
    },
    [pathname],
  );

  const currentPage = useMemo(
    () => visibleGroups.flatMap((g) => g.items as NavItem[]).find((item) => isActive(item))?.label || '대시보드',
    [isActive, visibleGroups],
  );

  const favoriteItems = useMemo(
    () => favs.map((href) => allAdminNavItems.find((it) => it.href === href)).filter(Boolean) as NavItem[],
    [favs],
  );

  const itemBadge = useCallback(
    (item: NavItem): number | undefined => getNavItemBadge(item, visibleBadges),
    [visibleBadges],
  );

  // ── ⌘K 명령 카탈로그 (네비 + 액션) ──────────────────────────
  const staticCommands: AdminCommand[] = useMemo(() => {
    const missionCmds: AdminCommand[] = filterActiveMissionItems(missionItems, navRole).map((item) => ({
      id: `mission:${item.id}`,
      kind: 'navigate' as const,
      label: `${item.label} ${item.count}건`,
      keywords: ['오늘 처리', item.label, item.actionLabel, item.owner, item.domain, `sla:${item.sloMinutes}`],
      group: '오늘 처리',
      icon: missionIconMap[item.id],
      href: item.href,
    }));
    const navCmds: AdminCommand[] = visibleGroups.flatMap((g) =>
      g.items
        .filter((it): it is NavItem => !('divider' in it))
        .map((it) => ({
          id: `nav:${it.href}`,
          kind: 'navigate' as const,
          label: it.label,
          keywords: [g.title, it.primaryAction, ...(it.searchKeywords ?? [])].filter(Boolean) as string[],
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
    return [...missionCmds, ...navCmds, ...actionCmds];
  }, [missionItems, navRole, visibleGroups]);

  return (
    <div className="admin-scope min-h-screen bg-admin-bg flex" data-density={density}>
      {mobileSidebarOpen && (
        <button
          type="button"
          aria-label="사이드바 닫기"
          onClick={() => setMobileSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-slate-950/35 md:hidden"
        />
      )}
      {/* ── 사이드바 ─────────────────────────────────── */}
      <aside
        className={`fixed top-0 left-0 h-full bg-admin-surface border-r border-admin-border z-40 transition-all duration-200 flex flex-col overflow-hidden ${
          mobileSidebarOpen ? 'visible' : 'invisible md:visible'
        } ${
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        } ${
          sidebarMode === 'slim' ? 'w-14' : 'w-64 md:w-52'
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
          {sidebarMode === 'full' && (
            <MissionControlRail
              items={missionItems}
              userRole={navRole}
              onNavClick={handleNavClick}
              computedAt={visibleBadges?.computedAt}
            />
          )}
          {sidebarMode === 'slim' && (
            <MissionControlSlimRail
              items={missionItems}
              userRole={navRole}
              onNavClick={handleNavClick}
            />
          )}
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
                    onNavClick={handleNavClick}
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
                          onNavClick={handleNavClick}
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
                          onNavClick={handleNavClick}
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
            onNavClick={handleNavClick}
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
          sidebarMode === 'slim' ? 'md:ml-14' : 'md:ml-52'
        }`}
      >
        {/* 상단바 */}
        <header className="sticky top-0 z-30 bg-admin-surface border-b border-admin-border h-14 px-3 md:px-4 flex items-center justify-between">
          <div className="flex items-center gap-2 md:gap-3 min-w-0">
            <button
              onClick={() => {
                if (typeof window !== 'undefined' && window.innerWidth < 768) {
                  setMobileSidebarOpen(true);
                  return;
                }
                setSidebarMode(m => m === 'full' ? 'slim' : 'full');
              }}
              className="p-1.5 rounded-admin-sm hover:bg-admin-surface-2 text-admin-muted hover:text-admin-text transition-colors duration-160"
              aria-label="사이드바 토글"
            >
              <MenuIcon size={18} />
            </button>
            <h1 className="text-admin-h3 tracking-tight text-admin-text truncate">
              {currentPage}
            </h1>
          </div>

          <div className="flex items-center gap-2 shrink-0">
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
  const [dismissed, setDismissed] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('admin.nav-recs-dismissed');
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) {
        setDismissed(parsed.filter((v) => typeof v === 'string'));
      }
    } catch {
      // ignore
    }
  }, []);

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
