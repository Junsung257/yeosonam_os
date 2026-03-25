'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

export interface TrackingData {
  sessionId: string;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  referrer: string;
  landingUrl: string;
  scrollDepthReached: number; // 최대 도달 스크롤 깊이 (25/50/90)
  timeOnPageSeconds: number;
  itineraryViewed: boolean;
}

function generateSessionId(): string {
  const arr = new Uint8Array(9);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

function getOrCreateSessionId(): string {
  const key = 'lp_session_id';
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const id = generateSessionId();
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return generateSessionId();
  }
}

function parseUtm(search: string) {
  const p = new URLSearchParams(search);
  return {
    utmSource: p.get('utm_source'),
    utmMedium: p.get('utm_medium'),
    utmCampaign: p.get('utm_campaign'),
    utmContent: p.get('utm_content'),
  };
}

export function useTracking() {
  const startTimeRef = useRef<number>(Date.now());
  const [scrollDepth, setScrollDepth] = useState(0);
  const [itineraryViewed, setItineraryViewed] = useState(false);
  const sessionIdRef = useRef<string>('');
  const utmRef = useRef<ReturnType<typeof parseUtm>>({ utmSource: null, utmMedium: null, utmCampaign: null, utmContent: null });

  useEffect(() => {
    sessionIdRef.current = getOrCreateSessionId();
    utmRef.current = parseUtm(window.location.search);
  }, []);

  // 스크롤 깊이 센티널 등록
  const registerScrollSentinel = useCallback((el: HTMLElement | null, milestone: 25 | 50 | 90) => {
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setScrollDepth(prev => Math.max(prev, milestone));
          observer.disconnect();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 일정표 뷰 등록
  const registerItinerarySentinel = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.intersectionRatio >= 0.5) {
          setItineraryViewed(true);
          observer.disconnect();
        }
      },
      { threshold: 0.5 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const getSnapshot = useCallback((): TrackingData => ({
    sessionId: sessionIdRef.current,
    ...utmRef.current,
    referrer: typeof document !== 'undefined' ? document.referrer : '',
    landingUrl: typeof window !== 'undefined' ? window.location.href : '',
    scrollDepthReached: scrollDepth,
    timeOnPageSeconds: Math.round((Date.now() - startTimeRef.current) / 1000),
    itineraryViewed,
  }), [scrollDepth, itineraryViewed]);

  return {
    itineraryViewed,
    setItineraryViewed,
    registerScrollSentinel,
    registerItinerarySentinel,
    getSnapshot,
  };
}
