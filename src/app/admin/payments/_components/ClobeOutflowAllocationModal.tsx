'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';

export interface ClobeAllocationTransaction {
  id: string;
  amount: number;
  memo?: string;
  counterparty_name?: string;
  received_at: string;
}

export interface ClobeAllocationBooking {
  id: string;
  booking_no?: string;
  package_title?: string;
  departure_date?: string;
  land_operator?: string;
  paid_amount?: number;
  total_paid_out?: number;
  customers?: { name?: string };
}

type AllocationType = 'payout' | 'refund';

interface AllocationRow {
  key: string;
  bookingId: string;
  amount: string;
  allocationType: AllocationType;
}

interface Props {
  transaction: ClobeAllocationTransaction | null;
  bookings: ClobeAllocationBooking[];
  suggestedBookingId?: string | null;
  defaultAllocationType?: AllocationType;
  onClose: () => void;
  onAllocated: () => void | Promise<void>;
}

function newRow(
  bookingId = '',
  amount = '',
  allocationType: AllocationType = 'payout',
): AllocationRow {
  return {
    key: crypto.randomUUID(),
    bookingId,
    amount,
    allocationType,
  };
}

function bookingLabel(booking: ClobeAllocationBooking): string {
  const date = booking.departure_date?.replaceAll('-', '').slice(2) || '날짜없음';
  const customer = booking.customers?.name || '고객없음';
  const operator = booking.land_operator || booking.package_title || '랜드사없음';
  return `${date} · ${customer} · ${operator}${booking.booking_no ? ` · ${booking.booking_no}` : ''}`;
}

export default function ClobeOutflowAllocationModal({
  transaction,
  bookings,
  suggestedBookingId = null,
  defaultAllocationType = 'payout',
  onClose,
  onAllocated,
}: Props) {
  const [rows, setRows] = useState<AllocationRow[]>([]);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const activeTransactionId = transaction?.id;

  useEffect(() => {
    if (!transaction) {
      setRows([]);
      setNotes('');
      setError(null);
      return;
    }
    setRows([
      newRow(
        suggestedBookingId ?? '',
        String(Math.abs(transaction.amount)),
        defaultAllocationType,
      ),
    ]);
    setNotes('');
    setError(null);
  }, [defaultAllocationType, suggestedBookingId, transaction]);

  useEffect(() => {
    if (!activeTransactionId) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [activeTransactionId]);

  const transactionAmount = Math.abs(transaction?.amount ?? 0);
  const allocatedTotal = rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const remaining = transactionAmount - allocatedTotal;
  const duplicateBooking = useMemo(() => {
    const ids = rows.map(row => row.bookingId).filter(Boolean);
    return new Set(ids).size !== ids.length;
  }, [rows]);
  const ready = !!transaction
    && rows.length > 0
    && rows.every(row => row.bookingId && Number(row.amount) > 0)
    && !duplicateBooking
    && remaining === 0;

  if (!transaction) return null;

  const updateRow = (key: string, patch: Partial<AllocationRow>) => {
    setRows(current => current.map(row => row.key === key ? { ...row, ...patch } : row));
    setError(null);
  };

  const handleSubmit = async () => {
    if (!ready || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/bank-transactions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'confirm_clobe_outflow_allocations',
          transactionId: transaction.id,
          allocations: rows.map(row => ({
            bookingId: row.bookingId,
            amount: Number(row.amount),
            allocationType: row.allocationType,
          })),
          notes: notes.trim() || undefined,
          idempotencyKey: `clobe-outflow:${transaction.id}:${crypto.randomUUID()}`,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Clobe 출금 배정에 실패했습니다.');
      await onAllocated();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Clobe 출금 배정에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-6">
      <button
        type="button"
        aria-label="Clobe 출금 배정 닫기"
        className="absolute inset-0 bg-slate-950/40 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="clobe-allocation-title"
        aria-describedby="clobe-allocation-description"
        onKeyDown={event => {
          if (event.key === 'Escape' && !submitting) onClose();
        }}
        className="relative flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-admin-border-mid bg-white shadow-2xl sm:rounded-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-admin-border-mid px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-blue-700">Clobe 원본 출금 1건</p>
            <h2 id="clobe-allocation-title" className="mt-1 text-admin-lg font-bold text-admin-text-2">
              {transactionAmount.toLocaleString('ko-KR')}원 배정
            </h2>
            <p className="mt-1 truncate text-admin-xs text-admin-muted">
              {transaction.memo || '메모 없음'} · {transaction.counterparty_name || '거래처 없음'}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-admin-muted hover:bg-admin-bg hover:text-admin-text-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            aria-label="닫기"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
          <div id="clobe-allocation-description" className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-admin-xs leading-relaxed text-blue-900">
            <p className="font-bold">통장 출금 원본은 나누거나 삭제하지 않습니다.</p>
            <p className="mt-1">
              아래에서는 이 한 건의 회계 의미만 예약별로 배정합니다. 600,500원 환불은 600,500원 한 줄로, 914만원 복합 출금은 764만원 랜드사 지급 + 150만원 고객 환불처럼 입력합니다.
            </p>
          </div>

          <div className="space-y-3">
            {rows.map((row, index) => (
              <div key={row.key} className="rounded-xl border border-admin-border-mid bg-admin-surface-2/50 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-admin-xs font-bold text-admin-text-2">배정 {index + 1}</p>
                  {rows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setRows(current => current.filter(item => item.key !== row.key))}
                      className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-[11px] font-semibold text-red-600 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> 삭제
                    </button>
                  )}
                </div>
                <div className="grid gap-3 md:grid-cols-[150px_minmax(0,1fr)_170px]">
                  <label className="text-[11px] font-semibold text-admin-muted">
                    처리 구분
                    <select
                      value={row.allocationType}
                      onChange={event => updateRow(row.key, { allocationType: event.target.value as AllocationType })}
                      className="mt-1 h-11 w-full rounded-lg border border-admin-border-strong bg-white px-3 text-admin-sm text-admin-text-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    >
                      <option value="payout">랜드사 지급</option>
                      <option value="refund">고객 환불</option>
                    </select>
                  </label>
                  <label className="text-[11px] font-semibold text-admin-muted">
                    예약
                    <select
                      value={row.bookingId}
                      onChange={event => updateRow(row.key, { bookingId: event.target.value })}
                      className="mt-1 h-11 w-full rounded-lg border border-admin-border-strong bg-white px-3 text-admin-sm text-admin-text-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    >
                      <option value="">예약을 선택하세요</option>
                      {bookings.map(booking => (
                        <option key={booking.id} value={booking.id}>{bookingLabel(booking)}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-[11px] font-semibold text-admin-muted">
                    금액
                    <div className="relative mt-1">
                      <input
                        type="number"
                        min={1}
                        step={1}
                        inputMode="numeric"
                        value={row.amount}
                        onChange={event => updateRow(row.key, { amount: event.target.value })}
                        className="h-11 w-full rounded-lg border border-admin-border-strong bg-white pl-3 pr-8 text-right text-admin-sm font-bold tabular-nums text-admin-text-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-admin-xs text-admin-muted">원</span>
                    </div>
                  </label>
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setRows(current => [...current, newRow('', '', 'payout')])}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-admin-border-strong bg-white px-3 text-admin-xs font-bold text-admin-text-2 hover:bg-admin-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> 예약 배정 추가
          </button>

          <label className="block text-[11px] font-semibold text-admin-muted">
            확인 메모 (선택)
            <input
              value={notes}
              onChange={event => setNotes(event.target.value)}
              placeholder="예: 764만원 랜드사 지급 + 150만원 김도연 환불"
              className="mt-1 h-11 w-full rounded-lg border border-admin-border-strong bg-white px-3 text-admin-sm text-admin-text-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </label>

          {duplicateBooking && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-admin-xs font-semibold text-red-700">
              같은 예약을 두 번 선택할 수 없습니다. 한 예약의 금액은 한 줄로 합쳐주세요.
            </p>
          )}
          {error && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-admin-xs font-semibold text-red-700">{error}</p>
          )}
        </div>

        <footer className="border-t border-admin-border-mid bg-white px-5 py-4 sm:px-6">
          <div className="mb-3 grid grid-cols-3 gap-2 rounded-xl bg-admin-surface-2 px-4 py-3 text-center">
            <div>
              <p className="text-[10px] font-semibold text-admin-muted">출금 원본</p>
              <p className="mt-1 text-admin-sm font-black tabular-nums text-admin-text-2">{transactionAmount.toLocaleString('ko-KR')}원</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-admin-muted">배정 합계</p>
              <p className="mt-1 text-admin-sm font-black tabular-nums text-blue-700">{allocatedTotal.toLocaleString('ko-KR')}원</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-admin-muted">남은 금액</p>
              <p className={`mt-1 text-admin-sm font-black tabular-nums ${remaining === 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                {remaining.toLocaleString('ko-KR')}원
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 flex-1 rounded-lg border border-admin-border-strong bg-white px-4 text-admin-sm font-bold text-admin-text-2 hover:bg-admin-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              취소
            </button>
            <button
              type="button"
              disabled={!ready || submitting}
              onClick={handleSubmit}
              className="min-h-11 flex-[2] rounded-lg bg-slate-950 px-4 text-admin-sm font-bold text-white hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {submitting ? '원장 반영 중...' : remaining === 0 ? `${rows.length}건 배정 확정` : '금액을 정확히 맞춰주세요'}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
