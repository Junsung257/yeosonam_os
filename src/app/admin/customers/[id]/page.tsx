'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

interface Customer {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  passport_no?: string;
  passport_expiry?: string;
  birth_date?: string;
  mileage?: number;
  tags?: string[];
  memo?: string;
  created_at: string;
}

interface Booking {
  id: string;
  booking_no?: string;
  package_title?: string;
  adult_count: number;
  child_count: number;
  total_price?: number;
  total_cost?: number;
  status: string;
  departure_date?: string;
  payment_date?: string;
  created_at: string;
}

interface Note {
  id: string;
  content: string;
  created_at: string;
}

const STATUS_LABEL: Record<string, string> = {
  pending: '예약대기', confirmed: '예약확정', completed: '결제완료', cancelled: '취소',
};
const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800', confirmed: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800', cancelled: 'bg-gray-100 text-gray-500',
};

export default function CustomerDetailPage() {
  const { id } = useParams();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Customer & { tags_str: string }>>({});
  const [saving, setSaving] = useState(false);

  // 마일리지 모달
  const [mileageModal, setMileageModal] = useState(false);
  const [mileageDelta, setMileageDelta] = useState('');
  const [mileageReason, setMileageReason] = useState('');
  const [mileageSaving, setMileageSaving] = useState(false);

  // 타임라인 노트
  const [noteInput, setNoteInput] = useState('');
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const noteEndRef = useRef<HTMLDivElement>(null);

  // Toast
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function showToast(msg: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }

  useEffect(() => {
    Promise.all([
      fetch(`/api/customers?id=${id}`).then(r => r.json()),
      fetch(`/api/bookings`).then(r => r.json()),
      fetch(`/api/customers/${id}/notes`).then(r => r.json()).catch(() => ({ notes: [] })),
    ]).then(([cd, bd, nd]) => {
      setCustomer(cd.customer);
      setBookings((bd.bookings || []).filter((b: { lead_customer_id?: string }) => b.lead_customer_id === id));
      setNotes(nd.notes || []);
    }).finally(() => setIsLoading(false));
  }, [id]);

  const startEdit = () => {
    if (!customer) return;
    setForm({ ...customer, tags_str: (customer.tags || []).join(', ') });
    setEditing(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { tags_str, ...rest } = form;
      await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...rest,
          id,
          tags: tags_str ? tags_str.split(',').map((t: string) => t.trim()).filter(Boolean) : [],
        }),
      });
      const res = await fetch(`/api/customers?id=${id}`);
      const data = await res.json();
      setCustomer(data.customer);
      setEditing(false);
      showToast('저장되었습니다.');
    } finally {
      setSaving(false);
    }
  };

  const handleMileage = async () => {
    const delta = parseInt(mileageDelta);
    if (isNaN(delta) || delta === 0) return;
    setMileageSaving(true);
    try {
      const newMileage = Math.max(0, (customer?.mileage || 0) + delta);
      await fetch('/api/customers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, field: 'mileage', value: newMileage }),
      });
      setCustomer(c => c ? { ...c, mileage: newMileage } : c);
      // 노트에 마일리지 이력 자동 추가
      const noteContent = `[마일리지 ${delta > 0 ? '+' : ''}${delta.toLocaleString()}] ${mileageReason || '수동 조정'} → 잔액 ${newMileage.toLocaleString()}P`;
      await submitNote(noteContent);
      setMileageModal(false);
      setMileageDelta('');
      setMileageReason('');
      showToast(`마일리지 ${delta > 0 ? '+' : ''}${delta.toLocaleString()} 적용됨`);
    } finally {
      setMileageSaving(false);
    }
  };

  const submitNote = async (content: string) => {
    if (!content.trim()) return;
    setNoteSubmitting(true);
    try {
      const res = await fetch(`/api/customers/${id}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const data = await res.json();
      if (data.note) {
        setNotes(prev => [...prev, data.note]);
        setTimeout(() => noteEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
      }
    } finally {
      setNoteSubmitting(false);
    }
  };

  const handleNoteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitNote(noteInput);
    setNoteInput('');
  };

  const handleDeleteNote = async (noteId: string) => {
    await fetch(`/api/customers/${id}/notes?noteId=${noteId}`, { method: 'DELETE' });
    setNotes(prev => prev.filter(n => n.id !== noteId));
  };

  const isPassportExpiring = (expiry?: string) => {
    if (!expiry) return false;
    const d = new Date(expiry);
    const sixMonths = new Date();
    sixMonths.setMonth(sixMonths.getMonth() + 6);
    return d <= sixMonths;
  };

  const totalSpent = bookings.filter(b => b.status === 'completed').reduce((s, b) => s + (b.total_price || 0), 0);

  const fmtDate = (s?: string) => s ? s.slice(0, 10) : '';
  const fmtTime = (s: string) => {
    const d = new Date(s);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${mm}/${dd} ${hh}:${min}`;
  };

  if (isLoading) return <div className="min-h-screen flex items-center justify-center text-gray-400">불러오는 중...</div>;
  if (!customer) return (
    <div className="min-h-screen flex flex-col items-center justify-center text-gray-500">
      <p className="mb-4">고객을 찾을 수 없습니다.</p>
      <Link href="/admin/customers" className="text-blue-600 hover:underline">목록으로</Link>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4">
        <div className="mb-4">
          <Link href="/admin/customers" className="text-sm text-blue-600 hover:underline">← 고객 목록</Link>
        </div>

        {/* 프로필 카드 */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-blue-100 rounded-full flex items-center justify-center text-2xl font-bold text-blue-600">
                {customer.name[0]}
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">{customer.name}</h1>
                <p className="text-gray-500 text-sm">{customer.phone || '전화번호 없음'}</p>
                <div className="flex gap-1 mt-1 flex-wrap">
                  {(customer.tags || []).map(t => (
                    <span key={t} className="bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded-full font-medium">{t}</span>
                  ))}
                </div>
              </div>
            </div>
            <button onClick={startEdit} className="text-sm text-gray-500 hover:text-gray-700 border border-gray-200 px-3 py-1.5 rounded-lg">편집</button>
          </div>

          {/* 통계 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-6 border-t border-gray-100">
            <div className="text-center">
              <div className="flex items-center justify-center gap-1.5">
                <p className="text-2xl font-bold text-blue-600">{(customer.mileage || 0).toLocaleString()}</p>
                <button
                  onClick={() => setMileageModal(true)}
                  className="text-gray-300 hover:text-blue-500 transition text-sm leading-none"
                  title="마일리지 수동 조정"
                >
                  ✏️
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">마일리지 (P)</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-green-600">{totalSpent > 0 ? totalSpent.toLocaleString() + '원' : '0'}</p>
              <p className="text-xs text-gray-500 mt-1">누적 결제액</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-gray-700">{bookings.length}</p>
              <p className="text-xs text-gray-500 mt-1">총 예약</p>
            </div>
            <div className="text-center">
              {customer.passport_expiry ? (
                <>
                  <p className={`text-sm font-bold ${isPassportExpiring(customer.passport_expiry) ? 'text-red-600' : 'text-gray-700'}`}>
                    {isPassportExpiring(customer.passport_expiry) ? '⚠️ ' : ''}{customer.passport_expiry}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">여권 만료</p>
                </>
              ) : (
                <>
                  <p className="text-sm text-gray-400">미등록</p>
                  <p className="text-xs text-gray-500 mt-1">여권 만료</p>
                </>
              )}
            </div>
          </div>

          {customer.memo && (
            <div className="mt-4 p-3 bg-gray-50 rounded-lg text-sm text-gray-600 border border-gray-100">
              {customer.memo}
            </div>
          )}
        </div>

        {/* 2-column: 예약 히스토리 | 타임라인 노트 */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* 좌: 예약 히스토리 (3/5) */}
          <div className="lg:col-span-3 bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900">예약 히스토리</h2>
              <Link href={`/admin/bookings/new?customerId=${customer.id}&customerName=${encodeURIComponent(customer.name)}`}
                className="text-sm text-blue-600 hover:underline">+ 예약 등록</Link>
            </div>
            {bookings.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-8">예약 내역이 없습니다.</p>
            ) : (
              <div className="space-y-2">
                {bookings.map(b => (
                  <Link
                    key={b.id}
                    href={`/admin/bookings/${b.id}`}
                    className="flex items-center justify-between p-3 border border-gray-100 rounded-lg hover:bg-blue-50 hover:border-blue-200 transition group"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 text-sm group-hover:text-blue-700 truncate">
                        {b.package_title || '(상품 미지정)'}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {b.booking_no} · 성인 {b.adult_count}명{b.child_count > 0 && ` + 소아 ${b.child_count}명`}
                        {b.departure_date && ` · 출발 ${fmtDate(b.departure_date)}`}
                      </p>
                    </div>
                    <div className="text-right ml-3 shrink-0">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLOR[b.status] || 'bg-gray-100 text-gray-600'}`}>
                        {STATUS_LABEL[b.status] || b.status}
                      </span>
                      {b.total_price && (
                        <p className="text-sm font-semibold text-gray-900 mt-1">{b.total_price.toLocaleString()}원</p>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* 우: 타임라인 노트 (2/5) */}
          <div className="lg:col-span-2 bg-white rounded-xl shadow-sm p-6 flex flex-col">
            <h2 className="font-semibold text-gray-900 mb-4">CS 타임라인</h2>
            <div className="flex-1 overflow-y-auto max-h-[420px] space-y-3 pr-1">
              {notes.length === 0 ? (
                <p className="text-gray-400 text-xs text-center py-6">메모가 없습니다.<br />아래에서 첫 메모를 남겨보세요.</p>
              ) : (
                notes.map((n, i) => (
                  <div key={n.id} className="relative group">
                    {/* 타임라인 선 */}
                    {i < notes.length - 1 && (
                      <div className="absolute left-3 top-6 bottom-0 w-px bg-gray-100" />
                    )}
                    <div className="flex gap-2.5">
                      <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
                        <div className="w-2 h-2 rounded-full bg-blue-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-gray-500 mb-0.5">{fmtTime(n.created_at)}</p>
                        <p className="text-sm text-gray-700 whitespace-pre-wrap break-words leading-relaxed">{n.content}</p>
                      </div>
                      <button
                        onClick={() => handleDeleteNote(n.id)}
                        className="opacity-0 group-hover:opacity-100 transition text-gray-200 hover:text-red-400 text-xs shrink-0 mt-0.5"
                        title="삭제"
                      >✕</button>
                    </div>
                  </div>
                ))
              )}
              <div ref={noteEndRef} />
            </div>
            {/* 노트 입력 */}
            <form onSubmit={handleNoteSubmit} className="mt-4 pt-4 border-t border-gray-100">
              <textarea
                value={noteInput}
                onChange={e => setNoteInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleNoteSubmit(e as unknown as React.FormEvent);
                  }
                }}
                rows={2}
                placeholder="CS 메모, 통화 기록 등... (Enter로 저장)"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
              <button
                type="submit"
                disabled={noteSubmitting || !noteInput.trim()}
                className="mt-2 w-full bg-blue-600 text-white py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 transition"
              >
                {noteSubmitting ? '저장 중...' : '메모 추가'}
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* 편집 모달 */}
      {editing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b">
              <h2 className="text-lg font-bold text-gray-900">고객 정보 편집</h2>
            </div>
            <form onSubmit={handleSave} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">이름 *</label>
                <input required value={form.name || ''} onChange={e => setForm({...form, name: e.target.value})}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">전화번호</label>
                <input value={form.phone || ''} onChange={e => setForm({...form, phone: e.target.value})}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">이메일</label>
                <input type="email" value={form.email || ''} onChange={e => setForm({...form, email: e.target.value})}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">여권번호</label>
                  <input value={form.passport_no || ''} onChange={e => setForm({...form, passport_no: e.target.value})}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">여권 만료일</label>
                  <input type="date" value={form.passport_expiry || ''} onChange={e => setForm({...form, passport_expiry: e.target.value})}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">생년월일</label>
                <input type="date" value={form.birth_date || ''} onChange={e => setForm({...form, birth_date: e.target.value})}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">태그 (쉼표 구분)</label>
                <input value={form.tags_str || ''} onChange={e => setForm({...form, tags_str: e.target.value})}
                  placeholder="VIP, 재방문, 골프"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">메모</label>
                <textarea value={form.memo || ''} onChange={e => setForm({...form, memo: e.target.value})} rows={2}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={saving}
                  className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:bg-gray-300 transition">
                  {saving ? '저장 중...' : '저장'}
                </button>
                <button type="button" onClick={() => setEditing(false)}
                  className="flex-1 bg-gray-100 text-gray-700 py-2 rounded-lg text-sm hover:bg-gray-200 transition">취소</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 마일리지 모달 */}
      {mileageModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full">
            <div className="p-5 border-b">
              <h2 className="text-lg font-bold text-gray-900">마일리지 수동 조정</h2>
              <p className="text-sm text-gray-500 mt-1">현재 잔액: <span className="font-semibold text-blue-600">{(customer.mileage || 0).toLocaleString()}P</span></p>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">증감 포인트 (음수 입력 시 차감)</label>
                <div className="flex gap-2 mb-2">
                  {[100, 500, 1000, -100, -500].map(v => (
                    <button key={v} onClick={() => setMileageDelta(String(v))}
                      className={`text-xs px-2 py-1 rounded-lg border transition ${v > 0 ? 'border-blue-200 text-blue-600 hover:bg-blue-50' : 'border-red-200 text-red-500 hover:bg-red-50'}`}>
                      {v > 0 ? '+' : ''}{v}
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  value={mileageDelta}
                  onChange={e => setMileageDelta(e.target.value)}
                  placeholder="직접 입력 (예: 300 또는 -200)"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {mileageDelta && !isNaN(parseInt(mileageDelta)) && (
                  <p className="text-xs text-gray-500 mt-1">
                    적용 후 잔액: <span className="font-semibold">{Math.max(0, (customer.mileage || 0) + parseInt(mileageDelta)).toLocaleString()}P</span>
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">사유 (선택)</label>
                <input
                  value={mileageReason}
                  onChange={e => setMileageReason(e.target.value)}
                  placeholder="예: VIP 웰컴 포인트, 취소 위약금 차감..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={handleMileage} disabled={mileageSaving || !mileageDelta || isNaN(parseInt(mileageDelta))}
                  className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 transition">
                  {mileageSaving ? '처리 중...' : '적용'}
                </button>
                <button onClick={() => { setMileageModal(false); setMileageDelta(''); setMileageReason(''); }}
                  className="flex-1 bg-gray-100 text-gray-700 py-2 rounded-lg text-sm hover:bg-gray-200 transition">취소</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-xl shadow-lg text-white text-sm font-medium bg-gray-900">
          {toast}
        </div>
      )}
    </div>
  );
}
