'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { ANALYTICS_EVENTS } from '@/lib/analytics-events';
import { trackAnalyticsEvent } from '@/lib/analytics';
import { trackEngagement } from '@/lib/tracker';

const KAKAO_URL = 'https://pf.kakao.com/_xcFxkBG/chat';
const NAV_ITEMS = [
  { label: '패키지', href: '/packages' },
  { label: '크루즈', href: '/cruise' },
  { label: '해외골프', href: '/packages?category=golf' },
  { label: '단독·단체', href: '/private-tour' },
  { label: '여행가이드', href: '/blog' },
] as const;

export default function GlobalNav() {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => setDrawerOpen(false), [pathname]);
  useEffect(() => {
    if (!drawerOpen) return;
    const originalOverflow = document.body.style.overflow;
    const menuButton = menuButtonRef.current;
    document.body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 40);
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKey);
      document.body.style.overflow = originalOverflow;
      menuButton?.focus();
    };
  }, [drawerOpen]);

  const trackKakao = (source: string) => {
    trackAnalyticsEvent('ysn_kakao_click', {
      cta_location: source,
      page_type: pathname === '/' ? 'home' : pathname?.startsWith('/packages') ? 'package' : 'content',
      outbound_host: 'pf.kakao.com',
    });
    trackEngagement({
      event_type: ANALYTICS_EVENTS.kakaoClicked,
      page_url: pathname ?? '/',
      metadata: { source },
    });
  };

  return (
    <header className="sticky top-0 z-40 border-b border-admin-border bg-white/95 backdrop-blur-md">
      <nav className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-4 md:px-6" aria-label="주 메뉴">
        <Link href="/" className="inline-flex min-h-11 items-center text-xl font-black tracking-tight text-brand">여소남</Link>
        <div className="hidden items-center gap-1 md:flex">
          {NAV_ITEMS.map((item) => {
            const active = pathname?.startsWith(item.href.split('?')[0]);
            return (
              <Link
                key={item.label}
                href={item.href}
                className={`inline-flex min-h-11 items-center rounded-xl px-3.5 text-sm font-bold transition ${
                  active ? 'bg-brand-light text-brand' : 'text-text-primary hover:bg-bg-section hover:text-brand'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
        <a
          href={KAKAO_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => trackKakao('global_nav_desktop')}
          className="hidden min-h-11 items-center rounded-full bg-[#FEE500] px-4 text-sm font-black text-[#3C1E1E] md:inline-flex"
        >
          카카오 상담
        </a>
        <button
          ref={menuButtonRef}
          type="button"
          aria-label="메뉴 열기"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen(true)}
          className="inline-flex h-12 w-12 items-center justify-center rounded-xl text-2xl text-text-primary md:hidden"
        >
          ☰
        </button>
      </nav>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="전체 메뉴">
          <button
            type="button"
            aria-label="메뉴 닫기"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-slate-950/45"
          />
          <div className="absolute right-0 top-0 flex h-dvh w-[86%] max-w-sm flex-col bg-white shadow-2xl">
            <div className="flex h-16 items-center justify-between border-b border-admin-border px-5">
              <span className="text-lg font-black text-brand">여소남</span>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="메뉴 닫기"
                className="h-11 w-11 rounded-xl text-2xl"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {NAV_ITEMS.map((item) => (
                <Link key={item.label} href={item.href} className="flex min-h-12 items-center rounded-xl px-4 text-base font-bold text-text-primary hover:bg-bg-section">
                  {item.label}
                </Link>
              ))}
            </div>
            <div className="border-t border-admin-border p-4">
              <a
                href={KAKAO_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackKakao('global_nav_mobile')}
                className="flex min-h-12 items-center justify-center rounded-xl bg-[#FEE500] text-sm font-black text-[#3C1E1E]"
              >
                카카오로 상담하기
              </a>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
