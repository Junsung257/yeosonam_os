'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  installAttributionCapture,
  trackAnalyticsEvent,
} from '@/lib/analytics';
import { CONSENT_EVENT } from '@/lib/analytics/consent';
import GoogleTagManager from './GoogleTagManager';

function pageType(pathname: string): string {
  if (/^\/packages\/[^/]+/.test(pathname)) return 'package_detail';
  if (pathname === '/packages') return 'package_list';
  if (/^\/lp\/[^/]+/.test(pathname)) return 'campaign_landing';
  if (/^\/blog\/[^/]+/.test(pathname)) return 'blog_article';
  if (pathname === '/blog') return 'blog_list';
  return pathname === '/' ? 'home' : 'content';
}

export default function AnalyticsProvider({
  containerId,
  measurementId,
  runtimeEnabled,
  expectedHostname,
}: {
  containerId: string | null;
  measurementId: string | null;
  runtimeEnabled: boolean;
  expectedHostname: string;
}) {
  const pathname = usePathname() || '/';
  const isInternal = pathname.startsWith('/admin') || pathname.startsWith('/m/admin');
  const [consentRevision, setConsentRevision] = useState(0);
  const navigationRef = useRef({ pathname: '', sequence: 0 });

  useEffect(() => {
    const hostAllowed =
      window.location.hostname === expectedHostname
      || process.env.NODE_ENV !== 'production';
    window.__YS_ANALYTICS_RUNTIME__ = runtimeEnabled && hostAllowed;
  }, [expectedHostname, runtimeEnabled]);

  useEffect(() => installAttributionCapture(), []);

  useEffect(() => {
    const handleConsentChange = () => setConsentRevision(value => value + 1);
    window.addEventListener(CONSENT_EVENT, handleConsentChange);
    return () => window.removeEventListener(CONSENT_EVENT, handleConsentChange);
  }, []);

  useEffect(() => {
    if (isInternal) return;
    if (navigationRef.current.pathname !== pathname) {
      navigationRef.current = {
        pathname,
        sequence: navigationRef.current.sequence + 1,
      };
    }
    trackAnalyticsEvent('page_view', {
      page_type: pageType(pathname),
      page_path: pathname,
      page_title: document.title.slice(0, 200),
    }, { dedupeKey: `${pathname}:${navigationRef.current.sequence}` });
  }, [consentRevision, isInternal, pathname]);

  return (
    <>
      {containerId && !isInternal ? (
        <GoogleTagManager
          containerId={containerId}
          measurementId={measurementId}
          runtimeEnabled={runtimeEnabled}
          expectedHostname={expectedHostname}
        />
      ) : null}
    </>
  );
}
