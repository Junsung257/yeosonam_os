'use client';

import { useEffect, useState, useCallback } from 'react';

// ─── 타입 ────────────────────────────────────────────────────────────────────

interface Session {
  id: string;
  destination: string;
  departure: string;
  date_from: string;
  date_to: string;
  pax_adults: number;
  pax_children: number;
  customer_phone: string | null;
  customer_name: string | null;
  plan_json: {
    hotels: { name: string; pricePerNight: number }[];
    flights: { airline: string; price: number }[];
    activities: { name: string; price: number }[];
    aiSummary: string;
    comparison: { totalMin: number; totalMax: number };
  };
  source: string;
  status?: string;
  mrt_booking_ref?: string | null;
  booked_by?: string | null;
  booked_at?: string | null;
  admin_notes?: string | null;
  created_at: string;
}

interface RevenueItem {
  reservationNo:         string;
  reservedAt:            string;
  productTitle:          string;
  productCategory:       string;
  city:                  string;
  country:               string;
  salePrice:             number;
  commissionBase:        number;
  commission:            number;
  commissionRate:        number;
  status:                string;
  statusKor:             string;
  settlementCriteriaDate?: string;
  utmContent?:           string;
  session?: { destination: string; customer_phone: string | null; customer_name: string | null } | null;
}

interface ReservationItem {
  reservationNo:   string;
  reservedAt:      string;
  productTitle:    string;
  productCategory: string;
  city:            string;
  status:          string;
  statusKor:       string;
  salePrice:       number;
  quantity:        number;
  tripStartedAt?:  string;
  tripEndedAt?:    string;
  utmContent?:     string;
}

// ─── 상수 ────────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  new: '신규', contacted: '연락 완료', booked: '예약 완료', cancelled: '취소',
};
const STATUS_COLOR: Record<string, string> = {
  new: 'bg-blue-50 text-blue-700',
  contacted: 'bg-yellow-50 text-yellow-700',
  booked: 'bg-green-50 text-green-700',
  cancelled: 'bg-red-50 text-red-700',
};

function fmt만(n: number) { return Math.round(n / 10000).toLocaleString() + '만원'; }
function fmtDate(s: string) { return s ? s.slice(0, 10) : '-'; }

// ─── 컴포넌트 ────────────────────────────────────────────────────────────────

export default function FreeTravelAdminPage() {
  const [tab, setTab]             = useState<'leads' | 'revenues' | 'reservations'>('leads');
  const [sessions, setSessions]   = useState<Session[]>([]);
  const [revenues, setRevenues]   = useState<RevenueItem[]>([]);
  const [reservations, setReservations] = useState<ReservationItem[]>([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [bookingModal, setBookingModal] = useState<Session | null>(null);
  const [mrtRef, setMrtRef]       = useState('');
  const [bookedBy, setBookedBy]   = useState('');
  const [notes, setNotes]         = useState('');
  const [saving, setSaving]       = useState(false);

  const loadSessions = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/free-travel/session?list=1&limit=100');
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json() as { sessions?: Session[] };
      setSessions(json.sessions ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류');
    } finally { setLoading(false); }
  }, []);

  const loadRevenues = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const from = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
      const to   = new Date().toISOString().slice(0, 10);
      const res  = await fetch(`/api/admin/free-travel/revenues?from=${from}&to=${to}`);
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json() as { items?: RevenueItem[] };
      setRevenues(json.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류');
    } finally { setLoading(false); }
  }, []);

  const loadReservations = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const from = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
      const to   = new Date().toISOString().slice(0, 10);
      const res  = await fetch(`/api/admin/free-travel/reservations?from=${from}&to=${to}&sync=1`);
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json() as { items?: ReservationItem[] };
      setReservations(json.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (tab === 'leads') loadSessions();
    else if (tab === 'revenues') loadRevenues();
    else loadReservations();
  }, [tab, loadSessions, loadRevenues, loadReservations]);

  const handleBookManual = async () => {
    if (!bookingModal || !mrtRef.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/free-travel/book-manual', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: bookingModal.id, mrtBookingRef: mrtRef.trim(), bookedBy: bookedBy.trim() || '관리자', status: 'booked', adminNotes: notes.trim() || undefined }),
      });
      if (!res.ok) {
        const e = await res.json() as { error?: string };
        throw new Error(e.error ?? '처리 실패');
      }
      setBookingModal(null); setMrtRef(''); setBookedBy(''); setNotes('');
      loadSessions();
    } catch (e) {
      alert(e instanceof Error ? e.message : '오류');
    } finally { setSaving(false); }
  };

  const handleStatusChange = async (sessionId: string, newStatus: string) => {
    try {
      await fetch('/api/free-travel/book-manual', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, mrtBookingRef: '-', bookedBy: '관리자', status: newStatus }),
      });
      loadSessions();
    } catch { /* silent */ }
  };

  const totalCommission  = revenues.reduce((s, r) => s + (r.commission ?? 0), 0);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* 헤더 */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">자유여행 플래너 관리</h1>
        <p className="text-sm text-gray-500 mt-1">MRT 어필리에이트 리드 · 수익 · 예약 내역</p>
      </div>

      {/* 탭 */}
      <div className="flex border-b border-gray-200 mb-6 gap-1">
        {(['leads', 'revenues', 'reservations'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${tab === t ? 'border-blue-600 text-blue-600 bg-blue-50' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t === 'leads' ? `리드 (${sessions.length})` : t === 'revenues' ? `수익 현황 ${totalCommission > 0 ? '(' + fmt만(totalCommission) + ')' : ''}` : '예약 내역'}
          </button>
        ))}
      </div>

      {loading && <div className="text-center text-gray-400 py-12">로딩 중...</div>}
      {error && <div className="bg-red-50 text-red-700 px-4 py-3 rounded text-sm mb-4">{error}</div>}

      {/* ── 리드 탭 ── */}
      {!loading && tab === 'leads' && (
        <div className="space-y-3">
          {sessions.length === 0 && <div className="text-center text-gray-400 py-12">견적 세션이 없습니다.</div>}
          {sessions.map(s => (
            <div key={s.id} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900">{s.destination}</span>
                    <span className="text-gray-400 text-sm">{fmtDate(s.date_from)} ~ {fmtDate(s.date_to)}</span>
                    <span className="text-gray-400 text-sm">성인 {s.pax_adults}명{s.pax_children ? ` 아동 ${s.pax_children}명` : ''}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[s.status ?? 'new'] ?? 'bg-gray-100 text-gray-600'}`}>
                      {STATUS_LABEL[s.status ?? 'new'] ?? s.status}
                    </span>
                  </div>

                  {s.plan_json?.aiSummary && (
                    <p className="text-sm text-gray-600 mt-1 line-clamp-2">{s.plan_json.aiSummary}</p>
                  )}

                  <div className="flex items-center gap-3 mt-2 text-sm flex-wrap">
                    {s.customer_phone ? (
                      <a href={`tel:${s.customer_phone}`} className="text-blue-600 font-medium hover:underline">
                        {s.customer_phone} {s.customer_name && `(${s.customer_name})`}
                      </a>
                    ) : (
                      <span className="text-gray-400">연락처 미수집</span>
                    )}
                    {s.mrt_booking_ref && (
                      <span className="text-green-700 text-xs bg-green-50 px-2 py-0.5 rounded">MRT #{s.mrt_booking_ref}</span>
                    )}
                    <span className="text-gray-400 text-xs">{fmtDate(s.created_at)}</span>
                  </div>

                  {/* 검색 결과 요약 */}
                  <div className="flex gap-3 mt-2 text-xs text-gray-500 flex-wrap">
                    {(s.plan_json?.flights?.length ?? 0) > 0 && (
                      <span>✈️ {s.plan_json.flights[0]?.airline} {s.plan_json.flights[0]?.price ? fmt만(s.plan_json.flights[0].price) : ''}</span>
                    )}
                    {(s.plan_json?.hotels?.length ?? 0) > 0 && (
                      <span>🏨 {s.plan_json.hotels[0]?.name} {s.plan_json.hotels[0]?.pricePerNight ? fmt만(s.plan_json.hotels[0].pricePerNight) + '/박' : ''}</span>
                    )}
                    {(s.plan_json?.activities?.length ?? 0) > 0 && (
                      <span>🎯 액티비티 {s.plan_json.activities.length}개</span>
                    )}
                    {(s.plan_json?.comparison?.totalMin ?? 0) > 0 && (
                      <span className="text-blue-600 font-medium">총 {fmt만(s.plan_json.comparison.totalMin)}~{fmt만(s.plan_json.comparison.totalMax)}</span>
                    )}
                  </div>
                </div>

                {/* 액션 */}
                <div className="flex flex-col gap-1 shrink-0">
                  <select
                    value={s.status ?? 'new'}
                    onChange={e => handleStatusChange(s.id, e.target.value)}
                    className="text-xs border border-gray-200 rounded px-2 py-1 bg-white"
                  >
                    <option value="new">신규</option>
                    <option value="contacted">연락 완료</option>
                    <option value="booked">예약 완료</option>
                    <option value="cancelled">취소</option>
                  </select>
                  {!s.mrt_booking_ref && (
                    <button
                      onClick={() => { setBookingModal(s); setMrtRef(''); setBookedBy(''); setNotes(''); }}
                      className="text-xs bg-blue-600 text-white rounded px-2 py-1 hover:bg-blue-700"
                    >
                      예약번호 입력
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── 수익 현황 탭 ── */}
      {!loading && tab === 'revenues' && (
        <div>
          {revenues.length === 0 ? (
            <div className="text-center text-gray-400 py-12">
              {error ? '' : 'MRT 수익 데이터가 없습니다. API Key 권한(REVENUES:READ)을 확인하세요.'}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="bg-blue-50 rounded-xl p-4">
                  <p className="text-xs text-blue-600 font-medium">총 수익 (30일)</p>
                  <p className="text-2xl font-bold text-blue-900 mt-1">{fmt만(totalCommission)}</p>
                </div>
                <div className="bg-green-50 rounded-xl p-4">
                  <p className="text-xs text-green-600 font-medium">확정 건수</p>
                  <p className="text-2xl font-bold text-green-900 mt-1">{revenues.filter(r => r.status === 'confirmed' || r.status === 'settled').length}건</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-4">
                  <p className="text-xs text-gray-600 font-medium">세션 매칭율</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">
                    {revenues.length > 0 ? Math.round(revenues.filter(r => r.session).length / revenues.length * 100) : 0}%
                  </p>
                </div>
              </div>
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-gray-500 text-xs">
                    <th className="pb-2 pr-4">예약번호</th>
                    <th className="pb-2 pr-4">상품</th>
                    <th className="pb-2 pr-4">예약일</th>
                    <th className="pb-2 pr-4">판매가</th>
                    <th className="pb-2 pr-4">수익</th>
                    <th className="pb-2 pr-4">상태</th>
                    <th className="pb-2">세션 매칭</th>
                  </tr>
                </thead>
                <tbody>
                  {revenues.map(r => (
                    <tr key={r.reservationNo} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2 pr-4 font-mono text-xs">{r.reservationNo}</td>
                      <td className="py-2 pr-4 max-w-[200px] truncate" title={r.productTitle}>{r.productTitle}</td>
                      <td className="py-2 pr-4">{fmtDate(r.reservedAt)}</td>
                      <td className="py-2 pr-4">{fmt만(r.salePrice)}</td>
                      <td className="py-2 pr-4 text-green-700 font-medium">{fmt만(r.commission)}<span className="text-gray-400 text-xs ml-1">({r.commissionRate}%)</span></td>
                      <td className="py-2 pr-4">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${r.status === 'settled' ? 'bg-green-100 text-green-700' : r.status === 'confirmed' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                          {r.statusKor || r.status}
                        </span>
                      </td>
                      <td className="py-2 text-xs text-gray-500">
                        {r.session ? `${r.session.destination} ${r.session.customer_name ?? ''}` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {/* ── 예약 내역 탭 ── */}
      {!loading && tab === 'reservations' && (
        <div>
          {reservations.length === 0 ? (
            <div className="text-center text-gray-400 py-12">
              {error ? '' : 'MRT 예약 데이터가 없습니다. API Key 권한(RESERVATIONS:READ)을 확인하세요.'}
            </div>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-gray-200 text-left text-gray-500 text-xs">
                  <th className="pb-2 pr-4">예약번호</th>
                  <th className="pb-2 pr-4">상품</th>
                  <th className="pb-2 pr-4">도시</th>
                  <th className="pb-2 pr-4">예약일</th>
                  <th className="pb-2 pr-4">여행일</th>
                  <th className="pb-2 pr-4">금액</th>
                  <th className="pb-2 pr-4">상태</th>
                  <th className="pb-2">세션 연결</th>
                </tr>
              </thead>
              <tbody>
                {reservations.map(r => (
                  <tr key={r.reservationNo} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2 pr-4 font-mono text-xs">{r.reservationNo}</td>
                    <td className="py-2 pr-4 max-w-[180px] truncate" title={r.productTitle}>{r.productTitle}</td>
                    <td className="py-2 pr-4 text-xs text-gray-500">{r.city}</td>
                    <td className="py-2 pr-4">{fmtDate(r.reservedAt)}</td>
                    <td className="py-2 pr-4 text-xs">{r.tripStartedAt ? `${fmtDate(r.tripStartedAt)}~${fmtDate(r.tripEndedAt ?? '')}` : '-'}</td>
                    <td className="py-2 pr-4">{fmt만(r.salePrice)}</td>
                    <td className="py-2 pr-4">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${r.status === 'confirmed' ? 'bg-green-100 text-green-700' : r.status === 'cancelled' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                        {r.statusKor || r.status}
                      </span>
                    </td>
                    <td className="py-2 text-xs text-gray-500">
                      {r.utmContent ? <span className="text-blue-600">세션 연결됨</span> : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── 예약번호 입력 모달 ── */}
      {bookingModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold mb-1">MRT 예약번호 기록</h3>
            <p className="text-sm text-gray-500 mb-4">{bookingModal.destination} · {fmtDate(bookingModal.date_from)}~{fmtDate(bookingModal.date_to)}</p>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600">MRT 예약번호 *</label>
                <input value={mrtRef} onChange={e => setMrtRef(e.target.value)}
                  placeholder="예) MRT-2026-XXXXX"
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">담당자</label>
                <input value={bookedBy} onChange={e => setBookedBy(e.target.value)}
                  placeholder="이름"
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">메모</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)}
                  rows={2} placeholder="특이사항"
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none" />
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <button onClick={() => setBookingModal(null)} className="flex-1 border border-gray-300 rounded-lg py-2 text-sm hover:bg-gray-50">취소</button>
              <button onClick={handleBookManual} disabled={!mrtRef.trim() || saving}
                className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {saving ? '저장 중...' : '예약 기록'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
