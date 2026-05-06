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
    <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
      {STATUS_TABS.map(tab => (
        <button
          key={tab.key}
          onClick={() => setStatus(tab.key)}
          className={`px-3 py-1.5 text-admin-xs font-medium rounded-md transition ${
            currentStatus === tab.key
              ? 'bg-white text-slate-800 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
