'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { REGIONS, getDestinationUrl, getRegionUrl } from '@/lib/regions';
import { getConsultTelHref } from '@/lib/consult-escalation';
function isFocusOutside(e: React.FocusEvent<HTMLElement>): boolean {
  const next = e.relatedTarget as Node | null;
  if (!next) return true;
  return !e.currentTarget.contains(next);
}

const KAKAO_URL = 'https://pf.kakao.com/_xcFxkBG/chat';

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
      return () => {
        clearTimeout(t);
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

  const isOverseasActive = pathname?.includes('/destinations') || pathname?.includes('/packages');
  const isThemeActive = false;

  const consultTelHref = getConsultTelHref();
  const consultPhoneLabel = process.env.NEXT_PUBLIC_CONSULT_PHONE?.trim() || null;

  return (
    <div className="sticky top-0 z-40">
      {/* ── 데스크톱 ── */}
      <nav
        className={`hidden md:block transition-all duration-200 ${scrolled ? 'bg-white/95 backdrop-blur-md shadow-md border-b border-transparent' : 'bg-white border-b border-[#F2F4F6]'}`}
        aria-label="주 메뉴"
      >
        <div className="max-w-[1200px] mx-auto px-6 h-16 flex items-center justify-between">
          {/* Logo */}
          <Link href="/" className="text-xl font-black tracking-tight text-[#3182F6] flex-shrink-0">
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
                type="button"
                onClick={() => setOpenMenu(prev => prev === 'overseas' ? null : 'overseas')}
                aria-expanded={openMenu === 'overseas'}
                className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-[10px] text-[15px] font-semibold transition
                  ${openMenu === 'overseas' || isOverseasActive
                    ? 'text-[#3182F6] bg-[#EBF3FE]'
                    : 'text-[#191F28] hover:bg-[#F2F4F6] hover:text-[#3182F6]'
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
                  className="absolute top-full left-0 mt-1.5 w-[640px] bg-white rounded-[20px] shadow-xl border border-[#F2F4F6] p-5 z-50"
                  role="menu"
                  onMouseEnter={() => handleMenuEnter('overseas')}
                  onMouseLeave={handleMenuLeave}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[11px] font-bold text-[#8B95A1] uppercase tracking-wider">지역별 여행</span>
                    <Link
                      href="/packages"
                      className="text-[12px] text-[#3182F6] font-semibold hover:underline"
                      role="menuitem"
                    >
                      전체 상품 보기 →
                    </Link>
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    {REGIONS.map(region => (
                      <div key={region.slug} className="rounded-[12px] p-2.5 hover:bg-[#F8F9FA] transition">
                        <Link
                          href={getRegionUrl(region.slug)}
                          className="flex items-center gap-2 text-[14px] font-semibold text-[#191F28] mb-1 hover:text-[#3182F6]"
                          role="menuitem"
                        >
                          <span className="text-[18px]">{region.emoji}</span>
                          {region.label}
                        </Link>
                        {region.featuredCities.length > 0 && (
                          <div className="pl-7 flex flex-wrap gap-x-2 gap-y-0.5">
                            {region.featuredCities.slice(0, 4).map(city => (
                              <Link
                                key={city}
                                href={getDestinationUrl(city)}
                                className="text-[12px] text-[#4E5968] hover:text-[#3182F6] py-0.5 transition"
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
                type="button"
                onClick={() => setOpenMenu(prev => prev === 'theme' ? null : 'theme')}
                aria-expanded={openMenu === 'theme'}
                className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-[10px] text-[15px] font-semibold transition
                  ${openMenu === 'theme' || isThemeActive
                    ? 'text-[#3182F6] bg-[#EBF3FE]'
                    : 'text-[#191F28] hover:bg-[#F2F4F6] hover:text-[#3182F6]'
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
                  className="absolute top-full left-0 mt-1.5 w-[260px] bg-white rounded-[20px] shadow-xl border border-[#F2F4F6] py-2 z-50"
                  role="menu"
                  onMouseEnter={() => handleMenuEnter('theme')}
                  onMouseLeave={handleMenuLeave}
                >
                  {THEME_LINKS.map(t => (
                    <Link
                      key={t.href}
                      href={t.href}
                      className="flex items-start gap-3 px-4 py-3 hover:bg-[#F8F9FA] rounded-[12px] mx-1 transition"
                      role="menuitem"
                    >
                      <span className="text-[22px] leading-none mt-0.5">{t.icon}</span>
                      <div>
                        <p className="text-[14px] font-semibold text-[#191F28]">{t.label}</p>
                        <p className="text-[12px] text-[#8B95A1] mt-0.5">{t.desc}</p>
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
                  ? 'text-[#3182F6] bg-[#EBF3FE]'
                  : 'text-[#191F28] hover:bg-[#F2F4F6] hover:text-[#3182F6]'
                }`}
            >
              매거진
            </Link>

            {/* 단체 문의 */}
            <Link
              href="/group-inquiry"
              className={`px-4 py-2 rounded-[10px] text-[15px] font-semibold transition
                ${pathname?.startsWith('/group-inquiry')
                  ? 'text-[#3182F6] bg-[#EBF3FE]'
                  : 'text-[#191F28] hover:bg-[#F2F4F6] hover:text-[#3182F6]'
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
            className="bg-[#FEE500] text-[#3C1E1E] font-bold px-4 py-2 rounded-full hover:shadow-md transition flex-shrink-0"
          >
            💬 카톡 상담
          </a>
        </div>
      </nav>

      {/* ── 모바일 ── */}
      <nav
        className={`md:hidden h-14 flex items-center justify-between px-5 transition-all duration-200 ${scrolled ? 'bg-white/95 backdrop-blur-md shadow-md border-b border-transparent' : 'bg-white border-b border-[#F2F4F6]'}`}
        aria-label="주 메뉴"
      >
        <Link href="/" className="text-lg font-black tracking-tight text-[#3182F6]">여소남</Link>
        <div className="flex items-center gap-1">
          <a
            href={KAKAO_URL}
            target="_blank"
            rel="noopener"
            referrerPolicy="no-referrer-when-downgrade"
            className="bg-[#FEE500] text-[#3C1E1E] font-bold text-xs px-3 py-1.5 rounded-full"
          >
            💬 카톡
          </a>
          <button
            type="button"
            ref={hamburgerBtnRef}
            onClick={() => setDrawerOpen(true)}
            aria-label="메뉴 열기"
            aria-expanded={drawerOpen}
            className="w-[48px] h-[48px] flex items-center justify-center rounded-[10px] hover:bg-[#F2F4F6] text-[#191F28]"
          >
            <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
      </nav>

      {/* ── 모바일 드로어 ── */}
      {drawerOpen && (
        <div className="md:hidden fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="메뉴">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} />
          <div className="absolute right-0 top-0 bottom-0 w-[85%] max-w-sm bg-white shadow-2xl flex flex-col">
            <div className="h-14 flex items-center justify-between px-4 border-b border-[#F2F4F6] flex-shrink-0">
              <span className="text-base font-bold text-gray-900">메뉴</span>
              <button
                type="button"
                ref={drawerCloseBtnRef}
                onClick={() => setDrawerOpen(false)}
                aria-label="메뉴 닫기"
                className="w-10 h-10 flex items-center justify-center rounded-md hover:bg-gray-100"
              >
                <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <path d="M6 6l12 12M6 18L18 6" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {/* 보조 링크 */}
              <div className="px-4 py-4 border-b border-[#F2F4F6]">
                <Link href="/packages" className="block py-2.5 text-base font-semibold text-gray-900">전체 상품</Link>
                <Link href="/destinations" className="block py-2.5 text-base font-semibold text-gray-900">여행지 가이드</Link>
                <Link href="/blog" className="block py-2.5 text-base font-semibold text-gray-900">매거진</Link>
                <Link href="/group-inquiry" className="block py-2.5 text-base font-semibold text-gray-900">단체 문의</Link>
              </div>

              {/* 테마 */}
              <div className="px-4 py-3 border-b border-[#F2F4F6]">
                <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">테마 여행</div>
                {THEME_LINKS.map(t => (
                  <Link
                    key={t.href}
                    href={t.href}
                    className="flex items-center gap-3 py-2.5 text-[15px] font-medium text-gray-800"
                  >
                    <span className="text-lg">{t.icon}</span>
                    <span>{t.label}</span>
                  </Link>
                ))}
              </div>

              {/* 지역 아코디언 */}
              <div className="px-4 py-3">
                <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">지역별</div>
                {REGIONS.map(region => {
                  const hasCities = region.featuredCities.length > 0;
                  const isExpanded = openMobileRegion === region.slug;
                  return (
                    <div key={region.slug} className="border-b border-[#F2F4F6] last:border-b-0">
                      <div className="flex items-center">
                        <Link
                          href={getRegionUrl(region.slug)}
                          className="flex-1 flex items-center gap-2 py-3 text-[15px] font-medium text-gray-800"
                        >
                          <span className="text-lg">{region.emoji}</span>
                          <span>{region.label}</span>
                        </Link>
                        {hasCities && (
                          <button
                            type="button"
                            onClick={() => setOpenMobileRegion(isExpanded ? null : region.slug)}
                            aria-label={`${region.label} 도시 펼치기`}
                            aria-expanded={isExpanded}
                            className="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-gray-700"
                          >
                            <svg viewBox="0 0 12 12" className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                              <path d="M2 4l4 4 4-4" />
                            </svg>
                          </button>
                        )}
                      </div>
                      {hasCities && isExpanded && (
                        <div className="pb-2 pl-7 grid grid-cols-2 gap-x-2">
                          {region.featuredCities.map(city => (
                            <Link
                              key={city}
                              href={getDestinationUrl(city)}
                              className="py-2 text-[13px] text-gray-600 hover:text-[#3182F6]"
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

            <div className="border-t border-[#F2F4F6] p-4 flex flex-col gap-2 flex-shrink-0">
              <a
                href={KAKAO_URL}
                target="_blank"
                rel="noopener"
                referrerPolicy="no-referrer-when-downgrade"
                className="w-full bg-[#FEE500] text-[#3C1E1E] font-bold text-sm py-3 rounded-full text-center"
              >
                💬 카카오톡 상담
              </a>
              {consultTelHref && consultPhoneLabel ? (
                <a
                  href={consultTelHref}
                  className="w-full text-center text-sm text-gray-600 py-2"
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
