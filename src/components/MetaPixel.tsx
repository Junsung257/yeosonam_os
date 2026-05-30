'use client';

import Script from 'next/script';
import { hasMarketingConsent, useMarketingConsent } from '@/lib/consent';
import { thirdPartyScriptType } from '@/lib/third-party-script-type';

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID;
const META_ALLOWED_HOSTS = new Set(['yeosonam.com', 'www.yeosonam.com', 'localhost', '127.0.0.1']);

function isMetaTrackingHost() {
  if (typeof window === 'undefined') return false;
  if (process.env.NEXT_PUBLIC_META_PIXEL_ALLOW_PREVIEW === '1') return true;
  return META_ALLOWED_HOSTS.has(window.location.hostname);
}

export default function MetaPixel() {
  const consent = useMarketingConsent();
  if (!PIXEL_ID || !consent || !isMetaTrackingHost()) return null;

  return (
    <>
      <Script
        id="meta-pixel-init"
        type={thirdPartyScriptType()}
        strategy="lazyOnload"
        dangerouslySetInnerHTML={{
          __html: `
            !function(f,b,e,v,n,t,s)
            {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};
            if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
            n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t,s)}(window, document,'script',
            'https://connect.facebook.net/en_US/fbevents.js');
            fbq('init', '${PIXEL_ID}');
            fbq('track', 'PageView');
          `,
        }}
      />
      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          height="1"
          width="1"
          style={{ display: 'none' }}
          src={`https://www.facebook.com/tr?id=${PIXEL_ID}&ev=PageView&noscript=1`}
          alt=""
        />
      </noscript>
    </>
  );
}

function createMetaEventId(eventName: string) {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `ys:${eventName}:${random}`;
}

function sendServerConversion(eventName: string, eventId: string, payload: Record<string, unknown>) {
  if (!hasMarketingConsent() || !isMetaTrackingHost()) return;
  const body = {
    event_name: eventName,
    event_id: eventId,
    event_source_url: typeof window !== 'undefined' ? window.location.href : undefined,
    ...payload,
  };
  const json = JSON.stringify(body);
  if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
    navigator.sendBeacon('/api/tracking/meta-conversion', new Blob([json], { type: 'application/json' }));
    return;
  }
  void fetch('/api/tracking/meta-conversion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: json,
    keepalive: true,
  }).catch(() => {});
}

export function trackViewContent(params: {
  content_name: string;
  content_category: string;
  value: number;
  content_ids?: string[];
  content_type?: string;
}) {
  if (!hasMarketingConsent() || !isMetaTrackingHost()) return;
  const eventId = createMetaEventId('ViewContent');
  const payload: Record<string, unknown> = {
    content_name: params.content_name,
    content_category: params.content_category,
    value: params.value,
    currency: 'KRW',
  };
  if (params.content_ids?.length) {
    payload.content_ids = params.content_ids;
    payload.content_type = params.content_type ?? 'product';
  }
  if (typeof window !== 'undefined' && window.fbq) {
    window.fbq('track', 'ViewContent', payload, { eventID: eventId });
  }
  sendServerConversion('ViewContent', eventId, payload);
}

export function trackLead(params: {
  content_name: string;
  value: number;
  content_ids?: string[];
  content_type?: string;
}) {
  if (!hasMarketingConsent() || !isMetaTrackingHost()) return;
  const eventId = createMetaEventId('Lead');
  const payload: Record<string, unknown> = {
    content_name: params.content_name,
    value: params.value,
    currency: 'KRW',
  };
  if (params.content_ids?.length) {
    payload.content_ids = params.content_ids;
    payload.content_type = params.content_type ?? 'product';
  }
  if (typeof window !== 'undefined' && window.fbq) {
    window.fbq('track', 'Lead', payload, { eventID: eventId });
  }
  sendServerConversion('Lead', eventId, payload);
}

export function trackPurchase(params: {
  value: number;
  content_ids?: string[];
  content_type?: string;
  num_items?: number;
}) {
  if (!hasMarketingConsent() || !isMetaTrackingHost()) return;
  const eventId = createMetaEventId('Purchase');
  const payload: Record<string, unknown> = {
    value: params.value,
    currency: 'KRW',
  };
  if (params.content_ids?.length) {
    payload.content_ids = params.content_ids;
    payload.content_type = params.content_type ?? 'product';
  }
  if (params.num_items !== undefined) {
    payload.num_items = params.num_items;
  }
  if (typeof window !== 'undefined' && window.fbq) {
    window.fbq('track', 'Purchase', payload, { eventID: eventId });
  }
  sendServerConversion('Purchase', eventId, payload);
}
