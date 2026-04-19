'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import BookingGuideTemplate from '@/components/admin/BookingGuideTemplate';
import type { NoticeBlock } from '@/lib/standard-terms';

interface PackageOption {
  id: string;
  title: string;
  destination?: string;
}

export default function BookingGuidePage() {
  const search = useSearchParams();
  const initialPkgId = search.get('pkg') ?? '';

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
    <div className="min-h-screen bg-gray-100 py-10">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center gap-4 mb-6 px-4">
          <h1 className="text-xl font-bold text-slate-800 shrink-0">📋 예약 안내문</h1>
          <select
            value={selectedPkgId}
            onChange={e => setSelectedPkgId(e.target.value)}
            className="flex-1 max-w-md border border-slate-300 rounded px-3 py-2 text-sm bg-white"
          >
            <option value="">공통 안내문만 (상품별 약관 미적용)</option>
            {packages.map(p => (
              <option key={p.id} value={p.id}>{p.title} {p.destination ? `(${p.destination})` : ''}</option>
            ))}
          </select>
          <button
            onClick={() => window.print()}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 shrink-0"
          >
            인쇄 / PDF 저장
          </button>
        </div>
        {loading && <p className="text-center text-slate-400 text-sm mb-3">약관 해소 중...</p>}
        <BookingGuideTemplate
          resolvedNotices={selectedPkgId ? resolvedNotices : undefined}
          packageTitle={selectedTitle}
          packageId={selectedPkgId || undefined}
        />
      </div>
    </div>
  );
}
