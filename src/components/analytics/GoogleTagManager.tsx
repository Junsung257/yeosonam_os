'use client';

import Script from 'next/script';
import { useEffect, useState } from 'react';
import {
  CONSENT_EVENT,
  initializeConsentMode,
  shouldLoadGoogleTagManager,
} from '@/lib/analytics/consent';
import { setGaClientId } from '@/lib/analytics/attribution';

export default function GoogleTagManager({
  containerId,
  measurementId,
  runtimeEnabled,
  expectedHostname,
}: {
  containerId: string;
  measurementId: string | null;
  runtimeEnabled: boolean;
  expectedHostname: string;
}) {
  const [load, setLoad] = useState(false);

  useEffect(() => {
    const hostAllowed =
      window.location.hostname === expectedHostname
      || process.env.NODE_ENV !== 'production';
    window.__YS_ANALYTICS_RUNTIME__ = runtimeEnabled && hostAllowed;
    const update = () => {
      initializeConsentMode();
      const shouldLoad = window.__YS_ANALYTICS_RUNTIME__ === true && shouldLoadGoogleTagManager();
      if (shouldLoad && !window.__YS_GTM_STARTED__) {
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push({
          'gtm.start': Date.now(),
          event: 'gtm.js',
        });
        window.__YS_GTM_STARTED__ = true;
      }
      setLoad(shouldLoad);
    };
    update();
    window.addEventListener(CONSENT_EVENT, update);
    return () => window.removeEventListener(CONSENT_EVENT, update);
  }, [expectedHostname, runtimeEnabled]);

  const captureClientId = () => {
    if (!measurementId || !window.gtag) return;
    window.setTimeout(() => {
      window.gtag?.('get', measurementId, 'client_id', (clientId: unknown) => {
        if (typeof clientId === 'string') setGaClientId(clientId);
      });
    }, 1_000);
  };

  if (!load) return null;
  return (
    <Script
      id="ysn-google-tag-manager"
      strategy="afterInteractive"
      src={`https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(containerId)}`}
      onLoad={captureClientId}
      onError={() => {
        window.__YS_ANALYTICS_RUNTIME__ = false;
      }}
    />
  );
}

declare global {
  interface Window {
    __YS_GTM_STARTED__?: boolean;
  }
}
