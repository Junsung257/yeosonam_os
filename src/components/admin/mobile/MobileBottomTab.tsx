'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, ClipboardList, Wallet, Bell } from 'lucide-react';

interface Tab {
  href: string;
  label: string;
  icon: typeof Home;
  exact?: boolean;
}

const TABS: Tab[] = [
  { href: '/m/admin', label: '홈', icon: Home, exact: true },
  { href: '/m/admin/bookings', label: '예약', icon: ClipboardList },
  { href: '/m/admin/payments', label: '입금', icon: Wallet },
  { href: '/m/admin/notifications', label: '알림', icon: Bell },
];

export function MobileBottomTab() {
  const pathname = usePathname() ?? '/';

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 bg-white border-t border-slate-200"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="grid grid-cols-4">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const active = tab.exact
            ? pathname === tab.href
            : pathname === tab.href || pathname.startsWith(tab.href + '/');
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                className={`flex flex-col items-center justify-center h-14 text-[11px] gap-0.5 transition ${
                  active
                    ? 'text-slate-900'
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                <Icon size={20} strokeWidth={active ? 2.4 : 1.8} />
                <span className={active ? 'font-semibold' : ''}>{tab.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
