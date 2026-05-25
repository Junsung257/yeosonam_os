'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { onLCP, onCLS, onINP, onFCP, onTTFB } from 'web-vitals';

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
    const pageType = getPageType(pathname);
    const slug = getSlug(pathname);

    const send = (name: string, value: number) => {
      // 페이지당 각 메트릭 1회만 전송
      const key = `${pathname}::${name}`;
      if (sentRef.current.has(key)) return;
      sentRef.current.add(key);

      const body = JSON.stringify({ name, value, path: pathname, pageType, slug });
      // sendBeacon이 가장 안전 (페이지 떠나도 전송), fallback: fetch
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

    // 각 메트릭 등록
    onLCP((m) => send('LCP', m.value));
    onCLS((m) => send('CLS', m.value));
    onINP((m) => send('INP', m.value));
    onFCP((m) => send('FCP', m.value));
    onTTFB((m) => send('TTFB', m.value));
  }, [pathname]);

  return null; // UI 없음 — 측정만
}
