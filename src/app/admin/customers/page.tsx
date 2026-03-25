'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { GRADE_STYLE, LIFECYCLE_STAGES, getNextAction, type CustomerStatus } from '@/lib/mileage';

// ─── 타입 ─────────────────────────────────────────────────────────────────────

interface Customer {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  passport_no?: string;
  passport_expiry?: string;
  birth_date?: string;
  mileage?: number;
  grade?: string;
  status?: string;
  total_spent?: number;
  cafe_sync_data?: { nickname?: string; post_count?: number; comment_count?: number };
  tags?: string[];
  memo?: string;
  created_at: string;
  deleted_at?: string;
  bookingCount?: number;
  totalSales?: number;
}

interface Booking {
  id: string;
  booking_no?: string;
  package_title?: string;
  adult_count?: number;
  total_price?: number;
  paid_amount?: number;
  status: string;
  departure_date?: string;
  created_at: string;
}

interface Note {
  id: string;
  content: string;
  channel?: string;
  created_at: string;
}

interface MileageHistory {
  id: string;
  delta: number;
  reason: string;
  balance_after: number;
  created_at: string;
}

// ─── 상수 ─────────────────────────────────────────────────────────────────────

const BOOKING_STATUS: Record<string, string> = {
  pending: '대기', confirmed: '확정', completed: '완료', cancelled: '취소',
};
const BOOKING_STATUS_COLOR: Record<string, string> = {
  pending:   'bg-yellow-50 text-yellow-700',
  confirmed: 'bg-blue-50 text-blue-700',
  completed: 'bg-green-50 text-green-700',
  cancelled: 'bg-slate-100 text-slate-500',
};
const CHANNEL_LABEL: Record<string, string> = {
  phone: '전화', kakao: '카카오', email: '이메일', visit: '방문', cafe: '카페', sms: 'SMS',
};

// ─── 유틸 ─────────────────────────────────────────────────────────────────────

const fmtNum  = (n?: number) => (n ?? 0).toLocaleString();
const fmtDate = (s?: string) => s ? s.slice(0, 10) : '-';

/** 총매출 포맷: 0이면 null 반환 (흐리게 처리용) */
function fmtSales(n?: number): string | null {
  if (!n || n === 0) return null;
  if (n >= 10_000_000) return `${Math.round(n / 1_000_000 / 10) / 100 * 100}만원`;
  if (n >= 1_000_000)  return `${Math.round(n / 10_000)}만원`;
  return `${n.toLocaleString()}원`;
}

/** 등급별 Avatar 배경색 */
function avatarBg(grade?: string): string {
  switch (grade) {
    case 'VVIP': return 'bg-purple-50 text-purple-700';
    case '우수':  return 'bg-blue-50 text-blue-700';
    case '일반':  return 'bg-slate-100 text-slate-600';
    default:     return 'bg-green-50 text-green-700';
  }
}

function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): T {
  let t: ReturnType<typeof setTimeout>;
  return ((...args: Parameters<T>) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  }) as T;
}

// ─── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export default function CustomersPage() {
  // ── 목록 상태 ──────────────────────────────────────────────────────────────
  const [customers, setCustomers]       = useState<Customer[]>([]);
  const [page, setPage]                 = useState(1);
  const [totalPages, setTotalPages]     = useState(1);
  const [totalCount, setTotalCount]     = useState(0);
  const [isLoading, setIsLoading]       = useState(true);
  const [tab, setTab]                   = useState<'active' | 'trash'>('active');
  const [search, setSearch]             = useState('');
  const [sortBy, setSortBy]             = useState('created_at');
  const [sortDir, setSortDir]           = useState<'asc' | 'desc'>('desc');
  const [gradeFilter, setGradeFilter]   = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // ── 다중 선택 ──────────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds]   = useState<Set<string>>(new Set());
  const [lastClickIdx, setLastClickIdx] = useState<number | null>(null);

  // ── 확인 모달 ──────────────────────────────────────────────────────────────
  const [confirmModal, setConfirmModal] = useState<{
    type: 'mileage-reset' | 'bulk-delete';
    count: number;
  } | null>(null);

  // ── ⋮ 메뉴 ────────────────────────────────────────────────────────────────
  const [openMenuId, setOpenMenuId]     = useState<string | null>(null);

  // ── 사이드 드로어 ──────────────────────────────────────────────────────────
  const [drawer, setDrawer]                     = useState<Customer | null>(null);
  const [drawerTab, setDrawerTab]               = useState<'info' | 'bookings' | 'consultations' | 'mileage'>('info');
  const [drawerBookings, setDrawerBookings]     = useState<Booking[]>([]);
  const [drawerNotes, setDrawerNotes]           = useState<Note[]>([]);
  const [drawerMileage, setDrawerMileage]       = useState<MileageHistory[]>([]);
  const [drawerLoading, setDrawerLoading]       = useState(false);
  const [editInfo, setEditInfo]                 = useState<Partial<Customer>>({});
  const [savingInfo, setSavingInfo]             = useState(false);

  // ── 상담로그 ───────────────────────────────────────────────────────────────
  const [noteInput, setNoteInput]       = useState('');
  const [noteChannel, setNoteChannel]   = useState('phone');
  const [addingNote, setAddingNote]     = useState(false);

  // ── 마일리지 수동 조정 ────────────────────────────────────────────────────
  const [mileageInput, setMileageInput]         = useState('');
  const [mileageReason, setMileageReason]       = useState('수동 조정');
  const [adjustingMileage, setAdjustingMileage] = useState(false);

  // ── 신규 등록 모달 ────────────────────────────────────────────────────────
  const [showForm, setShowForm]   = useState(false);
  const [form, setForm]           = useState({ name: '', phone: '', email: '', passport_no: '', passport_expiry: '', birth_date: '', memo: '', gender: '' as '' | 'M' | 'F' });
  const [saving, setSaving]       = useState(false);
  const [phoneDupe, setPhoneDupe] = useState<Customer | null>(null);
  const [checkingPhone, setCheckingPhone] = useState(false);

  // ── 토스트 ────────────────────────────────────────────────────────────────
  const [toast, setToast]   = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const toastTimer          = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }

  // ─── 목록 로드 ─────────────────────────────────────────────────────────────

  const load = useCallback(async (opts?: {
    q?: string; p?: number; sb?: string; sd?: 'asc' | 'desc';
    g?: string; st?: string; t?: 'active' | 'trash';
  }) => {
    setIsLoading(true);
    try {
      const q  = opts?.q  ?? search;
      const p  = opts?.p  ?? page;
      const sb = opts?.sb ?? sortBy;
      const sd = opts?.sd ?? sortDir;
      const g  = opts?.g  !== undefined ? opts.g  : gradeFilter;
      const st = opts?.st !== undefined ? opts.st : statusFilter;
      const t  = opts?.t  ?? tab;

      const params = new URLSearchParams({
        page: String(p), limit: '30', sortBy: sb, sortDir: sd,
        trashed: String(t === 'trash'),
      });
      if (q)  params.set('search', q);
      if (g)  params.set('grade', g);
      if (st) params.set('status', st);

      const res  = await fetch(`/api/customers?${params}`);
      const data = await res.json();
      setCustomers(data.customers || []);
      setTotalPages(data.totalPages || 1);
      setTotalCount(data.count || 0);
      // 목록 변경 시 선택 초기화
      setSelectedIds(new Set());
    } finally {
      setIsLoading(false);
    }
  }, [search, page, sortBy, sortDir, gradeFilter, statusFilter, tab]);

  useEffect(() => { load(); }, [load]);

  // ─── 드로어 ────────────────────────────────────────────────────────────────

  async function openDrawer(c: Customer) {
    setOpenMenuId(null);
    setDrawer(c);
    setDrawerTab('info');
    setEditInfo({
      name: c.name, phone: c.phone ?? '', email: c.email ?? '',
      passport_no: c.passport_no ?? '', passport_expiry: c.passport_expiry ?? '',
      birth_date: c.birth_date ?? '', memo: c.memo ?? '',
      status: c.status ?? '잠재고객',
    });
    setDrawerBookings([]); setDrawerNotes([]); setDrawerMileage([]);
    setDrawerLoading(true);
    const [bRes, nRes] = await Promise.all([
      fetch(`/api/bookings?customerId=${c.id}`),
      fetch(`/api/customers/${c.id}/notes`),
    ]);
    const [bData, nData] = await Promise.all([bRes.json(), nRes.json()]);
    setDrawerBookings(bData.bookings || []);
    setDrawerNotes(nData.notes || []);
    setDrawerLoading(false);
  }

  async function loadMileageHistory(id: string) {
    const res  = await fetch(`/api/customers/${id}/mileage-history`);
    const data = await res.json();
    setDrawerMileage(data.history || []);
  }

  function handleDrawerTabChange(t: typeof drawerTab) {
    setDrawerTab(t);
    if (t === 'mileage' && drawer && drawerMileage.length === 0) {
      loadMileageHistory(drawer.id);
    }
  }

  // ─── 생애주기 상태 즉시 변경 ──────────────────────────────────────────────

  async function handleStatusChange(status: string) {
    if (!drawer) return;
    await fetch('/api/customers', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: drawer.id, status }),
    });
    setDrawer(prev => prev ? { ...prev, status } : prev);
    setEditInfo(prev => ({ ...prev, status }));
    setCustomers(prev => prev.map(c => c.id === drawer.id ? { ...c, status } : c));
    showToast(`상태 → ${status}`);
  }

  // ─── 상세정보 저장 ────────────────────────────────────────────────────────

  async function handleSaveInfo() {
    if (!drawer) return;
    setSavingInfo(true);
    try {
      const res  = await fetch('/api/customers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: drawer.id, ...editInfo }),
      });
      const data = await res.json();
      if (data.customer) {
        setDrawer(prev => prev ? { ...prev, ...data.customer } : prev);
        setCustomers(prev => prev.map(c => c.id === drawer.id ? { ...c, ...data.customer } : c));
        showToast('저장 완료');
      } else {
        showToast(data.error || '저장 실패', 'error');
      }
    } finally { setSavingInfo(false); }
  }

  // ─── 상담로그 추가 ────────────────────────────────────────────────────────

  async function handleAddNote() {
    if (!drawer || !noteInput.trim()) return;
    setAddingNote(true);
    const res  = await fetch(`/api/customers/${drawer.id}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: noteInput, channel: noteChannel }),
    });
    const data = await res.json();
    if (data.note) {
      setDrawerNotes(prev => [data.note, ...prev]);
      setNoteInput('');
      showToast('상담 기록 저장');
    }
    setAddingNote(false);
  }

  // ─── 마일리지 수동 조정 ───────────────────────────────────────────────────

  async function handleMileageAdjust() {
    if (!drawer || !mileageInput) return;
    const delta = parseInt(mileageInput);
    if (isNaN(delta) || delta === 0) return;
    setAdjustingMileage(true);
    const res  = await fetch(`/api/customers/${drawer.id}/mileage-history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delta, reason: mileageReason }),
    });
    const data = await res.json();
    if (data.mileage !== undefined) {
      setDrawer(prev => prev ? { ...prev, mileage: data.mileage } : prev);
      setCustomers(prev => prev.map(c => c.id === drawer.id ? { ...c, mileage: data.mileage } : c));
      await loadMileageHistory(drawer.id);
      setMileageInput('');
      showToast(`마일리지 ${delta > 0 ? '+' : ''}${delta.toLocaleString()}P 조정`);
    } else {
      showToast(data.error || '조정 실패', 'error');
    }
    setAdjustingMileage(false);
  }

  // ─── 단건 삭제 ───────────────────────────────────────────────────────────

  async function handleDelete(id: string) {
    if (!confirm('이 고객을 삭제하시겠습니까?')) return;
    await fetch(`/api/customers?id=${id}`, { method: 'DELETE' });
    setCustomers(prev => prev.filter(c => c.id !== id));
    if (drawer?.id === id) setDrawer(null);
    showToast('삭제 완료');
  }

  // ─── 일괄 마일리지 초기화 ─────────────────────────────────────────────────

  async function handleBulkMileageReset() {
    const ids = [...selectedIds];
    await Promise.all(ids.map(id =>
      fetch('/api/customers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, field: 'mileage', value: 0 }),
      })
    ));
    setCustomers(prev =>
      prev.map(c => selectedIds.has(c.id) ? { ...c, mileage: 0 } : c)
    );
    setSelectedIds(new Set());
    setConfirmModal(null);
    showToast(`${ids.length}명 마일리지 초기화 완료`);
  }

  // ─── 일괄 삭제 ────────────────────────────────────────────────────────────

  async function handleBulkDelete() {
    const ids = [...selectedIds];
    await fetch('/api/customers', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    setCustomers(prev => prev.filter(c => !selectedIds.has(c.id)));
    if (drawer && selectedIds.has(drawer.id)) setDrawer(null);
    setSelectedIds(new Set());
    setConfirmModal(null);
    showToast(`${ids.length}명 삭제 완료`);
  }

  // ─── Shift-Click 범위 선택 ────────────────────────────────────────────────

  function handleRowCheckbox(id: string, idx: number, e: React.MouseEvent) {
    e.stopPropagation();
    if (e.shiftKey && lastClickIdx !== null) {
      const lo = Math.min(lastClickIdx, idx);
      const hi = Math.max(lastClickIdx, idx);
      setSelectedIds(prev => {
        const next = new Set(prev);
        customers.slice(lo, hi + 1).forEach(c => next.add(c.id));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
      });
      setLastClickIdx(idx);
    }
  }

  function toggleAll() {
    if (selectedIds.size === customers.length && customers.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(customers.map(c => c.id)));
    }
  }

  // ─── 정렬 ─────────────────────────────────────────────────────────────────

  function handleSort(field: string) {
    const newDir = sortBy === field && sortDir === 'desc' ? 'asc' : 'desc';
    setSortBy(field); setSortDir(newDir);
    load({ sb: field, sd: newDir, p: 1 });
  }
  const sortIcon = (field: string) =>
    sortBy !== field ? <span className="text-slate-300 ml-1">↕</span>
    : <span className="text-blue-600 ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>;

  // ─── 신규 고객 등록: 전화번호 중복 체크 ──────────────────────────────────

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const checkPhone = useCallback(debounce(async (phone: string) => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10) { setPhoneDupe(null); return; }
    setCheckingPhone(true);
    const res  = await fetch(`/api/customers?phone=${encodeURIComponent(phone)}`);
    const data = await res.json();
    setPhoneDupe(data.customers?.[0] ?? null);
    setCheckingPhone(false);
  }, 500), []);

  function loadDupeCustomer() {
    if (!phoneDupe) return;
    openDrawer(phoneDupe);
    setShowForm(false);
    setPhoneDupe(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    const res  = await fetch('/api/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (data.customer) {
      setShowForm(false);
      setForm({ name: '', phone: '', email: '', passport_no: '', passport_expiry: '', birth_date: '', memo: '', gender: '' });
      setPhoneDupe(null);
      showToast('고객 등록 완료');
      load({ p: 1 });
    } else {
      showToast(data.error || '저장 실패', 'error');
    }
    setSaving(false);
  }

  // ─── 다음 액션 패널 ───────────────────────────────────────────────────────

  function NextActionPanel({ customer }: { customer: Customer }) {
    const lastDate  = drawerBookings[0]?.departure_date;
    const daysSince = lastDate
      ? Math.floor((Date.now() - new Date(lastDate).getTime()) / 86400000)
      : undefined;
    const action = getNextAction(customer.status ?? '잠재고객', daysSince);
    if (!action) return null;
    return (
      <div className="border-t border-slate-200 p-4 bg-amber-50 flex-shrink-0">
        <p className="text-[11px] font-semibold text-amber-700 mb-2">다음 추천 액션</p>
        <div className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-amber-200">
          <span className="text-[13px] text-slate-700">{action.label}</span>
          <button onClick={() => showToast(`${action.label} 실행됨`)}
            className="text-[11px] bg-[#001f3f] text-white px-3 py-1.5 rounded hover:bg-blue-900 font-medium">
            실행
          </button>
        </div>
      </div>
    );
  }

  // ─── 렌더 ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full" onClick={() => setOpenMenuId(null)}>

      {/* 메인 목록 */}
      <div className={`flex-1 min-w-0 transition-all duration-300 ${drawer ? 'mr-[520px]' : ''}`}>

        {/* 헤더 */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-[16px] font-bold text-slate-800">고객 관리</h1>
            <p className="text-[13px] text-slate-500 mt-0.5">전체 {totalCount.toLocaleString()}명</p>
          </div>
          <button onClick={() => { setShowForm(true); setPhoneDupe(null); }}
            className="bg-[#001f3f] text-white px-4 py-2 rounded text-[13px] font-medium hover:bg-blue-900">
            + 고객 등록
          </button>
        </div>

        {/* 탭 + 필터 */}
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="flex border border-slate-200 rounded overflow-hidden bg-white">
            {(['active', 'trash'] as const).map(t => (
              <button key={t} onClick={() => { setTab(t); load({ t, p: 1 }); }}
                className={`px-4 py-2 text-[13px] font-medium ${tab === t ? 'bg-[#001f3f] text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
                {t === 'active' ? '활성' : '휴지통'}
              </button>
            ))}
          </div>

          <input value={search}
            onChange={e => { setSearch(e.target.value); load({ q: e.target.value, p: 1 }); }}
            placeholder="이름 / 전화번호 / 이메일"
            className="border border-slate-200 bg-white rounded px-3 py-2 text-[13px] w-52 focus:outline-none focus:ring-2 focus:ring-blue-300"
          />

          <select value={gradeFilter}
            onChange={e => { setGradeFilter(e.target.value); load({ g: e.target.value, p: 1 }); }}
            className="border border-slate-200 bg-white rounded px-3 py-2 text-[13px]">
            <option value="">전체 등급</option>
            {['VVIP', '우수', '일반', '신규'].map(g => <option key={g} value={g}>{g}</option>)}
          </select>

          <select value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value); load({ st: e.target.value, p: 1 }); }}
            className="border border-slate-200 bg-white rounded px-3 py-2 text-[13px]">
            <option value="">전체 상태</option>
            {LIFECYCLE_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {/* 테이블 */}
        <div className="bg-white rounded border border-slate-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="pl-3 pr-2 py-2 w-10">
                  <input
                    type="checkbox"
                    checked={customers.length > 0 && selectedIds.size === customers.length}
                    ref={el => {
                      if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < customers.length;
                    }}
                    onChange={toggleAll}
                    className="w-4 h-4 rounded border-slate-300 text-blue-600 cursor-pointer"
                  />
                </th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide cursor-pointer"
                  onClick={() => handleSort('name')}>
                  고객 {sortIcon('name')}
                </th>
                <th className="px-3 py-2 text-center text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                  등급
                </th>
                <th className="px-3 py-2 text-center text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                  상태
                </th>
                <th className="px-3 py-2 text-right text-[11px] font-semibold text-slate-500 uppercase tracking-wide cursor-pointer"
                  onClick={() => handleSort('mileage')}>
                  마일리지 {sortIcon('mileage')}
                </th>
                <th className="px-3 py-2 text-right text-[11px] font-semibold text-slate-500 uppercase tracking-wide cursor-pointer"
                  onClick={() => handleSort('bookingCount')}>
                  예약 {sortIcon('bookingCount')}
                </th>
                <th className="px-3 py-2 text-right text-[11px] font-semibold text-slate-500 uppercase tracking-wide cursor-pointer"
                  onClick={() => handleSort('totalSales')}>
                  총매출 {sortIcon('totalSales')}
                </th>
                <th className="pr-3 pl-2 py-2 w-10" />
              </tr>
            </thead>

            <tbody>
              {isLoading ? (
                [...Array(6)].map((_, i) => (
                  <tr key={i} className="border-b border-slate-200">
                    <td className="pl-3 pr-2 py-2" />
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-slate-100 animate-pulse" />
                        <div className="space-y-1.5">
                          <div className="h-3.5 w-20 bg-slate-100 rounded animate-pulse" />
                          <div className="h-3 w-16 bg-slate-100 rounded animate-pulse" />
                        </div>
                      </div>
                    </td>
                    {[...Array(5)].map((_, j) => (
                      <td key={j} className="px-3 py-2">
                        <div className="h-3.5 bg-slate-100 rounded animate-pulse" />
                      </td>
                    ))}
                    <td className="pr-3 pl-2 py-2" />
                  </tr>
                ))
              ) : customers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-20 text-center text-slate-400">
                    <p className="text-[14px]">고객이 없습니다.</p>
                  </td>
                </tr>
              ) : customers.map((c, idx) => {
                const gs         = GRADE_STYLE[c.grade ?? '신규'] ?? GRADE_STYLE['신규'];
                const isDrawerOn = drawer?.id === c.id;
                const isChecked  = selectedIds.has(c.id);
                const salesStr   = fmtSales(c.totalSales);

                return (
                  <tr key={c.id}
                    onClick={() => { openDrawer(c); setOpenMenuId(null); }}
                    className={`group cursor-pointer transition-colors border-b border-slate-200
                      ${isDrawerOn  ? 'bg-blue-50 ring-inset ring-2 ring-blue-300' : ''}
                      ${isChecked && !isDrawerOn ? 'bg-blue-50/40' : ''}
                      ${!isDrawerOn && !isChecked ? 'hover:bg-slate-50' : ''}
                      ${gs.border}
                    `}
                  >
                    {/* Checkbox */}
                    <td className="pl-3 pr-2 py-2" onClick={e => handleRowCheckbox(c.id, idx, e)}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {}}
                        className="w-4 h-4 rounded border-slate-300 text-blue-600 cursor-pointer"
                      />
                    </td>

                    {/* Identity Block */}
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center
                          text-[11px] font-bold flex-shrink-0 ${avatarBg(c.grade)}`}>
                          {c.name[0]}
                        </div>
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold text-slate-800 truncate">{c.name}</p>
                          {c.phone ? (
                            <p className="text-[11px] text-slate-400 truncate">···{c.phone.slice(-4)}</p>
                          ) : (
                            <span className="bg-red-50 text-red-600 px-1.5 py-0.5 rounded text-[10px] font-medium">
                              연락처 미상
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* 등급 */}
                    <td className="px-3 py-2 text-center">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${gs.badge}`}>
                        {c.grade === 'VVIP' ? 'VVIP' : (c.grade ?? '신규')}
                      </span>
                    </td>

                    {/* 상태 */}
                    <td className="px-3 py-2 text-center">
                      {c.status ? (
                        <span className="text-[11px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-medium whitespace-nowrap">
                          {c.status}
                        </span>
                      ) : (
                        <span className="text-slate-300 text-[11px]">-</span>
                      )}
                    </td>

                    {/* 마일리지 */}
                    <td className="px-3 py-2 text-right tabular-nums">
                      {!c.mileage ? (
                        <span className="text-[11px] text-slate-300">0P</span>
                      ) : (
                        <span className={`text-[13px] font-semibold ${gs.text || 'text-blue-600'}`}>
                          {fmtNum(c.mileage)}P
                        </span>
                      )}
                    </td>

                    {/* 예약 건수 */}
                    <td className="px-3 py-2 text-right tabular-nums">
                      {!c.bookingCount ? (
                        <span className="text-[11px] text-slate-300">0</span>
                      ) : (
                        <span className="text-[13px] font-semibold text-slate-700">{c.bookingCount}건</span>
                      )}
                    </td>

                    {/* 총매출 */}
                    <td className="px-3 py-2 text-right tabular-nums">
                      {!salesStr ? (
                        <span className="text-[11px] text-slate-300">0</span>
                      ) : (
                        <span className={`text-[13px] font-semibold ${
                          (c.totalSales ?? 0) >= 5_000_000 ? 'text-slate-800' : 'text-slate-600'
                        }`}>
                          {salesStr}
                        </span>
                      )}
                    </td>

                    {/* More 메뉴 */}
                    <td className="pr-3 pl-2 py-2" onClick={e => e.stopPropagation()}>
                      <div className="relative flex justify-end">
                        <button
                          onClick={e => { e.stopPropagation(); setOpenMenuId(openMenuId === c.id ? null : c.id); }}
                          className="w-7 h-7 rounded flex items-center justify-center text-lg leading-none
                            text-slate-300 hover:text-slate-600 hover:bg-slate-100 transition
                            opacity-0 group-hover:opacity-100 focus:opacity-100"
                        >
                          ⋮
                        </button>

                        {openMenuId === c.id && (
                          <div className="absolute right-0 top-8 bg-white border border-slate-200
                            rounded z-20 min-w-[120px] overflow-hidden">
                            <button
                              onClick={e => { e.stopPropagation(); openDrawer(c); }}
                              className="w-full px-3 py-2 text-left text-[13px] text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                              수정
                            </button>
                            <button
                              onClick={e => { e.stopPropagation(); handleDelete(c.id); }}
                              className="w-full px-3 py-2 text-left text-[13px] text-red-600 hover:bg-red-50 flex items-center gap-2">
                              삭제
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 페이지네이션 */}
        {totalPages > 1 && (
          <div className="flex justify-center gap-2 mt-4">
            <button disabled={page <= 1} onClick={() => { setPage(page - 1); load({ p: page - 1 }); }}
              className="px-4 py-1.5 rounded border border-slate-300 text-[13px] text-slate-700 disabled:opacity-40 hover:bg-slate-50 bg-white">이전</button>
            <span className="px-3 py-1.5 text-[13px] text-slate-500">{page} / {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => { setPage(page + 1); load({ p: page + 1 }); }}
              className="px-4 py-1.5 rounded border border-slate-300 text-[13px] text-slate-700 disabled:opacity-40 hover:bg-slate-50 bg-white">다음</button>
          </div>
        )}
      </div>

      {/* Floating Action Bar */}
      <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 transition-all duration-300 ease-out
        ${selectedIds.size > 0
          ? 'translate-y-0 opacity-100 pointer-events-auto'
          : 'translate-y-16 opacity-0 pointer-events-none'
        }`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 bg-[#001f3f] text-white px-5 py-3
          rounded border border-slate-700/50">
          <span className="text-[13px] font-bold whitespace-nowrap">
            {selectedIds.size}명 선택됨
          </span>
          <div className="w-px h-5 bg-slate-500 flex-shrink-0" />
          <button
            onClick={() => setConfirmModal({ type: 'mileage-reset', count: selectedIds.size })}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-400
              text-white text-[11px] font-semibold rounded transition whitespace-nowrap">
            마일리지 초기화
          </button>
          <button
            onClick={() => setConfirmModal({ type: 'bulk-delete', count: selectedIds.size })}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500 hover:bg-red-400
              text-white text-[11px] font-semibold rounded transition whitespace-nowrap">
            일괄 삭제
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-slate-400 hover:text-white ml-1 text-lg leading-none transition">
            ✕
          </button>
        </div>
      </div>

      {/* 확인 모달 */}
      {confirmModal && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4"
          onClick={() => setConfirmModal(null)}>
          <div className="bg-white rounded w-full max-w-sm p-6"
            onClick={e => e.stopPropagation()}>
            <h3 className="text-[16px] font-bold text-slate-800 mb-2">
              {confirmModal.type === 'mileage-reset' ? '마일리지 일괄 초기화' : '일괄 삭제'}
            </h3>
            <p className="text-[14px] text-slate-500 mb-1">
              선택된 <span className="font-bold text-slate-800">{confirmModal.count}명</span>의 고객을
            </p>
            <p className="text-[14px] text-slate-500 mb-6">
              {confirmModal.type === 'mileage-reset'
                ? '마일리지를 모두 0P로 초기화합니다.'
                : '삭제합니다. 이 작업은 되돌릴 수 없습니다.'
              }
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmModal(null)}
                className="flex-1 border border-slate-300 text-slate-700 py-2.5 rounded text-[13px] font-medium hover:bg-slate-50 transition bg-white">
                취소
              </button>
              <button
                onClick={confirmModal.type === 'mileage-reset' ? handleBulkMileageReset : handleBulkDelete}
                className="flex-1 bg-red-600 text-white py-2.5 rounded text-[13px] font-semibold hover:bg-red-700 transition">
                실행
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 사이드 드로어 (slide-over panel) */}
      {drawer && (
        <>
          <div className="fixed inset-0 bg-black/20 z-30 lg:hidden" onClick={() => setDrawer(null)} />

          <div className="fixed right-0 top-0 h-full w-[520px] bg-white z-40 flex flex-col border-l border-slate-200">

            {/* 드로어 헤더 */}
            <div className="px-5 py-4 border-b border-slate-200 bg-white flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-[16px] ${avatarBg(drawer.grade)}`}>
                  {drawer.name[0]}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-800 text-[16px]">{drawer.name}</span>
                    {(() => {
                      const gs = GRADE_STYLE[drawer.grade ?? '신규'] ?? GRADE_STYLE['신규'];
                      return (
                        <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${gs.badge}`}>
                          {drawer.grade === 'VVIP' ? 'VVIP' : (drawer.grade ?? '신규')}
                        </span>
                      );
                    })()}
                  </div>
                  <p className="text-[13px] text-slate-500">
                    {drawer.phone ?? <span className="text-red-500">연락처 미상</span>}
                    {' · '}{fmtNum(drawer.mileage)}P
                  </p>
                </div>
              </div>
              <button onClick={() => setDrawer(null)} className="text-slate-400 hover:text-slate-600 text-lg p-1">✕</button>
            </div>

            {/* 생애주기 프로세스 바 */}
            <div className="px-5 py-3 bg-white border-b border-slate-200 flex-shrink-0">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">생애주기 - 클릭 시 즉시 변경</p>
              <div className="flex items-center gap-1">
                {LIFECYCLE_STAGES.map((stage, i) => {
                  const current    = drawer.status ?? '잠재고객';
                  const currentIdx = LIFECYCLE_STAGES.indexOf(current as CustomerStatus);
                  const isDone     = i <  currentIdx;
                  const isActive   = stage === current;
                  return (
                    <button key={stage} onClick={() => handleStatusChange(stage)}
                      title={stage}
                      className={`flex-1 py-1.5 text-[11px] rounded font-semibold transition-all border ${
                        isActive ? 'bg-[#001f3f] text-white border-[#001f3f]'
                        : isDone ? 'bg-blue-50 text-blue-600 border-blue-200'
                        :          'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                      }`}>
                      {stage}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 탭 네비게이션 */}
            <div className="flex border-b border-slate-200 bg-white flex-shrink-0">
              {([
                ['info',          '상세정보'],
                ['bookings',      '예약내역'],
                ['consultations', '상담로그'],
                ['mileage',       '마일리지'],
              ] as const).map(([key, label]) => (
                <button key={key} onClick={() => handleDrawerTabChange(key)}
                  className={`flex-1 py-2.5 text-[13px] font-semibold transition-colors ${drawerTab === key ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-500 hover:text-slate-700'}`}>
                  {label}
                  {key === 'bookings' && drawerBookings.length > 0 && (
                    <span className="ml-1 text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-full">
                      {drawerBookings.length}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* 탭 콘텐츠 */}
            <div className="flex-1 overflow-y-auto">
              {drawerLoading ? (
                <div className="flex items-center justify-center h-48 text-slate-400 text-[14px]">로딩 중...</div>
              ) : (
                <>
                  {/* 상세정보 탭 */}
                  {drawerTab === 'info' && (
                    <div className="p-5 space-y-4">
                      {([
                        ['이름',       'name',            'text'],
                        ['전화번호',   'phone',            'tel'],
                        ['이메일',     'email',            'email'],
                        ['여권번호',   'passport_no',      'text'],
                        ['여권만료일', 'passport_expiry',  'date'],
                        ['생년월일',   'birth_date',       'date'],
                      ] as const).map(([label, field, type]) => (
                        <div key={field}>
                          <label className="block text-[11px] font-semibold text-slate-500 mb-1">{label}</label>
                          <input type={type}
                            value={(editInfo[field as keyof typeof editInfo] as string) ?? ''}
                            onChange={e => setEditInfo(prev => ({ ...prev, [field]: e.target.value }))}
                            className="w-full border border-slate-200 rounded px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-300"
                          />
                        </div>
                      ))}
                      {/* 주민번호 7자리 → 생년월일 자동입력 */}
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-500 mb-1">주민번호 (앞6+뒤1)</label>
                        <input maxLength={7} placeholder="6203152"
                          onChange={e => {
                            const v = e.target.value.replace(/[^0-9]/g, '');
                            e.target.value = v;
                            if (v.length === 7) {
                              const yy = parseInt(v.slice(0, 2));
                              const mm = v.slice(2, 4);
                              const dd = v.slice(4, 6);
                              const b1 = parseInt(v[6]);
                              const century = (b1 === 1 || b1 === 2) ? 1900 : (b1 === 3 || b1 === 4) ? 2000 : 1900;
                              setEditInfo(prev => ({ ...prev, birth_date: (century + yy) + '-' + mm + '-' + dd }));
                            }
                          }}
                          className="w-full border border-slate-200 rounded px-3 py-2 text-[13px] font-mono tracking-wider focus:outline-none focus:ring-2 focus:ring-blue-300" />
                        {editInfo.birth_date && (() => {
                          const bd = new Date(editInfo.birth_date as string);
                          if (isNaN(bd.getTime())) return null;
                          const now = new Date();
                          let age = now.getFullYear() - bd.getFullYear();
                          if (now.getMonth() < bd.getMonth() || (now.getMonth() === bd.getMonth() && now.getDate() < bd.getDate())) age--;
                          return <p className="text-[12px] text-slate-500 mt-1">{editInfo.birth_date} · 만 {age}세</p>;
                        })()}
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-500 mb-1">메모</label>
                        <textarea value={editInfo.memo ?? ''}
                          onChange={e => setEditInfo(prev => ({ ...prev, memo: e.target.value }))}
                          rows={3}
                          className="w-full border border-slate-200 rounded px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
                        />
                      </div>
                      <button onClick={handleSaveInfo} disabled={savingInfo}
                        className="w-full bg-[#001f3f] text-white py-2.5 rounded text-[13px] font-semibold hover:bg-blue-900 disabled:opacity-50">
                        {savingInfo ? '저장 중...' : '저장'}
                      </button>
                    </div>
                  )}

                  {/* 예약내역 탭 */}
                  {drawerTab === 'bookings' && (
                    <div className="p-4 space-y-3">
                      {drawerBookings.length === 0 ? (
                        <p className="text-center text-slate-400 text-[14px] py-16">예약 내역 없음</p>
                      ) : drawerBookings.map(b => (
                        <Link key={b.id} href={`/admin/bookings/${b.id}`}
                          className="block bg-white rounded border border-slate-200 p-4 hover:bg-blue-50 hover:border-blue-300 transition-colors group">
                          <div className="flex items-start justify-between mb-1.5">
                            <span className="font-semibold text-slate-800 text-[13px]">{b.package_title ?? '상품 미지정'}</span>
                            <span className={`text-[11px] px-2 py-0.5 rounded-full flex-shrink-0 ${BOOKING_STATUS_COLOR[b.status] ?? 'bg-slate-100 text-slate-600'}`}>
                              {BOOKING_STATUS[b.status] ?? b.status}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-[11px] text-slate-500">
                            <span>{fmtDate(b.departure_date)}</span>
                            <span>판매가 {b.total_price ? `${Math.round(b.total_price / 10000)}만` : '0'}</span>
                            <span>납입 {b.paid_amount ? `${Math.round(b.paid_amount / 10000)}만` : '0'}</span>
                          </div>
                          <p className="text-[11px] text-blue-500 mt-2 group-hover:text-blue-600">예약 상세 보기 →</p>
                        </Link>
                      ))}
                    </div>
                  )}

                  {/* 상담로그 탭 */}
                  {drawerTab === 'consultations' && (
                    <div className="flex flex-col" style={{ minHeight: 0 }}>
                      <div className="p-4 space-y-3">
                        {drawerNotes.length === 0 ? (
                          <p className="text-center text-slate-400 text-[14px] py-16">상담 기록 없음</p>
                        ) : drawerNotes.map(n => (
                          <div key={n.id} className="bg-white rounded border border-slate-200 p-3">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[11px] font-medium text-slate-600">{CHANNEL_LABEL[n.channel ?? 'phone'] ?? n.channel}</span>
                              <span className="text-[11px] text-slate-400 ml-auto">{fmtDate(n.created_at)}</span>
                            </div>
                            <p className="text-[13px] text-slate-800 whitespace-pre-wrap leading-relaxed">{n.content}</p>
                          </div>
                        ))}
                      </div>
                      <div className="border-t border-slate-200 p-4 space-y-2 bg-white">
                        <div className="flex gap-1 flex-wrap">
                          {Object.entries(CHANNEL_LABEL).map(([ch, label]) => (
                            <button key={ch} onClick={() => setNoteChannel(ch)}
                              className={`px-2 py-1 rounded text-[11px] font-medium ${noteChannel === ch ? 'bg-blue-50 text-blue-700' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}>
                              {label}
                            </button>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <textarea value={noteInput}
                            onChange={e => setNoteInput(e.target.value)}
                            placeholder="상담 내용을 입력하세요..."
                            rows={2}
                            onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) handleAddNote(); }}
                            className="flex-1 border border-slate-200 rounded px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
                          />
                          <button onClick={handleAddNote} disabled={addingNote || !noteInput.trim()}
                            className="bg-[#001f3f] text-white px-4 rounded text-[13px] font-medium hover:bg-blue-900 disabled:opacity-50">
                            저장
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 마일리지 탭 */}
                  {drawerTab === 'mileage' && (
                    <div className="p-4 space-y-4">
                      {/* 잔액 카드 */}
                      <div className="bg-[#001f3f] rounded p-5 text-white">
                        <p className="text-[11px] opacity-75 mb-1">현재 마일리지 잔액</p>
                        <p className="text-4xl font-extrabold tracking-tight">
                          {fmtNum(drawer.mileage)}<span className="text-lg ml-1 opacity-75">P</span>
                        </p>
                        <div className="flex items-center gap-3 mt-2 text-[11px] opacity-75">
                          <span>누적 결제 {drawer.total_spent ? `${Math.round(drawer.total_spent / 10000)}만` : '0'}원</span>
                          <span>·</span>
                          <span>등급 {drawer.grade ?? '신규'}</span>
                        </div>
                      </div>

                      {/* 수동 조정 */}
                      <div className="bg-white rounded p-4 border border-slate-200">
                        <p className="text-[11px] font-semibold text-slate-600 mb-3">수동 조정 (CS)</p>
                        <div className="flex gap-2 mb-2">
                          <input type="number" value={mileageInput}
                            onChange={e => setMileageInput(e.target.value)}
                            placeholder="+500 또는 -200"
                            className="flex-1 border border-slate-200 rounded px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-300"
                          />
                          <select value={mileageReason} onChange={e => setMileageReason(e.target.value)}
                            className="border border-slate-200 rounded px-2 text-[13px] bg-white">
                            {['수동 조정', 'CS 보상', '오류 수정', '사용', '만료'].map(r => (
                              <option key={r} value={r}>{r}</option>
                            ))}
                          </select>
                        </div>
                        <button onClick={handleMileageAdjust} disabled={adjustingMileage || !mileageInput}
                          className="w-full bg-[#001f3f] text-white py-2 rounded text-[13px] font-semibold hover:bg-blue-900 disabled:opacity-50">
                          {adjustingMileage ? '처리 중...' : '조정 적용'}
                        </button>
                      </div>

                      {/* 이력 */}
                      <div>
                        <p className="text-[11px] font-semibold text-slate-500 mb-2">적립 / 사용 이력</p>
                        {drawerMileage.length === 0 ? (
                          <p className="text-center text-slate-400 text-[14px] py-10">이력 없음</p>
                        ) : (
                          <div className="space-y-2">
                            {drawerMileage.map(h => (
                              <div key={h.id} className="flex items-center justify-between bg-white rounded px-4 py-3 border border-slate-200">
                                <div>
                                  <p className="text-[13px] font-medium text-slate-800">{h.reason}</p>
                                  <p className="text-[11px] text-slate-400">{fmtDate(h.created_at)}</p>
                                </div>
                                <div className="text-right">
                                  <p className={`font-bold text-[13px] ${h.delta >= 0 ? 'text-blue-600' : 'text-red-500'}`}>
                                    {h.delta >= 0 ? '+' : ''}{h.delta.toLocaleString()}P
                                  </p>
                                  <p className="text-[11px] text-slate-400">잔액 {h.balance_after.toLocaleString()}P</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* 다음 액션 제안 (하단 고정) */}
            <NextActionPanel customer={drawer} />
          </div>
        </>
      )}

      {/* 신규 등록 슬라이드 패널 */}
      {showForm && (
        <>
          <div className="fixed inset-0 bg-black/40 z-50" onClick={() => { setShowForm(false); setPhoneDupe(null); }} />
          <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white z-50 flex flex-col border-l border-slate-200">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-[16px] font-bold text-slate-800">신규 고객 등록</h2>
              <button onClick={() => { setShowForm(false); setPhoneDupe(null); }} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4 flex-1 overflow-y-auto">
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">이름 *</label>
                <input required value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  className="w-full border border-slate-200 rounded px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-300"
                  placeholder="홍길동" />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">전화번호</label>
                <div className="relative">
                  <input value={form.phone}
                    onChange={e => { setForm(p => ({ ...p, phone: e.target.value })); checkPhone(e.target.value); }}
                    className={`w-full border rounded px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-300 ${phoneDupe ? 'border-orange-400 bg-orange-50' : 'border-slate-200'}`}
                    placeholder="010-0000-0000" />
                  {checkingPhone && <span className="absolute right-3 top-2.5 text-[11px] text-slate-400">확인 중...</span>}
                </div>
                {phoneDupe && (
                  <div className="mt-2 bg-orange-50 border border-orange-300 rounded p-3">
                    <p className="text-[11px] font-semibold text-orange-700 mb-1.5">이미 등록된 번호입니다</p>
                    <p className="text-[13px] text-slate-800 font-medium">{phoneDupe.name}</p>
                    <p className="text-[11px] text-slate-500 mb-2">{phoneDupe.phone} · {phoneDupe.grade} · {fmtNum(phoneDupe.mileage)}P</p>
                    <button type="button" onClick={loadDupeCustomer}
                      className="w-full bg-orange-500 text-white py-2 rounded text-[11px] font-semibold hover:bg-orange-600">
                      기존 고객 정보 불러오기
                    </button>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">이메일</label>
                <input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                  className="w-full border border-slate-200 rounded px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-300" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">여권번호</label>
                  <input value={form.passport_no} onChange={e => setForm(p => ({ ...p, passport_no: e.target.value }))}
                    className="w-full border border-slate-200 rounded px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">여권만료일</label>
                  <input type="date" value={form.passport_expiry} onChange={e => setForm(p => ({ ...p, passport_expiry: e.target.value }))}
                    className="w-full border border-slate-200 rounded px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
              </div>

              {/* 주민번호 7자리 → 성별/나이 자동 파싱 */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">주민등록번호 (앞6 + 뒤1)</label>
                <input
                  maxLength={7}
                  placeholder="6203152"
                  onChange={e => {
                    const v = e.target.value.replace(/[^0-9]/g, '');
                    e.target.value = v;
                    if (v.length === 7) {
                      const front = v.slice(0, 6);
                      const back1 = parseInt(v[6]);
                      const yy = parseInt(front.slice(0, 2));
                      const mm = front.slice(2, 4);
                      const dd = front.slice(4, 6);
                      const century = (back1 === 1 || back1 === 2) ? 1900 : (back1 === 3 || back1 === 4) ? 2000 : 1900;
                      const fullYear = century + yy;
                      const birthDate = fullYear + '-' + mm + '-' + dd;
                      const gender = (back1 === 1 || back1 === 3) ? 'M' as const : 'F' as const;
                      setForm(p => ({ ...p, birth_date: birthDate, gender }));
                    }
                  }}
                  className="w-full border border-slate-200 rounded px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-300 font-mono tracking-wider"
                />
                {form.birth_date && (() => {
                  const bd = new Date(form.birth_date);
                  if (isNaN(bd.getTime())) return null;
                  const now = new Date();
                  let age = now.getFullYear() - bd.getFullYear();
                  if (now.getMonth() < bd.getMonth() || (now.getMonth() === bd.getMonth() && now.getDate() < bd.getDate())) age--;
                  return (
                    <div className="mt-2 flex gap-3 text-[13px]">
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700">{form.birth_date}</span>
                      <span className={`px-2 py-0.5 rounded font-medium ${form.gender === 'M' ? 'bg-blue-50 text-blue-700' : form.gender === 'F' ? 'bg-pink-50 text-pink-700' : 'bg-slate-100 text-slate-700'}`}>
                        {form.gender === 'M' ? '남성' : form.gender === 'F' ? '여성' : ''}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700">만 {age}세</span>
                    </div>
                  );
                })()}
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowForm(false); setPhoneDupe(null); }}
                  className="flex-1 border border-slate-300 text-slate-700 py-2.5 rounded text-[13px] font-medium hover:bg-slate-50 bg-white">
                  취소
                </button>
                <button type="submit" disabled={saving || !!phoneDupe}
                  className="flex-1 bg-[#001f3f] text-white py-2.5 rounded text-[13px] font-semibold hover:bg-blue-900 disabled:opacity-50">
                  {saving ? '저장 중...' : '등록'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}

      {/* 토스트 */}
      {toast && (
        <div className={`fixed top-5 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded text-[13px] font-semibold text-white pointer-events-none transition-all
          ${toast.type === 'error' ? 'bg-red-500' : 'bg-[#001f3f]'}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
