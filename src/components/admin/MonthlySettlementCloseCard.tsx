'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { AlertTriangle, Calendar, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';

import {
  previousCompletedKoreaMonth,
  type MonthlyCloseReviewReason,
  type MonthlySettlementClosePreview,
} from '@/lib/monthly-settlement-close';

interface PreviewResponse {
  preview: MonthlySettlementClosePreview;
  error?: string;
}

interface CloseResponse extends PreviewResponse {
  result?: {
    requested: number;
    confirmed: number;
    confirmedProfit?: number;
    auditRecorded: boolean;
  };
}

const reasonLabels: Record<MonthlyCloseReviewReason, string> = {
  no_bank_evidence: '연결된 통장 내역 없음',
  allocation_drift: '거래 배분 금액 불일치',
  zero_cash_margin: '입금과 출금이 같음',
  negative_cash_margin: '출금이 입금보다 큼',
};

function formatWon(value: number): string {
  return `${Math.round(value).toLocaleString('ko-KR')}원`;
}

function formatMonth(month: string): string {
  const [year, value] = month.split('-');
  return `${year}년 ${Number(value)}월`;
}

async function fetchPreview(url: string): Promise<PreviewResponse> {
  const response = await fetch(url, { cache: 'no-store' });
  const data = await response.json().catch(() => ({})) as PreviewResponse;
  if (!response.ok) throw new Error(data.error || '월 마감 대상을 불러오지 못했습니다.');
  return data;
}

export default function MonthlySettlementCloseCard({ onClosed }: { onClosed: () => void }) {
  const previousMonth = previousCompletedKoreaMonth();
  const [month, setMonth] = useState(previousMonth);
  const [confirming, setConfirming] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const { data, error, isLoading, isValidating, mutate } = useSWR<PreviewResponse>(
    `/api/payments/monthly-settlement-close?month=${month}`,
    fetchPreview,
  );
  const preview = data?.preview;
  const summary = preview?.summary;

  const confirmClose = async () => {
    if (!preview || preview.eligible.length === 0 || confirming) return;
    setConfirming(true);
    setNotice(null);
    try {
      const response = await fetch('/api/payments/monthly-settlement-close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          month,
          expectedBookingIds: preview.eligible.map(row => row.bookingId),
          expectedCandidateFingerprint: preview.candidateFingerprint,
        }),
      });
      const payload = await response.json().catch(() => ({})) as CloseResponse;
      if (!response.ok) {
        if (payload.preview) await mutate({ preview: payload.preview }, false);
        throw new Error(payload.error || '월 정산확정에 실패했습니다.');
      }

      if (payload.preview) await mutate({ preview: payload.preview }, false);
      setNotice({
        ok: true,
        text: `${formatMonth(month)}까지 ${payload.result?.confirmed ?? 0}건, ${formatWon(payload.result?.confirmedProfit ?? 0)} 정산확정 완료`,
      });
      setShowConfirm(false);
      onClosed();
    } catch (closeError) {
      setNotice({
        ok: false,
        text: closeError instanceof Error ? closeError.message : '월 정산확정에 실패했습니다.',
      });
    } finally {
      setConfirming(false);
    }
  };

  return (
    <>
    <section className="rounded-admin-md border border-admin-border-mid bg-admin-surface shadow-admin-xs p-5" aria-labelledby="monthly-close-title">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-emerald-700" />
            <h2 id="monthly-close-title" className="text-admin-lg font-semibold text-admin-text-2">출발 월 정산 마감</h2>
          </div>
          <p className="mt-1.5 text-xs leading-5 text-admin-muted">
            선택한 달까지 출발한 예약 중 Clobe 통장 입출금이 모두 연결되고, <strong className="text-admin-text-2">입금 - 출금이 양수인 예약만</strong> 현금기준으로 확정합니다.
            총 여행대금이나 예정 원가가 비어 있어도 실제 통장수익은 확정할 수 있습니다.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="text-xs font-medium text-admin-muted">
            출발 월까지
            <input
              type="month"
              value={month}
              max={previousMonth}
              onChange={event => {
                setMonth(event.target.value);
                setNotice(null);
              }}
              className="mt-1 block rounded-lg border border-admin-border-strong bg-white px-3 py-2 text-admin-base text-admin-text-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </label>
          <button
            type="button"
            onClick={() => mutate()}
            disabled={isLoading || isValidating || confirming}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-admin-border-strong bg-white px-3 text-xs font-medium text-admin-text-2 hover:bg-admin-bg disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isValidating ? 'animate-spin' : ''}`} /> 다시 계산
          </button>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          {error.message}
        </div>
      ) : isLoading || !summary ? (
        <div className="mt-4 flex h-24 items-center justify-center gap-2 text-xs text-admin-muted" role="status">
          <Loader2 className="h-4 w-4 animate-spin" /> 정산 마감 대상을 계산하고 있습니다.
        </div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-admin-sm bg-emerald-50 px-4 py-3">
              <p className="text-[11px] text-emerald-700">이번에 확정할 예약</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-emerald-900">{summary.eligibleCount}건</p>
            </div>
            <div className="rounded-admin-sm bg-emerald-50 px-4 py-3">
              <p className="text-[11px] text-emerald-700">추가 확정 여행수익</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-emerald-900">{formatWon(summary.eligibleProfit)}</p>
            </div>
            <div className="rounded-admin-sm bg-admin-bg px-4 py-3">
              <p className="text-[11px] text-admin-muted">이미 정산확정</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-admin-text-2">{summary.alreadyConfirmedCount}건</p>
            </div>
            <div className={`rounded-admin-sm px-4 py-3 ${summary.reviewCount > 0 ? 'bg-amber-50' : 'bg-admin-bg'}`}>
              <p className={`text-[11px] ${summary.reviewCount > 0 ? 'text-amber-700' : 'text-admin-muted'}`}>확정에서 제외·검토</p>
              <p className={`mt-1 text-xl font-bold tabular-nums ${summary.reviewCount > 0 ? 'text-amber-900' : 'text-admin-text-2'}`}>{summary.reviewCount}건</p>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-3 rounded-admin-sm border border-admin-border-mid bg-admin-bg/70 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="text-xs text-admin-muted">
              <p>
                확정 계산: 입금 <strong className="text-admin-text-2">{formatWon(summary.eligibleDeposits)}</strong>
                {' - '}출금 <strong className="text-admin-text-2">{formatWon(summary.eligibleWithdrawals)}</strong>
                {' = '}수익 <strong className="text-emerald-700">{formatWon(summary.eligibleProfit)}</strong>
              </p>
              <p className="mt-1">확정 후 원본 통장내역과 예약별 입출금 연결은 그대로 보존됩니다.</p>
            </div>
            <button
              type="button"
              onClick={() => setShowConfirm(true)}
              disabled={confirming || summary.eligibleCount === 0}
              className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 text-admin-base font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-admin-surface-2 disabled:text-admin-muted"
            >
              {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {summary.eligibleCount > 0
                ? `${formatMonth(month)}까지 ${summary.eligibleCount}건 정산확정`
                : '추가 확정할 예약 없음'}
            </button>
          </div>

          {notice ? (
            <div className={`mt-3 rounded-lg border px-4 py-3 text-xs ${notice.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
              {notice.text}
            </div>
          ) : null}

          {preview.review.length > 0 ? (
            <details className="mt-4 rounded-admin-sm border border-amber-200 bg-amber-50/60 px-4 py-3">
              <summary className="cursor-pointer list-none text-xs font-semibold text-amber-900">
                <span className="inline-flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4" /> 검토 후 별도 처리할 {preview.review.length}건 보기
                </span>
              </summary>
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="border-b border-amber-200 text-left text-amber-800">
                      <th className="py-2 pr-4 font-medium">출발일</th>
                      <th className="py-2 pr-4 font-medium">예약</th>
                      <th className="py-2 pr-4 font-medium">입금</th>
                      <th className="py-2 pr-4 font-medium">출금</th>
                      <th className="py-2 pr-4 font-medium">차액</th>
                      <th className="py-2 font-medium">제외 이유</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.review.map(row => (
                      <tr key={row.bookingId} className="border-b border-amber-100 last:border-0">
                        <td className="py-2 pr-4 whitespace-nowrap text-admin-muted">{row.departureDate}</td>
                        <td className="py-2 pr-4 font-medium text-admin-text-2">{row.bookingNo}</td>
                        <td className="py-2 pr-4 tabular-nums text-admin-text-2">{formatWon(row.deposits)}</td>
                        <td className="py-2 pr-4 tabular-nums text-admin-text-2">{formatWon(row.withdrawals)}</td>
                        <td className={`py-2 pr-4 tabular-nums font-semibold ${row.cashNet < 0 ? 'text-red-600' : 'text-admin-text-2'}`}>{formatWon(row.cashNet)}</td>
                        <td className="py-2 whitespace-nowrap text-amber-800">{row.reason ? reasonLabels[row.reason] : '확인 필요'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}
        </>
      )}
    </section>
    {showConfirm && preview ? (
      <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
        <button type="button" className="absolute inset-0 bg-slate-950/40" onClick={() => setShowConfirm(false)} aria-label="월 마감 확인 닫기" />
        <section role="dialog" aria-modal="true" aria-labelledby="legacy-close-dialog-title" className="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
          <h3 id="legacy-close-dialog-title" className="text-lg font-semibold text-slate-950">{formatMonth(month)} 현금기준 정산 확정</h3>
          <p className="mt-1 text-xs text-slate-600">Clobe 입금 - 출금 기준으로 확정하며, 검토 항목은 확정하지 않습니다.</p>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-slate-50 p-3"><span className="text-xs text-slate-500">확정 예약</span><strong className="block text-lg">{summary?.eligibleCount ?? 0}건</strong></div>
            <div className="rounded-lg bg-emerald-50 p-3"><span className="text-xs text-emerald-700">확정 여행수익</span><strong className="block text-lg text-emerald-900">{formatWon(summary?.eligibleProfit ?? 0)}</strong></div>
            <div className="rounded-lg bg-slate-50 p-3"><span className="text-xs text-slate-500">입금</span><strong className="block">{formatWon(summary?.eligibleDeposits ?? 0)}</strong></div>
            <div className="rounded-lg bg-slate-50 p-3"><span className="text-xs text-slate-500">출금</span><strong className="block">{formatWon(summary?.eligibleWithdrawals ?? 0)}</strong></div>
          </div>
          {(summary?.reviewCount ?? 0) > 0 ? <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">검토 {summary?.reviewCount}건은 제외됩니다. 새 정산센터의 월 마감 탭에서 조건부 마감할 수 있습니다.</p> : null}
          <div className="mt-5 flex justify-end gap-2 border-t border-slate-200 pt-4">
            <button type="button" onClick={() => setShowConfirm(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold">취소</button>
            <button type="button" onClick={confirmClose} disabled={confirming} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{confirming ? '확정 중' : '정산 확정'}</button>
          </div>
        </section>
      </div>
    ) : null}
    </>
  );
}
