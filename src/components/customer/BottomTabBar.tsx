'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const KAKAO_URL = 'https://pf.kakao.com/_xcFxkBG/chat';

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
  { icon: '💬', label: '상담', href: KAKAO_URL, external: true, highlight: true },
  { icon: '👤', label: '내 예약', href: '/mypage' },
];

function isTabActive(href: string, pathname: string | null): boolean {
  if (!pathname) return false;
  if (href === '/') return pathname === '/';
  return pathname.startsWith(href);
}

export default function BottomTabBar() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);

  // 스크롤 다운 → 숨김, 스크롤 업 → 노출
  useEffect(() => {
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
  }, [lastScrollY]);

  return (
    <nav
      className={`md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-sm border-t border-[#E5E7EB] safe-area-bottom transition-transform duration-200 ${
        visible ? 'translate-y-0' : 'translate-y-full'
      }`}
      aria-label="하단 탭 메뉴"
    >
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
                className="flex flex-col items-center gap-0.5 -mt-4 card-touch"
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
