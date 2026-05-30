'use client';

import Script from 'next/script';
import { useAnalyticsConsent } from '@/lib/consent';
import { thirdPartyScriptType } from '@/lib/third-party-script-type';

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID;
const META_ALLOWED_HOSTS = new Set(['yeosonam.com', 'www.yeosonam.com']);

function isMetaTrackingHost() {
  if (typeof window === 'undefined') return false;
  return META_ALLOWED_HOSTS.has(window.location.hostname);
}

/**
 * Meta 픽셀 초기화 + PageView 자동 추적
 * NEXT_PUBLIC_META_PIXEL_ID 없으면 렌더링 안 함
 * PIPA: 사용자 분석 동의 전엔 발화 안 함 (`@/lib/consent`)
 */
export default function MetaPixel() {
  const consent = useAnalyticsConsent();
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

// 동의 게이트 — 외부에서 import 시 사용
import { hasAnalyticsConsent } from '@/lib/consent';

/**
 * ViewContent 이벤트 (상품 상세·LP 등)
 * `content_ids` 는 카탈로그·전환 최적화용으로 Meta 권장 필드.
 * 동의 없으면 noop.
 */
export function trackViewContent(params: {
  content_name: string;
  content_category: string;
  value: number;
  /** 패키지 UUID·SKU 등 — 있으면 content_type 과 함께 전송 */
  content_ids?: string[];
  /** 기본 product (Meta 카탈로그 관례) */
  content_type?: string;
}) {
  if (!hasAnalyticsConsent() || !isMetaTrackingHost()) return;
  if (typeof window !== 'undefined' && window.fbq) {
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
    window.fbq('track', 'ViewContent', payload);
  }
}

/**
 * Lead 이벤트 (문의·리드 제출)
 * 동의 없으면 noop.
 */
export function trackLead(params: {
  content_name: string;
  value: number;
  content_ids?: string[];
  content_type?: string;
}) {
  if (!hasAnalyticsConsent() || !isMetaTrackingHost()) return;
  if (typeof window !== 'undefined' && window.fbq) {
    const payload: Record<string, unknown> = {
      content_name: params.content_name,
      value: params.value,
      currency: 'KRW',
    };
    if (params.content_ids?.length) {
      payload.content_ids = params.content_ids;
      payload.content_type = params.content_type ?? 'product';
    }
    window.fbq('track', 'Lead', payload);
  }
}

/**
 * Purchase 이벤트 (결제·예약 완료)
 * 서버사이드 CAPI 포스트백과 별도로 브라우저 픽셀에서도 전송.
 * 동의 없으면 noop.
 */
export function trackPurchase(params: {
  value: number;
  content_ids?: string[];
  content_type?: string;
  num_items?: number;
}) {
  if (!hasAnalyticsConsent() || !isMetaTrackingHost()) return;
  if (typeof window !== 'undefined' && window.fbq) {
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
    window.fbq('track', 'Purchase', payload);
  }
}
