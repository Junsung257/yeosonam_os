'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useParams } from 'next/navigation';

interface Tenant {
  id:   string;
  name: string;
  status: string;
}

export default function TenantLayout({ children }: { children: React.ReactNode }) {
  const pathname  = usePathname();
  const params    = useParams();
  const tenantId  = params.tenantId as string;
  const [tenant, setTenant] = useState<Tenant | null>(null);

  useEffect(() => {
    fetch(`/api/tenants/${tenantId}`)
      .then(r => r.json())
      .then(d => setTenant(d.tenant ?? null))
      .catch(() => {});
  }, [tenantId]);

  const navItems = [
    { href: `/tenant/${tenantId}/products`,    label: '🛍 상품 관리' },
    { href: `/tenant/${tenantId}/inventory`,   label: '📅 재고 관리' },
    { href: `/tenant/${tenantId}/settlements`, label: '💰 정산 조회' },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      {/* 테넌트 전용 헤더 */}
      <nav className="bg-white border-b shadow-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-4">
              {/* 마스터로 돌아가기 */}
              <Link
                href="/admin/tenants"
                className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 transition"
              >
                ← 마스터 관리자
              </Link>
              <span className="text-gray-200">│</span>
              <div className="flex items-center gap-2">
                <span className="text-base font-bold text-slate-800">
                  🏢 {tenant?.name ?? '테넌트 대시보드'}
                </span>
                {tenant && (
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    tenant.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                  }`}>
                    {tenant.status}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 ml-4">
                {navItems.map(item => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      pathname.startsWith(item.href)
                        ? 'bg-indigo-50 text-indigo-700'
                        : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
            <div className="text-xs text-gray-400 bg-amber-50 border border-amber-200 text-amber-700 px-3 py-1 rounded-full font-medium">
              🧪 샌드박스 모드 — 테스트 환경
            </div>
          </div>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {children}
      </main>
    </div>
  );
}
