'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Globe,
  Package as PackageIcon,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';

import {
  EmptyState,
  KpiCard,
  PageHeader,
  SectionCard,
} from '@/components/admin/patterns';
import { fetchWithSessionRefresh } from '@/lib/fetch-with-session-refresh';
import type { AdminPackagePublicationTruth } from '@/lib/product-registration-authority';

type Filter = 'all' | 'public' | 'needs_action' | 'failed';

type TruthResponse = {
  success?: boolean;
  code?: string;
  data?: { rows?: AdminPackagePublicationTruth[] };
};

function statusLabel(row: AdminPackagePublicationTruth): string {
  if (row.actualCustomerPublic) return '고객 공개';
  if (row.pointerState === 'convergence_failed') return '공개 차단';
  if (row.latestPublicationRequestStatus === 'requested') return '공개 심사 대기';
  if (row.latestPublicationRequestStatus === 'revalidating') return '최신성 재검증';
  if (row.latestPublicationRequestStatus === 'proving') return '모바일 검사';
  if (row.latestPublicationRequestStatus === 'ready') return '포인터 반영 대기';
  return '검수 필요';
}

function statusClass(row: AdminPackagePublicationTruth): string {
  if (row.actualCustomerPublic) return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (row.pointerState === 'convergence_failed') return 'border-red-200 bg-red-50 text-red-700';
  if (['requested', 'revalidating', 'proving', 'ready'].includes(row.latestPublicationRequestStatus ?? '')) {
    return 'border-blue-200 bg-blue-50 text-blue-700';
  }
  return 'border-amber-200 bg-amber-50 text-amber-800';
}

function canRequestPublication(row: AdminPackagePublicationTruth): boolean {
  if (!row.packageId || !row.latestRevisionId || !row.latestRevisionNo || !row.sourceHash) return false;
  const recoverablePublishedSnapshot = row.candidateSnapshotStatus === 'published'
    && row.pointerState === 'convergence_failed';
  if (!row.candidateSnapshotId || (row.candidateSnapshotStatus !== 'candidate' && !recoverablePublishedSnapshot)) return false;
  if (row.blockerCodes.includes('COMPATIBILITY_REVISION_MISMATCH')) return false;
  return !['requested', 'revalidating', 'proving', 'ready', 'pointer_committed']
    .includes(row.latestPublicationRequestStatus ?? '');
}

export function ProductRegistrationPublicationClient() {
  const [rows, setRows] = useState<AdminPackagePublicationTruth[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [requestingId, setRequestingId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetchWithSessionRefresh(
        '/api/admin/product-registration/truth?limit=200',
        { cache: 'no-store' },
      );
      const payload = await response.json().catch(() => ({})) as TruthResponse;
      if (!response.ok || !payload.success || !Array.isArray(payload.data?.rows)) {
        throw new Error(payload.code ?? '상품등록 공개 상태를 불러오지 못했습니다.');
      }
      setRows(payload.data.rows);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '상품등록 공개 상태를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const metrics = useMemo(() => ({
    total: rows.length,
    publicCount: rows.filter(row => row.actualCustomerPublic).length,
    actionCount: rows.filter(row => !row.actualCustomerPublic).length,
    failedCount: rows.filter(row => row.pointerState === 'convergence_failed'
      || row.blockerCodes.includes('SURFACE_CONVERGENCE_FAILED')).length,
  }), [rows]);

  const visibleRows = useMemo(() => rows.filter(row => {
    if (filter === 'public') return row.actualCustomerPublic;
    if (filter === 'needs_action') return !row.actualCustomerPublic;
    if (filter === 'failed') return row.pointerState === 'convergence_failed'
      || row.blockerCodes.includes('SURFACE_CONVERGENCE_FAILED');
    return true;
  }), [filter, rows]);

  const requestPublication = useCallback(async (row: AdminPackagePublicationTruth) => {
    if (!canRequestPublication(row) || !row.latestRevisionId || !row.latestRevisionNo || !row.sourceHash) return;
    setRequestingId(row.catalogProductId);
    setError('');
    setNotice('');
    try {
      const response = await fetchWithSessionRefresh(
        `/api/admin/product-registration/products/${encodeURIComponent(row.catalogProductId)}/publication-requests`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            expectedRevisionId: row.latestRevisionId,
            expectedRevisionNo: row.latestRevisionNo,
            expectedSourceHash: row.sourceHash,
            requestReason: '사장님 모바일 검수 완료',
          }),
        },
      );
      const payload = await response.json().catch(() => ({})) as { success?: boolean; code?: string };
      if (!response.ok || !payload.success) throw new Error(payload.code ?? '공개 심사 요청에 실패했습니다.');
      setNotice(`${row.packageTitle ?? row.productKey} 공개 심사를 접수했습니다.`);
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '공개 심사 요청에 실패했습니다.');
    } finally {
      setRequestingId(null);
    }
  }, [load]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="상품등록 공개 관제"
        subtitle="원문 리비전부터 모바일 proof, 공개 포인터, 실제 고객 노출까지 한 기준으로 확인합니다."
        breadcrumb={[{ label: '상품등록', href: '/admin/upload' }, { label: '공개 관제' }]}
        actions={(
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex min-h-11 items-center gap-2 rounded-admin-sm border border-admin-border-strong bg-white px-3 text-admin-sm font-semibold text-admin-text disabled:opacity-50"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            새로고침
          </button>
        )}
      />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard label="등록 상품" value={metrics.total} unit="개" icon={PackageIcon} hint="latest revision 기준" />
        <KpiCard label="실제 고객 공개" value={metrics.publicCount} unit="개" icon={Globe} hint="pointer·snapshot·proof 일치" />
        <KpiCard label="조치 필요" value={metrics.actionCount} unit="개" icon={AlertTriangle} tone={metrics.actionCount > 0 ? 'negative' : 'neutral'} hint="공개 아님" />
        <KpiCard label="수렴 실패" value={metrics.failedCount} unit="개" icon={ShieldCheck} tone={metrics.failedCount > 0 ? 'negative' : 'neutral'} hint="고객 조회 fail closed" />
      </div>

      {(error || notice) && (
        <div className={`rounded-admin-sm border px-4 py-3 text-admin-sm ${error ? 'border-red-200 bg-red-50 text-red-700' : 'border-blue-200 bg-blue-50 text-blue-800'}`}>
          {error || notice}
        </div>
      )}

      <SectionCard
        title="공개 상태"
        description="일반 상품 상태가 아니라 exact revision 공개 권위를 표시합니다."
        actions={(
          <div className="flex flex-wrap gap-1" role="group" aria-label="공개 상태 필터">
            {([
              ['all', '전체'],
              ['public', '고객 공개'],
              ['needs_action', '조치 필요'],
              ['failed', '수렴 실패'],
            ] as const).map(([value, label]) => (
              <button
                type="button"
                key={value}
                onClick={() => setFilter(value)}
                className={`min-h-9 rounded-admin-sm px-3 text-admin-xs font-semibold ${filter === value ? 'bg-slate-950 text-white' : 'border border-admin-border-mid bg-white text-admin-muted'}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        flush
      >
        {loading ? (
          <div className="p-8 text-center text-admin-sm text-admin-muted">공개 권위를 확인하는 중입니다.</div>
        ) : visibleRows.length === 0 ? (
          <EmptyState title="해당 상태의 상품이 없습니다." description="필터를 바꾸거나 새로고침해 주세요." />
        ) : (
          <div className="divide-y divide-admin-border">
            {visibleRows.map(row => (
              <article key={row.catalogProductId} className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(220px,1fr)_auto] lg:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-admin-sm font-bold text-admin-text">{row.packageTitle ?? row.productKey}</h3>
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${statusClass(row)}`}>
                      {statusLabel(row)}
                    </span>
                  </div>
                  <p className="mt-1 truncate font-mono text-[11px] text-admin-muted-2">{row.productKey}</p>
                  <p className="mt-1 text-admin-xs text-admin-muted">
                    revision {row.latestRevisionNo ?? '-'} · candidate {row.candidateSnapshotStatus ?? '없음'} · pointer {row.pointerVersion} · {row.proofStatus ?? 'proof 없음'}
                  </p>
                </div>

                <div>
                  <p className="text-admin-xs font-semibold text-admin-text-2">다음 행동</p>
                  <p className="mt-1 text-admin-xs leading-5 text-admin-muted">{row.nextAction}</p>
                  {row.blockerCodes.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {row.blockerCodes.slice(0, 4).map(code => (
                        <span key={code} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">{code}</span>
                      ))}
                      {row.blockerCodes.length > 4 && <span className="text-[10px] text-admin-muted">+{row.blockerCodes.length - 4}</span>}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => void requestPublication(row)}
                  disabled={!canRequestPublication(row) || requestingId === row.catalogProductId}
                  title={canRequestPublication(row) ? undefined : row.nextAction}
                  className="min-h-11 rounded-admin-sm bg-blue-600 px-4 text-admin-xs font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                >
                  {requestingId === row.catalogProductId ? '접수 중…' : '검수 승인 후 공개 심사 시작'}
                </button>
              </article>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
