'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  JOURNEY_STEPS,
  ALLOWED_TRANSITIONS,
  getStepIndex,
  getStatusLabel,
  getStatusBadgeClass,
  type BookingStatus,
} from '@/lib/booking-state-machine';
import type { MessageLog } from '@/lib/supabase';

// ─── 타입 ──────────────────────────────────────────────────────────────────
interface BookingDetail {
  id: string;
  booking_no?: string;
  package_title?: string;
  package_id?: string;
  lead_customer_id: string;
  adult_count: number;
  child_count: number;
  child_n_count?: number;
  child_e_count?: number;
  infant_count?: number;
  total_cost?: number;
  total_price?: number;
  paid_amount?: number;
  total_paid_out?: number;
  deposit_amount?: number;
  refund_amount?: number;
  penalty_fee?: number;
  cancel_reason?: string;
  cancelled_at?: string;
  status: string;
  departure_date?: string;
  return_date?: string;
  notes?: string;
  created_at: string;
  customers?: { id: string; name: string; phone?: string; passport_no?: string; birth_date?: string };
  // 파이프라인 확정 체크리스트
  is_ticketed?: boolean;
  is_manifest_sent?: boolean;
  is_guide_notified?: boolean;
  // 항공편
  flight_out?: string;
  flight_out_time?: string;
  flight_in?: string;
  flight_in_time?: string;
  // 현지경비
  local_expenses?: { currency?: string; adult?: number; child?: number; description?: string };
  single_charge?: number;
  // 승객 목록
  passengers?: { customer_id: string; name: string; phone?: string; passport_no?: string; birth_date?: string; passenger_type?: string }[];
}

// ─── 상수 ──────────────────────────────────────────────────────────────────
const LOG_TYPE_LABEL: Record<string, string> = {
  system:    '시스템',
  kakao:     '알림톡',
  mock:      'Mock',
  scheduler: '스케줄러',
  manual:    '관리자',
};

const LOG_TYPE_COLOR: Record<string, string> = {
  system:    'bg-blue-100 text-blue-600',
  kakao:     'bg-yellow-100 text-yellow-700',
  mock:      'bg-gray-100 text-gray-500',
  scheduler: 'bg-purple-100 text-purple-600',
  manual:    'bg-green-100 text-green-700',
};

const EVENT_ICON: Record<string, string> = {
  DEPOSIT_NOTICE:      '📋',
  DEPOSIT_CONFIRMED:   '💰',
  BALANCE_NOTICE:      '📨',
  BALANCE_CONFIRMED:   '✅',
  CONFIRMATION_GUIDE:  '✈️',
  HAPPY_CALL:          '😊',
  CANCELLATION:        '❌',
  MANUAL_MEMO:         '📝',
};

// ─── Progress Bar ──────────────────────────────────────────────────────────
function ProgressBar({ status }: { status: string }) {
  const currentStep = getStepIndex(status);
  const isCancelled = status === 'cancelled';

  if (isCancelled) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center gap-3">
          <span className="text-2xl">❌</span>
          <div>
            <p className="font-semibold text-red-600">예약 취소됨</p>
            <p className="text-xs text-gray-400 mt-0.5">이 예약은 취소 처리되었습니다.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <p className="text-xs font-medium text-gray-500 mb-4">예약 진행 상태</p>
      <div className="relative flex items-center justify-between">
        {/* 연결선 */}
        <div className="absolute top-4 left-0 right-0 h-0.5 bg-gray-200 z-0" />
        <div
          className="absolute top-4 left-0 h-0.5 bg-blue-500 z-0 transition-all duration-500"
          style={{ width: `${currentStep === 0 ? 0 : (currentStep / (JOURNEY_STEPS.length - 1)) * 100}%` }}
        />

        {JOURNEY_STEPS.map((step) => {
          const isDone    = step.step < currentStep;
          const isCurrent = step.step === currentStep;
          return (
            <div key={step.status} className="relative flex flex-col items-center z-10">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                isDone    ? 'bg-blue-500 text-white' :
                isCurrent ? 'bg-blue-600 text-white ring-4 ring-blue-100' :
                             'bg-white text-gray-400 border-2 border-gray-200'
              }`}>
                {isDone ? '✓' : step.step + 1}
              </div>
              <p className={`mt-2 text-xs text-center max-w-16 leading-tight ${
                isCurrent ? 'font-semibold text-blue-700' : isDone ? 'text-blue-500' : 'text-gray-400'
              }`}>
                {step.label}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────
export default function BookingJourneyPage({ params }: { params: { id: string } }) {
  const { id } = params;

  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [logs, setLogs]       = useState<MessageLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [transitioning, setTransitioning] = useState<string | null>(null);
  const [schedulerRunning, setSchedulerRunning] = useState(false);
  const [memo, setMemo]       = useState('');
  const [savingMemo, setSavingMemo] = useState(false);
  const [toast, setToast]     = useState<string | null>(null);

  // 취소 모달
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelForm, setCancelForm] = useState({ refund: '', penalty: '', reason: '' });
  const [cancelling, setCancelling] = useState(false);

  const timelineRef = useRef<HTMLDivElement>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const fetchBooking = useCallback(async () => {
    const res = await fetch(`/api/bookings?id=${id}`);
    if (res.ok) {
      const { booking: b } = await res.json();
      // booking_passengers → passengers 배열 변환
      if (b?.booking_passengers) {
        b.passengers = b.booking_passengers
          .map((bp: { customers?: { id: string; name: string; phone?: string; passport_no?: string; birth_date?: string }; passenger_type?: string }) => bp.customers ? {
            ...bp.customers,
            passenger_type: bp.passenger_type || 'adult',
          } : null)
          .filter(Boolean);
      }
      setBooking(b);
    }
  }, [id]);

  const fetchLogs = useCallback(async () => {
    const res = await fetch(`/api/bookings/${id}/timeline`);
    if (res.ok) {
      const { logs: l } = await res.json();
      setLogs(l ?? []);
    }
  }, [id]);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchBooking(), fetchLogs()]).finally(() => setLoading(false));
  }, [fetchBooking, fetchLogs]);

  // 타임라인 자동 스크롤
  useEffect(() => {
    if (timelineRef.current) {
      timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
    }
  }, [logs]);

  const handleTransition = async (to: string) => {
    setTransitioning(to);
    try {
      const res = await fetch(`/api/bookings/${id}/transition`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ to }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error ?? '전이 실패'); return; }
      await Promise.all([fetchBooking(), fetchLogs()]);
      showToast(`상태가 "${getStatusLabel(to)}"(으)로 변경되었습니다.`);
    } catch {
      showToast('네트워크 오류');
    } finally {
      setTransitioning(null);
    }
  };

  const handleAddMemo = async () => {
    if (!memo.trim()) return;
    setSavingMemo(true);
    try {
      const res = await fetch(`/api/bookings/${id}/timeline`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ content: memo }),
      });
      if (res.ok) {
        setMemo('');
        await fetchLogs();
        showToast('메모가 추가되었습니다.');
      }
    } finally {
      setSavingMemo(false);
    }
  };

  const handleRunScheduler = async () => {
    setSchedulerRunning(true);
    try {
      const res = await fetch('/api/cron/journey-scheduler?force=true');
      const data = await res.json();
      await fetchLogs();
      const { d15, d3, d_plus1 } = data.processed ?? {};
      showToast(`스케줄러 실행 완료 — D-15: ${d15}건 | D-3: ${d3}건 | D+1: ${d_plus1}건`);
    } catch {
      showToast('스케줄러 실행 실패');
    } finally {
      setSchedulerRunning(false);
    }
  };

  const handleCancel = async () => {
    setCancelling(true);
    try {
      const res = await fetch(`/api/bookings/${id}/cancel`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          refund_amount: Number(cancelForm.refund) || 0,
          penalty_fee:   Number(cancelForm.penalty) || 0,
          reason:        cancelForm.reason || '관리자 취소',
        }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error ?? '취소 실패'); return; }
      setShowCancelModal(false);
      await Promise.all([fetchBooking(), fetchLogs()]);
      showToast('예약이 취소 처리되었습니다.');
    } finally {
      setCancelling(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-gray-400">불러오는 중...</div>
    );
  }

  if (!booking) {
    return (
      <div className="p-8 text-center">
        <p className="text-gray-500">예약을 찾을 수 없습니다.</p>
        <Link href="/admin/bookings" className="mt-4 inline-block text-blue-600 text-sm hover:underline">← 목록으로</Link>
      </div>
    );
  }

  const transitions = ALLOWED_TRANSITIONS[booking.status] ?? [];
  const isCancelled = booking.status === 'cancelled';
  const balance       = (booking.total_price ?? 0) - (booking.paid_amount ?? 0);
  const agencyUnpaid  = (booking.total_cost ?? 0) - (booking.total_paid_out ?? 0);
  const custPct       = booking.total_price ? Math.min(100, Math.round(((booking.paid_amount ?? 0) / booking.total_price) * 100)) : 0;
  const agencyPct     = booking.total_cost  ? Math.min(100, Math.round(((booking.total_paid_out ?? 0) / booking.total_cost) * 100)) : 0;
  const depositLeft = (booking.deposit_amount ?? 0) > 0
    ? (booking.deposit_amount ?? 0) - Math.min(booking.paid_amount ?? 0, booking.deposit_amount ?? 0)
    : null;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-5">

      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/admin/bookings" className="text-sm text-gray-500 hover:text-gray-700">← 예약 목록</Link>
          <span className="text-gray-300">|</span>
          <span className="font-mono text-sm text-gray-500">{booking.booking_no || id.slice(0, 8)}</span>
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${getStatusBadgeClass(booking.status)}`}>
            {getStatusLabel(booking.status)}
          </span>
        </div>
        <Link
          href={`/admin/bookings/${id}/edit`}
          className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition"
        >
          편집 →
        </Link>
      </div>

      {/* Progress Bar */}
      <ProgressBar status={booking.status} />

      {/* 수배 확정 체크리스트 + 명단 */}
      {!isCancelled && (
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[13px] font-semibold text-slate-800">수배 체크리스트</h3>
            {booking.status === 'fully_paid' && !booking.is_manifest_sent && (
              <button
                onClick={async () => {
                  // 명단 생성 + 클립보드 복사
                  const lines = [
                    `[${booking.booking_no}] ${booking.package_title}`,
                    `출발: ${booking.departure_date || '-'}`,
                    booking.flight_out ? `항공: ${booking.flight_out} ${booking.flight_out_time || ''}` : '',
                    `인원: 성인 ${booking.adult_count}명${booking.child_count > 0 ? ` / 소아 ${booking.child_count}명` : ''}${(booking.infant_count ?? 0) > 0 ? ` / 유아 ${booking.infant_count}명` : ''}`,
                    '',
                    `대표: ${booking.customers?.name || '-'} ${booking.customers?.phone || ''}`,
                    booking.customers?.passport_no ? `여권: ${booking.customers.passport_no}` : '',
                    ...(booking.passengers || []).map((p, i) =>
                      `${i + 1}. ${p.name} (${p.passenger_type === 'adult' ? '성인' : p.passenger_type === 'child_n' ? '소아' : p.passenger_type === 'infant' ? '유아' : '성인'}) ${p.passport_no || ''}`
                    ),
                  ].filter(Boolean).join('\n');
                  try {
                    await navigator.clipboard.writeText(lines);
                    // 명단 전달 체크
                    await fetch(`/api/bookings`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ id: booking.id, is_manifest_sent: true }),
                    });
                    await fetchBooking();
                    showToast('명단이 클립보드에 복사되었습니다. 네이트온에 붙여넣기 하세요.');
                  } catch { showToast('복사 실패'); }
                }}
                className="px-3 py-1.5 bg-[#001f3f] text-white text-[12px] rounded hover:bg-blue-900 transition font-medium"
              >
                랜드사 명단 복사
              </button>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              {
                key: 'payment',
                label: '입금 완료',
                checked: booking.status === 'fully_paid' || booking.status === 'completed',
                auto: true,
              },
              {
                key: 'is_manifest_sent',
                label: '명단 전달',
                checked: booking.is_manifest_sent ?? false,
                auto: false,
              },
              {
                key: 'is_ticketed',
                label: '발권 확인',
                checked: booking.is_ticketed ?? false,
                auto: false,
              },
            ].map(item => (
              <div key={item.key} className={`flex items-center gap-2 p-2.5 rounded border ${
                item.checked ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200'
              }`}>
                {item.auto ? (
                  <div className={`w-4 h-4 rounded flex items-center justify-center text-[10px] ${
                    item.checked ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-400'
                  }`}>{item.checked ? '✓' : ''}</div>
                ) : (
                  <input
                    type="checkbox"
                    checked={item.checked}
                    onChange={async (e) => {
                      const val = e.target.checked;
                      await fetch(`/api/bookings`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: booking.id, [item.key]: val }),
                      });
                      await fetchBooking();
                      showToast(`${item.label} ${val ? '확인' : '해제'}`);
                    }}
                    className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                )}
                <span className={`text-[12px] font-medium ${item.checked ? 'text-emerald-700' : 'text-slate-500'}`}>
                  {item.label}
                </span>
                {item.auto && <span className="text-[10px] text-slate-400 ml-auto">자동</span>}
              </div>
            ))}
          </div>

          {/* 항공편 정보 */}
          {(booking.flight_out || booking.flight_in) && (
            <div className="mt-3 pt-3 border-t border-slate-100 flex gap-6">
              {booking.flight_out && (
                <div className="text-[12px]">
                  <span className="text-slate-400">출발</span>
                  <span className="ml-2 font-medium text-slate-700">{booking.flight_out} {booking.flight_out_time}</span>
                </div>
              )}
              {booking.flight_in && (
                <div className="text-[12px]">
                  <span className="text-slate-400">도착</span>
                  <span className="ml-2 font-medium text-slate-700">{booking.flight_in} {booking.flight_in_time}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 정보 카드 2열 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 고객 정보 */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-2">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">고객 정보</h3>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">대표 예약자</span>
            <span className="font-medium text-gray-900">{booking.customers?.name ?? '—'}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">연락처</span>
            <span className="text-gray-700">{booking.customers?.phone ?? '—'}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">상품</span>
            <span className="text-gray-700 text-right max-w-40 truncate">{booking.package_title ?? '—'}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">출발일</span>
            <span className="text-gray-700">{booking.departure_date ?? '—'}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">인원</span>
            <span className="text-gray-700">성인 {booking.adult_count}명 {booking.child_count > 0 ? `+ 소아 ${booking.child_count}명` : ''}</span>
          </div>
        </div>

        {/* 결제 요약 2패널 */}
        <div className="flex flex-col gap-3">
          {/* 고객 결제 */}
          <div className="bg-white rounded-xl border border-blue-100 p-4 space-y-2">
            <h3 className="text-xs font-bold text-blue-600 uppercase tracking-wide mb-2">💰 고객 결제 요약</h3>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">총 판매가</span>
              <span className="font-semibold text-gray-900">{(booking.total_price ?? 0).toLocaleString()}원</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">입금 완료액</span>
              <span className="text-blue-600 font-medium">{(booking.paid_amount ?? 0).toLocaleString()}원</span>
            </div>
            {balance > 0 && (
              <div className="flex justify-between text-sm border-t border-gray-100 pt-1">
                <span className="text-gray-600 font-medium">미수금 잔액</span>
                <span className="font-bold text-orange-600">{balance.toLocaleString()}원</span>
              </div>
            )}
            {balance <= 0 && (booking.total_price ?? 0) > 0 && (
              <div className="text-xs text-green-600 font-semibold text-right">✅ 완납</div>
            )}
            {depositLeft !== null && depositLeft > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">계약금 미납</span>
                <span className="text-red-500">{depositLeft.toLocaleString()}원</span>
              </div>
            )}
            {/* 수금 게이지 */}
            <div className="mt-2">
              <div className="flex justify-between text-xs text-gray-400 mb-1">
                <span>수금률</span><span className="font-medium text-blue-600">{custPct}%</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full transition-all duration-500"
                  style={{ width: `${custPct}%` }} />
              </div>
            </div>
          </div>

          {/* 랜드사 정산 */}
          <div className="bg-white rounded-xl border border-orange-100 p-4 space-y-2">
            <h3 className="text-xs font-bold text-orange-600 uppercase tracking-wide mb-2">🏢 랜드사 정산 요약</h3>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">총 원가</span>
              <span className="font-semibold text-gray-900">{(booking.total_cost ?? 0).toLocaleString()}원</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">송금 완료액</span>
              <span className="text-orange-600 font-medium">{(booking.total_paid_out ?? 0).toLocaleString()}원</span>
            </div>
            {agencyUnpaid > 0 && (
              <div className="flex justify-between text-sm border-t border-gray-100 pt-1">
                <span className="text-gray-600 font-medium">미지급 잔액</span>
                <span className="font-bold text-red-600">{agencyUnpaid.toLocaleString()}원</span>
              </div>
            )}
            {agencyUnpaid <= 0 && (booking.total_cost ?? 0) > 0 && (
              <div className="text-xs text-green-600 font-semibold text-right">✅ 송금 완료</div>
            )}
            {/* 송금 게이지 */}
            <div className="mt-2">
              <div className="flex justify-between text-xs text-gray-400 mb-1">
                <span>송금률</span><span className="font-medium text-orange-600">{agencyPct}%</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-orange-400 rounded-full transition-all duration-500"
                  style={{ width: `${agencyPct}%` }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Action 버튼 패널 */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-4">상태 제어</h3>
        <div className="flex flex-wrap gap-3">
          {/* 상태 전이 버튼 */}
          {transitions.map(t => (
            <button
              key={t.to}
              onClick={() => handleTransition(t.to)}
              disabled={transitioning !== null}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition disabled:opacity-50 ${
                t.isMock
                  ? 'bg-yellow-50 text-yellow-700 border border-yellow-200 hover:bg-yellow-100'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {transitioning === t.to ? '처리 중...' : t.label}
              {t.isMock && <span className="ml-1 text-xs">🧪</span>}
            </button>
          ))}

          {/* 스케줄러 강제 실행 */}
          <button
            onClick={handleRunScheduler}
            disabled={schedulerRunning}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100 transition disabled:opacity-50"
          >
            {schedulerRunning ? '실행 중...' : '스케줄러 강제 실행 🧪'}
          </button>

          {/* 예약 취소 */}
          {!isCancelled && (
            <button
              onClick={() => setShowCancelModal(true)}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition"
            >
              예약 취소 및 환불 처리
            </button>
          )}
        </div>

        {transitions.length === 0 && !isCancelled && (
          <p className="text-xs text-gray-400 mt-3">현재 상태에서 가능한 전이가 없습니다.</p>
        )}
      </div>

      {/* 고객 응대 타임라인 */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-4">고객 응대 타임라인</h3>

        <div ref={timelineRef} className="space-y-3 max-h-80 overflow-y-auto pr-1">
          {logs.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">아직 기록이 없습니다.</p>
          ) : (
            logs.map((log, idx) => (
              <div key={log.id} className="flex gap-3">
                {/* 타임라인 라인 */}
                <div className="flex flex-col items-center">
                  <div className="w-7 h-7 rounded-full bg-gray-50 border border-gray-200 flex items-center justify-center text-sm flex-shrink-0">
                    {EVENT_ICON[log.event_type] ?? '💬'}
                  </div>
                  {idx < logs.length - 1 && (
                    <div className="w-px flex-1 bg-gray-100 mt-1" />
                  )}
                </div>

                <div className="flex-1 pb-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-gray-800">{log.title}</span>
                    {log.is_mock && (
                      <span className="text-xs px-1.5 py-0.5 bg-yellow-50 text-yellow-600 rounded border border-yellow-200">Mock</span>
                    )}
                    <span className={`text-xs px-1.5 py-0.5 rounded ${LOG_TYPE_COLOR[log.log_type] ?? 'bg-gray-100 text-gray-500'}`}>
                      {LOG_TYPE_LABEL[log.log_type] ?? log.log_type}
                    </span>
                  </div>
                  {log.content && (
                    <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{log.content}</p>
                  )}
                  <p className="text-xs text-gray-300 mt-1">
                    {new Date(log.created_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    {' · '}{log.created_by}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>

        {/* 수동 메모 입력 */}
        <div className="mt-4 pt-4 border-t border-gray-100">
          <div className="flex gap-2">
            <input
              type="text"
              value={memo}
              onChange={e => setMemo(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddMemo(); } }}
              placeholder="수동 메모 입력 (엔터로 추가)"
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <button
              onClick={handleAddMemo}
              disabled={savingMemo || !memo.trim()}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition"
            >
              {savingMemo ? '...' : '추가'}
            </button>
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-sm px-5 py-3 rounded-xl shadow-lg z-50 animate-fade-in">
          {toast}
        </div>
      )}

      {/* 취소 모달 */}
      {showCancelModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-1">예약 취소 및 환불 처리</h2>
            <p className="text-sm text-gray-500 mb-5">
              취소 후 복구가 불가능합니다. 위약금/환불액을 정확히 입력하세요.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">환불액 (원)</label>
                <input
                  type="number"
                  min={0}
                  value={cancelForm.refund}
                  onChange={e => setCancelForm(f => ({ ...f, refund: e.target.value }))}
                  placeholder="0"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">위약금 (원)</label>
                <input
                  type="number"
                  min={0}
                  value={cancelForm.penalty}
                  onChange={e => setCancelForm(f => ({ ...f, penalty: e.target.value }))}
                  placeholder="0"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">취소 사유</label>
                <textarea
                  value={cancelForm.reason}
                  onChange={e => setCancelForm(f => ({ ...f, reason: e.target.value }))}
                  placeholder="예: 고객 단순 변심, 랜드사 취소, 항공 결항 등"
                  rows={2}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowCancelModal(false)}
                className="flex-1 border border-gray-200 text-sm text-gray-600 py-2.5 rounded-xl hover:bg-gray-50"
              >
                취소
              </button>
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="flex-1 bg-red-600 text-white text-sm py-2.5 rounded-xl hover:bg-red-700 disabled:opacity-50"
              >
                {cancelling ? '처리 중...' : '예약 취소 확정'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
