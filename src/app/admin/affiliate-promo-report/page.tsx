'use client';

import { useEffect, useMemo, useState } from 'react';
import AdminLayout from '@/components/AdminLayout';
import { PageHeader } from '@/components/admin/patterns';
import Button from '@/components/ui/Button';
import { Download } from 'lucide-react';

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
      <div className="space-y-5">
        <PageHeader
          title="프로모코드 성과 리포트"
          subtitle="코드별 예약/매출/커미션 성과를 확인합니다"
          actions={
            <div className="flex items-center gap-2">
              <select
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                className="h-9 px-3 border border-admin-border-mid rounded-admin-sm text-admin-sm bg-admin-surface text-admin-text focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
              >
                <option value={7}>최근 7일</option>
                <option value={30}>최근 30일</option>
                <option value={90}>최근 90일</option>
              </select>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="코드/파트너 검색"
                className="h-9 px-3 border border-admin-border-mid rounded-admin-sm text-admin-sm bg-admin-surface text-admin-text w-48 focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
              />
              <Button variant="primary" size="sm" onClick={exportCsv}>
                <Download size={14} />
                CSV 내보내기
              </Button>
            </div>
          }
        />

        {loading ? (
          <div className="admin-card overflow-hidden divide-y divide-admin-border">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <div className="h-3.5 bg-admin-surface-2 rounded animate-pulse flex-1" />
                <div className="h-3.5 bg-admin-surface-2 rounded animate-pulse w-20" />
                <div className="h-3.5 bg-admin-surface-2 rounded animate-pulse w-20" />
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs overflow-x-auto">
            <table className="admin-data-table">
              <thead>
                <tr>
                  <th>코드</th>
                  <th>파트너</th>
                  <th>할인</th>
                  <th className="text-right">사용</th>
                  <th className="text-right">예약</th>
                  <th className="text-right">매출</th>
                  <th className="text-right">커미션</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={`${r.code}_${r.affiliate_id}`}>
                    <td className="font-mono font-semibold text-admin-text">{r.code}</td>
                    <td className="text-admin-text">{r.affiliate_name} <span className="text-admin-muted-2 font-mono text-admin-xs">({r.referral_code})</span></td>
                    <td className="text-admin-text admin-num">
                      {r.discount_type === 'percent' ? `${r.discount_value}%` : `${Number(r.discount_value).toLocaleString()}원`}
                    </td>
                    <td className="text-right text-admin-text admin-num">
                      {r.uses_count}{typeof r.max_uses === 'number' ? `/${r.max_uses}` : ''}
                    </td>
                    <td className="text-right admin-num">{r.bookings.toLocaleString()}</td>
                    <td className="text-right admin-num">₩{r.revenue.toLocaleString()}</td>
                    <td className="text-right font-semibold text-brand admin-num">₩{r.commission.toLocaleString()}</td>
                  </tr>
                ))}
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-admin-muted" style={{ height: 'auto' }}>데이터가 없습니다.</td>
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

