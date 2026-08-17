'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { hasAnalyticsConsent } from '@/lib/analytics/consent';

function getPageType(path: string): string {
  if (path.startsWith('/blog/')) return 'blog';
  if (path.startsWith('/packages') || path.startsWith('/tour')) return 'package';
  if (path.startsWith('/admin')) return 'admin';
  return 'page';
}

function getSlug(path: string): string | undefined {
  if (path.startsWith('/blog/')) {
    const parts = path.split('/');
    return parts[2] || undefined;
  }
  return undefined;
}

export default function WebVitalsReporter() {
  const pathname = usePathname();
  const sentRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Browser proof is synthetic traffic. It must validate rendering without
    // becoming production performance/engagement evidence.
    if (typeof window !== 'undefined'
      && new URLSearchParams(window.location.search).has('__proof_snapshot')) return;
    if (!hasAnalyticsConsent()) return;
    let cancelled = false;
    const path = pathname || '/';
    const pageType = getPageType(path);
    const slug = getSlug(path);

    const send = (name: string, value: number) => {
      const key = `${path}::${name}`;
      if (sentRef.current.has(key)) return;
      sentRef.current.add(key);

      const body = JSON.stringify({
        name, value, path, pageType, slug,
        route: path,
        device: window.matchMedia('(max-width: 767px)').matches ? 'mobile' : 'desktop',
        connectionType: (navigator as Navigator & { connection?: { effectiveType?: string } }).connection?.effectiveType || null,
        navigationType: performance.getEntriesByType('navigation')[0]
          ? (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming).type
          : null,
        consentState: 'granted',
      });
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/web-vitals', body);
      } else {
        fetch('/api/web-vitals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
        }).catch(() => {});
      }
    };

    // 동적 import로 web-vitals 로드 (Next.js 15 webpack 번들링 이슈 회피)
    import('web-vitals').then(({ onLCP, onCLS, onINP, onFCP, onTTFB }) => {
      if (cancelled) return;
      onLCP((m) => send('LCP', m.value));
      onCLS((m) => send('CLS', m.value));
      onINP((m) => send('INP', m.value));
      onFCP((m) => send('FCP', m.value));
      onTTFB((m) => send('TTFB', m.value));
    }).catch(() => {
      // web-vitals 로드 실패 시 조용히 무시
    });

    return () => { cancelled = true; };
  }, [pathname]);

  return null;
}
