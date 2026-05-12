'use client';

import { useRouter, usePathname } from 'next/navigation';

const STATUS_TABS = [
  { key: 'all', label: '전체' },
  { key: 'published', label: '발행됨' },
  { key: 'draft', label: '초안' },
];

export default function BlogFilterTabs({ currentStatus }: { currentStatus: string }) {
  const router = useRouter();
  const pathname = usePathname();

  const setStatus = (status: string) => {
    const params = new URLSearchParams();
    if (status !== 'all') params.set('status', status);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <div className="flex gap-1 bg-admin-surface-2 rounded-admin-sm p-1 w-fit">
      {STATUS_TABS.map(tab => (
        <button
          key={tab.key}
          onClick={() => setStatus(tab.key)}
          className={`px-3 h-8 text-admin-sm font-medium rounded-admin-xs transition-colors ${
            currentStatus === tab.key
              ? 'bg-admin-surface text-admin-text shadow-admin-xs'
              : 'text-admin-muted hover:text-admin-text-2'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
