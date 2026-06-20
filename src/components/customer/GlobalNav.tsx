'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { REGIONS, getDestinationUrl, getRegionUrl } from '@/lib/regions';
import { getConsultTelHref } from '@/lib/consult-escalation';
import { ANALYTICS_EVENTS } from '@/lib/analytics-events';
import { trackEngagement } from '@/lib/tracker';
import { buildGroupInquiryHandoffHref } from '@/lib/group-inquiry-handoff';
import { getKakaoChannelChatUrl, openKakaoChannel } from '@/lib/kakaoChannel';
function isFocusOutside(e: React.FocusEvent<HTMLElement>): boolean {
  const next = e.relatedTarget as Node | null;
  if (!next) return true;
  return !e.currentTarget.contains(next);
}

const KAKAO_URL = getKakaoChannelChatUrl();
const KAKAO_NAV_DESCRIPTION_ID = 'global-nav-kakao-description';
const GROUP_INQUIRY_NAV_HREF = buildGroupInquiryHandoffHref({
  source: 'global_nav',
  intent: 'group_trip',
  partyType: 'group',
  query: '상단 메뉴에서 단체 맞춤 견적 상담',
  selectedProducts: ['상단 메뉴 단체 맞춤 견적'],
});
const GROUP_INQUIRY_NAV_SUMMARY_ID = 'global-nav-group-inquiry-summary';
const DESKTOP_OVERSEAS_TRIGGER_ID = 'global-nav-overseas-trigger';
const DESKTOP_OVERSEAS_MENU_ID = 'global-nav-overseas-menu';
const DESKTOP_THEME_TRIGGER_ID = 'global-nav-theme-trigger';
const DESKTOP_THEME_MENU_ID = 'global-nav-theme-menu';
const MOBILE_DRAWER_ID = 'global-nav-mobile-drawer';
const MOBILE_DRAWER_TITLE_ID = 'global-nav-mobile-title';

type MenuKey = 'overseas' | 'theme' | null;

const THEME_LINKS = [
  { icon: '🔥', label: '마감특가', href: '/packages?urgency=1', desc: '14일 내 출발 · 한정 특가' },
  { icon: '💍', label: '허니문', href: '/packages?category=honeymoon', desc: '신혼여행 전문 패키지' },
  { icon: '⛳', label: '해외골프', href: '/packages?category=golf', desc: '명문 코스 + 항공 + 숙박' },
];

export default function GlobalNav() {
  const pathname = usePathname();
  const [openMenu, setOpenMenu] = useState<MenuKey>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [openMobileRegion, setOpenMobileRegion] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drawerPanelRef = useRef<HTMLDivElement | null>(null);
  const drawerCloseBtnRef = useRef<HTMLButtonElement | null>(null);
  const hamburgerBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setDrawerOpen(false);
    setOpenMenu(null);
  }, [pathname]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (drawerOpen) {
      const original = document.body.style.overflow;
      const hamburgerEl = hamburgerBtnRef.current;
      document.body.style.overflow = 'hidden';
      const t = setTimeout(() => drawerCloseBtnRef.current?.focus(), 50);
      const getFocusableElements = () => Array.from(
        drawerPanelRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter(element => !element.getAttribute('aria-hidden'));
      const onKey = (event: KeyboardEvent) => {
        if (event.key !== 'Tab') return;

        const focusableElements = getFocusableElements();
        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];
        if (focusableElements.length === 1) {
          event.preventDefault();
          firstElement.focus();
          return;
        }
        if (event.shiftKey && document.activeElement === firstElement) {
          event.preventDefault();
          lastElement.focus();
          return;
        }
        if (!event.shiftKey && document.activeElement === lastElement) {
          event.preventDefault();
          firstElement.focus();
        }
      };
      window.addEventListener('keydown', onKey);
      return () => {
        clearTimeout(t);
        window.removeEventListener('keydown', onKey);
        document.body.style.overflow = original;
        hamburgerEl?.focus();
      };
    }
  }, [drawerOpen]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpenMenu(null);
        setDrawerOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function handleMenuEnter(key: MenuKey) {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    setOpenMenu(key);
  }
  function handleMenuLeave() {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => setOpenMenu(null), 120);
  }

  function openNavKakaoConsult(source: string, event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    trackEngagement({
      event_type: ANALYTICS_EVENTS.kakaoClicked,
      cta_type: source,
      page_url: pathname ?? '/',
      intent: 'general_consult',
      selected_products: ['카카오톡 빠른 상담'],
      metadata: { source, handoff_channel: 'clipboard' },
    });
    void openKakaoChannel({
      intent: 'general_consult',
      selectedProducts: ['카카오톡 빠른 상담'],
      escalationSummary: '상단/모바일 메뉴에서 카카오톡 빠른 상담을 시작했습니다. 현재 보고 있던 페이지 기준으로 상담을 이어가 주세요.',
    });
  }

  const isOverseasActive = pathname?.includes('/destinations') || pathname?.includes('/packages');
  const isThemeActive = false;

  const consultTelHref = getConsultTelHref();
  const consultPhoneLabel = process.env.NEXT_PUBLIC_CONSULT_PHONE?.trim() || null;

  return (
    <div className="sticky top-0 z-40">
      {/* ── 데스크톱 ── */}
      <nav
        className={`hidden md:block transition-all duration-200 ${scrolled ? 'bg-white/95 backdrop-blur-md shadow-md border-b border-transparent' : 'bg-white border-b border-admin-border'}`}
        aria-label="주 메뉴"
      >
        <div className="max-w-[1200px] mx-auto px-6 h-16 flex items-center justify-between">
          {/* Logo */}
          <Link href="/" className="text-xl font-black tracking-tight text-brand flex-shrink-0">
            여소남
          </Link>

          {/* 그룹 메뉴 */}
          <div className="flex items-center gap-0.5">

            {/* 해외 패키지 ▾ */}
            <div
              className="relative"
              onMouseEnter={() => handleMenuEnter('overseas')}
              onMouseLeave={handleMenuLeave}
              onBlur={(e) => { if (isFocusOutside(e)) handleMenuLeave(); }}
            >
              <button
                id={DESKTOP_OVERSEAS_TRIGGER_ID}
                type="button"
                onClick={() => setOpenMenu(prev => prev === 'overseas' ? null : 'overseas')}
                data-testid="global-nav-overseas-toggle"
                aria-haspopup="menu"
                aria-expanded={openMenu === 'overseas'}
                aria-controls={DESKTOP_OVERSEAS_MENU_ID}
                className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-[10px] text-[15px] font-semibold transition
                  ${openMenu === 'overseas' || isOverseasActive
                    ? 'text-brand bg-brand-light'
                    : 'text-text-primary hover:bg-bg-section hover:text-brand'
                  }`}
              >
                해외 패키지
                <svg
                  className={`w-3.5 h-3.5 transition-transform duration-200 ${openMenu === 'overseas' ? 'rotate-180' : ''}`}
                  viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden
                >
                  <path d="M2 4l4 4 4-4" />
                </svg>
              </button>

              {openMenu === 'overseas' && (
                <div
                  id={DESKTOP_OVERSEAS_MENU_ID}
                  data-testid="global-nav-overseas-menu"
                  className="absolute top-full left-0 mt-1.5 w-[640px] bg-white rounded-[20px] shadow-xl border border-admin-border p-5 z-50"
                  role="menu"
                  aria-labelledby={DESKTOP_OVERSEAS_TRIGGER_ID}
                  tabIndex={-1}
                  onMouseEnter={() => handleMenuEnter('overseas')}
                  onMouseLeave={handleMenuLeave}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">지역별 여행</span>
                    <Link
                      href="/packages"
                      className="text-micro text-brand font-semibold hover:underline"
                      role="menuitem"
                    >
                      전체 상품 보기 →
                    </Link>
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    {REGIONS.map(region => (
                      <div key={region.slug} className="rounded-[12px] p-2.5 hover:bg-slate-50 transition">
                        <Link
                          href={getRegionUrl(region.slug)}
                          className="flex items-center gap-2 text-body font-semibold text-text-primary mb-1 hover:text-brand"
                          role="menuitem"
                        >
                          <span className="text-h2">{region.emoji}</span>
                          {region.label}
                        </Link>
                        {region.featuredCities.length > 0 && (
                          <div className="pl-7 flex flex-wrap gap-x-2 gap-y-0.5">
                            {region.featuredCities.slice(0, 4).map(city => (
                              <Link
                                key={city}
                                href={getDestinationUrl(city)}
                                className="text-micro text-text-body hover:text-brand py-0.5 transition"
                                role="menuitem"
                              >
                                {city}
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 테마 여행 ▾ */}
            <div
              className="relative"
              onMouseEnter={() => handleMenuEnter('theme')}
              onMouseLeave={handleMenuLeave}
              onBlur={(e) => { if (isFocusOutside(e)) handleMenuLeave(); }}
            >
              <button
                id={DESKTOP_THEME_TRIGGER_ID}
                type="button"
                onClick={() => setOpenMenu(prev => prev === 'theme' ? null : 'theme')}
                data-testid="global-nav-theme-toggle"
                aria-haspopup="menu"
                aria-expanded={openMenu === 'theme'}
                aria-controls={DESKTOP_THEME_MENU_ID}
                className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-[10px] text-[15px] font-semibold transition
                  ${openMenu === 'theme' || isThemeActive
                    ? 'text-brand bg-brand-light'
                    : 'text-text-primary hover:bg-bg-section hover:text-brand'
                  }`}
              >
                테마 여행
                <svg
                  className={`w-3.5 h-3.5 transition-transform duration-200 ${openMenu === 'theme' ? 'rotate-180' : ''}`}
                  viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden
                >
                  <path d="M2 4l4 4 4-4" />
                </svg>
              </button>

              {openMenu === 'theme' && (
                <div
                  id={DESKTOP_THEME_MENU_ID}
                  data-testid="global-nav-theme-menu"
                  className="absolute top-full left-0 mt-1.5 w-[260px] bg-white rounded-[20px] shadow-xl border border-admin-border py-2 z-50"
                  role="menu"
                  aria-labelledby={DESKTOP_THEME_TRIGGER_ID}
                  tabIndex={-1}
                  onMouseEnter={() => handleMenuEnter('theme')}
                  onMouseLeave={handleMenuLeave}
                >
                  {THEME_LINKS.map(t => (
                    <Link
                      key={t.href}
                      href={t.href}
                      className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50 rounded-[12px] mx-1 transition"
                      role="menuitem"
                    >
                      <span className="text-h1 leading-none mt-0.5">{t.icon}</span>
                      <div>
                        <p className="text-body font-semibold text-text-primary">{t.label}</p>
                        <p className="text-micro text-text-secondary mt-0.5">{t.desc}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* 매거진 */}
            <Link
              href="/blog"
              className={`px-4 py-2 rounded-[10px] text-[15px] font-semibold transition
                ${pathname?.startsWith('/blog')
                  ? 'text-brand bg-brand-light'
                  : 'text-text-primary hover:bg-bg-section hover:text-brand'
                }`}
            >
              매거진
            </Link>

            {/* 단독맞춤 */}
            <Link
              href="/private-tour"
              className={`px-4 py-2 rounded-[10px] text-[15px] font-semibold transition
                ${pathname?.startsWith('/private-tour')
                  ? 'text-brand bg-brand-light'
                  : 'text-text-primary hover:bg-bg-section hover:text-brand'
                }`}
            >
              단독맞춤
            </Link>

            {/* 단체 문의 */}
            <span id={GROUP_INQUIRY_NAV_SUMMARY_ID} className="sr-only">
              단체 맞춤 견적 상담으로 이동합니다.
            </span>
            <span id={KAKAO_NAV_DESCRIPTION_ID} className="sr-only">
              카카오톡 채널 새 창에서 여행 상담을 시작합니다. 현재 보고 있는 페이지를 기준으로 상담을 이어갈 수 있습니다.
            </span>
            <Link
              href={GROUP_INQUIRY_NAV_HREF}
              data-testid="global-nav-group-inquiry"
              aria-describedby={GROUP_INQUIRY_NAV_SUMMARY_ID}
              className={`px-4 py-2 rounded-[10px] text-[15px] font-semibold transition
                ${pathname?.startsWith('/group-inquiry')
                  ? 'text-brand bg-brand-light'
                  : 'text-text-primary hover:bg-bg-section hover:text-brand'
                }`}
            >
              단체 문의
            </Link>
          </div>

          {/* 카톡 상담 */}
          <a
            href={KAKAO_URL}
            target="_blank"
            rel="noopener"
            referrerPolicy="no-referrer-when-downgrade"
            onClick={(event) => openNavKakaoConsult('global_nav_desktop', event)}
            aria-describedby={KAKAO_NAV_DESCRIPTION_ID}
            className="bg-[#FEE500] text-[#3C1E1E] font-bold px-4 py-2 rounded-full hover:shadow-md transition flex-shrink-0"
          >
            💬 카톡 상담
          </a>
        </div>
      </nav>

      {/* ── 모바일 — 로고 + 햄버거만 (상담은 하단 탭바) ── */}
      <nav
        className={`md:hidden h-14 flex items-center justify-between px-5 transition-all duration-200 ${scrolled ? 'bg-white/95 backdrop-blur-md shadow-md border-b border-transparent' : 'bg-white border-b border-admin-border'}`}
        aria-label="주 메뉴"
      >
        <Link href="/" className="text-lg font-black tracking-tight text-brand">여소남</Link>
        <button
          type="button"
          ref={hamburgerBtnRef}
          onClick={() => setDrawerOpen(true)}
          data-testid="global-nav-mobile-open"
          aria-label="메뉴 열기"
          aria-haspopup="dialog"
          aria-expanded={drawerOpen}
          aria-controls={MOBILE_DRAWER_ID}
          className="w-[48px] h-[48px] flex items-center justify-center rounded-[10px] hover:bg-bg-section text-text-primary"
        >
          <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </nav>

      {/* ── 모바일 드로어 ── */}
      {drawerOpen && (
        <div
          id={MOBILE_DRAWER_ID}
          data-testid="global-nav-mobile-drawer"
          className="md:hidden fixed inset-0 z-50"
          role="dialog"
          aria-modal="true"
          aria-labelledby={MOBILE_DRAWER_TITLE_ID}
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            aria-label="메뉴 닫기"
            onClick={() => setDrawerOpen(false)}
          />
          <div ref={drawerPanelRef} className="absolute right-0 top-0 bottom-0 w-[85%] max-w-sm bg-white shadow-2xl flex flex-col">
            <div className="h-14 flex items-center justify-between px-4 border-b border-admin-border flex-shrink-0">
              <span id={MOBILE_DRAWER_TITLE_ID} className="text-base font-bold text-slate-900">메뉴</span>
              <button
                type="button"
                ref={drawerCloseBtnRef}
                onClick={() => setDrawerOpen(false)}
                aria-label="메뉴 닫기"
                className="w-10 h-10 flex items-center justify-center rounded-md hover:bg-slate-100"
              >
                <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <path d="M6 6l12 12M6 18L18 6" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {/* 보조 링크 */}
              <div className="px-4 py-4 border-b border-admin-border">
                <Link href="/packages" className="block py-2.5 text-base font-semibold text-slate-900">전체 상품</Link>
                <Link href="/destinations" className="block py-2.5 text-base font-semibold text-slate-900">여행지 가이드</Link>
                <Link href="/blog" className="block py-2.5 text-base font-semibold text-slate-900">매거진</Link>
                <Link href="/private-tour" className="block py-2.5 text-base font-semibold text-slate-900">단독맞춤여행</Link>
                <Link
                  href={GROUP_INQUIRY_NAV_HREF}
                  data-testid="global-nav-mobile-group-inquiry"
                  aria-describedby={GROUP_INQUIRY_NAV_SUMMARY_ID}
                  className="block py-2.5 text-base font-semibold text-slate-900"
                >
                  단체 문의
                </Link>
              </div>

              {/* 테마 */}
              <div className="px-4 py-3 border-b border-admin-border">
                <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2 px-1">테마 여행</div>
                {THEME_LINKS.map(t => (
                  <Link
                    key={t.href}
                    href={t.href}
                    className="flex items-center gap-3 py-2.5 text-[15px] font-medium text-slate-800"
                  >
                    <span className="text-lg">{t.icon}</span>
                    <span>{t.label}</span>
                  </Link>
                ))}
              </div>

              {/* 지역 아코디언 */}
              <div className="px-4 py-3">
                <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2 px-1">지역별</div>
                {REGIONS.map(region => {
                  const hasCities = region.featuredCities.length > 0;
                  const isExpanded = openMobileRegion === region.slug;
                  const cityListId = `global-nav-mobile-region-${region.slug}`;
                  return (
                    <div key={region.slug} className="border-b border-admin-border last:border-b-0">
                      <div className="flex items-center">
                        <Link
                          href={getRegionUrl(region.slug)}
                          className="flex-1 flex items-center gap-2 py-3 text-[15px] font-medium text-slate-800"
                        >
                          <span className="text-lg">{region.emoji}</span>
                          <span>{region.label}</span>
                        </Link>
                        {hasCities && (
                          <button
                            type="button"
                            onClick={() => setOpenMobileRegion(isExpanded ? null : region.slug)}
                            data-testid="global-nav-mobile-region-toggle"
                            aria-label={`${region.label} 도시 펼치기`}
                            aria-expanded={isExpanded}
                            aria-controls={cityListId}
                            className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-slate-700"
                          >
                            <svg viewBox="0 0 12 12" className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                              <path d="M2 4l4 4 4-4" />
                            </svg>
                          </button>
                        )}
                      </div>
                      {hasCities && isExpanded && (
                        <div
                          id={cityListId}
                          data-testid="global-nav-mobile-region-panel"
                          className="pb-2 pl-7 grid grid-cols-2 gap-x-2"
                          role="region"
                          aria-label={`${region.label} 주요 도시`}
                        >
                          {region.featuredCities.map(city => (
                            <Link
                              key={city}
                              href={getDestinationUrl(city)}
                              className="py-2 text-[13px] text-slate-600 hover:text-brand"
                            >
                              {city}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="border-t border-admin-border p-4 flex flex-col gap-2 flex-shrink-0">
              <a
                href={KAKAO_URL}
                target="_blank"
                rel="noopener"
                referrerPolicy="no-referrer-when-downgrade"
                onClick={(event) => openNavKakaoConsult('global_nav_mobile_drawer', event)}
                aria-describedby={KAKAO_NAV_DESCRIPTION_ID}
                className="w-full bg-[#FEE500] text-[#3C1E1E] font-bold text-sm py-3 rounded-full text-center"
              >
                💬 카카오톡 상담
              </a>
              {consultTelHref && consultPhoneLabel ? (
                <a
                  href={consultTelHref}
                  className="w-full text-center text-sm text-slate-600 py-2"
                >
                  📞 {consultPhoneLabel}
                </a>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
