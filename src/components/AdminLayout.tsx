'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  LayoutDashboard, Inbox, BookOpenCheck, Users, Wallet, FileText,
  Package, ClipboardCheck, Upload, Building2, ScrollText, MapPinned, Mountain,
  Handshake, BarChart3, UserPlus, FileQuestion, Headset, Layers,
  BookCopy, Coins, Calculator,
  Megaphone, Sparkles as Sparkle, Newspaper, FolderKanban, ListChecks, TrendingUp, AlertTriangle, Search as SearchIcon, BookOpen,
  Bot, Wand2, MessageCircle,
  Activity, Siren,
  LogOut, Star, StarOff, Menu as MenuIcon,
  type LucideIcon,
} from 'lucide-react';
import { useAutoRefreshSession } from '@/hooks/useAutoRefreshSession';
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

// ── 카테고리 그룹핑 사이드바 메뉴 ─────────────────────────────
interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
}

interface NavGroup {
  title: string;
  icon: LucideIcon;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    title: '운영',
    icon: Inbox,
    items: [
      { href: '/admin',                label: '대시보드',     icon: LayoutDashboard, exact: true },
      { href: '/admin/inbox',          label: 'Inbox 액션',   icon: Inbox },
      { href: '/admin/bookings',       label: '예약 관리',    icon: BookOpenCheck },
      { href: '/admin/customers',      label: '고객 관리',    icon: Users },
      { href: '/admin/payments',       label: '입금 관리',    icon: Wallet },
      { href: '/admin/booking-guide',  label: '예약 안내문',  icon: FileText },
    ],
  },
  {
    title: '상품',
    icon: Package,
    items: [
      { href: '/admin/packages',             label: '상품 관리',    icon: Package },
      { href: '/admin/products/review',      label: '상품 검수',    icon: ClipboardCheck },
      { href: '/admin/upload',               label: '업로드',       icon: Upload },
      { href: '/admin/land-operators',       label: '랜드사 관리',  icon: Building2 },
      { href: '/admin/terms-templates',      label: '약관 템플릿',  icon: ScrollText },
      { href: '/admin/departing-locations',  label: '출발지 관리',  icon: MapPinned },
      { href: '/admin/attractions',          label: '관광지 관리',  icon: Mountain },
    ],
  },
  {
    title: '영업',
    icon: BarChart3,
    items: [
      { href: '/admin/affiliates',           label: '제휴/인플루언서', icon: Handshake },
      { href: '/admin/affiliate-analytics',  label: '제휴 분석',       icon: BarChart3 },
      { href: '/admin/applications',         label: '파트너 신청',     icon: UserPlus },
      { href: '/admin/rfqs',                 label: '단체 RFQ',        icon: FileQuestion },
      { href: '/admin/concierge',            label: '컨시어지',        icon: Headset },
      { href: '/admin/tenants',              label: '테넌트 관리',     icon: Layers },
    ],
  },
  {
    title: '재무',
    icon: Wallet,
    items: [
      { href: '/admin/ledger',       label: '통합 장부',  icon: BookCopy },
      { href: '/admin/settlements',  label: '정산 관리',  icon: Coins },
      { href: '/admin/tax',          label: '세무 관리',  icon: Calculator },
    ],
  },
  {
    title: '마케팅',
    icon: Megaphone,
    items: [
      { href: '/admin/marketing',                 label: '마케팅 대시',   icon: Megaphone },
      { href: '/admin/marketing/creatives',       label: '크리에이티브',  icon: Sparkle },
      { href: '/admin/marketing/card-news',       label: '카드뉴스',      icon: Newspaper },
      { href: '/admin/content-hub',               label: '콘텐츠 허브',   icon: FolderKanban },
      { href: '/admin/content-queue',             label: '콘텐츠 검수',   icon: ListChecks },
      { href: '/admin/content-analytics',         label: '콘텐츠 성과',   icon: TrendingUp },
      { href: '/admin/content-gaps',              label: '콘텐츠 갭',     icon: AlertTriangle },
      { href: '/admin/search-ads',                label: '검색광고',      icon: SearchIcon },
      { href: '/admin/blog',                      label: '블로그',        icon: BookOpen },
    ],
  },
  {
    title: 'AI',
    icon: Bot,
    items: [
      { href: '/admin/jarvis',    label: '자비스 AI',  icon: Bot },
      { href: '/admin/generate',  label: 'AI 생성',    icon: Wand2 },
      { href: '/admin/qa',        label: 'Q&A 챗봇',   icon: MessageCircle },
    ],
  },
  {
    title: '시스템',
    icon: Activity,
    items: [
      { href: '/admin/control-tower',  label: 'OS 관제탑',     icon: Activity },
      { href: '/admin/escalations',    label: '에스컬레이션',  icon: Siren },
    ],
  },
];

const FAV_STORAGE_KEY = 'admin.favorites';
const FAV_LIMIT = 7;

const allItems: NavItem[] = navGroups.flatMap((g) => g.items);

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
  badge?: number;
}

function SidebarItem({ item, active, isFavorite, onToggleFav, badge }: SidebarItemProps) {
  const Icon = item.icon;
  return (
    <div className="group relative">
      <Link
        href={item.href}
        prefetch
        className={`flex items-center gap-2.5 pl-3 pr-2 py-2 rounded-md text-admin-sm transition-colors relative ${
          active
            ? 'bg-blue-500/20 text-white font-semibold border-l-[3px] border-blue-400 pl-[9px]'
            : 'text-blue-100/70 hover:text-white hover:bg-white/5'
        }`}
      >
        <Icon size={15} strokeWidth={2.1} className="shrink-0" />
        <span className="truncate">{item.label}</span>
        {badge != null && badge > 0 && (
          <span className="ml-auto bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center leading-none">
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
            ? 'text-yellow-300 opacity-90'
            : 'text-blue-100/30 opacity-0 group-hover:opacity-100 hover:text-yellow-300'
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [pendingActionsCount, setPendingActionsCount] = useState(0);
  const { favs, isFav, toggle: toggleFav } = useFavorites();

  useAutoRefreshSession();

  useEffect(() => {
    const fetchCount = () => {
      fetch('/api/agent-actions?status=pending&limit=1')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d?.total != null) setPendingActionsCount(d.total);
        })
        .catch(() => {});
    };
    fetchCount();
    const interval = setInterval(fetchCount, 60000);
    return () => clearInterval(interval);
  }, []);

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
    () => allItems.find((item) => isActive(item))?.label || '대시보드',
    [isActive],
  );

  const favoriteItems = useMemo(
    () => favs.map((href) => allItems.find((it) => it.href === href)).filter(Boolean) as NavItem[],
    [favs],
  );

  const itemBadge = (item: NavItem): number | undefined => {
    if (item.href === '/admin/jarvis' && pendingActionsCount > 0) return pendingActionsCount;
    return undefined;
  };

  // ── ⌘K 명령 카탈로그 (네비 + 액션) ──────────────────────────
  const staticCommands: AdminCommand[] = useMemo(() => {
    const navCmds: AdminCommand[] = navGroups.flatMap((g) =>
      g.items.map((it) => ({
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
  }, []);

  return (
    <div className="min-h-screen bg-admin-bg flex">
      {/* ── 사이드바 ─────────────────────────────────── */}
      <aside
        className={`fixed top-0 left-0 h-full bg-admin-accent text-white z-40 transition-all duration-200 flex flex-col ${
          sidebarOpen ? 'w-56' : 'w-0 -translate-x-full'
        }`}
      >
        {/* 로고 */}
        <div className="px-4 py-4 flex items-center gap-2 border-b border-white/10">
          <span className="text-admin-md font-bold tracking-tight">Yeosonam OS</span>
          <span className="text-admin-xs text-blue-300/60 font-medium">ERP</span>
        </div>

        {/* 메뉴 */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-1">
          {/* 즐겨찾기 */}
          {favoriteItems.length > 0 && (
            <div className="pb-2 mb-2 border-b border-white/10">
              <div className="px-2 pb-1.5 flex items-center gap-1.5 text-admin-xs font-semibold text-yellow-200/70 uppercase tracking-[0.08em]">
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
                  />
                ))}
              </div>
            </div>
          )}

          {/* 그룹별 메뉴 */}
          {navGroups.map((group, gi) => {
            const GroupIcon = group.icon;
            return (
              <div
                key={group.title}
                className={gi > 0 ? 'pt-2 mt-2 border-t border-white/10' : ''}
              >
                <div className="px-2 pb-1.5 flex items-center gap-1.5 text-admin-xs font-semibold text-blue-300/60 uppercase tracking-[0.08em]">
                  <GroupIcon size={11} />
                  {group.title}
                </div>
                <div className="space-y-0.5">
                  {group.items.map((item) => (
                    <SidebarItem
                      key={item.href}
                      item={item}
                      active={isActive(item)}
                      isFavorite={isFav(item.href)}
                      onToggleFav={toggleFav}
                      badge={itemBadge(item)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        {/* 하단 — Density Toggle + 로그아웃 */}
        <div className="px-3 py-3 border-t border-white/10 space-y-1.5">
          <div className="px-1">
            <DensityToggle className="!text-blue-100/70 hover:!text-white hover:!bg-white/10 w-full justify-center" />
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-admin-sm text-blue-100/60 hover:text-white hover:bg-white/5 transition-colors"
          >
            <LogOut size={14} />
            로그아웃
          </button>
        </div>
      </aside>

      {/* ── 메인 영역 ────────────────────────────────── */}
      <div
        className={`flex-1 flex flex-col min-h-screen transition-all duration-200 ${
          sidebarOpen ? 'ml-56' : 'ml-0'
        }`}
      >
        {/* 상단바 */}
        <header className="sticky top-0 z-30 bg-white/85 backdrop-blur-md border-b border-admin-border px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-1.5 rounded hover:bg-slate-100 text-admin-textMuted hover:text-admin-text transition-colors"
              aria-label="사이드바 토글"
            >
              <MenuIcon size={18} />
            </button>
            <h1 className="text-admin-lg font-bold tracking-tight text-admin-text">
              {currentPage}
            </h1>
          </div>

          <div className="flex items-center gap-2">
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
          className="flex-1 px-4 lg:px-6 py-4 admin-scope"
          data-density={density}
        >
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

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <DensityProvider>
      <ShortcutsBridge>
        <AdminLayoutInner>{children}</AdminLayoutInner>
      </ShortcutsBridge>
    </DensityProvider>
  );
}
