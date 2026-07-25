'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import Script from 'next/script';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isGa4ProductionHost,
  isGa4PublicPath,
  normalizeGa4MeasurementId,
} from '@/lib/ga4';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    __ysGa4Configured?: boolean;
  }
}

const GA4_ID = normalizeGa4MeasurementId(process.env.NEXT_PUBLIC_GA4_ID);

/**
 * Google Analytics 4 — gtag.js 표준 구현.
 *
 * 측정 ID가 유효하고 고객용 운영 도메인일 때만 로드한다. Vercel 미리보기,
 * localhost, /admin, /m/admin 방문은 고객 획득 보고서에 섞지 않는다.
 * App Router 화면 이동은 이 컴포넌트가 직접 page_view를 한 번씩 보낸다.
 * GA4 웹 스트림의 브라우저 기록 기반 페이지 변경은 꺼야 중복되지 않는다.
 */
export default function GA4Tracker() {
  const pathname = usePathname() || '/';
  const searchParams = useSearchParams();
  const [isProductionHost, setIsProductionHost] = useState(false);
  const [isTagReady, setIsTagReady] = useState(false);
  const lastPagePath = useRef<string | null>(null);
  const previousPageLocation = useRef<string | null>(null);

  useEffect(() => {
    setIsProductionHost(isGa4ProductionHost(window.location.hostname));
    previousPageLocation.current = document.referrer || null;
  }, []);

  const configureGa4 = useCallback(() => {
    if (!GA4_ID) return;
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || ((...args: unknown[]) => window.dataLayer?.push(args));

    if (!window.__ysGa4Configured) {
      window.gtag('js', new Date());
      window.gtag('config', GA4_ID, {
        send_page_view: false,
        anonymize_ip: true,
      });
      window.__ysGa4Configured = true;
    }

    setIsTagReady(true);
  }, []);

  const search = searchParams.toString();
  const pagePath = search ? `${pathname}?${search}` : pathname;
  const isPublicPage = isGa4PublicPath(pathname);

  useEffect(() => {
    if (!GA4_ID || !isProductionHost || !isPublicPage) return;
    configureGa4();
  }, [configureGa4, isProductionHost, isPublicPage]);

  useEffect(() => {
    if (!GA4_ID || !isProductionHost || !isTagReady || !isPublicPage) return;
    if (lastPagePath.current === pagePath) return;

    const timer = window.setTimeout(() => {
      const pageLocation = window.location.href;
      window.gtag?.('event', 'page_view', {
        page_title: document.title,
        page_location: pageLocation,
        page_path: pagePath,
        ...(previousPageLocation.current
          ? { page_referrer: previousPageLocation.current }
          : {}),
      });
      lastPagePath.current = pagePath;
      previousPageLocation.current = pageLocation;
    }, 0);

    return () => window.clearTimeout(timer);
  }, [isProductionHost, isPublicPage, isTagReady, pagePath]);

  if (!GA4_ID || !isProductionHost || !isPublicPage) return null;

  return (
    <>
      <Script
        id="ga4-library"
        src={`https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`}
        strategy="afterInteractive"
        onReady={configureGa4}
      />
      <Script id="ga4-bootstrap" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          window.gtag = window.gtag || function(){window.dataLayer.push(arguments);}
        `}
      </Script>
    </>
  );
}
