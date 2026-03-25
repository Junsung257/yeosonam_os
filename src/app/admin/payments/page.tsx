'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';

// ─── 타입 ──────────────────────────────────────────────────────────────────────

interface ErpStats {
  totalPrice: number; totalCost: number; totalPaid: number;
  remaining: number; margin: number; bookingCount: number;
}

interface BankTransaction {
  id: string; raw_message: string;
  transaction_type: '입금' | '출금';
  counterparty_name?: string; amount: number; memo?: string;
  received_at: string; booking_id?: string;
  is_refund: boolean; is_fee: boolean;
  match_status: 'auto' | 'review' | 'unmatched' | 'manual' | 'error';
  match_confidence: number; created_at: string;
  status?: string; deleted_at?: string | null;
  bookings?: {
    id: string; booking_no?: string; package_title?: string;
    total_price?: number; paid_amount?: number; total_paid_out?: number;
    departure_date?: string;
    customers?: { name?: string };
  };
}

interface BookingFull {
  id: string; booking_no?: string; package_title?: string;
  total_price?: number; total_cost?: number;
  paid_amount?: number; total_paid_out?: number;
  departure_date?: string; status?: string;
  customers?: { name?: string };
  lead_customer_id?: string;
}

// ─── 유틸 ──────────────────────────────────────────────────────────────────────

function fmt만(n: number) { return `${(n / 10000).toFixed(1)}만`; }
function fmtDate(d?: string) { return d ? d.slice(2, 10).replace(/-/g, '-') : ''; }
function fmtTs(iso: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
  }).format(new Date(iso));
}
function getBalance(b: BookingFull) { return Math.max(0, (b.total_price || 0) - (b.paid_amount || 0)); }
function nameSim(a?: string, b?: string): number {
  if (!a || !b) return 0;
  const an = a.replace(/\s+/g, ''), bn = b.replace(/\s+/g, '');
  if (an === bn) return 1.0;
  if (an.includes(bn) || bn.includes(an)) return 0.7;
  if (an[0] === bn[0]) return 0.3;
  return 0;
}

const MATCH_LABELS: Record<string, string> = {
  auto: '자동 매칭', review: '검토 필요', unmatched: '미매칭', manual: '수동 처리', error: '파싱 오류',
};
const MATCH_COLORS: Record<string, string> = {
  auto: 'bg-emerald-50 text-emerald-700',
  review: 'bg-amber-50 text-amber-700',
  unmatched: 'bg-red-50 text-red-600',
  manual: 'bg-sky-50 text-sky-700',
  error: 'bg-red-100 text-red-700',
};

// ─── SmartCombobox ─────────────────────────────────────────────────────────────

interface SmartComboboxProps {
  tx: BankTransaction;
  bookings: BookingFull[];
  multiMode: boolean;
  multiSelected: Set<string>;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
}

function SmartCombobox({ tx, bookings, multiMode, multiSelected, onSelect, onToggle }: SmartComboboxProps) {
  const [query, setQuery] = useState(tx.counterparty_name || '');
  const [focusedIdx, setFocusedIdx] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const isRecommended = useCallback((b: BookingFull) => {
    const bal = getBalance(b);
    return bal === tx.amount && nameSim(b.customers?.name, tx.counterparty_name) >= 0.7;
  }, [tx]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    const all = bookings.filter(b => {
      if (!q) return true;
      return (
        (b.customers?.name || '').toLowerCase().includes(q) ||
        (b.package_title || '').toLowerCase().includes(q) ||
        (b.booking_no || '').toLowerCase().includes(q) ||
        (b.departure_date || '').includes(q)
      );
    });
    // 추천 항목 최상단
    return [...all.filter(isRecommended), ...all.filter(b => !isRecommended(b))];
  }, [bookings, query, isRecommended]);

  useEffect(() => { setFocusedIdx(0); }, [query]);

  // 포커스된 항목이 리스트 밖으로 나가면 스크롤
  useEffect(() => {
    const li = listRef.current?.children[focusedIdx] as HTMLElement;
    li?.scrollIntoView({ block: 'nearest' });
  }, [focusedIdx]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setFocusedIdx(i => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setFocusedIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const b = filtered[focusedIdx];
      if (!b) return;
      if (multiMode) onToggle(b.id); else onSelect(b.id);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        autoFocus
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="이름, 상품명, 출발일 검색..."
        className="w-full border border-slate-200 rounded px-3 py-2 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <ul ref={listRef} className="max-h-56 overflow-y-auto border border-slate-200 rounded divide-y divide-slate-100">
        {filtered.length === 0 && (
          <li className="px-3 py-3 text-[13px] text-slate-400 text-center">검색 결과 없음</li>
        )}
        {filtered.map((b, i) => {
          const rec = isRecommended(b);
          const bal = getBalance(b);
          const isFocused = i === focusedIdx;
          const isChecked = multiSelected.has(b.id);
          return (
            <li
              key={b.id}
              onClick={() => multiMode ? onToggle(b.id) : onSelect(b.id)}
              onMouseEnter={() => setFocusedIdx(i)}
              className={`px-3 py-2 cursor-pointer text-[13px] transition
                ${rec ? 'bg-emerald-50 border-l-2 border-emerald-400' : ''}
                ${isFocused && !rec ? 'bg-slate-50' : ''}
                ${isFocused && rec ? 'bg-emerald-100' : ''}
              `}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {multiMode && (
                    <input type="checkbox" readOnly checked={isChecked}
                      className="rounded border-slate-300 text-blue-600" />
                  )}
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-slate-400">[출발 {fmtDate(b.departure_date)}]</span>
                      <span className="font-medium text-slate-800">{b.customers?.name || '이름 없음'}</span>
                      {b.package_title && <span className="text-slate-500">· {b.package_title}</span>}
                      {rec && <span className="text-[11px] px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded-full font-semibold">추천</span>}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      판매가: {fmt만(b.total_price || 0)} / 미수금: {fmt만(bal)}
                    </div>
                  </div>
                </div>
                {b.booking_no && <span className="text-[11px] text-slate-400 shrink-0">{b.booking_no}</span>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── TSV 파싱 (일괄 가져오기용) ───────────────────────────────────────────────

interface ImportRow {
  receivedAt: string; depositAmount: number; withdrawAmount: number;
  counterpartyName: string; memo: string;
  matchStatus?: string; confidence?: number; bookingNo?: string; customerName?: string;
  include?: boolean;
}

function parseTSV(text: string): ImportRow[] {
  return text.trim().split('\n')
    .filter(l => l.trim() && !l.startsWith('거래일시'))
    .map(line => {
      const [dateTime, deposit, withdraw, counterparty, memo] = line.split('\t');
      if (!dateTime?.trim()) return null;
      const dt = dateTime.trim();
      const receivedAt = dt.length >= 16 ? `${dt.replace(' ', 'T')}:00+09:00` : new Date().toISOString();
      return {
        receivedAt,
        depositAmount:  parseInt((deposit  || '0').replace(/,/g, ''), 10) || 0,
        withdrawAmount: parseInt((withdraw || '0').replace(/,/g, ''), 10) || 0,
        counterpartyName: (counterparty || '').trim(),
        memo: (memo || '').trim(), include: true,
      };
    })
    .filter((r): r is NonNullable<typeof r> =>
      r !== null && (r.depositAmount > 0 || r.withdrawAmount > 0)) as ImportRow[];
}

// ─── 메인 페이지 ───────────────────────────────────────────────────────────────

export default function PaymentsPage() {
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [trashTxs,    setTrashTxs]    = useState<BankTransaction[]>([]);
  const [tab, setTab] = useState<'review' | 'matched' | 'unmatched'>('review');
  const [dateFilter, setDateFilter] = useState<string>('이번 달');
  const [dateDropdown, setDateDropdown] = useState(false);
  const DATE_FILTERS = ['이번 달', '지난 달', '3개월', '전체'] as const;
  const [trashOpen, setTrashOpen] = useState(false);
  const [undoInfo, setUndoInfo] = useState<{ ids: string[]; items: BankTransaction[]; countdown: number } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [bookings, setBookings] = useState<BookingFull[]>([]);
  const [erp, setErp] = useState<ErpStats | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);
  const [bulkProcessing, setBulkProcessing] = useState(false);

  // 수동 매칭 모달
  const [selectedTx, setSelectedTx] = useState<BankTransaction | null>(null);
  const [matchMode, setMatchMode] = useState<'single' | 'multi'>('single');
  const [singleBookingId, setSingleBookingId] = useState('');
  const [multiSelected, setMultiSelected] = useState<Set<string>>(new Set());
  const [overflowAction, setOverflowAction] = useState<'mileage' | 'refund' | null>(null);
  const [processing, setProcessing] = useState(false);

  // 신규 예약 생성 (입금→예약 원스톱)
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const [quickForm, setQuickForm] = useState({ packageTitle: '', departureDate: '', phone: '' });
  const [quickCreating, setQuickCreating] = useState(false);

  // 다중 선택 (일괄 삭제용)
  const [checkedTxIds, setCheckedTxIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // 일괄 가져오기 모달
  const [showImport, setShowImport] = useState(false);
  const [importStep, setImportStep] = useState<'paste' | 'preview' | 'done'>('paste');
  const [pasteText, setPasteText] = useState('');
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importResult, setImportResult] = useState<{ inserted: number; duplicates: number; errors: number; matched: number; firstError?: string } | null>(null);
  const [importing, setImporting] = useState(false);

  function showToast(msg: string, type: 'ok' | 'err' = 'ok') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  // ── 데이터 로드 ─────────────────────────────────────────────────────────────

  const loadErp = useCallback(async () => {
    try {
      const res = await fetch('/api/bookings');
      const data = await res.json();
      type B = { status?: string; total_price?: number; total_cost?: number; paid_amount?: number };
      const active: B[] = (data.bookings || []).filter((b: B) => b.status !== 'cancelled');
      const totalPrice = active.reduce((s, b) => s + (b.total_price || 0), 0);
      const totalCost  = active.reduce((s, b) => s + (b.total_cost  || 0), 0);
      const totalPaid  = active.reduce((s, b) => s + (b.paid_amount || 0), 0);
      setErp({ totalPrice, totalCost, totalPaid, remaining: totalPrice - totalPaid, margin: totalPrice - totalCost, bookingCount: active.length });
    } catch { /* non-critical */ }
  }, []);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [res, trashRes, unmatchedRes] = await Promise.all([
        fetch('/api/bank-transactions?status=active'),
        fetch('/api/bank-transactions?status=excluded'),
        fetch('/api/bank-transactions?status=active&match_status=unmatched'),
      ]);
      const [data, trashData, unmatchedData] = await Promise.all([
        res.json(), trashRes.json(), unmatchedRes.json(),
      ]);
      // 기존 500건 + 미매칭 전체 기간 병합 (중복 제거)
      const mainTxs: BankTransaction[] = data.transactions || [];
      const unmatchedTxs: BankTransaction[] = unmatchedData.transactions || [];
      const mainIds = new Set(mainTxs.map((t: BankTransaction) => t.id));
      const merged = [...mainTxs, ...unmatchedTxs.filter((u: BankTransaction) => !mainIds.has(u.id))];
      setTransactions(merged);
      setTrashTxs(trashData.transactions || []);
    } finally { setIsLoading(false); }
  }, []);

  useEffect(() => { load(); loadErp(); }, [load, loadErp]);

  useEffect(() => {
    Promise.all([
      fetch('/api/bookings?status=pending').then(r => r.json()),
      fetch('/api/bookings?status=confirmed').then(r => r.json()),
    ]).then(([d1, d2]) => setBookings([...(d1.bookings || []), ...(d2.bookings || [])]));
  }, []);

  const filtered = useMemo(() => {
    const result = transactions.filter(tx => {
      if (tab === 'review')  return tx.match_status === 'review';
      if (tab === 'matched') return tx.match_status === 'auto' || tx.match_status === 'manual';
      // unmatched 탭: error(파싱 오류)도 최우선 표시
      return tx.match_status === 'unmatched' || tx.match_status === 'error';
    });
    // error → unmatched 순으로 정렬 (error 최상단)
    if (tab === 'unmatched') {
      result.sort((a, b) => {
        const pri = (s: string) => s === 'error' ? 0 : 1;
        return pri(a.match_status) - pri(b.match_status);
      });
    }
    return result;
  }, [transactions, tab]);

  const reviewCount    = transactions.filter(t => t.match_status === 'review').length;
  const unmatchedCount = transactions.filter(t => t.match_status === 'unmatched' || t.match_status === 'error').length;
  const matchedCount   = transactions.filter(t => t.match_status === 'auto' || t.match_status === 'manual').length;

  const collectionRate = useMemo(() =>
    erp ? Math.min(100, Math.round((erp.totalPaid / Math.max(erp.totalPrice, 1)) * 100)) : 0,
    [erp]
  );
  const safeRemaining = useMemo(() =>
    erp ? Math.max(0, erp.totalPrice - erp.totalPaid) : 0,
    [erp]
  );
  const unmatchedAmount = useMemo(() =>
    transactions.filter(t => t.match_status === 'unmatched' || t.match_status === 'error')
      .reduce((s, t) => s + t.amount, 0),
    [transactions]
  );

  // ── 입금액 재동기화 ─────────────────────────────────────────────────────────

  async function handleResync() {
    setBulkProcessing(true);
    try {
      const res = await fetch('/api/bank-transactions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resync', transactionId: 'resync' }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || '처리 실패', 'err'); return; }
      showToast(`${data.updated}개 예약 입금액 재동기화 완료`, 'ok');
      load(); loadErp();
    } catch { showToast('처리 중 오류', 'err'); }
    finally { setBulkProcessing(false); }
  }

  // ── 원클릭 일괄 자동 매칭 ──────────────────────────────────────────────────

  async function handleBulkAuto() {
    setBulkProcessing(true);
    try {
      const res = await fetch('/api/bank-transactions', { method: 'PUT' });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || '처리 실패', 'err'); return; }
      showToast(`${data.matched}건 자동 매칭 완료 (스킵 ${data.skipped}건)`, 'ok');
      load(); loadErp();
    } catch { showToast('처리 중 오류', 'err'); }
    finally { setBulkProcessing(false); }
  }

  // ── 수동 매칭 모달 ──────────────────────────────────────────────────────────

  function openMatchModal(tx: BankTransaction) {
    setSelectedTx(tx);
    setMatchMode('single');
    setSingleBookingId('');
    setMultiSelected(new Set());
    setOverflowAction(null);
  }

  const selectedBooking = useMemo(() =>
    bookings.find(b => b.id === singleBookingId) || null,
    [bookings, singleBookingId]
  );

  const overflow = useMemo(() => {
    if (!selectedTx || !selectedBooking) return 0;
    const bal = getBalance(selectedBooking);
    return selectedTx.amount > bal ? selectedTx.amount - bal : 0;
  }, [selectedTx, selectedBooking]);

  const multiTotal = useMemo(() =>
    Array.from(multiSelected).reduce((s, id) => {
      const b = bookings.find(x => x.id === id);
      return s + (b ? getBalance(b) : 0);
    }, 0),
    [multiSelected, bookings]
  );

  async function handleMatch() {
    if (!selectedTx) return;
    setProcessing(true);
    try {
      let body: Record<string, unknown>;

      if (matchMode === 'multi') {
        const splits = Array.from(multiSelected).map(id => {
          const b = bookings.find(x => x.id === id);
          return { bookingId: id, amount: b ? getBalance(b) : 0 };
        });
        body = { action: 'multi', transactionId: selectedTx.id, splits };
      } else {
        if (!singleBookingId) return;
        body = {
          action: 'match',
          transactionId: selectedTx.id,
          bookingId: singleBookingId,
          ...(overflowAction ? { overflowAction } : {}),
        };
      }

      const res = await fetch('/api/bank-transactions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) { showToast((await res.json()).error || '처리 실패', 'err'); return; }

      // Optimistic update
      setTransactions(prev => prev.map(t =>
        t.id === selectedTx.id
          ? { ...t, match_status: 'manual', booking_id: singleBookingId || undefined }
          : t
      ));
      setSelectedTx(null);
      showToast('매칭 완료');
      loadErp();
    } catch { showToast('처리 중 오류', 'err'); }
    finally { setProcessing(false); }
  }

  async function handleFee() {
    if (!selectedTx) return;
    setProcessing(true);
    try {
      const res = await fetch('/api/bank-transactions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'fee', transactionId: selectedTx.id }),
      });
      if (!res.ok) { showToast((await res.json()).error || '처리 실패', 'err'); return; }
      setTransactions(prev => prev.map(t =>
        t.id === selectedTx.id ? { ...t, match_status: 'manual', is_fee: true } : t
      ));
      setSelectedTx(null);
      showToast('수수료 처리 완료');
    } catch { showToast('처리 중 오류', 'err'); }
    finally { setProcessing(false); }
  }

  async function handleUndo(txId: string) {
    if (!confirm('매칭을 취소하고 원상복구 하시겠습니까?')) return;
    try {
      const res = await fetch('/api/bank-transactions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'undo', transactionId: txId }),
      });
      if (!res.ok) { showToast((await res.json()).error || '처리 실패', 'err'); return; }
      // Optimistic
      setTransactions(prev => prev.map(t =>
        t.id === txId ? { ...t, match_status: 'unmatched', booking_id: undefined } : t
      ));
      showToast('매칭 취소 완료');
      loadErp();
    } catch { showToast('처리 중 오류', 'err'); }
  }

  // ── 일괄 가져오기 ──────────────────────────────────────────────────────────

  async function handlePreview() {
    const rows = parseTSV(pasteText);
    if (rows.length === 0) { alert('파싱된 행이 없습니다.'); return; }
    setImporting(true);
    try {
      const res = await fetch('/api/bank-transactions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, preview: true }),
      });
      const data = await res.json();
      setImportRows((data.rows || []).map((r: any, i: number) => ({
        ...rows[i], matchStatus: r.matchStatus, confidence: r.confidence,
        bookingNo: r.bookingNo, customerName: r.customerName, include: true,
      })));
      setImportStep('preview');
    } finally { setImporting(false); }
  }

  async function handleImport() {
    const selected = importRows.filter(r => r.include);
    if (selected.length === 0) { alert('등록할 행을 선택하세요.'); return; }
    setImporting(true);
    try {
      const res = await fetch('/api/bank-transactions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: selected }),
      });
      const data = await res.json();
      setImportResult(data);
      setImportStep('done');
      load(); loadErp();
    } finally { setImporting(false); }
  }

  // ── 소프트 삭제 (5초 Undo) ──────────────────────────────────────────────────

  function handleTrashSingle(tx: BankTransaction) {
    setTransactions(prev => prev.filter(t => t.id !== tx.id));

    if (undoTimerRef.current) {
      clearInterval(undoTimerRef.current);
      if (undoInfo) {
        fetch('/api/bank-transactions', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'trash_bulk', ids: undoInfo.ids }),
        }).then(() => setTrashTxs(prev => [...undoInfo.items.map(i => ({ ...i, status: 'excluded' })), ...prev]));
      }
    }

    let countdown = 5;
    setUndoInfo({ ids: [tx.id], items: [tx], countdown });

    undoTimerRef.current = setInterval(() => {
      countdown -= 1;
      setUndoInfo(prev => prev ? { ...prev, countdown } : null);
      if (countdown <= 0) {
        clearInterval(undoTimerRef.current!);
        fetch('/api/bank-transactions', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'trash_bulk', ids: [tx.id] }),
        }).then(() => setTrashTxs(prev => [{ ...tx, status: 'excluded' }, ...prev]));
        setUndoInfo(null);
      }
    }, 1000);
  }

  function handleUndoTrash() {
    if (!undoInfo) return;
    clearInterval(undoTimerRef.current!);
    setTransactions(prev =>
      [...undoInfo.items, ...prev].sort(
        (a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime(),
      ),
    );
    setUndoInfo(null);
    showToast('휴지통 이동이 취소되었습니다.', 'ok');
  }

  async function handleRestoreSingle(tx: BankTransaction) {
    setTrashTxs(prev => prev.filter(t => t.id !== tx.id));
    setTransactions(prev =>
      [{ ...tx, status: 'active' }, ...prev].sort(
        (a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime(),
      ),
    );
    await fetch('/api/bank-transactions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'restore', transactionId: tx.id }),
    });
    showToast('복원 완료', 'ok');
  }

  async function handleHardDeleteSingle(tx: BankTransaction) {
    if (!confirm('영구 삭제합니다. 복원 불가능합니다.')) return;
    setTrashTxs(prev => prev.filter(t => t.id !== tx.id));
    await fetch('/api/bank-transactions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'hard_delete', transactionId: tx.id }),
    });
    showToast('영구 삭제됨', 'err');
  }

  function closeImport() {
    setShowImport(false); setImportStep('paste'); setPasteText('');
    setImportRows([]); setImportResult(null);
  }

  // ── 렌더 ────────────────────────────────────────────────────────────────────

  let matchBtnDisabled = processing;
  if (!matchBtnDisabled) {
    matchBtnDisabled = matchMode === 'single' ? !singleBookingId : (multiSelected.size === 0);
  }

  return (
    <>
      {toast && (
        <div className={toast.type === 'err' ? 'fixed top-6 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-lg text-sm font-medium text-white bg-red-500' : 'fixed top-6 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-lg text-sm font-medium text-white bg-slate-800'}>
          {toast.msg}
        </div>
      )}

      {/* 헤더 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[16px] font-semibold text-slate-800">입금 관리</h1>
          <p className="text-[13px] text-slate-500 mt-0.5">Slack(Clobe.ai) 입출금 자동 파싱 및 예약 매칭</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleResync} disabled={bulkProcessing}
            className="px-3 py-2 bg-[#001f3f] text-white text-[13px] rounded hover:bg-blue-900 disabled:bg-slate-300 transition">
            {bulkProcessing ? '처리 중...' : '입금 재동기화'}
          </button>
          <button onClick={handleBulkAuto} disabled={bulkProcessing}
            className="px-3 py-2 bg-[#001f3f] text-white text-[13px] rounded hover:bg-blue-900 disabled:bg-slate-300 transition">
            {bulkProcessing ? '처리 중...' : '일괄 자동 매칭'}
          </button>
          <button onClick={() => setShowImport(true)}
            className="px-3 py-2 bg-[#001f3f] text-white text-[13px] rounded hover:bg-blue-900 transition">
            과거 내역 가져오기
          </button>
          <button onClick={() => { load(); loadErp(); }}
            className="px-3 py-2 text-[13px] text-slate-700 border border-slate-300 rounded bg-white hover:bg-slate-50 transition">
            새로고침
          </button>
        </div>
      </div>

      {/* ── BI 통계 (2컬럼) ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-[1fr_320px] gap-4 mb-5">

        {/* 좌: 매출 vs 수금 현황 */}
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[14px] font-semibold text-slate-800">매출 vs 수금 현황</span>
            <span className="text-[11px] text-slate-400">취소 제외 {erp?.bookingCount ?? 0}건</span>
          </div>

          {/* 총 판매가 */}
          <div className="flex items-baseline gap-2 mb-3">
            <span className="text-[11px] text-slate-400">총 판매가</span>
            <span className="text-xl font-bold text-slate-800 tabular-nums">
              {erp ? `${(erp.totalPrice / 10000).toFixed(0)}만원` : '—'}
            </span>
          </div>

          {/* 수금률 Progress Bar */}
          <div className="mb-3">
            <div className="flex justify-between text-[11px] text-slate-500 mb-1.5">
              <span>수금률</span>
              <span className="font-semibold text-blue-600">{collectionRate}%</span>
            </div>
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 rounded-full transition-all duration-700"
                style={{ width: `${collectionRate}%` }}
              />
            </div>
          </div>

          {/* 매칭 완료 / 미입금 잔액 */}
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="bg-white border border-slate-200 rounded-lg px-3 py-2.5">
              <p className="text-[11px] text-slate-500 font-medium mb-0.5">매칭 완료</p>
              <p className="text-[14px] font-bold text-blue-600 tabular-nums">
                {erp ? `${(erp.totalPaid / 10000).toFixed(0)}만원` : '—'}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-lg px-3 py-2.5">
              <p className="text-[11px] text-slate-500 font-medium mb-0.5">미입금 잔액</p>
              <p className="text-[14px] font-bold text-red-600 tabular-nums">
                {erp ? `${(safeRemaining / 10000).toFixed(0)}만원` : '—'}
              </p>
            </div>
          </div>
        </div>

        {/* 우: Date Filter + 예상마진 + 미매칭 잔액 */}
        <div className="flex flex-col gap-3">

          {/* Date Filter 드롭다운 */}
          <div className="relative self-end flex items-center gap-2">
            {tab === 'unmatched' && (
              <span className="px-2 py-1 bg-amber-50 border border-amber-200 text-amber-700 rounded text-[11px] font-medium whitespace-nowrap">
                전체 기간의 미매칭 내역입니다
              </span>
            )}
            <div className="relative">
              <button
                onClick={() => { if (tab !== 'unmatched') setDateDropdown(o => !o); }}
                disabled={tab === 'unmatched'}
                className={`flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded text-[13px] transition
                  ${tab === 'unmatched' ? 'opacity-40 cursor-not-allowed text-slate-400' : 'text-slate-700 hover:bg-slate-50'}`}
              >
                <span>{tab === 'unmatched' ? '전체' : dateFilter}</span>
                <span className="text-slate-400 text-[11px]">▾</span>
              </button>
              {dateDropdown && tab !== 'unmatched' && (
                <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded z-20 py-1 min-w-[110px]">
                  {DATE_FILTERS.map(f => (
                    <button key={f} onClick={() => { setDateFilter(f); setDateDropdown(false); }}
                      className={`w-full text-left px-3 py-1.5 text-[13px] hover:bg-slate-50 transition
                        ${dateFilter === f ? 'text-blue-600 font-medium' : 'text-slate-700'}`}>
                      {f}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 예상 마진 카드 */}
          <div className="bg-white border border-slate-200 rounded-lg px-4 py-3 flex-1">
            <p className="text-[11px] text-slate-500 font-semibold mb-1">예상 마진</p>
            <p className="text-xl font-bold text-emerald-600 tabular-nums leading-tight">
              {erp ? `${(erp.margin / 10000).toFixed(0)}만원` : '—'}
            </p>
            <p className="text-[11px] text-slate-400 mt-1">
              {erp ? `총 원가 ${(erp.totalCost / 10000).toFixed(0)}만원` : '데이터 로드 중'}
            </p>
          </div>

          {/* 미매칭 잔액 경고 카드 */}
          <div className={`border rounded-lg px-4 py-3 flex-1 bg-white ${unmatchedAmount > 0 ? 'border-amber-300' : 'border-slate-200'}`}>
            <p className={`text-[11px] font-semibold mb-1 ${unmatchedAmount > 0 ? 'text-amber-600' : 'text-slate-500'}`}>
              미매칭 잔액
            </p>
            <p className={`text-xl font-bold tabular-nums leading-tight ${unmatchedAmount > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
              {(unmatchedAmount / 10000).toFixed(0)}만원
            </p>
            <p className={`text-[11px] mt-1 ${unmatchedAmount > 0 ? 'text-amber-500' : 'text-slate-400'}`}>
              주인을 찾아야 할 금액
            </p>
          </div>
        </div>
      </div>

      {/* ── Metric Filter Cards (탭 겸용) ──────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {([
          { id: 'review'    as const, label: '검토 필요', count: reviewCount,    active: 'border-amber-400 bg-amber-50', num: 'text-amber-700' },
          { id: 'matched'   as const, label: '매칭 완료', count: matchedCount,   active: 'border-emerald-400 bg-emerald-50', num: 'text-emerald-700' },
          { id: 'unmatched' as const, label: '미매칭',    count: unmatchedCount, active: 'border-red-400 bg-red-50', num: 'text-red-600' },
        ] as const).map(card => (
          <button key={card.id} onClick={() => setTab(card.id)}
            className={`p-4 rounded-lg border text-left transition-all cursor-pointer
              ${tab === card.id
                ? card.active
                : 'border-slate-200 bg-white hover:border-slate-300'}`}>
            <div className={`text-2xl font-bold tabular-nums ${tab === card.id ? card.num : 'text-slate-800'}`}>
              {card.count}
            </div>
            <div className="text-[13px] text-slate-500 mt-1.5 font-medium">
              {card.label}
            </div>
          </button>
        ))}
      </div>

      {/* 트랜잭션 테이블 */}
      {isLoading ? (
        <div className="bg-white rounded-lg border border-slate-200 p-8 text-center text-slate-400 text-[14px]">불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-slate-200 p-12 text-center text-slate-500">
          <p className="text-[14px]">해당 항목이 없습니다</p>
          {tab === 'unmatched' && <p className="text-[13px] text-slate-400 mt-2">일괄 자동 매칭 버튼을 눌러보세요</p>}
        </div>
      ) : (
        <>
        {checkedTxIds.size > 0 && (
          <div className="flex items-center gap-3 bg-slate-800 text-white px-4 py-2 rounded-lg mb-2">
            <span className="text-[13px] font-medium">{checkedTxIds.size}건 선택</span>
            <button
              disabled={bulkDeleting}
              onClick={async () => {
                if (!confirm(checkedTxIds.size + '건을 휴지통으로 이동하시겠습니까?')) return;
                setBulkDeleting(true);
                try {
                  const res = await fetch('/api/bank-transactions', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'trash_bulk', ids: [...checkedTxIds] }),
                  });
                  if (!res.ok) throw new Error('삭제 실패');
                  const cnt = checkedTxIds.size;
                  setCheckedTxIds(new Set());
                  showToast(cnt + '건 휴지통 이동', 'ok');
                  load();
                } catch { showToast('삭제 실패', 'err'); }
                finally { setBulkDeleting(false); }
              }}
              className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-[12px] rounded transition disabled:bg-red-300"
            >
              {bulkDeleting ? '처리 중...' : '일괄 삭제'}
            </button>
            <button onClick={() => setCheckedTxIds(new Set())}
              className="px-3 py-1 bg-slate-600 hover:bg-slate-500 text-white text-[12px] rounded transition">
              선택 해제
            </button>
          </div>
        )}

        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="w-8 px-2 py-2">
                  <input type="checkbox"
                    checked={filtered.length > 0 && filtered.every(t => checkedTxIds.has(t.id))}
                    onChange={e => {
                      if (e.target.checked) setCheckedTxIds(new Set(filtered.map(t => t.id)));
                      else setCheckedTxIds(new Set());
                    }}
                    className="rounded border-slate-300" />
                </th>
                <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">수신 시각</th>
                <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">구분</th>
                <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">거래처</th>
                <th className="text-right px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">금액</th>
                <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">연결된 예약</th>
                <th className="text-center px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">신뢰도</th>
                <th className="text-center px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">상태</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(tx => (
                <tr key={tx.id} className={`border-b border-slate-200 transition ${tx.match_status === 'error' ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-slate-50'}`}>
                  <td className="w-8 px-2 py-2">
                    <input type="checkbox"
                      checked={checkedTxIds.has(tx.id)}
                      onChange={e => {
                        const next = new Set(checkedTxIds);
                        e.target.checked ? next.add(tx.id) : next.delete(tx.id);
                        setCheckedTxIds(next);
                      }}
                      className="rounded border-slate-300" />
                  </td>
                  <td className="px-3 py-2 text-[13px] text-slate-500 whitespace-nowrap">
                    {fmtTs(tx.received_at)}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full
                      ${tx.transaction_type === '입금'
                        ? tx.is_refund ? 'bg-orange-50 text-orange-600' : 'bg-blue-50 text-blue-600'
                        : tx.is_fee ? 'bg-slate-100 text-slate-500' : 'bg-red-50 text-red-600'}`}>
                      {tx.is_refund ? '환불' : tx.is_fee ? '수수료' : tx.transaction_type}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[13px] font-medium text-slate-800">{tx.counterparty_name || '-'}</td>
                  <td className="px-3 py-2 text-right">
                    <span className={`text-[13px] font-bold tabular-nums
                      ${tx.transaction_type === '입금'
                        ? tx.is_refund ? 'text-orange-600' : 'text-blue-600'
                        : tx.is_fee ? 'text-slate-500' : 'text-red-500'}`}>
                      {tx.transaction_type === '입금' ? '+' : '-'}{tx.amount.toLocaleString()}원
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[13px] text-slate-500">
                    {tx.bookings ? (
                      <span>{tx.bookings.customers?.name} · {tx.bookings.package_title || '상품 미지정'}</span>
                    ) : <span className="text-slate-400">-</span>}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {tx.booking_id && (
                      <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full
                        ${tx.match_confidence >= 0.9 ? 'bg-emerald-50 text-emerald-700'
                          : tx.match_confidence >= 0.5 ? 'bg-amber-50 text-amber-700'
                          : 'bg-slate-100 text-slate-500'}`}>
                        {Math.round(tx.match_confidence * 100)}%
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${MATCH_COLORS[tx.match_status] || 'bg-slate-100 text-slate-500'}`}>
                      {MATCH_LABELS[tx.match_status] || tx.match_status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <div className="flex items-center gap-1.5 justify-end">
                      {(tx.match_status === 'review' || tx.match_status === 'unmatched' || tx.match_status === 'error') && !tx.is_refund && (
                        <button onClick={() => openMatchModal(tx)}
                          className="px-3 py-1 bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 rounded text-[13px] font-medium transition-colors whitespace-nowrap">
                          수동 매칭
                        </button>
                      )}
                      {(tx.match_status === 'auto' || tx.match_status === 'manual') && (
                        <button onClick={() => handleUndo(tx.id)}
                          className="px-3 py-1 bg-white border border-slate-300 text-red-500 hover:bg-red-50 rounded text-[13px] font-medium transition-colors whitespace-nowrap">
                          매칭 취소
                        </button>
                      )}
                      <button onClick={() => handleTrashSingle(tx)}
                        title="휴지통으로 이동"
                        className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      {/* ── 휴지통 아코디언 ─────────────────────────────────────────────────── */}
      {trashTxs.length > 0 && (
        <div className="mt-4">
          <button
            onClick={() => setTrashOpen(o => !o)}
            className="w-full flex items-center justify-between px-4 py-3 bg-white rounded-lg border border-slate-200 text-[13px] text-slate-500 hover:bg-slate-50 transition"
          >
            <span className="flex items-center gap-2">
              <span>제외된 내역 {trashTxs.length}건 보기</span>
            </span>
            <span className={`transition-transform duration-200 ${trashOpen ? 'rotate-180' : ''}`}>▼</span>
          </button>

          {trashOpen && (
            <div className="mt-2 bg-white rounded-lg border border-slate-200 overflow-hidden">
              <table className="w-full text-[13px]">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-3 py-2 text-slate-500 font-medium text-[11px]">수신 시각</th>
                    <th className="text-left px-3 py-2 text-slate-500 font-medium text-[11px]">거래처</th>
                    <th className="text-right px-3 py-2 text-slate-500 font-medium text-[11px]">금액</th>
                    <th className="text-left px-3 py-2 text-slate-500 font-medium text-[11px]">제외 일시</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {trashTxs.map(tx => (
                    <tr key={tx.id} className="border-b border-slate-200 hover:bg-slate-50 transition opacity-60">
                      <td className="px-3 py-2 text-slate-400 text-[11px]">
                        {new Date(tx.received_at).toLocaleString('ko-KR', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })}
                      </td>
                      <td className="px-3 py-2 text-slate-500">{tx.counterparty_name || '-'}</td>
                      <td className="px-3 py-2 text-right font-medium text-slate-700">{tx.amount.toLocaleString()}원</td>
                      <td className="px-3 py-2 text-slate-400 text-[11px]">
                        {tx.deleted_at ? new Date(tx.deleted_at).toLocaleDateString('ko-KR', { month:'2-digit', day:'2-digit' }) : '-'}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <div className="flex items-center gap-2 justify-end">
                          <button onClick={() => handleRestoreSingle(tx)}
                            className="text-[11px] text-blue-600 hover:underline">복원</button>
                          <button onClick={() => handleHardDeleteSingle(tx)}
                            className="text-[11px] text-red-400 hover:text-red-600 hover:underline">영구삭제</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── 수동 매칭 슬라이드 패널 ──────────────────────────────────────────── */}
      {selectedTx && (
        <div className="fixed inset-0 bg-black/30 z-50" onClick={() => setSelectedTx(null)}>
          <div
            className="fixed top-0 right-0 h-full w-full max-w-lg bg-white border-l border-slate-200 flex flex-col z-50"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-5 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-[16px] font-semibold text-slate-800">수동 예약 매칭</h3>
                <p className="text-[13px] text-slate-500 mt-0.5">
                  {selectedTx.transaction_type === '입금' ? '고객 입금' : '랜드사 출금'} —&nbsp;
                  <strong className="text-slate-800">{selectedTx.counterparty_name}</strong>&nbsp;
                  <span className="font-bold text-slate-800">{selectedTx.amount.toLocaleString()}원</span>
                </p>
              </div>
              <button onClick={() => setSelectedTx(null)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
            </div>

            <div className="p-5 flex-1 overflow-y-auto space-y-4">
              {/* 단일/다중 모드 토글 */}
              <div className="flex gap-2">
                <button onClick={() => setMatchMode('single')}
                  className={`flex-1 py-1.5 rounded text-[13px] font-medium transition
                    ${matchMode === 'single' ? 'bg-[#001f3f] text-white' : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
                  단일 예약
                </button>
                <button onClick={() => setMatchMode('multi')}
                  className={`flex-1 py-1.5 rounded text-[13px] font-medium transition
                    ${matchMode === 'multi' ? 'bg-[#001f3f] text-white' : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
                  다중 합산 결제
                </button>
              </div>

              {/* SmartCombobox */}
              <SmartCombobox
                tx={selectedTx}
                bookings={bookings}
                multiMode={matchMode === 'multi'}
                multiSelected={multiSelected}
                onSelect={id => { setSingleBookingId(id); setOverflowAction(null); setShowQuickCreate(false); }}
                onToggle={id => setMultiSelected(prev => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id); else next.add(id);
                  return next;
                })}
              />

              {/* 신규 예약 생성 (입금→고객→예약→매칭 원스톱) */}
              {!showQuickCreate ? (
                <button
                  onClick={() => {
                    setShowQuickCreate(true);
                    setQuickForm({ packageTitle: '', departureDate: '', phone: '' });
                  }}
                  className="w-full py-2 border border-dashed border-slate-300 rounded text-[13px] text-slate-500 hover:border-[#001f3f] hover:text-[#001f3f] transition"
                >
                  + 신규 고객 & 예약 생성 후 매칭
                </button>
              ) : (
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-[13px] font-semibold text-slate-800">신규 예약 생성</h4>
                    <button onClick={() => setShowQuickCreate(false)} className="text-slate-400 hover:text-slate-600 text-[11px]">닫기</button>
                  </div>

                  <div className="bg-blue-50 border border-blue-200 rounded p-2 text-[11px] text-blue-700">
                    입금자 <strong>{selectedTx.counterparty_name}</strong> 이름으로 고객이 자동 생성되고,
                    <strong> {selectedTx.amount.toLocaleString()}원</strong> 예약이 만들어진 후 즉시 매칭됩니다.
                  </div>

                  <div>
                    <label className="text-[11px] text-slate-500 block mb-1">상품명 (선택)</label>
                    <input
                      value={quickForm.packageTitle}
                      onChange={e => setQuickForm(f => ({ ...f, packageTitle: e.target.value }))}
                      placeholder="미입력 시 '미지정 상품'"
                      className="w-full border border-slate-200 rounded px-3 py-1.5 text-[13px] focus:ring-1 focus:ring-[#005d90]"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[11px] text-slate-500 block mb-1">출발일 (선택)</label>
                      <input
                        type="date"
                        value={quickForm.departureDate}
                        onChange={e => setQuickForm(f => ({ ...f, departureDate: e.target.value }))}
                        className="w-full border border-slate-200 rounded px-3 py-1.5 text-[13px] focus:ring-1 focus:ring-[#005d90]"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-slate-500 block mb-1">연락처 (선택)</label>
                      <input
                        value={quickForm.phone}
                        onChange={e => setQuickForm(f => ({ ...f, phone: e.target.value }))}
                        placeholder="010-0000-0000"
                        className="w-full border border-slate-200 rounded px-3 py-1.5 text-[13px] focus:ring-1 focus:ring-[#005d90]"
                      />
                    </div>
                  </div>

                  <button
                    disabled={quickCreating}
                    onClick={async () => {
                      if (!selectedTx) return;
                      setQuickCreating(true);
                      try {
                        // 1. 고객 생성 (입금자명으로)
                        const custRes = await fetch('/api/customers', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            name: selectedTx.counterparty_name || '미확인 고객',
                            phone: quickForm.phone || undefined,
                          }),
                        });
                        const custData = await custRes.json();
                        const customerId = custData.customer?.id;
                        if (!customerId) throw new Error(custData.error || '고객 생성 실패');

                        // 2. 예약 생성
                        const bookRes = await fetch('/api/bookings', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            leadCustomerId: customerId,
                            packageTitle: quickForm.packageTitle || '미지정 상품',
                            adultCount: 1,
                            childCount: 0,
                            adultCost: 0,
                            adultPrice: selectedTx.amount,
                            childCost: 0,
                            childPrice: 0,
                            departureDate: quickForm.departureDate || undefined,
                          }),
                        });
                        const bookData = await bookRes.json();
                        const bookingId = bookData.booking?.id;
                        if (!bookingId) throw new Error(bookData.error || '예약 생성 실패');

                        // 3. 입금 매칭 (bank-transactions PATCH는 transactionId + bookingId 필요)
                        const matchRes = await fetch('/api/bank-transactions', {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            action: 'match',
                            transactionId: selectedTx.id,
                            bookingId: bookingId,
                          }),
                        });
                        if (!matchRes.ok) {
                          const errData = await matchRes.json().catch(() => ({}));
                          throw new Error(errData.error || '매칭 실패');
                        }
                        // applyToBooking이 paid_amount를 자동으로 업데이트하므로 별도 PATCH 불필요

                        setSelectedTx(null);
                        setShowQuickCreate(false);
                        showToast(`${selectedTx.counterparty_name} — 고객 생성 + 예약 생성 + 매칭 완료`);
                        load();
                      } catch (err) {
                        showToast(err instanceof Error ? err.message : '처리 실패');
                      } finally {
                        setQuickCreating(false);
                      }
                    }}
                    className="w-full py-2 bg-[#001f3f] text-white rounded text-[13px] font-medium hover:bg-blue-900 disabled:bg-slate-300 transition"
                  >
                    {quickCreating ? '처리 중...' : `고객 생성 + 예약 생성 + ${selectedTx.amount.toLocaleString()}원 매칭`}
                  </button>
                </div>
              )}

              {/* 단일 모드: 금액 비교 */}
              {matchMode === 'single' && selectedBooking && (
                <div className={`rounded-lg p-3 text-[13px] border ${overflow > 0 ? 'bg-amber-50 border-amber-300' : 'bg-emerald-50 border-emerald-300'}`}>
                  {overflow > 0 ? (
                    <div>
                      <p className="font-semibold text-amber-800 mb-2">
                        과오납 -- 입금액이 잔금보다 {overflow.toLocaleString()}원 초과
                      </p>
                      <div className="flex gap-2">
                        <button onClick={() => setOverflowAction('mileage')}
                          className={`flex-1 py-1.5 rounded text-[11px] font-medium transition border
                            ${overflowAction === 'mileage' ? 'bg-amber-500 text-white border-amber-500' : 'bg-white border-amber-300 text-amber-700 hover:bg-amber-50'}`}>
                          마일리지 적립
                        </button>
                        <button onClick={() => setOverflowAction('refund')}
                          className={`flex-1 py-1.5 rounded text-[11px] font-medium transition border
                            ${overflowAction === 'refund' ? 'bg-amber-500 text-white border-amber-500' : 'bg-white border-amber-300 text-amber-700 hover:bg-amber-50'}`}>
                          환불 대기금
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-emerald-800 font-medium">
                      금액 일치 -- 잔금 {getBalance(selectedBooking).toLocaleString()}원 = 입금액 {selectedTx.amount.toLocaleString()}원
                    </p>
                  )}
                </div>
              )}

              {/* 다중 모드: 합계 */}
              {matchMode === 'multi' && multiSelected.size > 0 && (
                <div className={`rounded-lg p-3 text-[13px] border ${
                  Math.abs(multiTotal - selectedTx.amount) <= 500
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                    : 'bg-amber-50 border-amber-300 text-amber-800'
                }`}>
                  <p className="font-medium">
                    선택 {multiSelected.size}건 잔금 합계: <strong>{multiTotal.toLocaleString()}원</strong>
                    &nbsp;/ 입금액: <strong>{selectedTx.amount.toLocaleString()}원</strong>
                    &nbsp;{Math.abs(multiTotal - selectedTx.amount) <= 500
                      ? '일치' : `차액 ${(selectedTx.amount - multiTotal).toLocaleString()}원`}
                  </p>
                </div>
              )}
            </div>

            {/* 하단 버튼 */}
            <div className="p-4 border-t border-slate-200 flex gap-2">
              <button onClick={handleFee} disabled={processing}
                className="px-3 py-2 bg-white border border-slate-300 text-slate-700 rounded text-[11px] hover:bg-slate-50 transition">
                수수료 처리
              </button>
              <div className="flex-1" />
              <button onClick={() => setSelectedTx(null)}
                className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded text-[13px] hover:bg-slate-50 transition">
                취소
              </button>
              <button onClick={handleMatch} disabled={matchBtnDisabled}
                className="px-4 py-2 bg-[#001f3f] text-white rounded text-[13px] font-medium hover:bg-blue-900 disabled:bg-slate-300 transition">
                {processing ? '처리 중...' : '매칭 확정'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 5초 Undo 토스트 ─────────────────────────────────────────────────── */}
      {undoInfo && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-4
                        bg-slate-800 text-white px-5 py-3.5 rounded-lg">
          <span className="text-[13px]">
            1건 휴지통 이동 중
            <span className="text-slate-400 ml-1">({undoInfo.countdown}초 후 확정)</span>
          </span>
          <button onClick={handleUndoTrash}
            className="text-blue-400 hover:text-blue-300 text-[13px] font-semibold ml-2 transition">
            실행 취소
          </button>
        </div>
      )}

      {/* ── 과거 내역 일괄 가져오기 슬라이드 패널 ───────────────────────────── */}
      {showImport && (
        <div className="fixed inset-0 bg-black/30 z-50" onClick={closeImport}>
          <div
            className="fixed top-0 right-0 h-full w-full max-w-3xl bg-white border-l border-slate-200 flex flex-col z-50"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-5 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-[16px] font-semibold text-slate-800">과거 입출금 내역 일괄 등록</h3>
              <button onClick={closeImport} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
            </div>

            {importStep === 'paste' && (
              <div className="p-5 flex flex-col gap-4 flex-1 overflow-auto">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-[11px] text-blue-800">
                  컬럼 순서: 거래일시 → 입금액 → 출금액 → 적요 → 메모 (탭 구분)
                </div>
                <textarea value={pasteText} onChange={e => setPasteText(e.target.value)}
                  placeholder="스프레드시트에서 복사 후 붙여넣기"
                  className="flex-1 min-h-[280px] border border-slate-200 rounded px-3 py-2 text-[11px] font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
                <div className="flex gap-3">
                  <button onClick={handlePreview} disabled={importing || !pasteText.trim()}
                    className="flex-1 bg-[#001f3f] text-white py-2 rounded text-[13px] font-medium hover:bg-blue-900 disabled:bg-slate-300 transition">
                    {importing ? '파싱 중...' : '미리보기'}
                  </button>
                  <button onClick={closeImport} className="flex-1 bg-white border border-slate-300 text-slate-700 py-2 rounded text-[13px] hover:bg-slate-50 transition">취소</button>
                </div>
              </div>
            )}

            {importStep === 'preview' && (
              <div className="flex flex-col flex-1 overflow-hidden">
                <div className="flex-1 overflow-auto">
                  <table className="w-full text-[11px]">
                    <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 w-8 text-center">
                          <input type="checkbox" checked={importRows.every(r => r.include)}
                            onChange={e => setImportRows(prev => prev.map(r => ({ ...r, include: e.target.checked })))} />
                        </th>
                        <th className="px-3 py-2 text-left text-slate-500">거래일시</th>
                        <th className="px-3 py-2 text-left text-slate-500">구분</th>
                        <th className="px-3 py-2 text-right text-slate-500">금액</th>
                        <th className="px-3 py-2 text-left text-slate-500">적요</th>
                        <th className="px-3 py-2 text-left text-slate-500">메모</th>
                        <th className="px-3 py-2 text-left text-slate-500">매칭 예약</th>
                        <th className="px-3 py-2 text-center text-slate-500">신뢰도</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importRows.map((r, i) => (
                        <tr key={i} className={`border-b border-slate-200 hover:bg-slate-50 ${!r.include ? 'opacity-40' : ''}`}>
                          <td className="px-3 py-2 text-center">
                            <input type="checkbox" checked={r.include}
                              onChange={e => setImportRows(prev => prev.map((row, j) => j === i ? { ...row, include: e.target.checked } : row))} />
                          </td>
                          <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{r.receivedAt.replace('T', ' ').slice(0, 16)}</td>
                          <td className="px-3 py-2">
                            <span className={`px-1.5 py-0.5 rounded-full font-medium text-[11px] ${r.depositAmount > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-orange-50 text-orange-600'}`}>
                              {r.depositAmount > 0 ? '입금' : '출금'}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-slate-800">{(r.depositAmount || r.withdrawAmount).toLocaleString()}원</td>
                          <td className="px-3 py-2 text-slate-700">{r.counterpartyName}</td>
                          <td className="px-3 py-2 text-slate-500">{r.memo}</td>
                          <td className="px-3 py-2">{r.bookingNo ? <span className="text-emerald-700 font-medium">{r.bookingNo} · {r.customerName}</span> : <span className="text-slate-400">미매칭</span>}</td>
                          <td className="px-3 py-2 text-center">
                            {r.matchStatus && r.matchStatus !== 'unmatched'
                              ? <span className={`px-1.5 py-0.5 rounded-full text-[11px] font-medium ${r.matchStatus === 'auto' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{r.confidence}%</span>
                              : <span className="text-slate-300">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="p-4 border-t border-slate-200 flex items-center gap-3">
                  <span className="text-[11px] text-slate-500">선택 {importRows.filter(r => r.include).length}건 / 전체 {importRows.length}건</span>
                  <div className="flex gap-2 ml-auto">
                    <button onClick={() => setImportStep('paste')} className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded text-[13px] hover:bg-slate-50 transition">뒤로</button>
                    <button onClick={handleImport} disabled={importing || importRows.filter(r => r.include).length === 0}
                      className="px-4 py-2 bg-[#001f3f] text-white rounded text-[13px] font-medium hover:bg-blue-900 disabled:bg-slate-300 transition">
                      {importing ? '등록 중...' : `등록하기 (${importRows.filter(r => r.include).length}건)`}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {importStep === 'done' && importResult && (
              <div className="p-8 text-center">
                <p className="text-[16px] font-semibold text-slate-800 mb-4">등록 완료</p>
                <div className="grid grid-cols-4 gap-4 mb-6">
                  {[
                    { label: '신규 등록', val: importResult.inserted, cls: 'bg-white border-emerald-200 text-emerald-700' },
                    { label: '자동 매칭', val: importResult.matched,  cls: 'bg-white border-blue-200 text-blue-700' },
                    { label: '중복 스킵', val: importResult.duplicates, cls: 'bg-white border-slate-200 text-slate-500' },
                    { label: '오류',     val: importResult.errors,   cls: 'bg-white border-red-200 text-red-600' },
                  ].map(({ label, val, cls }) => (
                    <div key={label} className={`border rounded-lg p-3 ${cls}`}>
                      <p className="text-xl font-bold">{val}</p>
                      <p className="text-[11px] mt-1">{label}</p>
                    </div>
                  ))}
                </div>
                {importResult.firstError && (
                  <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 text-[11px] text-red-700 text-left">
                    <strong>오류 메시지:</strong> {importResult.firstError}
                  </div>
                )}
                <button onClick={closeImport} className="px-6 py-2 bg-[#001f3f] text-white rounded text-[13px] font-medium hover:bg-blue-900 transition">닫기</button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
