'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, X, Coins } from 'lucide-react';
import { fmtK } from '@/lib/admin-utils';

interface Candidate {
  bookingId: string;
  booking_no: string | null;
  customer_name: string | null;
  package_title: string | null;
  total_price: number | null;
  paid_amount: number | null;
  departure_date: string | null;
  confidence: number;
  reasons: string[];
  matchClass: 'auto' | 'review' | 'unmatched';
}

interface Props {
  transactionId: string;
  candidates: Candidate[];
  currentStatus: string;
  hasMatch: boolean;
}

const CLASS_COLOR: Record<string, string> = {
  auto: 'bg-emerald-100 text-emerald-700',
  review: 'bg-amber-100 text-amber-700',
  unmatched: 'bg-slate-100 text-slate-600',
};

export default function PaymentActions({
  transactionId,
  candidates,
  hasMatch,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function confirmMatch(bookingId: string) {
    setBusy(bookingId);
    setError(null);
    try {
      const res = await fetch('/api/bank-transactions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'match',
          transactionId,
          bookingId,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || '매칭 실패');
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '처리 실패');
    } finally {
      setBusy(null);
    }
  }

  async function undoMatch() {
    setBusy('undo');
    setError(null);
    try {
      const res = await fetch('/api/bank-transactions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'undo', transactionId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || '롤백 실패');
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '처리 실패');
    } finally {
      setBusy(null);
    }
  }

  async function markAsFee() {
    setBusy('fee');
    setError(null);
    try {
      const res = await fetch('/api/bank-transactions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'fee', transactionId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || '처리 실패');
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '처리 실패');
    } finally {
      setBusy(null);
    }
  }

  if (hasMatch) {
    return (
      <section className="bg-white border border-slate-200 rounded-2xl px-4 py-3 space-y-2">
        <h3 className="text-xs font-semibold text-slate-500">매칭 관리</h3>
        {error && (
          <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
            {error}
          </div>
        )}
        <button
          type="button"
          onClick={undoMatch}
          disabled={busy !== null}
          className="w-full flex items-center justify-center gap-2 bg-rose-50 text-rose-700 rounded-xl px-4 py-3 text-sm font-medium active:scale-[0.99] disabled:opacity-50"
        >
          <X size={16} />
          매칭 해제 (롤백)
        </button>
      </section>
    );
  }

  return (
    <>
      {error && (
        <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      <div className="space-y-2">
        {candidates.map(c => (
          <button
            key={c.bookingId}
            type="button"
            onClick={() => confirmMatch(c.bookingId)}
            disabled={busy !== null}
            className="w-full text-left bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 active:bg-slate-100 disabled:opacity-50 transition"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span
                    className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${CLASS_COLOR[c.matchClass]}`}
                  >
                    {Math.round(c.confidence * 100)}%
                  </span>
                  <span className="text-sm font-semibold text-slate-900 truncate">
                    {c.customer_name ?? '예약자 미지정'}
                  </span>
                </div>
                <div className="text-xs text-slate-500 truncate">
                  {c.booking_no ?? '—'} · {c.package_title ?? '상품명 없음'}
                </div>
                {c.reasons.length > 0 && (
                  <div className="text-[10px] text-slate-400 mt-1 line-clamp-1">
                    {c.reasons.slice(0, 2).join(' · ')}
                  </div>
                )}
              </div>
              <div className="shrink-0 flex items-center gap-1 text-xs tabular-nums text-slate-600">
                {c.total_price ? fmtK(c.total_price) : '—'}
                {busy === c.bookingId ? (
                  <span className="text-emerald-700 text-[11px]">중...</span>
                ) : (
                  <Check size={16} className="text-emerald-600" />
                )}
              </div>
            </div>
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={markAsFee}
        disabled={busy !== null}
        className="w-full mt-2 flex items-center justify-center gap-2 bg-slate-100 text-slate-700 rounded-xl px-4 py-2.5 text-xs font-medium active:scale-[0.99] disabled:opacity-50"
      >
        <Coins size={14} />
        수수료로 분류 (예약 미연결)
      </button>
    </>
  );
}
