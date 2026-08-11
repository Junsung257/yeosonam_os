'use client';

import { startTransition, useDeferredValue, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import {
  AlertTriangle,
  XCircle,
  CheckCircle2,
  ChevronRight,
  BadgeDollarSign,
  Clock,
  Receipt,
  Search,
  Combine,
  Unlink,
  Wallet,
  X,
} from 'lucide-react';

import {
  BOOKING_REVIEW_LABELS,
  FINANCE_TARGET_LABELS,
  type BookingSettlementDecision,
  type BookingSettlementReviewStatus,
  type FinanceAllocationTarget,
} from '@/lib/finance-settlement-v3';
import type {
  FinanceBookingReviewDetail,
  FinanceBookingReviewRow,
} from '@/lib/finance-settlement-v3-service';
import { formatSettlementTimestamp } from '@/lib/settlement-date-format';

interface BookingResponse {
  rows: FinanceBookingReviewRow[];
  summary: Record<string, number>;
}

interface DetailResponse {
  booking: FinanceBookingReviewDetail;
}

interface BreakdownLine {
  targetType: FinanceAllocationTarget;
  amount: number;
  bookingId: string;
  targetLabel: string;
  reconciliationKey: string;
  metadata?: Record<string, unknown>;
}

interface BreakdownResponse {
  breakdown: {
    transaction: {
      id: string;
      amount: number;
      transaction_type: string;
      received_at: string;
      counterparty_name: string | null;
      memo: string | null;
    };
    allocations: Array<{
      booking_id: string | null;
      allocated_amount: number;
      target_type: FinanceAllocationTarget;
      reconciliation_key: string | null;
      target_label: string | null;
      metadata: Record<string, unknown> | null;
    }>;
    fingerprint: string;
    allocated: number;
    remaining: number;
  };
}

async function fetcher<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || '정산 정보를 불러오지 못했습니다.');
  return payload;
}

function won(value: number): string {
  return `${Math.round(value).toLocaleString('ko-KR')}원`;
}

function idempotencyKey(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

const FILTERS: Array<{ value: BookingSettlementReviewStatus | 'all'; label: string }> = [
  { value: 'all', label: '전체' },
  { value: 'pending', label: '재검토 필요' },
  { value: 'confirmed', label: '확인 완료' },
  { value: 'customer_cancelled', label: '고객 취소' },
  { value: 'invalid_booking', label: '오예약 제외' },
  { value: 'reclassified', label: '예약 아님' },
  { value: 'deferred', label: '보류' },
];

function Dialog({
  title,
  description,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  description: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const listener = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', listener);
    return () => { document.removeEventListener('keydown', listener); previous?.focus(); };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-3 sm:p-5">
      <button type="button" tabIndex={-1} className="absolute inset-0 bg-slate-950/45" onClick={onClose} aria-label="대화상자 닫기" />
      <section role="dialog" aria-modal="true" aria-labelledby="finance-modal-title" aria-describedby="finance-modal-description" className={`relative max-h-[92vh] w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl ${wide ? 'max-w-4xl' : 'max-w-xl'}`}>
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4">
          <div><h3 id="finance-modal-title" className="text-lg font-semibold text-slate-950">{title}</h3><p id="finance-modal-description" className="mt-1 text-xs leading-5 text-slate-600">{description}</p></div>
          <button ref={closeRef} type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="닫기"><X className="h-4 w-4" /></button>
        </header>
        {children}
      </section>
    </div>
  );
}

function BreakdownDialog({
  transactionId,
  bookingChoices,
  defaultBookingId,
  onClose,
  onSaved,
}: {
  transactionId: string;
  bookingChoices: FinanceBookingReviewRow[];
  defaultBookingId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { data, error, isLoading } = useSWR<BreakdownResponse>(`/api/admin/finance/transactions/${transactionId}/breakdown`, fetcher, { revalidateOnFocus: false });
  const [lines, setLines] = useState<BreakdownLine[]>([]);
  const [reason, setReason] = useState('거래 용도 분할 확인');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const breakdown = data?.breakdown;

  useEffect(() => {
    if (!breakdown) return;
    setLines(breakdown.allocations.map(line => ({
      targetType: line.target_type,
      amount: Number(line.allocated_amount),
      bookingId: line.booking_id ?? '',
      targetLabel: line.target_label ?? '',
      reconciliationKey: line.reconciliation_key ?? '',
      metadata: line.metadata ?? {},
    })));
  }, [breakdown]);

  const allocated = lines.reduce((sum, line) => sum + Math.round(Number(line.amount) || 0), 0);
  const remaining = Math.round(Number(breakdown?.transaction.amount) || 0) - allocated;

  const save = async () => {
    if (!breakdown || remaining !== 0 || !reason.trim()) return;
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/finance/transactions/${transactionId}/breakdown`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey('finance-breakdown') },
        body: JSON.stringify({ expectedFingerprint: breakdown.fingerprint, reason, lines: lines.map(line => ({ ...line, bookingId: line.bookingId || null })) }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || '거래 분할을 저장하지 못했습니다.');
      await onSaved();
      onClose();
    } catch (saveError) {
      setNotice(saveError instanceof Error ? saveError.message : '거래 분할을 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog wide title="거래 분할" description="원본 거래는 하나로 유지하고, 전체 금액을 예약·환불·수수료·회사 용도로 나눕니다." onClose={onClose}>
      <div className="space-y-4 p-5">
        {isLoading ? <div className="h-40 animate-pulse rounded-xl bg-slate-100" /> : null}
        {error ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error.message}</div> : null}
        {breakdown ? (
          <>
            <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm sm:grid-cols-4">
              <div><span className="block text-xs text-slate-500">일시</span><strong>{formatSettlementTimestamp(breakdown.transaction.received_at)}</strong></div>
              <div><span className="block text-xs text-slate-500">거래처</span><strong>{breakdown.transaction.counterparty_name || '-'}</strong></div>
              <div><span className="block text-xs text-slate-500">원본 금액</span><strong>{won(breakdown.transaction.amount)}</strong></div>
              <div><span className="block text-xs text-slate-500">Clobe 메모</span><strong className="break-all">{breakdown.transaction.memo || '메모 없음'}</strong></div>
            </div>

            <div className="space-y-3">
              {lines.map((line, index) => {
                const bookingTarget = line.targetType === 'booking';
                const optionalBooking = ['customer_refund', 'bank_fee'].includes(line.targetType);
                return (
                  <div key={`${index}-${line.targetType}`} className="grid gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-[1.2fr_1fr_1.5fr_auto]">
                    <select value={line.targetType} onChange={event => setLines(current => current.map((item, itemIndex) => {
                      if (itemIndex !== index) return item;
                      const targetType = event.target.value as FinanceAllocationTarget;
                      const canLinkBooking = ['booking', 'customer_refund', 'bank_fee'].includes(targetType);
                      return {
                        ...item,
                        targetType,
                        bookingId: targetType === 'booking'
                          ? (item.bookingId || defaultBookingId)
                          : (canLinkBooking ? item.bookingId : ''),
                      };
                    }))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" aria-label={`${index + 1}번째 분할 용도`}>
                      {Object.entries(FINANCE_TARGET_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                    <input type="number" min={1} value={line.amount} onChange={event => setLines(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, amount: Number(event.target.value) } : item))} className="rounded-lg border border-slate-300 px-3 py-2 text-right text-sm tabular-nums" aria-label={`${index + 1}번째 분할 금액`} />
                    {bookingTarget || optionalBooking ? (
                      <select value={line.bookingId} required={bookingTarget} onChange={event => setLines(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, bookingId: event.target.value } : item))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" aria-label={`${index + 1}번째 연결 예약`}>
                        {optionalBooking ? <option value="">예약 연결 없음</option> : null}
                        {bookingChoices.map(booking => <option key={booking.id} value={booking.id}>{booking.bookingNo} · {booking.customerName || '-'} · {booking.departureDate || '-'}</option>)}
                      </select>
                    ) : <input value={line.targetLabel} onChange={event => setLines(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, targetLabel: event.target.value } : item))} placeholder="대상 설명" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" aria-label={`${index + 1}번째 대상 설명`} />}
                    <button type="button" onClick={() => setLines(current => current.filter((_, itemIndex) => itemIndex !== index))} disabled={lines.length === 1} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 disabled:opacity-40">삭제</button>
                  </div>
                );
              })}
              <button type="button" onClick={() => setLines(current => [...current, { targetType: 'booking', amount: Math.max(1, remaining), bookingId: defaultBookingId, targetLabel: '', reconciliationKey: '' }])} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold"><Combine className="h-3.5 w-3.5" /> 분할선 추가</button>
            </div>

            <div className={`rounded-xl border p-3 text-sm ${remaining === 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-800'}`}>
              원본 {won(breakdown.transaction.amount)} · 배분 {won(allocated)} · <strong>차이 {won(remaining)}</strong>
            </div>
            <label className="block text-sm font-semibold text-slate-800">변경 사유<input value={reason} onChange={event => setReason(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label>
            {notice ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{notice}</div> : null}
            <div className="flex justify-end gap-2 border-t border-slate-200 pt-4"><button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold">취소</button><button type="button" onClick={save} disabled={saving || remaining !== 0 || !reason.trim()} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{saving ? '저장 중' : '분할 저장'}</button></div>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}

function BookingDrawer({
  bookingId,
  bookingChoices,
  nextBookingId,
  onSelectBooking,
  onClose,
  onChanged,
}: {
  bookingId: string;
  bookingChoices: FinanceBookingReviewRow[];
  nextBookingId: string | null;
  onSelectBooking: (bookingId: string) => void;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const { data, error, isLoading, mutate } = useSWR<DetailResponse>(`/api/admin/finance/bookings/${bookingId}`, fetcher, { revalidateOnFocus: false });
  const [decision, setDecision] = useState<BookingSettlementDecision | null>(null);
  const [reason, setReason] = useState('');
  const [assignedTo, setAssignedTo] = useState('재무 담당자');
  const [dueDate, setDueDate] = useState(() => new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10));
  const [reclassTarget, setReclassTarget] = useState<'owner_draw' | 'company_travel'>('company_travel');
  const [splitTransactionId, setSplitTransactionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const booking = data?.booking;

  const refresh = async () => { await mutate(); await onChanged(); };

  const saveBreakdown = async (transactionId: string, lines: BreakdownLine[], expectedFingerprint: string, breakdownReason: string) => {
    const response = await fetch(`/api/admin/finance/transactions/${transactionId}/breakdown`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey('finance-breakdown') },
      body: JSON.stringify({ lines, expectedFingerprint, reason: breakdownReason }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || '거래 용도를 변경하지 못했습니다.');
  };

  const prepareCancellation = async () => {
    if (!booking) throw new Error('예약을 다시 불러와주세요.');
    const payouts = booking.transactions.filter(row => row.direction === '출금' && row.targetType === 'booking');
    const payout = payouts.length === 1 ? payouts[0] : null;
    const fee = payout ? payout.allocatedAmount - booking.deposits : -1;
    if (!payout || booking.customerRefunds > 0 || booking.deposits <= 0 || fee < 0 || fee > 10_000) {
      throw new Error('자동 분리가 안전하지 않습니다. 출금 거래의 “거래 분할”에서 환불금과 수수료를 먼저 확인해주세요.');
    }
    const current = await fetcher<BreakdownResponse>(`/api/admin/finance/transactions/${payout.id}/breakdown`);
    const preserved = current.breakdown.allocations
      .filter(line => !(line.booking_id === booking.id && line.target_type === 'booking'))
      .map(line => ({
        targetType: line.target_type,
        amount: Number(line.allocated_amount),
        bookingId: line.booking_id ?? '',
        targetLabel: line.target_label ?? '',
        reconciliationKey: line.reconciliation_key ?? '',
        metadata: line.metadata ?? {},
      }));
    const reconciliationKey = `customer-cancel:${booking.bookingNo}`;
    const lines: BreakdownLine[] = [
      ...preserved,
      { targetType: 'customer_refund', amount: booking.deposits, bookingId: booking.id, targetLabel: `${booking.customerName ?? booking.bookingNo} 취소환불`, reconciliationKey },
    ];
    if (fee > 0) lines.push({ targetType: 'bank_fee', amount: fee, bookingId: booking.id, targetLabel: `${booking.bookingNo} 송금수수료`, reconciliationKey });
    await saveBreakdown(payout.id, lines, current.breakdown.fingerprint, `${booking.bookingNo} 고객 취소환불과 송금수수료 분리`);
  };

  const reclassifyTransactions = async () => {
    if (!booking) throw new Error('예약을 다시 불러와주세요.');
    if (booking.transactions.some(row => row.direction === '입금')) {
      throw new Error('입금 거래가 포함된 예약은 개인사용·출장경비로 일괄 변경할 수 없습니다. 거래별 “거래 분할”에서 실제 용도를 확인해주세요.');
    }
    const transactionIds = [...new Set(booking.transactions.map(row => row.id))];
    for (const transactionId of transactionIds) {
      const current = await fetcher<BreakdownResponse>(`/api/admin/finance/transactions/${transactionId}/breakdown`);
      const lines = current.breakdown.allocations.map(line => line.booking_id === booking.id
        ? {
          targetType: reclassTarget,
          amount: Number(line.allocated_amount),
          bookingId: '',
          targetLabel: `${booking.bookingNo} ${reclassTarget === 'company_travel' ? '회사 출장경비' : '대표자 개인사용'}`,
          reconciliationKey: line.reconciliation_key ?? '',
          metadata: { ...(line.metadata ?? {}), reclassifiedFromBooking: booking.id },
        }
        : {
          targetType: line.target_type,
          amount: Number(line.allocated_amount),
          bookingId: line.booking_id ?? '',
          targetLabel: line.target_label ?? '',
          reconciliationKey: line.reconciliation_key ?? '',
          metadata: line.metadata ?? {},
        });
      await saveBreakdown(transactionId, lines, current.breakdown.fingerprint, `${booking.bookingNo} 예약 아님: ${FINANCE_TARGET_LABELS[reclassTarget]}`);
    }
  };

  const submitDecision = async () => {
    if (!booking || !decision || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      if (decision === 'customer_cancelled') await prepareCancellation();
      if (decision === 'reclassified') await reclassifyTransactions();
      const refreshed = (decision === 'customer_cancelled' || decision === 'reclassified')
        ? await mutate()
        : data;
      const latest = refreshed?.booking ?? booking;
      if (!latest.reviewFingerprint) throw new Error('최신 검토 지문이 없습니다. 다시 불러와주세요.');
      const response = await fetch(`/api/admin/finance/bookings/${booking.id}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey('finance-review') },
        body: JSON.stringify({
          decision,
          expectedFingerprint: latest.reviewFingerprint,
          reason: reason || (decision === 'confirmed' ? 'Clobe 거래·메모·분할 확인 완료' : ''),
          assignedTo: decision === 'deferred' ? assignedTo : null,
          dueDate: decision === 'deferred' ? dueDate : null,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || '정산 결정을 저장하지 못했습니다.');
      setDecision(null);
      setReason('');
      await refresh();
      if (nextBookingId) onSelectBooking(nextBookingId);
      else onClose();
    } catch (submitError) {
      setNotice(submitError instanceof Error ? submitError.message : '정산 결정을 저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const openDecision = (next: BookingSettlementDecision) => {
    setDecision(next);
    setNotice(null);
    setReason(next === 'confirmed' ? 'Clobe 거래·메모·분할 확인 완료' : '');
  };

  return (
    <div className="fixed inset-0 z-[70] flex justify-end">
      <button type="button" className="absolute inset-0 bg-slate-950/35" onClick={onClose} aria-label="상세 닫기" />
      <aside role="dialog" aria-modal="true" aria-label="예약 정산 상세" className="relative h-full w-full max-w-3xl overflow-y-auto border-l border-slate-200 bg-white shadow-2xl">
        <header className="sticky top-0 z-20 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4">
          <div><p className="text-xs font-semibold text-emerald-700">예약별 정산 검토</p><h3 className="mt-1 text-xl font-bold text-slate-950">{booking?.bookingNo ?? '불러오는 중'}</h3><p className="mt-1 text-xs text-slate-600">거래와 Clobe 메모를 확인한 뒤 처리 결정을 남깁니다.</p></div>
          <div className="flex items-center gap-2">{nextBookingId ? <button type="button" onClick={() => onSelectBooking(nextBookingId)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700">다음 미검토 예약</button> : null}<button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="닫기"><X className="h-5 w-5" /></button></div>
        </header>

        <div className="space-y-5 p-5">
          {isLoading ? <div className="h-72 animate-pulse rounded-xl bg-slate-100" /> : null}
          {error ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error.message}</div> : null}
          {booking ? (
            <>
              {booking.hasReviewDrift ? <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"><strong>저장된 검토값과 현재 Clobe 원장이 달라 최신 원장으로 다시 계산했습니다.</strong><span className="mt-1 block text-xs">아래 현재 거래를 확인하면 최신 지문으로 안전하게 저장됩니다.</span></div> : null}
              <section className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-4">
                <div><span className="block text-xs text-slate-500">고객·출발일</span><strong className="mt-1 block text-sm">{booking.customerName || '-'} · {booking.departureDate || '-'}</strong></div>
                <div><span className="block text-xs text-slate-500">여행키</span><strong className="mt-1 block break-all text-sm">{booking.travelKey || '메모키 없음'}</strong></div>
                <div><span className="block text-xs text-slate-500">검토 상태</span><strong className="mt-1 block text-sm">{BOOKING_REVIEW_LABELS[booking.reviewStatus]}</strong></div>
                <div><span className="block text-xs text-slate-500">마지막 확인</span><strong className="mt-1 block text-sm">{booking.reviewedBy || '-'}{booking.reviewedAt ? ` · ${formatSettlementTimestamp(booking.reviewedAt)}` : ''}</strong></div>
              </section>

              <section className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {[
                  ['고객 입금', booking.deposits],
                  ['여행 출금', booking.travelWithdrawals],
                  ['고객 환불', booking.customerRefunds],
                  ['은행 수수료', booking.bankFees],
                  ['현금 마진', booking.cashMargin],
                ].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-slate-200 p-3"><span className="text-xs text-slate-500">{label}</span><strong className={`mt-1 block text-sm tabular-nums ${label === '현금 마진' ? Number(value) >= 0 ? 'text-emerald-700' : 'text-red-700' : ''}`}>{won(Number(value))}</strong></div>)}
              </section>

              <section className="grid gap-3 rounded-xl border border-sky-200 bg-sky-50 p-4 sm:grid-cols-2">
                <div><h4 className="text-sm font-semibold text-sky-950">예약 장부 예상</h4><p className="mt-2 text-xs text-sky-900">판매가 {won(booking.totalPrice)} · 예정원가 {won(booking.totalCost)}</p><strong className="mt-1 block text-base text-sky-950">예상 마진 {won(booking.totalPrice - booking.totalCost)}</strong></div>
                <div><h4 className="text-sm font-semibold text-sky-950">Clobe 통장 결과</h4><p className="mt-2 text-xs text-sky-900">입금 {won(booking.deposits)} · 여행출금 {won(booking.travelWithdrawals)} · 환불 {won(booking.customerRefunds)}</p><strong className="mt-1 block text-base text-sky-950">현금 마진 {won(booking.cashMargin)}</strong></div>
              </section>

              <section className="overflow-hidden rounded-xl border border-slate-200">
                <header className="border-b border-slate-200 bg-slate-50 px-4 py-3"><h4 className="text-sm font-semibold text-slate-900">Clobe 근거 거래 {booking.transactions.length}건</h4><p className="mt-1 text-xs text-slate-600">현재 메모와 배분 금액을 거래 한 건씩 확인합니다.</p></header>
                <div className="divide-y divide-slate-200">
                  {booking.transactions.map(transaction => (
                    <article key={transaction.allocationId} className="space-y-3 px-4 py-4">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div><strong className="text-sm text-slate-950">{formatSettlementTimestamp(transaction.receivedAt)} · {transaction.counterparty || '-'}</strong><p className="mt-1 text-xs text-slate-600">원본 {won(transaction.sourceAmount)} · {transaction.direction} · 배분 {won(transaction.allocatedAmount)}</p></div>
                        <button type="button" onClick={() => setSplitTransactionId(transaction.id)} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold"><Combine className="h-3.5 w-3.5" /> 거래 분할</button>
                      </div>
                      <div className="grid gap-2 text-xs sm:grid-cols-2">
                        <div className="rounded-lg bg-emerald-50 p-3 text-emerald-950"><span className="block font-semibold">현재 Clobe 메모</span><span className="mt-1 block break-all leading-5">{transaction.memo || '메모 없음'}</span></div>
                        <div className="rounded-lg bg-slate-50 p-3 text-slate-700"><span className="block font-semibold">이전 메모</span><span className="mt-1 block break-all leading-5">{transaction.previousMemo || '변경 기록 없음'}</span></div>
                      </div>
                      <p className="text-xs text-slate-600">배분: <strong className="text-slate-900">{FINANCE_TARGET_LABELS[transaction.targetType]}</strong>{transaction.targetLabel ? ` · ${transaction.targetLabel}` : ''}{transaction.reconciliationKey ? ` · 묶음 ${transaction.reconciliationKey}` : ''}</p>
                    </article>
                  ))}
                  {booking.transactions.length === 0 ? <div className="px-4 py-10 text-center text-sm text-slate-500">연결된 Clobe 거래가 없습니다. 오예약이면 제외하고, 정상 예약이면 메모·매칭을 먼저 확인해주세요.</div> : null}
                </div>
              </section>

              {notice ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{notice}</div> : null}

              <section className="rounded-xl border border-slate-200 p-4">
                <h4 className="text-sm font-semibold text-slate-900">처리 결정</h4>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <button type="button" onClick={() => openDecision('confirmed')} className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-700 px-3 py-2.5 text-xs font-semibold text-white"><CheckCircle2 className="h-4 w-4" /> 정산 확인</button>
                  <button type="button" onClick={() => openDecision('customer_cancelled')} className="inline-flex items-center justify-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs font-semibold text-amber-900"><Receipt className="h-4 w-4" /> 고객 취소·환불</button>
                  <button type="button" onClick={() => openDecision('invalid_booking')} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2.5 text-xs font-semibold text-slate-800"><XCircle className="h-4 w-4" /> 오예약·중복 제외</button>
                  <button type="button" onClick={() => openDecision('reclassified')} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2.5 text-xs font-semibold text-slate-800"><Unlink className="h-4 w-4" /> 예약 아님</button>
                  <button type="button" onClick={() => openDecision('deferred')} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2.5 text-xs font-semibold text-slate-800"><Clock className="h-4 w-4" /> 보류</button>
                  <Link href={`/admin/bookings/${booking.id}`} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2.5 text-xs font-semibold text-slate-800">예약 원문 보기 <ChevronRight className="h-4 w-4" /></Link>
                </div>
              </section>
            </>
          ) : null}
        </div>
      </aside>

      {decision && booking ? <Dialog title={BOOKING_REVIEW_LABELS[decision]} description={`${booking.bookingNo} · ${booking.customerName || '-'}의 정산 처리 결과를 저장합니다.`} onClose={() => setDecision(null)}><div className="space-y-4 p-5">
        <div className="rounded-lg bg-slate-50 p-3 text-sm"><strong>입금 {won(booking.deposits)} - 여행출금 {won(booking.travelWithdrawals)} - 환불 {won(booking.customerRefunds)} = {won(booking.cashMargin)}</strong>{booking.bankFees > 0 ? <span className="mt-1 block text-xs text-slate-600">은행 수수료 {won(booking.bankFees)}는 회사 비용으로 별도 반영됩니다.</span> : null}</div>
        {decision === 'reclassified' ? <label className="block text-sm font-semibold text-slate-800">예약이 아닌 실제 용도<select value={reclassTarget} onChange={event => setReclassTarget(event.target.value as typeof reclassTarget)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"><option value="company_travel">회사 출장경비</option><option value="owner_draw">대표자 개인사용</option></select></label> : null}
        {decision === 'deferred' ? <><label className="block text-sm font-semibold text-slate-800">담당자<input value={assignedTo} onChange={event => setAssignedTo(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label><label className="block text-sm font-semibold text-slate-800">처리기한<input type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label></> : null}
        {decision !== 'confirmed' ? <label className="block text-sm font-semibold text-slate-800">처리 사유<textarea rows={3} value={reason} onChange={event => setReason(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" placeholder="확인 근거를 남겨주세요" /></label> : null}
        {decision === 'customer_cancelled' ? <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">입금액과 출금액 차이가 1만원 이내인 단일 환불 건은 고객 환불과 은행 수수료로 자동 분리합니다. 그 외에는 먼저 거래 분할에서 금액을 확인합니다.</p> : null}
        <div className="flex justify-end gap-2 border-t border-slate-200 pt-4"><button type="button" onClick={() => setDecision(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold">취소</button><button type="button" onClick={submitDecision} disabled={busy || (decision !== 'confirmed' && !reason.trim()) || (decision === 'deferred' && (!assignedTo.trim() || !dueDate))} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy ? '처리 중' : '결정 저장'}</button></div>
      </div></Dialog> : null}

      {splitTransactionId ? <BreakdownDialog transactionId={splitTransactionId} bookingChoices={bookingChoices} defaultBookingId={bookingId} onClose={() => setSplitTransactionId(null)} onSaved={refresh} /> : null}
    </div>
  );
}

export default function FinanceBookingsTable({ initialMonth = '', initialQuery = '' }: { initialMonth?: string; initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [month, setMonth] = useState(/^\d{4}-\d{2}$/.test(initialMonth) ? initialMonth : '');
  const [status, setStatus] = useState<BookingSettlementReviewStatus | 'all'>('pending');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showExcluded, setShowExcluded] = useState(false);
  const deferredQuery = useDeferredValue(query.trim());
  const params = new URLSearchParams();
  if (month) params.set('month', month);
  if (status !== 'all') params.set('status', status);
  if (deferredQuery) params.set('q', deferredQuery);
  if (showExcluded) params.set('includeExcluded', 'true');
  const url = `/api/admin/finance/bookings?${params.toString()}`;
  const { data, error, isLoading, isValidating, mutate } = useSWR<BookingResponse>(url, fetcher, { revalidateOnFocus: false });
  const { data: choicesData } = useSWR<BookingResponse>('/api/admin/finance/bookings?status=all', fetcher, { revalidateOnFocus: false });
  const rows = data?.rows ?? [];
  const selectedIndex = selectedId ? rows.findIndex(row => row.id === selectedId) : -1;
  const nextPendingId = selectedIndex >= 0
    ? rows.slice(selectedIndex + 1).find(row => row.reviewStatus === 'pending')?.id
      ?? rows.slice(0, selectedIndex).find(row => row.reviewStatus === 'pending')?.id
      ?? null
    : rows.find(row => row.reviewStatus === 'pending')?.id ?? null;

  const refresh = async () => { await mutate(); };

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><h2 className="flex items-center gap-2 text-lg font-semibold text-admin-text"><Wallet className="h-5 w-5 text-emerald-700" />예약별 정산</h2><p className="mt-1 text-xs text-admin-muted">Clobe 거래를 직접 확인한 예약만 월 확정수익에 포함됩니다.</p></div>
        <div className="flex gap-2"><Link href="/admin/payments/reconcile" className="rounded-lg border border-admin-border-strong bg-white px-3 py-2 text-xs font-semibold">원장 정합성</Link><button type="button" onClick={() => mutate()} disabled={isValidating} className="rounded-lg border border-admin-border-strong bg-white px-3 py-2 text-xs font-semibold disabled:opacity-50">{isValidating ? '갱신 중' : '최신 거래 갱신'}</button></div>
      </div>

      <div className="grid gap-2 rounded-admin-md border border-admin-border-mid bg-admin-surface p-3 sm:grid-cols-[1fr_auto_auto_auto]">
        <label className="relative"><span className="sr-only">예약 검색</span><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-admin-muted" /><input value={query} onChange={event => startTransition(() => setQuery(event.target.value))} placeholder="예약번호, 고객명, 여행키, Clobe 메모" className="w-full rounded-lg border border-admin-border-strong py-2 pl-9 pr-3 text-sm" /></label>
        <input type="month" value={month} onChange={event => setMonth(event.target.value)} aria-label="출발 월" className="rounded-lg border border-admin-border-strong px-3 py-2 text-sm" />
        <select value={status} onChange={event => setStatus(event.target.value as typeof status)} aria-label="검토 상태" className="rounded-lg border border-admin-border-strong px-3 py-2 text-sm">{FILTERS.map(filter => <option key={filter.value} value={filter.value}>{filter.label}</option>)}</select>
        <label className="inline-flex items-center gap-2 rounded-lg border border-admin-border-strong px-3 py-2 text-xs font-semibold"><input type="checkbox" checked={showExcluded} onChange={event => setShowExcluded(event.target.checked)} /> 제외건 포함</label>
      </div>

      {data ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><div className="rounded-xl border border-slate-200 p-3"><span className="text-xs text-slate-500">조회 예약</span><strong className="mt-1 block text-lg">{data.summary.total ?? 0}건</strong></div><div className="rounded-xl border border-amber-200 bg-amber-50 p-3"><span className="text-xs text-amber-800">재검토 필요</span><strong className="mt-1 block text-lg text-amber-950">{data.summary.pending ?? 0}건</strong></div><div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3"><span className="text-xs text-emerald-800">검토완료 마진</span><strong className="mt-1 block text-lg text-emerald-950">{won(data.summary.cashMargin ?? 0)}</strong></div><div className="rounded-xl border border-slate-200 p-3"><span className="text-xs text-slate-500">보류</span><strong className="mt-1 block text-lg">{data.summary.deferred ?? 0}건</strong></div></div> : null}

      {error ? <div role="alert" className="rounded-admin-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error.message}</div> : null}
      {isLoading ? <div className="h-80 animate-pulse rounded-admin-md bg-admin-surface-2" /> : null}
      {!isLoading && !error ? <div className="rounded-admin-md border border-admin-border-mid bg-admin-surface shadow-admin-xs">
        <div className="grid gap-3 p-3 lg:hidden">{rows.map(row => <article key={row.id} className="rounded-xl border border-admin-border-mid bg-white p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><span className="text-xs text-admin-muted">{row.departureDate || '출발일 없음'} · {row.bookingNo}</span><h3 className="mt-1 font-semibold text-admin-text">{row.customerName || '고객명 없음'}</h3><p className="mt-1 break-all text-xs text-admin-muted">{row.travelKey || row.packageTitle || '여행키 없음'} · 거래 {row.transactionCount}건</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold ${row.reviewStatus === 'confirmed' ? 'bg-emerald-50 text-emerald-700' : row.reviewStatus === 'pending' ? 'bg-amber-50 text-amber-900' : 'bg-slate-100 text-slate-700'}`}>{BOOKING_REVIEW_LABELS[row.reviewStatus]}</span></div><dl className="mt-4 grid grid-cols-3 gap-2 text-right text-xs"><div><dt className="text-admin-muted">입금</dt><dd className="mt-1 font-semibold tabular-nums">{won(row.deposits)}</dd></div><div><dt className="text-admin-muted">총 출금·환불</dt><dd className="mt-1 font-semibold tabular-nums">{won(row.travelWithdrawals + row.customerRefunds)}</dd></div><div><dt className="text-admin-muted">현금 마진</dt><dd className={`mt-1 font-bold tabular-nums ${row.cashMargin < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{won(row.cashMargin)}</dd></div></dl><button type="button" onClick={() => setSelectedId(row.id)} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-3 py-2.5 text-xs font-semibold text-white">상세 검토 <ChevronRight className="h-4 w-4" /></button></article>)}{rows.length === 0 ? <div className="py-12 text-center text-sm text-admin-muted"><BadgeDollarSign className="mx-auto mb-2 h-6 w-6" />조건에 맞는 예약이 없습니다.</div> : null}</div>
        <div className="hidden overflow-x-auto lg:block"><table className="min-w-full text-sm"><thead className="bg-admin-bg text-left text-xs text-admin-muted"><tr><th className="px-4 py-3">출발일·예약</th><th className="px-4 py-3">고객·여행키</th><th className="px-4 py-3 text-right">입금</th><th className="px-4 py-3 text-right">여행 출금</th><th className="px-4 py-3 text-right">환불·수수료</th><th className="px-4 py-3 text-right">현금 마진</th><th className="px-4 py-3">검토 상태</th><th className="px-4 py-3">작업</th></tr></thead><tbody className="divide-y divide-admin-border">{rows.map(row => <tr key={row.id} className="hover:bg-admin-bg/70"><td className="whitespace-nowrap px-4 py-3"><span className="block text-xs text-admin-muted">{row.departureDate || '출발일 없음'}</span><strong>{row.bookingNo}</strong></td><td className="max-w-xs px-4 py-3"><span className="block font-medium">{row.customerName || '고객명 없음'}</span><span className="block truncate text-xs text-admin-muted">{row.travelKey || row.packageTitle || '여행키 없음'} · 거래 {row.transactionCount}건</span></td><td className="px-4 py-3 text-right tabular-nums">{won(row.deposits)}</td><td className="px-4 py-3 text-right tabular-nums">{won(row.travelWithdrawals)}</td><td className="px-4 py-3 text-right text-xs tabular-nums">환불 {won(row.customerRefunds)}<span className="block text-admin-muted">수수료 {won(row.bankFees)}</span></td><td className={`px-4 py-3 text-right font-bold tabular-nums ${row.cashMargin < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{won(row.cashMargin)}</td><td className="px-4 py-3"><span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ${row.reviewStatus === 'confirmed' ? 'bg-emerald-50 text-emerald-700' : row.reviewStatus === 'pending' ? 'bg-amber-50 text-amber-900' : 'bg-slate-100 text-slate-700'}`}>{row.reviewStatus === 'confirmed' ? <CheckCircle2 className="h-3 w-3" /> : row.reviewStatus === 'pending' ? <AlertTriangle className="h-3 w-3" /> : null}{BOOKING_REVIEW_LABELS[row.reviewStatus]}</span>{row.reviewedBy ? <span className="mt-1 block text-[10px] text-admin-muted">{row.reviewedBy}</span> : null}</td><td className="px-4 py-3"><button type="button" onClick={() => setSelectedId(row.id)} className="inline-flex items-center gap-1 rounded-lg border border-admin-border-strong bg-white px-3 py-2 text-xs font-semibold">상세 검토 <ChevronRight className="h-4 w-4" /></button></td></tr>)}{rows.length === 0 ? <tr><td colSpan={8} className="px-4 py-14 text-center text-sm text-admin-muted"><BadgeDollarSign className="mx-auto mb-2 h-6 w-6" />조건에 맞는 예약이 없습니다.</td></tr> : null}</tbody></table></div>
      </div> : null}

      {selectedId ? <BookingDrawer bookingId={selectedId} bookingChoices={choicesData?.rows ?? rows} nextBookingId={nextPendingId === selectedId ? null : nextPendingId} onSelectBooking={setSelectedId} onClose={() => setSelectedId(null)} onChanged={refresh} /> : null}
    </section>
  );
}
