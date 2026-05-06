'use client';

/**
 * Phase 3-F: 항공기 지연 트래킹 어드민 페이지
 * /admin/flight-alerts
 */

import { useEffect, useState, useCallback } from 'react';

interface FlightAlert {
  id: string;
  booking_id: string | null;
  flight_number: string;
  route: string;
  scheduled_departure: string;
  actual_departure: string | null;
  delay_minutes: number | null;
  status: 'scheduled' | 'delayed' | 'cancelled' | 'departed';
  notified_customer: boolean;
  notified_operator: boolean;
  note: string | null;
  created_at: string;
}

const STATUS_LABELS: Record<string, string> = {
  scheduled: '정상',
  delayed: '지연',
  cancelled: '취소',
  departed: '출발',
};

const STATUS_COLORS: Record<string, string> = {
  scheduled: 'bg-emerald-100 text-emerald-700',
  delayed: 'bg-amber-100 text-amber-700',
  cancelled: 'bg-red-100 text-red-700',
  departed: 'bg-slate-100 text-slate-600',
};

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? 'bg-slate-100 text-slate-500';
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-semibold ${color}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

type UpdatingMap = Record<string, boolean>;

export default function FlightAlertsAdminPage() {
  const [flights, setFlights] = useState<FlightAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<UpdatingMap>({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState({
    flightNumber: '',
    route: '',
    scheduledDeparture: '',
    bookingId: '',
    note: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const fetchFlights = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/flight-alerts');
      const json = await res.json() as { flights?: FlightAlert[]; error?: string };
      if (json.error) throw new Error(json.error);
      setFlights(json.flights ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '불러오기 실패');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchFlights();
  }, [fetchFlights]);

  const updateStatus = async (id: string, status: string, delayMinutes?: number) => {
    setUpdating(prev => ({ ...prev, [id]: true }));
    try {
      const body: Record<string, unknown> = { status };
      if (delayMinutes !== undefined) body.delayMinutes = delayMinutes;

      const res = await fetch(`/api/admin/flight-alerts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json() as { ok?: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? '업데이트 실패');
      await fetchFlights();
    } catch (e) {
      alert(e instanceof Error ? e.message : '오류');
    } finally {
      setUpdating(prev => ({ ...prev, [id]: false }));
    }
  };

  const handleDelayClick = async (flight: FlightAlert) => {
    const input = window.prompt(
      `${flight.flight_number} 지연 시간(분) 입력:`,
      '30',
    );
    if (input === null) return;
    const minutes = parseInt(input, 10);
    if (isNaN(minutes) || minutes <= 0) {
      alert('올바른 숫자를 입력하세요.');
      return;
    }
    await updateStatus(flight.id, 'delayed', minutes);
  };

  const handleAddFlight = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        flightNumber: formData.flightNumber,
        route: formData.route,
        scheduledDeparture: formData.scheduledDeparture,
      };
      if (formData.bookingId) body.bookingId = formData.bookingId;
      if (formData.note) body.note = formData.note;

      const res = await fetch('/api/admin/flight-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json() as { ok?: boolean; flight_id?: string; error?: string };
      if (!json.ok) throw new Error(json.error ?? '등록 실패');
      setFormData({ flightNumber: '', route: '', scheduledDeparture: '', bookingId: '', note: '' });
      setShowAddForm(false);
      await fetchFlights();
    } catch (e) {
      alert(e instanceof Error ? e.message : '등록 오류');
    } finally {
      setSubmitting(false);
    }
  };

  const todayFlights = flights.filter(f => {
    const dep = new Date(f.scheduled_departure);
    const today = new Date();
    return dep.toDateString() === today.toDateString();
  });
  const tomorrowFlights = flights.filter(f => {
    const dep = new Date(f.scheduled_departure);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return dep.toDateString() === tomorrow.toDateString();
  });

  const delayedCount = flights.filter(f => f.status === 'delayed').length;
  const cancelledCount = flights.filter(f => f.status === 'cancelled').length;

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[18px] font-bold text-slate-800">항공 지연 트래킹</h1>
          <p className="text-admin-xs text-slate-400 mt-0.5">오늘·내일 출발 항공편 상태 관리</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void fetchFlights()}
            disabled={loading}
            className="px-3 py-2 bg-white border border-slate-300 text-slate-600 text-admin-xs rounded-lg hover:bg-slate-50 transition disabled:opacity-50"
          >
            새로고침
          </button>
          <button
            onClick={() => setShowAddForm(v => !v)}
            className="px-3 py-2 bg-blue-600 text-white text-admin-xs rounded-lg hover:bg-blue-700 transition"
          >
            + 항공편 등록
          </button>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-4">
          <p className="text-[11px] text-slate-400 uppercase tracking-wide">오늘 출발</p>
          <p className="text-[24px] font-bold text-slate-800 mt-1">{todayFlights.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-4">
          <p className="text-[11px] text-slate-400 uppercase tracking-wide">내일 출발</p>
          <p className="text-[24px] font-bold text-slate-800 mt-1">{tomorrowFlights.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-4">
          <p className="text-[11px] text-slate-400 uppercase tracking-wide">지연</p>
          <p className="text-[24px] font-bold text-amber-600 mt-1">{delayedCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-4">
          <p className="text-[11px] text-slate-400 uppercase tracking-wide">취소</p>
          <p className="text-[24px] font-bold text-red-600 mt-1">{cancelledCount}</p>
        </div>
      </div>

      {/* 항공편 등록 폼 */}
      {showAddForm && (
        <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-4">
          <h2 className="text-admin-base font-semibold text-slate-700 mb-3">새 항공편 등록</h2>
          <form onSubmit={(e) => void handleAddFlight(e)} className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">편명 *</label>
              <input
                type="text"
                placeholder="예: VN215"
                value={formData.flightNumber}
                onChange={e => setFormData(p => ({ ...p, flightNumber: e.target.value }))}
                required
                className="w-full border border-slate-300 rounded px-2 py-1.5 text-admin-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">노선 *</label>
              <input
                type="text"
                placeholder="예: 인천 → 다낭"
                value={formData.route}
                onChange={e => setFormData(p => ({ ...p, route: e.target.value }))}
                required
                className="w-full border border-slate-300 rounded px-2 py-1.5 text-admin-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">예정 출발 *</label>
              <input
                type="datetime-local"
                value={formData.scheduledDeparture}
                onChange={e => setFormData(p => ({ ...p, scheduledDeparture: e.target.value }))}
                required
                className="w-full border border-slate-300 rounded px-2 py-1.5 text-admin-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">예약 ID (선택)</label>
              <input
                type="text"
                placeholder="UUID"
                value={formData.bookingId}
                onChange={e => setFormData(p => ({ ...p, bookingId: e.target.value }))}
                className="w-full border border-slate-300 rounded px-2 py-1.5 text-admin-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-[11px] text-slate-500 mb-1">메모</label>
              <input
                type="text"
                value={formData.note}
                onChange={e => setFormData(p => ({ ...p, note: e.target.value }))}
                className="w-full border border-slate-300 rounded px-2 py-1.5 text-admin-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </div>
            <div className="col-span-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="px-3 py-1.5 border border-slate-300 text-slate-600 text-admin-xs rounded hover:bg-slate-50"
              >
                취소
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-1.5 bg-blue-600 text-white text-admin-xs rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? '등록 중…' : '등록'}
              </button>
            </div>
          </form>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-admin-xs text-red-600">
          {error}
        </div>
      )}

      {/* 오늘 출발 */}
      <FlightSection
        title="오늘 출발"
        flights={todayFlights}
        loading={loading}
        updating={updating}
        onDelayClick={handleDelayClick}
        onStatusChange={updateStatus}
      />

      {/* 내일 출발 */}
      <FlightSection
        title="내일 출발"
        flights={tomorrowFlights}
        loading={loading}
        updating={updating}
        onDelayClick={handleDelayClick}
        onStatusChange={updateStatus}
      />
    </div>
  );
}

function FlightSection({
  title,
  flights,
  loading,
  updating,
  onDelayClick,
  onStatusChange,
}: {
  title: string;
  flights: FlightAlert[];
  loading: boolean;
  updating: UpdatingMap;
  onDelayClick: (f: FlightAlert) => void;
  onStatusChange: (id: string, status: string) => void;
}) {
  return (
    <div>
      <h2 className="text-admin-sm font-semibold text-slate-600 mb-2">{title}</h2>
      <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden">
        {loading ? (
          <div className="divide-y divide-slate-50">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                <div className="h-3 bg-slate-100 rounded animate-pulse w-16" />
                <div className="h-3 bg-slate-100 rounded animate-pulse w-24" />
                <div className="h-3 bg-slate-100 rounded animate-pulse w-28" />
                <div className="h-4 bg-slate-100 rounded-full animate-pulse w-14" />
              </div>
            ))}
          </div>
        ) : flights.length === 0 ? (
          <div className="p-6 text-center text-slate-300 text-admin-xs">항공편 없음</div>
        ) : (
          <table className="w-full text-admin-xs">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-4 py-2.5 text-slate-500 font-medium">편명</th>
                <th className="text-left px-4 py-2.5 text-slate-500 font-medium">노선</th>
                <th className="text-left px-4 py-2.5 text-slate-500 font-medium w-[110px]">예정 출발</th>
                <th className="text-left px-4 py-2.5 text-slate-500 font-medium w-[70px]">상태</th>
                <th className="text-left px-4 py-2.5 text-slate-500 font-medium w-[60px]">지연</th>
                <th className="text-left px-4 py-2.5 text-slate-500 font-medium">메모</th>
                <th className="text-left px-4 py-2.5 text-slate-500 font-medium w-[200px]">액션</th>
              </tr>
            </thead>
            <tbody>
              {flights.map(f => {
                const isUpdating = updating[f.id] === true;
                return (
                  <tr key={f.id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                    <td className="px-4 py-2.5 font-mono font-semibold text-slate-800">
                      {f.flight_number}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{f.route}</td>
                    <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">
                      {new Date(f.scheduled_departure).toLocaleString('ko-KR', {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={f.status} />
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">
                      {f.delay_minutes != null ? `${f.delay_minutes}분` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-slate-400 max-w-[160px] truncate">
                      {f.note ?? '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex gap-1">
                        {f.status !== 'scheduled' && (
                          <button
                            onClick={() => onStatusChange(f.id, 'scheduled')}
                            disabled={isUpdating}
                            className="px-2 py-1 bg-emerald-50 text-emerald-700 text-[11px] rounded hover:bg-emerald-100 disabled:opacity-40"
                          >
                            정상
                          </button>
                        )}
                        {f.status !== 'delayed' && (
                          <button
                            onClick={() => onDelayClick(f)}
                            disabled={isUpdating}
                            className="px-2 py-1 bg-amber-50 text-amber-700 text-[11px] rounded hover:bg-amber-100 disabled:opacity-40"
                          >
                            지연
                          </button>
                        )}
                        {f.status !== 'cancelled' && (
                          <button
                            onClick={() => {
                              if (window.confirm(`${f.flight_number} 취소 처리하시겠습니까?`)) {
                                onStatusChange(f.id, 'cancelled');
                              }
                            }}
                            disabled={isUpdating}
                            className="px-2 py-1 bg-red-50 text-red-600 text-[11px] rounded hover:bg-red-100 disabled:opacity-40"
                          >
                            취소
                          </button>
                        )}
                        {f.status !== 'departed' && (
                          <button
                            onClick={() => onStatusChange(f.id, 'departed')}
                            disabled={isUpdating}
                            className="px-2 py-1 bg-slate-100 text-slate-600 text-[11px] rounded hover:bg-slate-200 disabled:opacity-40"
                          >
                            출발
                          </button>
                        )}
                        {isUpdating && (
                          <span className="text-[10px] text-slate-400 self-center">처리중…</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
