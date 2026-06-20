'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import useSWR from 'swr';
import dynamic from 'next/dynamic';

const AreaChart = dynamic(() => import('recharts').then(m => ({ default: m.AreaChart })), { ssr: false });
const Area = dynamic(() => import('recharts').then(m => ({ default: m.Area })), { ssr: false });
const XAxis = dynamic(() => import('recharts').then(m => ({ default: m.XAxis })), { ssr: false });
const YAxis = dynamic(() => import('recharts').then(m => ({ default: m.YAxis })), { ssr: false });
const CartesianGrid = dynamic(() => import('recharts').then(m => ({ default: m.CartesianGrid })), { ssr: false });
const Tooltip = dynamic(() => import('recharts').then(m => ({ default: m.Tooltip })), { ssr: false });
const ResponsiveContainer = dynamic(() => import('recharts').then(m => ({ default: m.ResponsiveContainer })), { ssr: false });
const Legend = dynamic(() => import('recharts').then(m => ({ default: m.Legend })), { ssr: false });
import {
  TrendingUp, TrendingDown, Minus, Trash2, RotateCcw,
  PlusCircle, AlertTriangle, Sparkles, X, CheckSquare, Square,
  RefreshCw, Wallet, Banknote, ArrowDownCircle, ArrowUpCircle,
} from 'lucide-react';

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
  bookings?:        { booking_no: string; package_title: string } | null;
}

interface CapitalEntry {
  id:         string;
  amount:     number;
  note:       string | null;
  entry_date: string;
}

interface MonthlyPoint {
  month:   string;
  income:  number;
  expense: number;
  net:     number;
}

interface AnomalyItem {
  id:    string;
  label: string;
  kind:  'duplicate' | 'large' | 'tiny';
}

interface HardDeleteTarget {
  ids: string[];
  items: BankTx[];
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

// ─── SVG 원형 게이지 ─────────────────────────────────────────────────────────

function CapitalRing({ current, goal }: { current: number; goal: number }) {
  const r = 42;
  const circ = 2 * Math.PI * r;
  const pct  = Math.min(1, current / goal);
  const dash = pct * circ;

  return (
    <svg width={100} height={100} viewBox="0 0 100 100">
      <circle cx={50} cy={50} r={r} fill="none" stroke="#e2e8f0" strokeWidth={10} />
      <circle
        cx={50} cy={50} r={r}
        fill="none"
        stroke={pct >= 1 ? '#10b981' : '#3b82f6'}
        strokeWidth={10}
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform="rotate(-90 50 50)"
        style={{ transition: 'stroke-dasharray 0.8s ease' }}
      />
      <text x={50} y={54} textAnchor="middle" fontSize={14} fontWeight="bold" fill="#334155">
        {Math.round(pct * 100)}%
      </text>
    </svg>
  );
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
  // 감사(2026-05-11 Phase 5-A'): 4 fetch Promise.all → 4 useSWR.
  // 페이지 재진입 시 dedup, mutation 후 mutate() 로 단일 무효화.
  const [txs,        setTxs]        = useState<BankTx[]>([]);
  const [trashTxs,   setTrashTxs]   = useState<BankTx[]>([]);
  const [chartData,  setChartData]  = useState<MonthlyPoint[]>([]);
  const [capital,    setCapital]    = useState<{ entries: CapitalEntry[]; total: number }>({ entries: [], total: 0 });
  const [selected,   setSelected]   = useState<Set<string>>(new Set());
  const [undoInfo,   setUndoInfo]   = useState<{ ids: string[]; items: BankTx[]; countdown: number } | null>(null);
  const [anomalies,  setAnomalies]  = useState<AnomalyItem[]>([]);
  const [showAI,     setShowAI]     = useState(false);
  const [capitalForm, setCapitalForm] = useState({ amount: '', note: '', date: new Date().toISOString().slice(0, 10) });
  const [showCapForm, setShowCapForm] = useState(false);
  const [toast,      setToast]      = useState<{ msg: string; ok: boolean } | null>(null);
  const [hardDeleteTarget, setHardDeleteTarget] = useState<HardDeleteTarget | null>(null);
  const [hardDeleting, setHardDeleting] = useState(false);
  const undoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hardDeleteModalRef = useRef<HTMLDivElement | null>(null);
  const hardDeleteCancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const hardDeleteTriggerRef = useRef<HTMLElement | null>(null);
  const ledgerActionResultRef = useRef<HTMLParagraphElement | null>(null);
  const hardDeleteTitleId = 'ledger-hard-delete-title';
  const hardDeleteDescriptionId = 'ledger-hard-delete-description';
  const hardDeleteStatusId = 'ledger-hard-delete-status';

  // ── 데이터 로드 (SWR) ──────────────────────────────────────────────────
  const { data: txData, isLoading: txLoading, mutate: mutateTxs } =
    useSWR<{ transactions: BankTx[] }>('/api/bank-transactions?status=active');
  const { data: trashData, mutate: mutateTrash } =
    useSWR<{ transactions: BankTx[] }>('/api/bank-transactions?status=excluded');
  const { data: chartD } =
    useSWR<{ chartData: MonthlyPoint[] }>('/api/bank-transactions?aggregate=monthly&months=12');
  const { data: capData, mutate: mutateCapital } =
    useSWR<{ entries: CapitalEntry[]; total: number }>('/api/capital');

  const loading = txLoading;

  useEffect(() => {
    if (txData?.transactions) setTxs(txData.transactions);
  }, [txData]);
  useEffect(() => {
    if (trashData?.transactions) setTrashTxs(trashData.transactions);
  }, [trashData]);
  useEffect(() => {
    if (chartD?.chartData) setChartData(chartD.chartData);
  }, [chartD]);
  useEffect(() => {
    if (capData) setCapital({ entries: capData.entries || [], total: capData.total || 0 });
  }, [capData]);

  // mutation 후 호출용 — 4개 키 일괄 무효화.
  const loadAll = useCallback(() => {
    mutateTxs();
    mutateTrash();
    mutateCapital();
  }, [mutateTxs, mutateTrash, mutateCapital]);

  // ── KPI 계산 ───────────────────────────────────────────────────────────
  const totalIncome  = txs.filter(t => t.transaction_type === '입금' && !t.is_refund).reduce((s, t) => s + t.amount, 0);
  const totalExpense = txs.filter(t => t.transaction_type === '출금' && !t.is_refund).reduce((s, t) => s + t.amount, 0);
  const totalRefund  = txs.filter(t => t.is_refund).reduce((s, t) => s + t.amount, 0);
  const availableAssets = totalIncome + capital.total - totalExpense;

  // MoM 성장 (최근 2개월 순 현금흐름 비교)
  let momPct = 0;
  if (chartData.length >= 2) {
    const last = chartData[chartData.length - 1];
    const prev = chartData[chartData.length - 2];
    if (prev.net !== 0) momPct = ((last.net - prev.net) / Math.abs(prev.net)) * 100;
  }

  // ── 탭별 필터링 목록 ───────────────────────────────────────────────────
  const displayTxs = tab === 'income'
    ? txs.filter(t => t.transaction_type === '입금')
    : tab === 'expense'
    ? txs.filter(t => t.transaction_type === '출금')
    : txs;

  // ── 선택 헬퍼 ─────────────────────────────────────────────────────────
  const toggleSelect = (id: string) =>
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const toggleAll = () => {
    if (selected.size === displayTxs.length) setSelected(new Set());
    else setSelected(new Set(displayTxs.map(t => t.id)));
  };

  // ── 소프트 삭제 (5초 Undo) ─────────────────────────────────────────────
  const handleTrash = (ids: string[]) => {
    if (ids.length === 0) return;
    const items = txs.filter(t => ids.includes(t.id));

    // 낙관적 UI 업데이트
    setTxs(prev => prev.filter(t => !ids.includes(t.id)));
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
    setUndoInfo({ ids, items, countdown });

    undoTimerRef.current = setInterval(() => {
      countdown -= 1;
      setUndoInfo(prev => prev ? { ...prev, countdown } : null);
      if (countdown <= 0) {
        clearInterval(undoTimerRef.current!);
        fetch('/api/bank-transactions', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'trash_bulk', ids }),
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
  const openHardDeleteModal = (ids: string[], trigger?: HTMLElement | null) => {
    if (ids.length === 0) return;
    hardDeleteTriggerRef.current = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setHardDeleteTarget({
      ids,
      items: trashTxs.filter(t => ids.includes(t.id)),
    });
  };

  const closeHardDeleteModal = () => {
    setHardDeleteTarget(null);
    window.setTimeout(() => {
      hardDeleteTriggerRef.current?.focus();
    }, 0);
  };

  const handleConfirmHardDelete = async () => {
    if (!hardDeleteTarget) return;
    const { ids } = hardDeleteTarget;
    setHardDeleting(true);
    try {
      setTrashTxs(prev => prev.filter(t => !ids.includes(t.id)));
      await fetch('/api/bank-transactions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'hard_delete_bulk', ids }),
      });
      setSelected(new Set());
      setHardDeleteTarget(null);
      window.setTimeout(() => ledgerActionResultRef.current?.focus(), 0);
      showToast(`${ids.length}건 영구 삭제됨`, false);
    } finally {
      setHardDeleting(false);
    }
  };

  useEffect(() => {
    if (!hardDeleteTarget) return;

    const focusTimer = window.setTimeout(() => hardDeleteCancelButtonRef.current?.focus(), 0);
    const getFocusableElements = () => Array.from(
      hardDeleteModalRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    ).filter(element => !element.getAttribute('aria-hidden'));
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!hardDeleting) closeHardDeleteModal();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (focusableElements.length === 1) {
        event.preventDefault();
        firstElement.focus();
        return;
      }
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
        return;
      }
      if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKey);
    };
  }, [hardDeleteTarget, hardDeleting]);

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

  // ── 날짜 포맷 (locale-stable: MM-DD HH:mm) ─────────────────────────────
  const fmtDate = (s: string) => (s ? s.slice(5, 16).replace('T', ' ') : '');

  const CAPITAL_GOAL = 30_000_000;
  const isAssetWarning = availableAssets < 0;

  // ─── UI ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5 pb-20">
      <p id="ledger-action-result" ref={ledgerActionResultRef} tabIndex={-1} className="sr-only">
        원장 작업 결과가 화면에 반영되었습니다.
      </p>

      {/* ── 경고 배너 (가용 자산 마이너스) ──────────────────────────────────── */}
      {!loading && isAssetWarning && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-admin-base text-red-600 font-medium">
            가용 자산이 부족합니다. 현재 <strong>{fmtW(availableAssets)}</strong> 상태입니다.
            미지급 원가 또는 운영비 검토가 필요합니다.
          </p>
        </div>
      )}

      {/* ── 헤더 ──────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-admin-text-2">AI 재무 대시보드</h1>
          <p className="text-admin-base text-admin-muted mt-0.5">실계좌 현금흐름 / 자본금 / 가용자산 분석</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={runAIScan}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-white border border-admin-border-strong text-admin-text-2 hover:bg-admin-bg transition"
          >
            <Sparkles className="w-3.5 h-3.5" /> AI 클리닝
          </button>
          <button
            onClick={loadAll}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-white border border-admin-border-strong text-admin-text-2 hover:bg-admin-bg transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> 새로고침
          </button>
        </div>
      </div>

      {/* ── Hero KPI 카드 3개 ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

        {/* 가용 자산 */}
        <div className={`rounded-admin-md p-5 ${
          isAssetWarning ? 'bg-red-600' : 'bg-slate-900'
        } text-white`}>
          <div className="flex items-center gap-2 mb-1">
            <Wallet className="w-4 h-4 opacity-70" />
            <p className="text-xs font-medium opacity-80">가용 자산</p>
          </div>
          <p className="text-3xl font-extrabold tracking-tight mt-1">{fmtW(availableAssets)}</p>
          <p className="text-xs opacity-60 mt-1.5">입금 {fmtW(totalIncome)} + 자본 {fmtW(capital.total)} - 출금 {fmtW(totalExpense)}</p>
        </div>

        {/* 총 입금 */}
        <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-5">
          <div className="flex items-center gap-2 mb-1">
            <ArrowDownCircle className="w-4 h-4 text-emerald-500" />
            <p className="text-xs text-admin-muted font-medium">총 입금액</p>
          </div>
          <p className="text-2xl font-bold text-admin-text-2 mt-1">{fmtW(totalIncome)}</p>
          {totalRefund > 0 && (
            <p className="text-xs text-red-500 mt-1">환불 {fmtW(totalRefund)} 포함</p>
          )}
          <p className="text-xs text-admin-muted mt-0.5">{txs.filter(t => t.transaction_type === '입금').length}건</p>
        </div>

        {/* MoM 성장 */}
        <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-5">
          <div className="flex items-center gap-2 mb-1">
            {momPct > 0
              ? <TrendingUp className="w-4 h-4 text-emerald-500" />
              : momPct < 0
              ? <TrendingDown className="w-4 h-4 text-red-400" />
              : <Minus className="w-4 h-4 text-admin-muted-2" />}
            <p className="text-xs text-admin-muted font-medium">전월 대비 순 현금흐름</p>
          </div>
          <p className={`text-2xl font-bold mt-1 ${
            momPct > 0 ? 'text-emerald-600' : momPct < 0 ? 'text-red-500' : 'text-admin-muted'
          }`}>
            {momPct > 0 ? '+' : ''}{momPct.toFixed(1)}%
          </p>
          <p className="text-xs text-admin-muted mt-0.5">총 출금 {fmtW(totalExpense)}</p>
        </div>
      </div>

      {/* ── 차트 + 자본금 카드 ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Recharts AreaChart */}
        <div className="lg:col-span-2 bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-5">
          <h2 className="text-admin-lg font-semibold text-admin-text-2 mb-4">12개월 현금흐름 추이</h2>
          {chartData.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-admin-muted text-admin-base">
              {loading ? '로딩 중...' : '데이터 없음'}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={chartData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gIncome" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gExpense" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f97316" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tickFormatter={m => m.slice(5)} tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={v => fmtW(v)} tick={{ fontSize: 10 }} width={60} />
                <Tooltip content={<ChartTooltip />} />
                <Legend formatter={v => v === 'income' ? '입금' : v === 'expense' ? '출금' : '순현금'} />
                <Area type="monotone" dataKey="income"  name="income"  stroke="#3b82f6" fill="url(#gIncome)"  strokeWidth={2} dot={false} />
                <Area type="monotone" dataKey="expense" name="expense" stroke="#f97316" fill="url(#gExpense)" strokeWidth={2} dot={false} />
                <Area type="monotone" dataKey="net"     name="net"     stroke="#10b981" fill="none"           strokeWidth={2} dot={false} strokeDasharray="4 2" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* 자본금 카드 */}
        <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-5 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-admin-lg font-semibold text-admin-text-2">자본금 관리</h2>
            <button
              onClick={() => setShowCapForm(v => !v)}
              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
            >
              <PlusCircle className="w-3.5 h-3.5" /> 추가
            </button>
          </div>

          <div className="flex items-center gap-4 mb-3">
            <CapitalRing current={capital.total} goal={CAPITAL_GOAL} />
            <div>
              <p className="text-xl font-bold text-admin-text-2">{fmtW(capital.total)}</p>
              <p className="text-xs text-admin-muted">목표 {fmtW(CAPITAL_GOAL)}</p>
              <p className="text-xs text-blue-600 mt-0.5 font-medium">
                {Math.round(Math.min(100, (capital.total / CAPITAL_GOAL) * 100))}% 달성
              </p>
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
              <button
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
                  <button onClick={() => handleRemoveCapital(e.id, e.amount)} className="text-admin-muted-2 hover:text-red-400">
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
            <button
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
            <button
              onClick={() => handleTrash([...selected])}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition mr-1"
            >
              <Trash2 className="w-3.5 h-3.5" /> {selected.size}건 이동
            </button>
          )}
          {tab === 'trash' && selected.size > 0 && (
            <div className="flex gap-1.5 mr-1">
              <button
                onClick={() => handleRestore([...selected])}
                className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-white text-admin-text-2 border border-admin-border-strong hover:bg-admin-bg transition"
              >
                <RotateCcw className="w-3.5 h-3.5" /> 복원
              </button>
              <button
                onClick={event => openHardDeleteModal([...selected], event.currentTarget)}
                aria-haspopup="dialog"
                aria-expanded={Boolean(hardDeleteTarget)}
                aria-controls="ledger-hard-delete-dialog"
                className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition"
              >
                <Trash2 className="w-3.5 h-3.5" /> 영구삭제
              </button>
            </div>
          )}
        </div>

        {/* 테이블 */}
        {loading ? (
          <div className="overflow-x-auto">
            <table className="w-full text-admin-sm">
              <thead>
                <tr className="border-b-2 border-admin-border">
                  <th className="px-3 py-3 w-8 bg-admin-bg/80">
                    <span className="sr-only">선택 상태</span>
                  </th>
                  {['일시', '구분', '거래처', '금액', '상태', '예약'].map(h => (
                    <th key={h} className="px-3 py-3 text-left text-[11px] font-semibold text-admin-muted uppercase tracking-wider whitespace-nowrap bg-admin-bg/80">{h}</th>
                  ))}
                  <th className="px-3 py-3 w-16 bg-admin-bg/80">
                    <span className="sr-only">작업</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-admin-border">
                    <td className="px-3 py-3">
                      <span className="sr-only">선택 상태 로딩 중</span>
                    </td>
                    {[80, 40, 120, 70, 56, 60].map((w, j) => (
                      <td key={j} className="px-3 py-3">
                        <div className={`h-3 bg-admin-surface-2 rounded animate-pulse`} style={{ width: w }} />
                        <span className="sr-only">거래 정보 로딩 중</span>
                      </td>
                    ))}
                    <td className="px-3 py-3">
                      <span className="sr-only">작업 로딩 중</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-admin-sm">
              <thead>
                <tr className="border-b-2 border-admin-border">
                  <th className="px-3 py-3 w-8 bg-admin-bg/80 backdrop-blur-sm">
                    <button type="button" aria-label="거래 전체 선택" onClick={toggleAll} className="text-admin-muted-2 hover:text-admin-text-2">
                      {selected.size > 0 && selected.size === (tab === 'trash' ? trashTxs : displayTxs).length
                        ? <CheckSquare className="w-4 h-4 text-blue-600" />
                        : <Square className="w-4 h-4" />
                      }
                    </button>
                  </th>
                  {['일시', '구분', '거래처', '금액', '상태', '예약'].map(h => (
                    <th key={h} className="px-3 py-3 text-left text-[11px] font-semibold text-admin-muted uppercase tracking-wider whitespace-nowrap bg-admin-bg/80 backdrop-blur-sm">{h}</th>
                  ))}
                  <th className="px-3 py-3 w-16 bg-admin-bg/80 backdrop-blur-sm">
                    <span className="sr-only">작업</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {(tab === 'trash' ? trashTxs : displayTxs).map(tx => (
                  <tr key={tx.id} className={`border-b border-admin-border-mid hover:bg-admin-bg ${selected.has(tx.id) ? 'bg-blue-50' : ''}`}>
                    <td className="px-3 py-2">
                      <button type="button" aria-label={`${tx.counterparty_name || '거래'} 선택`} onClick={() => toggleSelect(tx.id)} className="text-admin-muted-2 hover:text-blue-600">
                        {selected.has(tx.id)
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
                        tx.match_status === 'auto'      ? 'bg-emerald-50 text-emerald-700'  :
                        tx.match_status === 'manual'    ? 'bg-blue-50 text-blue-700'    :
                        tx.match_status === 'review'    ? 'bg-amber-50 text-amber-700'  :
                        tx.is_fee                       ? 'bg-admin-surface-2 text-admin-muted'    :
                                                          'bg-red-50 text-red-600'
                      }`}>
                        {tx.is_fee ? '수수료' :
                         tx.match_status === 'auto' ? '자동매칭' :
                         tx.match_status === 'manual' ? '수동' :
                         tx.match_status === 'review' ? '검토' : '미매칭'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-admin-sm text-admin-muted max-w-[100px] truncate">
                      {(tx.bookings as Record<string, unknown>)?.booking_no as string ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {tab === 'trash' ? (
                        <div className="flex gap-1.5 justify-end">
                          <button
                            onClick={() => handleRestore([tx.id])}
                            title="복원"
                            aria-label="거래 복원"
                            className="p-1.5 rounded-lg text-admin-muted-2 hover:text-blue-600 hover:bg-blue-50 transition"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={event => openHardDeleteModal([tx.id], event.currentTarget)}
                            title="영구 삭제"
                            aria-label="거래 영구 삭제"
                            aria-haspopup="dialog"
                            aria-expanded={hardDeleteTarget?.ids.includes(tx.id) ?? false}
                            aria-controls="ledger-hard-delete-dialog"
                            className="p-1.5 rounded-lg text-admin-muted-2 hover:text-red-600 hover:bg-red-50 transition"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleTrash([tx.id])}
                          title="휴지통으로 이동"
                          aria-label="거래 휴지통으로 이동"
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

      {/* ── 영구 삭제 확인 모달 ───────────────────────────────────────────── */}
      {hardDeleteTarget && (() => {
        const hardDeleteSummaryId = 'ledger-hard-delete-summary';
        const totalAmount = hardDeleteTarget.items.reduce((sum, tx) => sum + tx.amount, 0);
        const incomeCount = hardDeleteTarget.items.filter(tx => tx.transaction_type === '입금').length;
        const expenseCount = hardDeleteTarget.items.filter(tx => tx.transaction_type === '출금').length;
        const hiddenCount = Math.max(0, hardDeleteTarget.ids.length - hardDeleteTarget.items.length);
        const sampleNames = hardDeleteTarget.items
          .slice(0, 3)
          .map(tx => tx.counterparty_name || tx.memo || '거래처 없음')
          .join(', ');
        const statusText = hardDeleting
          ? '선택한 원장 거래를 영구 삭제하고 있습니다.'
          : '원장 영구 삭제 확인창이 열렸습니다. 복원할 수 없는 작업입니다.';
        const summaryText = `${hardDeleteTarget.ids.length}건, 합계 ${fmtW(totalAmount)}를 영구 삭제합니다. 삭제 후 복원할 수 없습니다.`;

        return (
          <>
            <button
              type="button"
              aria-label="원장 영구 삭제 확인 모달 닫기"
              className="fixed inset-0 z-[120] bg-black/40 cursor-default"
              onClick={() => !hardDeleting && closeHardDeleteModal()}
              disabled={hardDeleting}
            />
            <div className="fixed inset-0 z-[121] flex h-dvh items-center justify-center overflow-y-auto px-4 py-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] pointer-events-none">
              <div
                id="ledger-hard-delete-dialog"
                ref={hardDeleteModalRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={hardDeleteTitleId}
                aria-describedby={`${hardDeleteDescriptionId} ${hardDeleteSummaryId} ${hardDeleteStatusId}`}
                data-testid="ledger-hard-delete-dialog"
                tabIndex={-1}
                className="pointer-events-auto w-full max-w-lg rounded-admin-lg bg-white p-6 shadow-2xl"
              >
                <div className="space-y-1">
                  <h2 id={hardDeleteTitleId} className="text-admin-lg font-bold text-admin-text">
                    원장 거래 영구 삭제
                  </h2>
                  <p id={hardDeleteDescriptionId} className="text-admin-sm text-admin-muted">
                    휴지통 거래를 완전히 삭제합니다. 이 작업은 실행 취소나 복원이 불가능합니다.
                  </p>
                  <p id={hardDeleteStatusId} role="status" aria-live="polite" aria-atomic="true" className="sr-only">
                    {statusText}
                  </p>
                </div>

                <div
                  id={hardDeleteSummaryId}
                  data-testid="ledger-hard-delete-summary"
                  aria-label={summaryText}
                  className="mt-4 rounded-admin-md border border-red-200 bg-red-50 px-3 py-3 text-admin-sm font-semibold text-red-800"
                >
                  {summaryText}
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-3 text-admin-sm">
                  <div className="rounded-admin-md bg-admin-bg px-3 py-2">
                    <dt className="text-admin-xs font-medium text-admin-muted">삭제 건수</dt>
                    <dd className="mt-1 font-mono font-semibold tabular-nums text-admin-text-2">{hardDeleteTarget.ids.length}건</dd>
                  </div>
                  <div className="rounded-admin-md bg-admin-bg px-3 py-2">
                    <dt className="text-admin-xs font-medium text-admin-muted">합계 금액</dt>
                    <dd className="mt-1 font-mono font-semibold tabular-nums text-admin-text-2">{fmtW(totalAmount)}</dd>
                  </div>
                  <div className="rounded-admin-md bg-admin-bg px-3 py-2">
                    <dt className="text-admin-xs font-medium text-admin-muted">입금/출금</dt>
                    <dd className="mt-1 font-mono font-semibold tabular-nums text-admin-text-2">입금 {incomeCount} · 출금 {expenseCount}</dd>
                  </div>
                  <div className="rounded-admin-md bg-admin-bg px-3 py-2">
                    <dt className="text-admin-xs font-medium text-admin-muted">확인 거래처</dt>
                    <dd className="mt-1 truncate font-semibold text-admin-text-2">{sampleNames || '선택 거래'}</dd>
                  </div>
                </dl>

                {hiddenCount > 0 && (
                  <p className="mt-3 rounded-admin-md border border-amber-200 bg-amber-50 px-3 py-2 text-admin-xs font-semibold text-amber-800">
                    현재 목록에서 찾지 못한 선택 항목 {hiddenCount}건도 함께 삭제 요청에 포함됩니다.
                  </p>
                )}

                <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    ref={hardDeleteCancelButtonRef}
                    onClick={closeHardDeleteModal}
                    disabled={hardDeleting}
                    className="rounded-admin-md border border-admin-border-strong bg-white px-4 py-2 text-admin-sm font-semibold text-admin-text-2 hover:bg-admin-bg disabled:opacity-60"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    data-testid="ledger-hard-delete-confirm"
                    onClick={handleConfirmHardDelete}
                    disabled={hardDeleting}
                    aria-busy={hardDeleting}
                    className="rounded-admin-md bg-red-600 px-4 py-2 text-admin-sm font-bold text-white hover:bg-red-700 disabled:bg-red-300"
                  >
                    {hardDeleting ? '처리 중...' : '영구 삭제'}
                  </button>
                </div>
              </div>
            </div>
          </>
        );
      })()}

      {/* ── AI 스마트 클리닝 슬라이드 오버 패널 ────────────────────────────── */}
      {showAI && (
        <>
          <button
            type="button"
            className="fixed inset-0 bg-black/30 z-40"
            onClick={() => setShowAI(false)}
            aria-label="AI 이상 거래 결과 닫기"
          />
          <div className="fixed top-0 right-0 h-full w-full max-w-md bg-white border-l border-admin-border-mid z-50 overflow-y-auto">
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-purple-600" />
                  <h2 className="text-admin-lg font-semibold text-admin-text-2">AI 스마트 클리닝 결과</h2>
                </div>
                <button type="button" aria-label="AI 이상 거래 결과 닫기" onClick={() => setShowAI(false)} className="text-admin-muted-2 hover:text-admin-muted">
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
          <button
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
