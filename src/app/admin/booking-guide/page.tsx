'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Printer } from 'lucide-react';
import BookingGuideTemplate from '@/components/admin/BookingGuideTemplate';
import { PageHeader } from '@/components/admin/patterns';
import Button from '@/components/ui/Button';
import type { NoticeBlock } from '@/lib/standard-terms';

interface PackageOption {
  id: string;
  title: string;
  destination?: string;
}

function BookingGuideFallback() {
  return (
    <div className="max-w-4xl mx-auto space-y-4 animate-pulse">
      <div className="space-y-2">
        <div className="h-7 w-40 rounded bg-admin-surface-2" />
        <div className="h-4 w-80 max-w-full rounded bg-admin-surface-2" />
      </div>
      <div className="admin-card p-4">
        <div className="h-4 w-20 rounded bg-admin-surface-2 mb-2" />
        <div className="h-9 rounded bg-admin-surface-2" />
      </div>
      <div className="h-72 rounded bg-admin-surface-2" />
    </div>
  );
}

function BookingGuideContent() {
  const search = useSearchParams();
  const initialPkgId = search?.get('pkg') ?? '';

  const [packages, setPackages] = useState<PackageOption[]>([]);
  const [selectedPkgId, setSelectedPkgId] = useState(initialPkgId);
  const [selectedTitle, setSelectedTitle] = useState<string | undefined>();
  const [resolvedNotices, setResolvedNotices] = useState<NoticeBlock[]>([]);
  const [loading, setLoading] = useState(false);
  const [packageLoadError, setPackageLoadError] = useState(false);

  useEffect(() => {
    setPackageLoadError(false);
    fetch('/api/packages?limit=200')
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load packages');
        return r.json();
      })
      .then((d) => {
        const rows = Array.isArray(d.packages) ? d.packages : d.data ?? [];
        setPackages(rows.map((p: Record<string, unknown>) => ({
          id: String(p.id),
          title: String(p.display_title ?? p.title ?? p.id),
          destination: typeof p.destination === 'string' ? p.destination : undefined,
        })));
      })
      .catch(() => {
        setPackageLoadError(true);
        setPackages([]);
      });
  }, []);

  useEffect(() => {
    if (!selectedPkgId) {
      setResolvedNotices([]);
      setSelectedTitle(undefined);
      return;
    }

    setLoading(true);
    fetch(`/api/packages/${encodeURIComponent(selectedPkgId)}/terms?surface=booking_guide`)
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load notices');
        return r.json();
      })
      .then((d) => setResolvedNotices((Array.isArray(d.data) ? d.data : []) as NoticeBlock[]))
      .catch(() => setResolvedNotices([]))
      .finally(() => setLoading(false));

    const pkg = packages.find((p) => p.id === selectedPkgId);
    setSelectedTitle(pkg?.title);
  }, [selectedPkgId, packages]);

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title="예약 안내문"
        subtitle="상품별 약관이 적용된 안내문을 미리 보고 인쇄 또는 PDF로 저장합니다."
        actions={
          <Button variant="primary" size="sm" onClick={() => window.print()}>
            <Printer size={14} />
            인쇄 / PDF 저장
          </Button>
        }
      />
      <div className="admin-card p-4 mb-4">
        <label className="block text-admin-xs text-admin-text-2 font-medium mb-1.5">상품 선택</label>
        <select
          value={selectedPkgId}
          onChange={(e) => setSelectedPkgId(e.target.value)}
          className="w-full h-9 border border-admin-border-mid rounded-admin-sm px-3 text-admin-base bg-admin-surface text-admin-text focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
        >
          <option value="">공통 안내문만 보기 (상품별 약관 미적용)</option>
          {packages.map((p) => (
            <option key={p.id} value={p.id}>{p.title} {p.destination ? `(${p.destination})` : ''}</option>
          ))}
        </select>
        {packageLoadError ? (
          <p className="mt-2 text-admin-xs text-status-dangerFg">
            상품 목록을 불러오지 못했습니다. 공통 안내문은 계속 확인할 수 있습니다.
          </p>
        ) : null}
      </div>
      {loading ? (
        <p className="text-center text-admin-muted text-admin-sm mb-3">약관을 불러오는 중입니다.</p>
      ) : null}
      <BookingGuideTemplate
        resolvedNotices={selectedPkgId ? resolvedNotices : undefined}
        packageTitle={selectedTitle}
        packageId={selectedPkgId || undefined}
      />
    </div>
  );
}

export default function BookingGuidePage() {
  return (
    <Suspense fallback={<BookingGuideFallback />}>
      <BookingGuideContent />
    </Suspense>
  );
}
