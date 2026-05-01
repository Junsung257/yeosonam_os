'use client';

/**
 * LedgerStatusChip
 *
 * Phase 2a 이중쓰기 정합성 라이브 칩.
 *  - 정합 OK   → 초록 "원장 OK"
 *  - drift N건 → 빨간 "Drift N건"
 *  - 로딩 / 오류는 회색
 * 클릭 시 /admin/payments/reconcile 페이지로 이동.
 *
 * 매 60초 폴링 (저비용 — RPC 1번 + 7일 entry 한 번).
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface State {
  ok: boolean;
  drift_count: number;
  total_abs_drift: number;
}

export default function LedgerStatusChip() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function fetchStatus() {
      try {
        const res = await fetch('/api/admin/ledger/reconcile-status', { cache: 'no-store' });
        if (!res.ok) throw new Error();
        const json = await res.json();
        if (!cancelled) {
          setState({
            ok: json.ok,
            drift_count: json.drift_count ?? 0,
            total_abs_drift: json.total_abs_drift ?? 0,
          });
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    }
    fetchStatus();
    const id = setInterval(fetchStatus, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (error) {
    return (
      <span className="px-2 py-0.5 text-[11px] rounded bg-slate-100 text-slate-400 border border-slate-200">
        원장 ?
      </span>
    );
  }
  if (!state) {
    return (
      <span className="px-2 py-0.5 text-[11px] rounded bg-slate-100 text-slate-400 border border-slate-200">
        원장 …
      </span>
    );
  }

  const isOk = state.ok && state.drift_count === 0;

  return (
    <Link
      href="/admin/payments/reconcile"
      className={`px-2 py-0.5 text-[11px] rounded border tabular-nums transition hover:opacity-80 ${
        isOk
          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
          : 'bg-red-50 text-red-700 border-red-200 animate-pulse'
      }`}
      title={isOk ? '원장 정합 OK' : `drift ${state.drift_count}건 / 절대합 ${state.total_abs_drift.toLocaleString()}원`}
    >
      {isOk ? '원장 OK' : `Drift ${state.drift_count}건`}
    </Link>
  );
}
