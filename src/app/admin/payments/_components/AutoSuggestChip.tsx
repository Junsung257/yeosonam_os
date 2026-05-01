'use client';

/**
 * 거래 카드 옆에 자동 제안 칩 — auto-suggest API 결과 1-click 확정.
 *
 * 입금/환불: booking 1:1 매칭 후보 → confirm_payment_match RPC
 * 출금:      settlement bundle 후보 → settlement-bundle RPC
 *
 * 칩이 안 뜨면 후보 0건 (fuzzy 매치 실패 또는 합계 불일치).
 */

import { useState, useEffect } from 'react';

interface InflowSuggestion {
  kind: 'booking_match';
  score: number;
  booking: {
    id: string;
    booking_no: string;
    customer_name: string | null;
    total_price: number;
    paid_amount: number;
  };
  reasons: string[];
}

interface OutflowSuggestion {
  kind: 'settlement_bundle';
  score: number;
  operator: { id: string; name: string };
  bookings: {
    id: string;
    booking_no: string;
    customer_name: string | null;
    departure_date: string | null;
    amount: number;
  }[];
  bundled_total: number;
  fee_amount: number;
}

type Suggestion = InflowSuggestion | OutflowSuggestion;

interface AutoSuggestResponse {
  type: 'inflow' | 'outflow' | 'refund';
  transaction: { id: string; amount: number; counterparty_name?: string | null };
  candidates: Suggestion[];
}

interface Props {
  transactionId: string;
  /** 매칭 성공 시 부모가 reload */
  onMatched: () => void;
}

export default function AutoSuggestChip({ transactionId, onMatched }: Props) {
  const [data, setData] = useState<AutoSuggestResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/payments/auto-suggest?transactionId=${transactionId}`);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(json.error ?? '제안 실패');
        setData(json);
      } catch (err: any) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [transactionId]);

  const handleConfirmInflow = async (s: InflowSuggestion) => {
    if (confirming) return;
    setConfirming(true);
    try {
      const res = await fetch('/api/payments/match-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: `[auto-suggest] ${s.booking.customer_name ?? s.booking.booking_no}`,
          bookingId: s.booking.id,
          transactionId,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '확정 실패');
      onMatched();
    } catch (err: any) {
      setError(err.message);
      setTimeout(() => setError(null), 3000);
    } finally {
      setConfirming(false);
    }
  };

  const handleConfirmBundle = async (s: OutflowSuggestion) => {
    if (confirming) return;
    setConfirming(true);
    try {
      const res = await fetch('/api/payments/settlement-bundle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionId,
          landOperatorId: s.operator.id,
          bookingAmounts: s.bookings.map(b => ({ bookingId: b.id, amount: b.amount })),
          notes: `[auto-suggest] ${s.operator.name} ${s.bookings.length}건`,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '묶기 실패');
      onMatched();
    } catch (err: any) {
      setError(err.message);
      setTimeout(() => setError(null), 3000);
    } finally {
      setConfirming(false);
    }
  };

  if (loading) {
    return <span className="text-[11px] text-slate-400">분석…</span>;
  }
  if (error) {
    return <span className="text-[11px] text-red-500" title={error}>제안 실패</span>;
  }
  if (!data || data.candidates.length === 0) return null;

  const top = data.candidates[0];

  if (top.kind === 'booking_match') {
    const pct = Math.round(top.score * 100);
    return (
      <button
        onClick={() => handleConfirmInflow(top)}
        disabled={confirming}
        className="px-2 py-1 text-[11px] bg-emerald-50 border border-emerald-300 text-emerald-700 rounded hover:bg-emerald-100 disabled:opacity-40 transition whitespace-nowrap"
        title={`자동 제안: ${top.reasons.join(' · ')}`}
      >
        {confirming ? '...' : `✨ ${top.booking.customer_name ?? top.booking.booking_no} ${pct}%`}
      </button>
    );
  }

  if (top.kind === 'settlement_bundle') {
    return (
      <button
        onClick={() => handleConfirmBundle(top)}
        disabled={confirming}
        className="px-2 py-1 text-[11px] bg-blue-50 border border-blue-300 text-blue-700 rounded hover:bg-blue-100 disabled:opacity-40 transition whitespace-nowrap"
        title={`자동 묶음: ${top.operator.name} · ${top.bookings.length}건 · 차액 ${top.fee_amount.toLocaleString()}원`}
      >
        {confirming ? '...' : `✨ ${top.operator.name} ${top.bookings.length}건 묶음`}
      </button>
    );
  }

  return null;
}
