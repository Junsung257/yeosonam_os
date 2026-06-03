'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import BookingGuideTemplate from '@/components/admin/BookingGuideTemplate';
import { PageHeader } from '@/components/admin/patterns';
import Button from '@/components/ui/Button';
import { Printer } from 'lucide-react';
import type { NoticeBlock } from '@/lib/standard-terms';

interface PackageOption {
  id: string;
  title: string;
  destination?: string;
}

export default function BookingGuidePage() {
  const search = useSearchParams();
  const initialPkgId = search?.get('pkg') ?? '';

  const [packages, setPackages] = useState<PackageOption[]>([]);
  const [selectedPkgId, setSelectedPkgId] = useState(initialPkgId);
  const [selectedTitle, setSelectedTitle] = useState<string | undefined>();
  const [resolvedNotices, setResolvedNotices] = useState<NoticeBlock[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/packages?limit=200')
      .then(r => r.json())
      .then(d => setPackages((d.packages ?? d.data ?? []).map((p: Record<string, unknown>) => ({
        id: p.id as string, title: (p.display_title ?? p.title) as string, destination: p.destination as string,
      }))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedPkgId) { setResolvedNotices([]); setSelectedTitle(undefined); return; }
    setLoading(true);
    fetch(`/api/packages/${selectedPkgId}/terms?surface=booking_guide`)
      .then(r => r.json())
      .then(d => setResolvedNotices((d.data ?? []) as NoticeBlock[]))
      .catch(() => setResolvedNotices([]))
      .finally(() => setLoading(false));

    const pkg = packages.find(p => p.id === selectedPkgId);
    setSelectedTitle(pkg?.title);
  }, [selectedPkgId, packages]);

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title="예약 안내문"
        subtitle="상품별 약관을 적용한 안내문을 미리보고 인쇄·PDF 저장합니다"
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
          onChange={e => setSelectedPkgId(e.target.value)}
          className="w-full h-9 border border-admin-border-mid rounded-admin-sm px-3 text-admin-base bg-admin-surface text-admin-text focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
        >
          <option value="">공통 안내문만 (상품별 약관 미적용)</option>
          {packages.map(p => (
            <option key={p.id} value={p.id}>{p.title} {p.destination ? `(${p.destination})` : ''}</option>
          ))}
        </select>
      </div>
      {loading && <p className="text-center text-admin-muted text-admin-sm mb-3">약관 해소 중…</p>}
      <BookingGuideTemplate
        resolvedNotices={selectedPkgId ? resolvedNotices : undefined}
        packageTitle={selectedTitle}
        packageId={selectedPkgId || undefined}
      />
    </div>
  );
}
