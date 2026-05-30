'use client';

import dynamic from 'next/dynamic';

const RecentViews = dynamic(() => import('@/components/customer/RecentViews'), {
  ssr: false,
  loading: () => null,
});

export default function RecentViewsDeferred({ currentPackageId }: { currentPackageId: string }) {
  return <RecentViews currentPackageId={currentPackageId} />;
}
