'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface Settlement {
  id: string;
  settlement_period: string;
  qualified_booking_count: number;
  total_amount: number;
  carryover_balance: number;
  final_total: number;
  tax_deduction: number;
  final_payout: number;
  status: 'PENDING' | 'READY' | 'COMPLETED' | 'VOID';
  settled_at?: string;
  affiliates?: { id: string; name: string; referral_code: string; grade: number; payout_type: string };
}

interface Affiliate { id: string; name: string; referral_code: string; }

const STATUS_BADGES: Record<string, string> = {
  PENDING: 'bg-slate-100 text-slate-600',
  READY: 'bg-blue-50 text-blue-700',
  COMPLETED: 'bg-green-50 text-green-700',
  VOID: 'bg-red-50 text-red-700',
};
const STATUS_LABELS: Record<string, string> = {
  PENDING: '이월 대기', READY: '지급 대기', COMPLETED: '지급 완료', VOID: '취소됨',
};

// 최근 12개월 목록
function getMonthOptions(): string[] {
  const options: string[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    options.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return options;
}

export default function SettlementsPage() {
  const [period, setPeriod] = useState(new Date().toISOString().substring(0, 7));
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [affiliates, setAffiliates] = useState<Affiliate[]>([]);
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState<string | null>(null); // affiliateId
  const [statusUpdating, setStatusUpdating] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, aRes] = await Promise.all([
        fetch(`/api/settlements?period=${period}`),
        fetch('/api/affiliates'),
      ]);
      const sJson = await sRes.json();
      const aJson = await aRes.json();
      setSettlements(sJson.settlements || []);
      setAffiliates(aJson.affiliates || []);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { load(); }, [load]);

  // 정산 마감 실행
  const closeSettlement = async (affiliateId: string) => {
    setClosing(affiliateId);
    try {
      const res = await fetch('/api/settlements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ affiliateId, period }),
      });
      const json = await res.json();
      if (!res.ok) { alert(json.error || '마감 실패'); return; }
      load();
    } finally {
      setClosing(null);
    }
  };

  // 상태 변경 (COMPLETED, VOID)
  const updateStatus = async (id: string, status: string) => {
    if (!confirm(`상태를 "${STATUS_LABELS[status]}"로 변경하시겠습니까?`)) return;
    setStatusUpdating(id);
    try {
      const res = await fetch('/api/settlements', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      if (!res.ok) { const j = await res.json(); alert(j.error); return; }
      load();
    } finally {
      setStatusUpdating(null);
    }
  };

  // 정산이 없는 어필리에이트 (이번 달 마감 전)
  const settledIds = new Set(settlements.map(s => s.affiliates?.id));
  const unsettledAffiliates = affiliates.filter(a => !settledIds.has(a.id));

  // KPI
  const totalPayout = settlements.reduce((s, x) => s + x.final_payout, 0);
  const totalTax = settlements.reduce((s, x) => s + x.tax_deduction, 0);
  const readyCount = settlements.filter(s => s.status === 'READY').length;
  const pendingCount = settlements.filter(s => s.status === 'PENDING').length;

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[16px] font-semibold text-slate-800">정산 관리</h1>
          <p className="text-[13px] text-slate-500 mt-1">월간 어필리에이트 수수료 정산</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={period}
            onChange={e => setPeriod(e.target.value)}
            className="border border-slate-200 rounded px-3 py-2 text-[13px] text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {getMonthOptions().map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: '총 지급 예정액', value: `₩${totalPayout.toLocaleString()}`, color: 'text-purple-700' },
          { label: '총 원천세 공제', value: `₩${totalTax.toLocaleString()}`, color: 'text-red-600' },
          { label: '지급 대기', value: `${readyCount}건`, color: 'text-blue-600' },
          { label: '이월 대기', value: `${pendingCount}건`, color: 'text-slate-600' },
        ].map(card => (
          <div key={card.label} className="bg-white border border-slate-200 rounded-lg p-4">
            <p className="text-[11px] text-slate-500">{card.label}</p>
            <p className={`text-xl font-bold mt-1 ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* 정산 현황 테이블 */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-[14px] font-semibold text-slate-800">{period} 정산 현황</h2>
          <span className="text-[11px] text-slate-500">{settlements.length}건</span>
        </div>
        <table className="w-full text-[13px]">
          <thead className="bg-slate-50">
            <tr>
              {['파트너', '건수', '발생 수수료', '이월 포함', '원천세', '실지급액', '상태', '액션'].map(h => (
                <th key={h} className="text-left px-3 py-2 text-[11px] font-medium text-slate-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="text-center py-8 text-slate-500 text-[13px]">불러오는 중...</td></tr>
            ) : settlements.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-6 text-slate-500 text-[13px]">이번 달 정산 데이터 없음</td></tr>
            ) : settlements.map(s => (
              <tr key={s.id} className="border-b border-slate-200 hover:bg-slate-50">
                <td className="px-3 py-2">
                  <div className="font-medium text-slate-800">{s.affiliates?.name}</div>
                  <div className="text-[11px] text-slate-500 font-mono">{s.affiliates?.referral_code}</div>
                </td>
                <td className="px-3 py-2 text-slate-800">{s.qualified_booking_count}건</td>
                <td className="px-3 py-2 text-slate-800">₩{s.total_amount.toLocaleString()}</td>
                <td className="px-3 py-2 font-medium text-slate-800">₩{s.final_total.toLocaleString()}</td>
                <td className="px-3 py-2 text-red-600">
                  {s.tax_deduction > 0 ? `-₩${s.tax_deduction.toLocaleString()}` : '-'}
                </td>
                <td className="px-3 py-2 font-bold text-green-700">₩{s.final_payout.toLocaleString()}</td>
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${STATUS_BADGES[s.status]}`}>
                    {STATUS_LABELS[s.status]}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-1">
                    {s.status === 'READY' && (
                      <button
                        onClick={() => updateStatus(s.id, 'COMPLETED')}
                        disabled={statusUpdating === s.id}
                        className="text-[11px] px-2 py-1 bg-[#001f3f] text-white rounded hover:bg-blue-900 disabled:opacity-50"
                      >
                        지급 완료
                      </button>
                    )}
                    {['READY', 'PENDING'].includes(s.status) && (
                      <button
                        onClick={() => updateStatus(s.id, 'VOID')}
                        disabled={statusUpdating === s.id}
                        className="text-[11px] px-2 py-1 bg-white border border-slate-300 text-slate-700 rounded hover:bg-slate-50 disabled:opacity-50"
                      >
                        취소
                      </button>
                    )}
                    <Link
                      href={`/admin/affiliates/${s.affiliates?.id}`}
                      className="text-[11px] px-2 py-1 text-blue-600 hover:underline"
                    >
                      상세
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 미마감 어필리에이트 */}
      {unsettledAffiliates.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200">
            <h2 className="text-[14px] font-semibold text-slate-800">정산 마감 대기 ({unsettledAffiliates.length}명)</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              아래 파트너는 {period} 정산 마감이 실행되지 않았습니다.
            </p>
          </div>
          <div>
            {unsettledAffiliates.map(a => (
              <div key={a.id} className="px-4 py-2 flex items-center justify-between border-b border-slate-200 last:border-b-0">
                <div>
                  <span className="font-medium text-slate-800 text-[13px]">{a.name}</span>
                  <span className="ml-2 text-[11px] text-slate-500 font-mono">{a.referral_code}</span>
                </div>
                <button
                  onClick={() => closeSettlement(a.id)}
                  disabled={closing === a.id}
                  className="px-3 py-1.5 bg-[#001f3f] text-white text-[11px] rounded hover:bg-blue-900 disabled:opacity-50"
                >
                  {closing === a.id ? '마감 중...' : '정산 마감 실행'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
