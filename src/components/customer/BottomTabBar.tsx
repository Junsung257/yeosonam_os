'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ANALYTICS_EVENTS } from '@/lib/analytics-events';
import { trackEngagement } from '@/lib/tracker';

const KAKAO_URL = 'https://pf.kakao.com/_xcFxkBG/chat';
const KAKAO_TAB_DESCRIPTION_ID = 'bottom-tab-kakao-description';

interface Tab {
  icon: string;
  label: string;
  href: string;
  external?: boolean;
  highlight?: boolean;
}

const TABS: Tab[] = [
  { icon: '🏠', label: '홈', href: '/' },
  { icon: '🔍', label: '검색', href: '/packages' },
  { icon: '✈️', label: '단독맞춤', href: '/private-tour' },
  { icon: '💬', label: '상담', href: KAKAO_URL, external: true, highlight: true },
  { icon: '👤', label: '내 예약', href: '/mypage' },
];

function isTabActive(href: string, pathname: string | null): boolean {
  if (!pathname) return false;
  if (href === '/') return pathname === '/';
  return pathname.startsWith(href);
}

// Dedicated mobile bottom surfaces own these paths, so the global tab bar stays out.
const EXCLUDED_PATHS = ['/admin', '/login', '/tenant', '/packages', '/concierge', '/group-inquiry'];

export default function BottomTabBar() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);

  const excluded = EXCLUDED_PATHS.some(p => pathname?.startsWith(p));

  // 스크롤 다운 → 숨김, 스크롤 업 → 노출
  useEffect(() => {
    if (excluded) return;
    const onScroll = () => {
      const current = window.scrollY;
      if (current < 60) {
        setVisible(true);
      } else if (current > lastScrollY + 4) {
        setVisible(false);
      } else if (current < lastScrollY - 4) {
        setVisible(true);
      }
      setLastScrollY(current);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [lastScrollY, excluded]);

  if (excluded) return null;

  const trackKakaoClick = () => {
    trackEngagement({
      event_type: ANALYTICS_EVENTS.kakaoClicked,
      cta_type: 'bottom_tab_bar',
      page_url: pathname ?? '/',
      metadata: { source: 'bottom_tab_bar' },
    });
  };

  return (
    <nav
      data-testid="bottom-tab-bar"
      className={`bottom-tab-bar md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-sm border-t border-[#E5E7EB] safe-area-bottom transition-transform duration-200 ${
        visible ? 'translate-y-0' : 'translate-y-full'
      }`}
      aria-label="하단 탭 메뉴"
    >
      <p id={KAKAO_TAB_DESCRIPTION_ID} className="sr-only">
        카카오톡 채널 새 창에서 여행 상담을 시작합니다. 현재 보고 있는 페이지를 기준으로 상담을 이어갈 수 있습니다.
      </p>
      <div className="flex items-end justify-around px-2 pt-2 pb-1 max-w-lg mx-auto">
        {TABS.map((tab) => {
          const active = !tab.highlight && isTabActive(tab.href, pathname);

          if (tab.highlight) {
            // 카카오 상담 — 위로 돌출되는 강조 탭
            return (
              <a
                key={tab.label}
                href={tab.href}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer-when-downgrade"
                onClick={trackKakaoClick}
                data-testid="bottom-tab-kakao"
                className="flex flex-col items-center gap-0.5 -mt-4 card-touch"
                aria-describedby={KAKAO_TAB_DESCRIPTION_ID}
                aria-label="카카오톡 상담"
              >
                <div className="w-[56px] h-[56px] rounded-full bg-[#FEE500] flex items-center justify-center text-[26px] shadow-lg">
                  {tab.icon}
                </div>
                <span className="text-[10px] font-semibold text-[#3C1E1E] mt-0.5">{tab.label}</span>
              </a>
            );
          }

          return (
            <Link
              key={tab.label}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              data-testid={`bottom-tab-${tab.href === '/' ? 'home' : tab.href.replace(/^\//, '').replace(/\//g, '-')}`}
              className="flex flex-col items-center gap-0.5 min-w-[60px] py-1 card-touch"
            >
              <span className={`text-[22px] leading-none transition-transform ${active ? 'scale-110' : ''}`}>
                {tab.icon}
              </span>
              <span
                className={`text-[10px] font-medium leading-tight ${
                  active ? 'text-brand font-semibold' : 'text-text-secondary'
                }`}
              >
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
