'use client';

import type { ComponentPropsWithoutRef } from 'react';
import { trackAnalyticsEvent } from '@/lib/analytics';

type PhoneLinkProps = Omit<ComponentPropsWithoutRef<'a'>, 'href'> & {
  href: string;
  ctaLocation: string;
  pageType: string;
  packageId?: string;
  destination?: string;
};

export default function TrackedPhoneLink({
  href,
  ctaLocation,
  pageType,
  packageId,
  destination,
  onClick,
  children,
  ...anchorProps
}: PhoneLinkProps) {
  return (
    <a
      {...anchorProps}
      href={href}
      onClick={(event) => {
        trackAnalyticsEvent('ysn_phone_click', {
          cta_location: ctaLocation,
          page_type: pageType,
          package_id: packageId,
          destination,
        });
        onClick?.(event);
      }}
    >
      {children}
    </a>
  );
}
