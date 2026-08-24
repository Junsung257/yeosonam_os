'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Package as PackageIcon, Search, ShieldCheck } from 'lucide-react';

import { EmptyState, PageHeader, SectionCard } from '@/components/admin/patterns';

export type ReadOnlyPackage = {
  id: string;
  title: string | null;
  display_title: string | null;
  destination: string | null;
  departure_airport: string | null;
  duration: number | null;
  nights: number | null;
  price: number | null;
  status: string | null;
  audit_status: string | null;
  internal_code: string | null;
  created_at: string | null;
};

function won(value: number | null): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value.toLocaleString('ko-KR')}원`
    : '가격 확인 필요';
}

function legacyStatusClass(status: string | null): string {
  if (status === 'approved' || status === 'active') return 'border-blue-200 bg-blue-50 text-blue-700';
  if (status === 'REVIEW_NEEDED' || status === 'needs_review') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

export function PackagesReadOnlyClient({ initialPackages }: { initialPackages: ReadOnlyPackage[] }) {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const rows = useMemo(() => initialPackages.filter(pkg => {
    if (!normalizedQuery) return true;
    return [pkg.title, pkg.display_title, pkg.destination, pkg.internal_code]
      .some(value => value?.toLowerCase().includes(normalizedQuery));
  }), [initialPackages, normalizedQuery]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="상품 호환 목록"
        subtitle="이 화면의 status는 레거시 projection 상태입니다. 실제 고객 공개는 상품등록 공개 관제에서 확인합니다."
        breadcrumb={[{ label: '상품', href: '/admin' }, { label: '호환 목록' }]}
        badge={<span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-bold text-slate-600">읽기 전용</span>}
        actions={(
          <Link
            href="/admin/product-registration"
            className="inline-flex min-h-11 items-center gap-2 rounded-admin-sm bg-blue-600 px-4 text-admin-sm font-bold text-white hover:bg-blue-700"
          >
            <ShieldCheck size={16} />
            고객 공개 관제
          </Link>
        )}
      />

      <div className="rounded-admin-sm border border-amber-200 bg-amber-50 px-4 py-3 text-admin-xs leading-5 text-amber-900">
        기존 승인·일괄승인·직접 상태 변경 기능은 퇴역했습니다. 상품 사실 수정은 원문 기반 재등록·교정으로, 고객 공개는 exact revision 모바일 검수 요청으로 처리합니다.
      </div>

      <SectionCard
        title={`호환 projection ${initialPackages.length.toLocaleString('ko-KR')}개`}
        description="검색과 상품 검수 링크만 제공합니다. 이 목록의 상태만으로 고객에게 노출되지 않습니다."
        actions={(
          <label className="relative block">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-admin-muted" />
            <span className="sr-only">상품 검색</span>
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="상품명·지역·코드"
              className="min-h-10 w-56 rounded-admin-sm border border-admin-border-strong bg-white pl-9 pr-3 text-admin-xs outline-none focus:border-blue-500"
            />
          </label>
        )}
        flush
      >
        {rows.length === 0 ? (
          <EmptyState icon={PackageIcon} title="검색 결과가 없습니다." description="다른 상품명이나 내부 코드를 입력해 주세요." />
        ) : (
          <div className="divide-y divide-admin-border">
            {rows.map(pkg => (
              <article key={pkg.id} className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-admin-sm font-bold text-admin-text">
                      {pkg.display_title || pkg.title || '제목 미정'}
                    </h2>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${legacyStatusClass(pkg.status)}`}>
                      호환 상태 {pkg.status ?? '미정'}
                    </span>
                  </div>
                  <p className="mt-1 text-admin-xs text-admin-muted">
                    {[pkg.destination, pkg.departure_airport, pkg.duration ? `${pkg.duration}일` : null]
                      .filter(Boolean).join(' · ') || '기본 정보 확인 필요'}
                  </p>
                  <p className="mt-1 font-mono text-[10px] text-admin-muted-2">{pkg.internal_code ?? pkg.id}</p>
                </div>
                <p className="text-admin-sm font-black tabular-nums text-admin-text">{won(pkg.price)}</p>
                <Link
                  href={`/admin/packages/${encodeURIComponent(pkg.id)}/review`}
                  className="inline-flex min-h-10 items-center justify-center rounded-admin-sm border border-admin-border-strong bg-white px-3 text-admin-xs font-semibold text-admin-text hover:bg-admin-bg"
                >
                  원문·상품 검수
                </Link>
              </article>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
