'use client';

import { startTransition, useDeferredValue, useState } from 'react';
import useSWR from 'swr';
import { AlertTriangle, CheckCircle2, Search } from 'lucide-react';

import type { FinanceClassification } from '@/lib/finance-classification';

interface ClassificationRow {
  id: string;
  transactionId: string;
  allocationId: string | null;
  transaction_type: string;
  amount: number;
  received_at: string;
  counterparty_name: string | null;
  memo: string | null;
  targetLabel: string | null;
  clobeOriginalClassification: string | null;
  osClassification: FinanceClassification | null;
  resolvedClassification: FinanceClassification;
  resolutionSource: 'manual' | 'os_rule' | 'clobe' | 'review';
  receiptStatus: 'not_required' | 'missing' | 'attached' | 'verified';
}

interface ClassificationResponse {
  rows: ClassificationRow[];
  summary: { transactionTotal: number; itemTotal: number; review: number; resolved: number; manual: number; missingReceipt: number };
  error?: string;
}

const LABELS: Record<FinanceClassification, string> = {
  company_expense: '회사 일반경비',
  company_travel: '회사 출장경비',
  tax: '세금',
  capital: '자본금·차입금',
  transfer: '계좌 이체',
  refund: '환불·취소',
  owner_draw: '대표자 인출',
  other_income: '기타 영업수입',
  review: '검토 필요',
};

const OPTIONS = Object.entries(LABELS) as Array<[FinanceClassification, string]>;

async function fetcher(url: string): Promise<ClassificationResponse> {
  const response = await fetch(url, { cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || '회사 거래를 불러오지 못했습니다.');
  return payload;
}

function won(value: number): string {
  return `${Math.round(value).toLocaleString('ko-KR')}원`;
}

export default function FinanceClassifications() {
  const { data, error, isLoading, mutate } = useSWR('/api/admin/finance/classifications', fetcher, { revalidateOnFocus: false });
  const [filter, setFilter] = useState<'review' | 'all'>('review');
  const [query, setQuery] = useState('');
  const [drafts, setDrafts] = useState<Record<string, FinanceClassification>>({});
  const [receiptDrafts, setReceiptDrafts] = useState<Record<string, ClassificationRow['receiptStatus']>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  const rows = (data?.rows ?? []).filter(row => {
    if (filter === 'review' && row.resolvedClassification !== 'review') return false;
    if (!deferredQuery) return true;
    return [row.counterparty_name, row.memo, row.targetLabel, row.clobeOriginalClassification]
      .filter(Boolean)
      .some(value => String(value).toLowerCase().includes(deferredQuery));
  });

  const save = async (row: ClassificationRow) => {
    const classification = drafts[row.id] ?? row.resolvedClassification;
    if (classification === 'review') {
      setNotice('검토 필요가 아닌 최종 분류를 선택해주세요.');
      return;
    }
    const requiresReceipt = classification === 'company_expense' || classification === 'company_travel' || classification === 'tax';
    const receiptStatus = receiptDrafts[row.id]
      ?? (requiresReceipt && row.receiptStatus === 'not_required' ? 'missing' : row.receiptStatus);
    setSavingId(row.id);
    setNotice(null);
    try {
      const response = await fetch('/api/admin/finance/classifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: row.transactionId, allocationId: row.allocationId, classification, receiptStatus }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || '분류를 저장하지 못했습니다.');
      startTransition(() => {
        setDrafts(current => {
          const next = { ...current };
          delete next[row.id];
          return next;
        });
        setReceiptDrafts(current => {
          const next = { ...current };
          delete next[row.id];
          return next;
        });
        setNotice(`${row.counterparty_name || '회사 거래'}를 ${LABELS[classification]}로 확정했습니다.`);
      });
      await mutate();
    } catch (saveError) {
      setNotice(saveError instanceof Error ? saveError.message : '분류를 저장하지 못했습니다.');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-admin-text">회사 경비·비여행 거래</h2>
        <p className="mt-1 text-xs text-admin-muted">Clobe 원본 분류는 보존하고, OS 확정 분류만 별도로 저장합니다. 자본금·이체·대표자 인출은 손익에서 제외됩니다.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-admin-md border border-admin-border-mid bg-admin-surface p-4"><p className="text-xs text-admin-muted">Clobe 원본 거래</p><p className="mt-1 text-xl font-bold text-admin-text">{data?.summary.transactionTotal ?? '...' }건</p><p className="mt-1 text-[10px] text-admin-muted">분류 항목 {data?.summary.itemTotal ?? '...'}건</p></div>
        <div className="rounded-admin-md border border-amber-200 bg-amber-50 p-4"><p className="text-xs text-amber-700">미분류</p><p className="mt-1 text-xl font-bold text-amber-900">{data?.summary.review ?? '...' }건</p></div>
        <div className="rounded-admin-md border border-emerald-200 bg-emerald-50 p-4"><p className="text-xs text-emerald-700">분류 완료</p><p className="mt-1 text-xl font-bold text-emerald-900">{data?.summary.resolved ?? '...' }건</p></div>
        <div className="rounded-admin-md border border-admin-border-mid bg-admin-surface p-4"><p className="text-xs text-admin-muted">증빙 필요</p><p className="mt-1 text-xl font-bold text-admin-text">{data?.summary.missingReceipt ?? '...' }건</p></div>
      </div>

      <div className="flex flex-col gap-2 rounded-admin-md border border-admin-border-mid bg-admin-surface p-3 sm:flex-row">
        <div className="flex rounded-lg bg-admin-bg p-1">
          <button type="button" onClick={() => setFilter('review')} aria-pressed={filter === 'review'} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${filter === 'review' ? 'bg-white text-admin-text shadow-sm' : 'text-admin-muted'}`}>미분류</button>
          <button type="button" onClick={() => setFilter('all')} aria-pressed={filter === 'all'} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${filter === 'all' ? 'bg-white text-admin-text shadow-sm' : 'text-admin-muted'}`}>전체</button>
        </div>
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">회사 거래 검색</span><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-admin-muted" />
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="거래처, 메모, Clobe 분류" className="w-full rounded-lg border border-admin-border-strong py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
        </label>
      </div>

      {notice ? <div className="rounded-lg border border-admin-border-mid bg-admin-bg px-4 py-3 text-xs text-admin-text-2" role="status">{notice}</div> : null}
      {error ? <div className="rounded-admin-md border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">{error.message}</div> : null}
      {isLoading ? <div className="h-72 animate-pulse rounded-admin-md bg-admin-surface-2" role="status" aria-label="회사 거래 불러오는 중" /> : null}
      {!isLoading && !error ? (
        <div className="overflow-hidden rounded-admin-md border border-admin-border-mid bg-admin-surface shadow-admin-xs">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-admin-bg text-left text-xs text-admin-muted"><tr><th className="px-4 py-3 font-medium">일시·거래처</th><th className="px-4 py-3 font-medium">Clobe 원본</th><th className="px-4 py-3 font-medium">OS 확정 분류</th><th className="px-4 py-3 text-right font-medium">금액</th><th className="px-4 py-3 font-medium">상태·작업</th></tr></thead>
              <tbody className="divide-y divide-admin-border">
                {rows.map(row => {
                  const selected = drafts[row.id] ?? row.resolvedClassification;
                  const requiresReceipt = selected === 'company_expense' || selected === 'company_travel' || selected === 'tax';
                  const receiptStatus = receiptDrafts[row.id]
                    ?? (requiresReceipt && row.receiptStatus === 'not_required' ? 'missing' : row.receiptStatus);
                  return (
                    <tr key={row.id} className="align-top hover:bg-admin-bg/60">
                      <td className="max-w-sm px-4 py-3"><span className="block text-xs text-admin-muted">{new Date(row.received_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</span><strong className="block text-admin-text-2">{row.counterparty_name || '거래처 없음'}</strong><span className="mt-1 block break-all text-xs leading-5 text-admin-muted"><span className="font-semibold text-admin-text-2">Clobe 메모:</span> {row.memo || '메모 없음'}</span>{row.targetLabel ? <span className="mt-1 block break-all text-xs font-medium leading-5 text-sky-700">분할 용도: {row.targetLabel}</span> : null}</td>
                      <td className="px-4 py-3 text-xs text-admin-muted">{row.clobeOriginalClassification || '미분류'}</td>
                      <td className="px-4 py-3"><select value={selected} onChange={event => setDrafts(current => ({ ...current, [row.id]: event.target.value as FinanceClassification }))} aria-label={`${row.counterparty_name || '거래'} OS 분류`} className="rounded-lg border border-admin-border-strong bg-white px-2.5 py-2 text-xs"><option value="review">검토 필요</option>{OPTIONS.filter(([value]) => value !== 'review').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td>
                      <td className={`whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums ${row.transaction_type === '출금' ? 'text-red-700' : 'text-emerald-700'}`}>{row.transaction_type === '출금' ? '-' : '+'}{won(row.amount)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col items-start gap-2">
                          <div className="flex items-center gap-2"><span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ${row.resolutionSource === 'review' ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700'}`}>{row.resolutionSource === 'review' ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}{row.resolutionSource === 'manual' ? '수동 확정' : row.resolutionSource === 'os_rule' ? 'OS 규칙' : row.resolutionSource === 'clobe' ? 'Clobe' : '검토'}</span><button type="button" onClick={() => save(row)} disabled={savingId === row.id || (selected === row.resolvedClassification && row.resolutionSource === 'manual' && receiptStatus === row.receiptStatus)} className="rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40">{savingId === row.id ? '저장 중' : '확정'}</button></div>
                          {requiresReceipt ? (
                            <select value={receiptStatus} onChange={event => setReceiptDrafts(current => ({ ...current, [row.id]: event.target.value as ClassificationRow['receiptStatus'] }))} aria-label={`${row.counterparty_name || '거래'} 증빙 상태`} className={`rounded-lg border px-2 py-1.5 text-[11px] ${receiptStatus === 'missing' ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-admin-border-strong bg-white text-admin-text-2'}`}>
                              <option value="missing">증빙 필요</option>
                              <option value="attached">증빙 첨부</option>
                              <option value="verified">증빙 확인</option>
                              <option value="not_required">증빙 불필요</option>
                            </select>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 ? <tr><td colSpan={5} className="px-4 py-14 text-center text-admin-muted">검토할 회사 거래가 없습니다.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
