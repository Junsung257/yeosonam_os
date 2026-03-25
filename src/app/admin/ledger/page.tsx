'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
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
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs space-y-1">
      <p className="font-semibold text-slate-700 mb-1">{fmtMonth(label)}</p>
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
  const [txs,        setTxs]        = useState<BankTx[]>([]);
  const [trashTxs,   setTrashTxs]   = useState<BankTx[]>([]);
  const [chartData,  setChartData]  = useState<MonthlyPoint[]>([]);
  const [capital,    setCapital]    = useState<{ entries: CapitalEntry[]; total: number }>({ entries: [], total: 0 });
  const [selected,   setSelected]   = useState<Set<string>>(new Set());
  const [loading,    setLoading]    = useState(true);
  const [undoInfo,   setUndoInfo]   = useState<{ ids: string[]; items: BankTx[]; countdown: number } | null>(null);
  const [anomalies,  setAnomalies]  = useState<AnomalyItem[]>([]);
  const [showAI,     setShowAI]     = useState(false);
  const [capitalForm, setCapitalForm] = useState({ amount: '', note: '', date: new Date().toISOString().slice(0, 10) });
  const [showCapForm, setShowCapForm] = useState(false);
  const [toast,      setToast]      = useState<{ msg: string; ok: boolean } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── 데이터 로드 ─────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [txRes, trashRes, chartRes, capRes] = await Promise.all([
        fetch('/api/bank-transactions?status=active'),
        fetch('/api/bank-transactions?status=excluded'),
        fetch('/api/bank-transactions?aggregate=monthly&months=12'),
        fetch('/api/capital'),
      ]);
      const [txData, trashData, chartD, capData] = await Promise.all([
        txRes.json(), trashRes.json(), chartRes.json(), capRes.json(),
      ]);
      setTxs(txData.transactions || []);
      setTrashTxs(trashData.transactions || []);
      setChartData(chartD.chartData || []);
      setCapital({ entries: capData.entries || [], total: capData.total || 0 });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

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

  // ── 날짜 포맷 ──────────────────────────────────────────────────────────
  const fmtDate = (s: string) =>
    new Date(s).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

  const CAPITAL_GOAL = 30_000_000;
  const isAssetWarning = availableAssets < 0;

  // ─── UI ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5 pb-20">

      {/* ── 경고 배너 (가용 자산 마이너스) ──────────────────────────────────── */}
      {!loading && isAssetWarning && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-[14px] text-red-600 font-medium">
            가용 자산이 부족합니다. 현재 <strong>{fmtW(availableAssets)}</strong> 상태입니다.
            미지급 원가 또는 운영비 검토가 필요합니다.
          </p>
        </div>
      )}

      {/* ── 헤더 ──────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">AI 재무 대시보드</h1>
          <p className="text-[14px] text-slate-500 mt-0.5">실계좌 현금흐름 / 자본금 / 가용자산 분석</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={runAIScan}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition"
          >
            <Sparkles className="w-3.5 h-3.5" /> AI 클리닝
          </button>
          <button
            onClick={loadAll}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> 새로고침
          </button>
        </div>
      </div>

      {/* ── Hero KPI 카드 3개 ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

        {/* 가용 자산 */}
        <div className={`rounded-lg p-5 ${
          isAssetWarning ? 'bg-red-600' : 'bg-[#001f3f]'
        } text-white`}>
          <div className="flex items-center gap-2 mb-1">
            <Wallet className="w-4 h-4 opacity-70" />
            <p className="text-xs font-medium opacity-80">가용 자산</p>
          </div>
          <p className="text-3xl font-extrabold tracking-tight mt-1">{fmtW(availableAssets)}</p>
          <p className="text-xs opacity-60 mt-1.5">입금 {fmtW(totalIncome)} + 자본 {fmtW(capital.total)} - 출금 {fmtW(totalExpense)}</p>
        </div>

        {/* 총 입금 */}
        <div className="bg-white rounded-lg border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-1">
            <ArrowDownCircle className="w-4 h-4 text-emerald-500" />
            <p className="text-xs text-slate-500 font-medium">총 입금액</p>
          </div>
          <p className="text-2xl font-bold text-slate-800 mt-1">{fmtW(totalIncome)}</p>
          {totalRefund > 0 && (
            <p className="text-xs text-red-500 mt-1">환불 {fmtW(totalRefund)} 포함</p>
          )}
          <p className="text-xs text-slate-500 mt-0.5">{txs.filter(t => t.transaction_type === '입금').length}건</p>
        </div>

        {/* MoM 성장 */}
        <div className="bg-white rounded-lg border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-1">
            {momPct > 0
              ? <TrendingUp className="w-4 h-4 text-emerald-500" />
              : momPct < 0
              ? <TrendingDown className="w-4 h-4 text-red-400" />
              : <Minus className="w-4 h-4 text-slate-400" />}
            <p className="text-xs text-slate-500 font-medium">전월 대비 순 현금흐름</p>
          </div>
          <p className={`text-2xl font-bold mt-1 ${
            momPct > 0 ? 'text-emerald-600' : momPct < 0 ? 'text-red-500' : 'text-slate-600'
          }`}>
            {momPct > 0 ? '+' : ''}{momPct.toFixed(1)}%
          </p>
          <p className="text-xs text-slate-500 mt-0.5">총 출금 {fmtW(totalExpense)}</p>
        </div>
      </div>

      {/* ── 차트 + 자본금 카드 ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Recharts AreaChart */}
        <div className="lg:col-span-2 bg-white rounded-lg border border-slate-200 p-5">
          <h2 className="text-[16px] font-semibold text-slate-800 mb-4">12개월 현금흐름 추이</h2>
          {chartData.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-slate-500 text-[14px]">
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
        <div className="bg-white rounded-lg border border-slate-200 p-5 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[16px] font-semibold text-slate-800">자본금 관리</h2>
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
              <p className="text-xl font-bold text-slate-800">{fmtW(capital.total)}</p>
              <p className="text-xs text-slate-500">목표 {fmtW(CAPITAL_GOAL)}</p>
              <p className="text-xs text-blue-600 mt-0.5 font-medium">
                {Math.round(Math.min(100, (capital.total / CAPITAL_GOAL) * 100))}% 달성
              </p>
            </div>
          </div>

          {/* 자본금 추가 폼 */}
          {showCapForm && (
            <div className="bg-slate-50 rounded-lg p-3 mb-3 space-y-2">
              <input
                type="text"
                placeholder="금액 (예: 5,000,000)"
                value={capitalForm.amount}
                onChange={e => setCapitalForm(p => ({ ...p, amount: e.target.value }))}
                className="w-full text-[14px] border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <input
                type="text"
                placeholder="메모 (예: 대표이사 초기 투자)"
                value={capitalForm.note}
                onChange={e => setCapitalForm(p => ({ ...p, note: e.target.value }))}
                className="w-full text-[14px] border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <input
                type="date"
                value={capitalForm.date}
                onChange={e => setCapitalForm(p => ({ ...p, date: e.target.value }))}
                className="w-full text-[14px] border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <button
                onClick={handleAddCapital}
                className="w-full bg-[#001f3f] text-white text-[14px] rounded-lg py-2 hover:bg-blue-900 transition"
              >
                등록
              </button>
            </div>
          )}

          {/* 자본금 이력 */}
          <div className="flex-1 overflow-y-auto space-y-1.5 max-h-48">
            {capital.entries.length === 0
              ? <p className="text-xs text-slate-500 text-center py-4">자본금 항목이 없습니다.</p>
              : capital.entries.map(e => (
                <div key={e.id} className="flex items-center justify-between text-xs py-1.5 border-b border-slate-200 last:border-b-0">
                  <div>
                    <p className="font-medium text-slate-800">{fmtW(e.amount)}</p>
                    <p className="text-slate-500">{e.entry_date} {e.note && `/ ${e.note}`}</p>
                  </div>
                  <button onClick={() => handleRemoveCapital(e.id, e.amount)} className="text-slate-300 hover:text-red-400">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            }
          </div>
        </div>
      </div>

      {/* ── 거래 내역 탭 ─────────────────────────────────────────────────── */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">

        {/* 탭 헤더 */}
        <div className="flex items-center border-b border-slate-200 px-4 pt-3 gap-1">
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
                    : 'border-[#001f3f] text-slate-800'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
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
                className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 transition"
              >
                <RotateCcw className="w-3.5 h-3.5" /> 복원
              </button>
              <button
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
          <div className="py-16 text-center text-slate-500 text-[14px]">로딩 중...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-3 py-2 w-8">
                    <button onClick={toggleAll} className="text-slate-400 hover:text-slate-700">
                      {selected.size > 0 && selected.size === (tab === 'trash' ? trashTxs : displayTxs).length
                        ? <CheckSquare className="w-4 h-4 text-blue-600" />
                        : <Square className="w-4 h-4" />
                      }
                    </button>
                  </th>
                  {['일시', '구분', '거래처', '금액', '상태', '예약'].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-medium text-slate-500 whitespace-nowrap">{h}</th>
                  ))}
                  <th className="px-3 py-2 w-16" />
                </tr>
              </thead>
              <tbody>
                {(tab === 'trash' ? trashTxs : displayTxs).map(tx => (
                  <tr key={tx.id} className={`border-b border-slate-200 hover:bg-slate-50 ${selected.has(tx.id) ? 'bg-blue-50' : ''}`}>
                    <td className="px-3 py-2">
                      <button onClick={() => toggleSelect(tx.id)} className="text-slate-400 hover:text-blue-600">
                        {selected.has(tx.id)
                          ? <CheckSquare className="w-4 h-4 text-blue-600" />
                          : <Square className="w-4 h-4" />
                        }
                      </button>
                    </td>
                    <td className="px-3 py-2 text-[13px] text-slate-500 whitespace-nowrap">{fmtDate(tx.received_at)}</td>
                    <td className="px-3 py-2">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                        tx.transaction_type === '입금'
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-orange-50 text-orange-700'
                      }`}>
                        {tx.is_refund ? '환불' : tx.transaction_type}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-medium text-slate-800 max-w-[140px] truncate">{tx.counterparty_name || '—'}</td>
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
                        tx.is_fee                       ? 'bg-slate-100 text-slate-600'    :
                                                          'bg-red-50 text-red-600'
                      }`}>
                        {tx.is_fee ? '수수료' :
                         tx.match_status === 'auto' ? '자동매칭' :
                         tx.match_status === 'manual' ? '수동' :
                         tx.match_status === 'review' ? '검토' : '미매칭'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[13px] text-slate-500 max-w-[100px] truncate">
                      {(tx.bookings as any)?.booking_no ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {tab === 'trash' ? (
                        <div className="flex gap-1.5 justify-end">
                          <button
                            onClick={() => handleRestore([tx.id])}
                            title="복원"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleHardDelete([tx.id])}
                            title="영구 삭제"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleTrash([tx.id])}
                          title="휴지통으로 이동"
                          className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {(tab === 'trash' ? trashTxs : displayTxs).length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-slate-500 text-[14px]">
                      {tab === 'trash' ? '휴지통이 비어 있습니다.' : '거래 내역이 없습니다.'}
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
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setShowAI(false)} />
          <div className="fixed top-0 right-0 h-full w-full max-w-md bg-white border-l border-slate-200 z-50 overflow-y-auto">
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-purple-600" />
                  <h2 className="text-[16px] font-semibold text-slate-800">AI 스마트 클리닝 결과</h2>
                </div>
                <button onClick={() => setShowAI(false)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-4 h-4" />
                </button>
              </div>
              {anomalies.length === 0 ? (
                <p className="text-[14px] text-emerald-600 font-medium">이상 거래가 감지되지 않았습니다.</p>
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
          <Trash2 className="w-4 h-4 text-slate-400 shrink-0" />
          <span className="text-[14px]">
            {undoInfo.ids.length}건 이동 중
            <span className="text-slate-400 ml-1">({undoInfo.countdown}초 후 확정)</span>
          </span>
          <button
            onClick={handleUndo}
            className="text-blue-400 hover:text-blue-300 text-[14px] font-semibold ml-2 transition"
          >
            실행 취소
          </button>
        </div>
      )}

      {/* ── 일반 Toast ──────────────────────────────────────────────────── */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg text-[14px] font-medium
                         text-white animate-in slide-in-from-bottom-4 duration-200 ${
          toast.ok ? 'bg-emerald-600' : 'bg-red-600'
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
