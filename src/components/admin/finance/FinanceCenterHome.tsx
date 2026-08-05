'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Building2,
  Coins,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from 'lucide-react';

import type { FinanceCenterSummary } from '@/lib/finance-center-service';
import { formatSettlementTimestamp } from '@/lib/settlement-date-format';

async function fetcher(url: string): Promise<{ summary: FinanceCenterSummary }> {
  const response = await fetch(url, { cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || '정산 요약을 불러오지 못했습니다.');
  return payload;
}

function won(value: number): string {
  return `${Math.round(value).toLocaleString('ko-KR')}원`;
}

function compactWon(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}억`;
  if (absolute >= 10_000) return `${(value / 10_000).toFixed(1)}만`;
  return won(value);
}

const ACTIONS: Array<{
  key: keyof FinanceCenterSummary['actions'];
  label: string;
  detail: string;
  href: string;
}> = [
  { key: 'travelMemoOrAllocation', label: '여행 메모·배분 오류', detail: '메모 또는 거래 배분 확인', href: '/admin/finance?tab=review' },
  { key: 'unmatchedTravel', label: '미매칭 여행거래', detail: '예약 연결 필요', href: '/admin/finance?tab=review' },
  { key: 'negativeMargin', label: '출금 초과 예약', detail: '잔금 미수·오송금 확인', href: '/admin/finance?tab=bookings' },
  { key: 'unclassifiedCompany', label: '회사경비 미분류', detail: '손익 분류 확정', href: '/admin/finance?tab=expenses' },
  { key: 'monthCloseWaiting', label: '월마감 대기', detail: '출발 월 잠금 필요', href: '/admin/finance?tab=periods' },
  { key: 'postCloseChanges', label: '마감 후 변경', detail: '확정 스냅샷과 차이', href: '/admin/finance?tab=periods' },
];

export default function FinanceCenterHome() {
  const [taxRatePercent, setTaxRatePercent] = useState(10);
  const { data, error, isLoading, isValidating, mutate } = useSWR(`/api/admin/finance/summary?taxRate=${taxRatePercent / 100}`, fetcher, {
    revalidateOnFocus: false,
  });
  const summary = data?.summary;

  if (error) {
    return (
      <section className="rounded-admin-md border border-red-200 bg-red-50 p-5 text-sm text-red-800" role="alert">
        <p className="font-semibold">마지막 정상 수치를 대신 0원으로 표시하지 않았습니다.</p>
        <p className="mt-1">{error.message}</p>
        <button type="button" onClick={() => mutate()} className="mt-3 rounded-lg bg-red-700 px-3 py-2 text-xs font-semibold text-white">다시 불러오기</button>
      </section>
    );
  }
  if (isLoading || !summary) {
    return <div className="h-72 animate-pulse rounded-admin-md bg-admin-surface-2" role="status" aria-label="정산 수치 계산 중" />;
  }

  const metrics = [
    { label: '실제 통장 잔액', value: summary.metrics.actualBankBalance, icon: Banknote, hint: 'Clobe 최종 잔액', href: '/admin/finance?tab=review', tone: 'neutral' },
    { label: '여행 보호금', value: summary.metrics.protectedTravelCash, icon: ShieldCheck, hint: `고객 돈 ${compactWon(summary.metrics.protectedCustomerFunds)} + 미지급 원가 ${compactWon(summary.metrics.unpaidSupplierCost)}`, href: '/admin/finance?tab=bookings', tone: 'warning' },
    { label: '세금 남은 적립금', value: summary.metrics.estimatedTaxReserve, icon: Coins, hint: `예상 ${compactWon(summary.metrics.estimatedTaxLiability)} · 납부 ${compactWon(summary.metrics.actualTaxPayments)}`, href: '/admin/finance?tab=tax', tone: 'warning' },
    { label: '회사 운영손익', value: summary.metrics.companyOperatingResult, icon: Building2, hint: '확정 여행수익 + 영업수입 - 회사경비', href: '/admin/finance?tab=expenses', tone: summary.metrics.companyOperatingResult >= 0 ? 'positive' : 'negative' },
    { label: '지금 써도 되는 돈', value: summary.metrics.safeToWithdraw, icon: Wallet, hint: summary.metrics.calculationStatus === 'clear' ? '보호금·세금 차감 후' : '검토 완료 전 출금 차단', href: '/admin/finance?tab=expenses', tone: summary.metrics.calculationStatus === 'clear' ? 'positive' : 'negative' },
  ] as const;

  const maxMonthly = Math.max(1, ...summary.monthly.map(point => Math.abs(point.afterTaxTravelProfit)));

  return (
    <div className="space-y-5">
      <section className={`flex flex-col gap-3 rounded-admin-md border px-4 py-3 text-xs sm:flex-row sm:items-center sm:justify-between ${summary.status.difference === 0 ? 'border-emerald-200 bg-emerald-50/70' : 'border-red-200 bg-red-50'}`}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="font-semibold text-admin-text-2">Clobe {summary.status.connected ? '연결됨' : '연결 확인 필요'}</span>
          <span>최근 동기화 {summary.status.lastSyncAt ? formatSettlementTimestamp(summary.status.lastSyncAt) : '기록 없음'}</span>
          <span>원본 {summary.status.sourceCount}건</span>
          <span>OS 인식 {summary.status.recognizedCount}건</span>
          <span>통장 {won(summary.status.bankBalance)}</span>
          <span>OS {won(summary.status.osBalance)}</span>
          <strong className={summary.status.difference === 0 ? 'text-emerald-800' : 'text-red-700'}>차이 {won(summary.status.difference)}</strong>
        </div>
        <div className="flex items-end gap-2 self-start sm:self-auto">
          <label className="text-[10px] font-semibold text-admin-muted">예상 세금률
            <span className="mt-0.5 flex items-center rounded-lg border border-current/20 bg-white/70 px-2"><input type="number" min={0} max={100} step={1} value={taxRatePercent} onChange={event => setTaxRatePercent(Math.max(0, Math.min(100, Number(event.target.value) || 0)))} className="w-10 bg-transparent py-1.5 text-right text-xs font-semibold outline-none" aria-label="예상 세금 적립률" />%</span>
          </label>
          <button type="button" onClick={() => mutate()} disabled={isValidating} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-current/20 bg-white/70 px-2.5 font-semibold disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${isValidating ? 'animate-spin' : ''}`} /> 갱신
          </button>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="사장님 핵심 정산 수치">
        {metrics.map(metric => {
          const Icon = metric.icon;
          const toneClass = metric.tone === 'positive'
            ? 'border-emerald-200 bg-emerald-50/50'
            : metric.tone === 'negative'
              ? 'border-red-200 bg-red-50/60'
              : metric.tone === 'warning'
                ? 'border-amber-200 bg-amber-50/40'
                : 'border-admin-border-mid bg-admin-surface';
          return (
            <Link key={metric.label} href={metric.href} className={`group rounded-admin-md border p-4 shadow-admin-xs transition hover:-translate-y-0.5 hover:shadow-admin-sm ${toneClass}`}>
              <div className="flex items-center justify-between text-xs font-semibold text-admin-muted">
                <span>{metric.label}</span><Icon className="h-4 w-4" />
              </div>
              <p className="mt-3 text-xl font-bold tabular-nums text-admin-text">{compactWon(metric.value)}</p>
              <p className="mt-1 flex items-center justify-between text-[11px] text-admin-muted"><span>{metric.hint}</span><ArrowRight className="h-3 w-3 opacity-0 transition group-hover:opacity-100" /></p>
            </Link>
          );
        })}
      </section>

      {summary.metrics.blockers.length > 0 ? (
        <section className="rounded-admin-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <div className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" /> 지금 써도 되는 돈 계산이 보수적으로 차단됐습니다.</div>
          <p className="mt-1">{summary.metrics.blockers.join(' · ')}</p>
        </section>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <section className="rounded-admin-md border border-admin-border-mid bg-admin-surface p-5 shadow-admin-xs">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-admin-text">세후 확정 여행수익 추이</h2>
              <p className="mt-1 text-xs text-admin-muted">출발 월 기준, 확정된 예약만 표시</p>
            </div>
            <div className="text-right text-xs text-admin-muted">
              <span className="block">누적 확정수익</span>
              <strong className="text-sm text-emerald-700">{won(summary.metrics.confirmedTravelProfit)}</strong>
            </div>
          </div>
          <div className="mt-5 flex h-44 items-end gap-2 border-b border-admin-border px-1" aria-label="월별 세후 확정 여행수익 막대 그래프">
            {summary.monthly.map(point => {
              const positive = point.afterTaxTravelProfit >= 0;
              const height = Math.max(3, Math.round((Math.abs(point.afterTaxTravelProfit) / maxMonthly) * 100));
              return (
                <div key={point.month} className="group flex h-full min-w-0 flex-1 flex-col justify-end" title={`${point.month}: ${won(point.afterTaxTravelProfit)}`}>
                  <div className={`mx-auto w-full max-w-9 rounded-t-sm transition-opacity group-hover:opacity-75 ${positive ? 'bg-emerald-600' : 'bg-red-500'}`} style={{ height: `${height}%` }} />
                  <span className="mt-2 truncate text-center text-[9px] text-admin-muted">{point.month.slice(5)}월</span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-admin-md border border-admin-border-mid bg-admin-surface shadow-admin-xs">
          <header className="border-b border-admin-border px-5 py-4">
            <h2 className="text-base font-semibold text-admin-text">오늘 할 일</h2>
            <p className="mt-1 text-xs text-admin-muted">수치에 영향을 주는 예외만 표시합니다.</p>
          </header>
          <div className="divide-y divide-admin-border">
            {ACTIONS.map(action => {
              const count = summary.actions[action.key];
              return (
                <Link key={action.key} href={action.href} className="flex items-center gap-3 px-5 py-3 hover:bg-admin-bg">
                  <span className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${count > 0 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>{count}</span>
                  <span className="min-w-0 flex-1"><strong className="block text-sm text-admin-text-2">{action.label}</strong><span className="text-xs text-admin-muted">{action.detail}</span></span>
                  <ArrowRight className="h-4 w-4 text-admin-muted" />
                </Link>
              );
            })}
          </div>
        </section>
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-admin-md border border-admin-border-mid bg-slate-950 p-4 text-white"><Banknote className="h-5 w-5 text-emerald-300" /><p className="mt-3 text-xs text-slate-400">여행 실현수익</p><p className="mt-1 text-lg font-bold">{won(summary.metrics.confirmedTravelProfit)}</p></div>
        <div className="rounded-admin-md border border-admin-border-mid bg-admin-surface p-4"><Coins className="h-5 w-5 text-amber-600" /><p className="mt-3 text-xs text-admin-muted">세금 차감 후 확정수익</p><p className="mt-1 text-lg font-bold text-admin-text">{won(summary.metrics.afterTaxConfirmedProfit)}</p></div>
        <div className="rounded-admin-md border border-admin-border-mid bg-admin-surface p-4"><Wallet className="h-5 w-5 text-emerald-700" /><p className="mt-3 text-xs text-admin-muted">보호금·경비까지 차감한 사용가능액</p><p className="mt-1 text-lg font-bold text-admin-text">{won(summary.metrics.safeToWithdraw)}</p></div>
      </section>
    </div>
  );
}
