'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { GRADE_STYLE, LIFECYCLE_STAGES, getNextAction, type CustomerStatus } from '@/lib/mileage';
import { BOOKING_STATUS_COLOR, BOOKING_STATUS_LABEL } from '@/lib/status-colors';
import { maskPhone } from '@/lib/pii-mask';

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

interface ActivityItem {
  id: string;
  type: string;
  title: string;
  description?: string | null;
  created_at: string;
  severity?: 'info' | 'warning' | 'critical';
  status?: string;
  booking_id?: string | null;
  bank_transaction_id?: string | null;
  amount?: number | null;
}

// ─── 상수 ─────────────────────────────────────────────────────────────────────

const BOOKING_STATUS: Record<string, string> = BOOKING_STATUS_LABEL;
const CHANNEL_LABEL: Record<string, string> = {
  phone: '전화', kakao: '카카오', email: '이메일', visit: '방문', cafe: '카페', sms: 'SMS',
};
const ACTIVITY_LABEL: Record<string, string> = {
  booking_created: '예약 생성',
  payment_matched: '입금 매칭',
  payment_unmatched: '매칭 취소',
  payment_excluded: '입출금 제외',
  payment_refund: '환불',
  customer_note: '상담 메모',
  customer_updated: '고객 수정',
  mileage_adjusted: '마일리지',
  ledger_drift: '원장 점검',
};
const ACTIVITY_SEVERITY_CLASS: Record<string, string> = {
  critical: 'bg-red-50 text-red-600 border-red-100',
  warning: 'bg-amber-50 text-amber-700 border-amber-100',
  info: 'bg-blue-50 text-blue-700 border-blue-100',
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
    case '일반':  return 'bg-admin-surface-2 text-admin-muted';
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
  // (감사 2026-05-11) main load 를 SWR 로 마이그 — 필터 dedup + 페이지간 캐시.
  // customers 상태는 optimistic mutation 을 위해 별도 유지.
  const [customers, setCustomers]       = useState<Customer[]>([]);
  const [page, setPage]                 = useState(1);
  const [totalPages, setTotalPages]     = useState(1);
  const [totalCount, setTotalCount]     = useState(0);
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
    type: 'mileage-reset' | 'bulk-delete' | 'bulk-grant-mileage';
    count: number;
    grantAmount?: number;
    grantReason?: string;
    grantGradeFilter?: string;
    grantMinDays?: number;
  } | null>(null);

  // ── ⋮ 메뉴 ────────────────────────────────────────────────────────────────
  const [openMenuId, setOpenMenuId]     = useState<string | null>(null);

  // ── 사이드 드로어 ──────────────────────────────────────────────────────────
  // 감사(2026-05-11): 3개 fetch → useSWR (mileage 는 탭 조건부). drawer 재오픈 시 캐시 적중.
  const [drawer, setDrawer]                     = useState<Customer | null>(null);
  const [drawerTab, setDrawerTab]               = useState<'info' | 'bookings' | 'consultations' | 'mileage' | 'activity'>('info');
  const [editInfo, setEditInfo]                 = useState<Partial<Customer>>({});
  const [savingInfo, setSavingInfo]             = useState(false);

  const drawerCustomerId = drawer?.id ?? null;
  const {
    data: drawerBookingsData,
    isLoading: bookingsLoading,
    mutate: mutateDrawerBookings,
  } = useSWR<{ bookings: Booking[] }>(
    drawerCustomerId ? `/api/bookings?customerId=${drawerCustomerId}` : null,
  );
  const {
    data: drawerNotesData,
    isLoading: notesLoading,
    mutate: mutateDrawerNotes,
  } = useSWR<{ notes: Note[] }>(
    drawerCustomerId ? `/api/customers/${drawerCustomerId}/notes` : null,
  );
  // mileage 는 mileage 탭 활성화 시에만 fetch (lazy).
  const {
    data: drawerMileageData,
    mutate: mutateDrawerMileage,
  } = useSWR<{ history: MileageHistory[] }>(
    drawerCustomerId && drawerTab === 'mileage'
      ? `/api/customers/${drawerCustomerId}/mileage-history`
      : null,
  );
  const {
    data: drawerActivityData,
    isLoading: activityLoading,
    mutate: mutateDrawerActivity,
  } = useSWR<{ items: ActivityItem[] }>(
    drawerCustomerId && drawerTab === 'activity'
      ? `/api/customers/${drawerCustomerId}/activity`
      : null,
  );
  const drawerBookings = drawerBookingsData?.bookings ?? [];
  const drawerNotes    = drawerNotesData?.notes ?? [];
  const drawerMileage  = drawerMileageData?.history ?? [];
  const drawerActivity = drawerActivityData?.items ?? [];
  const drawerLoading  = bookingsLoading || notesLoading || (drawerTab === 'activity' && activityLoading);

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

  // ─── 목록 로드 (SWR) ────────────────────────────────────────────────────────
  // 감사(2026-05-11): useEffect fetch → useSWR + dedup 30s + keepPreviousData.
  const listKey = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page), limit: '30', sortBy, sortDir,
      trashed: String(tab === 'trash'),
    });
    if (search)       params.set('search', search);
    if (gradeFilter)  params.set('grade', gradeFilter);
    if (statusFilter) params.set('status', statusFilter);
    return `/api/customers?${params}`;
  }, [page, sortBy, sortDir, tab, search, gradeFilter, statusFilter]);

  const { data: listData, isLoading, mutate: mutateList } = useSWR<{
    customers: Customer[]; count: number; totalPages: number;
  }>(listKey);

  useEffect(() => {
    if (listData?.customers) {
      setCustomers(listData.customers);
      setTotalPages(listData.totalPages || 1);
      setTotalCount(listData.count || 0);
      setSelectedIds(new Set());
    }
  }, [listData]);

  // 외부 호출용 — mutation 후 강제 재fetch.
  const load = useCallback(() => { mutateList(); }, [mutateList]);

  // ─── 드로어 ────────────────────────────────────────────────────────────────
  // 감사(2026-05-11): bookings/notes/mileage fetch 는 SWR 가 자동 처리 (drawerCustomerId 변경 시).
  // openDrawer 는 state set 만, mileage 는 탭 활성화 시 lazy fetch.

  function openDrawer(c: Customer) {
    setOpenMenuId(null);
    setDrawer(c);
    setDrawerTab('info');
    setEditInfo({
      name: c.name, phone: c.phone ?? '', email: c.email ?? '',
      passport_no: c.passport_no ?? '', passport_expiry: c.passport_expiry ?? '',
      birth_date: c.birth_date ?? '', memo: c.memo ?? '',
      status: c.status ?? '잠재고객',
    });
  }

  function handleDrawerTabChange(t: typeof drawerTab) {
    setDrawerTab(t);
    // mileage 탭 활성화 시 SWR key 가 enable 되며 자동 fetch.
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
        mutateDrawerActivity();
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
      // SWR 캐시에 낙관적 추가 + 백그라운드 revalidate.
      mutateDrawerNotes(
        (cur) => ({ notes: [data.note, ...(cur?.notes ?? [])] }),
        { revalidate: false },
      );
      setNoteInput('');
      mutateDrawerActivity();
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
      await mutateDrawerMileage();
      mutateDrawerActivity();
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

  // ─── 조건부 마일리지 일괄 지급 상태 ───────────────────────────────────────
  const [grantForm, setGrantForm] = useState({ amount: 1000, reason: '프로모션 지급', gradeFilter: '', minDaysSinceLastBooking: 0 });

  // ─── 조건부 마일리지 일괄 지급 ─────────────────────────────────────────────

  async function handleBulkMileageGrant() {
    const ids = [...selectedIds];
    if (!ids.length) return;
    const res = await fetch('/api/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'bulk_grant_mileage',
        ids,
        amount: confirmModal?.grantAmount ?? 1000,
        reason: confirmModal?.grantReason ?? '프로모션 지급',
        gradeFilter: confirmModal?.grantGradeFilter || undefined,
        minDaysSinceLastBooking: confirmModal?.grantMinDays || undefined,
      }),
    });
    const result = await res.json();
    if (!res.ok) {
      showToast('마일리지 지급 실패', 'error');
      return;
    }
    const grantedCount = result.processed ?? ids.length;
    setCustomers(prev =>
      prev.map(c => selectedIds.has(c.id) ? { ...c, mileage: (c.mileage ?? 0) + (confirmModal?.grantAmount ?? 1000) } : c)
    );
    setSelectedIds(new Set());
    setConfirmModal(null);
    showToast(`${grantedCount}명 마일리지 ${(confirmModal?.grantAmount ?? 1000).toLocaleString()}P 지급 완료`);
  }

  // ─── 일괄 마일리지 초기화 ─────────────────────────────────────────────────

  async function handleBulkMileageReset() {
    // 감사(2026-05-11): N PATCH round-trip → 단일 POST bulk_field 1 round-trip.
    const ids = [...selectedIds];
    if (!ids.length) return;
    const res = await fetch('/api/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'bulk_field', ids, field: 'mileage', value: 0 }),
    });
    if (!res.ok) {
      showToast('마일리지 초기화 실패', 'error');
      return;
    }
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
    setPage(1);
  }
  const sortIcon = (field: string) =>
    sortBy !== field ? <span className="text-admin-muted-2 ml-1">↕</span>
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
      setPage(1);
      mutateList();
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
      <div className="border-t border-admin-border-mid p-4 bg-amber-50 flex-shrink-0">
        <p className="text-[11px] font-semibold text-amber-700 mb-2">다음 추천 액션</p>
        <div className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-amber-200">
          <span className="text-admin-sm text-admin-text-2">{action.label}</span>
          <button onClick={() => showToast(`${action.label} 실행됨`)}
            className="text-[11px] bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 font-medium">
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
            <h1 className="text-admin-lg font-bold text-admin-text-2">고객 관리</h1>
            <p className="text-admin-sm text-admin-muted mt-0.5">전체 {totalCount.toLocaleString()}명</p>
          </div>
          <button onClick={() => { setShowForm(true); setPhoneDupe(null); }}
            className="bg-blue-600 text-white px-4 py-2 rounded text-admin-sm font-medium hover:bg-blue-700">
            + 고객 등록
          </button>
        </div>

        {/* 탭 + 필터 */}
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="flex border border-admin-border-mid rounded overflow-hidden bg-white">
            {(['active', 'trash'] as const).map(t => (
              <button key={t} onClick={() => { setTab(t); setPage(1); }}
                className={`px-4 py-2 text-admin-sm font-medium ${tab === t ? 'bg-blue-600 text-white' : 'text-admin-muted hover:bg-admin-bg'}`}>
                {t === 'active' ? '활성' : '휴지통'}
              </button>
            ))}
          </div>

          <input value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="이름 / 전화번호 / 이메일"
            className="border border-admin-border-mid bg-white rounded px-3 py-2 text-admin-sm w-52 focus:outline-none focus:ring-2 focus:ring-blue-300"
          />

          <select value={gradeFilter}
            onChange={e => { setGradeFilter(e.target.value); setPage(1); }}
            className="border border-admin-border-mid bg-white rounded px-3 py-2 text-admin-sm">
            <option value="">전체 등급</option>
            {['VVIP', '우수', '일반', '신규'].map(g => <option key={g} value={g}>{g}</option>)}
          </select>

          <select value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
            className="border border-admin-border-mid bg-white rounded px-3 py-2 text-admin-sm">
            <option value="">전체 상태</option>
            {LIFECYCLE_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {/* 테이블 */}
        <div className="bg-white rounded border border-admin-border-mid overflow-hidden">
          <table className="w-full">
            <thead className="bg-admin-bg border-b border-admin-border-mid">
              <tr>
                <th className="pl-3 pr-2 py-2 w-10">
                  <input
                    type="checkbox"
                    checked={customers.length > 0 && selectedIds.size === customers.length}
                    ref={el => {
                      if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < customers.length;
                    }}
                    onChange={toggleAll}
                    className="w-4 h-4 rounded border-admin-border-strong text-blue-600 cursor-pointer"
                  />
                </th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold text-admin-muted uppercase tracking-wide cursor-pointer"
                  onClick={() => handleSort('name')}>
                  고객 {sortIcon('name')}
                </th>
                <th className="px-3 py-2 text-center text-[11px] font-semibold text-admin-muted uppercase tracking-wide">
                  등급
                </th>
                <th className="px-3 py-2 text-center text-[11px] font-semibold text-admin-muted uppercase tracking-wide">
                  상태
                </th>
                <th className="px-3 py-2 text-right text-[11px] font-semibold text-admin-muted uppercase tracking-wide cursor-pointer"
                  onClick={() => handleSort('mileage')}>
                  마일리지 {sortIcon('mileage')}
                </th>
                <th className="px-3 py-2 text-right text-[11px] font-semibold text-admin-muted uppercase tracking-wide cursor-pointer"
                  onClick={() => handleSort('bookingCount')}>
                  예약 {sortIcon('bookingCount')}
                </th>
                <th className="px-3 py-2 text-right text-[11px] font-semibold text-admin-muted uppercase tracking-wide cursor-pointer"
                  onClick={() => handleSort('totalSales')}>
                  총매출 {sortIcon('totalSales')}
                </th>
                <th className="pr-3 pl-2 py-2 w-10" />
              </tr>
            </thead>

            <tbody>
              {isLoading ? (
                [...Array(6)].map((_, i) => (
                  <tr key={i} className="border-b border-admin-border-mid">
                    <td className="pl-3 pr-2 py-2" />
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-admin-surface-2 animate-pulse" />
                        <div className="space-y-1.5">
                          <div className="h-3.5 w-20 bg-admin-surface-2 rounded animate-pulse" />
                          <div className="h-3 w-16 bg-admin-surface-2 rounded animate-pulse" />
                        </div>
                      </div>
                    </td>
                    {[...Array(5)].map((_, j) => (
                      <td key={j} className="px-3 py-2">
                        <div className="h-3.5 bg-admin-surface-2 rounded animate-pulse" />
                      </td>
                    ))}
                    <td className="pr-3 pl-2 py-2" />
                  </tr>
                ))
              ) : customers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-20 text-center text-admin-muted-2">
                    <p className="text-admin-base">고객이 없습니다.</p>
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
                    className={`group cursor-pointer transition-colors border-b border-admin-border-mid
                      ${isDrawerOn  ? 'bg-blue-50 ring-inset ring-2 ring-blue-300' : ''}
                      ${isChecked && !isDrawerOn ? 'bg-blue-50/40' : ''}
                      ${!isDrawerOn && !isChecked ? 'hover:bg-admin-bg' : ''}
                      ${gs.border}
                    `}
                  >
                    {/* Checkbox */}
                    <td className="pl-3 pr-2 py-2" onClick={e => handleRowCheckbox(c.id, idx, e)}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {}}
                        className="w-4 h-4 rounded border-admin-border-strong text-blue-600 cursor-pointer"
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
                          <p className="text-admin-sm font-semibold text-admin-text-2 truncate">{c.name}</p>
                          {c.phone ? (
                            <p className="text-[11px] text-admin-muted-2 truncate">{maskPhone(c.phone, 'cs_agent')}</p>
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
                        <span className="text-[11px] bg-admin-surface-2 text-admin-muted px-2 py-0.5 rounded-full font-medium whitespace-nowrap">
                          {c.status}
                        </span>
                      ) : (
                        <span className="text-admin-muted-2 text-[11px]">-</span>
                      )}
                    </td>

                    {/* 마일리지 */}
                    <td className="px-3 py-2 text-right tabular-nums">
                      {!c.mileage ? (
                        <span className="text-[11px] text-admin-muted-2">0P</span>
                      ) : (
                        <span className={`text-admin-sm font-semibold ${gs.text || 'text-blue-600'}`}>
                          {fmtNum(c.mileage)}P
                        </span>
                      )}
                    </td>

                    {/* 예약 건수 */}
                    <td className="px-3 py-2 text-right tabular-nums">
                      {!c.bookingCount ? (
                        <span className="text-[11px] text-admin-muted-2">0</span>
                      ) : (
                        <span className="text-admin-sm font-semibold text-admin-text-2">{c.bookingCount}건</span>
                      )}
                    </td>

                    {/* 총매출 */}
                    <td className="px-3 py-2 text-right tabular-nums">
                      {!salesStr ? (
                        <span className="text-[11px] text-admin-muted-2">0</span>
                      ) : (
                        <span className={`text-admin-sm font-semibold ${
                          (c.totalSales ?? 0) >= 5_000_000 ? 'text-admin-text-2' : 'text-admin-muted'
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
                            text-admin-muted-2 hover:text-admin-muted hover:bg-admin-surface-2 transition
                            opacity-0 group-hover:opacity-100 focus:opacity-100"
                        >
                          ⋮
                        </button>

                        {openMenuId === c.id && (
                          <div className="absolute right-0 top-8 bg-white border border-admin-border-mid
                            rounded z-20 min-w-[120px] overflow-hidden">
                            <button
                              onClick={e => { e.stopPropagation(); openDrawer(c); }}
                              className="w-full px-3 py-2 text-left text-admin-sm text-admin-text-2 hover:bg-admin-bg flex items-center gap-2">
                              수정
                            </button>
                            <button
                              onClick={e => { e.stopPropagation(); handleDelete(c.id); }}
                              className="w-full px-3 py-2 text-left text-admin-sm text-red-600 hover:bg-red-50 flex items-center gap-2">
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
            <button disabled={page <= 1} onClick={() => setPage(page - 1)}
              className="px-4 py-1.5 rounded border border-admin-border-strong text-admin-sm text-admin-text-2 disabled:opacity-40 hover:bg-admin-bg bg-white">이전</button>
            <span className="px-3 py-1.5 text-admin-sm text-admin-muted">{page} / {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(page + 1)}
              className="px-4 py-1.5 rounded border border-admin-border-strong text-admin-sm text-admin-text-2 disabled:opacity-40 hover:bg-admin-bg bg-white">다음</button>
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
        <div className="flex items-center gap-3 bg-blue-600 text-white px-5 py-3
          rounded border border-slate-700/50">
          <span className="text-admin-sm font-bold whitespace-nowrap">
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
            onClick={() => setConfirmModal({ type: 'bulk-grant-mileage', count: selectedIds.size, grantAmount: 1000, grantReason: '프로모션 지급' })}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400
              text-white text-[11px] font-semibold rounded transition whitespace-nowrap">
            마일리지 지급
          </button>
          <button
            onClick={() => setConfirmModal({ type: 'bulk-delete', count: selectedIds.size })}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500 hover:bg-red-400
              text-white text-[11px] font-semibold rounded transition whitespace-nowrap">
            일괄 삭제
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-admin-muted-2 hover:text-white ml-1 text-lg leading-none transition">
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
            <h3 className="text-admin-lg font-bold text-admin-text-2 mb-2">
              {confirmModal.type === 'mileage-reset' ? '마일리지 일괄 초기화'
                : confirmModal.type === 'bulk-grant-mileage' ? '마일리지 조건부 지급'
                : '일괄 삭제'}
            </h3>

            {confirmModal.type === 'bulk-grant-mileage' ? (
              <>
                <p className="text-admin-base text-admin-muted mb-4">
                  선택된 <span className="font-bold text-admin-text-2">{confirmModal.count}명</span>에게
                  마일리지를 일괄 지급합니다.
                </p>
                <div className="space-y-3 mb-6">
                  <div>
                    <label className="text-[11px] text-admin-muted-2 font-medium block mb-1">지급 금액 (P)</label>
                    <input type="number" min={1} max={1000000}
                      defaultValue={1000}
                      onChange={e => setConfirmModal(prev => prev ? { ...prev, grantAmount: parseInt(e.target.value) || 0 } : prev)}
                      className="w-full border border-admin-border-mid rounded px-3 py-2 text-admin-sm focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-admin-muted-2 font-medium block mb-1">사유</label>
                    <input type="text" defaultValue="프로모션 지급"
                      onChange={e => setConfirmModal(prev => prev ? { ...prev, grantReason: e.target.value } : prev)}
                      className="w-full border border-admin-border-mid rounded px-3 py-2 text-admin-sm focus:ring-1 focus:ring-blue-500"
                      placeholder="예: 3개월 미구매 고객 프로모션"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] text-admin-muted-2 font-medium block mb-1">등급 필터 (선택)</label>
                      <select
                        onChange={e => setConfirmModal(prev => prev ? { ...prev, grantGradeFilter: e.target.value } : prev)}
                        className="w-full border border-admin-border-mid rounded px-3 py-2 text-admin-sm focus:ring-1 focus:ring-blue-500">
                        <option value="">전체 등급</option>
                        <option value="VVIP">VVIP</option>
                        <option value="우수">우수</option>
                        <option value="일반">일반</option>
                        <option value="신규">신규</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[11px] text-admin-muted-2 font-medium block mb-1">미구매 기준 (선택)</label>
                      <select
                        onChange={e => setConfirmModal(prev => prev ? { ...prev, grantMinDays: parseInt(e.target.value) || 0 } : prev)}
                        className="w-full border border-admin-border-mid rounded px-3 py-2 text-admin-sm focus:ring-1 focus:ring-blue-500">
                        <option value="0">적용 안 함</option>
                        <option value="30">30일 이상 미구매</option>
                        <option value="60">60일 이상 미구매</option>
                        <option value="90">90일 이상 미구매</option>
                        <option value="180">180일 이상 미구매</option>
                      </select>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                <p className="text-admin-base text-admin-muted mb-1">
                  선택된 <span className="font-bold text-admin-text-2">{confirmModal.count}명</span>의 고객을
                </p>
                <p className="text-admin-base text-admin-muted mb-6">
                  {confirmModal.type === 'mileage-reset'
                    ? '마일리지를 모두 0P로 초기화합니다.'
                    : '삭제합니다. 이 작업은 되돌릴 수 없습니다.'
                  }
                </p>
              </>
            )}

            <div className="flex gap-3">
              <button onClick={() => setConfirmModal(null)}
                className="flex-1 border border-admin-border-strong text-admin-text-2 py-2.5 rounded text-admin-sm font-medium hover:bg-admin-bg transition bg-white">
                취소
              </button>
              <button
                onClick={confirmModal.type === 'mileage-reset' ? handleBulkMileageReset
                  : confirmModal.type === 'bulk-grant-mileage' ? handleBulkMileageGrant
                  : handleBulkDelete}
                className={`flex-1 py-2.5 rounded text-admin-sm font-semibold transition ${
                  confirmModal.type === 'bulk-grant-mileage'
                    ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                    : 'bg-red-600 text-white hover:bg-red-700'
                }`}>
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

          <div className="fixed right-0 top-0 h-full w-[520px] bg-white z-40 flex flex-col border-l border-admin-border-mid">

            {/* 드로어 헤더 */}
            <div className="px-5 py-4 border-b border-admin-border-mid bg-white flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-admin-lg ${avatarBg(drawer.grade)}`}>
                  {drawer.name[0]}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-admin-text-2 text-admin-lg">{drawer.name}</span>
                    {(() => {
                      const gs = GRADE_STYLE[drawer.grade ?? '신규'] ?? GRADE_STYLE['신규'];
                      return (
                        <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${gs.badge}`}>
                          {drawer.grade === 'VVIP' ? 'VVIP' : (drawer.grade ?? '신규')}
                        </span>
                      );
                    })()}
                  </div>
                  <p className="text-admin-sm text-admin-muted">
                    {maskPhone(drawer.phone ?? null, 'cs_agent') ?? <span className="text-red-500">연락처 미상</span>}
                    {' · '}{fmtNum(drawer.mileage)}P
                  </p>
                </div>
              </div>
              <button onClick={() => setDrawer(null)} className="text-admin-muted-2 hover:text-admin-muted text-lg p-1">✕</button>
            </div>

            {/* 생애주기 프로세스 바 */}
            <div className="px-5 py-3 bg-white border-b border-admin-border-mid flex-shrink-0">
              <p className="text-[10px] font-semibold text-admin-muted-2 uppercase tracking-wide mb-2">생애주기 - 클릭 시 즉시 변경</p>
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
                        isActive ? 'bg-blue-600 text-white border-blue-600'
                        : isDone ? 'bg-blue-50 text-blue-600 border-blue-200'
                        :          'bg-admin-bg text-admin-muted border-admin-border-mid hover:bg-admin-surface-2'
                      }`}>
                      {stage}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 탭 네비게이션 */}
            <div className="flex border-b border-admin-border-mid bg-white flex-shrink-0">
              {([
                ['info',          '상세정보'],
                ['bookings',      '예약내역'],
                ['consultations', '상담로그'],
                ['mileage',       '마일리지'],
                ['activity',      '활동'],
              ] as const).map(([key, label]) => (
                <button key={key} onClick={() => handleDrawerTabChange(key)}
                  className={`flex-1 py-2.5 text-admin-sm font-semibold transition-colors ${drawerTab === key ? 'text-blue-600 border-b-2 border-blue-600' : 'text-admin-muted hover:text-admin-text-2'}`}>
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
                <div className="p-5 space-y-4">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="space-y-1.5">
                      <div className="h-2.5 bg-admin-surface-2 rounded animate-pulse w-20" />
                      <div className="h-9 bg-admin-surface-2 rounded-lg animate-pulse w-full" />
                    </div>
                  ))}
                </div>
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
                          <label className="block text-[11px] font-semibold text-admin-muted mb-1">{label}</label>
                          <input type={type}
                            value={(editInfo[field as keyof typeof editInfo] as string) ?? ''}
                            onChange={e => setEditInfo(prev => ({ ...prev, [field]: e.target.value }))}
                            className="w-full border border-admin-border-mid rounded px-3 py-2 text-admin-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                          />
                        </div>
                      ))}
                      {/* 주민번호 7자리 → 생년월일 자동입력 */}
                      <div>
                        <label className="block text-[11px] font-semibold text-admin-muted mb-1">주민번호 (앞6+뒤1)</label>
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
                          className="w-full border border-admin-border-mid rounded px-3 py-2 text-admin-sm font-mono tracking-wider focus:outline-none focus:ring-2 focus:ring-blue-300" />
                        {editInfo.birth_date && (() => {
                          const bd = new Date(editInfo.birth_date as string);
                          if (isNaN(bd.getTime())) return null;
                          const now = new Date();
                          let age = now.getFullYear() - bd.getFullYear();
                          if (now.getMonth() < bd.getMonth() || (now.getMonth() === bd.getMonth() && now.getDate() < bd.getDate())) age--;
                          return <p className="text-admin-xs text-admin-muted mt-1">{editInfo.birth_date} · 만 {age}세</p>;
                        })()}
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-admin-muted mb-1">메모</label>
                        <textarea value={editInfo.memo ?? ''}
                          onChange={e => setEditInfo(prev => ({ ...prev, memo: e.target.value }))}
                          rows={3}
                          className="w-full border border-admin-border-mid rounded px-3 py-2 text-admin-sm focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
                        />
                      </div>
                      <button onClick={handleSaveInfo} disabled={savingInfo}
                        className="w-full bg-blue-600 text-white py-2.5 rounded text-admin-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
                        {savingInfo ? '저장 중...' : '저장'}
                      </button>
                    </div>
                  )}

                  {/* 예약내역 탭 */}
                  {drawerTab === 'bookings' && (
                    <div className="p-4 space-y-3">
                      {drawerBookings.length === 0 ? (
                        <p className="text-center text-admin-muted-2 text-admin-base py-16">예약 내역 없음</p>
                      ) : drawerBookings.map(b => (
                        <Link key={b.id} href={`/admin/bookings/${b.id}`}
                          className="block bg-white rounded border border-admin-border-mid p-4 hover:bg-blue-50 hover:border-blue-300 transition-colors group">
                          <div className="flex items-start justify-between mb-1.5">
                            <span className="font-semibold text-admin-text-2 text-admin-sm">{b.package_title ?? '상품 미지정'}</span>
                            <span className={`text-[11px] px-2 py-0.5 rounded-full flex-shrink-0 ${BOOKING_STATUS_COLOR[b.status] ?? 'bg-admin-surface-2 text-admin-muted'}`}>
                              {BOOKING_STATUS[b.status] ?? b.status}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-[11px] text-admin-muted">
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
                          <p className="text-center text-admin-muted-2 text-admin-base py-16">상담 기록 없음</p>
                        ) : drawerNotes.map(n => (
                          <div key={n.id} className="bg-white rounded border border-admin-border-mid p-3">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[11px] font-medium text-admin-muted">{CHANNEL_LABEL[n.channel ?? 'phone'] ?? n.channel}</span>
                              <span className="text-[11px] text-admin-muted-2 ml-auto">{fmtDate(n.created_at)}</span>
                            </div>
                            <p className="text-admin-sm text-admin-text-2 whitespace-pre-wrap leading-relaxed">{n.content}</p>
                          </div>
                        ))}
                      </div>
                      <div className="border-t border-admin-border-mid p-4 space-y-2 bg-white">
                        <div className="flex gap-1 flex-wrap">
                          {Object.entries(CHANNEL_LABEL).map(([ch, label]) => (
                            <button key={ch} onClick={() => setNoteChannel(ch)}
                              className={`px-2 py-1 rounded text-[11px] font-medium ${noteChannel === ch ? 'bg-blue-50 text-blue-700' : 'bg-admin-bg text-admin-muted hover:bg-admin-surface-2'}`}>
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
                            className="flex-1 border border-admin-border-mid rounded px-3 py-2 text-admin-sm focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
                          />
                          <button onClick={handleAddNote} disabled={addingNote || !noteInput.trim()}
                            className="bg-blue-600 text-white px-4 rounded text-admin-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                            저장
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 활동 타임라인 */}
                  {drawerTab === 'activity' && (
                    <div className="p-4 space-y-3">
                      {drawerActivity.length === 0 ? (
                        <p className="text-center text-admin-muted-2 text-admin-base py-16">활동 기록 없음</p>
                      ) : drawerActivity.map(item => (
                        <div key={`${item.type}:${item.id}`} className="bg-white rounded border border-admin-border-mid p-3">
                          <div className="flex items-start gap-3">
                            <span className={`mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${ACTIVITY_SEVERITY_CLASS[item.severity ?? 'info'] ?? ACTIVITY_SEVERITY_CLASS.info}`}>
                              {ACTIVITY_LABEL[item.type] ?? item.type}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-3">
                                <p className="text-admin-sm font-semibold text-admin-text-2 break-words">{item.title}</p>
                                <span className="shrink-0 text-[11px] text-admin-muted-2">{fmtDate(item.created_at)}</span>
                              </div>
                              {item.description && (
                                <p className="mt-1 text-[12px] leading-relaxed text-admin-muted break-words">{item.description}</p>
                              )}
                              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-admin-muted-2">
                                {item.amount != null && <span>{fmtNum(item.amount)}원</span>}
                                {item.status && <span>상태 {item.status}</span>}
                                {item.booking_id && (
                                  <Link className="text-blue-600 hover:underline" href={`/admin/bookings/${item.booking_id}`}>
                                    예약 보기
                                  </Link>
                                )}
                                {item.bank_transaction_id && (
                                  <Link className="text-blue-600 hover:underline" href={`/admin/payments?tx=${item.bank_transaction_id}`}>
                                    입출금 보기
                                  </Link>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 마일리지 탭 */}
                  {drawerTab === 'mileage' && (
                    <div className="p-4 space-y-4">
                      {/* 잔액 카드 */}
                      <div className="bg-blue-600 rounded p-5 text-white">
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
                      <div className="bg-white rounded p-4 border border-admin-border-mid">
                        <p className="text-[11px] font-semibold text-admin-muted mb-3">수동 조정 (CS)</p>
                        <div className="flex gap-2 mb-2">
                          <input type="number" value={mileageInput}
                            onChange={e => setMileageInput(e.target.value)}
                            placeholder="+500 또는 -200"
                            className="flex-1 border border-admin-border-mid rounded px-3 py-2 text-admin-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                          />
                          <select value={mileageReason} onChange={e => setMileageReason(e.target.value)}
                            className="border border-admin-border-mid rounded px-2 text-admin-sm bg-white">
                            {['수동 조정', 'CS 보상', '오류 수정', '사용', '만료'].map(r => (
                              <option key={r} value={r}>{r}</option>
                            ))}
                          </select>
                        </div>
                        <button onClick={handleMileageAdjust} disabled={adjustingMileage || !mileageInput}
                          className="w-full bg-blue-600 text-white py-2 rounded text-admin-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
                          {adjustingMileage ? '처리 중...' : '조정 적용'}
                        </button>
                      </div>

                      {/* 이력 */}
                      <div>
                        <p className="text-[11px] font-semibold text-admin-muted mb-2">적립 / 사용 이력</p>
                        {drawerMileage.length === 0 ? (
                          <p className="text-center text-admin-muted-2 text-admin-base py-10">이력 없음</p>
                        ) : (
                          <div className="space-y-2">
                            {drawerMileage.map(h => (
                              <div key={h.id} className="flex items-center justify-between bg-white rounded px-4 py-3 border border-admin-border-mid">
                                <div>
                                  <p className="text-admin-sm font-medium text-admin-text-2">{h.reason}</p>
                                  <p className="text-[11px] text-admin-muted-2">{fmtDate(h.created_at)}</p>
                                </div>
                                <div className="text-right">
                                  <p className={`font-bold text-admin-sm ${h.delta >= 0 ? 'text-blue-600' : 'text-red-500'}`}>
                                    {h.delta >= 0 ? '+' : ''}{h.delta.toLocaleString()}P
                                  </p>
                                  <p className="text-[11px] text-admin-muted-2">잔액 {h.balance_after.toLocaleString()}P</p>
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
          <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white z-50 flex flex-col border-l border-admin-border-mid">
            <div className="px-6 py-4 border-b border-admin-border-mid flex items-center justify-between">
              <h2 className="text-admin-lg font-bold text-admin-text-2">신규 고객 등록</h2>
              <button onClick={() => { setShowForm(false); setPhoneDupe(null); }} className="text-admin-muted-2 hover:text-admin-muted text-xl">✕</button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4 flex-1 overflow-y-auto">
              <div>
                <label className="block text-[11px] font-semibold text-admin-muted mb-1">이름 *</label>
                <input required value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  className="w-full border border-admin-border-mid rounded px-3 py-2 text-admin-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  placeholder="홍길동" />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-admin-muted mb-1">전화번호</label>
                <div className="relative">
                  <input value={form.phone}
                    onChange={e => { setForm(p => ({ ...p, phone: e.target.value })); checkPhone(e.target.value); }}
                    className={`w-full border rounded px-3 py-2 text-admin-sm focus:outline-none focus:ring-2 focus:ring-blue-300 ${phoneDupe ? 'border-orange-400 bg-orange-50' : 'border-admin-border-mid'}`}
                    placeholder="010-0000-0000" />
                  {checkingPhone && <span className="absolute right-3 top-2.5 text-[11px] text-admin-muted-2">확인 중...</span>}
                </div>
                {phoneDupe && (
                  <div className="mt-2 bg-orange-50 border border-orange-300 rounded p-3">
                    <p className="text-[11px] font-semibold text-orange-700 mb-1.5">이미 등록된 번호입니다</p>
                    <p className="text-admin-sm text-admin-text-2 font-medium">{phoneDupe.name}</p>
                    <p className="text-[11px] text-admin-muted mb-2">{maskPhone(phoneDupe.phone ?? null, 'cs_agent')} · {phoneDupe.grade} · {fmtNum(phoneDupe.mileage)}P</p>
                    <button type="button" onClick={loadDupeCustomer}
                      className="w-full bg-orange-500 text-white py-2 rounded text-[11px] font-semibold hover:bg-orange-600">
                      기존 고객 정보 불러오기
                    </button>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-admin-muted mb-1">이메일</label>
                <input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                  className="w-full border border-admin-border-mid rounded px-3 py-2 text-admin-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-admin-muted mb-1">여권번호</label>
                  <input value={form.passport_no} onChange={e => setForm(p => ({ ...p, passport_no: e.target.value }))}
                    className="w-full border border-admin-border-mid rounded px-3 py-2 text-admin-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-admin-muted mb-1">여권만료일</label>
                  <input type="date" value={form.passport_expiry} onChange={e => setForm(p => ({ ...p, passport_expiry: e.target.value }))}
                    className="w-full border border-admin-border-mid rounded px-3 py-2 text-admin-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
              </div>

              {/* 주민번호 7자리 → 성별/나이 자동 파싱 */}
              <div>
                <label className="block text-[11px] font-semibold text-admin-muted mb-1">주민등록번호 (앞6 + 뒤1)</label>
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
                  className="w-full border border-admin-border-mid rounded px-3 py-2 text-admin-sm focus:outline-none focus:ring-2 focus:ring-blue-300 font-mono tracking-wider"
                />
                {form.birth_date && (() => {
                  const bd = new Date(form.birth_date);
                  if (isNaN(bd.getTime())) return null;
                  const now = new Date();
                  let age = now.getFullYear() - bd.getFullYear();
                  if (now.getMonth() < bd.getMonth() || (now.getMonth() === bd.getMonth() && now.getDate() < bd.getDate())) age--;
                  return (
                    <div className="mt-2 flex gap-3 text-admin-sm">
                      <span className="px-2 py-0.5 rounded bg-admin-surface-2 text-admin-text-2">{form.birth_date}</span>
                      <span className={`px-2 py-0.5 rounded font-medium ${form.gender === 'M' ? 'bg-blue-50 text-blue-700' : form.gender === 'F' ? 'bg-pink-50 text-pink-700' : 'bg-admin-surface-2 text-admin-text-2'}`}>
                        {form.gender === 'M' ? '남성' : form.gender === 'F' ? '여성' : ''}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-admin-surface-2 text-admin-text-2">만 {age}세</span>
                    </div>
                  );
                })()}
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowForm(false); setPhoneDupe(null); }}
                  className="flex-1 border border-admin-border-strong text-admin-text-2 py-2.5 rounded text-admin-sm font-medium hover:bg-admin-bg bg-white">
                  취소
                </button>
                <button type="submit" disabled={saving || !!phoneDupe}
                  className="flex-1 bg-blue-600 text-white py-2.5 rounded text-admin-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
                  {saving ? '저장 중...' : '등록'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}

      {/* 토스트 */}
      {toast && (
        <div className={`fixed top-5 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded text-admin-sm font-semibold text-white pointer-events-none transition-all
          ${toast.type === 'error' ? 'bg-red-500' : 'bg-blue-600'}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
