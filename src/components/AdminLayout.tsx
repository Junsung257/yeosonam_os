'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  LayoutDashboard, Inbox, BookOpenCheck, Users, Wallet, FileText,
  Package, ClipboardCheck, Upload, Building2, ScrollText, MapPinned, Mountain, Globe,
  Handshake, BarChart3, UserPlus, FileQuestion, Headset, Layers, Compass,
  BookCopy, Coins, Calculator,
  Megaphone, Sparkles as Sparkle, Newspaper, FolderKanban, ListChecks, TrendingUp, AlertTriangle, Search as SearchIcon, BookOpen,
  Bot, Wand2, MessageCircle, MessageSquare, FilePlus2, LibraryBig,
  Activity, Siren, Timer,
  LogOut, Star, StarOff, Menu as MenuIcon, Eye,
  ArrowLeftRight, Unlink, FileSearch, PackagePlus, Combine,
  Receipt, Plane, Palette, Target, Zap, Send,
  Tags, BadgeDollarSign, Settings, PencilLine, GitBranch,
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
import AlertsBadge from './admin/AlertsBadge';

// ── 카테고리 그룹핑 사이드바 메뉴 ─────────────────────────────
interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
}

interface NavDivider {
  divider: true;
  label: string;
}

interface NavGroup {
  title: string;
  icon: LucideIcon;
  items: (NavItem | NavDivider)[];
}

const navGroups: NavGroup[] = [
  {
    title: '운영',
    icon: Inbox,
    items: [
      { href: '/admin',                    label: '대시보드',     icon: LayoutDashboard, exact: true },
      { href: '/admin/inbox',              label: 'Inbox 액션',   icon: Inbox },
      { href: '/admin/kakao-import',       label: '카톡 임포트',  icon: MessageSquare },
      { href: '/admin/bookings',           label: '예약 관리',    icon: BookOpenCheck },
      { href: '/admin/customers',          label: '고객 관리',    icon: Users },
      { href: '/admin/payments',           label: '입금 관리',    icon: Wallet },
      { href: '/admin/payments/reconcile', label: '입금 조정',    icon: ArrowLeftRight },
      { href: '/admin/booking-guide',      label: '예약 안내문',  icon: FileText },
      { href: '/admin/reviews',            label: '리뷰 감정분석', icon: Star },
      { href: '/admin/flight-alerts',      label: '항공 지연',    icon: Plane },
    ],
  },
  {
    title: '상품',
    icon: Package,
    items: [
      { href: '/admin/packages',                      label: '상품 관리',          icon: Package },
      { href: '/admin/products/stub',                 label: 'Stub 등록',          icon: FilePlus2 },
      { href: '/admin/products/review',               label: '상품 검수',          icon: ClipboardCheck },
      { href: '/admin/upload',                        label: '업로드',             icon: Upload },
      { href: '/admin/ir-preview',                    label: 'IR 미리보기',        icon: FileSearch },
      { href: '/admin/products/from-mrt',             label: 'MRT 상품 가져오기',  icon: PackagePlus },
      { href: '/admin/land-operators',                label: '랜드사 관리',        icon: Building2 },
      { href: '/admin/terms-templates',               label: '약관 템플릿',        icon: ScrollText },
      { href: '/admin/departing-locations',           label: '출발지 관리',        icon: MapPinned },
      { href: '/admin/attractions',                   label: '관광지 관리',        icon: Mountain },
      { href: '/admin/attractions/unmatched',         label: '미매칭 관광지',      icon: Unlink },
      { href: '/admin/destinations',                  label: '여행지 관리',        icon: Globe },
      { href: '/admin/products/assemble-free-travel', label: '자유여행 상품 조립', icon: Combine },
    ],
  },
  {
    title: '영업',
    icon: BarChart3,
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
      { href: '/admin/tenants',             label: '테넌트 관리',            icon: Layers },
    ],
  },
  {
    title: '재무',
    icon: Wallet,
    items: [
      { href: '/admin/ledger',                  label: '통합 장부',    icon: BookCopy },
      { href: '/admin/settlements',             label: '정산 관리',    icon: Coins },
      { href: '/admin/land-settlements',        label: '랜드사 정산',  icon: Receipt },
      { href: '/admin/tax',                     label: '세무 관리',    icon: Calculator },
      { href: '/admin/free-travel/settlements', label: '자유여행 정산', icon: Plane },
      { href: '/admin/invoice',              label: '인보이스 파싱', icon: Receipt },
    ],
  },
  {
    title: '마케팅',
    icon: Megaphone,
    items: [
      { divider: true as const, label: '캠페인/소재' },
      { href: '/admin/marketing',              label: '마케팅 대시',  icon: Megaphone },
      { href: '/admin/marketing/campaigns',    label: '캠페인',       icon: Target },
      { href: '/admin/marketing/creatives',    label: '크리에이티브', icon: Sparkle },
      { href: '/admin/marketing/brand-kits',   label: '브랜드 키트',  icon: Palette },
      { href: '/admin/marketing/card-news',    label: '카드뉴스',     icon: Newspaper },
      { href: '/admin/marketing/auto-publish', label: '자동 발행',    icon: Zap },
      { href: '/admin/marketing/published',    label: '발행 완료',    icon: Send },
      { divider: true as const, label: '콘텐츠' },
      { href: '/admin/content-hub',            label: '콘텐츠 허브',  icon: FolderKanban },
      { href: '/admin/content-queue',          label: '콘텐츠 검수',  icon: ListChecks },
      { href: '/admin/content-analytics',      label: '콘텐츠 성과',  icon: TrendingUp },
      { href: '/admin/content-gaps',           label: '콘텐츠 갭',    icon: AlertTriangle },
      { href: '/admin/search-ads',             label: '검색광고',     icon: SearchIcon },
      { divider: true as const, label: '블로그' },
      { href: '/admin/blog',                   label: '블로그',       icon: BookOpen },
      { href: '/admin/blog/queue',             label: '발행 큐',      icon: ListChecks },
      { href: '/admin/blog/rankings',          label: '순위 대시보드', icon: TrendingUp },
      { href: '/admin/blog/topical',           label: '토픽 권위',    icon: Layers },
      { href: '/admin/blog/policy',            label: '발행 정책',    icon: Activity },
      { href: '/admin/blog/categories',        label: '블로그 카테고리', icon: Tags },
      { href: '/admin/blog/ads',               label: '블로그 광고',  icon: BadgeDollarSign },
    ],
  },
  {
    title: 'AI',
    icon: Bot,
    items: [
      { href: '/admin/jarvis',                  label: '자비스 AI',         icon: Bot },
      { href: '/admin/jarvis/rag',              label: 'RAG 검색',          icon: SearchIcon },
      { href: '/admin/generate',                label: 'AI 생성',           icon: Wand2 },
      { href: '/admin/qa',                      label: 'Q&A 챗봇',          icon: MessageCircle },
      { href: '/admin/platform-learning',       label: 'AI 플라이휠',       icon: LibraryBig },
      { href: '/admin/agent-mas',               label: 'MAS 관제',         icon: GitBranch },
      { href: '/admin/extractions/corrections', label: 'AI 파싱 교정 이력', icon: PencilLine },
    ],
  },
  {
    title: '시스템',
    icon: Activity,
    items: [
      { href: '/admin/control-tower',  label: 'OS 관제탑',     icon: Activity },
      { href: '/admin/ops',            label: '크론·작업',     icon: Timer },
      { href: '/admin/escalations',    label: '에스컬레이션',  icon: Siren },
      { href: '/admin/scoring',        label: '점수 정책',     icon: Star },
      { href: '/admin/scoring/funnel', label: '추천 깔때기',   icon: TrendingUp },
      { href: '/admin/scoring/trends', label: '순위 변동',     icon: Activity },
      { href: '/admin/alerts',         label: '운영 알림',     icon: AlertTriangle },
      { href: '/admin/gdpr',           label: '개인정보 삭제', icon: AlertTriangle },
      { href: '/admin/blog/system',    label: '블로그 시스템', icon: Settings },
    ],
  },
];

const FAV_STORAGE_KEY = 'admin.favorites';
const FAV_LIMIT = 7;

const allItems: NavItem[] = navGroups.flatMap((g) =>
  g.items.filter((it): it is NavItem => !('divider' in it))
);

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
  slim?: boolean;
}

function SidebarItem({ item, active, isFavorite, onToggleFav, badge, slim }: SidebarItemProps) {
  const Icon = item.icon;

  if (slim) {
    return (
      <Link
        href={item.href}
        title={item.label}
        className={`relative flex items-center justify-center h-9 w-9 mx-auto rounded-[10px] transition-colors ${
          active ? 'bg-[#EBF3FE] text-[#3182F6]' : 'text-[#8B95A1] hover:bg-[#F9FAFB] hover:text-[#191F28]'
        }`}
      >
        <Icon size={16} strokeWidth={2.1} />
        {badge != null && badge > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-[#F04452] text-white text-[8px] font-bold w-3.5 h-3.5 rounded-full flex items-center justify-center leading-none">
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
        className={`flex items-center gap-2.5 px-3 py-2 rounded-[10px] text-admin-sm transition-colors relative ${
          active
            ? 'bg-[#EBF3FE] text-[#3182F6] font-semibold'
            : 'text-[#8B95A1] hover:bg-[#F9FAFB] hover:text-[#191F28]'
        }`}
      >
        <Icon size={15} strokeWidth={2.1} className="shrink-0" />
        <span className="truncate">{item.label}</span>
        {badge != null && badge > 0 && (
          <span className="ml-auto bg-[#F04452] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center leading-none">
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
            ? 'text-[#F59E0B] opacity-90'
            : 'text-[#8B95A1]/30 opacity-0 group-hover:opacity-100 hover:text-[#F59E0B]'
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
  const [pendingActionsCount, setPendingActionsCount] = useState(0);
  const [unmatchedAttrCount, setUnmatchedAttrCount] = useState(0);
  const [ledgerDriftCount, setLedgerDriftCount] = useState(0);
  const [pendingReviewCount, setPendingReviewCount] = useState(0);
  const [blogQueueCount, setBlogQueueCount] = useState(0);
  const { favs, isFav, toggle: toggleFav } = useFavorites();

  useAutoRefreshSession();

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('admin.sidebar-mode', sidebarMode);
    }
  }, [sidebarMode]);

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

  // 미처리 건수 배지 — 마운트 1회 fetch (reconcile은 RPC 비용으로 주기 없음)
  useEffect(() => {
    fetch('/api/unmatched?summary=1')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.counts?.pending != null) setUnmatchedAttrCount(d.counts.pending); })
      .catch(() => {});
    fetch('/api/admin/ledger/reconcile-status')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.drift_count != null) setLedgerDriftCount(d.drift_count); })
      .catch(() => {});
    fetch('/api/packages?status=pending&limit=1')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.count != null) setPendingReviewCount(d.count); })
      .catch(() => {});
    fetch('/api/blog/queue?status=pending')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.counts?.pending != null) setBlogQueueCount(d.counts.pending); })
      .catch(() => {});
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
    if (item.href === '/admin/attractions/unmatched' && unmatchedAttrCount > 0) return unmatchedAttrCount;
    if (item.href === '/admin/payments/reconcile' && ledgerDriftCount > 0) return ledgerDriftCount;
    if (item.href === '/admin/products/review' && pendingReviewCount > 0) return pendingReviewCount;
    if (item.href === '/admin/blog/queue' && blogQueueCount > 0) return blogQueueCount;
    return undefined;
  };

  // ── ⌘K 명령 카탈로그 (네비 + 액션) ──────────────────────────
  const staticCommands: AdminCommand[] = useMemo(() => {
    const navCmds: AdminCommand[] = navGroups.flatMap((g) =>
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
  }, []);

  return (
    <div className="min-h-screen bg-admin-bg flex" style={{ backgroundColor: '#F9FAFB' }}>
      {/* ── 사이드바 ─────────────────────────────────── */}
      <aside
        className={`fixed top-0 left-0 h-full bg-white border-r border-[#F2F4F6] z-40 transition-all duration-200 flex flex-col overflow-hidden ${
          sidebarMode === 'slim' ? 'w-14' : 'w-52'
        }`}
      >
        {/* 로고 */}
        <div className={`py-4 flex items-center border-b border-[#F2F4F6] ${sidebarMode === 'slim' ? 'justify-center px-2' : 'px-4 gap-2'}`}>
          {sidebarMode === 'slim' ? (
            <span className="text-[#3182F6] font-bold text-sm leading-none">OS</span>
          ) : (
            <>
              <span className="text-admin-md font-bold tracking-tight text-[#3182F6]">여소남 OS</span>
              <span className="text-admin-xs text-[#8B95A1] font-medium">ERP</span>
            </>
          )}
        </div>

        {/* 메뉴 */}
        <nav className={`flex-1 overflow-y-auto py-3 space-y-1 ${sidebarMode === 'slim' ? 'px-1' : 'px-2'}`}>
          {/* 즐겨찾기 — slim 모드에서 숨김 */}
          {sidebarMode === 'full' && favoriteItems.length > 0 && (
            <div className="pb-2 mb-2 border-b border-[#F2F4F6]">
              <div className="px-2 pb-1.5 flex items-center gap-1.5 text-admin-xs font-semibold text-[#F59E0B] uppercase tracking-[0.08em]">
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
            const slim = sidebarMode === 'slim';
            return (
              <div
                key={group.title}
                className={gi > 0 ? 'pt-1 mt-1 border-t border-[#F2F4F6]' : ''}
              >
                {!slim && (
                  <div className="px-2 pb-1.5 flex items-center gap-1.5 text-admin-xs font-semibold text-[#8B95A1] uppercase tracking-[0.08em]">
                    <GroupIcon size={11} />
                    {group.title}
                  </div>
                )}
                <div className={slim ? 'flex flex-col items-center gap-0.5' : 'space-y-0.5'}>
                  {group.items.map((item, idx) =>
                    'divider' in item ? (
                      slim ? null : (
                        <div key={`div-${idx}`} className="px-2 pt-2.5 pb-0.5 text-[10px] font-semibold text-[#C5CDD6] uppercase tracking-[0.06em]">
                          {item.label}
                        </div>
                      )
                    ) : (
                      <SidebarItem
                        key={item.href}
                        item={item}
                        active={isActive(item)}
                        isFavorite={isFav(item.href)}
                        onToggleFav={toggleFav}
                        badge={itemBadge(item)}
                        slim={slim}
                      />
                    )
                  )}
                </div>
              </div>
            );
          })}
        </nav>

        {/* 하단 — Density Toggle + 로그아웃 */}
        {sidebarMode === 'slim' ? (
          <div className="border-t border-[#F2F4F6] px-1 py-3 flex flex-col items-center gap-1">
            <button
              onClick={handleLogout}
              title="로그아웃"
              className="p-2 rounded-[8px] text-[#8B95A1] hover:text-[#191F28] hover:bg-[#F9FAFB] transition-colors"
            >
              <LogOut size={16} />
            </button>
          </div>
        ) : (
          <div className="px-3 py-3 border-t border-[#F2F4F6] space-y-1.5">
            <div className="px-1">
              <DensityToggle className="!text-[#8B95A1] hover:!text-[#191F28] hover:!bg-[#F9FAFB] w-full justify-center" />
            </div>
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2 px-3 py-1.5 rounded-[10px] text-admin-sm text-[#8B95A1] hover:text-[#191F28] hover:bg-[#F9FAFB] transition-colors"
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
        <header className="sticky top-0 z-30 bg-white border-b border-[#F2F4F6] px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarMode(m => m === 'full' ? 'slim' : 'full')}
              className="p-1.5 rounded-[8px] hover:bg-[#F2F4F6] text-[#8B95A1] hover:text-[#191F28] transition-colors"
              aria-label="사이드바 토글"
            >
              <MenuIcon size={18} />
            </button>
            <h1 className="text-admin-lg font-bold tracking-tight text-[#191F28]">
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
