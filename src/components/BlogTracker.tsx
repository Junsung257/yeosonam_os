'use client';

import { useEffect } from 'react';
import { trackContentView } from '@/lib/tracker';

/**
 * 블로그 글 조회 추적 컴포넌트 (자가발전 AI용 데이터 수집)
 *
 * 수집 데이터:
 *   - First-touch 콘텐츠 어트리뷰션 (trackContentView)
 *   - 체류 시간 (beforeunload/pagehide 시점에 sendBeacon)
 *   - 최대 스크롤 깊이
 *   - 상품 CTA 클릭 여부 (a[href*="/packages/"] 클릭 감지)
 */
export default function BlogTracker({ contentCreativeId }: { contentCreativeId: string }) {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    trackContentView(contentCreativeId);

    const startedAt = Date.now();
    let maxScrollPct = 0;
    let ctaClicked = false;
    let sent = false;

    // 스크롤 깊이 측정 (스로틀링)
    let scrollTicking = false;
    const onScroll = () => {
      if (scrollTicking) return;
      scrollTicking = true;
      requestAnimationFrame(() => {
        const doc = document.documentElement;
        const scrollTop = window.scrollY || doc.scrollTop;
        const scrollHeight = Math.max(doc.scrollHeight - doc.clientHeight, 1);
        const pct = Math.min(100, Math.round((scrollTop / scrollHeight) * 100));
        if (pct > maxScrollPct) maxScrollPct = pct;
        scrollTicking = false;
      });
    };

    // CTA 클릭 감지 (/packages/[id] 링크)
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const link = target.closest('a') as HTMLAnchorElement | null;
      if (link && /\/packages\//.test(link.getAttribute('href') || '')) {
        ctaClicked = true;
      }
    };

    // 세션 ID 가져오기 (클라이언트 전용)
    const getSessionId = (): string | null => {
      try { return sessionStorage.getItem('ys_session_id'); } catch { return null; }
    };
    const getUserId = (): string | null => {
      try { return localStorage.getItem('ys_user_id'); } catch { return null; }
    };

    // 이탈 시 한 번만 전송 (sendBeacon으로 보장)
    const sendEngagement = () => {
      if (sent) return;
      sent = true;
      const timeOnPage = Math.round((Date.now() - startedAt) / 1000);
      const payload = JSON.stringify({
        content_creative_id: contentCreativeId,
        session_id: getSessionId(),
        user_id: getUserId(),
        time_on_page_seconds: timeOnPage,
        max_scroll_depth_pct: maxScrollPct,
        cta_clicked: ctaClicked,
      });

      // sendBeacon이 가능하면 사용 (이탈 시에도 전송 보장)
      if (navigator.sendBeacon) {
        const blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon('/api/blog-engagement', blob);
      } else {
        fetch('/api/blog-engagement', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true,
        }).catch(() => {});
      }
    };

    // 이벤트 등록
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('click', onClick);
    window.addEventListener('beforeunload', sendEngagement);
    window.addEventListener('pagehide', sendEngagement);
    // 탭 전환 시에도 감지 (모바일)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') sendEngagement();
    });

    return () => {
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('click', onClick);
      window.removeEventListener('beforeunload', sendEngagement);
      window.removeEventListener('pagehide', sendEngagement);
      // 컴포넌트 언마운트 시에도 전송
      sendEngagement();
    };
  }, [contentCreativeId]);

  return null;
}
