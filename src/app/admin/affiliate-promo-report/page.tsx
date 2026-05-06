'use client';

import { useEffect, useMemo, useState } from 'react';
import AdminLayout from '@/components/AdminLayout';

interface Row {
  code: string;
  affiliate_id: string;
  affiliate_name: string;
  referral_code: string;
  discount_type: 'percent' | 'fixed';
  discount_value: number;
  uses_count: number;
  max_uses: number | null;
  is_active: boolean;
  bookings: number;
  revenue: number;
  commission: number;
}

export default function AffiliatePromoReportPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [days, setDays] = useState(90);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/affiliate-promo-report?days=${days}`)
      .then((r) => r.json())
      .then((d) => setRows(d.rows || []))
      .finally(() => setLoading(false));
  }, [days]);

  const filtered = useMemo(() => {
    if (!q.trim()) return rows;
    const v = q.trim().toLowerCase();
    return rows.filter((r) =>
      [r.code, r.affiliate_name, r.referral_code].some((x) => String(x).toLowerCase().includes(v)),
    );
  }, [rows, q]);

  const exportCsv = () => {
    const header = ['code', 'affiliate_name', 'referral_code', 'discount_type', 'discount_value', 'uses_count', 'max_uses', 'bookings', 'revenue', 'commission'];
    const lines = filtered.map((r) =>
      [r.code, r.affiliate_name, r.referral_code, r.discount_type, r.discount_value, r.uses_count, r.max_uses ?? '', r.bookings, r.revenue, r.commission]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(','),
    );
    const csv = [header.join(','), ...lines].join('\n');
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `affiliate-promo-report-${days}d.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AdminLayout>
      <div className="space-y-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-slate-900">프로모코드 성과 리포트</h1>
            <p className="text-xs text-slate-500">코드별 예약/매출/커미션 성과를 확인합니다.</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
            >
              <option value={7}>최근 7일</option>
              <option value={30}>최근 30일</option>
              <option value={90}>최근 90일</option>
            </select>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="코드/파트너 검색"
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
            />
            <button
              type="button"
              onClick={exportCsv}
              className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
            >
              CSV 내보내기
            </button>
          </div>
        </div>

        {loading ? (
          <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden divide-y divide-slate-50">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <div className="h-3.5 bg-slate-100 rounded animate-pulse flex-1" />
                <div className="h-3.5 bg-slate-100 rounded animate-pulse w-20" />
                <div className="h-3.5 bg-slate-100 rounded animate-pulse w-20" />
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-x-auto">
            <table className="w-full text-admin-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="text-left px-4 py-2">코드</th>
                  <th className="text-left px-3 py-2">파트너</th>
                  <th className="text-left px-3 py-2">할인</th>
                  <th className="text-right px-3 py-2">사용</th>
                  <th className="text-right px-3 py-2">예약</th>
                  <th className="text-right px-3 py-2">매출</th>
                  <th className="text-right px-4 py-2">커미션</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={`${r.code}_${r.affiliate_id}`} className="border-b border-slate-100">
                    <td className="px-4 py-2 font-mono font-semibold text-slate-700">{r.code}</td>
                    <td className="px-3 py-2 text-slate-700">{r.affiliate_name} <span className="text-slate-400">({r.referral_code})</span></td>
                    <td className="px-3 py-2 text-slate-700">
                      {r.discount_type === 'percent' ? `${r.discount_value}%` : `${Number(r.discount_value).toLocaleString()}원`}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-700">
                      {r.uses_count}{typeof r.max_uses === 'number' ? `/${r.max_uses}` : ''}
                    </td>
                    <td className="px-3 py-2 text-right">{r.bookings.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">₩{r.revenue.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right font-semibold text-purple-700">₩{r.commission.toLocaleString()}</td>
                  </tr>
                ))}
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-slate-400">데이터가 없습니다.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

