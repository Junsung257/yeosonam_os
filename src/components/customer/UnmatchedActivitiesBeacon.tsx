'use client';

import { useEffect } from 'react';

interface UnmatchedActivityItem {
  activity: string;
  package_id?: string;
  package_title?: string;
  day_number?: number;
  country?: string;
  region?: string;
}

export default function UnmatchedActivitiesBeacon({ items }: { items: UnmatchedActivityItem[] }) {
  useEffect(() => {
    if (!items.length) return;

    const payloadItems = items.slice(0, 40);
    fetch('/api/unmatched', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: payloadItems }),
      cache: 'no-store',
      keepalive: true,
    }).catch(() => {});
  }, [items]);

  return null;
}
