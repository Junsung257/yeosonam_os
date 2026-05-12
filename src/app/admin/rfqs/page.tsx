'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { fmtNum as fmt } from '@/lib/admin-utils';
import { PageHeader, KpiCard as PatternKpiCard } from '@/components/admin/patterns';
import { FileQuestion, Gavel, Sparkles, CheckCircle2 } from 'lucide-react';

// ── 타입 정의 ────────────────────────────────────────────────────────────────
interface GroupRfq {
  id: string;
  rfq_code: string;
  status: string;
  destination: string;
  adult_count: number;
  child_count: number;
  budget_per_person: number;
  hotel_grade: string;
  meal_plan: string;
  bid_count?: number;
  customer_name?: string;
  created_at: string;
}

// ── 상수 ─────────────────────────────────────────────────────────────────────
const STATUS_LABELS: Record<string, string> = {
  draft: '초안',
  published: '공고등록',
  bidding: '입찰중',
  analyzing: 'AI분석중',
  awaiting_selection: '선택대기',
  contracted: '계약완료',
};

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-admin-surface-2 text-admin-muted',
  published: 'bg-blue-50 text-blue-700',
  bidding: 'bg-amber-50 text-amber-700',
  analyzing: 'bg-purple-50 text-purple-700',
  awaiting_selection: 'bg-orange-50 text-orange-700',
  contracted: 'bg-green-50 text-green-700',
};

const STATUS_TABS = [
  { value: '', label: '전체' },
  { value: 'published', label: '공고등록' },
  { value: 'bidding', label: '입찰중' },
  { value: 'analyzing', label: 'AI분석중' },
  { value: 'awaiting_selection', label: '선택대기' },
  { value: 'contracted', label: '계약완료' },
];

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────
export default function AdminRfqsPage() {
  const router = useRouter();

  const [rfqs, setRfqs] = useState<GroupRfq[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetchRfqs();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/id-trigger-only intentional
  }, [statusFilter]);

  async function fetchRfqs() {
    setLoading(true);
    setError('');
    try {
      const url = statusFilter ? `/api/rfq?status=${statusFilter}` : '/api/rfq';
      const res = await fetch(url);
      if (!res.ok) throw new Error('데이터를 불러올 수 없습니다');
      const data = await res.json();
      setRfqs(Array.isArray(data) ? data : (data.rfqs ?? []));
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류가 발생했습니다');
    } finally {
      setLoading(false);
    }
  }

  // KPI 집계
  const total = rfqs.length;
  const biddingCount = rfqs.filter((r) => r.status === 'bidding').length;
  const analyzingCount = rfqs.filter((r) => r.status === 'analyzing').length;
  const contractedCount = rfqs.filter((r) => r.status === 'contracted').length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="단체 RFQ 관리"
        subtitle="단체여행 견적 요청 및 입찰 현황을 관리합니다"
      />

      {/* KPI 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <PatternKpiCard label="전체 RFQ" value={total.toLocaleString()} icon={FileQuestion} />
        <PatternKpiCard label="입찰중" value={biddingCount.toLocaleString()} icon={Gavel} tone={biddingCount > 0 ? 'positive' : 'neutral'} />
        <PatternKpiCard label="AI 분석중" value={analyzingCount.toLocaleString()} icon={Sparkles} />
        <PatternKpiCard label="계약 완료" value={contractedCount.toLocaleString()} icon={CheckCircle2} tone="positive" />
      </div>

      {/* 탭 필터 */}
      <div className="flex gap-1 bg-admin-surface-2 rounded-admin-sm p-1 w-fit flex-wrap">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={`px-3 h-8 rounded-admin-xs text-admin-sm font-medium transition-colors ${
              statusFilter === tab.value
                ? 'bg-admin-surface text-admin-text font-semibold shadow-admin-xs'
                : 'text-admin-muted hover:text-admin-text-2'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 테이블 */}
      <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs overflow-hidden">
        {loading ? (
          <div className="divide-y divide-admin-border">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <div className="h-3.5 bg-admin-surface-2 rounded animate-pulse w-28" />
                <div className="h-3.5 bg-admin-surface-2 rounded animate-pulse flex-1" />
                <div className="h-4 bg-admin-surface-2 rounded-full animate-pulse w-16" />
                <div className="h-3.5 bg-admin-surface-2 rounded animate-pulse w-20" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="text-center text-danger py-12 text-admin-base">{error}</div>
        ) : rfqs.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-admin-muted text-admin-base">해당하는 RFQ가 없습니다.</p>
          </div>
        ) : (
          <table className="admin-data-table">
            <thead>
              <tr>
                {['RFQ코드', '고객명', '목적지', '인원', '예산(1인)', '상태', '입찰수', '등록일'].map(
                  (h) => (
                    <th key={h}>{h}</th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {rfqs.map((rfq) => (
                <tr
                  key={rfq.id}
                  onClick={() => router.push(`/admin/rfqs/${rfq.id}`)}
                  className="cursor-pointer"
                >
                  <td className="font-mono text-admin-xs text-admin-muted">
                    {rfq.rfq_code}
                  </td>
                  <td className="text-admin-text">
                    {rfq.customer_name || '—'}
                  </td>
                  <td className="font-medium text-admin-text">
                    {rfq.destination}
                  </td>
                  <td className="text-admin-muted admin-num">
                    {rfq.adult_count + rfq.child_count}명
                  </td>
                  <td className="text-admin-text admin-num">
                    {fmt(rfq.budget_per_person)}원
                  </td>
                  <td>
                    <span
                      className={`inline-flex px-2 py-0.5 rounded-admin-xs text-admin-xs font-semibold ${
                        STATUS_COLORS[rfq.status] || 'bg-admin-surface-2 text-admin-muted'
                      }`}
                    >
                      {STATUS_LABELS[rfq.status] || rfq.status}
                    </span>
                  </td>
                  <td className="text-admin-muted admin-num">
                    {rfq.bid_count ?? 0}
                  </td>
                  <td className="text-admin-muted text-admin-xs admin-num">
                    {rfq.created_at.slice(0, 10)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
