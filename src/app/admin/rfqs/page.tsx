'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

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
  draft: 'bg-slate-100 text-slate-600',
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

const fmt = (n: number) => n.toLocaleString('ko-KR');

// ── KPI 카드 ──────────────────────────────────────────────────────────────────
function KpiCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      <div className="text-[13px] mt-0.5 text-slate-500">{label}</div>
    </div>
  );
}

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
    <div className="space-y-6">
      {/* 헤더 */}
      <div>
        <h1 className="text-[16px] font-bold text-slate-800">단체 RFQ 관리</h1>
        <p className="text-[13px] text-slate-500 mt-1">단체여행 견적 요청 및 입찰 현황을 관리합니다</p>
      </div>

      {/* KPI 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="전체 RFQ" value={total} color="text-slate-800" />
        <KpiCard label="입찰중" value={biddingCount} color="text-amber-700" />
        <KpiCard label="AI분석중" value={analyzingCount} color="text-purple-700" />
        <KpiCard label="계약완료" value={contractedCount} color="text-green-700" />
      </div>

      {/* 탭 필터 */}
      <div className="flex gap-1 border border-slate-200 bg-slate-50 rounded-lg p-1 w-fit flex-wrap">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={`px-4 py-1.5 rounded-md text-[13px] font-medium transition-colors ${
              statusFilter === tab.value
                ? 'bg-white border border-slate-200 text-slate-800 font-semibold'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 테이블 */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        {loading ? (
          <div className="text-center text-slate-500 py-12 text-[14px]">불러오는 중...</div>
        ) : error ? (
          <div className="text-center text-red-600 py-12 text-[14px]">{error}</div>
        ) : rfqs.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-slate-500 text-[14px]">해당하는 RFQ가 없습니다.</p>
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {['RFQ코드', '고객명', '목적지', '인원', '예산(1인)', '상태', '입찰수', '등록일'].map(
                  (h) => (
                    <th
                      key={h}
                      className="px-3 py-2 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide"
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {rfqs.map((rfq) => (
                <tr
                  key={rfq.id}
                  onClick={() => router.push(`/admin/rfqs/${rfq.id}`)}
                  className="border-b border-slate-200 hover:bg-slate-50 cursor-pointer transition-colors"
                >
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-500">
                    {rfq.rfq_code}
                  </td>
                  <td className="px-3 py-2 text-slate-800">
                    {rfq.customer_name || '—'}
                  </td>
                  <td className="px-3 py-2 font-medium text-slate-800">
                    {rfq.destination}
                  </td>
                  <td className="px-3 py-2 text-slate-500">
                    {rfq.adult_count + rfq.child_count}명
                  </td>
                  <td className="px-3 py-2 text-slate-800">
                    {fmt(rfq.budget_per_person)}원
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${
                        STATUS_COLORS[rfq.status] || 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {STATUS_LABELS[rfq.status] || rfq.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-500">
                    {rfq.bid_count ?? 0}
                  </td>
                  <td className="px-3 py-2 text-slate-500 text-[11px]">
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
