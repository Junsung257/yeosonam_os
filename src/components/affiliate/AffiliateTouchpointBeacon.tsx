'use client';

import { useEffect } from 'react';

interface AffiliateTouchpointBeaconProps {
  referralCode: string;
  packageId?: string | null;
  subId?: string | null;
}

export default function AffiliateTouchpointBeacon({
  referralCode,
  packageId,
  subId,
}: AffiliateTouchpointBeaconProps) {
  useEffect(() => {
    if (!referralCode) return;
    const params = new URLSearchParams({ ref: referralCode });
    if (packageId) params.set('pkg', packageId);
    if (subId) params.set('sub', subId);

    fetch(`/api/influencer/track?${params.toString()}`, {
      cache: 'no-store',
      keepalive: true,
    }).catch(() => {});
  }, [referralCode, packageId, subId]);

  return null;
}
