'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';

// ── 카테고리 그룹핑 사이드바 메뉴 ─────────────────────────────
interface NavItem {
  href: string;
  label: string;
  exact?: boolean;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    title: '운영',
    items: [
      { href: '/admin', label: '대시보드', exact: true },
      { href: '/admin/bookings', label: '예약 관리' },
      { href: '/admin/customers', label: '고객 관리' },
      { href: '/admin/payments', label: '입금 관리' },
      { href: '/admin/booking-guide', label: '예약 안내문' },
    ],
  },
  {
    title: '상품',
    items: [
      { href: '/admin/packages', label: '상품 관리' },
      { href: '/admin/products/review', label: '상품 검수' },
      { href: '/admin/upload', label: '업로드' },
      { href: '/admin/land-operators', label: '랜드사 관리' },
      { href: '/admin/departing-locations', label: '출발지 관리' },
      { href: '/admin/attractions', label: '관광지 관리' },
    ],
  },
  {
    title: '영업',
    items: [
      { href: '/admin/affiliates', label: '제휴/인플루언서' },
      { href: '/admin/affiliate-analytics', label: '제휴 분석' },
      { href: '/admin/applications', label: '파트너 신청' },
      { href: '/admin/rfqs', label: '단체 RFQ' },
      { href: '/admin/concierge', label: '컨시어지' },
      { href: '/admin/tenants', label: '테넌트 관리' },
    ],
  },
  {
    title: '재무',
    items: [
      { href: '/admin/ledger', label: '통합 장부' },
      { href: '/admin/settlements', label: '정산 관리' },
      { href: '/admin/tax', label: '세무 관리' },
    ],
  },
  {
    title: '마케팅',
    items: [
      { href: '/admin/marketing', label: '마케팅 대시보드' },
      { href: '/admin/marketing/creatives', label: '크리에이티브' },
      { href: '/admin/marketing/card-news', label: '카드뉴스' },
      { href: '/admin/content-hub', label: '콘텐츠 허브' },
      { href: '/admin/content-queue', label: '콘텐츠 검수' },
      { href: '/admin/content-analytics', label: '콘텐츠 성과' },
      { href: '/admin/content-gaps', label: '콘텐츠 갭' },
      { href: '/admin/search-ads', label: '검색광고' },
      { href: '/admin/blog', label: '블로그' },
    ],
  },
  {
    title: 'AI',
    items: [
      { href: '/admin/jarvis', label: '자비스 AI' },
      { href: '/admin/generate', label: 'AI 생성' },
      { href: '/admin/qa', label: 'Q&A 챗봇' },
    ],
  },
  {
    title: '시스템',
    items: [
      { href: '/admin/control-tower', label: 'OS 관제탑' },
      { href: '/admin/escalations', label: '에스컬레이션' },
    ],
  },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [pendingActionsCount, setPendingActionsCount] = useState(0);

  useEffect(() => {
    const fetchCount = () => {
      fetch('/api/agent-actions?status=pending&limit=1')
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.total != null) setPendingActionsCount(d.total); })
        .catch(() => {});
    };
    fetchCount();
    const interval = setInterval(fetchCount, 60000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = async () => {
    await fetch('/api/auth/session', { method: 'DELETE' });
    router.push('/login');
  };

  const isActive = (item: NavItem) => {
    if (item.exact) return pathname === item.href;
    return pathname === item.href || pathname.startsWith(item.href + '/');
  };

  // 현재 페이지 타이틀
  const currentPage = navGroups
    .flatMap(g => g.items)
    .find(item => isActive(item))?.label || '대시보드';

  return (
    <div className="min-h-screen bg-[#f8f9ff] flex">
      {/* ── 사이드바 ─────────────────────────────────── */}
      <aside
        className={`fixed top-0 left-0 h-full bg-[#001f3f] text-white z-40 transition-all duration-200 flex flex-col ${
          sidebarOpen ? 'w-52' : 'w-0 -translate-x-full'
        }`}
      >
        {/* 로고 */}
        <div className="px-4 py-4 flex items-center gap-2 border-b border-white/10">
          <span className="text-[15px] font-bold tracking-tight">Yeosonam OS</span>
          <span className="text-[10px] text-blue-300/60 font-medium">ERP</span>
        </div>

        {/* 메뉴 그룹 */}
        <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-3">
          {navGroups.map(group => (
            <div key={group.title}>
              <div className="px-2 py-1 text-[10px] font-semibold text-blue-300/50 uppercase tracking-wider">
                {group.title}
              </div>
              {group.items.map(item => (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={true}
                  className={`flex items-center px-3 py-1.5 rounded text-[13px] transition-colors ${
                    isActive(item)
                      ? 'bg-white/15 text-white font-medium'
                      : 'text-blue-100/60 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {item.label}
                  {item.href === '/admin/jarvis' && pendingActionsCount > 0 && (
                    <span className="ml-auto bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                      {pendingActionsCount}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        {/* 하단 */}
        <div className="px-3 py-3 border-t border-white/10 space-y-1">
          <button
            onClick={handleLogout}
            className="w-full text-left px-3 py-1.5 rounded text-[13px] text-blue-100/50 hover:text-white hover:bg-white/5 transition-colors"
          >
            로그아웃
          </button>
        </div>
      </aside>

      {/* ── 메인 영역 ────────────────────────────────── */}
      <div className={`flex-1 flex flex-col min-h-screen transition-all duration-200 ${sidebarOpen ? 'ml-52' : 'ml-0'}`}>
        {/* 상단바 */}
        <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-slate-200/60 px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-1 rounded hover:bg-slate-100 text-slate-400 transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 12h18M3 6h18M3 18h18" />
              </svg>
            </button>
            <h1 className="text-[15px] font-semibold text-slate-800">{currentPage}</h1>
          </div>

          <div className="flex items-center gap-2">
            {/* Command Palette 트리거 */}
            <button
              onClick={() => setCmdOpen(true)}
              className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded border border-slate-200 bg-slate-50 text-[13px] text-slate-400 hover:border-slate-300 hover:bg-white transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
              </svg>
              통합검색...
              <kbd className="text-[10px] bg-slate-200/80 text-slate-500 px-1.5 py-0.5 rounded font-mono">⌘K</kbd>
            </button>
          </div>
        </header>

        {/* 콘텐츠 */}
        <main className="flex-1 px-4 lg:px-6 py-4">
          {children}
        </main>
      </div>

      {/* ── Command Palette 오버레이 ─────────────────── */}
      {cmdOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/30 backdrop-blur-sm"
          onClick={() => setCmdOpen(false)}
        >
          <div
            className="w-full max-w-lg bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
              </svg>
              <input
                autoFocus
                type="text"
                placeholder="상품, 고객, SKU, 예약번호 검색..."
                className="flex-1 text-[14px] text-slate-800 placeholder:text-slate-400 border-none focus:ring-0 bg-transparent"
                onKeyDown={e => e.key === 'Escape' && setCmdOpen(false)}
              />
            </div>
            <div className="px-4 py-6 text-center text-[13px] text-slate-400">
              검색어를 입력하세요
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
