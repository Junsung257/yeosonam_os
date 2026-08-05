'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import useSWR from 'swr';
import dynamic from 'next/dynamic';
import Link from 'next/link';

const BarChart = dynamic(() => import('recharts').then(m => ({ default: m.BarChart })), { ssr: false });
const Bar = dynamic(() => import('recharts').then(m => ({ default: m.Bar })), { ssr: false });
const XAxis = dynamic(() => import('recharts').then(m => ({ default: m.XAxis })), { ssr: false });
const YAxis = dynamic(() => import('recharts').then(m => ({ default: m.YAxis })), { ssr: false });
const CartesianGrid = dynamic(() => import('recharts').then(m => ({ default: m.CartesianGrid })), { ssr: false });
const Tooltip = dynamic(() => import('recharts').then(m => ({ default: m.Tooltip })), { ssr: false });
const ResponsiveContainer = dynamic(() => import('recharts').then(m => ({ default: m.ResponsiveContainer })), { ssr: false });
import {
  TrendingUp, TrendingDown, Trash2, RotateCcw,
  PlusCircle, AlertTriangle, Sparkles, X, CheckSquare, Square,
  RefreshCw, Banknote, ArrowDownCircle, ArrowUpCircle, ShieldCheck,
  FileText,
} from 'lucide-react';
import type { BankAccountRealitySummary } from '@/lib/bank-account-reality';
import { formatSettlementTimestamp } from '@/lib/settlement-date-format';
import MonthlySettlementCloseCard from '@/components/admin/MonthlySettlementCloseCard';

// ─── 타입 ────────────────────────────────────────────────────────────────────

interface BankTx {
  id:               string;
  transaction_type: '입금' | '출금';
  amount:           number;
  counterparty_name: string;
  memo:             string | null;
  received_at:      string;
  match_status:     string;
  is_fee:           boolean;
  is_refund:        boolean;
  status:           string;
  deleted_at:       string | null;
  source:           string | null;
  external_provider?: string | null;
  settlement_scope?: 'travel' | 'non_travel' | null;
  bookings?:        { booking_no: string; package_title: string } | null;
}

interface CapitalEntry {
  id:         string;
  amount:     number;
  note:       string | null;
  entry_date: string;
}

interface AnomalyItem {
  id:    string;
  label: string;
  kind:  'duplicate' | 'large' | 'tiny';
}

// ─── 포맷 유틸 ────────────────────────────────────────────────────────────────

function fmt(n: number) { return n.toLocaleString('ko-KR'); }
function fmtW(n: number) {
  if (Math.abs(n) >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억`;
  if (Math.abs(n) >= 10_000_000)  return `${(n / 10_000_000).toFixed(1)}천만`;
  if (Math.abs(n) >= 1_000_000)   return `${(n / 1_000_000).toFixed(1)}백만`;
  return `${fmt(n)}원`;
}
function fmtMonth(m: string) {
  const [y, mo] = m.split('-');
  return `${y.slice(2)}년 ${parseInt(mo)}월`;
}

// ─── AI 스마트 클리닝 ─────────────────────────────────────────────────────────

function detectAnomalies(txs: BankTx[]): AnomalyItem[] {
  const result: AnomalyItem[] = [];
  const seen = new Map<string, string>();

  for (const tx of txs) {
    // 1. 24시간 내 동일 거래처 + 금액 중복
    const key = `${tx.counterparty_name}_${tx.amount}_${tx.transaction_type}`;
    const prev = seen.get(key);
    if (prev) {
      const dt = Math.abs(new Date(tx.received_at).getTime() - new Date(prev).getTime());
      if (dt < 86_400_000) {
        result.push({ id: tx.id, label: `중복 의심: ${tx.counterparty_name} ${fmt(tx.amount)}원`, kind: 'duplicate' });
      }
    }
    seen.set(key, tx.received_at);

    // 2. 고액 거래 (1억 이상)
    if (tx.amount >= 100_000_000) {
      result.push({ id: tx.id, label: `고액 거래: ${tx.counterparty_name} ${fmtW(tx.amount)}`, kind: 'large' });
    }

    // 3. 비정상 소액 (100원 미만, 수수료 아닌 경우)
    if (tx.amount > 0 && tx.amount < 100 && !tx.is_fee) {
      result.push({ id: tx.id, label: `소액 의심: ${tx.counterparty_name} ${tx.amount}원`, kind: 'tiny' });
    }
  }
  return result;
}

// ─── 커스텀 Tooltip ───────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs px-4 py-3 text-xs space-y-1">
      <p className="font-semibold text-admin-text-2 mb-1">{fmtMonth(label)}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.name}: ₩{fmt(p.value)}
        </p>
      ))}
    </div>
  );
}

// ─── 메인 페이지 ─────────────────────────────────────────────────────────────

export default function LedgerPage() {
  type Tab = 'overview' | 'income' | 'expense' | 'trash';

  const [tab,        setTab]        = useState<Tab>('overview');
  // 감사(2026-05-11 Phase 5-A'): fetch waterfall 대신 SWR 키별 병렬 로드.
  // 페이지 재진입 시 dedup, mutation 후 mutate() 로 단일 무효화.
  const [txs,        setTxs]        = useState<BankTx[]>([]);
  const [trashTxs,   setTrashTxs]   = useState<BankTx[]>([]);
  const [capital,    setCapital]    = useState<{ entries: CapitalEntry[]; total: number }>({ entries: [], total: 0 });
  const [selected,   setSelected]   = useState<Set<string>>(new Set());
  const [undoInfo,   setUndoInfo]   = useState<{ ids: string[]; items: BankTx[]; countdown: number } | null>(null);
  const [anomalies,  setAnomalies]  = useState<AnomalyItem[]>([]);
  const [showAI,     setShowAI]     = useState(false);
  const [capitalForm, setCapitalForm] = useState({ amount: '', note: '', date: new Date().toISOString().slice(0, 10) });
  const [showCapForm, setShowCapForm] = useState(false);
  const [toast,      setToast]      = useState<{ msg: string; ok: boolean } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── 데이터 로드 (SWR) ──────────────────────────────────────────────────
  const { data: txData, isLoading: txLoading, mutate: mutateTxs } =
    useSWR<{ transactions: BankTx[] }>('/api/bank-transactions?status=active&scope=all&source=clobe_mcp');
  const { data: trashData, mutate: mutateTrash } =
    useSWR<{ transactions: BankTx[] }>('/api/bank-transactions?status=excluded');
  const { data: realityData, isLoading: realityLoading, mutate: mutateReality } =
    useSWR<{ summary: BankAccountRealitySummary }>('/api/bank-transactions/account-reality');
  const { data: capData, mutate: mutateCapital } =
    useSWR<{ entries: CapitalEntry[]; total: number }>('/api/capital');

  const loading = txLoading || realityLoading;

  useEffect(() => {
    if (txData?.transactions) setTxs(txData.transactions);
  }, [txData]);
  useEffect(() => {
    if (trashData?.transactions) setTrashTxs(trashData.transactions);
  }, [trashData]);
  useEffect(() => {
    if (capData) setCapital({ entries: capData.entries || [], total: capData.total || 0 });
  }, [capData]);

  // mutation 후 호출용 — 관련 키 일괄 무효화.
  const loadAll = useCallback(() => {
    mutateTxs();
    mutateTrash();
    mutateCapital();
    mutateReality();
  }, [mutateTxs, mutateTrash, mutateCapital, mutateReality]);

  // ── KPI 계산 ───────────────────────────────────────────────────────────
  const totalIncome  = realityData?.summary.totalDeposits
    ?? txs.filter(t => t.transaction_type === '입금').reduce((s, t) => s + t.amount, 0);
  const totalExpense = realityData?.summary.totalWithdrawals
    ?? txs.filter(t => t.transaction_type === '출금').reduce((s, t) => s + t.amount, 0);
  const actualBankBalance = realityData?.summary.actualBalance ?? totalIncome - totalExpense;
  const profitErp = realityData?.summary.profitErp;
  const profitChartData = profitErp?.monthly ?? [];
  const isAuthoritativeClobe = (tx: BankTx) => tx.source === 'clobe_mcp' || tx.external_provider === 'clobe';

  // ── 탭별 필터링 목록 ───────────────────────────────────────────────────
  const displayTxs = tab === 'income'
    ? txs.filter(t => t.transaction_type === '입금')
    : tab === 'expense'
    ? txs.filter(t => t.transaction_type === '출금')
    : txs;
  const selectableTxs = (tab === 'trash' ? trashTxs : displayTxs).filter(tx => !isAuthoritativeClobe(tx));

  // ── 선택 헬퍼 ─────────────────────────────────────────────────────────
  const toggleSelect = (id: string) => {
    const tx = (tab === 'trash' ? trashTxs : displayTxs).find(item => item.id === id);
    if (!tx || isAuthoritativeClobe(tx)) return;
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  };

  const toggleAll = () => {
    if (selected.size === selectableTxs.length) setSelected(new Set());
    else setSelected(new Set(selectableTxs.map(t => t.id)));
  };

  // ── 소프트 삭제 (5초 Undo) ─────────────────────────────────────────────
  const handleTrash = (ids: string[]) => {
    const mutableIds = ids.filter(id => {
      const tx = txs.find(item => item.id === id);
      return tx && !isAuthoritativeClobe(tx);
    });
    if (mutableIds.length === 0) return;
    const items = txs.filter(t => mutableIds.includes(t.id));

    // 낙관적 UI 업데이트
    setTxs(prev => prev.filter(t => !mutableIds.includes(t.id)));
    setSelected(new Set());

    // 기존 타이머 해제
    if (undoTimerRef.current) {
      clearInterval(undoTimerRef.current);
      // 이전 undo 항목도 실제로 trash 처리
      if (undoInfo) {
        fetch('/api/bank-transactions', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'trash_bulk', ids: undoInfo.ids }),
        });
      }
    }

    let countdown = 5;
    setUndoInfo({ ids: mutableIds, items, countdown });

    undoTimerRef.current = setInterval(() => {
      countdown -= 1;
      setUndoInfo(prev => prev ? { ...prev, countdown } : null);
      if (countdown <= 0) {
        clearInterval(undoTimerRef.current!);
        fetch('/api/bank-transactions', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'trash_bulk', ids: mutableIds }),
        }).then(() => {
          setTrashTxs(prev => [...items.map(i => ({ ...i, status: 'excluded' })), ...prev]);
        });
        setUndoInfo(null);
      }
    }, 1000);
  };

  const handleUndo = () => {
    if (!undoInfo) return;
    clearInterval(undoTimerRef.current!);
    setTxs(prev => [...undoInfo.items, ...prev].sort(
      (a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime(),
    ));
    setUndoInfo(null);
    showToast('휴지통 이동이 취소되었습니다.', true);
  };

  // ── 복원 ──────────────────────────────────────────────────────────────
  const handleRestore = async (ids: string[]) => {
    setTrashTxs(prev => prev.filter(t => !ids.includes(t.id)));
    const restored = trashTxs.filter(t => ids.includes(t.id)).map(t => ({ ...t, status: 'active' }));
    setTxs(prev => [...restored, ...prev].sort(
      (a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime(),
    ));

    await fetch('/api/bank-transactions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'restore_bulk', ids }),
    });
    showToast(`${ids.length}건 복원 완료`, true);
  };

  // ── 영구 삭제 ─────────────────────────────────────────────────────────
  const handleHardDelete = async (ids: string[]) => {
    if (!confirm(`${ids.length}건을 영구 삭제합니다. 복원 불가능합니다.`)) return;
    setTrashTxs(prev => prev.filter(t => !ids.includes(t.id)));
    await fetch('/api/bank-transactions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'hard_delete_bulk', ids }),
    });
    showToast(`${ids.length}건 영구 삭제됨`, false);
  };

  // ── 자본금 추가 ───────────────────────────────────────────────────────
  const handleAddCapital = async () => {
    const amount = parseInt(capitalForm.amount.replace(/,/g, ''), 10);
    if (!amount || amount <= 0) return;
    const res = await fetch('/api/capital', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, note: capitalForm.note, entry_date: capitalForm.date }),
    });
    const data = await res.json();
    if (data.entry) {
      setCapital(prev => ({ entries: [data.entry, ...prev.entries], total: prev.total + amount }));
      setCapitalForm({ amount: '', note: '', date: new Date().toISOString().slice(0, 10) });
      setShowCapForm(false);
      showToast('자본금 추가 완료', true);
    }
  };

  const handleRemoveCapital = async (id: string, amount: number) => {
    setCapital(prev => ({
      entries: prev.entries.filter(e => e.id !== id),
      total:   Math.max(0, prev.total - amount),
    }));
    await fetch('/api/capital', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
  };

  // ── AI 스마트 클리닝 ──────────────────────────────────────────────────
  const runAIScan = () => {
    setAnomalies(detectAnomalies(txs));
    setShowAI(true);
  };

  // ── Toast ─────────────────────────────────────────────────────────────
  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  // Bank timestamps are stored as UTC and must always be shown in Korea time.
  const fmtDate = (s: string) => formatSettlementTimestamp(s);

  const CAPITAL_GOAL = 30_000_000;
  const isAssetWarning = actualBankBalance < 0 || (profitErp?.liquidityAvailableAfterReserves ?? 0) < 0;

  // ─── UI ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5 pb-20">

      {/* ── 가용 현금 잠금 경고 ───────────────────────────────────────────── */}
      {!loading && isAssetWarning && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-admin-base text-red-600 font-medium">
            실제 잔액은 <strong>{fmtW(actualBankBalance)}</strong>이지만 보호할 여행자금과 세금 적립 후
            {profitErp?.liquidityShortfall
              ? <> 최소 <strong>{fmtW(profitErp.liquidityShortfall)}</strong> 부족합니다. 지금 인출 가능한 돈은 0원입니다.</>
              : <> 인출 가능한 여유 현금이 없습니다.</>}
          </p>
        </div>
      )}

      {/* ── 헤더 ──────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-admin-text-2">수익 ERP</h1>
          <p className="text-admin-base text-admin-muted mt-0.5">Clobe 신한 4128 · 여행자금, 회사손익, 인출 가능액을 분리한 현금 기준 대시보드</p>
        </div>
        <div className="flex gap-2">
          <button type="button"
            onClick={runAIScan}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-white border border-admin-border-strong text-admin-text-2 hover:bg-admin-bg transition"
          >
            <Sparkles className="w-3.5 h-3.5" /> AI 클리닝
          </button>
          <button type="button"
            onClick={loadAll}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-white border border-admin-border-strong text-admin-text-2 hover:bg-admin-bg transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> 새로고침
          </button>
        </div>
      </div>

      {/* ── Owner KPI ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Link href="/admin/payments" className={`rounded-admin-md p-5 text-white transition hover:-translate-y-0.5 ${
          (profitErp?.safeToWithdraw ?? 0) > 0 ? 'bg-emerald-700' : 'bg-slate-900'
        }`}>
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck className="w-4 h-4 opacity-80" />
            <p className="text-xs font-medium opacity-80">지금 써도 되는 돈</p>
          </div>
          <p className="text-3xl font-extrabold tracking-tight mt-1">
            {loading ? '—' : fmtW(profitErp?.safeToWithdraw ?? 0)}
          </p>
          <p className="text-xs opacity-65 mt-1.5">
            {profitErp?.calculationStatus === 'blocked'
              ? `보수적 잠금 · ${profitErp.blockers[0] ?? '확인 필요'}`
              : '여행자금·세금·회사비용 보호 후'}
          </p>
        </Link>

        <Link href="/admin/payments" className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-5 transition hover:border-emerald-300">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="w-4 h-4 text-emerald-600" />
            <p className="text-xs text-admin-muted font-medium">여행 정산확정 이익</p>
          </div>
          <p className="text-2xl font-bold text-emerald-700 mt-1">{loading ? '—' : fmtW(profitErp?.confirmedTravelProfit ?? 0)}</p>
          <p className="text-xs text-admin-muted mt-1">입금 - 출금 · 확정 예약 {profitErp?.confirmedBookingCount ?? 0}건만</p>
        </Link>

        <Link href="/admin/tax" className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-5 transition hover:border-blue-300">
          <div className="flex items-center gap-2 mb-1">
            <FileText className="w-4 h-4 text-blue-600" />
            <p className="text-xs text-admin-muted font-medium">세금 적립 후 여행이익</p>
          </div>
          <p className="text-2xl font-bold text-blue-700 mt-1">{loading ? '—' : fmtW(profitErp?.afterTaxTravelProfit ?? 0)}</p>
          <p className="text-xs text-admin-muted mt-1">보수적 세금 적립 {fmtW(profitErp?.estimatedTaxReserve ?? 0)} · 단순 10%</p>
        </Link>

        <Link href="/admin/payments" className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-5 transition hover:border-red-300">
          <div className="flex items-center gap-2 mb-1">
            {(profitErp?.provisionalOperatingCashResult ?? 0) >= 0
              ? <TrendingUp className="w-4 h-4 text-emerald-600" />
              : <TrendingDown className="w-4 h-4 text-red-500" />}
            <p className="text-xs text-admin-muted font-medium">회사 운영비 반영 잠정손익</p>
          </div>
          <p className={`text-2xl font-bold mt-1 ${(profitErp?.provisionalOperatingCashResult ?? 0) >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
            {loading ? '—' : fmtW(profitErp?.provisionalOperatingCashResult ?? 0)}
          </p>
          <p className="text-xs text-admin-muted mt-1">확정 경비 {fmtW(profitErp?.classifiedOperatingExpense ?? 0)} · 분류 {profitErp?.classificationCoveragePercent ?? 0}%</p>
        </Link>
      </div>

      {/* ── 통장 잔액 대사 ──────────────────────────────────────────────── */}
      <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-5">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between mb-4">
          <div>
            <h2 className="text-admin-lg font-semibold text-admin-text-2">통장잔액에서 인출 가능액까지</h2>
            <p className="text-xs text-admin-muted mt-1">잔액 자체를 이익으로 보지 않고 보호자금과 누적손익을 함께 확인합니다.</p>
          </div>
          <p className="text-[11px] text-admin-muted-2">
            {realityData?.summary.asOf ? `${fmtDate(realityData.summary.asOf)} 거래 후` : 'Clobe 최신 거래 기준'}
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-admin-sm bg-admin-bg px-4 py-3">
            <p className="text-[11px] text-admin-muted">실제 신한 4128 잔액</p>
            <p className="mt-1 text-lg font-bold tabular-nums text-admin-text-2">{fmtW(actualBankBalance)}</p>
          </div>
          <div className="rounded-admin-sm bg-blue-50 px-4 py-3">
            <p className="text-[11px] text-blue-700">건드리면 안 되는 여행자금</p>
            <p className="mt-1 text-lg font-bold tabular-nums text-blue-900">-{fmtW(profitErp?.protectedTravelCash ?? 0)}</p>
          </div>
          <div className="rounded-admin-sm bg-amber-50 px-4 py-3">
            <p className="text-[11px] text-amber-700">세금·미분류 입금 보호액</p>
            <p className="mt-1 text-lg font-bold tabular-nums text-amber-900">
              -{fmtW((profitErp?.estimatedTaxReserve ?? 0) + (profitErp?.protectedUnclassifiedInflows ?? 0))}
            </p>
          </div>
          <div className={`rounded-admin-sm px-4 py-3 ${(profitErp?.liquidityAvailableAfterReserves ?? 0) >= 0 ? 'bg-emerald-50' : 'bg-red-50'}`}>
            <p className={`text-[11px] ${(profitErp?.liquidityAvailableAfterReserves ?? 0) >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>보호액 차감 후 현금</p>
            <p className={`mt-1 text-lg font-bold tabular-nums ${(profitErp?.liquidityAvailableAfterReserves ?? 0) >= 0 ? 'text-emerald-900' : 'text-red-700'}`}>
              {fmtW(profitErp?.liquidityAvailableAfterReserves ?? 0)}
            </p>
          </div>
        </div>
        {profitErp && profitErp.blockers.length > 0 ? (
          <p className="mt-3 text-xs text-red-600">인출 잠금 사유: {profitErp.blockers.join(' · ')}</p>
        ) : null}
      </div>

      <MonthlySettlementCloseCard onClosed={loadAll} />

      {/* ── 차트 + 자본금 카드 ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* 정산확정 여행이익 성장 */}
        <div className="lg:col-span-2 bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between mb-4">
            <div>
              <h2 className="text-admin-lg font-semibold text-admin-text-2">월별 실제 번 여행이익</h2>
              <p className="text-xs text-admin-muted mt-1">출발월 기준 · 정산확정 예약만 · 단순 세금 적립 10%</p>
            </div>
            <div className="flex gap-3 text-[11px] text-admin-muted">
              <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-emerald-600" />정산확정</span>
              <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-blue-500" />세금 적립 후</span>
            </div>
          </div>
          {profitChartData.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-admin-muted text-admin-base">
              {loading ? '로딩 중...' : '데이터 없음'}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={profitChartData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#eef1f4" />
                <XAxis dataKey="month" tickFormatter={m => m.slice(5)} tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={v => fmtW(v)} tick={{ fontSize: 10 }} width={60} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="confirmedTravelProfit" name="정산확정 이익" fill="#047857" radius={[3, 3, 0, 0]} />
                <Bar dataKey="afterTaxTravelProfit" name="세금 적립 후" fill="#3b82f6" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* 자본금 카드 */}
        <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-5 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-admin-lg font-semibold text-admin-text-2">자본금 관리</h2>
            <button type="button"
              onClick={() => setShowCapForm(v => !v)}
              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
            >
              <PlusCircle className="w-3.5 h-3.5" /> 추가
            </button>
          </div>

          <div className="mb-4">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-xl font-bold text-admin-text-2">{fmtW(capital.total)}</p>
                <p className="text-xs text-admin-muted mt-0.5">관리 목표 {fmtW(CAPITAL_GOAL)} · 통장잔액/수익에 더하지 않음</p>
              </div>
              <p className="text-xs text-blue-700 font-semibold">
                {Math.round(Math.min(100, (capital.total / CAPITAL_GOAL) * 100))}%
              </p>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-admin-surface-2">
              <div
                className="h-full rounded-full bg-blue-600 transition-[width] duration-500"
                style={{ width: `${Math.min(100, (capital.total / CAPITAL_GOAL) * 100)}%` }}
              />
            </div>
          </div>

          {/* 자본금 추가 폼 */}
          {showCapForm && (
            <div className="bg-admin-bg rounded-lg p-3 mb-3 space-y-2">
              <input
                type="text"
                placeholder="금액 (예: 5,000,000)"
                value={capitalForm.amount}
                onChange={e => setCapitalForm(p => ({ ...p, amount: e.target.value }))}
                className="w-full text-admin-base border border-admin-border-mid rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <input
                type="text"
                placeholder="메모 (예: 대표이사 초기 투자)"
                value={capitalForm.note}
                onChange={e => setCapitalForm(p => ({ ...p, note: e.target.value }))}
                className="w-full text-admin-base border border-admin-border-mid rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <input
                type="date"
                value={capitalForm.date}
                onChange={e => setCapitalForm(p => ({ ...p, date: e.target.value }))}
                className="w-full text-admin-base border border-admin-border-mid rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <button type="button"
                onClick={handleAddCapital}
                className="w-full bg-blue-600 text-white text-admin-base rounded-lg py-2 hover:bg-blue-700 transition"
              >
                등록
              </button>
            </div>
          )}

          {/* 자본금 이력 */}
          <div className="flex-1 overflow-y-auto space-y-1.5 max-h-48">
            {capital.entries.length === 0
              ? <p className="text-xs text-admin-muted text-center py-4">자본금 항목이 없습니다.</p>
              : capital.entries.map(e => (
                <div key={e.id} className="flex items-center justify-between text-xs py-1.5 border-b border-admin-border-mid last:border-b-0">
                  <div>
                    <p className="font-medium text-admin-text-2">{fmtW(e.amount)}</p>
                    <p className="text-admin-muted">{e.entry_date} {e.note && `/ ${e.note}`}</p>
                  </div>
                  <button
                    type="button"
                    aria-label={`${fmtW(e.amount)} 자본금 항목 삭제`}
                    onClick={() => handleRemoveCapital(e.id, e.amount)}
                    className="text-admin-muted-2 hover:text-red-400"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            }
          </div>
        </div>
      </div>

      {/* ── 거래 내역 탭 ─────────────────────────────────────────────────── */}
      <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs overflow-hidden">

        {/* 탭 헤더 */}
        <div className="flex items-center border-b border-admin-border-mid px-4 pt-3 gap-1">
          {[
            { id: 'overview', label: '전체', icon: <Banknote className="w-3.5 h-3.5" /> },
            { id: 'income',   label: '입금', icon: <ArrowDownCircle className="w-3.5 h-3.5" /> },
            { id: 'expense',  label: '출금', icon: <ArrowUpCircle className="w-3.5 h-3.5" /> },
            { id: 'trash',    label: `휴지통 ${trashTxs.length > 0 ? `(${trashTxs.length})` : ''}`, icon: <Trash2 className="w-3.5 h-3.5" /> },
          ].map(t => (
            <button type="button"
              key={t.id}
              onClick={() => { setTab(t.id as Tab); setSelected(new Set()); }}
              className={`flex items-center gap-1.5 text-xs px-3 py-2.5 border-b-2 font-medium transition whitespace-nowrap ${
                tab === t.id
                  ? t.id === 'trash'
                    ? 'border-red-500 text-red-600'
                    : 'border-blue-600 text-admin-text-2'
                  : 'border-transparent text-admin-muted hover:text-admin-text-2'
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}

          <div className="flex-1" />

          {/* 벌크 액션 버튼 */}
          {tab !== 'trash' && selected.size > 0 && (
            <button type="button"
              onClick={() => handleTrash([...selected])}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition mr-1"
            >
              <Trash2 className="w-3.5 h-3.5" /> {selected.size}건 이동
            </button>
          )}
          {tab === 'trash' && selected.size > 0 && (
            <div className="flex gap-1.5 mr-1">
              <button type="button"
                onClick={() => handleRestore([...selected])}
                className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-white text-admin-text-2 border border-admin-border-strong hover:bg-admin-bg transition"
              >
                <RotateCcw className="w-3.5 h-3.5" /> 복원
              </button>
              <button type="button"
                onClick={() => handleHardDelete([...selected])}
                className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition"
              >
                <Trash2 className="w-3.5 h-3.5" /> 영구삭제
              </button>
            </div>
          )}
        </div>

        {/* 테이블 */}
        {loading ? (
          <div className="overflow-x-auto" role="status" aria-label="거래 내역을 불러오는 중">
            <div aria-hidden="true" className="min-w-full">
              <div className="grid grid-cols-[2rem_repeat(6,minmax(4rem,1fr))_4rem] border-b-2 border-admin-border bg-admin-bg/80">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="px-3 py-3">
                    {i > 0 && i < 7 && <div className="h-3 bg-admin-surface-2 rounded animate-pulse w-12" />}
                  </div>
                ))}
              </div>
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="grid grid-cols-[2rem_repeat(6,minmax(4rem,1fr))_4rem] border-b border-admin-border">
                  <div className="px-3 py-3" />
                  {[80, 40, 120, 70, 56, 60].map((w, j) => (
                    <div key={j} className="px-3 py-3">
                      <div className="h-3 bg-admin-surface-2 rounded animate-pulse" style={{ width: w }} />
                    </div>
                  ))}
                  <div className="px-3 py-3" />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-admin-sm">
              <thead>
                <tr className="border-b-2 border-admin-border">
                  <th className="px-3 py-3 w-8 bg-admin-bg/80 backdrop-blur-sm" aria-label="거래 선택">
                    <button
                      type="button"
                      aria-label={selected.size > 0 && selected.size === selectableTxs.length ? '수동 거래 전체 선택 해제' : '수동 거래 전체 선택'}
                      onClick={toggleAll}
                      disabled={selectableTxs.length === 0}
                      className="text-admin-muted-2 hover:text-admin-text-2"
                    >
                      {selected.size > 0 && selected.size === selectableTxs.length
                        ? <CheckSquare className="w-4 h-4 text-blue-600" />
                        : <Square className="w-4 h-4" />
                      }
                    </button>
                  </th>
                  {['일시', '구분', '거래처', '금액', '상태', '예약'].map(h => (
                    <th key={h} className="px-3 py-3 text-left text-[11px] font-semibold text-admin-muted uppercase tracking-wider whitespace-nowrap bg-admin-bg/80 backdrop-blur-sm">{h}</th>
                  ))}
                  <th className="px-3 py-3 w-16 bg-admin-bg/80 backdrop-blur-sm" aria-label="거래 작업" />
                </tr>
              </thead>
              <tbody>
                {(tab === 'trash' ? trashTxs : displayTxs).map(tx => (
                  <tr key={tx.id} className={`border-b border-admin-border-mid hover:bg-admin-bg ${selected.has(tx.id) ? 'bg-blue-50' : ''}`}>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        aria-label={`${fmtDate(tx.received_at)} ${tx.counterparty_name || '거래'} 선택`}
                        onClick={() => toggleSelect(tx.id)}
                        disabled={isAuthoritativeClobe(tx)}
                        title={isAuthoritativeClobe(tx) ? 'Clobe 원본 거래는 Clobe에서 수정한 뒤 동기화하세요' : '선택'}
                        className="text-admin-muted-2 hover:text-blue-600"
                      >
                        {isAuthoritativeClobe(tx)
                          ? <span className="inline-flex w-4 justify-center text-[10px] text-admin-muted-2">원본</span>
                          : selected.has(tx.id)
                          ? <CheckSquare className="w-4 h-4 text-blue-600" />
                          : <Square className="w-4 h-4" />
                        }
                      </button>
                    </td>
                    <td className="px-3 py-2 text-admin-sm text-admin-muted whitespace-nowrap">{fmtDate(tx.received_at)}</td>
                    <td className="px-3 py-2">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                        tx.transaction_type === '입금'
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-orange-50 text-orange-700'
                      }`}>
                        {tx.is_refund ? '환불' : tx.transaction_type}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-medium text-admin-text-2 max-w-[140px] truncate">{tx.counterparty_name || '—'}</td>
                    <td className={`px-3 py-2 font-bold tabular-nums ${
                      tx.transaction_type === '입금' ? 'text-blue-700' : 'text-orange-600'
                    }`}>
                      {tx.transaction_type === '입금' ? '+' : '-'}{fmt(tx.amount)}원
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                        tx.settlement_scope === 'non_travel' ? 'bg-slate-100 text-slate-700' :
                        tx.match_status === 'auto'      ? 'bg-emerald-50 text-emerald-700'  :
                        tx.match_status === 'manual'    ? 'bg-blue-50 text-blue-700'    :
                        tx.match_status === 'review'    ? 'bg-amber-50 text-amber-700'  :
                        tx.is_fee                       ? 'bg-admin-surface-2 text-admin-muted'    :
                                                          'bg-red-50 text-red-600'
                      }`}>
                        {tx.settlement_scope === 'non_travel' ? '여행 외·경비' :
                         tx.is_fee ? '수수료' :
                         tx.match_status === 'auto' ? '자동매칭' :
                         tx.match_status === 'manual' ? '수동' :
                         tx.match_status === 'review' ? '검토' : '미매칭'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-admin-sm text-admin-muted max-w-[100px] truncate">
                      {(tx.bookings as Record<string, unknown>)?.booking_no as string ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {tab === 'trash' && isAuthoritativeClobe(tx) ? (
                        <span className="text-[10px] text-admin-muted-2" title="Clobe 원본 보관 행은 이 화면에서 변경할 수 없습니다">보호됨</span>
                      ) : tab === 'trash' ? (
                        <div className="flex gap-1.5 justify-end">
                          <button type="button"
                            onClick={() => handleRestore([tx.id])}
                            title="복원"
                            aria-label={`${tx.counterparty_name || '거래'} 복원`}
                            className="p-1.5 rounded-lg text-admin-muted-2 hover:text-blue-600 hover:bg-blue-50 transition"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                          <button type="button"
                            onClick={() => handleHardDelete([tx.id])}
                            title="영구 삭제"
                            aria-label={`${tx.counterparty_name || '거래'} 영구 삭제`}
                            className="p-1.5 rounded-lg text-admin-muted-2 hover:text-red-600 hover:bg-red-50 transition"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : isAuthoritativeClobe(tx) ? (
                        <span className="text-[10px] text-admin-muted-2" title="Clobe 원본은 삭제할 수 없습니다">보호됨</span>
                      ) : (
                        <button type="button"
                          onClick={() => handleTrash([tx.id])}
                          title="휴지통으로 이동"
                          aria-label={`${tx.counterparty_name || '거래'} 휴지통으로 이동`}
                          className="p-1.5 rounded-lg text-admin-muted-2 hover:text-red-500 hover:bg-red-50 transition"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {(tab === 'trash' ? trashTxs : displayTxs).length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-14 text-center">
                      <div className="flex flex-col items-center gap-3">
                        {tab === 'trash'
                          ? <svg className="w-10 h-10 text-admin-border-mid" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
                          : <svg className="w-10 h-10 text-admin-border-mid" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" /></svg>
                        }
                        <p className="text-admin-sm font-medium text-admin-muted">
                          {tab === 'trash' ? '휴지통이 비어 있습니다.' : '거래 내역이 없습니다.'}
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── AI 스마트 클리닝 슬라이드 오버 패널 ────────────────────────────── */}
      {showAI && (
        <>
          <button
            type="button"
            aria-label="AI 스마트 클리닝 결과 패널 닫기"
            className="fixed inset-0 bg-black/30 z-40"
            onClick={() => setShowAI(false)}
          />
          <div className="fixed top-0 right-0 h-full w-full max-w-md bg-white border-l border-admin-border-mid z-50 overflow-y-auto">
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-purple-600" />
                  <h2 className="text-admin-lg font-semibold text-admin-text-2">AI 스마트 클리닝 결과</h2>
                </div>
                <button
                  type="button"
                  aria-label="AI 스마트 클리닝 결과 패널 닫기"
                  onClick={() => setShowAI(false)}
                  className="text-admin-muted-2 hover:text-admin-muted"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              {anomalies.length === 0 ? (
                <p className="text-admin-base text-emerald-600 font-medium">이상 거래가 감지되지 않았습니다.</p>
              ) : (
                <div className="space-y-2">
                  {anomalies.map((a, i) => (
                    <div key={i} className={`flex items-center gap-3 text-xs px-3 py-2 rounded-lg ${
                      a.kind === 'duplicate' ? 'bg-amber-50 text-amber-800' :
                      a.kind === 'large'     ? 'bg-blue-50 text-blue-800'   :
                                              'bg-red-50 text-red-800'
                    }`}>
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>{a.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── 5초 Undo 토스트 ─────────────────────────────────────────────── */}
      {undoInfo && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4
                        bg-slate-900 text-white px-5 py-3.5 rounded-lg
                        animate-in slide-in-from-bottom-4 duration-300">
          <Trash2 className="w-4 h-4 text-admin-muted-2 shrink-0" />
          <span className="text-admin-base">
            {undoInfo.ids.length}건 이동 중
            <span className="text-admin-muted-2 ml-1">({undoInfo.countdown}초 후 확정)</span>
          </span>
          <button type="button"
            onClick={handleUndo}
            className="text-blue-400 hover:text-blue-300 text-admin-base font-semibold ml-2 transition"
          >
            실행 취소
          </button>
        </div>
      )}

      {/* ── 일반 Toast ──────────────────────────────────────────────────── */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg text-admin-base font-medium
                         text-white animate-in slide-in-from-bottom-4 duration-200 ${
          toast.ok ? 'bg-emerald-600' : 'bg-red-600'
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
