'use client';

import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { useId } from 'react';
import { ANALYTICS_EVENTS } from '@/lib/analytics-events';
import { trackEngagement } from '@/lib/tracker';

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
  'aria-describedby': ariaDescribedBy,
  ...props
}: TrackedKakaoLinkProps) {
  const kakaoDescriptionId = `${useId()}-kakao-description`;
  const kakaoDescription = target === '_blank'
    ? '여소남 카카오톡 채널 상담창을 새 탭으로 엽니다.'
    : '여소남 카카오톡 채널 상담창을 엽니다.';
  const describedBy = [ariaDescribedBy, kakaoDescriptionId].filter(Boolean).join(' ');

  return (
    <a
      {...props}
      href={KAKAO_URL}
      target={target}
      rel={rel}
      referrerPolicy={referrerPolicy}
      aria-describedby={describedBy}
      onClick={() => {
        trackEngagement({
          event_type: ANALYTICS_EVENTS.kakaoClicked,
          product_id: productId ?? undefined,
          cta_type: source,
          event_source: source,
          destination: destination ?? undefined,
          page_url: typeof window !== 'undefined' ? window.location.pathname : undefined,
          metadata: { ...metadata, source },
        });
      }}
    >
      {children}
      <span id={kakaoDescriptionId} className="sr-only">
        {kakaoDescription}
      </span>
    </a>
  );
}
