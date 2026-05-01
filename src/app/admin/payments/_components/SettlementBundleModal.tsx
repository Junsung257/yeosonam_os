'use client';

/**
 * 출금·환불 거래 → land_operator settlement 묶기 모달 (Phase 4).
 *
 * 흐름:
 *  1) 거래 표시 + counterparty_name → land_operators fuzzy 매칭 → 자동/수동 선택
 *  2) 선택된 operator 의 미정산 booking 후보(/api/bookings/unsettled) 로드
 *  3) 사장님이 ☑ 체크 + 정산금 입력 (기본은 booking.unsettled_amount)
 *  4) 합계 자동 계산 + 출금 금액 차액 표시 (±FEE_TOLERANCE 안일 때만 묶기 활성)
 *  5) 묶기 버튼 → /api/payments/settlement-bundle (RPC atomic)
 *
 * 정책: 자동 묶기 절대 금지 — 모든 선택은 사장님 ☑.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { operatorScore } from '@/lib/payment-command-resolver';

const FEE_TOLERANCE = 5000;

interface BankTx {
  id: string;
  amount: number;
  counterparty_name?: string | null;
  received_at: string;
  is_refund: boolean;
  match_status: string;
  transaction_type: '입금' | '출금';
}

interface UnsettledBooking {
  id: string;
  booking_no: string;
  customer_name: string | null;
  departure_date: string | null;
  total_cost: number;
  total_paid_out: number;
  unsettled_amount: number;
  status: string | null;
  payment_status: string | null;
}

interface Operator {
  id: string;
  name: string;
  aliases: string[];
}

interface Props {
  transaction: BankTx | null;
  onClose: () => void;
  onSettled: () => void;
}

export default function SettlementBundleModal({ transaction, onClose, onSettled }: Props) {
  const [operators, setOperators] = useState<Operator[]>([]);
  const [selectedOpId, setSelectedOpId] = useState<string | null>(null);
  const [bookings, setBookings] = useState<UnsettledBooking[]>([]);
  const [checked, setChecked] = useState<Map<string, number>>(new Map()); // bookingId → amount
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');

  const open = !!transaction;
  const txAmountAbs = transaction ? Math.abs(transaction.amount) : 0;

  useEffect(() => {
    if (!open) {
      setSelectedOpId(null);
      setBookings([]);
      setChecked(new Map());
      setError(null);
      setNotes('');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/land-operators');
        const data = await res.json();
        if (cancelled) return;
        const ops: Operator[] = data.operators ?? data ?? [];
        setOperators(ops);

        // counterparty_name 으로 fuzzy 자동 선택
        const cp = transaction?.counterparty_name ?? '';
        if (cp) {
          const ranked = ops
            .map(o => ({ op: o, score: operatorScore(cp, o.aliases ?? []) }))
            .filter(x => x.score > 0)
            .sort((a, b) => b.score - a.score);
          if (ranked.length > 0) setSelectedOpId(ranked[0].op.id);
        }
      } catch (err: any) {
        if (!cancelled) setError(`랜드사 조회 실패: ${err.message}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, transaction]);

  useEffect(() => {
    if (!selectedOpId) {
      setBookings([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/bookings/unsettled?landOperatorId=${selectedOpId}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error ?? '조회 실패');
        setBookings(data.bookings ?? []);
        setChecked(new Map());
      } catch (err: any) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedOpId]);

  const bundledTotal = useMemo(
    () => Array.from(checked.values()).reduce((s, n) => s + (Number.isFinite(n) ? n : 0), 0),
    [checked],
  );
  const diff = txAmountAbs - bundledTotal;
  const canSubmit = checked.size > 0 && Math.abs(diff) <= FEE_TOLERANCE && !submitting;

  const toggleBooking = useCallback(
    (b: UnsettledBooking) => {
      setChecked(prev => {
        const next = new Map(prev);
        if (next.has(b.id)) next.delete(b.id);
        else next.set(b.id, b.unsettled_amount);
        return next;
      });
    },
    [],
  );

  const updateAmount = useCallback((bookingId: string, amount: number) => {
    setChecked(prev => {
      const next = new Map(prev);
      if (next.has(bookingId)) next.set(bookingId, Math.max(0, Math.floor(amount) || 0));
      return next;
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!transaction || !selectedOpId || !canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const bookingAmounts = Array.from(checked.entries()).map(([bookingId, amount]) => ({
        bookingId,
        amount,
      }));
      const res = await fetch('/api/payments/settlement-bundle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionId: transaction.id,
          landOperatorId: selectedOpId,
          bookingAmounts,
          notes: notes || null,
          isRefund: transaction.is_refund,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? '묶기 실패');
      onSettled();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }, [transaction, selectedOpId, canSubmit, checked, notes, onSettled, onClose]);

  if (!open || !transaction) return null;

  const diffColor =
    Math.abs(diff) <= FEE_TOLERANCE
      ? 'text-emerald-600'
      : Math.abs(diff) <= 50000
        ? 'text-amber-600'
        : 'text-red-600';

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="출금 정산 묶기"
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-800">출금 정산 묶기</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {transaction.is_refund ? '환불' : '출금'} {fmtKRW(txAmountAbs)} ·{' '}
              {transaction.counterparty_name ?? '거래처 미상'} ·{' '}
              {new Date(transaction.received_at).toLocaleDateString('ko-KR')}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="px-5 py-3 border-b border-slate-100">
          <label className="block text-xs font-medium text-slate-600 mb-1">랜드사</label>
          <select
            value={selectedOpId ?? ''}
            onChange={e => setSelectedOpId(e.target.value || null)}
            className="w-full text-sm border border-slate-300 rounded px-2 py-1.5"
          >
            <option value="">랜드사 선택…</option>
            {operators.map(o => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          {!selectedOpId && transaction.counterparty_name && (
            <p className="text-[11px] text-amber-600 mt-1">
              "{transaction.counterparty_name}" 자동 매칭 실패 — 수동 선택해주세요
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading && <div className="text-sm text-slate-500 py-4">조회 중…</div>}
          {!loading && selectedOpId && bookings.length === 0 && (
            <div className="text-sm text-slate-500 text-center py-8">
              이 랜드사의 미정산 booking 이 없습니다
            </div>
          )}
          {!loading && bookings.length > 0 && (
            <table className="w-full text-sm">
              <thead className="text-[11px] text-slate-500 uppercase">
                <tr className="border-b border-slate-200">
                  <th className="w-10 text-left py-2"></th>
                  <th className="text-left py-2">고객/번호</th>
                  <th className="text-left py-2">출발</th>
                  <th className="text-right py-2">정산 잔액</th>
                  <th className="text-right py-2 w-32">묶을 금액</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map(b => {
                  const isChecked = checked.has(b.id);
                  return (
                    <tr key={b.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-2">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleBooking(b)}
                        />
                      </td>
                      <td className="py-2">
                        <div className="font-medium text-slate-800">
                          {b.customer_name ?? '이름 없음'}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono">{b.booking_no}</div>
                      </td>
                      <td className="py-2 text-xs text-slate-600">
                        {b.departure_date?.slice(2, 10).replace(/-/g, '') ?? '—'}
                      </td>
                      <td className="py-2 text-right tabular-nums text-slate-700">
                        {fmtKRW(b.unsettled_amount)}
                      </td>
                      <td className="py-2 text-right">
                        {isChecked && (
                          <input
                            type="number"
                            value={checked.get(b.id) ?? 0}
                            onChange={e => updateAmount(b.id, Number(e.target.value))}
                            className="w-28 text-right text-sm border border-slate-300 rounded px-2 py-1 tabular-nums"
                            min={0}
                            max={b.unsettled_amount * 2}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50">
          <div className="grid grid-cols-3 gap-3 mb-2 text-sm tabular-nums">
            <div>
              <div className="text-[11px] text-slate-500">출금 금액</div>
              <div className="font-semibold text-slate-800">{fmtKRW(txAmountAbs)}</div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500">묶음 합계</div>
              <div className="font-semibold text-slate-800">{fmtKRW(bundledTotal)}</div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500">차액 (수수료)</div>
              <div className={`font-semibold ${diffColor}`}>
                {diff >= 0 ? '+' : ''}
                {fmtKRW(diff)}
              </div>
            </div>
          </div>
          <input
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="메모 (선택)"
            className="w-full text-xs border border-slate-300 rounded px-2 py-1.5 mb-2"
          />
          {error && <div className="text-xs text-red-600 mb-2">{error}</div>}
          <div className="flex justify-between items-center">
            <div className="text-[11px] text-slate-500">
              {Math.abs(diff) <= FEE_TOLERANCE
                ? '✅ 합계 일치 — 묶기 가능'
                : `허용 오차 ±${fmtKRW(FEE_TOLERANCE)} 초과`}
            </div>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded"
              >
                취소
              </button>
              <button
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {submitting ? '묶는 중…' : '묶기'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function fmtKRW(n: number): string {
  if (!n) return '0';
  return n.toLocaleString();
}
