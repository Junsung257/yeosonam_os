'use client';

import { useEffect } from 'react';
import { ANALYTICS_EVENTS } from '@/lib/analytics-events';
import { getSessionId, trackContentView, trackEngagement } from '@/lib/tracker';

const LAST_CONTENT_KEY = 'ys_last_content_creative_id';
const LAST_CONTENT_TS_KEY = 'ys_last_content_creative_ts';
const ATTRIBUTION_WINDOW_MS = 24 * 60 * 60 * 1000;
const SCROLL_MILESTONES = [25, 50, 75, 90] as const;

type BlogEngagementEventType =
  | 'summary'
  | 'scroll_25'
  | 'scroll_50'
  | 'scroll_75'
  | 'scroll_90'
  | 'cta_impression'
  | 'cta_click';

type CtaMeta = {
  href: string;
  placement: string | null;
  packageId: string | null;
  isKakao: boolean;
};

export function readLastContentCreativeId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const id = sessionStorage.getItem(LAST_CONTENT_KEY) || localStorage.getItem(LAST_CONTENT_KEY);
    const ts = Number(sessionStorage.getItem(LAST_CONTENT_TS_KEY) || localStorage.getItem(LAST_CONTENT_TS_KEY));
    if (!id || !ts) return null;
    if (Date.now() - ts > ATTRIBUTION_WINDOW_MS) return null;
    return id;
  } catch {
    return null;
  }
}

function readUserId(): string | null {
  try {
    return localStorage.getItem('ys_user_id');
  } catch {
    return null;
  }
}

function getCtaMeta(link: HTMLAnchorElement): CtaMeta | null {
  const href = link.getAttribute('href') || '';
  const isProductCta = href.startsWith('/packages/') || href.startsWith('/packages?') || Boolean(link.dataset.blogProductId);
  const isKakaoCta = /pf\.kakao\.com/.test(href);
  const isMarkedCta = link.dataset.blogCta === 'true';

  if (!isProductCta && !isKakaoCta && !isMarkedCta) return null;

  return {
    href,
    placement: link.dataset.recommendationPlacement || link.dataset.blogCtaPlacement || null,
    packageId: link.dataset.blogProductId || null,
    isKakao: isKakaoCta,
  };
}

function clampTime(seconds: number) {
  return Math.max(0, Math.min(3600, Math.round(seconds)));
}

function clampScroll(pct: number) {
  return Math.max(0, Math.min(100, Math.round(pct)));
}

export default function BlogTracker({ contentCreativeId }: { contentCreativeId: string }) {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    trackContentView(contentCreativeId);

    try {
      const now = String(Date.now());
      sessionStorage.setItem(LAST_CONTENT_KEY, contentCreativeId);
      sessionStorage.setItem(LAST_CONTENT_TS_KEY, now);
      localStorage.setItem(LAST_CONTENT_KEY, contentCreativeId);
      localStorage.setItem(LAST_CONTENT_TS_KEY, now);
    } catch {
      // Ignore storage failures in private browsing modes.
    }

    const startedAt = Date.now();
    const params = new URLSearchParams(window.location.search);
    const sessionId = getSessionId();
    let maxScrollPct = 0;
    let ctaClicked = false;
    let ctaVisible = false;
    let summarySent = false;
    let scrollTicking = false;
    const sentMilestones = new Set<number>();
    const seenCtaImpressions = new Set<string>();

    const buildPayload = (
      eventType: BlogEngagementEventType,
      overrides: Partial<Record<string, unknown>> = {},
    ) => ({
      content_creative_id: contentCreativeId,
      session_id: sessionId,
      user_id: readUserId(),
      event_type: eventType,
      time_on_page_seconds: clampTime((Date.now() - startedAt) / 1000),
      max_scroll_depth_pct: clampScroll(maxScrollPct),
      cta_clicked: ctaClicked || eventType === 'cta_click',
      cta_visible: ctaVisible || eventType === 'cta_impression' || eventType === 'cta_click',
      ad_landing_mapping_id: params.get('ad_mapping_id') || params.get('ad_landing_mapping_id') || params.get('admid'),
      utm_source: params.get('utm_source'),
      utm_medium: params.get('utm_medium'),
      utm_campaign: params.get('utm_campaign'),
      utm_term: params.get('utm_term'),
      ...overrides,
    });

    const postEngagement = (payload: Record<string, unknown>, preferBeacon = false) => {
      const body = JSON.stringify(payload);
      if (preferBeacon && navigator.sendBeacon) {
        const blob = new Blob([body], { type: 'application/json' });
        navigator.sendBeacon('/api/blog-engagement', blob);
        return;
      }

      fetch('/api/blog-engagement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => {});
    };

    const sendEvent = (
      eventType: BlogEngagementEventType,
      overrides: Partial<Record<string, unknown>> = {},
      preferBeacon = false,
    ) => {
      postEngagement(buildPayload(eventType, overrides), preferBeacon);
    };

    const sendSummary = () => {
      if (summarySent) return;
      summarySent = true;
      sendEvent('summary', {}, true);
    };

    const checkMilestones = () => {
      for (const milestone of SCROLL_MILESTONES) {
        if (maxScrollPct >= milestone && !sentMilestones.has(milestone)) {
          sentMilestones.add(milestone);
          sendEvent(`scroll_${milestone}` as BlogEngagementEventType, {
            event_payload: { milestone },
          });
        }
      }
    };

    const onScroll = () => {
      if (scrollTicking) return;
      scrollTicking = true;
      requestAnimationFrame(() => {
        const doc = document.documentElement;
        const scrollTop = window.scrollY || doc.scrollTop;
        const scrollHeight = Math.max(doc.scrollHeight - doc.clientHeight, 1);
        maxScrollPct = Math.max(maxScrollPct, clampScroll((scrollTop / scrollHeight) * 100));
        checkMilestones();
        scrollTicking = false;
      });
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const link = target?.closest('a') as HTMLAnchorElement | null;
      if (!link) return;

      const cta = getCtaMeta(link);
      if (!cta) return;

      ctaClicked = true;
      sendEvent('cta_click', {
        cta_placement: cta.placement,
        cta_href: cta.href,
        event_payload: {
          package_id: cta.packageId,
          text: link.textContent?.trim().slice(0, 80) || null,
        },
      }, true);

      if (cta.isKakao) {
        trackEngagement({
          event_type: ANALYTICS_EVENTS.kakaoClicked,
          cta_type: 'blog_cta',
          page_url: window.location.pathname,
          metadata: {
            source: 'blog_cta',
            contentCreativeId,
            placement: cta.placement,
            href: cta.href,
            text: link.textContent?.trim().slice(0, 80) || null,
          },
        });
      }

      if (!cta.packageId) return;

      fetch('/api/tracking/recommendation', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          package_id: cta.packageId,
          source: 'blog',
          outcome: 'click',
          session_id: sessionId,
          intent: link.dataset.blogIntent || 'blog',
          recommended_rank: link.dataset.recommendationRank
            ? Number(link.dataset.recommendationRank)
            : null,
          notes: JSON.stringify({
            content_creative_id: contentCreativeId,
            placement: cta.placement,
          }),
        }),
        keepalive: true,
      }).catch(() => {});
    };

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting || entry.intersectionRatio < 0.2) continue;
        const link = entry.target as HTMLAnchorElement;
        const cta = getCtaMeta(link);
        if (!cta) continue;

        ctaVisible = true;
        const key = `${cta.placement || 'unknown'}:${cta.href}`;
        if (seenCtaImpressions.has(key)) continue;
        seenCtaImpressions.add(key);
        sendEvent('cta_impression', {
          cta_placement: cta.placement,
          cta_href: cta.href,
          event_payload: {
            package_id: cta.packageId,
            text: link.textContent?.trim().slice(0, 80) || null,
          },
        });
      }
    }, { threshold: [0.2, 0.5] });

    const observeCtas = () => {
      document
        .querySelectorAll<HTMLAnchorElement>('a[data-blog-cta="true"], a[data-blog-product-id], a[href*="/packages"], a[href*="pf.kakao.com"]')
        .forEach((link) => observer.observe(link));
    };

    observeCtas();
    onScroll();

    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('click', onClick);
    window.addEventListener('beforeunload', sendSummary);
    window.addEventListener('pagehide', sendSummary);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') sendSummary();
    });

    return () => {
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('click', onClick);
      window.removeEventListener('beforeunload', sendSummary);
      window.removeEventListener('pagehide', sendSummary);
      observer.disconnect();
      sendSummary();
    };
  }, [contentCreativeId]);

  return null;
}
