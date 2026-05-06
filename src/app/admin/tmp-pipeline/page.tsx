'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import type { PipelineRow } from '@/app/api/admin/tmp-pipeline/route';

const SOURCE_LABELS: Record<string, string> = {
  band_rss:        '밴드RSS',
  band_rss_auto:   '밴드RSS(자동)',
  band_text_paste: '밴드붙여넣기',
  file_scan:       '파일스캔',
};

const FILTER_OPTIONS = { all: '전체', ...SOURCE_LABELS };

const CN_STATUS_MAP: Record<string, { label: string; cls: string }> = {
  PENDING:   { label: '대기', cls: 'bg-yellow-50 text-yellow-700' },
  DRAFT:     { label: '초안', cls: 'bg-slate-100 text-slate-600' },
  PUBLISHED: { label: '발행완료', cls: 'bg-green-50 text-green-700' },
  FAILED:    { label: '실패', cls: 'bg-red-50 text-red-600' },
};

const BLOG_STATUS_MAP: Record<string, { label: string; cls: string }> = {
  queued:     { label: '대기', cls: 'bg-yellow-50 text-yellow-700' },
  generating: { label: '생성중', cls: 'bg-blue-50 text-blue-700' },
  published:  { label: '발행완료', cls: 'bg-green-50 text-green-700' },
  failed:     { label: '실패', cls: 'bg-red-50 text-red-600' },
};

function Badge({ status, map }: { status: string | null; map: Record<string, { label: string; cls: string }> }) {
  if (!status) return <span className="text-slate-300 text-xs">—</span>;
  const s = map[status] ?? { label: status, cls: 'bg-slate-100 text-slate-500' };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.cls}`}>{s.label}</span>;
}

function IG({ at }: { at: string | null }) {
  if (!at) return <span className="text-slate-300 text-xs">—</span>;
  return <span className="text-green-600 text-xs">✅ {new Date(at).toLocaleDateString('ko-KR')}</span>;
}

export default function TmpPipelinePage() {
  const [rows, setRows] = useState<PipelineRow[]>([]);
  const [source, setSource] = useState('all');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/tmp-pipeline?source=${source}&limit=100`);
    if (res.ok) {
      const { rows: data } = await res.json() as { rows: PipelineRow[] };
      setRows(data);
    }
    setLoading(false);
  }, [source]);

  useEffect(() => { void load(); }, [load]);

  const counts = rows.reduce(
    (acc, r) => {
      if (r.cardNewsStatus === 'PENDING') acc.cnPending++;
      if (r.cardNewsStatus === 'PUBLISHED') acc.cnDone++;
      if (r.igPublishedAt) acc.igDone++;
      if (r.blogStatus === 'published') acc.blogDone++;
      return acc;
    },
    { imported: rows.length, cnPending: 0, cnDone: 0, igDone: 0, blogDone: 0 },
  );

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">TMP 파이프라인 현황</h1>
          <p className="text-sm text-slate-500 mt-0.5">임포트 → 카드뉴스 → 블로그 → IG 전체 흐름</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/admin/band-import"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition"
          >
            + 밴드 임포트
          </Link>
          <button
            onClick={() => void load()}
            className="px-4 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm hover:bg-slate-50 transition"
          >
            새로고침
          </button>
        </div>
      </div>

      {/* KPI 카드 */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: '전체 임포트', value: counts.imported, color: 'text-slate-900' },
          { label: '카드뉴스 대기', value: counts.cnPending, color: 'text-yellow-600' },
          { label: '카드뉴스 완료', value: counts.cnDone, color: 'text-green-600' },
          { label: 'IG 발행완료', value: counts.igDone, color: 'text-pink-600' },
          { label: '블로그 발행', value: counts.blogDone, color: 'text-blue-600' },
        ].map(kpi => (
          <div key={kpi.label} className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-4 text-center">
            <p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p>
            <p className="text-xs text-slate-500 mt-0.5">{kpi.label}</p>
          </div>
        ))}
      </div>

      {/* 필터 */}
      <div className="flex gap-2">
        {Object.entries(FILTER_OPTIONS).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setSource(key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
              source === key
                ? 'bg-blue-600 text-white'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 테이블 */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden">
        {loading ? (
          <div className="divide-y divide-slate-50">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <div className="h-3.5 bg-slate-100 rounded animate-pulse flex-1" />
                <div className="h-4 bg-slate-100 rounded-full animate-pulse w-16" />
                <div className="h-7 bg-slate-100 rounded-lg animate-pulse w-20" />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">
            임포트된 상품이 없습니다.{' '}
            <Link href="/admin/band-import" className="text-blue-600 hover:underline">밴드 임포트 시작하기 →</Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  {['상품명', '여행지', '소스', '임포트일', '카드뉴스', '블로그', 'IG 발행'].map(h => (
                    <th key={h} className="text-left py-3 px-4 font-medium text-slate-500 text-xs">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.productId} className="border-b border-slate-100 hover:bg-slate-50 transition">
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900 truncate max-w-[200px]" title={row.displayName}>
                        {row.displayName}
                      </div>
                      <div className="text-xs text-slate-400">{row.internalCode}</div>
                    </td>
                    <td className="py-3 px-4 text-slate-600">{row.destination}</td>
                    <td className="py-3 px-4">
                      {row.bandPostUrl ? (
                        <a href={row.bandPostUrl} target="_blank" rel="noopener noreferrer"
                          className="text-xs text-blue-500 hover:underline">
                          {SOURCE_LABELS[row.source] ?? row.source}
                        </a>
                      ) : (
                        <span className="text-xs text-slate-500">{SOURCE_LABELS[row.source] ?? row.source}</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-500 text-xs">
                      {new Date(row.importedAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="py-3 px-4">
                      <Badge status={row.cardNewsStatus} map={CN_STATUS_MAP} />
                      {row.cardNewsId && (
                        <Link href={`/admin/content-hub?id=${row.cardNewsId}`}
                          className="ml-1 text-xs text-blue-500 hover:underline">보기</Link>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <Badge status={row.blogStatus} map={BLOG_STATUS_MAP} />
                    </td>
                    <td className="py-3 px-4">
                      <IG at={row.igPublishedAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
