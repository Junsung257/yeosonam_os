'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { hasAnalyticsConsent } from '@/lib/consent';
import { initTracker, trackScrollMilestone, trackPageExit } from '@/lib/tracker';

/**
 * 전역 트래커 부트스트랩.
 * - 첫 방문 시 traffic 로그 (visitor_uid·device·is_returning 포함)
 * - 스크롤 깊이 마일스톤(25/50/75/90) + 최대 스크롤 추적
 * - 페이지 이탈 시 체류시간·max scroll·인터랙션 횟수 sendBeacon 전송
 */
export default function TrackerBootstrap() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const fired = useRef<Set<string>>(new Set());
  const pageEnteredAt = useRef<number>(Date.now());
  const maxScrollPct = useRef<number>(0);
  const interactionCount = useRef<number>(0);
  const exitSent = useRef<boolean>(false);

  useEffect(() => {
    // 새 경로 진입 → 카운터 리셋
    fired.current.clear();
    pageEnteredAt.current = Date.now();
    maxScrollPct.current = 0;
    interactionCount.current = 0;
    exitSent.current = false;

    if (typeof window === 'undefined') return;
    const path = pathname || '/';
    if (path.startsWith('/admin')) return;
    initTracker();

    const keyBase = `${path}?${searchParams.toString()}`;

    const emitMilestones = () => {
      if (!hasAnalyticsConsent()) return;
      const doc = document.documentElement;
      const scrollTop = window.scrollY || doc.scrollTop;
      const vh = window.innerHeight;
      const sh = Math.max(doc.scrollHeight, 1);
      const thresholds: Array<25 | 50 | 75 | 90> = [25, 50, 75, 90];

      const computedPct = sh <= vh + 8
        ? 100
        : Math.min(100, Math.round(((scrollTop + vh) / sh) * 100));
      if (computedPct > maxScrollPct.current) {
        maxScrollPct.current = computedPct;
      }

      if (sh <= vh + 8) {
        const k = `${keyBase}:90`;
        if (!fired.current.has(k)) {
          fired.current.add(k);
          trackScrollMilestone(90, window.location.href);
        }
        return;
      }

      for (const t of thresholds) {
        if (computedPct >= t) {
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

    // 인터랙션 카운터 — 클릭/탭 횟수 (마이크로 인터랙션 신호)
    const onInteract = () => {
      interactionCount.current += 1;
    };

    const sendExit = () => {
      if (exitSent.current) return;
      exitSent.current = true;
      if (!hasAnalyticsConsent()) return;
      const elapsedMs = Date.now() - pageEnteredAt.current;
      // 너무 짧은 체류(<300ms)는 noise — 스킵
      if (elapsedMs < 300) return;
      trackPageExit({
        page_url: window.location.href,
        time_on_page_ms: elapsedMs,
        max_scroll_pct: maxScrollPct.current,
        interaction_count: interactionCount.current,
      });
    };

    // pagehide: 모바일 Safari 호환 (beforeunload 보다 안전)
    const onPageHide = () => sendExit();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') sendExit();
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('click', onInteract, { passive: true });
    window.addEventListener('touchstart', onInteract, { passive: true });
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
    emitMilestones();

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('click', onInteract);
      window.removeEventListener('touchstart', onInteract);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
      if (scrollSettle) clearTimeout(scrollSettle);
      // 클라이언트 라우팅으로 경로가 바뀌는 경우(언마운트), exit 한 번 송신
      sendExit();
    };
  }, [pathname, searchParams]);

  return null;
}
