'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { maskPhone } from '@/lib/pii-mask';

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
    itinerarySource?: 'llm' | 'template';
    itineraryLlmError?: string;
    itineraryScore?: { score: number; label: string };
    plannerPreferences?: {
      companionType?: string | null;
      hotelBudgetBand?: string | null;
      travelPace?: string | null;
    };
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
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusableElements(container: HTMLElement | null) {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter(el => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true');
}
const STATUS_COLOR: Record<string, string> = {
  new: 'bg-blue-50 text-blue-700',
  contacted: 'bg-yellow-50 text-yellow-700',
  booked: 'bg-green-50 text-green-700',
  cancelled: 'bg-red-50 text-red-700',
};

function fmt만(n: number) { return Math.round(n / 10000).toLocaleString() + '만원'; }
function fmtDate(s: string) { return s ? s.slice(0, 10) : '-'; }

// ─── 컴포넌트 ────────────────────────────────────────────────────────────────

interface ItineraryMetricsPayload {
  windowDays: number;
  sampleSize: number;
  llm: number;
  template: number;
  unknown: number;
  itineraryLlmErrorCounts: Record<string, number>;
}

interface ExperimentsPayload {
  since: string;
  days: number;
  maxRows?: number;
  truncated?: { crosssell: boolean; guidebook: boolean };
  queryErrors?: { crosssell: string | null; guidebook: string | null };
  crosssell: {
    exposure: { A: number; B: number; unknown: number };
    clicks: { A: number; B: number; unknown: number };
    ctrApprox: { A: number | null; B: number | null };
    ctrPercent?: { A: number | null; B: number | null };
    bySession?: {
      exposureSessions: { A: number; B: number; unknown: number };
      clickSessions: { A: number; B: number; unknown: number };
      ctrPercentBySession: { A: number | null; B: number | null };
      skippedRowsWithoutSessionId: { exposure: number; click: number };
    };
    rowCounts: { exposuresAndClicks: number; exposureRowsApprox: number; clickRows: number };
  } | null;
  guidebook: { total: number; byAction: Record<string, number>; tableMissing: boolean } | null;
  kakao: {
    solapiReady: boolean;
    solapiMissing: string[];
    channelReady: boolean;
    channelMissing: string[];
    templates: { envKey: string; templateIdSet: boolean; variableKeys: string[]; description: string }[];
  };
  message?: string;
}

type MetricsWindow = 7 | 30 | 90;

export default function FreeTravelPageClient({
  initialSessions,
  itineraryMetricsByWindow,
}: {
  initialSessions: Session[];
  itineraryMetricsByWindow: Record<MetricsWindow, ItineraryMetricsPayload | null>;
}) {
  const [tab, setTab]             = useState<'leads' | 'revenues' | 'reservations' | 'experiments'>('leads');
  const [metricsWindow, setMetricsWindow] = useState<MetricsWindow>(30);
  // sessions는 서버 pre-fetch 데이터로 초기화 (useEffect fetch 없음)
  const [sessions, setSessions]   = useState<Session[]>(initialSessions);
  const [revenues, setRevenues]   = useState<RevenueItem[]>([]);
  const [reservations, setReservations] = useState<ReservationItem[]>([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [bookingModal, setBookingModal] = useState<Session | null>(null);
  const [mrtRef, setMrtRef]       = useState('');
  const [bookedBy, setBookedBy]   = useState('');
  const [notes, setNotes]         = useState('');
  const [saving, setSaving]       = useState(false);
  const bookingModalRef = useRef<HTMLDivElement | null>(null);
  const bookingModalFirstInputRef = useRef<HTMLInputElement | null>(null);
  const bookingModalReturnFocusRef = useRef<HTMLElement | null>(null);
  const bookingModalTitleId = 'free-travel-booking-modal-title';
  const bookingModalDescriptionId = 'free-travel-booking-modal-description';
  const bookingModalStatusId = 'free-travel-booking-modal-status';
  const [experiments, setExperiments] = useState<ExperimentsPayload | null>(null);
  const [experimentDays, setExperimentDays] = useState<7 | 30 | 90>(30);
  const [experimentMaxRows, setExperimentMaxRows] = useState<5000 | 10000 | 20000 | 30000 | 50000>(20000);
  const bookingModalOpen = bookingModal !== null;

  const closeBookingModal = useCallback(() => {
    setBookingModal(null);
    setMrtRef('');
    setBookedBy('');
    setNotes('');
    requestAnimationFrame(() => bookingModalReturnFocusRef.current?.focus());
  }, []);

  const openBookingModal = useCallback((session: Session, trigger: HTMLElement) => {
    bookingModalReturnFocusRef.current = trigger;
    setBookingModal(session);
    setMrtRef('');
    setBookedBy('');
    setNotes('');
  }, []);

  useEffect(() => {
    if (!bookingModalOpen) return undefined;
    const dialog = bookingModalRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    requestAnimationFrame(() => bookingModalFirstInputRef.current?.focus());

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !saving) {
        event.preventDefault();
        closeBookingModal();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = getFocusableElements(dialog);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [bookingModalOpen, closeBookingModal, saving]);

  // 뮤테이션(상태변경/예약) 후 수동 새로고침용 — 초기 자동 실행 없음
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

  const loadExperiments = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const q = new URLSearchParams({ days: String(experimentDays), maxRows: String(experimentMaxRows) });
      const res = await fetch(`/api/admin/free-travel/experiments?${q}`);
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json() as ExperimentsPayload;
      setExperiments(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류');
    } finally { setLoading(false); }
  }, [experimentDays, experimentMaxRows]);

  // leads 탭은 서버 pre-fetch로 초기 데이터 제공 → useEffect 제외
  useEffect(() => {
    if (tab === 'leads') return;
    if (tab === 'revenues') loadRevenues();
    else if (tab === 'reservations') loadReservations();
  }, [tab, loadRevenues, loadReservations]);

  useEffect(() => {
    if (tab !== 'experiments') return;
    void loadExperiments();
  }, [tab, experimentDays, experimentMaxRows, loadExperiments]);

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
      closeBookingModal();
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

  const metricsActive = itineraryMetricsByWindow[metricsWindow];
  const hasAnyMetricsPanel = ([7, 30, 90] as const).some(
    d => itineraryMetricsByWindow[d] != null,
  );

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* 헤더 */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-admin-text">자유여행 플래너 관리</h1>
        <p className="text-sm text-admin-muted mt-1">MRT 어필리에이트 리드 · 수익 · 예약 내역</p>
        {hasAnyMetricsPanel && (
          <div className="mt-4 rounded-admin-md border border-indigo-100 bg-indigo-50/80 px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold text-indigo-900">일정 AI 통계</p>
              <span className="text-xs text-indigo-700">기간</span>
              {([7, 30, 90] as const).map(d => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setMetricsWindow(d)}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
                    metricsWindow === d
                      ? 'bg-blue-600 text-white'
                      : 'bg-white/80 text-indigo-800 ring-1 ring-indigo-200 hover:bg-white'
                  }`}
                >
                  {d}일
                </button>
              ))}
            </div>
            {metricsActive ? (
              <>
                <p className="mt-2 text-xs text-indigo-800">
                  최근 <strong>{metricsActive.windowDays}</strong>일 · 표본 <strong>{metricsActive.sampleSize}</strong>건
                  <span className="text-indigo-600"> (건수 상한 3,000)</span>
                </p>
                <div className="mt-2 flex flex-wrap gap-3 text-indigo-800">
                  <span>DeepSeek 일정 <strong>{metricsActive.llm}</strong></span>
                  <span>템플릿 폴백 <strong>{metricsActive.template}</strong></span>
                  <span>미분류 <strong>{metricsActive.unknown}</strong></span>
                </div>
                {Object.keys(metricsActive.itineraryLlmErrorCounts).length > 0 && (
                  <p className="mt-2 text-xs text-indigo-700">
                    폴백 사유:{' '}
                    {Object.entries(metricsActive.itineraryLlmErrorCounts)
                      .map(([k, v]) => `${k} ${v}`)
                      .join(' · ')}
                  </p>
                )}
              </>
            ) : (
              <p className="mt-2 text-xs text-amber-800">이 기간 통계를 불러오지 못했습니다. DB 연결을 확인해 주세요.</p>
            )}
            <p className="mt-2 text-[11px] text-indigo-600">
              리타겟 알림톡 <strong>플래너링크</strong>에는 고객별 저장 견적 URL(<code className="rounded bg-white/60 px-1">?session=</code>)이 들어갑니다. 주간 크론{' '}
              <code className="rounded bg-white/60 px-1">/api/cron/free-travel-plan-housekeeping</code>
            </p>
          </div>
        )}
      </div>

      {/* 탭 */}
      <div className="flex border-b border-admin-border-mid mb-6 gap-1">
        {(['leads', 'revenues', 'reservations', 'experiments'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${tab === t ? 'border-blue-600 text-blue-600 bg-blue-50' : 'border-transparent text-admin-muted hover:text-admin-text-2'}`}>
            {t === 'leads' ? `리드 (${sessions.length})` : t === 'revenues' ? `수익 현황 ${totalCommission > 0 ? '(' + fmt만(totalCommission) + ')' : ''}` : t === 'reservations' ? '예약 내역' : '실험 · 가이드북'}
          </button>
        ))}
      </div>

      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-4 flex items-center gap-3">
              <div className="h-3.5 bg-admin-surface-2 rounded animate-pulse flex-1" />
              <div className="h-4 bg-admin-surface-2 rounded-full animate-pulse w-16" />
            </div>
          ))}
        </div>
      )}
      {error && <div className="bg-red-50 text-red-700 px-4 py-3 rounded text-sm mb-4">{error}</div>}
      {!loading && tab === 'experiments' && !experiments && !error && (
        <div className="text-center text-admin-muted-2 py-12">실험 데이터를 불러오는 중 문제가 있었습니다.</div>
      )}

      {/* ── 리드 탭 ── */}
      {tab === 'leads' && !loading && (
        <div className="space-y-3">
          {sessions.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-14">
              <svg className="w-10 h-10 text-admin-border-mid" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.111v4.765c0 1.23-.98 2.243-2.21 2.243h-.08a2.243 2.243 0 01-2.243-2.243v-.363a2.243 2.243 0 00-2.243-2.243h-3.75a2.243 2.243 0 00-2.243 2.243v.363a2.243 2.243 0 01-2.243 2.243h-.08C5.98 17.63 5 16.617 5 15.387V10.622c0-.983.616-1.827 1.5-2.11M12 3v6m0 0l-2.25-2.25M12 9l2.25-2.25" /></svg>
              <p className="text-admin-sm font-medium text-admin-muted">견적 세션이 없습니다.</p>
            </div>
          )}
          {sessions.map(s => (
            <div key={s.id} className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-4 shadow-admin-xs hover:shadow-admin-sm transition-shadow">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-admin-text">{s.destination}</span>
                    <span className="text-admin-muted-2 text-sm">{fmtDate(s.date_from)} ~ {fmtDate(s.date_to)}</span>
                    <span className="text-admin-muted-2 text-sm">성인 {s.pax_adults}명{s.pax_children ? ` 아동 ${s.pax_children}명` : ''}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[s.status ?? 'new'] ?? 'bg-admin-surface-2 text-admin-muted'}`}>
                      {STATUS_LABEL[s.status ?? 'new'] ?? s.status}
                    </span>
                    {s.plan_json?.itinerarySource === 'llm' && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 font-medium">일정 AI</span>
                    )}
                    {s.plan_json?.itinerarySource === 'template' && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-admin-surface-2 text-admin-muted font-medium">일정 템플릿</span>
                    )}
                    {typeof s.plan_json?.itineraryScore?.score === 'number' && (
                      <span className="text-[10px] text-admin-muted">구성점수 {s.plan_json.itineraryScore!.score}</span>
                    )}
                    {s.plan_json?.itineraryLlmError && (
                      <span
                        className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-900 font-medium cursor-help"
                        title={s.plan_json.itineraryLlmError}
                      >
                        일정 폴백
                      </span>
                    )}
                  </div>

                  {s.plan_json?.aiSummary && (
                    <p className="text-sm text-admin-muted mt-1 line-clamp-2">{s.plan_json.aiSummary}</p>
                  )}

                  <div className="flex items-center gap-3 mt-2 text-sm flex-wrap">
                    {s.customer_phone ? (
                      <a href={`tel:${s.customer_phone}`} className="text-blue-600 font-medium hover:underline">
                        {maskPhone(s.customer_phone, 'cs_agent')} {s.customer_name && `(${s.customer_name})`}
                      </a>
                    ) : (
                      <span className="text-admin-muted-2">연락처 미수집</span>
                    )}
                    {s.mrt_booking_ref && (
                      <span className="text-green-700 text-xs bg-green-50 px-2 py-0.5 rounded">MRT #{s.mrt_booking_ref}</span>
                    )}
                    <span className="text-admin-muted-2 text-xs">{fmtDate(s.created_at)}</span>
                  </div>

                  {/* 검색 결과 요약 */}
                  <div className="flex gap-3 mt-2 text-xs text-admin-muted flex-wrap">
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
                    {s.plan_json?.plannerPreferences && (
                      <span className="text-admin-muted" title="플래너 옵션(복원용)">
                        {[
                          s.plan_json.plannerPreferences.companionType,
                          s.plan_json.plannerPreferences.hotelBudgetBand,
                          s.plan_json.plannerPreferences.travelPace,
                        ].filter(Boolean).join(' · ') || '플래너 옵션 없음'}
                      </span>
                    )}
                    <Link
                      href={`/free-travel?session=${s.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline font-medium"
                    >
                      플래너에서 열기
                    </Link>
                  </div>
                </div>

                {/* 액션 */}
                <div className="flex flex-col gap-1 shrink-0">
                  <select
                    value={s.status ?? 'new'}
                    onChange={e => handleStatusChange(s.id, e.target.value)}
                    className="text-xs border border-admin-border-mid rounded px-2 py-1 bg-white"
                  >
                    <option value="new">신규</option>
                    <option value="contacted">연락 완료</option>
                    <option value="booked">예약 완료</option>
                    <option value="cancelled">취소</option>
                  </select>
                  {!s.mrt_booking_ref && (
                    <button
                      onClick={event => openBookingModal(s, event.currentTarget)}
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
            <div className="text-center text-admin-muted-2 py-12">
              {error ? '' : 'MRT 수익 데이터가 없습니다. API Key 권한(REVENUES:READ)을 확인하세요.'}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="bg-blue-50 rounded-admin-md p-4">
                  <p className="text-xs text-blue-600 font-medium">총 수익 (30일)</p>
                  <p className="text-2xl font-bold text-blue-900 mt-1">{fmt만(totalCommission)}</p>
                </div>
                <div className="bg-green-50 rounded-admin-md p-4">
                  <p className="text-xs text-green-600 font-medium">확정 건수</p>
                  <p className="text-2xl font-bold text-green-900 mt-1">{revenues.filter(r => r.status === 'confirmed' || r.status === 'settled').length}건</p>
                </div>
                <div className="bg-admin-bg rounded-admin-md p-4">
                  <p className="text-xs text-admin-muted font-medium">세션 매칭율</p>
                  <p className="text-2xl font-bold text-admin-text mt-1">
                    {revenues.length > 0 ? Math.round(revenues.filter(r => r.session).length / revenues.length * 100) : 0}%
                  </p>
                </div>
              </div>
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-admin-border-mid text-left text-admin-muted text-xs">
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
                    <tr key={r.reservationNo} className="border-b border-admin-border hover:bg-admin-bg">
                      <td className="py-2 pr-4 font-mono text-xs">{r.reservationNo}</td>
                      <td className="py-2 pr-4 max-w-[200px] truncate" title={r.productTitle}>{r.productTitle}</td>
                      <td className="py-2 pr-4">{fmtDate(r.reservedAt)}</td>
                      <td className="py-2 pr-4">{fmt만(r.salePrice)}</td>
                      <td className="py-2 pr-4 text-green-700 font-medium">{fmt만(r.commission)}<span className="text-admin-muted-2 text-xs ml-1">({r.commissionRate}%)</span></td>
                      <td className="py-2 pr-4">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${r.status === 'settled' ? 'bg-green-100 text-green-700' : r.status === 'confirmed' ? 'bg-blue-100 text-blue-700' : 'bg-admin-surface-2 text-admin-muted'}`}>
                          {r.statusKor || r.status}
                        </span>
                      </td>
                      <td className="py-2 text-xs text-admin-muted">
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

      {/* ── 실험 / 가이드북 / 카카오 진단 ── */}
      {!loading && tab === 'experiments' && experiments && (
        <div className="space-y-8">
          <div className="flex flex-wrap items-center gap-3 pb-2 border-b border-admin-border">
            <label className="text-sm text-admin-muted flex items-center gap-2">
              기간
              <select
                value={experimentDays}
                onChange={e => setExperimentDays(Number(e.target.value) as 7 | 30 | 90)}
                className="border border-admin-border-strong rounded-lg px-2 py-1 text-sm bg-white"
              >
                <option value={7}>7일</option>
                <option value={30}>30일</option>
                <option value={90}>90일</option>
              </select>
            </label>
            <label className="text-sm text-admin-muted flex items-center gap-2">
              행 상한
              <select
                value={experimentMaxRows}
                onChange={e =>
                  setExperimentMaxRows(Number(e.target.value) as 5000 | 10000 | 20000 | 30000 | 50000)
                }
                className="border border-admin-border-strong rounded-lg px-2 py-1 text-sm bg-white"
              >
                <option value={5000}>5,000</option>
                <option value={10000}>10,000</option>
                <option value={20000}>20,000</option>
                <option value={30000}>30,000</option>
                <option value={50000}>50,000</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => void loadExperiments()}
              className="text-sm px-3 py-1 rounded-lg border border-admin-border-strong bg-white hover:bg-admin-bg"
            >
              새로고침
            </button>
            {experiments.maxRows != null && (
              <span className="text-xs text-admin-muted">행 상한 {experiments.maxRows.toLocaleString()}건 (페이지당 누적 조회)</span>
            )}
          </div>

          {experiments.message && (
            <p className="text-amber-700 text-sm bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{experiments.message}</p>
          )}
          {experiments.truncated?.crosssell && (
            <p className="text-amber-800 text-sm bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              크로스셀 원본 행이 상한에 도달했을 수 있습니다. 위 <strong>행 상한</strong>을 올려 새로고침하세요.
            </p>
          )}
          {experiments.truncated?.guidebook && (
            <p className="text-amber-800 text-sm bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              가이드북 이벤트가 상한에 도달했을 수 있습니다. <strong>행 상한</strong>을 늘려 보세요.
            </p>
          )}
          {(experiments.queryErrors?.crosssell || experiments.queryErrors?.guidebook) && (
            <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 space-y-1">
              {experiments.queryErrors.crosssell && <p>크로스셀 쿼리: {experiments.queryErrors.crosssell}</p>}
              {experiments.queryErrors.guidebook && <p>가이드북 쿼리: {experiments.queryErrors.guidebook}</p>}
            </div>
          )}

          <section>
            <h2 className="text-lg font-bold text-admin-text mb-1">패키지 크로스셀 A/B</h2>
            <p className="text-xs text-admin-muted mb-3">
              최근 {experiments.days}일 · <code className="text-[11px] bg-admin-surface-2 px-1 rounded">recommendation_outcomes</code> (
              <code className="text-[11px] bg-admin-surface-2 px-1 rounded">list_badge</code> · 노트에 crosssell 포함)
            </p>
            {experiments.crosssell ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="border border-admin-border-mid rounded-admin-md p-4 bg-white">
                    <p className="text-xs font-semibold text-admin-muted uppercase tracking-wide">노출 행 수</p>
                    <p className="mt-2 text-sm text-admin-text-2">
                      A: <strong>{experiments.crosssell.exposure.A}</strong>
                      {' · '}
                      B: <strong>{experiments.crosssell.exposure.B}</strong>
                      {experiments.crosssell.exposure.unknown > 0 && (
                        <> · 미분류: {experiments.crosssell.exposure.unknown}</>
                      )}
                    </p>
                  </div>
                  <div className="border border-admin-border-mid rounded-admin-md p-4 bg-white">
                    <p className="text-xs font-semibold text-admin-muted uppercase tracking-wide">클릭 행 수</p>
                    <p className="mt-2 text-sm text-admin-text-2">
                      A: <strong>{experiments.crosssell.clicks.A}</strong>
                      {' · '}
                      B: <strong>{experiments.crosssell.clicks.B}</strong>
                    </p>
                    <p className="mt-2 text-xs text-admin-muted">
                      대략 클릭/노출 비율: A{' '}
                      {experiments.crosssell.ctrPercent?.A != null
                        ? `${experiments.crosssell.ctrPercent.A}%`
                        : (experiments.crosssell.ctrApprox.A ?? '—')}
                      {' · '}B{' '}
                      {experiments.crosssell.ctrPercent?.B != null
                        ? `${experiments.crosssell.ctrPercent.B}%`
                        : (experiments.crosssell.ctrApprox.B ?? '—')}
                      <span className="block mt-1">(세션당 패키지 노출이 여러 건일 수 있어 참고 지표입니다.)</span>
                    </p>
                    <p className="mt-1 text-[11px] text-admin-muted-2">
                      샘플 행 {experiments.crosssell.rowCounts.exposuresAndClicks.toLocaleString()}건 · 노출 행 합계 {experiments.crosssell.rowCounts.exposureRowsApprox.toLocaleString()} · 클릭 행 {experiments.crosssell.rowCounts.clickRows.toLocaleString()}
                    </p>
                  </div>
                </div>
                {experiments.crosssell.bySession && (
                  <div className="border border-indigo-100 bg-indigo-50/50 rounded-admin-md p-4 mt-4">
                    <p className="text-xs font-semibold text-indigo-800 uppercase tracking-wide">세션 기준 (권장)</p>
                    <p className="text-[11px] text-indigo-700/90 mt-1 mb-3">
                      <code className="bg-white/80 px-1 rounded">session_id</code>가 있는 행만 집계합니다. 한 세션당 노출·클릭은 각각 한 번씩만 셉니다.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-admin-text-2">
                      <div>
                        <p className="text-xs text-admin-muted">노출 세션 수</p>
                        <p>
                          A <strong>{experiments.crosssell.bySession.exposureSessions.A}</strong>
                          {' · '}B <strong>{experiments.crosssell.bySession.exposureSessions.B}</strong>
                          {experiments.crosssell.bySession.exposureSessions.unknown > 0 && (
                            <> · 미분류 {experiments.crosssell.bySession.exposureSessions.unknown}</>
                          )}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-admin-muted">클릭 세션 수</p>
                        <p>
                          A <strong>{experiments.crosssell.bySession.clickSessions.A}</strong>
                          {' · '}B <strong>{experiments.crosssell.bySession.clickSessions.B}</strong>
                        </p>
                        <p className="mt-1 text-xs text-indigo-900">
                          세션 CTR: A{' '}
                          {experiments.crosssell.bySession.ctrPercentBySession.A != null
                            ? `${experiments.crosssell.bySession.ctrPercentBySession.A}%`
                            : '—'}
                          {' · '}B{' '}
                          {experiments.crosssell.bySession.ctrPercentBySession.B != null
                            ? `${experiments.crosssell.bySession.ctrPercentBySession.B}%`
                            : '—'}
                        </p>
                      </div>
                    </div>
                    {(experiments.crosssell.bySession.skippedRowsWithoutSessionId.exposure > 0 ||
                      experiments.crosssell.bySession.skippedRowsWithoutSessionId.click > 0) && (
                      <p className="mt-2 text-[11px] text-amber-800">
                        세션 ID 없는 행(행 수 기준만 포함): 노출 관련 {experiments.crosssell.bySession.skippedRowsWithoutSessionId.exposure} · 클릭 관련 {experiments.crosssell.bySession.skippedRowsWithoutSessionId.click}
                      </p>
                    )}
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-admin-muted">집계 불가</p>
            )}
          </section>

          <section>
            <h2 className="text-lg font-bold text-admin-text mb-1">가이드북 행동</h2>
            <p className="text-xs text-admin-muted mb-3">
              최근 {experiments.days}일 · <code className="text-[11px] bg-admin-surface-2 px-1 rounded">guidebook_events</code>
              {experiments.guidebook?.tableMissing && (
                <span className="ml-2 text-amber-700">(테이블 미적용 또는 조회 오류 — 마이그레이션 확인)</span>
              )}
            </p>
            {experiments.guidebook && !experiments.guidebook.tableMissing ? (
              <div className="border border-admin-border-mid rounded-admin-md p-4 bg-white">
                <p className="text-sm text-admin-text-2 mb-2">총 <strong>{experiments.guidebook.total}</strong>건</p>
                <ul className="text-sm text-admin-muted space-y-1">
                  {Object.entries(experiments.guidebook.byAction)
                    .sort((a, b) => b[1] - a[1])
                    .map(([action, n]) => (
                      <li key={action}><code className="text-xs bg-admin-bg px-1 rounded">{action}</code>: {n}</li>
                    ))}
                  {experiments.guidebook.total === 0 && <li className="text-admin-muted-2">아직 이벤트가 없습니다.</li>}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-admin-muted">집계 불가</p>
            )}
          </section>

          <section>
            <h2 className="text-lg font-bold text-admin-text mb-1">카카오 알림톡 환경</h2>
            <p className="text-xs text-admin-muted mb-3">템플릿 ID는 노출하지 않습니다. 변수 키는 코드 기준 점검용입니다.</p>
            <div className="border border-admin-border-mid rounded-admin-md overflow-hidden bg-white">
              <div className="px-4 py-3 bg-admin-bg text-sm border-b border-admin-border-mid">
                Solapi: {experiments.kakao.solapiReady ? <span className="text-green-700 font-medium">OK</span> : <span className="text-red-600">누락 {experiments.kakao.solapiMissing.join(', ')}</span>}
                {' · '}
                채널/발신: {experiments.kakao.channelReady ? <span className="text-green-700 font-medium">OK</span> : <span className="text-red-600">누락 {experiments.kakao.channelMissing.join(', ')}</span>}
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-admin-muted text-xs border-b border-admin-border">
                    <th className="px-4 py-2">환경변수</th>
                    <th className="px-4 py-2">설정</th>
                    <th className="px-4 py-2">코드 변수 키</th>
                    <th className="px-4 py-2">설명</th>
                  </tr>
                </thead>
                <tbody>
                  {experiments.kakao.templates.map(t => (
                    <tr key={t.envKey} className="border-b border-admin-border">
                      <td className="px-4 py-2 font-mono text-xs">{t.envKey}</td>
                      <td className="px-4 py-2">{t.templateIdSet ? <span className="text-green-700">있음</span> : <span className="text-admin-muted-2">없음</span>}</td>
                      <td className="px-4 py-2 text-xs text-admin-muted">{t.variableKeys.join(', ')}</td>
                      <td className="px-4 py-2 text-admin-muted">{t.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* ── 예약 내역 탭 ── */}
      {!loading && tab === 'reservations' && (
        <div>
          {reservations.length === 0 ? (
            <div className="text-center text-admin-muted-2 py-12">
              {error ? '' : 'MRT 예약 데이터가 없습니다. API Key 권한(RESERVATIONS:READ)을 확인하세요.'}
            </div>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-admin-border-mid text-left text-admin-muted text-xs">
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
                  <tr key={r.reservationNo} className="border-b border-admin-border hover:bg-admin-bg">
                    <td className="py-2 pr-4 font-mono text-xs">{r.reservationNo}</td>
                    <td className="py-2 pr-4 max-w-[180px] truncate" title={r.productTitle}>{r.productTitle}</td>
                    <td className="py-2 pr-4 text-xs text-admin-muted">{r.city}</td>
                    <td className="py-2 pr-4">{fmtDate(r.reservedAt)}</td>
                    <td className="py-2 pr-4 text-xs">{r.tripStartedAt ? `${fmtDate(r.tripStartedAt)}~${fmtDate(r.tripEndedAt ?? '')}` : '-'}</td>
                    <td className="py-2 pr-4">{fmt만(r.salePrice)}</td>
                    <td className="py-2 pr-4">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${r.status === 'confirmed' ? 'bg-green-100 text-green-700' : r.status === 'cancelled' ? 'bg-red-100 text-red-700' : 'bg-admin-surface-2 text-admin-muted'}`}>
                        {r.statusKor || r.status}
                      </span>
                    </td>
                    <td className="py-2 text-xs text-admin-muted">
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
        <div className="fixed inset-0 z-50 flex h-dvh items-center justify-center overflow-y-auto bg-black/50 px-4 py-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div
            ref={bookingModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={bookingModalTitleId}
            aria-describedby={`${bookingModalDescriptionId} ${bookingModalStatusId}`}
            tabIndex={-1}
            className="bg-white rounded-admin-lg shadow-2xl w-full max-w-md p-6"
          >
            <h3 id={bookingModalTitleId} className="text-lg font-bold mb-1">MRT 예약번호 기록</h3>
            <p id={bookingModalDescriptionId} className="text-sm text-admin-muted mb-4">
              {bookingModal.destination} · {fmtDate(bookingModal.date_from)}~{fmtDate(bookingModal.date_to)}
            </p>
            <p id={bookingModalStatusId} role="status" aria-live="polite" aria-atomic="true" className="sr-only">
              {saving ? 'MRT 예약번호를 저장하고 있습니다.' : 'MRT 예약번호를 입력하면 예약 완료로 기록됩니다.'}
            </p>

            <div className="space-y-3">
              <div>
                <label htmlFor="free-travel-mrt-ref" className="text-xs font-medium text-admin-muted">MRT 예약번호 *</label>
                <input
                  ref={bookingModalFirstInputRef}
                  id="free-travel-mrt-ref"
                  value={mrtRef}
                  onChange={e => setMrtRef(e.target.value)}
                  aria-describedby={bookingModalStatusId}
                  placeholder="예) MRT-2026-XXXXX"
                  className="mt-1 w-full border border-admin-border-strong rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label htmlFor="free-travel-booked-by" className="text-xs font-medium text-admin-muted">담당자</label>
                <input id="free-travel-booked-by" value={bookedBy} onChange={e => setBookedBy(e.target.value)}
                  placeholder="이름"
                  className="mt-1 w-full border border-admin-border-strong rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label htmlFor="free-travel-booking-notes" className="text-xs font-medium text-admin-muted">메모</label>
                <textarea id="free-travel-booking-notes" value={notes} onChange={e => setNotes(e.target.value)}
                  rows={2} placeholder="특이사항"
                  className="mt-1 w-full border border-admin-border-strong rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none" />
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <button type="button" onClick={closeBookingModal} disabled={saving} className="flex-1 border border-admin-border-strong rounded-lg py-2 text-sm hover:bg-admin-bg disabled:opacity-50">취소</button>
              <button type="button" onClick={handleBookManual} disabled={!mrtRef.trim() || saving} aria-busy={saving}
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
