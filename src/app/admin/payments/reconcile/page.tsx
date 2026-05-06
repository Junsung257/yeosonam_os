'use client';

/**
 * /admin/payments/reconcile
 *
 * Phase 2a 이중쓰기 정합성 모니터링.
 *   - drift 0건 / drift N건 (절대합 표시)
 *   - 최근 7일 ledger 활동 일별 차트
 *   - drift 발생 시 booking 상위 20건 + 직접 상세 링크
 *
 * 정상: 초록 배지 "정합 OK"
 * 이상: 빨간 배지 "drift N건 / NN,NNN원" + drift 테이블
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

interface DriftRow {
  booking_id: string;
  account: 'paid_amount' | 'total_paid_out';
  bookings_balance: number;
  ledger_sum: number;
  drift: number;
}
interface DailyRow {
  date: string;
  count: number;
  paid_total: number;
  payout_total: number;
}
interface Status {
  ok: boolean;
  drift_count: number;
  total_abs_drift: number;
  last_entry_at: string | null;
  drift_sample: DriftRow[];
  daily: DailyRow[];
  checked_at: string;
}

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

export default function LedgerReconcilePage() {
  const [data, setData] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/ledger/reconcile-status', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '조회 실패');
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) {
    return (
      <div className="p-6 space-y-3 max-w-3xl">
        <div className="h-5 bg-slate-100 rounded animate-pulse w-36" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-4 flex items-center gap-3">
            <div className="h-3.5 bg-slate-100 rounded animate-pulse flex-1" />
            <div className="h-4 bg-slate-100 rounded-full animate-pulse w-16" />
          </div>
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-6">
        <p className="text-red-600 text-sm">오류: {error}</p>
        <button onClick={load} className="mt-2 px-3 py-1 text-sm bg-slate-100 rounded">재시도</button>
      </div>
    );
  }
  if (!data) return null;

  const isOk = data.ok && data.drift_count === 0;
  const dailyMax = Math.max(1, ...data.daily.map(d => d.count));

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">원장 정합성 (Phase 2a)</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            bookings.paid_amount / total_paid_out vs SUM(ledger_entries) 일일 대조
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="px-3 py-1.5 text-sm bg-slate-800 text-white rounded hover:bg-slate-700 disabled:opacity-50"
        >
          {loading ? '확인 중…' : '재확인'}
        </button>
      </header>

      {/* 상태 카드 */}
      <section
        className={`rounded-lg p-5 mb-6 border ${
          isOk
            ? 'bg-green-50 border-green-200'
            : 'bg-red-50 border-red-200'
        }`}
      >
        <div className="flex items-baseline justify-between">
          <div>
            <p className={`text-sm font-medium ${isOk ? 'text-green-700' : 'text-red-700'}`}>
              {isOk ? '✓ 정합 OK' : '⚠ Drift 발견'}
            </p>
            <p className={`text-3xl font-bold mt-1 tabular-nums ${isOk ? 'text-green-800' : 'text-red-800'}`}>
              {isOk ? '0건' : `${data.drift_count.toLocaleString()}건`}
            </p>
            {!isOk && (
              <p className="text-sm text-red-600 mt-1 tabular-nums">
                절대합 {data.total_abs_drift.toLocaleString()}원
              </p>
            )}
          </div>
          <div className="text-right text-xs text-slate-500">
            <div>마지막 ledger 활동</div>
            <div className="font-medium text-slate-700">{fmtDate(data.last_entry_at)}</div>
            <div className="mt-1.5">최종 점검</div>
            <div className="font-medium text-slate-700">{fmtDate(data.checked_at)}</div>
          </div>
        </div>
      </section>

      {/* 최근 7일 차트 */}
      <section className="mb-6">
        <h2 className="text-sm font-bold text-slate-700 mb-2">최근 7일 ledger 활동</h2>
        {data.daily.length === 0 ? (
          <p className="text-xs text-slate-400">기록 없음 (이중쓰기 시작 후 첫 거래 대기 중)</p>
        ) : (
          <div className="bg-white border rounded p-4">
            <div className="flex items-end gap-1 h-32">
              {data.daily.map(d => {
                const h = (d.count / dailyMax) * 100;
                return (
                  <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full bg-blue-500 rounded-t opacity-80"
                         style={{ height: `${Math.max(2, h)}%` }}
                         title={`${d.count}건 / paid ${d.paid_total.toLocaleString()} / payout ${d.payout_total.toLocaleString()}`}
                    />
                    <span className="text-[10px] text-slate-500">{d.date.slice(5)}</span>
                  </div>
                );
              })}
            </div>
            <div className="grid grid-cols-7 gap-1 mt-2 text-[10px] text-slate-500 tabular-nums text-center">
              {data.daily.map(d => (
                <div key={d.date}>
                  <div className="font-medium text-slate-700">{d.count}건</div>
                  <div className="text-green-600">+{(d.paid_total / 10000).toFixed(0)}만</div>
                  <div className="text-red-500">-{(Math.abs(d.payout_total) / 10000).toFixed(0)}만</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* drift 테이블 */}
      {!isOk && (
        <section>
          <h2 className="text-sm font-bold text-red-700 mb-2">Drift 상위 20건</h2>
          <div className="bg-white border rounded overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left p-2">Booking</th>
                  <th className="text-left p-2">계정</th>
                  <th className="text-right p-2">bookings 잔액</th>
                  <th className="text-right p-2">ledger 합계</th>
                  <th className="text-right p-2">drift</th>
                </tr>
              </thead>
              <tbody>
                {data.drift_sample.map(r => (
                  <tr key={`${r.booking_id}:${r.account}`} className="border-t">
                    <td className="p-2 font-mono text-[11px]">
                      <Link
                        href={`/admin/bookings/${r.booking_id}`}
                        className="text-blue-600 underline hover:text-blue-700"
                      >
                        {r.booking_id.slice(0, 8)}…
                      </Link>
                    </td>
                    <td className="p-2">{r.account}</td>
                    <td className="p-2 text-right tabular-nums">{r.bookings_balance.toLocaleString()}</td>
                    <td className="p-2 text-right tabular-nums">{r.ledger_sum.toLocaleString()}</td>
                    <td className="p-2 text-right tabular-nums font-bold text-red-600">
                      {r.drift > 0 ? '+' : ''}{r.drift.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            drift &gt; 0 = bookings 가 ledger 보다 많음 (ledger 누락) · drift &lt; 0 = ledger 가 더 많음 (잔액 보정 누락)
          </p>
        </section>
      )}
    </div>
  );
}
