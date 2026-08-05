'use client';

import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { AlertTriangle, Calendar, CheckCircle2, RefreshCw, RotateCcw, ShieldCheck, X } from 'lucide-react';

import {
  previousCompletedKoreaMonth,
  type MonthlyCloseReviewReason,
  type MonthlySettlementClosePreview,
} from '@/lib/monthly-settlement-close';

interface PeriodRow {
  id: string;
  departure_month: string;
  revision: number;
  status: 'open' | 'conditional' | 'closed' | 'reopened' | 'superseded';
  is_current: boolean;
  confirmed_booking_count: number;
  confirmed_deposits: number;
  confirmed_withdrawals: number;
  confirmed_cash_margin: number;
  exception_count: number;
  closed_at: string | null;
  closed_by_label: string | null;
  reopen_reason: string | null;
}

interface PeriodResponse {
  preview: MonthlySettlementClosePreview | null;
  periods: PeriodRow[];
  exceptions: Array<{ id: string; departure_month: string; exception_type: string; assigned_to: string | null; reason: string | null; due_date: string | null }>;
  error?: string;
}

const EXCEPTION_LABELS: Record<string, string> = {
  negative_margin: '출금 초과',
  no_bank_evidence: '통장 근거 없음',
  allocation_drift: '거래 배분 불일치',
  zero_margin: '현금 마진 0원',
  post_close_change: '마감 후 변경',
  unclassified_company_transaction: '회사 거래 미분류',
  missing_receipt: '증빙 없음',
};

const REASON_LABELS: Record<MonthlyCloseReviewReason, string> = {
  no_bank_evidence: '통장 근거 없음',
  allocation_drift: '거래 배분 불일치',
  zero_cash_margin: '입금과 출금 동일',
  negative_cash_margin: '출금이 입금보다 큼',
};

async function fetcher(url: string): Promise<PeriodResponse> {
  const response = await fetch(url, { cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || '월 마감 정보를 불러오지 못했습니다.');
  return payload;
}

function won(value: number): string {
  return `${Math.round(value).toLocaleString('ko-KR')}원`;
}

function monthLabel(month: string): string {
  const [year, value] = month.split('-');
  return `${year}년 ${Number(value)}월`;
}

function Dialog({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-slate-950/40" onClick={onClose} aria-label="대화상자 닫기" />
      <section role="dialog" aria-modal="true" aria-labelledby="finance-dialog-title" aria-describedby="finance-dialog-description" className="relative max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div><h3 id="finance-dialog-title" className="text-lg font-semibold text-slate-950">{title}</h3><p id="finance-dialog-description" className="mt-1 text-xs leading-5 text-slate-600">{description}</p></div>
          <button ref={closeRef} type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="닫기"><X className="h-4 w-4" /></button>
        </header>
        {children}
      </section>
    </div>
  );
}

export default function FinancePeriods() {
  const [month, setMonth] = useState(previousCompletedKoreaMonth());
  const [showClose, setShowClose] = useState(false);
  const [showReopen, setShowReopen] = useState(false);
  const [closeStatus, setCloseStatus] = useState<'closed' | 'conditional'>('closed');
  const [exceptionOwner, setExceptionOwner] = useState('재무 담당자');
  const [exceptionReason, setExceptionReason] = useState('월 마감 후 후속 확인');
  const [exceptionDueDate, setExceptionDueDate] = useState(() => {
    const date = new Date(Date.now() + 7 * 24 * 60 * 60_000);
    return date.toISOString().slice(0, 10);
  });
  const [reopenReason, setReopenReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const { data, error, isLoading, isValidating, mutate } = useSWR(`/api/admin/finance/periods?month=${month}`, fetcher, { revalidateOnFocus: false });
  const preview = data?.preview;
  const summary = preview?.summary;
  const currentPeriod = data?.periods.find(period => period.is_current && String(period.departure_month).slice(0, 7) === month);
  const isLocked = currentPeriod?.status === 'closed' || currentPeriod?.status === 'conditional';

  const openCloseDialog = () => {
    setCloseStatus((summary?.reviewCount ?? 0) > 0 ? 'conditional' : 'closed');
    setNotice(null);
    setShowClose(true);
  };

  const closePeriod = async () => {
    if (!preview || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch('/api/admin/finance/periods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'close',
          month,
          closeStatus,
          expectedFingerprint: preview.candidateFingerprint,
          expectedBookingIds: preview.eligible.map(row => row.bookingId),
          exceptionOwner,
          exceptionReason,
          exceptionDueDate,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (payload.preview) await mutate({ ...(data as PeriodResponse), preview: payload.preview }, false);
        throw new Error(payload.error || '월 마감을 확정하지 못했습니다.');
      }
      setShowClose(false);
      setNotice({ ok: true, text: `${monthLabel(month)} ${payload.closed.bookingCount}건, 현금 마진 ${won(payload.closed.cashMargin)} 마감 완료` });
      await mutate();
    } catch (closeError) {
      setNotice({ ok: false, text: closeError instanceof Error ? closeError.message : '월 마감을 확정하지 못했습니다.' });
    } finally {
      setBusy(false);
    }
  };

  const reopenPeriod = async () => {
    if (!reopenReason.trim() || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch('/api/admin/finance/periods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reopen', month, reason: reopenReason }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || '월 마감을 재개방하지 못했습니다.');
      setShowReopen(false);
      setReopenReason('');
      setNotice({ ok: true, text: `${monthLabel(month)} 마감을 재개방했습니다. 재확정하면 새 버전으로 보관됩니다.` });
      await mutate();
    } catch (reopenError) {
      setNotice({ ok: false, text: reopenError instanceof Error ? reopenError.message : '월 마감을 재개방하지 못했습니다.' });
    } finally {
      setBusy(false);
    }
  };

  const completeException = async (exceptionId: string, status: 'resolved' | 'waived') => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch('/api/admin/finance/periods', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_exception', exceptionId, status }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || '정산 예외를 처리하지 못했습니다.');
      setNotice({ ok: true, text: status === 'resolved' ? '예외를 처리 완료했습니다.' : '사유 있는 예외로 승인했습니다.' });
      await mutate();
    } catch (exceptionError) {
      setNotice({ ok: false, text: exceptionError instanceof Error ? exceptionError.message : '정산 예외를 처리하지 못했습니다.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><h2 className="flex items-center gap-2 text-lg font-semibold text-admin-text"><Calendar className="h-5 w-5 text-emerald-700" />출발 월 마감</h2><p className="mt-1 text-xs text-admin-muted">선택한 출발 월만 잠그며, 이전 달 누락은 별도 영역에서 보정합니다.</p></div>
        <div className="flex items-end gap-2">
          <label className="text-xs font-medium text-admin-muted">출발 월<input type="month" value={month} max={previousCompletedKoreaMonth()} onChange={event => { setMonth(event.target.value); setNotice(null); }} className="mt-1 block rounded-lg border border-admin-border-strong bg-white px-3 py-2 text-sm text-admin-text-2" /></label>
          <button type="button" onClick={() => mutate()} disabled={isLoading || isValidating} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-admin-border-strong bg-white px-3 text-xs font-semibold disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${isValidating ? 'animate-spin' : ''}`} /> 다시 계산</button>
        </div>
      </div>

      {error ? <div className="rounded-admin-md border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">{error.message}</div> : null}
      {notice ? <div className={`rounded-admin-md border p-4 text-sm ${notice.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`} role="status">{notice.text}</div> : null}
      {isLoading || !summary ? <div className="h-64 animate-pulse rounded-admin-md bg-admin-surface-2" role="status" aria-label="월 마감 계산 중" /> : (
        <>
          <div className={`flex flex-col gap-3 rounded-admin-md border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${isLocked ? 'border-emerald-200 bg-emerald-50' : currentPeriod?.status === 'reopened' ? 'border-amber-200 bg-amber-50' : 'border-admin-border-mid bg-admin-surface'}`}>
            <div className="flex items-center gap-3">{isLocked ? <ShieldCheck className="h-5 w-5 text-emerald-700" /> : <Calendar className="h-5 w-5 text-admin-muted" />}<div><strong className="block text-sm text-admin-text-2">{monthLabel(month)} {isLocked ? `마감 잠김 · v${currentPeriod?.revision}` : currentPeriod?.status === 'reopened' ? '재개방됨' : '마감 전'}</strong><span className="text-xs text-admin-muted">{isLocked ? `${currentPeriod?.confirmed_booking_count}건 · ${won(currentPeriod?.confirmed_cash_margin ?? 0)}` : '최신 Clobe 거래 기준으로 마감할 수 있습니다.'}</span></div></div>
            {isLocked ? <button type="button" onClick={() => setShowReopen(true)} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-800"><RotateCcw className="h-3.5 w-3.5" /> 최고 관리자 재개방</button> : <button type="button" onClick={openCloseDialog} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2.5 text-xs font-semibold text-white hover:bg-emerald-800"><CheckCircle2 className="h-4 w-4" /> 월 마감 확인</button>}
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <div className="rounded-admin-md border border-admin-border-mid bg-admin-surface p-4"><p className="text-xs text-admin-muted">마감 대상</p><p className="mt-1 text-xl font-bold">{summary.eligibleCount}건</p></div>
            <div className="rounded-admin-md border border-admin-border-mid bg-admin-surface p-4"><p className="text-xs text-admin-muted">고객 입금</p><p className="mt-1 text-xl font-bold">{won(summary.eligibleDeposits)}</p></div>
            <div className="rounded-admin-md border border-admin-border-mid bg-admin-surface p-4"><p className="text-xs text-admin-muted">랜드사 출금</p><p className="mt-1 text-xl font-bold">{won(summary.eligibleWithdrawals)}</p></div>
            <div className="rounded-admin-md border border-emerald-200 bg-emerald-50 p-4"><p className="text-xs text-emerald-700">확정 현금 마진</p><p className="mt-1 text-xl font-bold text-emerald-900">{won(summary.eligibleProfit)}</p></div>
            <div className={`rounded-admin-md border p-4 ${summary.reviewCount > 0 ? 'border-amber-200 bg-amber-50' : 'border-admin-border-mid bg-admin-surface'}`}><p className="text-xs text-admin-muted">조건부 예외</p><p className="mt-1 text-xl font-bold">{summary.reviewCount}건</p></div>
          </div>

          {preview?.review.length ? <details className="rounded-admin-md border border-amber-200 bg-amber-50/50 p-4"><summary className="cursor-pointer text-sm font-semibold text-amber-900"><span className="inline-flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> 이번 달 예외 {preview.review.length}건</span></summary><div className="mt-3 overflow-x-auto"><table className="min-w-full text-xs"><thead><tr className="border-b border-amber-200 text-left text-amber-800"><th className="py-2 pr-4">예약</th><th className="py-2 pr-4">입금</th><th className="py-2 pr-4">출금</th><th className="py-2 pr-4">차액</th><th className="py-2">이유</th></tr></thead><tbody>{preview.review.map(row => <tr key={row.bookingId} className="border-b border-amber-100 last:border-0"><td className="py-2 pr-4 font-semibold">{row.bookingNo}</td><td className="py-2 pr-4">{won(row.deposits)}</td><td className="py-2 pr-4">{won(row.withdrawals)}</td><td className={`py-2 pr-4 font-semibold ${row.cashNet < 0 ? 'text-red-700' : ''}`}>{won(row.cashNet)}</td><td className="py-2">{row.reason ? REASON_LABELS[row.reason] : '확인 필요'}</td></tr>)}</tbody></table></div></details> : null}

          {preview?.priorOmissions.length ? <details className="rounded-admin-md border border-slate-200 bg-slate-50 p-4"><summary className="cursor-pointer text-sm font-semibold text-slate-800">과거 누락 {preview.priorOmissions.length}건 · 이번 달 마감에는 포함되지 않음</summary><div className="mt-3 grid gap-2 sm:grid-cols-2">{preview.priorOmissions.map(row => <div key={row.bookingId} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"><strong>{row.departureDate} · {row.bookingNo}</strong><span className="mt-1 block text-slate-600">입금 {won(row.deposits)} - 출금 {won(row.withdrawals)} = {won(row.cashNet)}</span></div>)}</div></details> : null}
        </>
      )}

      {(data?.exceptions.length ?? 0) > 0 ? (
        <section className="overflow-hidden rounded-admin-md border border-amber-200 bg-white">
          <header className="border-b border-amber-200 bg-amber-50 px-4 py-3"><h3 className="flex items-center gap-2 text-sm font-semibold text-amber-950"><AlertTriangle className="h-4 w-4" /> 열려 있는 정산 예외 {data?.exceptions.length}건</h3><p className="mt-1 text-xs text-amber-800">마감 수치는 유지하고, 근거 확인 후 처리 완료 또는 사유 있는 예외로 승인합니다.</p></header>
          <div className="divide-y divide-admin-border">
            {data?.exceptions.map(item => (
              <div key={item.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1"><strong className="block text-sm text-admin-text-2">{String(item.departure_month).slice(0, 7)} · {EXCEPTION_LABELS[item.exception_type] || item.exception_type}</strong><span className="mt-0.5 block text-xs text-admin-muted">담당 {item.assigned_to || '미지정'} · 기한 {item.due_date || '미지정'}{item.reason ? ` · ${item.reason}` : ''}</span></div>
                <div className="flex gap-2"><button type="button" onClick={() => completeException(item.id, 'resolved')} disabled={busy} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">처리 완료</button><button type="button" onClick={() => completeException(item.id, 'waived')} disabled={busy} className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-800 disabled:opacity-50">예외 승인</button></div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="overflow-hidden rounded-admin-md border border-admin-border-mid bg-admin-surface"><header className="border-b border-admin-border px-4 py-3"><h3 className="text-sm font-semibold text-admin-text">월 마감 이력</h3></header><div className="overflow-x-auto"><table className="min-w-full text-xs"><thead className="bg-admin-bg text-left text-admin-muted"><tr><th className="px-4 py-2">출발 월</th><th className="px-4 py-2">버전·상태</th><th className="px-4 py-2 text-right">예약</th><th className="px-4 py-2 text-right">입금</th><th className="px-4 py-2 text-right">출금</th><th className="px-4 py-2 text-right">마진</th><th className="px-4 py-2">확정자</th></tr></thead><tbody className="divide-y divide-admin-border">{(data?.periods ?? []).map(period => <tr key={period.id} className={period.is_current ? '' : 'text-admin-muted opacity-70'}><td className="px-4 py-2 font-semibold">{String(period.departure_month).slice(0, 7)}</td><td className="px-4 py-2">v{period.revision} · {period.status}</td><td className="px-4 py-2 text-right">{period.confirmed_booking_count}</td><td className="px-4 py-2 text-right">{won(period.confirmed_deposits)}</td><td className="px-4 py-2 text-right">{won(period.confirmed_withdrawals)}</td><td className="px-4 py-2 text-right font-semibold">{won(period.confirmed_cash_margin)}</td><td className="px-4 py-2">{period.closed_by_label || '-'}</td></tr>)}{!data?.periods.length ? <tr><td colSpan={7} className="px-4 py-10 text-center text-admin-muted">마감 이력이 없습니다.</td></tr> : null}</tbody></table></div></section>

      {showClose && preview ? <Dialog title={`${monthLabel(month)} 월 마감`} description="아래 금액과 예외를 확인한 뒤 확정합니다. 확정 후에는 최고 관리자 재개방 전까지 잠깁니다." onClose={() => setShowClose(false)}><div className="space-y-4 p-5"><div className="grid grid-cols-2 gap-3 text-sm"><div className="rounded-lg bg-slate-50 p-3"><span className="text-xs text-slate-500">예약</span><strong className="block text-lg">{summary?.eligibleCount ?? 0}건</strong></div><div className="rounded-lg bg-emerald-50 p-3"><span className="text-xs text-emerald-700">현금 마진</span><strong className="block text-lg text-emerald-900">{won(summary?.eligibleProfit ?? 0)}</strong></div><div className="rounded-lg bg-slate-50 p-3"><span className="text-xs text-slate-500">입금</span><strong className="block">{won(summary?.eligibleDeposits ?? 0)}</strong></div><div className="rounded-lg bg-slate-50 p-3"><span className="text-xs text-slate-500">출금</span><strong className="block">{won(summary?.eligibleWithdrawals ?? 0)}</strong></div></div>{(summary?.reviewCount ?? 0) > 0 ? <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4"><p className="text-sm font-semibold text-amber-900">예외 {summary?.reviewCount}건이 남아 조건부 마감만 가능합니다.</p><input value={exceptionOwner} onChange={event => setExceptionOwner(event.target.value)} aria-label="예외 담당자" placeholder="담당자" className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm" /><input value={exceptionReason} onChange={event => setExceptionReason(event.target.value)} aria-label="조건부 마감 사유" placeholder="사유" className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm" /><label className="block text-xs text-amber-800">처리기한<input type="date" value={exceptionDueDate} onChange={event => setExceptionDueDate(event.target.value)} className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-slate-900" /></label></div> : null}<div className="flex justify-end gap-2 border-t border-slate-200 pt-4"><button type="button" onClick={() => setShowClose(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold">취소</button><button type="button" onClick={closePeriod} disabled={busy} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? '확정 중' : (summary?.reviewCount ?? 0) > 0 ? '조건부 마감 확정' : '월 마감 확정'}</button></div></div></Dialog> : null}

      {showReopen ? <Dialog title={`${monthLabel(month)} 마감 재개방`} description="기존 스냅샷은 보존됩니다. 다음 마감은 새 버전으로 생성되며, 모든 변경이 감사 기록에 남습니다." onClose={() => setShowReopen(false)}><div className="space-y-4 p-5"><label className="block text-sm font-semibold text-slate-800">재개방 사유<textarea value={reopenReason} onChange={event => setReopenReason(event.target.value)} rows={3} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" placeholder="왜 확정 월을 다시 열어야 하는지 입력" /></label><div className="flex justify-end gap-2 border-t border-slate-200 pt-4"><button type="button" onClick={() => setShowReopen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold">취소</button><button type="button" onClick={reopenPeriod} disabled={busy || !reopenReason.trim()} className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? '재개방 중' : '재개방'}</button></div></div></Dialog> : null}
    </section>
  );
}
