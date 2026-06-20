'use client';

/**
 * Phase 3-F: 항공기 지연 트래킹 어드민 페이지
 * /admin/flight-alerts
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { fmtMonthDayTime } from '@/lib/admin-utils';

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
  departed: 'bg-admin-surface-2 text-admin-muted',
};

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? 'bg-admin-surface-2 text-admin-muted';
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
  const [actionError, setActionError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<UpdatingMap>({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [delayDialog, setDelayDialog] = useState<FlightAlert | null>(null);
  const [delayMinutesInput, setDelayMinutesInput] = useState('30');
  const [delayDialogError, setDelayDialogError] = useState('');
  const [cancelDialog, setCancelDialog] = useState<FlightAlert | null>(null);
  const delayInputRef = useRef<HTMLInputElement | null>(null);
  const cancelDialogCancelRef = useRef<HTMLButtonElement | null>(null);
  const [formData, setFormData] = useState({
    flightNumber: '',
    route: '',
    scheduledDeparture: '',
    bookingId: '',
    note: '',
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!delayDialog) return;
    requestAnimationFrame(() => delayInputRef.current?.focus());
  }, [delayDialog]);

  useEffect(() => {
    if (!cancelDialog) return;
    requestAnimationFrame(() => cancelDialogCancelRef.current?.focus());
  }, [cancelDialog]);

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
    setActionError(null);
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
      return true;
    } catch (e) {
      setActionError(e instanceof Error ? e.message : '오류');
      return false;
    } finally {
      setUpdating(prev => ({ ...prev, [id]: false }));
    }
  };

  const openDelayDialog = (flight: FlightAlert) => {
    setDelayDialog(flight);
    setDelayMinutesInput(String(flight.delay_minutes && flight.delay_minutes > 0 ? flight.delay_minutes : 30));
    setDelayDialogError('');
    setActionError(null);
  };

  const confirmDelay = async () => {
    if (!delayDialog) return;
    const minutes = Number(delayMinutesInput);
    if (!Number.isInteger(minutes) || minutes <= 0) {
      setDelayDialogError('1분 이상의 숫자를 입력하세요.');
      return;
    }
    const ok = await updateStatus(delayDialog.id, 'delayed', minutes);
    if (ok) setDelayDialog(null);
  };

  const openCancelDialog = (flight: FlightAlert) => {
    setCancelDialog(flight);
    setActionError(null);
  };

  const confirmCancel = async () => {
    if (!cancelDialog) return;
    const ok = await updateStatus(cancelDialog.id, 'cancelled');
    if (ok) setCancelDialog(null);
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
      setActionError(e instanceof Error ? e.message : '등록 오류');
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
          <h1 className="text-[18px] font-bold text-admin-text-2">항공 지연 트래킹</h1>
          <p className="text-admin-xs text-admin-muted-2 mt-0.5">오늘·내일 출발 항공편 상태 관리</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            aria-label="항공편 목록 새로고침"
            onClick={() => void fetchFlights()}
            disabled={loading}
            className="px-3 py-2 bg-white border border-admin-border-strong text-admin-muted text-admin-xs rounded-lg hover:bg-admin-bg transition disabled:opacity-50"
          >
            새로고침
          </button>
          <button
            type="button"
            aria-label={showAddForm ? '항공편 등록 폼 닫기' : '항공편 등록 폼 열기'}
            onClick={() => setShowAddForm(v => !v)}
            aria-expanded={showAddForm}
            aria-controls="flight-alert-add-form"
            className="px-3 py-2 bg-blue-600 text-white text-admin-xs rounded-lg hover:bg-blue-700 transition"
          >
            + 항공편 등록
          </button>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-4">
          <p className="text-[11px] text-admin-muted-2 uppercase tracking-wide">오늘 출발</p>
          <p className="text-[24px] font-bold text-admin-text-2 mt-1">{todayFlights.length}</p>
        </div>
        <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-4">
          <p className="text-[11px] text-admin-muted-2 uppercase tracking-wide">내일 출발</p>
          <p className="text-[24px] font-bold text-admin-text-2 mt-1">{tomorrowFlights.length}</p>
        </div>
        <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-4">
          <p className="text-[11px] text-admin-muted-2 uppercase tracking-wide">지연</p>
          <p className="text-[24px] font-bold text-amber-600 mt-1">{delayedCount}</p>
        </div>
        <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-4">
          <p className="text-[11px] text-admin-muted-2 uppercase tracking-wide">취소</p>
          <p className="text-[24px] font-bold text-red-600 mt-1">{cancelledCount}</p>
        </div>
      </div>

      {/* 항공편 등록 폼 */}
      {showAddForm && (
        <div id="flight-alert-add-form" className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-4">
          <h2 className="text-admin-base font-semibold text-admin-text-2 mb-3">새 항공편 등록</h2>
          <form onSubmit={(e) => void handleAddFlight(e)} className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="flight-alert-number" className="block text-[11px] text-admin-muted mb-1">편명 *</label>
              <input
                id="flight-alert-number"
                type="text"
                placeholder="예: VN215"
                value={formData.flightNumber}
                onChange={e => setFormData(p => ({ ...p, flightNumber: e.target.value }))}
                required
                className="w-full border border-admin-border-strong rounded px-2 py-1.5 text-admin-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </div>
            <div>
              <label htmlFor="flight-alert-route" className="block text-[11px] text-admin-muted mb-1">노선 *</label>
              <input
                id="flight-alert-route"
                type="text"
                placeholder="예: 인천 → 다낭"
                value={formData.route}
                onChange={e => setFormData(p => ({ ...p, route: e.target.value }))}
                required
                className="w-full border border-admin-border-strong rounded px-2 py-1.5 text-admin-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </div>
            <div>
              <label htmlFor="flight-alert-scheduled-departure" className="block text-[11px] text-admin-muted mb-1">예정 출발 *</label>
              <input
                id="flight-alert-scheduled-departure"
                type="datetime-local"
                value={formData.scheduledDeparture}
                onChange={e => setFormData(p => ({ ...p, scheduledDeparture: e.target.value }))}
                required
                className="w-full border border-admin-border-strong rounded px-2 py-1.5 text-admin-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </div>
            <div>
              <label htmlFor="flight-alert-booking-id" className="block text-[11px] text-admin-muted mb-1">예약 ID (선택)</label>
              <input
                id="flight-alert-booking-id"
                type="text"
                placeholder="UUID"
                value={formData.bookingId}
                onChange={e => setFormData(p => ({ ...p, bookingId: e.target.value }))}
                className="w-full border border-admin-border-strong rounded px-2 py-1.5 text-admin-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </div>
            <div className="col-span-2">
              <label htmlFor="flight-alert-note" className="block text-[11px] text-admin-muted mb-1">메모</label>
              <input
                id="flight-alert-note"
                type="text"
                value={formData.note}
                onChange={e => setFormData(p => ({ ...p, note: e.target.value }))}
                className="w-full border border-admin-border-strong rounded px-2 py-1.5 text-admin-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </div>
            <div className="col-span-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="px-3 py-1.5 border border-admin-border-strong text-admin-muted text-admin-xs rounded hover:bg-admin-bg"
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

      {(error || actionError) && (
        <div role="alert" className="bg-red-50 border border-red-200 rounded-lg p-3 text-admin-xs text-red-600">
          {error ?? actionError}
        </div>
      )}

      {/* 오늘 출발 */}
      <FlightSection
        title="오늘 출발"
        flights={todayFlights}
        loading={loading}
        updating={updating}
        onDelayClick={openDelayDialog}
        onCancelClick={openCancelDialog}
        onStatusChange={updateStatus}
      />

      {/* 내일 출발 */}
      <FlightSection
        title="내일 출발"
        flights={tomorrowFlights}
        loading={loading}
        updating={updating}
        onDelayClick={openDelayDialog}
        onCancelClick={openCancelDialog}
        onStatusChange={updateStatus}
      />

      {delayDialog && (
        <div className="fixed inset-0 z-[60] flex h-dvh items-center justify-center overflow-y-auto px-4 py-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            className="absolute inset-0 bg-black/50 cursor-default"
            aria-label="지연 시간 입력 닫기"
            onClick={() => setDelayDialog(null)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="flight-delay-dialog-title"
            aria-describedby="flight-delay-dialog-description"
            className="relative w-full max-w-sm rounded-admin-md border border-admin-border-mid bg-admin-surface p-5 shadow-admin-lg"
          >
            <h2 id="flight-delay-dialog-title" className="text-admin-lg font-bold text-admin-text-2">
              지연 시간 입력
            </h2>
            <p id="flight-delay-dialog-description" className="mt-1 text-admin-sm leading-6 text-admin-muted">
              {delayDialog.flight_number} 항공편을 지연 상태로 변경합니다.
            </p>
            <label htmlFor="flight-delay-minutes" className="mt-4 block text-admin-xs font-semibold text-admin-muted">
              지연 시간(분)
            </label>
            <input
              id="flight-delay-minutes"
              ref={delayInputRef}
              type="number"
              min={1}
              step={1}
              value={delayMinutesInput}
              onChange={event => {
                setDelayMinutesInput(event.target.value);
                setDelayDialogError('');
              }}
              className="mt-1 w-full rounded border border-admin-border-strong px-3 py-2 text-admin-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
            />
            {delayDialogError && (
              <p role="alert" className="mt-2 text-admin-xs font-semibold text-red-600">
                {delayDialogError}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDelayDialog(null)}
                className="rounded border border-admin-border-strong px-3 py-2 text-admin-xs font-semibold text-admin-muted hover:bg-admin-bg"
              >
                닫기
              </button>
              <button
                type="button"
                onClick={() => void confirmDelay()}
                disabled={updating[delayDialog.id] === true}
                className="rounded bg-amber-500 px-4 py-2 text-admin-xs font-bold text-white hover:bg-amber-600 disabled:opacity-50"
              >
                {updating[delayDialog.id] ? '처리 중...' : '지연 처리'}
              </button>
            </div>
          </div>
        </div>
      )}

      {cancelDialog && (
        <div className="fixed inset-0 z-[60] flex h-dvh items-center justify-center overflow-y-auto px-4 py-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            className="absolute inset-0 bg-black/50 cursor-default"
            aria-label="항공편 취소 확인 닫기"
            onClick={() => setCancelDialog(null)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="flight-cancel-dialog-title"
            aria-describedby="flight-cancel-dialog-description"
            className="relative w-full max-w-sm rounded-admin-md border border-red-200 bg-admin-surface p-5 shadow-admin-lg"
          >
            <h2 id="flight-cancel-dialog-title" className="text-admin-lg font-bold text-admin-text-2">
              항공편 취소 처리
            </h2>
            <p id="flight-cancel-dialog-description" className="mt-1 text-admin-sm leading-6 text-admin-muted">
              {cancelDialog.flight_number} · {cancelDialog.route} 항공편을 취소 상태로 변경합니다. 고객 안내와 대체 일정 확인이 필요한 작업입니다.
            </p>
            <div className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-admin-xs font-semibold text-red-700">
              취소 상태로 바꾸기 전, 알림 대상과 예약 연결 상태를 확인해 주세요.
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                ref={cancelDialogCancelRef}
                type="button"
                onClick={() => setCancelDialog(null)}
                className="rounded border border-admin-border-strong px-3 py-2 text-admin-xs font-semibold text-admin-muted hover:bg-admin-bg"
              >
                닫기
              </button>
              <button
                type="button"
                onClick={() => void confirmCancel()}
                disabled={updating[cancelDialog.id] === true}
                className="rounded bg-red-600 px-4 py-2 text-admin-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {updating[cancelDialog.id] ? '처리 중...' : '취소 처리'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FlightSection({
  title,
  flights,
  loading,
  updating,
  onDelayClick,
  onCancelClick,
  onStatusChange,
}: {
  title: string;
  flights: FlightAlert[];
  loading: boolean;
  updating: UpdatingMap;
  onDelayClick: (f: FlightAlert) => void;
  onCancelClick: (f: FlightAlert) => void;
  onStatusChange: (id: string, status: string) => void;
}) {
  return (
    <div>
      <h2 className="text-admin-sm font-semibold text-admin-muted mb-2">{title}</h2>
      <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs overflow-hidden">
        {loading ? (
          <div className="divide-y divide-slate-50">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                <div className="h-3 bg-admin-surface-2 rounded animate-pulse w-16" />
                <div className="h-3 bg-admin-surface-2 rounded animate-pulse w-24" />
                <div className="h-3 bg-admin-surface-2 rounded animate-pulse w-28" />
                <div className="h-4 bg-admin-surface-2 rounded-full animate-pulse w-14" />
              </div>
            ))}
          </div>
        ) : flights.length === 0 ? (
          <div className="p-6 text-center text-admin-muted-2 text-admin-xs">항공편 없음</div>
        ) : (
          <table className="w-full text-admin-xs">
            <thead>
              <tr className="border-b border-admin-border bg-admin-bg">
                <th className="text-left px-4 py-2.5 text-admin-muted font-medium">편명</th>
                <th className="text-left px-4 py-2.5 text-admin-muted font-medium">노선</th>
                <th className="text-left px-4 py-2.5 text-admin-muted font-medium w-[110px]">예정 출발</th>
                <th className="text-left px-4 py-2.5 text-admin-muted font-medium w-[70px]">상태</th>
                <th className="text-left px-4 py-2.5 text-admin-muted font-medium w-[60px]">지연</th>
                <th className="text-left px-4 py-2.5 text-admin-muted font-medium">메모</th>
                <th className="text-left px-4 py-2.5 text-admin-muted font-medium w-[200px]">액션</th>
              </tr>
            </thead>
            <tbody>
              {flights.map(f => {
                const isUpdating = updating[f.id] === true;
                return (
                  <tr key={f.id} className="border-b border-slate-50 hover:bg-admin-bg transition">
                    <td className="px-4 py-2.5 font-mono font-semibold text-admin-text-2">
                      {f.flight_number}
                    </td>
                    <td className="px-4 py-2.5 text-admin-muted">{f.route}</td>
                    <td className="px-4 py-2.5 text-admin-muted whitespace-nowrap">
                      {fmtMonthDayTime(f.scheduled_departure)}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={f.status} />
                    </td>
                    <td className="px-4 py-2.5 text-admin-muted">
                      {f.delay_minutes != null ? `${f.delay_minutes}분` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-admin-muted-2 max-w-[160px] truncate">
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
                            onClick={() => onCancelClick(f)}
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
                            className="px-2 py-1 bg-admin-surface-2 text-admin-muted text-[11px] rounded hover:bg-slate-200 disabled:opacity-40"
                          >
                            출발
                          </button>
                        )}
                        {isUpdating && (
                          <span className="text-[10px] text-admin-muted-2 self-center">처리중…</span>
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
