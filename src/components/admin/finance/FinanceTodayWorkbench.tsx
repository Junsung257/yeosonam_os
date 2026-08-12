'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import {
  AlertTriangle,
  ArrowRight,
  BadgeDollarSign,
  Banknote,
  Building2,
  Calendar,
  Check,
  ClipboardCheck,
  ListChecks,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from 'lucide-react';

import { financeCountBucket, trackFinanceEvent } from '@/lib/finance-analytics';
import type { FinanceWorkday, FinanceWorkdayTaskKind } from '@/lib/finance-workday';
import { formatSettlementTimestamp } from '@/lib/settlement-date-format';

async function fetcher(url: string): Promise<{ workday: FinanceWorkday }> {
  const response = await fetch(url, { cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || '오늘 정산 작업을 불러오지 못했습니다.');
  return payload;
}

function won(value: number): string {
  return `${Math.round(value).toLocaleString('ko-KR')}원`;
}

const ICONS: Record<FinanceWorkdayTaskKind, typeof Banknote> = {
  sync: RefreshCw,
  travel_review: ListChecks,
  booking_risk: AlertTriangle,
  booking_review: BadgeDollarSign,
  company_classification: Building2,
  month_close: Calendar,
  evidence: ClipboardCheck,
};

export default function FinanceTodayWorkbench() {
  const [taxRatePercent, setTaxRatePercent] = useState(10);
  const { data, error, isLoading, isValidating, mutate } = useSWR(
    `/api/admin/finance/workday?taxRate=${taxRatePercent / 100}`,
    fetcher,
    { revalidateOnFocus: false },
  );
  const workday = data?.workday;
  const currentTask = workday?.nextTask ?? null;

  useEffect(() => {
    if (!workday) return;
    trackFinanceEvent('finance_workday_opened', {
      count_bucket: financeCountBucket(workday.openItems),
      viewport: window.innerWidth < 640 ? 'mobile' : 'desktop',
    });
  }, [workday]);

  useEffect(() => {
    if (!error) return;
    trackFinanceEvent('finance_error_shown', { error_code: 'workday_load_failed', source: 'finance_home' });
  }, [error]);

  if (error) {
    return (
      <section role="alert" className="rounded-admin-md border border-red-200 bg-red-50 p-5 text-sm text-red-900">
        <strong>마지막 정상 수치를 0원으로 바꾸지 않았습니다.</strong>
        <p className="mt-1">{error.message}</p>
        <button type="button" onClick={() => mutate()} className="mt-3 rounded-lg bg-red-700 px-3 py-2 text-xs font-semibold text-white">다시 불러오기</button>
      </section>
    );
  }
  if (isLoading || !workday) {
    return <div className="h-[34rem] animate-pulse rounded-admin-md bg-admin-surface-2" role="status" aria-label="오늘 정산 작업 불러오는 중" />;
  }

  const metrics = [
    { label: '실제 통장 잔액', value: workday.metrics.actualBankBalance, hint: 'Clobe 신한 4128', icon: Banknote, tone: 'border-slate-200 bg-white' },
    { label: '여행 보호금', value: workday.metrics.protectedTravelCash, hint: '출발 전 고객 돈·미지급 원가', icon: ShieldCheck, tone: 'border-amber-200 bg-amber-50/70' },
    { label: '지금 써도 되는 돈', value: workday.metrics.safeToWithdraw, hint: workday.metrics.calculationStatus === 'clear' ? '보호금·세금·경비 차감' : '검토 완료 전 보수적으로 0원', icon: Wallet, tone: workday.metrics.calculationStatus === 'clear' ? 'border-emerald-200 bg-emerald-50/70' : 'border-red-200 bg-red-50/70' },
  ];

  return (
    <div className="space-y-4">
      <section className={`rounded-admin-md border px-4 py-3 ${workday.sync.healthy ? 'border-emerald-200 bg-emerald-50/70' : 'border-amber-300 bg-amber-50'}`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-700">
            <strong className={workday.sync.healthy ? 'text-emerald-800' : 'text-amber-950'}>Clobe {workday.sync.healthy ? '정상' : '확인 필요'}</strong>
            <span>최근 {workday.sync.lastSyncAt ? formatSettlementTimestamp(workday.sync.lastSyncAt) : '기록 없음'}</span>
            <span>원장 {workday.sync.ledgerCount}건</span>
            <span>통장 {won(workday.sync.bankBalance)}</span>
            <strong className={workday.sync.difference === 0 ? 'text-emerald-800' : 'text-red-700'}>차이 {won(workday.sync.difference)}</strong>
          </div>
          <div className="flex items-end gap-2">
            <label className="text-[10px] font-semibold text-slate-600">예상 세금률
              <span className="mt-0.5 flex items-center rounded-lg border border-slate-300 bg-white px-2"><input type="number" min={0} max={100} value={taxRatePercent} onChange={event => setTaxRatePercent(Math.max(0, Math.min(100, Number(event.target.value) || 0)))} className="w-10 py-1.5 text-right text-xs font-semibold outline-none" aria-label="예상 세금 적립률" />%</span>
            </label>
            <button type="button" onClick={() => mutate()} disabled={isValidating} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${isValidating ? 'animate-spin' : ''}`} /> 새로고침</button>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3" aria-label="오늘 정산 핵심 금액">
        {metrics.map(metric => {
          const Icon = metric.icon;
          return <article key={metric.label} className={`rounded-admin-md border p-4 shadow-admin-xs ${metric.tone}`}><div className="flex items-center justify-between text-xs font-semibold text-slate-600"><span>{metric.label}</span><Icon className="h-4 w-4" /></div><strong className="mt-3 block text-xl font-bold tabular-nums text-slate-950">{won(metric.value)}</strong><span className="mt-1 block text-[11px] text-slate-600">{metric.hint}</span></article>;
        })}
      </section>

      <section className="overflow-hidden rounded-admin-lg border border-slate-200 bg-white shadow-admin-xs">
        <header className="border-b border-slate-200 bg-[linear-gradient(120deg,#f4f8f6_0%,#ffffff_72%)] px-4 py-4 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div><p className="text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-700">Guided close</p><h2 className="mt-1 text-xl font-bold text-slate-950">오늘 정산하기</h2><p className="mt-1 text-xs text-slate-600">위에서 아래 순서대로 확인하면 예약 정산부터 월 마감까지 이어집니다.</p></div>
            <div className="min-w-48"><div className="flex justify-between text-xs font-semibold text-slate-700"><span>{workday.completedSteps}/{workday.totalSteps}단계 완료</span><span>남은 작업 {workday.openItems}건</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width: `${(workday.completedSteps / workday.totalSteps) * 100}%` }} /></div></div>
          </div>
        </header>

        <div className="grid lg:grid-cols-[22rem_1fr]">
          <ol className="border-b border-slate-200 lg:border-b-0 lg:border-r">
            {workday.tasks.map((item, index) => {
              const Icon = ICONS[item.kind];
              const selected = currentTask?.kind === item.kind;
              return <li key={item.kind} className={`flex gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0 ${selected ? 'bg-emerald-50/70' : ''}`}><span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${item.status === 'done' ? 'bg-emerald-100 text-emerald-800' : item.status === 'blocked' ? 'bg-slate-100 text-slate-500' : 'bg-slate-950 text-white'}`}>{item.status === 'done' ? <Check className="h-4 w-4" /> : index + 1}</span><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><Icon className="h-4 w-4 text-slate-600" /><strong className="truncate text-sm text-slate-900">{item.label}</strong><span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold ${item.count > 0 ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-800'}`}>{item.count}건</span></div><p className="mt-1 line-clamp-2 text-[11px] leading-5 text-slate-600">{item.description}</p></div></li>;
            })}
          </ol>

          <div className="flex min-h-80 flex-col justify-between p-5 sm:p-7">
            {currentTask ? <>
              <div>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${currentTask.status === 'blocked' ? 'bg-slate-100 text-slate-700' : 'bg-amber-100 text-amber-900'}`}>{currentTask.status === 'blocked' ? '앞 단계 완료 필요' : '지금 할 일'} · {currentTask.count}건</span>
                <h3 className="mt-4 text-2xl font-bold tracking-tight text-slate-950">{currentTask.label}</h3>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{currentTask.description}</p>
                {currentTask.status === 'blocked' ? <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950">정산값을 안전하게 지키기 위해 앞 단계의 오류나 미검토 건을 먼저 처리합니다. 버튼을 누르면 원인이 있는 화면으로 바로 이동합니다.</p> : null}
                {workday.metrics.blockers.length > 0 ? <details className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3"><summary className="cursor-pointer text-xs font-semibold text-slate-800">사용가능액 계산 차단 근거 {workday.metrics.blockers.length}건</summary><p className="mt-2 text-xs leading-5 text-slate-600">{workday.metrics.blockers.join(' · ')}</p></details> : null}
              </div>
              <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                <Link href="/admin/finance?tab=home&view=overview" className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700">전체 현황 보기</Link>
                <Link href={currentTask.href} onClick={() => trackFinanceEvent('finance_task_opened', { task_type: currentTask.kind, count_bucket: financeCountBucket(currentTask.count) })} className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-slate-800">{currentTask.actionLabel}<ArrowRight className="h-4 w-4" /></Link>
              </div>
            </> : <div className="m-auto max-w-md text-center"><span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-800"><Check className="h-6 w-6" /></span><h3 className="mt-4 text-xl font-bold text-slate-950">오늘 정산 작업을 모두 마쳤습니다</h3><p className="mt-2 text-sm leading-6 text-slate-600">새 Clobe 거래가 들어오면 이 화면에 우선순위대로 다시 표시됩니다.</p><Link href="/admin/finance?tab=home&view=overview" className="mt-5 inline-flex rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold">전체 현황 보기</Link></div>}
          </div>
        </div>
      </section>
    </div>
  );
}
