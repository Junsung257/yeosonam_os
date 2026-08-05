'use client';

import { useDeferredValue, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { AlertTriangle, CheckCircle2, Search, Wallet } from 'lucide-react';

import type { FinanceCenterSummary } from '@/lib/finance-center-service';

async function fetcher(url: string): Promise<{ summary: FinanceCenterSummary }> {
  const response = await fetch(url, { cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || '예약별 정산을 불러오지 못했습니다.');
  return payload;
}

function won(value: number): string {
  return `${Math.round(value).toLocaleString('ko-KR')}원`;
}

const STATES = {
  all: '전체',
  settled: '정산 확정',
  predeparture: '출발 전',
  departed_pending: '출발 후 미정산',
  date_missing: '출발일 없음',
} as const;

export default function FinanceBookingsTable() {
  const { data, error, isLoading } = useSWR('/api/admin/finance/summary', fetcher, { revalidateOnFocus: false });
  const [query, setQuery] = useState('');
  const [state, setState] = useState<keyof typeof STATES>('all');
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const rows = (data?.summary.bookings ?? []).filter(row => {
    if (state !== 'all' && row.state !== state) return false;
    if (!deferredQuery) return true;
    return [row.bookingNo, row.customerName, row.packageTitle, row.departureDate]
      .filter(Boolean)
      .some(value => String(value).toLowerCase().includes(deferredQuery));
  });

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-admin-text"><Wallet className="h-5 w-5 text-emerald-700" />예약별 정산</h2>
          <p className="mt-1 text-xs text-admin-muted">각 예약에 연결된 Clobe 입금·출금 한 건씩을 합산한 현금 마진입니다.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/land-settlements" className="rounded-lg border border-admin-border-strong bg-white px-3 py-2 text-xs font-semibold text-admin-text-2 hover:bg-admin-bg">랜드사 지급 묶음</Link>
          <Link href="/admin/payments/reconcile" className="rounded-lg border border-admin-border-strong bg-white px-3 py-2 text-xs font-semibold text-admin-text-2 hover:bg-admin-bg">원장 정합성</Link>
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-admin-md border border-admin-border-mid bg-admin-surface p-3 sm:flex-row">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">예약 검색</span>
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-admin-muted" />
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="예약번호, 고객명, 상품명, 출발일" className="w-full rounded-lg border border-admin-border-strong bg-white py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
        </label>
        <select value={state} onChange={event => setState(event.target.value as keyof typeof STATES)} aria-label="정산 상태" className="rounded-lg border border-admin-border-strong bg-white px-3 py-2 text-sm">
          {Object.entries(STATES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>

      {error ? <div className="rounded-admin-md border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">{error.message}</div> : null}
      {isLoading ? <div className="h-80 animate-pulse rounded-admin-md bg-admin-surface-2" role="status" aria-label="예약별 정산 불러오는 중" /> : null}
      {!isLoading && !error ? (
        <div className="overflow-hidden rounded-admin-md border border-admin-border-mid bg-admin-surface shadow-admin-xs">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-admin-bg text-left text-xs text-admin-muted">
                <tr><th className="px-4 py-3 font-medium">출발일·예약</th><th className="px-4 py-3 font-medium">고객·상품</th><th className="px-4 py-3 text-right font-medium">입금</th><th className="px-4 py-3 text-right font-medium">출금</th><th className="px-4 py-3 text-right font-medium">현금 마진</th><th className="px-4 py-3 font-medium">상태</th></tr>
              </thead>
              <tbody className="divide-y divide-admin-border">
                {rows.map(row => {
                  const negative = row.cashMargin < 0;
                  return (
                    <tr key={row.id} className="hover:bg-admin-bg/70">
                      <td className="whitespace-nowrap px-4 py-3"><span className="block text-xs text-admin-muted">{row.departureDate ?? '출발일 없음'}</span><Link href={`/admin/bookings/${row.id}`} className="font-semibold text-admin-text-2 hover:text-emerald-700">{row.bookingNo}</Link></td>
                      <td className="max-w-xs px-4 py-3"><span className="block font-medium text-admin-text-2">{row.customerName ?? '고객명 없음'}</span><span className="block truncate text-xs text-admin-muted">{row.packageTitle ?? '상품명 없음'} · 거래 {row.transactionCount}건</span></td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{won(row.deposits)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{won(row.withdrawals)}</td>
                      <td className={`whitespace-nowrap px-4 py-3 text-right font-bold tabular-nums ${negative ? 'text-red-700' : 'text-emerald-700'}`}>{won(row.cashMargin)}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ${negative ? 'bg-red-50 text-red-700' : row.state === 'settled' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>
                          {negative ? <AlertTriangle className="h-3 w-3" /> : row.state === 'settled' ? <CheckCircle2 className="h-3 w-3" /> : null}
                          {negative ? '출금 초과' : STATES[row.state]}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 ? <tr><td colSpan={6} className="px-4 py-14 text-center text-sm text-admin-muted">조건에 맞는 예약이 없습니다.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
