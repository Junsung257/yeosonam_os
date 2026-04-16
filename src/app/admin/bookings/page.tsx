'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import BookingDrawer from '@/components/BookingDrawer';
import CommandPalette from '@/components/CommandPalette';
import { useVendors } from '@/hooks/useVendors';
import { useLocations } from '@/hooks/useLocations';

// ── 타입 ──────────────────────────────────────────────────────────────────────
interface Booking {
  id: string;
  booking_no?: string;
  package_title?: string;
  product_id?: string;           // 상품-예약 스마트 매칭 FK
  lead_customer_id: string;
  adult_count: number;
  child_count: number;
  adult_cost: number;
  adult_price: number;
  child_cost: number;
  child_price: number;
  fuel_surcharge: number;
  total_cost?: number;
  total_price?: number;
  paid_amount?: number;
  total_paid_out?: number;
  payment_status?: string;
  status: string;
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
  refund_settled_at?: string | null;
  net_cashflow?: number | null;
  settlement_confirmed_at?: string | null;
  settlement_confirmed_by?: string | null;
  commission_rate?: number | null;
  commission_amount?: number | null;
  departure_date?: string;
  departure_region?: string;
  booking_date?: string;
  land_operator?: string | null;
  land_operator_id?: string | null;
  departing_location_id?: string | null;
  manager_name?: string;
  payment_date?: string;
  notes?: string;
  is_deleted?: boolean;
  has_sent_docs?: boolean;
  metadata?: Record<string, unknown>;
  created_at: string;
  customers?: { id: string; name: string; phone?: string };
}

// ── 상수 ──────────────────────────────────────────────────────────────────────
const STATUS_LABELS: Record<string, string> = {
  pending: '예약대기', confirmed: '예약확정', completed: '결제완료', cancelled: '취소',
};
const STATUS_COLORS: Record<string, string> = {
  pending:   'bg-slate-100 text-slate-500',
  confirmed: 'bg-blue-50 text-blue-700',
  completed: 'bg-emerald-50 text-emerald-700',
  cancelled: 'bg-slate-50 text-slate-400 line-through',
};
const DATE_RANGE_RE = /^(\d{6})(?:\s*~\s*(\d{6}))?$/;

// [1] DB에 실제 존재하는 컬럼 화이트리스트 — 없는 필드 전송 차단
// ⚠️ total_price는 DB Generated Column이므로 절대 PATCH 페이로드에 포함 금지
//    → Optimistic UI로 로컬 State에서만 즉석 계산
const DB_COLUMN_WHITELIST = new Set([
  'departure_region', 'land_operator', 'land_operator_id',
  'departing_location_id',
  'manager_name', 'package_title', 'product_id', 'memo', 'special_requests',
  'departure_date', 'adult_price', 'child_price',
  'adult_count', 'child_count',
  'status', 'is_deleted', 'paid_amount', 'payment_status',
]);

const DB_FIELD_MAP: Partial<Record<string, string>> = {
  land_operator_contact: 'manager_name',
};

const COL_FIELD: Record<number, keyof Booking> = {
  3: 'departure_date',       6: 'departing_location_id',
  7: 'land_operator_id',     8: 'manager_name',
  9: 'adult_count',         10: 'adult_price',
  14: 'status',
};
const TOTAL_NAV_COLS = 15;
const ROW_H          = 88;  // 가상화 계산용 (CSS는 style 속성으로 고정)
const OVERSCAN       = 10;

// ── 유틸 ──────────────────────────────────────────────────────────────────────
function fmt(n?: number | null) {
  if (n == null) return '-';
  return n.toLocaleString('ko-KR') + '원';
}
function fmtK(n?: number | null) {
  if (n == null) return '0';
  if (Math.abs(n) >= 100_000_000) return (n / 100_000_000).toFixed(1) + '억원';
  if (Math.abs(n) >= 10_000)      return Math.round(n / 10_000) + '만원';
  return n.toLocaleString() + '원';
}
function fmtDate(s?: string | null) { return s ? s.slice(0, 10) : '-'; }
function parseShortDate(s: string) {
  return `20${s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4, 6)}`;
}

const DAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];
// '2026-03-17' → '26-03-17 (월)'
function fmtDateKo(s?: string | null): string {
  if (!s) return '-';
  const d = new Date(s.slice(0, 10));
  if (isNaN(d.getTime())) return s.slice(0, 10);
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd} (${DAYS_KO[d.getDay()]})`;
}

// 마진율 컬러 배지
function MarginBadge({ rate }: { rate: number }) {
  const cls =
    rate >= 20 ? 'bg-emerald-50 text-emerald-700' :
    rate >= 10 ? 'bg-amber-50 text-amber-700'     :
                  'bg-red-50 text-red-600';
  return (
    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold tabular-nums ${cls}`}>
      {rate.toFixed(1)}%
    </span>
  );
}

// ── 화이트리스트 필터 — DB에 없는 필드 자동 제거 ─────────────────────────────
function safeFields(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).filter(([k]) => k === 'id' || DB_COLUMN_WHITELIST.has(k))
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// [1] 핵심 픽스: NumInputCell을 모듈 최상위에 정의
//    - 렌더 루프 내부 정의 → 매 렌더마다 새 컴포넌트 타입 = 무한 루프의 원인
//    - 모듈 레벨 + React.memo → 안정적인 참조 보장
//    - uncontrolled (defaultValue) → onChange 없음 = 중간 상태 변경 없음
//    - committed ref → Enter + blur 이중 발화 방지
// ══════════════════════════════════════════════════════════════════════════════
const NumInputCell = React.memo(function NumInputCell({
  initialValue,
  bookingId,
  field,
  onCommit,
  onCancel,
  className,
}: {
  initialValue: number;
  bookingId: string;
  field: 'adult_price' | 'adult_count';
  onCommit: (bookingId: string, field: 'adult_price' | 'adult_count', val: number) => void;
  onCancel: () => void;
  className?: string;
}) {
  const committed = useRef(false);

  const handleCommit = useCallback((rawVal: string) => {
    if (committed.current) return; // Enter + blur 이중 발화 방지
    committed.current = true;
    const num = Math.max(0, parseInt(rawVal.replace(/[^0-9]/g, ''), 10) || 0);
    onCommit(bookingId, field, num);
  }, [bookingId, field, onCommit]);

  return (
    <input
      autoFocus
      type="number"
      min={0}
      defaultValue={initialValue}
      onKeyDown={e => {
        e.stopPropagation();
        if (e.key === 'Enter')  { e.preventDefault(); handleCommit((e.target as HTMLInputElement).value); }
        if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        if (e.key === 'Tab')    { e.preventDefault(); handleCommit((e.target as HTMLInputElement).value); }
      }}
      onBlur={e => handleCommit(e.target.value)}
      className={className}
    />
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// [2] DateInputCell (모듈 레벨): 출발일 마법 파서
//   260317 → 2026-03-17 (YYMMDD 6자리 자동 파싱)
//   표시: 26-03-17 (월) 형식
// ══════════════════════════════════════════════════════════════════════════════
const DateInputCell = React.memo(function DateInputCell({
  initialValue, onCommit, onCancel,
}: {
  initialValue: string;
  onCommit: (dateStr: string) => void;
  onCancel: () => void;
}) {
  const committed = useRef(false);

  const handleCommit = useCallback((raw: string) => {
    if (committed.current) return;
    committed.current = true;
    const val = raw.trim();
    if (!val) { onCancel(); return; }
    if (/^\d{6}$/.test(val)) {
      onCommit(parseShortDate(val));                      // 260317 → 2026-03-17
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
      onCommit(val);                                       // 이미 ISO 포맷
    } else {
      onCancel();                                          // 파싱 불가 → 취소
    }
  }, [onCommit, onCancel]);

  // defaultValue: '2026-03-17' → '260317' (YYMMDD)
  const defaultVal = initialValue
    ? initialValue.slice(0, 10).replace(/-/g, '').slice(2)
    : '';

  return (
    <input
      autoFocus
      type="text"
      defaultValue={defaultVal}
      placeholder="260317"
      maxLength={10}
      onKeyDown={e => {
        e.stopPropagation();
        if (e.key === 'Enter')  { e.preventDefault(); handleCommit((e.target as HTMLInputElement).value); }
        if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        if (e.key === 'Tab')    { e.preventDefault(); handleCommit((e.target as HTMLInputElement).value); }
      }}
      onBlur={e => handleCommit(e.target.value)}
      className="w-28 border border-blue-500 rounded px-2 py-1.5 text-[13px] font-mono tracking-widest focus:outline-none bg-white"
    />
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// [5] 셀 저장 성공 시 그린 페이드아웃 훅
// ──────────────────────────────────────────────────────────────────────────────
function useCellHighlight() {
  const [phases, setPhases] = useState<Map<string, 'bright' | 'fading'>>(new Map());
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>[]>>(new Map());

  useEffect(() => {
    const t = timers.current;
    return () => t.forEach(arr => arr.forEach(clearTimeout));
  }, []);

  // useCallback([]) → 안정적 참조 (부모 리렌더와 무관하게 동일 함수)
  const flash = useCallback((key: string) => {
    timers.current.get(key)?.forEach(clearTimeout);
    setPhases(prev => new Map(prev).set(key, 'bright'));
    const t1 = setTimeout(() => setPhases(prev => new Map(prev).set(key, 'fading')), 900);
    const t2 = setTimeout(() => setPhases(prev => { const n = new Map(prev); n.delete(key); return n; }), 1600);
    timers.current.set(key, [t1, t2]);
  }, []);

  const getCellStyle = useCallback((key: string): React.CSSProperties => {
    const p = phases.get(key);
    if (!p) return {};
    if (p === 'bright') return { backgroundColor: 'rgb(220,252,231)', transition: 'background-color 0.05s' };
    return { backgroundColor: 'transparent', transition: 'background-color 700ms ease-out' };
  }, [phases]);

  return { flash, getCellStyle };
}

// ══════════════════════════════════════════════════════════════════════════════
// [3] HeadcountCell (모듈 레벨): 성인/아동 듀얼 인라인 폼
//   Tab → 성인→아동 이동, Enter/Tab(아동) → 두 값 묶어서 즉시 저장
//   committed ref → 이중 발화(onBlur + Enter) 완전 방지
// ══════════════════════════════════════════════════════════════════════════════
const HeadcountCell = React.memo(function HeadcountCell({
  initialAdult, initialChild, bookingId, onCommit, onCancel,
}: {
  initialAdult: number;
  initialChild: number;
  bookingId: string;
  onCommit: (bookingId: string, adult: number, child: number) => void;
  onCancel: () => void;
}) {
  const adultRef  = useRef<HTMLInputElement>(null);
  const childRef  = useRef<HTMLInputElement>(null);
  const committed = useRef(false);

  const doCommit = useCallback(() => {
    if (committed.current) return;
    committed.current = true;
    const adult = Math.max(1, parseInt(adultRef.current?.value || '1', 10) || 1);
    const child = Math.max(0, parseInt(childRef.current?.value || '0', 10) || 0);
    onCommit(bookingId, adult, child);
  }, [bookingId, onCommit]);

  const inputCls = 'w-14 border border-blue-500 rounded px-2 py-1 text-[13px] font-bold text-center focus:outline-none bg-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

  return (
    <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
      <span className="text-[11px] text-slate-500 font-medium shrink-0">성인</span>
      <input
        ref={adultRef}
        autoFocus
        type="number"
        min={1}
        defaultValue={initialAdult}
        className={inputCls}
        onKeyDown={e => {
          e.stopPropagation();
          if (e.key === 'Tab')    { e.preventDefault(); childRef.current?.focus(); }
          if (e.key === 'Enter')  { e.preventDefault(); doCommit(); }
          if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        }}
        onBlur={() => setTimeout(() => {
          if (document.activeElement !== childRef.current) doCommit();
        }, 80)}
      />
      <span className="text-[11px] text-slate-500 font-medium shrink-0">아동</span>
      <input
        ref={childRef}
        type="number"
        min={0}
        defaultValue={initialChild}
        className={inputCls}
        onKeyDown={e => {
          e.stopPropagation();
          if (e.key === 'Tab')    { e.preventDefault(); doCommit(); }
          if (e.key === 'Enter')  { e.preventDefault(); doCommit(); }
          if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        }}
        onBlur={() => setTimeout(() => {
          if (document.activeElement !== adultRef.current) doCommit();
        }, 80)}
      />
    </div>
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// 부산 추천 훅
// ──────────────────────────────────────────────────────────────────────────────
function useBusanRecommendation() {
  const [recommendations, setRecommendations] = useState<Set<string>>(new Set());
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => { const t = timers.current; return () => t.forEach(clearTimeout); }, []);

  const trigger = useCallback((bookingId: string, region: string) => {
    if (region !== '부산') {
      setRecommendations(prev => { const n = new Set(prev); n.delete(bookingId); return n; });
      return;
    }
    setRecommendations(prev => new Set(prev).add(bookingId));
    clearTimeout(timers.current.get(bookingId));
    timers.current.set(bookingId, setTimeout(() => {
      setRecommendations(prev => { const n = new Set(prev); n.delete(bookingId); return n; });
    }, 10000));
  }, []);

  const dismiss = useCallback((bookingId: string) => {
    clearTimeout(timers.current.get(bookingId));
    setRecommendations(prev => { const n = new Set(prev); n.delete(bookingId); return n; });
  }, []);

  const has = useCallback((id: string) => recommendations.has(id), [recommendations]);
  return { trigger, dismiss, has };
}

// ──────────────────────────────────────────────────────────────────────────────
// LocationSelectCell — 출발지 마스터 FK 기반 인라인 선택
// ──────────────────────────────────────────────────────────────────────────────
function LocationSelectCell({ initialId, locations, onCommit, onCancel }: {
  initialId: string | null;
  locations: { id: string; name: string }[];
  onCommit: (id: string) => void;
  onCancel: () => void;
}) {
  return (
    <select autoFocus defaultValue={initialId ?? ''}
      onClick={e => { e.stopPropagation(); e.preventDefault(); }}
      onChange={e => { e.stopPropagation(); onCommit(e.target.value); }}
      onBlur={onCancel}
      onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); onCancel(); } }}
      className="border border-blue-500 rounded px-2 py-1.5 text-[13px] font-medium focus:outline-none bg-white cursor-pointer"
    >
      <option value="">-- 선택 안 함 --</option>
      {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
    </select>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// VendorSelectCell — 랜드사 마스터 FK 기반 인라인 선택
// ──────────────────────────────────────────────────────────────────────────────
function VendorSelectCell({ initialId, vendors, onCommit, onCancel }: {
  initialId: string | null;
  vendors: { id: string; name: string }[];
  onCommit: (id: string) => void;
  onCancel: () => void;
}) {
  return (
    <select autoFocus defaultValue={initialId ?? ''}
      onClick={e => { e.stopPropagation(); e.preventDefault(); }}
      onChange={e => { e.stopPropagation(); onCommit(e.target.value); }}
      onBlur={onCancel}
      onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); onCancel(); } }}
      className="border border-blue-500 rounded px-2 py-1.5 text-[13px] font-medium focus:outline-none bg-white cursor-pointer"
    >
      <option value="">-- 선택 안 함 --</option>
      {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
    </select>
  );
}


// ══════════════════════════════════════════════════════════════════════════════
// SmartProductSelect — 출발일 기반 상품 자동완성 모달
//   상품 선택 시 product_id, package_title, adult_cost, adult_price, land_operator_id
//   가 onCommit 콜백으로 반환됨
// ══════════════════════════════════════════════════════════════════════════════
interface ProductHit {
  internal_code: string;
  display_name: string;
  supplier_name?: string | null;
  destination?: string | null;
  departure_date?: string | null;
  net_price: number;
  selling_price: number;
  land_operator_id?: string | null;
}

function SmartProductSelect({
  departureDate, onCommit, onCancel,
}: {
  departureDate?: string;
  onCommit: (p: ProductHit) => void;
  onCancel: () => void;
}) {
  const [q, setQ]           = useState('');
  const [products, setProducts] = useState<ProductHit[]>([]);
  const [loading, setLoading]   = useState(true);
  const inputRef     = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dropPos, setDropPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ status: 'active', limit: '50' });
    if (departureDate) params.set('departure_date', departureDate);
    fetch(`/api/products?${params}`)
      .then(r => r.json())
      .then(d => setProducts(d.products ?? []))
      .catch(() => setProducts([]))
      .finally(() => setLoading(false));
  }, [departureDate]);

  useLayoutEffect(() => {
    const calc = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const w    = Math.max(380, rect.width);
      const top  = rect.bottom + 4 + 360 > window.innerHeight ? rect.top - 364 : rect.bottom + 4;
      const left = Math.min(rect.left, window.innerWidth - w - 8);
      setDropPos({ top, left, width: w });
    };
    calc();
    window.addEventListener('scroll', calc, true);
    window.addEventListener('resize', calc);
    return () => { window.removeEventListener('scroll', calc, true); window.removeEventListener('resize', calc); };
  }, []);

  const hits = products.filter(p => {
    if (!q.trim()) return true;
    const lq = q.toLowerCase();
    return (
      p.display_name?.toLowerCase().includes(lq) ||
      p.internal_code?.toLowerCase().includes(lq) ||
      p.supplier_name?.toLowerCase().includes(lq) ||
      p.destination?.toLowerCase().includes(lq)
    );
  }).slice(0, 12);

  return (
    <div ref={containerRef} className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
      <input
        ref={inputRef}
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="상품 검색..."
        onKeyDown={e => {
          e.stopPropagation();
          if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
          if (e.key === 'Enter' && hits[0]) { e.preventDefault(); onCommit(hits[0]); }
        }}
        onBlur={() => setTimeout(onCancel, 180)}
        className="w-48 border border-blue-500 rounded px-2 py-1.5 text-[13px] font-medium focus:outline-none bg-white"
      />

      {dropPos && createPortal(
        <div
          style={{ position: 'fixed', top: dropPos.top, left: dropPos.left, width: dropPos.width, zIndex: 9999 }}
          className="bg-white border border-slate-200 rounded-lg max-h-[360px] overflow-y-auto py-1"
          onMouseDown={e => e.stopPropagation()}
        >
          {loading && (
            <p className="px-4 py-3 text-[13px] text-slate-500 text-center">상품 불러오는 중...</p>
          )}
          {!loading && hits.length === 0 && (
            <p className="px-4 py-3 text-[13px] text-slate-500 text-center">
              {departureDate ? `출발일 ±60일 내 활성 상품 없음` : '활성 상품 없음'}
            </p>
          )}
          {!loading && hits.map(p => (
            <button
              key={p.internal_code}
              type="button"
              onMouseDown={e => { e.preventDefault(); onCommit(p); }}
              className="w-full text-left px-4 py-2 hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-0"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-mono text-slate-500">{p.internal_code}</span>
                {p.departure_date && (
                  <span className="text-[11px] text-slate-500">
                    출발 {p.departure_date.slice(0, 10)}
                  </span>
                )}
              </div>
              <p className="text-[13px] font-semibold text-slate-800 mt-0.5 truncate">{p.display_name}</p>
              <div className="flex items-center gap-3 mt-1">
                {p.supplier_name && (
                  <span className="text-[11px] text-blue-600 font-medium">{p.supplier_name}</span>
                )}
                <span className="text-[11px] text-slate-500">
                  원가 {p.net_price?.toLocaleString()}원 / 판가 {p.selling_price?.toLocaleString()}원
                </span>
              </div>
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// ProductSkuCell — SKU 코드 복붙 방식 상품 연결 셀
// ──────────────────────────────────────────────────────────────────────────────
interface ProductSkuCellProps {
  booking: Booking;
  onCommit: (patch: { product_id: string; package_title: string; land_operator_id?: string | null; departing_location_id?: string | null; land_operator?: string | null; departure_region?: string | null }) => void;
  onError: (msg: string) => void;
}

function ProductSkuCell({ booking, onCommit, onError }: ProductSkuCellProps) {
  const [editing, setEditing] = useState(false);
  const [input,   setInput]   = useState('');
  const [saving,  setSaving]  = useState(false);

  const commit = async () => {
    const code = input.trim();
    if (!code || code === booking.product_id) { setEditing(false); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/bookings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: booking.id, sku_code: code }),
      });
      const data = await res.json();
      if (!res.ok) {
        onError(data.error || '존재하지 않는 상품 코드입니다');
        setInput('');
        setEditing(false);
        return;
      }
      setEditing(false);
      onCommit({
        product_id:            data.resolvedProduct.internal_code,
        package_title:         data.resolvedProduct.display_name,
        land_operator_id:      data.resolvedProduct.land_operator_id ?? null,
        departing_location_id: data.resolvedProduct.departing_location_id ?? null,
        land_operator:         data.resolvedProduct.landOpName ?? null,
        departure_region:      data.resolvedProduct.departure_region ?? null,
      });
    } finally { setSaving(false); }
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={input}
        onChange={e => setInput(e.target.value)}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setEditing(false);
        }}
        onBlur={commit}
        placeholder="SKU 붙여넣기..."
        disabled={saving}
        className="w-full border border-blue-400 rounded px-2 py-1 text-[13px] font-mono focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
      />
    );
  }

  return (
    <div
      onClick={(e) => { e.stopPropagation(); setEditing(true); setInput(''); }}
      className="flex flex-col cursor-pointer hover:text-blue-600 group min-w-0"
    >
      {booking.product_id ? (
        <>
          <span className="text-[11px] font-mono text-blue-500 truncate">
            [{booking.product_id}]
          </span>
          <span className="text-[13px] text-slate-800 font-medium truncate group-hover:text-blue-600" title={booking.package_title || ''}>
            {booking.package_title || '(미지정)'}
          </span>
        </>
      ) : (
        <span className="text-[13px] text-slate-800 font-medium truncate group-hover:text-blue-600" title={booking.package_title || ''}>
          {booking.package_title || <span className="text-slate-300">(미지정)</span>}
        </span>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// 인텔리전트 상태 뱃지
// ──────────────────────────────────────────────────────────────────────────────
function StatusBadge({ booking, onClick }: { booking: Booking; onClick: () => void }) {
  const totalPrice   = booking.total_price   || 0;
  const paidAmount   = booking.paid_amount   || 0;
  const totalPaidOut = booking.total_paid_out || 0;
  const totalCost    = booking.total_cost    || 0;
  const balance      = totalPrice - paidAmount;
  const agencyUnpaid = totalCost - totalPaidOut;
  const isPaid       = balance <= 0 && totalPrice > 0;
  const isAgencyPaid = agencyUnpaid <= 0 && totalCost > 0;
  const partialPay   = totalPaidOut > 0 && !isAgencyPaid;
  const payRatio     = totalCost > 0 ? Math.min(100, Math.round((totalPaidOut / totalCost) * 100)) : 0;
  const isStale      = booking.status === 'pending' &&
    Date.now() - new Date(booking.created_at).getTime() > 48 * 3600 * 1000;

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative inline-flex">
        <span onClick={onClick}
          className={`text-[11px] px-3 py-1 rounded-full cursor-pointer hover:opacity-80 font-semibold transition-opacity ${STATUS_COLORS[booking.status] || 'bg-slate-100 text-slate-600'}`}>
          {STATUS_LABELS[booking.status] || booking.status}
        </span>
        {isStale && (
          <span className="absolute -top-1 -right-1 flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
          </span>
        )}
      </div>
      {!isAgencyPaid && agencyUnpaid > 0 && (
        <div className="flex flex-col items-center gap-0.5">
          <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold whitespace-nowrap
            ${booking.departure_date && Math.ceil((new Date(booking.departure_date).getTime() - Date.now()) / 86400000) <= 7
              ? 'bg-red-600 text-white animate-pulse' : 'bg-amber-50 text-amber-700'}`}>
            {partialPay ? '부분송금' : '미송금'}
          </span>
          {partialPay && (
            <div className="flex items-center gap-1">
              <div className="w-14 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                <div className="h-full bg-amber-400 rounded-full transition-all" style={{ width: `${payRatio}%` }} />
              </div>
              <span className="text-[11px] text-amber-600 font-medium">{payRatio}%</span>
            </div>
          )}
        </div>
      )}
      {isAgencyPaid && <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 whitespace-nowrap">송금완료</span>}
      {isPaid       && <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 whitespace-nowrap">완납</span>}
    </div>
  );
}

// SortTh
function SortTh({ label, field, sortField, sortDir, onSort, className = '' }: {
  label: string; field: string; sortField: string | null; sortDir: 'asc' | 'desc' | null;
  onSort: (f: string) => void; className?: string;
}) {
  const active = sortField === field;
  return (
    <th onClick={() => onSort(field)}
      className={`cursor-pointer select-none px-3 py-2 whitespace-nowrap hover:bg-slate-50 group text-left ${className}`}>
      <span className="flex items-center gap-1 text-[13px] text-slate-800 font-semibold">
        {label}
        <span className={active ? 'text-blue-500' : 'text-slate-300 group-hover:text-slate-400'}>
          {!active ? '↕' : sortDir === 'asc' ? '↑' : '↓'}
        </span>
      </span>
    </th>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 메인 컴포넌트
// ══════════════════════════════════════════════════════════════════════════════
export default function BookingsPage() {

  // ── 데이터 ─────────────────────────────────────────────────────────────────
  const [bookings, setBookings]             = useState<Booking[]>([]);
  const [isLoading, setIsLoading]           = useState(true);
  const [processing, setProcessing]         = useState<string | null>(null);

  // ── 마스터 데이터 훅 (모듈 캐시 — 중복 fetch 없음) ─────────────────────────
  const { vendors: activeVendors, all: allVendors } = useVendors();
  const { locations: activeLocations, all: allLocations } = useLocations();

  // [1] bookingsRef: 안정적 ref로 최신 bookings 접근 (useCallback 의존성 없이)
  const bookingsRef = useRef<Booking[]>([]);
  bookingsRef.current = bookings; // 렌더마다 동기 갱신

  // ── 필터/탭 ────────────────────────────────────────────────────────────────
  const [lifecycleTab, setLifecycleTab] = useState<'active' | 'done' | 'cancelled' | 'trash'>('active');
  const [activeTab, setActiveTab] = useState<
    '' | 'unpaid_risk' | 'missing_info' | 'land_bomb' | 'prep_docs' | 'deposit_unpaid' | 'over_cost' | 'refund_pending' | 'settlement_pending'
  >('');
  const [rawSearch, setRawSearch]       = useState('');
  const [searchQuery, setSearchQuery]   = useState('');
  const [searchTarget, setSearchTarget] = useState<'all' | 'departure' | 'booking'>('all');

  // ── 정렬 ────────────────────────────────────────────────────────────────────
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDir, setSortDir]     = useState<'asc' | 'desc' | null>(null);

  // ── 인라인 편집 ─────────────────────────────────────────────────────────────
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [cellValue, setCellValue]     = useState('');

  // ── 키보드 네비게이션 ────────────────────────────────────────────────────────
  const [focusedCell, setFocusedCell] = useState<{ row: number; col: number } | null>(null);
  const cellRefs = useRef<Map<string, HTMLElement>>(new Map());

  // ── 다중 선택 ───────────────────────────────────────────────────────────────
  const [selected, setSelected]   = useState<Set<string>>(new Set());
  const [bulkField, setBulkField] = useState<'departing_location_id' | 'land_operator_id' | null>(null);

  // ── Toast / Undo ─────────────────────────────────────────────────────────────
  const [toast, setToast]           = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);
  const toastTimerRef               = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Booking[]>([]);
  const [undoToast, setUndoToast]   = useState<{ count: number; ids: string[] } | null>(null);
  const undoTimerRef                = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ctxMenu, setCtxMenu]       = useState<{ x: number; y: number; b: Booking } | null>(null);

  // ── Drawer / 가상화 ──────────────────────────────────────────────────────────
  const [drawerBookingId, setDrawerBookingId] = useState<string | null>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop]   = useState(0);
  const [containerH, setContainerH] = useState(600);

  // ── Custom Hooks ────────────────────────────────────────────────────────────
  const { flash: flashCell, getCellStyle } = useCellHighlight();
  const busanRec = useBusanRecommendation();

  // [1] 안정적 showToast — setters와 ref만 의존 (둘 다 안정)
  const showToast = useCallback((msg: string, type: 'ok' | 'err' = 'ok') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ msg, type });
    toastTimerRef.current = setTimeout(() => setToast(null), 2500);
  }, []);

  // [1] 안정적 cancelEdit
  const cancelEdit = useCallback(() => setEditingCell(null), []);

  // ── Debounce 300ms ───────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(rawSearch), 300);
    return () => clearTimeout(t);
  }, [rawSearch]);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);


  async function copyText(text: string) {
    try { await navigator.clipboard.writeText(text); showToast(`복사됨: ${text}`); }
    catch { showToast('복사 실패', 'err'); }
  }

  // ── 데이터 로드 ─────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const p = new URLSearchParams();
      if (lifecycleTab === 'trash') p.set('include_deleted', 'only');
      // 그 외 탭: 전체 로드 후 클라이언트 필터링
      const res  = await fetch(`/api/bookings?${p}`);
      const data = await res.json();
      setBookings(data.bookings ?? []);
    } finally { setIsLoading(false); }
  }, [lifecycleTab]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const el = tableContainerRef.current;
    if (!el) return;
    setContainerH(el.clientHeight);
    const ro = new ResizeObserver(() => setContainerH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [ctxMenu]);

  // ── [3] 화이트리스트 기반 셀 저장 ────────────────────────────────────────────
  const commitCell = useCallback(async (id: string, field: string, val?: string) => {
    const value   = val ?? cellValue;
    setEditingCell(null);
    const dbField = DB_FIELD_MAP[field] ?? field;

    // [3] 화이트리스트 검사: DB에 없는 컬럼이면 metadata로 폴백
    const body = DB_COLUMN_WHITELIST.has(dbField)
      ? { id, [dbField]: value }
      : { id, metadata: { [field]: value } };

    try {
      const res = await fetch('/api/bookings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        if (err.code === 'PGRST204' || err.error?.includes('Could not find')) {
          console.warn(`[commitCell] 컬럼 '${dbField}' 없음 → metadata 폴백`);
          await fetch('/api/bookings', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, metadata: { [field]: value } }),
          }).catch(() => {});
        } else throw new Error(err.error || '수정 실패');
      }
      // 함수형 업데이트 — 전체 bookings 배열을 클로저로 캡처하지 않음
      setBookings(prev => prev.map(b => b.id === id ? { ...b, [field]: value } : b));
      flashCell(`${id}-${field}`);
      showToast('저장됨');
    } catch (e) { showToast(e instanceof Error ? e.message : '수정 실패', 'err'); }
  }, [cellValue, flashCell, showToast]);

  const commitAndDown = useCallback(async (id: string, field: string, val: string, row: number) => {
    await commitCell(id, field, val);
    const colIdx = Number(Object.entries(COL_FIELD).find(([, f]) => f === field)?.[0]);
    if (!isNaN(colIdx)) setTimeout(() => navigateTo(row + 1, colIdx), 60);
  }, [commitCell]); // navigateTo는 아래에서 선언

  // ── [1][2] AI 자동 정산 — 무한루프 완전 차단 아키텍처 ────────────────────────
  // - bookingsRef: 안정적 ref로 최신값 참조 (useState 의존성 없음)
  // - flashCell, showToast: 둘 다 useCallback([]) = 안정적
  // - setBookings, setEditingCell: useState setter = 안정적
  // → useCallback([]) → 완전히 안정적인 참조 → NumInputCell의 onCommit으로 안전 전달
  const commitAutoCalc = useCallback(async (
    bookingId: string,
    field: 'adult_price' | 'adult_count',
    newVal: number,
  ) => {
    const booking = bookingsRef.current.find(b => b.id === bookingId);
    if (!booking) return;

    setEditingCell(null);

    const newAdultPrice = field === 'adult_price' ? newVal : (booking.adult_price || 0);
    const newAdultCount = field === 'adult_count' ? newVal : (booking.adult_count || 1);
    const total_price   = newAdultPrice * newAdultCount
      + (booking.child_price || 0) * (booking.child_count || 0);

    // [2] Optimistic UI — 함수형 업데이트로 의존성 없이 안전 업데이트
    setBookings(prev => prev.map(b =>
      b.id === bookingId ? { ...b, [field]: newVal, total_price } : b
    ));
    flashCell(`${bookingId}-${field}`);
    flashCell(`${bookingId}-total_price`);

    // [1] Generated Column 방어: total_price는 DB 자동계산 → 페이로드 미포함
    // Optimistic UI로 화면 즉시 갱신, DB엔 순수 base 필드만 전송
    const patch = safeFields({ id: bookingId, [field]: newVal });

    try {
      const res = await fetch('/api/bookings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error((await res.json()).error || '저장 실패');
      showToast(`총 ${total_price.toLocaleString()}원 자동 계산 완료`);
    } catch (e) {
      // 롤백: 원복 (함수형 업데이트)
      setBookings(prev => prev.map(b => b.id === bookingId ? booking : b));
      showToast(e instanceof Error ? e.message : '저장 실패', 'err');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashCell, showToast]); // bookingsRef는 ref이므로 의존성 불필요

  // ── [3] 인원 듀얼 폼 커밋 ────────────────────────────────────────────────────
  // base 필드(adult_count, child_count)만 DB 전송, total_price는 Optimistic UI
  const commitHeadcount = useCallback(async (
    bookingId: string, newAdult: number, newChild: number,
  ) => {
    const booking = bookingsRef.current.find(b => b.id === bookingId);
    if (!booking) return;
    setEditingCell(null);

    const total_price = (booking.adult_price || 0) * newAdult
      + (booking.child_price || 0) * newChild;

    setBookings(prev => prev.map(b =>
      b.id === bookingId ? { ...b, adult_count: newAdult, child_count: newChild, total_price } : b
    ));
    flashCell(`${bookingId}-adult_count`);
    flashCell(`${bookingId}-total_price`);

    // Generated Column 방어: total_price 미포함, base 필드만 전송
    try {
      const res = await fetch('/api/bookings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: bookingId, adult_count: newAdult, child_count: newChild }),
      });
      if (!res.ok) throw new Error((await res.json()).error || '저장 실패');
      showToast(`성인 ${newAdult}명 / 아동 ${newChild}명 저장됨`);
    } catch (e) {
      setBookings(prev => prev.map(b => b.id === bookingId ? booking : b));
      showToast(e instanceof Error ? e.message : '저장 실패', 'err');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashCell, showToast]);

  // ── 랜드사 인라인 변경 (Optimistic UI + Rollback) ────────────────────────────
  const handleVendorChange = useCallback(async (bookingId: string, newId: string) => {
    const booking = bookingsRef.current.find(b => b.id === bookingId);
    if (!booking) return;
    const prev = booking.land_operator_id ?? null;
    setBookings(ps => ps.map(b => b.id === bookingId ? { ...b, land_operator_id: newId || null } : b));
    setEditingCell(null);
    flashCell(`${bookingId}-land_operator_id`);
    const res = await fetch('/api/bookings', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: bookingId, land_operator_id: newId || null }),
    });
    if (!res.ok) {
      setBookings(ps => ps.map(b => b.id === bookingId ? { ...b, land_operator_id: prev } : b));
      showToast('랜드사 저장 실패 — 롤백됨', 'err');
    } else showToast('저장됨');
  }, [flashCell, showToast]);

  // ── 출발지역 인라인 변경 (Optimistic UI + Rollback) ──────────────────────────
  const handleLocationChange = useCallback(async (bookingId: string, newId: string) => {
    const booking = bookingsRef.current.find(b => b.id === bookingId);
    if (!booking) return;
    const prev = booking.departing_location_id ?? null;
    setBookings(ps => ps.map(b => b.id === bookingId ? { ...b, departing_location_id: newId || null } : b));
    setEditingCell(null);
    flashCell(`${bookingId}-departing_location_id`);
    const res = await fetch('/api/bookings', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: bookingId, departing_location_id: newId || null }),
    });
    if (!res.ok) {
      setBookings(ps => ps.map(b => b.id === bookingId ? { ...b, departing_location_id: prev } : b));
      showToast('출발지역 저장 실패 — 롤백됨', 'err');
    } else showToast('저장됨');
  }, [flashCell, showToast]);

  // ── 상품 스마트 매칭 커밋 ─────────────────────────────────────────────────────
  const handleProductCommit = useCallback(async (bookingId: string, product: ProductHit) => {
    setEditingCell(null);
    const patch: Record<string, unknown> = {
      id:            bookingId,
      product_id:    product.internal_code,
      package_title: product.display_name,
      adult_cost:    product.net_price,
      adult_price:   product.selling_price,
    };
    if (product.land_operator_id) patch.land_operator_id = product.land_operator_id;

    try {
      const res = await fetch('/api/bookings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error((await res.json()).error || '저장 실패');
      setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, ...patch } : b));
      flashCell(`${bookingId}-package_title`);
      showToast(`상품 연결됨: ${product.display_name}`);
    } catch (e) { showToast(e instanceof Error ? e.message : '저장 실패', 'err'); }
  }, [flashCell, showToast]);

  // ── SKU 복붙 매칭 커밋 (3단 연쇄 업데이트) ─────────────────────────────────
  const handleSkuCommit = useCallback((
    bookingId: string,
    patch: { product_id: string; package_title: string; land_operator_id?: string | null; departing_location_id?: string | null; land_operator?: string | null; departure_region?: string | null },
  ) => {
    const safePatch = {
      ...patch,
      land_operator:         patch.land_operator ?? undefined,
      departure_region:      patch.departure_region ?? undefined,
      land_operator_id:      patch.land_operator_id ?? undefined,
      departing_location_id: patch.departing_location_id ?? undefined,
    };
    setBookings(ps => ps.map(b => b.id === bookingId ? { ...b, ...safePatch } : b));
    flashCell(`${bookingId}-package_title`);
    if (patch.land_operator_id)      flashCell(`${bookingId}-land_operator_id`);
    if (patch.departing_location_id) flashCell(`${bookingId}-departing_location_id`);
    showToast(`상품 연결됨: ${patch.package_title}`);
  }, [flashCell, showToast]);

  // ── 상태 변경 ───────────────────────────────────────────────────────────────
  const patchStatus = useCallback(async (id: string, status: string) => {
    setProcessing(id);
    try {
      const res = await fetch('/api/bookings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      if (!res.ok) throw new Error((await res.json()).error || '처리 실패');
      setBookings(prev => prev.map(b => b.id === id ? { ...b, status } : b));
    } catch (e) { showToast(e instanceof Error ? e.message : '처리 실패', 'err'); }
    finally { setProcessing(null); }
  }, [showToast]);

  // ── Undo 삭제 ────────────────────────────────────────────────────────────────
  const commitDeleteToDB = useCallback(async (ids: string[]) => {
    await Promise.all(ids.map(id =>
      fetch('/api/bookings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, is_deleted: true }) })
    ));
    setPendingDelete([]);
  }, []);

  const triggerUndoDelete = useCallback((targets: Booking[]) => {
    const ids = targets.map(b => b.id);
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      commitDeleteToDB(pendingDelete.map(b => b.id));
    }
    setBookings(prev => prev.filter(b => !ids.includes(b.id)));
    setPendingDelete(targets);
    setUndoToast({ count: ids.length, ids });
    undoTimerRef.current = setTimeout(() => {
      commitDeleteToDB(ids); setUndoToast(null); undoTimerRef.current = null;
    }, 5000);
  }, [commitDeleteToDB, pendingDelete]);

  const handleUndoDelete = useCallback(() => {
    if (undoTimerRef.current) { clearTimeout(undoTimerRef.current); undoTimerRef.current = null; }
    setBookings(prev => [...pendingDelete, ...prev]);
    setPendingDelete([]); setUndoToast(null);
  }, [pendingDelete]);

  const restore = useCallback(async (id: string) => {
    setProcessing(id);
    try {
      await fetch('/api/bookings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, is_deleted: false }) });
      load();
    } finally { setProcessing(null); }
  }, [load]);

  const handleBulkCommit = useCallback(async (field: string, value: string) => {
    const ids = Array.from(selected);
    for (const id of ids) {
      await fetch('/api/bookings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, [field]: value }),
      });
    }
    setBookings(prev => prev.map(b => selected.has(b.id) ? { ...b, [field]: value } : b));
    showToast(`${ids.length}건 일괄 변경 완료`);
    setBulkField(null); setSelected(new Set());
  }, [selected, showToast]);

  const sendAlimtalk = useCallback(async (b: Booking) => {
    if (!b.customers?.phone) { showToast('전화번호 없음', 'err'); return; }
    await fetch('/api/notify/alimtalk', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: b.customers.phone, name: b.customers.name, templateCode: 'BOOKING' }),
    });
    showToast('알림톡 발송 완료');
  }, [showToast]);

  const handleSort = useCallback((field: string) => {
    if (sortField !== field) { setSortField(field); setSortDir('asc'); return; }
    if (sortDir === 'asc') { setSortDir('desc'); return; }
    setSortField(null); setSortDir(null);
  }, [sortField, sortDir]);

  // ── [4] Magic Date Range Parser ──────────────────────────────────────────────
  const parsedDateRange = useMemo((): { from: string; to: string } | null => {
    const m = searchQuery.trim().match(DATE_RANGE_RE);
    if (!m) return null;
    return { from: parseShortDate(m[1]), to: m[2] ? parseShortDate(m[2]) : parseShortDate(m[1]) };
  }, [searchQuery]);

  // ── 탭 카운트 ────────────────────────────────────────────────────────────────
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const dDiffFn = (date?: string) => date
    ? Math.ceil((new Date(date).getTime() - today.getTime()) / 86400000)
    : null;

  const unpaidRiskCnt    = useMemo(() => bookings.filter(b => { const d = dDiffFn(b.departure_date); return ['pending','confirmed'].includes(b.status) && d !== null && d >= 0 && d <= 7 && (b.total_price||0)-(b.paid_amount||0) > 0; }).length, [bookings, today]); // eslint-disable-line
  const missingCnt       = useMemo(() => bookings.filter(b => !['cancelled','completed'].includes(b.status) && (!b.customers?.phone || !b.departure_date || !b.departure_region)).length, [bookings]);
  // 원가초과: 진짜 손실 (출금이 입금보다 -10k 이상)
  const overCostCnt      = useMemo(() => bookings.filter(b => b.status !== 'cancelled' && ((b.paid_amount||0) - (b.total_paid_out||0)) < -10000).length, [bookings]);
  // 환불대기: 취소인데 아직 환불 남음
  const refundPendingCnt = useMemo(() => bookings.filter(b => b.status === 'cancelled' && ((b.paid_amount||0) - (b.total_paid_out||0)) > 5000).length, [bookings]);
  // 정산대기 D-7 지남: 출발 7일 이상 지났는데 settlement_confirmed_at이 비어있는 취소 제외 건
  const settlementPendingCnt = useMemo(() => {
    const now = Date.now();
    return bookings.filter(b => {
      if (b.status === 'cancelled' || b.settlement_confirmed_at) return false;
      if (!b.departure_date) return false;
      const daysAfter = (now - new Date(b.departure_date).getTime()) / 86400000;
      return daysAfter >= 7;
    }).length;
  }, [bookings]);
  const prepDocsCnt      = useMemo(() => bookings.filter(b => { const d = dDiffFn(b.departure_date); return !['cancelled','completed'].includes(b.status) && d !== null && d >= 0 && d <= 7 && !b.has_sent_docs; }).length, [bookings, today]); // eslint-disable-line
  const depositUnpaidCnt = useMemo(() => bookings.filter(b => !['cancelled','completed'].includes(b.status) && (b.paid_amount == null || b.paid_amount === 0)).length, [bookings]);
  const landBombCnt      = useMemo(() => bookings.filter(b => { const d = dDiffFn(b.departure_date); return b.status !== 'cancelled' && d !== null && d >= 0 && d <= 7 && (b.total_cost||0)-(b.total_paid_out||0) > 0; }).length, [bookings, today]); // eslint-disable-line

  // ── 필터 + 정렬 ─────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = [...bookings];

    // ── 라이프사이클 필터 (최우선) ──────────────────────────────────────────
    if (lifecycleTab === 'active') {
      list = list.filter(b => {
        if (b.is_deleted) return false;
        if (!['pending', 'confirmed'].includes(b.status)) return false;
        // 정산 확정된 건은 기본 숨김 (settlement_pending 필터에서만 보임)
        if (b.settlement_confirmed_at && activeTab !== 'settlement_pending') return false;
        if (!b.departure_date) return true;
        return new Date(b.departure_date).getTime() >= today.getTime();
      });
    } else if (lifecycleTab === 'done') {
      list = list.filter(b => {
        if (b.is_deleted) return false;
        if (b.status === 'completed') return true;
        return !!(b.departure_date && new Date(b.departure_date).getTime() < today.getTime());
      });
    } else if (lifecycleTab === 'cancelled') {
      list = list.filter(b => !b.is_deleted && b.status === 'cancelled');
    }
    // trash: API가 include_deleted=only로 이미 필터링

    // ── 스마트 필터 (진행 중 탭 내 세부 필터) ──────────────────────────────
    if (activeTab === 'unpaid_risk')    list = list.filter(b => { const d = dDiffFn(b.departure_date); return ['pending','confirmed'].includes(b.status) && d !== null && d >= 0 && d <= 7 && (b.total_price||0)-(b.paid_amount||0) > 0; });
    else if (activeTab === 'missing_info')  list = list.filter(b => !['cancelled','completed'].includes(b.status) && (!b.customers?.phone || !b.departure_date || !b.departure_region));
    else if (activeTab === 'land_bomb')  list = list.filter(b => { const d = dDiffFn(b.departure_date); return b.status !== 'cancelled' && d !== null && d >= 0 && d <= 7 && (b.total_cost||0)-(b.total_paid_out||0) > 0; });
    else if (activeTab === 'prep_docs')  list = list.filter(b => { const d = dDiffFn(b.departure_date); return !['cancelled','completed'].includes(b.status) && d !== null && d >= 0 && d <= 7 && !b.has_sent_docs; });
    else if (activeTab === 'deposit_unpaid') list = list.filter(b => !['cancelled','completed'].includes(b.status) && (b.paid_amount == null || b.paid_amount === 0));
    else if (activeTab === 'over_cost')       list = list.filter(b => b.status !== 'cancelled' && ((b.paid_amount||0) - (b.total_paid_out||0)) < -10000);
    else if (activeTab === 'refund_pending')  list = list.filter(b => b.status === 'cancelled' && ((b.paid_amount||0) - (b.total_paid_out||0)) > 5000);
    else if (activeTab === 'settlement_pending') {
      const now = Date.now();
      list = list.filter(b => {
        if (b.status === 'cancelled' || b.settlement_confirmed_at) return false;
        if (!b.departure_date) return false;
        const daysAfter = (now - new Date(b.departure_date).getTime()) / 86400000;
        return daysAfter >= 7;
      });
    }

    if (searchQuery.trim()) {
      if (parsedDateRange) {
        list = list.filter(b => {
          const f = searchTarget === 'booking' ? (b.booking_date || b.created_at) : b.departure_date;
          if (!f) return false;
          const d = f.slice(0, 10);
          return d >= parsedDateRange.from && d <= parsedDateRange.to;
        });
      } else {
        const q = searchQuery.toLowerCase();
        list = list.filter(b =>
          (b.package_title||'').toLowerCase().includes(q) ||
          (b.customers?.name||'').toLowerCase().includes(q) ||
          (b.booking_no||'').toLowerCase().includes(q) ||
          (b.customers?.phone||'').includes(q) ||
          (b.departure_region||'').toLowerCase().includes(q) ||
          (b.land_operator||'').toLowerCase().includes(q)
        );
      }
    }

    if (sortField && sortDir) {
      list.sort((a, b) => {
        let av: number | string, bv: number | string;
        switch (sortField) {
          case 'departure_date': av = a.departure_date||''; bv = b.departure_date||''; break;
          case 'booking_date':   av = a.booking_date||a.created_at; bv = b.booking_date||b.created_at; break;
          case 'adult_price':    av = a.adult_price||0; bv = b.adult_price||0; break;
          case 'total_price':    av = a.total_price||0; bv = b.total_price||0; break;
          case 'paid_amount':    av = a.paid_amount||0; bv = b.paid_amount||0; break;
          case 'balance':        av = (a.total_price||0)-(a.paid_amount||0); bv = (b.total_price||0)-(b.paid_amount||0); break;
          default:               av = a.created_at; bv = b.created_at;
        }
        const cmp = typeof av === 'number' ? av-(bv as number) : av.localeCompare(bv as string);
        return sortDir === 'asc' ? cmp : -cmp;
      });
    } else {
      list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }
    return list;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings, lifecycleTab, activeTab, searchQuery, parsedDateRange, searchTarget, sortField, sortDir, today]);

  const footerStats = useMemo(() => ({
    totalSales:   filtered.reduce((s, b) => s + (b.total_price||0), 0),
    totalPaid:    filtered.reduce((s, b) => s + (b.paid_amount||0), 0),
    totalBalance: filtered.reduce((s, b) => s + Math.max(0, (b.total_price||0)-(b.paid_amount||0)), 0),
  }), [filtered]);

  const cardStats = useMemo(() => ({
    activeCnt:    bookings.filter(b => ['pending','confirmed'].includes(b.status)).length,
    totalSales:   bookings.reduce((s, b) => s + (b.total_price||0), 0),
    totalPaid:    bookings.reduce((s, b) => s + (b.paid_amount||0), 0),
    totalBalance: bookings.reduce((s, b) => s + Math.max(0, (b.total_price||0)-(b.paid_amount||0)), 0),
  }), [bookings]);

  // ── 가상화 ──────────────────────────────────────────────────────────────────
  const vStartIdx  = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const vEndIdx    = Math.min(filtered.length - 1, Math.ceil((scrollTop + containerH) / ROW_H) + OVERSCAN);
  const vPadTop    = vStartIdx * ROW_H;
  const vPadBottom = Math.max(0, (filtered.length - vEndIdx - 1) * ROW_H);

  // ── 키보드 네비게이션 ────────────────────────────────────────────────────────
  const navigateTo = useCallback((row: number, col: number) => {
    if (row < 0 || row >= filtered.length) return;
    const c = Math.max(1, Math.min(col, TOTAL_NAV_COLS - 1));
    setFocusedCell({ row, col: c });
    cellRefs.current.get(`${row}-${c}`)?.focus();
  }, [filtered.length]);

  // commitAndDown / handleLandOperatorCommit 에서 navigateTo 사용 — ref로 안정화
  const navigateToRef = useRef(navigateTo);
  navigateToRef.current = navigateTo;

  const handleTableKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (editingCell || !focusedCell) return;
    const { row, col } = focusedCell;
    switch (e.key) {
      case 'ArrowDown':  e.preventDefault(); navigateToRef.current(row + 1, col); break;
      case 'ArrowUp':    e.preventDefault(); navigateToRef.current(row - 1, col); break;
      case 'ArrowRight': e.preventDefault(); navigateToRef.current(row, col + 1); break;
      case 'ArrowLeft':  e.preventDefault(); navigateToRef.current(row, col - 1); break;
      case 'Enter': {
        e.preventDefault();
        const b = filtered[row];
        if (!b || !COL_FIELD[col]) break;
        setEditingCell({ id: b.id, field: COL_FIELD[col] as string });
        setCellValue(String(b[COL_FIELD[col]] ?? ''));
        break;
      }
      case 'Escape': setFocusedCell(null); break;
    }
  }, [editingCell, focusedCell, filtered]);

  const regRef = (el: HTMLElement | null, row: number, col: number) => {
    const k = `${row}-${col}`;
    if (el) cellRefs.current.set(k, el); else cellRefs.current.delete(k);
  };

  // ── 체크박스 ────────────────────────────────────────────────────────────────
  const allSel = filtered.length > 0 && filtered.every(b => selected.has(b.id));
  const toggleAll = useCallback(() => {
    setSelected(prev => prev.size === filtered.length && filtered.every(b => prev.has(b.id))
      ? new Set() : new Set(filtered.map(b => b.id)));
  }, [filtered]);
  const toggleOne = useCallback((id: string) => {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);

  const isTrash = lifecycleTab === 'trash';

  const dateRangeBadge = useMemo(() => {
    if (!parsedDateRange) return null;
    const lbl = searchTarget === 'booking' ? '예약일' : '출발일';
    return parsedDateRange.from === parsedDateRange.to
      ? `${parsedDateRange.from} ${lbl} 검색 중`
      : `${parsedDateRange.from} ~ ${parsedDateRange.to} ${lbl} 검색 중`;
  }, [parsedDateRange, searchTarget]);

  // 공통 NumInput 스타일
  const numInputCls = 'w-32 border border-blue-500 rounded px-2 py-1.5 text-[14px] font-bold text-slate-800 focus:outline-none bg-white tabular-nums text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

  // ── JSX ─────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col overflow-hidden" style={{ height: 'calc(100vh - 80px)' }}>

      {/* 헤더 */}
      <div className="flex items-center justify-between mb-3 flex-nowrap gap-4 shrink-0">
        <div className="shrink-0">
          <h1 className="text-[16px] font-bold text-slate-800 whitespace-nowrap">{isTrash ? '휴지통' : '예약 관리'}</h1>
          <p className="text-[13px] text-slate-500 mt-0.5 whitespace-nowrap">전체 {bookings.length}건 / 조회 {filtered.length}건</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Link href="/admin/customers" className="text-[13px] text-slate-700 border border-slate-300 px-3 py-2 rounded-lg bg-white hover:bg-slate-50 whitespace-nowrap">고객 관리</Link>
          <Link href="/admin/bookings/new" className="bg-[#001f3f] text-white text-[13px] px-4 py-2 rounded-lg hover:bg-blue-900 transition whitespace-nowrap font-semibold">+ 예약 등록</Link>
        </div>
      </div>

      {/* 요약 카드 */}
      {!isTrash && (
        <div className="grid grid-cols-4 gap-3 mb-3 shrink-0">
          {[
            { label: '진행 중 예약', value: cardStats.activeCnt + '건',    color: 'text-blue-600' },
            { label: '총 판매가',    value: fmtK(cardStats.totalSales),     color: 'text-slate-800' },
            { label: '입금 완료액',  value: fmtK(cardStats.totalPaid),      color: 'text-emerald-600' },
            { label: '미수금 잔금',  value: fmtK(cardStats.totalBalance),   color: 'text-red-500' },
          ].map(c => (
            <div key={c.label} className="bg-white rounded-lg border border-slate-200 px-4 py-3 text-center">
              <p className={`text-[16px] font-bold ${c.color}`}>{c.value}</p>
              <p className="text-[13px] text-slate-500 mt-0.5">{c.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* 통합 검색바 */}
      <div className="flex items-center gap-2 mb-2.5 shrink-0">
        <select value={searchTarget} onChange={e => setSearchTarget(e.target.value as typeof searchTarget)}
          className="border border-slate-200 rounded-lg px-2 py-2 text-[13px] text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 shrink-0 cursor-pointer">
          <option value="all">전체</option>
          <option value="departure">출발일</option>
          <option value="booking">예약일</option>
        </select>
        <div className="relative flex-1">
          <input type="text" value={rawSearch} onChange={e => setRawSearch(e.target.value)}
            placeholder="고객명, 상품명, 예약번호, 출발지역 / 날짜: 260320 또는 260101~260331"
            className="w-full pl-3 pr-8 py-2 border border-slate-200 rounded-lg text-[14px] focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white text-slate-800" />
          {rawSearch && (
            <button onClick={() => setRawSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-[18px] leading-none">×</button>
          )}
        </div>
        {dateRangeBadge && (
          <span className="shrink-0 text-[13px] text-blue-700 font-semibold bg-blue-50 border border-blue-200 px-3 py-2 rounded-lg whitespace-nowrap">
            {dateRangeBadge}
          </span>
        )}
      </div>

      {/* 라이프사이클 파이프라인 탭 */}
      <div className="flex items-center border-b border-slate-200 shrink-0">
        {([
          { id: 'active'    as const, label: '진행 중',         cntFn: () => bookings.filter(b => !b.is_deleted && ['pending','confirmed'].includes(b.status) && (!b.departure_date || new Date(b.departure_date) >= today)).length },
          { id: 'done'      as const, label: '완료/지난 행사',  cntFn: () => bookings.filter(b => !b.is_deleted && (b.status === 'completed' || (!!b.departure_date && new Date(b.departure_date) < today))).length },
          { id: 'cancelled' as const, label: '취소',            cntFn: () => bookings.filter(b => !b.is_deleted && b.status === 'cancelled').length },
          { id: 'trash'     as const, label: '휴지통',          cntFn: () => 0 },
        ]).map(tab => {
          const cnt = tab.cntFn();
          const isActive = lifecycleTab === tab.id;
          return (
            <button key={tab.id}
              onClick={() => { setLifecycleTab(tab.id); setActiveTab(''); }}
              className={`px-5 py-2.5 text-[13px] font-semibold border-b-2 transition-colors whitespace-nowrap -mb-px
                ${isActive ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'}`}>
              {tab.label}
              {cnt > 0 && (
                <span className={`ml-1.5 text-[11px] px-1.5 py-0.5 rounded-full ${isActive ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>
                  {cnt}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 스마트 필터 배지 (진행 중 탭에서만) */}
      {lifecycleTab === 'active' ? (
        <div className="flex gap-1.5 mb-2 flex-wrap items-center shrink-0 mt-2">
          {([
            ['unpaid_risk',    '미수금 위험',        unpaidRiskCnt,    'red'],
            ['missing_info',   '정보 누락',           missingCnt,       'amber'],
            ['prep_docs',      '준비물/확정서',       prepDocsCnt,      'rose'],
            ['deposit_unpaid', '계약금 미결제',       depositUnpaidCnt, 'orange'],
            ['land_bomb',      '랜드사 미결제 폭탄',  landBombCnt,      'red'],
            ['over_cost',      '🩸 원가초과',          overCostCnt,      'red'],
            ['refund_pending', '⚠️ 환불대기',         refundPendingCnt, 'amber'],
            ['settlement_pending', '⏳ 정산대기(D-7 지남)', settlementPendingCnt, 'slate'],
          ] as [string, string, number, string][]).map(([tab, label, cnt, color]) => (
            <button key={tab} onClick={() => setActiveTab(prev => prev === tab ? '' : tab as typeof activeTab)}
              className={`px-3 py-1 rounded-full text-[11px] font-medium transition flex items-center gap-1 whitespace-nowrap
                ${activeTab === tab
                  ? `bg-${color}-600 text-white`
                  : `bg-${color}-50 text-${color}-700 border border-${color}-200 hover:bg-${color}-100`}`}>
              {label}
              {cnt > 0 && (
                <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${activeTab === tab ? `bg-${color}-700` : `bg-${color}-200 text-${color}-800`}`}>
                  {cnt}
                </span>
              )}
            </button>
          ))}
        </div>
      ) : (
        <div className="mb-2 shrink-0" />
      )}

      {/* 테이블 */}
      {isLoading ? (
        <div className="flex-1 min-h-0 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full"><tbody>
            {[...Array(10)].map((_, i) => (
              <tr key={i} style={{ height: ROW_H }} className="border-b border-slate-200">
                {[...Array(12)].map((__, j) => (
                  <td key={j} className="px-3"><div className="h-4 w-full bg-slate-100 rounded animate-pulse" /></td>
                ))}
              </tr>
            ))}
          </tbody></table>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex-1 min-h-0 bg-white border border-slate-200 rounded-lg flex items-center justify-center">
          <div className="text-center">
            <p className="text-slate-500 font-medium text-[14px]">{isTrash ? '삭제된 예약 없음' : rawSearch ? '검색 결과 없음' : '예약 없음'}</p>
            {!rawSearch && !isTrash && <Link href="/admin/bookings/new" className="mt-4 inline-block text-blue-600 text-[14px] hover:underline">첫 예약 등록 →</Link>}
          </div>
        </div>
      ) : (
        <div ref={tableContainerRef}
          className="flex-1 min-h-0 bg-white border border-slate-200 rounded-lg overflow-x-auto overflow-y-auto relative"
          onKeyDown={handleTableKeyDown}
          onScroll={e => setScrollTop((e.currentTarget as HTMLDivElement).scrollTop)}>

          <table className="w-full min-w-[2700px]">
            <thead className="sticky top-0 z-20 bg-white border-b border-slate-200">
              <tr>
                <th className="sticky left-0 z-30 bg-white px-3 py-2 w-12 min-w-[52px]">
                  <input type="checkbox" checked={allSel} onChange={toggleAll} className="w-4 h-4 rounded border-slate-300 text-blue-600 cursor-pointer" />
                </th>
                <th className="sticky left-[52px] z-30 bg-white text-left px-3 py-2 text-[13px] text-slate-800 font-semibold whitespace-nowrap min-w-[160px]">예약번호</th>
                <SortTh label="예약일"     field="booking_date"   sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortTh label="출발일"     field="departure_date" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <th className="text-left px-3 py-2 text-[13px] text-slate-800 font-semibold whitespace-nowrap min-w-[200px]">상품명</th>
                <th className="sticky left-[196px] z-30 bg-white text-left px-3 py-2 text-[13px] text-slate-800 font-semibold whitespace-nowrap min-w-[160px]">고객명</th>
                <th className="text-left px-3 py-2 text-[13px] text-slate-800 font-semibold whitespace-nowrap min-w-[140px]">출발지역</th>
                <th className="text-left px-3 py-2 text-[13px] text-slate-800 font-semibold whitespace-nowrap min-w-[180px]">랜드사</th>
                <th className="text-left px-3 py-2 text-[13px] text-slate-800 font-semibold whitespace-nowrap min-w-[140px]">담당자</th>
                <th className="text-left px-3 py-2 text-[13px] text-slate-800 font-semibold whitespace-nowrap min-w-[160px]">인원</th>
                <SortTh label="1인 판매가" field="adult_price"    sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-right min-w-[170px]" />
                <SortTh label="전체 판매가" field="total_price"   sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-right min-w-[170px]" />
                <th className="text-right px-3 py-2 text-[13px] font-semibold text-slate-800 whitespace-nowrap min-w-[140px]">예상 마진</th>
                <th className="text-center px-3 py-2 text-[13px] font-semibold text-slate-800 whitespace-nowrap min-w-[110px]">마진율</th>
                <SortTh label="입금액"      field="paid_amount"   sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-right min-w-[160px]" />
                <SortTh label="잔금"        field="balance"       sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-right min-w-[160px]" />
                <th className="text-center px-3 py-2 text-[13px] text-slate-800 font-semibold whitespace-nowrap min-w-[140px]">상태</th>
                <th className="px-3 py-2 min-w-[140px]" />
              </tr>
            </thead>

            <tbody>
              {vPadTop > 0 && <tr style={{ height: vPadTop }}><td colSpan={18} /></tr>}
              {filtered.slice(vStartIdx, vEndIdx + 1).map((b, i) => {
                const ri              = vStartIdx + i;
                const balance         = (b.total_price||0) - (b.paid_amount||0);
                const agencyUnpaid    = (b.total_cost||0) - (b.total_paid_out||0);
                const isPaid          = balance <= 0 && (b.total_price||0) > 0;
                const margin          = (b.total_price||0) - (b.total_cost||0);
                const mRate           = b.total_price ? ((margin / b.total_price) * 100).toFixed(1) : '0';
                const dDiff           = dDiffFn(b.departure_date);
                const isRisk          = dDiff !== null && dDiff >= 0 && dDiff <= 7 && balance > 0 && ['pending','confirmed'].includes(b.status);
                const isLandBomb      = dDiff !== null && dDiff >= 0 && dDiff <= 7 && agencyUnpaid > 0 && b.status !== 'cancelled';
                const isMissing       = !b.customers?.phone || !b.departure_date || !b.departure_region;
                const isDepositUnpaid = !['cancelled','completed'].includes(b.status) && (b.paid_amount == null || b.paid_amount === 0);

                // ── 취소/환불 가시성 배지 (2026-04-15 추가) ──────────────────────
                const netCashflow     = (b.paid_amount || 0) - (b.total_paid_out || 0);
                const isCancelled     = b.status === 'cancelled';
                const isRefundSettled = isCancelled && (!!b.refund_settled_at || Math.abs(netCashflow) <= 5000) && (b.paid_amount || 0) > 0;
                const isRefundPending = isCancelled && netCashflow > 5000;
                // 원가 초과: 실제 손실 (송금 초과)
                const isOverCost      = !isCancelled && netCashflow < -10000;
                // 정산 확정 여부 (관리자가 '이제 안 봐도 됨' 표시)
                const isSettled       = !!b.settlement_confirmed_at;
                const isSel           = selected.has(b.id);
                const hasBusanRec     = busanRec.has(b.id);
                const isEditing       = (field: string) => editingCell?.id === b.id && editingCell.field === field;

                const rowBg      = isSel ? 'bg-blue-50' : isLandBomb ? 'bg-red-50 hover:bg-red-100' : isRisk ? 'bg-orange-50 hover:bg-orange-100' : 'hover:bg-slate-50';
                const rowBorder  = isLandBomb ? 'outline outline-2 outline-red-400 outline-offset-[-1px]' : '';
                const isFoc      = (col: number) => focusedCell?.row === ri && focusedCell.col === col;
                const focusCls   = (col: number) => isFoc(col) ? 'ring-2 ring-inset ring-blue-400 rounded' : '';

                return (
                  // [1] CSS style로 ROW_H 고정 — 편집 시 레이아웃 흔들림 방지
                  <tr key={b.id} style={{ height: ROW_H }}
                    className={`${rowBg} ${rowBorder} border-b border-slate-200 transition-colors group cursor-pointer`}
                    onClick={() => setDrawerBookingId(b.id)}
                    onContextMenu={e => {
                      e.preventDefault();
                      setCtxMenu({ x: Math.min(e.clientX, window.innerWidth - 200), y: Math.min(e.clientY, window.innerHeight - 180), b });
                    }}>

                    {/* 체크박스 */}
                    <td className="sticky left-0 z-10 bg-inherit px-3 min-w-[52px] whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={isSel} onChange={() => toggleOne(b.id)} onClick={e => e.stopPropagation()}
                        className="w-4 h-4 rounded border-slate-300 text-blue-600 cursor-pointer" />
                    </td>

                    {/* 예약번호 */}
                    <td tabIndex={0} ref={el => regRef(el, ri, 1)} onFocus={() => setFocusedCell({ row: ri, col: 1 })}
                      className={`sticky left-[52px] z-10 bg-inherit px-3 min-w-[160px] whitespace-nowrap outline-none ${focusCls(1)}`}
                      onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-1.5">
                        <Link href={`/admin/bookings/${b.id}`} className="font-mono text-[13px] text-blue-600 hover:underline font-bold">
                          {b.booking_no || b.id.slice(0, 8)}
                        </Link>
                        <button onClick={e => { e.stopPropagation(); copyText(b.booking_no || b.id.slice(0, 8)); }}
                          className="text-slate-300 hover:text-slate-500 transition-colors p-0.5 rounded">
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                          </svg>
                        </button>
                        {isRisk        && <span className="text-[11px] text-red-500 font-bold" title="출발 7일내 미수금">위험</span>}
                        {isLandBomb    && <span className="text-[11px] text-red-600 font-bold animate-pulse" title="랜드사 미송금 위험">미송금</span>}
                        {isMissing     && <span className="text-[11px] text-amber-500 font-bold" title="정보 누락">누락</span>}
                        {isDepositUnpaid && !isCancelled && <span className="text-[11px] text-orange-500 font-bold" title="계약금 미결제">미납</span>}
                        {isCancelled    && isRefundSettled && <span className="text-[11px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded-full" title={`환불완료 (순현금 ${netCashflow.toLocaleString()}원)`}>♻️ 환불완료</span>}
                        {isCancelled    && isRefundPending && <span className="text-[11px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full font-semibold" title={`환불대기 — ${netCashflow.toLocaleString()}원 남음`}>⚠️ 환불대기</span>}
                        {isOverCost     && <span className="text-[11px] px-1.5 py-0.5 bg-red-100 text-red-700 rounded-full font-semibold" title={`원가초과 ${Math.abs(netCashflow).toLocaleString()}원 — 출금이 입금보다 큼`}>🩸 원가초과</span>}
                        {isSettled      && <span className="text-[11px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded-full" title={`정산 확정: ${b.settlement_confirmed_at?.slice(0,10)}`}>♻️ 정산확정</span>}
                      </div>
                    </td>

                    {/* 예약일 */}
                    <td tabIndex={0} ref={el => regRef(el, ri, 2)} onFocus={() => setFocusedCell({ row: ri, col: 2 })}
                      className={`px-3 min-w-[140px] whitespace-nowrap outline-none ${focusCls(2)}`}>
                      <span className="text-[13px] font-medium text-slate-500">{fmtDate(b.booking_date || b.created_at)}</span>
                    </td>

                    {/* 출발일 — Full-Cell Hitbox */}
                    <td tabIndex={0} ref={el => regRef(el, ri, 3)} onFocus={() => setFocusedCell({ row: ri, col: 3 })}
                      className={`p-0 min-w-[150px] whitespace-nowrap outline-none ${focusCls(3)}`}
                      onClick={e => e.stopPropagation()}>
                      {isEditing('departure_date') ? (
                        <div className="w-full h-[88px] flex items-center px-3">
                          <DateInputCell
                            initialValue={b.departure_date || ''}
                            onCommit={v => commitCell(b.id, 'departure_date', v)}
                            onCancel={cancelEdit}
                          />
                        </div>
                      ) : (
                        <div onClick={() => { setEditingCell({ id: b.id, field: 'departure_date' }); setCellValue(b.departure_date || ''); }}
                          className="w-full h-[88px] flex items-center px-3 cursor-pointer hover:bg-blue-50 transition-colors gap-1.5">
                          <span className={`font-mono tabular-nums ${isRisk ? 'text-[13px] font-bold text-red-700' : 'text-[13px] font-semibold text-slate-800'} ${!b.departure_date ? 'text-slate-300 font-normal' : ''}`}>
                            {fmtDateKo(b.departure_date)}
                          </span>
                          {dDiff !== null && dDiff >= 0 && dDiff <= 14 && (
                            <span className={`text-[11px] font-bold ${dDiff <= 7 ? 'text-red-500' : 'text-amber-500'}`}>D-{dDiff}</span>
                          )}
                        </div>
                      )}
                    </td>

                    {/* 상품명 — SKU 복붙 방식 (ProductSkuCell) */}
                    <td tabIndex={0} ref={el => regRef(el, ri, 4)} onFocus={() => setFocusedCell({ row: ri, col: 4 })}
                      onClick={(e) => e.stopPropagation()}
                      className={`px-3 min-w-[200px] max-w-[280px] outline-none transition-colors ${focusCls(4)}`}
                      style={getCellStyle(`${b.id}-package_title`)}>
                      <ProductSkuCell
                        booking={b}
                        onCommit={patch => handleSkuCommit(b.id, patch)}
                        onError={msg => showToast(msg, 'err')}
                      />
                    </td>

                    {/* 고객명 */}
                    <td tabIndex={0} ref={el => regRef(el, ri, 5)} onFocus={() => setFocusedCell({ row: ri, col: 5 })}
                      className={`sticky left-[196px] z-10 bg-inherit px-3 min-w-[160px] whitespace-nowrap outline-none ${focusCls(5)}`}
                      onClick={e => e.stopPropagation()}>
                      {b.customers?.id
                        ? <Link href={`/admin/customers/${b.customers.id}`} className="font-bold text-[14px] text-slate-800 hover:text-blue-600 hover:underline block">{b.customers.name}</Link>
                        : <span className="font-bold text-[14px] text-slate-800">{b.customers?.name || '-'}</span>}
                      {b.customers?.phone
                        ? <p className="text-[13px] text-slate-500 mt-0.5">{b.customers.phone}</p>
                        : <p className="text-[13px] text-amber-400 mt-0.5">번호 없음</p>}
                    </td>

                    {/* 출발지역 — FK 기반 인라인 선택 */}
                    <td tabIndex={0} ref={el => regRef(el, ri, 6)} onFocus={() => setFocusedCell({ row: ri, col: 6 })}
                      className={`px-3 min-w-[140px] whitespace-nowrap transition-colors outline-none ${focusCls(6)}`}
                      style={getCellStyle(`${b.id}-departing_location_id`)}
                      onClick={e => e.stopPropagation()}>
                      {isEditing('departing_location_id') ? (
                        <LocationSelectCell
                          initialId={b.departing_location_id ?? null}
                          locations={activeLocations}
                          onCommit={id => handleLocationChange(b.id, id)}
                          onCancel={cancelEdit}
                        />
                      ) : (() => {
                        const loc = allLocations.find(l => l.id === b.departing_location_id);
                        const displayName = loc?.name ?? b.departure_region;
                        return (
                          <div className="flex flex-col gap-0.5">
                            <div onClick={() => setEditingCell({ id: b.id, field: 'departing_location_id' })}
                              className="cursor-pointer hover:bg-blue-50 px-2 py-1 rounded flex items-center gap-1">
                              <span className="text-[13px] font-semibold text-slate-800">
                                {displayName || <span className="text-slate-300 font-medium">+ 출발지</span>}
                              </span>
                              {loc && !loc.is_active && (
                                <span className="text-[11px] px-1 py-0.5 bg-red-50 text-red-600 rounded font-medium">비활성</span>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                    </td>

                    {/* 랜드사 — FK 기반 인라인 선택 */}
                    <td tabIndex={0} ref={el => regRef(el, ri, 7)} onFocus={() => setFocusedCell({ row: ri, col: 7 })}
                      className={`p-0 min-w-[180px] whitespace-nowrap outline-none ${focusCls(7)}`}
                      style={getCellStyle(`${b.id}-land_operator_id`)}
                      onClick={e => e.stopPropagation()}>
                      {isEditing('land_operator_id') ? (
                        <div className="w-full h-[88px] flex items-center px-3">
                          <VendorSelectCell
                            initialId={b.land_operator_id ?? null}
                            vendors={activeVendors}
                            onCommit={id => handleVendorChange(b.id, id)}
                            onCancel={cancelEdit}
                          />
                        </div>
                      ) : (() => {
                        const op = allVendors.find(v => v.id === b.land_operator_id);
                        const displayName = op?.name ?? b.land_operator;
                        return (
                          <div onClick={() => setEditingCell({ id: b.id, field: 'land_operator_id' })}
                            className="w-full h-[88px] flex items-center px-3 cursor-pointer hover:bg-blue-50 transition-colors gap-2">
                            <span className={`text-[13px] font-semibold ${displayName ? 'text-slate-800' : 'text-slate-300 font-medium'}`}>
                              {displayName || '+ 선택'}
                            </span>
                            {op && !op.is_active && (
                              <span className="text-[11px] px-1 py-0.5 bg-red-50 text-red-600 rounded font-medium">비활성</span>
                            )}
                          </div>
                        );
                      })()}
                    </td>

                    {/* 담당자 — Full-Cell Hitbox */}
                    <td tabIndex={0} ref={el => regRef(el, ri, 8)} onFocus={() => setFocusedCell({ row: ri, col: 8 })}
                      className={`p-0 min-w-[140px] whitespace-nowrap outline-none ${focusCls(8)}`}
                      style={getCellStyle(`${b.id}-manager_name`)}
                      onClick={e => e.stopPropagation()}>
                      {isEditing('manager_name') ? (
                        <div className="w-full h-[88px] flex items-center px-3">
                          <input autoFocus value={cellValue} onChange={e => setCellValue(e.target.value)}
                            onBlur={() => commitCell(b.id, 'manager_name')}
                            onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); commitAndDown(b.id, 'manager_name', cellValue, ri); } if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); } }}
                            className="w-32 border border-blue-500 rounded px-2 py-1.5 text-[13px] font-medium focus:outline-none bg-white" />
                        </div>
                      ) : (
                        <div onClick={() => { setEditingCell({ id: b.id, field: 'manager_name' }); setCellValue(b.manager_name || ''); }}
                          className="w-full h-[88px] flex items-center px-3 cursor-pointer hover:bg-blue-50 transition-colors">
                          <span className={`text-[13px] font-semibold ${b.manager_name ? 'text-slate-800' : 'text-slate-300 font-medium'}`}>
                            {b.manager_name || '+ 입력'}
                          </span>
                        </div>
                      )}
                    </td>

                    {/* [2] 인원 — Full-Cell Hitbox */}
                    <td tabIndex={0} ref={el => regRef(el, ri, 9)} onFocus={() => setFocusedCell({ row: ri, col: 9 })}
                      className={`p-0 min-w-[170px] whitespace-nowrap outline-none ${focusCls(9)}`}
                      style={getCellStyle(`${b.id}-adult_count`)}
                      onClick={e => e.stopPropagation()}>
                      {isEditing('adult_count') ? (
                        <div className="w-full h-[88px] flex items-center px-3">
                          <HeadcountCell
                            initialAdult={b.adult_count || 1}
                            initialChild={b.child_count || 0}
                            bookingId={b.id}
                            onCommit={commitHeadcount}
                            onCancel={cancelEdit}
                          />
                        </div>
                      ) : (
                        <div onClick={() => { if (isTrash) return; setEditingCell({ id: b.id, field: 'adult_count' }); }}
                          className={`w-full h-[88px] flex items-center px-3 transition-colors ${!isTrash ? 'cursor-pointer hover:bg-blue-50' : ''}`}>
                          <span className="text-[13px] font-bold text-slate-800">
                            성인 {b.adult_count ?? 0}{(b.child_count ?? 0) > 0 ? ` / 아동 ${b.child_count}` : ''}
                          </span>
                        </div>
                      )}
                    </td>

                    {/* [2] 1인 판매가 — Full-Cell Hitbox */}
                    <td tabIndex={0} ref={el => regRef(el, ri, 10)} onFocus={() => setFocusedCell({ row: ri, col: 10 })}
                      className={`p-0 min-w-[170px] whitespace-nowrap outline-none ${focusCls(10)}`}
                      style={getCellStyle(`${b.id}-adult_price`)}
                      onClick={e => e.stopPropagation()}>
                      {isEditing('adult_price') ? (
                        <div className="w-full h-[88px] flex items-center justify-end px-3">
                          <NumInputCell
                            initialValue={b.adult_price || 0}
                            bookingId={b.id}
                            field="adult_price"
                            onCommit={commitAutoCalc}
                            onCancel={cancelEdit}
                            className={numInputCls}
                          />
                        </div>
                      ) : (
                        <div onClick={() => { if (isTrash) return; setEditingCell({ id: b.id, field: 'adult_price' }); }}
                          className={`w-full h-[88px] flex items-center justify-end px-3 transition-colors tabular-nums ${!isTrash ? 'cursor-pointer hover:bg-blue-50' : ''} ${!b.adult_price ? 'text-slate-300 font-normal text-[13px]' : 'font-bold text-[14px] text-slate-800'}`}>
                          {fmt(b.adult_price)}
                        </div>
                      )}
                    </td>

                    {/* 전체 판매가 */}
                    <td tabIndex={0} ref={el => regRef(el, ri, 11)} onFocus={() => setFocusedCell({ row: ri, col: 11 })}
                      className={`px-3 min-w-[170px] text-right whitespace-nowrap tabular-nums outline-none ${focusCls(11)} ${!(b.total_price) ? 'text-slate-300 font-normal text-[13px]' : 'font-bold text-[14px] text-slate-800'}`}
                      style={getCellStyle(`${b.id}-total_price`)}>
                      {fmt(b.total_price)}
                    </td>

                    {/* 예상 마진 */}
                    <td className="px-3 min-w-[140px] text-right whitespace-nowrap tabular-nums">
                      {b.total_cost != null && b.total_price != null ? (
                        <span className={`font-bold text-[13px] tabular-nums ${margin >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                          {margin >= 0 ? '+' : ''}{Math.round(margin / 10000)}만원
                        </span>
                      ) : <span className="text-slate-300 text-[13px]">—</span>}
                    </td>

                    {/* 마진율 */}
                    <td className="px-3 min-w-[110px] text-center whitespace-nowrap">
                      {b.total_price ? (
                        <MarginBadge rate={parseFloat(mRate)} />
                      ) : <span className="text-slate-300 text-[13px]">—</span>}
                    </td>

                    {/* 입금액 */}
                    <td tabIndex={0} ref={el => regRef(el, ri, 12)} onFocus={() => setFocusedCell({ row: ri, col: 12 })}
                      className={`px-3 min-w-[160px] text-right whitespace-nowrap tabular-nums outline-none ${focusCls(12)} ${!(b.paid_amount) ? 'text-slate-300 font-normal text-[13px]' : 'font-bold text-[14px] text-emerald-700'}`}>
                      {fmt(b.paid_amount)}
                    </td>

                    {/* 잔금 / 취소건은 순현금 */}
                    <td tabIndex={0} ref={el => regRef(el, ri, 13)} onFocus={() => setFocusedCell({ row: ri, col: 13 })}
                      className={`px-3 min-w-[160px] text-right whitespace-nowrap tabular-nums relative group/bal outline-none ${focusCls(13)}`}>
                      {isCancelled ? (
                        <div>
                          <span className={`font-bold text-[13px] ${
                            netCashflow < -5000 ? 'text-red-600' :
                            netCashflow > 5000  ? 'text-amber-600' :
                            'text-slate-500'
                          }`}>
                            순 {netCashflow.toLocaleString()}원
                          </span>
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            입 {(b.paid_amount ?? 0).toLocaleString()} / 출 {(b.total_paid_out ?? 0).toLocaleString()}
                          </div>
                        </div>
                      ) : isPaid ? (
                        <span className="bg-emerald-50 text-emerald-700 px-3 py-1 rounded-full font-bold text-[13px]">완납</span>
                      ) : (
                        <div>
                          <span className={balance > 0 && (b.total_price ?? 0) > 0
                            ? `font-bold text-[14px] ${isDepositUnpaid ? 'text-red-600' : isRisk ? 'text-red-600' : 'text-red-500'}`
                            : 'font-normal text-[13px] text-slate-300'}>
                            {fmt(balance)}
                          </span>
                          {isDepositUnpaid && <span className="ml-1 text-[11px] bg-red-50 text-red-600 px-1.5 py-0.5 rounded font-bold">계약금 미납</span>}
                          {(b.total_price ?? 0) > 0 && (
                            <div className="mt-1 h-1.5 bg-slate-100 rounded-full overflow-hidden w-14 ml-auto">
                              <div className="h-full bg-blue-400 rounded-full"
                                style={{ width: `${Math.min(100, Math.round(((b.paid_amount ?? 0) / (b.total_price ?? 1)) * 100))}%` }} />
                            </div>
                          )}
                        </div>
                      )}
                      <div className="hidden group-hover/bal:block absolute bottom-full right-0 z-50 bg-slate-800 text-white text-[13px] rounded-lg px-3.5 py-2.5 whitespace-nowrap mb-1.5 pointer-events-none min-w-[220px]">
                        {isCancelled ? (
                          <>
                            <p className="text-slate-300 font-semibold mb-1">취소/환불 정산</p>
                            <p>입금 {(b.paid_amount ?? 0).toLocaleString()}원</p>
                            <p>출금 {(b.total_paid_out ?? 0).toLocaleString()}원</p>
                            <p className={`font-bold mt-1 ${netCashflow < -5000 ? 'text-red-400' : netCashflow > 5000 ? 'text-amber-400' : 'text-emerald-400'}`}>
                              순현금 {netCashflow.toLocaleString()}원
                            </p>
                            {isRefundSettled && <p className="text-emerald-400 text-[11px] mt-1">♻️ 환불 정산 완료</p>}
                            {isRefundPending && <p className="text-amber-400 text-[11px] mt-1">⚠️ 환불 대기 {netCashflow.toLocaleString()}원</p>}
                          </>
                        ) : (
                          <>
                            <p className="text-blue-300 font-semibold mb-1">고객 미수금</p>
                            <p>{fmt(Math.max(0, balance))}</p>
                            <p className="text-orange-300 font-semibold mt-2 mb-1">랜드사 미지급금</p>
                            <p>{fmt(Math.max(0, agencyUnpaid))}</p>
                            {isLandBomb && <p className="text-red-400 font-bold mt-1.5 animate-pulse">출발 {dDiff}일 전 미송금</p>}
                            {isOverCost && <p className="text-red-400 font-bold mt-1.5">🩸 원가초과 {Math.abs(netCashflow).toLocaleString()}원</p>}
                          </>
                        )}
                        <div className="absolute bottom-[-5px] right-5 w-2.5 h-2.5 bg-slate-800 rotate-45" />
                      </div>
                    </td>

                    {/* 상태 뱃지 */}
                    <td tabIndex={0} ref={el => regRef(el, ri, 14)} onFocus={() => setFocusedCell({ row: ri, col: 14 })}
                      className={`px-3 min-w-[140px] text-center whitespace-nowrap outline-none ${focusCls(14)}`}
                      onClick={e => e.stopPropagation()}>
                      {isEditing('status') ? (
                        <select autoFocus value={cellValue}
                          onChange={e => { setCellValue(e.target.value); commitCell(b.id, 'status', e.target.value); }}
                          onBlur={cancelEdit}
                          onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') cancelEdit(); }}
                          className="text-[13px] border border-blue-500 rounded px-2 py-1.5 focus:outline-none bg-white">
                          {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      ) : (
                        <StatusBadge booking={b} onClick={() => { setEditingCell({ id: b.id, field: 'status' }); setCellValue(b.status); }} />
                      )}
                    </td>

                    {/* 액션 */}
                    <td className="px-3 min-w-[140px] whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      <div className="flex gap-1.5 justify-end opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                        {!isTrash && b.status === 'pending' && (
                          <button onClick={() => patchStatus(b.id, 'confirmed')} disabled={processing === b.id}
                            className="text-[11px] bg-blue-50 text-blue-700 px-2.5 py-1.5 rounded-lg hover:bg-blue-100 disabled:opacity-50 whitespace-nowrap font-semibold">확정</button>
                        )}
                        {!isTrash && b.status === 'confirmed' && (
                          <button onClick={() => patchStatus(b.id, 'completed')} disabled={processing === b.id}
                            className="text-[11px] bg-[#001f3f] text-white px-2.5 py-1.5 rounded-lg hover:bg-blue-900 disabled:opacity-50 whitespace-nowrap font-semibold">완납</button>
                        )}
                        {!isTrash ? (
                          <>
                            <button onClick={() => window.open(`/admin/bookings/${b.id}`, '_blank')}
                              className="text-[11px] text-slate-700 border border-slate-300 px-2.5 py-1.5 rounded-lg hover:bg-slate-50 whitespace-nowrap">수정</button>
                            <button onClick={() => triggerUndoDelete([b])} disabled={processing === b.id}
                              className="text-[11px] text-red-400 border border-red-100 px-2.5 py-1.5 rounded-lg hover:bg-red-50 disabled:opacity-50 whitespace-nowrap">삭제</button>
                          </>
                        ) : (
                          <button onClick={() => restore(b.id)} disabled={processing === b.id}
                            className="text-[11px] bg-blue-50 text-blue-700 px-2.5 py-1.5 rounded-lg hover:bg-blue-100 disabled:opacity-50 whitespace-nowrap">복구</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {vPadBottom > 0 && <tr style={{ height: vPadBottom }}><td colSpan={18} /></tr>}
            </tbody>

            <tfoot className="sticky bottom-0 z-10">
              <tr className="bg-[#001f3f] text-white text-[13px] font-semibold border-t border-slate-200">
                <td className="sticky left-0 bg-[#001f3f] px-3 py-2" colSpan={2}>{filtered.length}건 합계</td>
                <td colSpan={9} />
                <td className="px-3 py-2 text-right text-[14px] whitespace-nowrap tabular-nums font-bold">{footerStats.totalSales.toLocaleString()}원</td>
                <td colSpan={2} /> {/* 예상마진, 마진율 */}
                <td className="px-3 py-2 text-right text-[14px] whitespace-nowrap text-blue-200 tabular-nums font-bold">{footerStats.totalPaid.toLocaleString()}원</td>
                <td className="px-3 py-2 text-right text-[14px] whitespace-nowrap text-red-200 tabular-nums font-bold">{footerStats.totalBalance > 0 ? footerStats.totalBalance.toLocaleString() + '원' : '—'}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* 다중 선택 툴바 */}
      {selected.size > 0 && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-5 py-3 bg-slate-800 text-white rounded-lg text-[13px]">
          <span className="font-bold text-blue-300 whitespace-nowrap">{selected.size}건 선택됨</span>
          <div className="w-px h-4 bg-white/20 mx-1" />
          {bulkField === 'departing_location_id' ? (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-400 whitespace-nowrap">출발지역:</span>
              <select autoFocus defaultValue=""
                onChange={e => { handleBulkCommit('departing_location_id', e.target.value); }}
                onBlur={() => setBulkField(null)}
                className="bg-slate-700 text-white border border-slate-600 rounded px-2 py-1 text-[11px] focus:outline-none">
                <option value="">-- 선택 안 함 --</option>
                {activeLocations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
              <button onClick={() => setBulkField(null)} className="text-white/50 hover:text-white">×</button>
            </div>
          ) : bulkField === 'land_operator_id' ? (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-400 whitespace-nowrap">랜드사:</span>
              <select autoFocus defaultValue=""
                onChange={e => { handleBulkCommit('land_operator_id', e.target.value); }}
                onBlur={() => setBulkField(null)}
                className="bg-slate-700 text-white border border-slate-600 rounded px-2 py-1 text-[11px] focus:outline-none">
                <option value="">-- 선택 안 함 --</option>
                {activeVendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
              <button onClick={() => setBulkField(null)} className="text-white/50 hover:text-white">×</button>
            </div>
          ) : (
            <>
              <button onClick={() => setBulkField('departing_location_id')} className="text-[11px] hover:bg-white/10 px-3 py-1.5 rounded-lg transition whitespace-nowrap">출발지역</button>
              <button onClick={() => setBulkField('land_operator_id')} className="text-[11px] hover:bg-white/10 px-3 py-1.5 rounded-lg transition whitespace-nowrap">랜드사</button>
              <div className="w-px h-4 bg-white/20 mx-1" />
              <button onClick={() => { const targets = bookings.filter(b => selected.has(b.id)); if (targets.length) { triggerUndoDelete(targets); setSelected(new Set()); setBulkField(null); } }}
                className="text-[11px] bg-red-500/20 hover:bg-red-500/40 text-red-300 px-3 py-1.5 rounded-lg transition whitespace-nowrap font-semibold">삭제</button>
            </>
          )}
          <div className="w-px h-4 bg-white/20 mx-1" />
          <button onClick={() => { setSelected(new Set()); setBulkField(null); }} className="text-[11px] text-white/50 hover:text-white transition">× 해제</button>
        </div>
      )}

      {/* 컨텍스트 메뉴 */}
      {ctxMenu && (
        <div className="fixed z-[100] bg-white border border-slate-200 rounded-lg py-1 w-48"
          style={{ left: ctxMenu.x, top: ctxMenu.y }} onClick={e => e.stopPropagation()}>
          <button onClick={() => { copyText(ctxMenu.b.booking_no || ctxMenu.b.id.slice(0, 8)); setCtxMenu(null); }}
            className="w-full text-left px-4 py-2 text-[13px] text-slate-700 hover:bg-slate-50 flex items-center gap-2.5">예약번호 복사</button>
          <button onClick={() => { sendAlimtalk(ctxMenu.b); setCtxMenu(null); }}
            className="w-full text-left px-4 py-2 text-[13px] text-slate-700 hover:bg-slate-50 flex items-center gap-2.5">알림톡 발송</button>
          <button onClick={() => { window.open(`/admin/bookings/${ctxMenu.b.id}`, '_blank'); setCtxMenu(null); }}
            className="w-full text-left px-4 py-2 text-[13px] text-slate-700 hover:bg-slate-50 flex items-center gap-2.5">새 탭에서 열기</button>
          <div className="border-t border-slate-200 my-1" />
          <button onClick={() => { patchStatus(ctxMenu.b.id, 'cancelled'); setCtxMenu(null); }}
            className="w-full text-left px-4 py-2 text-[13px] text-red-600 hover:bg-red-50 flex items-center gap-2.5">예약 취소</button>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-lg text-white text-[13px] font-semibold ${toast.type === 'err' ? 'bg-red-600' : 'bg-slate-800'}`}>
          {toast.msg}
        </div>
      )}

      {/* Undo Toast */}
      {undoToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 px-5 py-3 bg-slate-800 text-white rounded-lg text-[13px]">
          <span className="text-slate-300">{undoToast.count}건의 예약이 삭제되었습니다.</span>
          <button onClick={handleUndoDelete} className="font-bold text-blue-400 hover:text-blue-300 underline underline-offset-2 transition whitespace-nowrap">실행 취소</button>
        </div>
      )}

      <CommandPalette bookings={bookings} onSelect={id => setDrawerBookingId(id)} />
      <BookingDrawer
        bookingId={drawerBookingId}
        onClose={() => setDrawerBookingId(null)}
        onStatusChange={(id, newStatus) => setBookings(prev => prev.map(b => b.id === id ? { ...b, status: newStatus } : b))}
      />
    </div>
  );
}
