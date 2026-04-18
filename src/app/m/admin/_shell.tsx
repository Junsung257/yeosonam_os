'use client';

import { usePathname } from 'next/navigation';
import { MobileBottomTab } from '@/components/admin/mobile/MobileBottomTab';
import { useAutoRefreshSession } from '@/hooks/useAutoRefreshSession';

export default function MobileShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? '';
  // 로그인/오프라인 화면에서는 탭을 숨김
  const hideTabs =
    pathname.startsWith('/m/admin/login') ||
    pathname.startsWith('/m/admin/offline');

  // 로그인 화면에서는 세션 훅을 돌릴 필요가 없음
  useAutoRefreshSession({ enabled: !pathname.startsWith('/m/admin/login') });

  return (
    <div
      className="min-h-[100dvh] bg-slate-50 text-slate-900"
      style={{ paddingBottom: hideTabs ? 0 : 'calc(3.5rem + env(safe-area-inset-bottom))' }}
    >
      {children}
      {!hideTabs && <MobileBottomTab />}
    </div>
  );
}
