'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { hasAnalyticsConsent } from '@/lib/consent';
import { initTracker, trackScrollMilestone } from '@/lib/tracker';

/**
 * 전역: 첫 방문 시 traffic 로그, 스크롤 깊이 마일스톤(동의 시).
 * initTracker 가 레포에 연결되어 있지 않던 것을 보완.
 */
export default function TrackerBootstrap() {
  const pathname = usePathname();
  const initOnce = useRef(false);
  const fired = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (initOnce.current) return;
    initOnce.current = true;
    initTracker();
  }, []);

  useEffect(() => {
    fired.current.clear();
    if (typeof window === 'undefined') return;
    const path = pathname || '/';
    if (path.startsWith('/admin')) return;

    const keyBase = path;

    const emitMilestones = () => {
      if (!hasAnalyticsConsent()) return;
      const doc = document.documentElement;
      const scrollTop = window.scrollY || doc.scrollTop;
      const vh = window.innerHeight;
      const sh = Math.max(doc.scrollHeight, 1);
      const thresholds: Array<25 | 50 | 75 | 90> = [25, 50, 75, 90];

      if (sh <= vh + 8) {
        const k = `${keyBase}:90`;
        if (!fired.current.has(k)) {
          fired.current.add(k);
          trackScrollMilestone(90, window.location.href);
        }
        return;
      }

      const pct = Math.round(((scrollTop + vh) / sh) * 100);
      for (const t of thresholds) {
        if (pct >= t) {
          const k = `${keyBase}:${t}`;
          if (!fired.current.has(k)) {
            fired.current.add(k);
            trackScrollMilestone(t, window.location.href);
          }
        }
      }
    };

    let scrollSettle: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      if (scrollSettle) clearTimeout(scrollSettle);
      scrollSettle = setTimeout(() => {
        scrollSettle = null;
        emitMilestones();
      }, 120);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    emitMilestones();
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (scrollSettle) clearTimeout(scrollSettle);
    };
  }, [pathname]);

  return null;
}
