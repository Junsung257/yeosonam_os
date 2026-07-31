'use client';

import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { ANALYTICS_EVENTS } from '@/lib/analytics-events';
import { trackEngagement } from '@/lib/tracker';
import { trackAnalyticsEvent } from '@/lib/analytics';

const KAKAO_URL = 'https://pf.kakao.com/_xcFxkBG/chat';

type TrackedKakaoLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'children' | 'onClick'> & {
  children: ReactNode;
  source: string;
  destination?: string | null;
  productId?: string | null;
  metadata?: Record<string, unknown>;
};

export default function TrackedKakaoLink({
  children,
  source,
  destination,
  productId,
  metadata,
  target = '_blank',
  rel = 'noopener noreferrer',
  referrerPolicy = 'no-referrer-when-downgrade',
  ...props
}: TrackedKakaoLinkProps) {
  return (
    <a
      {...props}
      href={KAKAO_URL}
      target={target}
      rel={rel}
      referrerPolicy={referrerPolicy}
      onClick={() => {
        trackAnalyticsEvent('ysn_kakao_click', {
          cta_location: source,
          page_type: typeof window !== 'undefined'
            ? (window.location.pathname.startsWith('/packages/') ? 'package_detail' : 'content')
            : 'content',
          package_id: productId ?? undefined,
          destination: destination ?? undefined,
          outbound_host: 'pf.kakao.com',
        });
        trackEngagement({
          event_type: ANALYTICS_EVENTS.kakaoClicked,
          product_id: productId ?? undefined,
          event_source: source,
          destination: destination ?? undefined,
          page_url: typeof window !== 'undefined' ? window.location.pathname : undefined,
          metadata: { ...metadata, source },
        });
      }}
    >
      {children}
    </a>
  );
}
