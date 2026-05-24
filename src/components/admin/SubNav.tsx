'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface SubNavTab {
  href: string;
  label: string;
  /** 권한 키 (Phase 2에서 사용) */
  permission?: string;
}

interface SubNavProps {
  basePath: string;
  tabs: SubNavTab[];
}

/**
 * 페이지 내부 서브 내비게이션.
 * 사이드바를 가볍게 유지하고 상세 기능은 이 컴포넌트로 전환한다.
 *
 * 사용 예:
 * <SubNav basePath="/admin/search-ads" tabs={[
 *   { href: '/admin/search-ads', label: '캠페인' },
 *   { href: '/admin/search-ads/keywords', label: '키워드' },
 *   { href: '/admin/search-ads/reports', label: '리포트' },
 * ]} />
 */
export default function SubNav({ basePath, tabs }: SubNavProps) {
  const pathname = usePathname();

  return (
    <div className="border-b border-admin-border mb-6">
      <nav className="flex gap-0 -mb-px overflow-x-auto scrollbar-none">
        {tabs.map((tab) => {
          const isActive = pathname === tab.href || pathname.startsWith(tab.href + '/');
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`whitespace-nowrap px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors ${
                isActive
                  ? 'border-[#6366f1] text-[#6366f1]'
                  : 'border-transparent text-admin-muted hover:text-admin-text-2 hover:border-admin-border-strong'
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
