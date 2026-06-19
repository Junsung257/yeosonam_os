'use client';

/**
 * 여소남 OS — Inbox Zero 예약 액션 큐
 * ============================================================================
 * 철학:
 *   - 상태 나열이 아닌 "지금 처리해야 할 행동" 중심
 *   - 완료/보류 처리 시 카드가 즉시 시야에서 사라짐 (옵티미스틱 UI)
 *   - 조건 해소 시 시스템이 auto_resolve → 가짜 알람 청소 노동 제거
 *   - 카드 클릭 → BookingDrawer 로 맥락 유지 (페이지 이동 없음)
 *
 * 폴링:
 *   - 기본 30초 (B2B 대시보드에 적합, Supabase 연결수 절약)
 *   - 탭 비활성 시 자동 중단 (visibilitychange)
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import BookingDrawer from '@/components/BookingDrawer';
import { BookingTaskActionCard } from '@/components/admin/booking-ops/BookingTaskActionCard';
import { PageHeader } from '@/components/admin/patterns';
import Button from '@/components/ui/Button';
import { RefreshCw, Inbox as InboxIcon } from 'lucide-react';
import {
  PRIORITY_BADGE_CLASS,
  PRIORITY_LABEL,
  SNOOZE_PRESETS,
  snoozePresetIso,
  type InboxTaskRow,
  type TaskPriority,
} from '@/types/booking-tasks';
import { toBookingOpsAction } from '@/lib/booking-ops';

// ─── 타입 ────────────────────────────────────────────────────────────────────
interface HealthSummary {
  urgent_open: number;
  high_open: number;
  normal_open: number;
  low_open: number;
  total_open: number;
  snoozed_count: number;
  stale_over_48h: number;
  auto_resolved_last_24h: number;
  manually_resolved_last_24h: number;
  last_task_at: string | null;
}

interface BankHealth {
  unmatched_count: number;
  review_count: number;
  error_count: number;
  stale_over_24h: number;
}

interface InboxResponse {
  tasks: InboxTaskRow[];
  health: HealthSummary | null;
  bank_health: BankHealth | null;
}

const POLL_INTERVAL_MS = 30_000;
const LAZY_RUN_STALENESS_MS = 60 * 60 * 1000; // 1h — Hobby 일간 크론 보완
const LAZY_RUN_STORAGE_KEY = 'booking-tasks:lastRunAt';
const PRIORITY_TABS: Array<{ key: TaskPriority | 'all'; label: string }> = [
  { key: 'all', label: '전체' },
  { key: 0, label: '🔴 긴급' },
  { key: 1, label: '🟠 오늘' },
  { key: 2, label: '🟡 이번주' },
  { key: 3, label: '⚪ 낮음' },
];

// ─── 유틸 ────────────────────────────────────────────────────────────────────
function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  return `${day}일 전`;
}

function formatTaskType(t: string): string {
  const map: Record<string, string> = {
    unpaid_balance_d7: '잔금 미수',
    excess_payment: '초과지급',
    low_margin: '마진 경고',
    claim_keyword_reply: '클레임',
    doc_missing_d3: '확정서 누락',
    happy_call_followup: '해피콜 후속',
  };
  return map[t] ?? t;
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────
export default function InboxPage() {
  const searchParams = useSearchParams();
  const initialTypeFilter = searchParams?.get('type') ?? 'all';
  const [data, setData] = useState<InboxResponse>({ tasks: [], health: null, bank_health: null });
  const [loading, setLoading] = useState(true);
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<string | 'all'>(initialTypeFilter);
  const [drawerBookingId, setDrawerBookingId] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);
  const [snoozeMenuFor, setSnoozeMenuFor] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setTypeFilter(searchParams?.get('type') ?? 'all');
  }, [searchParams]);

  // ── Toast ───────────────────────────────────────────────────────────────────
  const showToast = useCallback((msg: string, type: 'ok' | 'err' = 'ok') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ msg, type });
    toastTimerRef.current = setTimeout(() => setToast(null), 2500);
  }, []);

  // ── Fetch ───────────────────────────────────────────────────────────────────
  const fetchInbox = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/booking-tasks?limit=200', { cache: 'no-store' });
      if (!res.ok) throw new Error(await res.text());
      const json = (await res.json()) as InboxResponse;
      setData(json);
    } catch (e) {
      console.warn('[inbox] fetch 실패', e);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Lazy Runner (Hobby 일간 크론 보완) ────────────────────────────────────
  // 페이지 진입 시 마지막 러너 실행 > 1시간 전이면 백그라운드로 조용히 1회 실행.
  // 운영자가 Inbox 를 열 때마다 최대 1시간 오래된 Task 는 자동 갱신되는 효과.
  const lazyRunRef = useRef(false);
  useEffect(() => {
    if (lazyRunRef.current) return;
    lazyRunRef.current = true;
    try {
      const last = Number(localStorage.getItem(LAZY_RUN_STORAGE_KEY) ?? '0');
      const staleMs = Date.now() - last;
      if (staleMs < LAZY_RUN_STALENESS_MS) return;
    } catch {
      // localStorage 접근 불가 (SSR/privacy mode) → 그냥 실행
    }
    (async () => {
      try {
        await fetch('/api/admin/booking-tasks/run-now', { method: 'POST' });
        localStorage.setItem(LAZY_RUN_STORAGE_KEY, String(Date.now()));
      } catch {
        // 조용히 실패 — 다음 페이지 진입에서 재시도
      }
    })();
  }, []);

  // ── 폴링 (탭 비활성 시 중단) ────────────────────────────────────────────────
  useEffect(() => {
    fetchInbox();
    const start = () => {
      if (pollingRef.current) return;
      pollingRef.current = setInterval(fetchInbox, POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      pollingRef.current = null;
    };
    start();
    const handler = () => (document.visibilityState === 'visible' ? (fetchInbox(), start()) : stop());
    document.addEventListener('visibilitychange', handler);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', handler);
    };
  }, [fetchInbox]);

  // ── 필터된 Task ────────────────────────────────────────────────────────────
  const filteredTasks = useMemo(() => {
    return data.tasks.filter(t => {
      if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false;
      if (typeFilter !== 'all' && t.task_type !== typeFilter) return false;
      return true;
    });
  }, [data.tasks, priorityFilter, typeFilter]);

  // 룰별 탭용 카운트
  const typeCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of data.tasks) m[t.task_type] = (m[t.task_type] ?? 0) + 1;
    return m;
  }, [data.tasks]);

  // ── Actions (옵티미스틱) ───────────────────────────────────────────────────
  const resolveTask = useCallback(async (taskId: string) => {
    setData(prev => ({ ...prev, tasks: prev.tasks.filter(t => t.id !== taskId) })); // 즉시 제거
    try {
      const res = await fetch(`/api/admin/booking-tasks/${taskId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution: 'manual' }),
      });
      if (!res.ok) throw new Error(await res.text());
      showToast('처리 완료', 'ok');
    } catch (e) {
      showToast(`완료 실패: ${e instanceof Error ? e.message : e}`, 'err');
      fetchInbox(); // 롤백 위해 재조회
    }
  }, [fetchInbox, showToast]);

  const snoozeTask = useCallback(async (taskId: string, hours: number) => {
    setData(prev => ({ ...prev, tasks: prev.tasks.filter(t => t.id !== taskId) }));
    setSnoozeMenuFor(null);
    try {
      const res = await fetch(`/api/admin/booking-tasks/${taskId}/snooze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snoozed_until: snoozePresetIso(hours) }),
      });
      if (!res.ok) throw new Error(await res.text());
      showToast(`⏰ ${hours < 24 ? hours + '시간' : Math.round(hours / 24) + '일'} 후 다시 알림`, 'ok');
    } catch (e) {
      showToast(`스누즈 실패: ${e instanceof Error ? e.message : e}`, 'err');
      fetchInbox();
    }
  }, [fetchInbox, showToast]);

  const runNow = useCallback(async () => {
    setRunning(true);
    try {
      const res = await fetch('/api/admin/booking-tasks/run-now', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'run 실패');
      const inserted = (json.rules ?? []).reduce((s: number, r: { inserted: number }) => s + r.inserted, 0);
      const autoResolved = (json.rules ?? []).reduce((s: number, r: { autoResolved: number }) => s + r.autoResolved, 0);
      showToast(`러너 완료 · 신규 ${inserted} · 자동종결 ${autoResolved}`, 'ok');
      try { localStorage.setItem(LAZY_RUN_STORAGE_KEY, String(Date.now())); } catch {}
      await fetchInbox();
    } catch (e) {
      showToast(`러너 실패: ${e instanceof Error ? e.message : e}`, 'err');
    } finally {
      setRunning(false);
    }
  }, [fetchInbox, showToast]);

  const openDrawer = useCallback((task: InboxTaskRow) => {
    setActiveTaskId(task.id);
    setDrawerBookingId(task.booking_id);
  }, []);

  // ── 렌더 ───────────────────────────────────────────────────────────────────
  const { health, bank_health } = data;

  return (
    <div>
      <PageHeader
        title="Inbox — 예약 액션 큐"
        subtitle="지금 처리해야 할 건만 · 30초마다 자동 갱신"
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={runNow}
            disabled={running}
            title="룰 러너 즉시 실행 (테스트/디버깅)"
          >
            <RefreshCw size={14} className={running ? 'animate-spin' : ''} />
            {running ? '실행 중…' : '지금 검사'}
          </Button>
        }
      />

      {/* 헬스 요약 칩 */}
      <div className="flex flex-wrap items-center gap-1.5 text-admin-xs mb-4">
        {health && (
          <>
            <span className="px-2 py-1 rounded-admin-xs bg-admin-surface-2 text-admin-text-2">
              총 <b className="text-admin-text admin-num">{health.total_open}</b>건
            </span>
            {health.urgent_open > 0 && (
              <span className="px-2 py-1 rounded-admin-xs bg-status-dangerBg text-status-dangerFg font-semibold">
                🔴 긴급 {health.urgent_open}
              </span>
            )}
            {health.stale_over_48h > 0 && (
              <span className="px-2 py-1 rounded-admin-xs bg-status-warningBg text-status-warningFg">
                ⏱️ 48h 경과 {health.stale_over_48h}
              </span>
            )}
            {health.snoozed_count > 0 && (
              <span className="px-2 py-1 rounded-admin-xs bg-status-infoBg text-status-infoFg">
                💤 스누즈 {health.snoozed_count}
              </span>
            )}
            <span className="px-2 py-1 rounded-admin-xs bg-status-successBg text-status-successFg">
              ✓ 24h 자동종결 {health.auto_resolved_last_24h}
            </span>
          </>
        )}
        {bank_health && bank_health.unmatched_count + bank_health.review_count > 0 && (
          <a
            href="/admin/payments"
            className="px-2 py-1 rounded-admin-xs bg-status-warningBg text-status-warningFg hover:opacity-80 transition-opacity"
            title="미매칭 입금 건수 (booking_tasks 와 별도)"
          >
            🏦 입금 매칭 대기 {bank_health.unmatched_count + bank_health.review_count}
          </a>
        )}
      </div>

      {/* 우선순위 탭 */}
      <div className="flex gap-1 mb-4 border-b border-admin-border-mid">
        {PRIORITY_TABS.map(tab => {
          const count = tab.key === 'all'
            ? data.tasks.length
            : data.tasks.filter(t => t.priority === tab.key).length;
          const active = priorityFilter === tab.key;
          return (
            <button
              key={String(tab.key)}
              onClick={() => setPriorityFilter(tab.key)}
              className={`px-3 py-2 text-admin-sm border-b-2 -mb-px transition-colors ${
                active
                  ? 'border-brand text-admin-text font-semibold'
                  : 'border-transparent text-admin-muted hover:text-admin-text-2'
              }`}
            >
              {tab.label} <span className="text-admin-xs text-admin-muted-2 admin-num">({count})</span>
            </button>
          );
        })}
      </div>

      {/* 본문 */}
      <main>
        {/* 룰 타입 필터 칩 */}
        {Object.keys(typeCounts).length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            <button
              onClick={() => setTypeFilter('all')}
              className={`px-2 py-1 text-admin-xs rounded-full transition-colors ${
                typeFilter === 'all'
                  ? 'bg-admin-text text-white'
                  : 'bg-admin-surface border border-admin-border-mid text-admin-muted hover:bg-admin-surface-2 hover:text-admin-text-2'
              }`}
            >
              모든 룰
            </button>
            {Object.entries(typeCounts).map(([type, n]) => (
              <button
                key={type}
                onClick={() => setTypeFilter(type)}
                className={`px-2 py-1 text-admin-xs rounded-full transition-colors ${
                  typeFilter === type
                    ? 'bg-admin-text text-white'
                    : 'bg-admin-surface border border-admin-border-mid text-admin-muted hover:bg-admin-surface-2 hover:text-admin-text-2'
                }`}
              >
                {formatTaskType(type)} <span className="admin-num">({n})</span>
              </button>
            ))}
          </div>
        )}

        {/* 카드 리스트 */}
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="admin-card p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="h-4 bg-admin-surface-2 rounded-full animate-pulse w-20" />
                  <div className="h-3.5 bg-admin-surface-2 rounded animate-pulse w-36" />
                </div>
                <div className="h-3 bg-admin-surface-2 rounded animate-pulse w-full" />
                <div className="h-3 bg-admin-surface-2 rounded animate-pulse w-3/4" />
              </div>
            ))}
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-12 h-12 rounded-full bg-admin-surface-2 flex items-center justify-center text-admin-muted mb-4">
              <InboxIcon size={20} strokeWidth={1.75} />
            </div>
            <h3 className="text-admin-base font-semibold text-admin-text">Inbox Zero 달성</h3>
            <p className="text-admin-sm text-admin-muted mt-1 max-w-sm">
              처리해야 할 건이 없습니다. 잠시 쉬었다 오세요.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredTasks.map(task => (
              <TaskCard
                key={task.id}
                task={task}
                active={activeTaskId === task.id}
                onOpen={() => openDrawer(task)}
                onResolve={() => resolveTask(task.id)}
                onSnooze={h => snoozeTask(task.id, h)}
                snoozeMenuOpen={snoozeMenuFor === task.id}
                onToggleSnoozeMenu={() =>
                  setSnoozeMenuFor(prev => (prev === task.id ? null : task.id))
                }
              />
            ))}
          </div>
        )}
      </main>

      {/* BookingDrawer (재사용) */}
      <BookingDrawer
        bookingId={drawerBookingId}
        onClose={() => {
          setDrawerBookingId(null);
          setActiveTaskId(null);
          fetchInbox(); // 드로어 내부 상태 변경 반영 (auto-resolve 트리거 가능)
        }}
      />

      {/* 토스트 */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 px-4 py-2 rounded-admin-sm shadow-admin-md text-admin-sm font-medium ${
            toast.type === 'ok'
              ? 'bg-success text-white'
              : 'bg-danger text-white'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ─── Task Card ───────────────────────────────────────────────────────────────
interface CardProps {
  task: InboxTaskRow;
  active: boolean;
  onOpen: () => void;
  onResolve: () => void;
  onSnooze: (hours: number) => void;
  snoozeMenuOpen: boolean;
  onToggleSnoozeMenu: () => void;
}

function TaskCard({
  task,
  active,
  onOpen,
  onResolve,
  onSnooze,
  snoozeMenuOpen,
  onToggleSnoozeMenu,
}: CardProps) {
  return (
    <BookingTaskActionCard
      action={toBookingOpsAction(task)}
      active={active}
      snoozeOpen={snoozeMenuOpen}
      onOpen={onOpen}
      onResolve={onResolve}
      onSnooze={(_, hours) => onSnooze(hours)}
      onToggleSnooze={onToggleSnoozeMenu}
    />
  );

  const ctx = task.context as Record<string, unknown>;
  const customerName = (ctx.customer_name as string) || task.customer_name || '—';
  const bookingNo = task.booking_no || (ctx.booking_no as string) || '—';
  const packageTitle = task.package_title || (ctx.package_title as string) || '—';

  return (
    <div
      className={`bg-admin-surface rounded-admin-sm border transition-all duration-160 cursor-pointer ${
        active
          ? 'border-brand shadow-admin-sm'
          : task.priority === 0
          ? 'border-danger/30 hover:border-danger/50'
          : 'border-admin-border-mid hover:border-admin-border-strong hover:shadow-admin-xs'
      }`}
    >
      <div
        className="p-4 flex items-start gap-4"
        role="button"
        tabIndex={0}
        aria-label={`업무 열기: ${task.title}`}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onOpen();
          }
        }}
      >
        {/* Priority pill */}
        <div className="pt-0.5">
          <span className={`inline-block px-2 py-0.5 text-[10px] rounded-admin-xs font-bold ${PRIORITY_BADGE_CLASS[task.priority]}`}>
            {PRIORITY_LABEL[task.priority]}
          </span>
        </div>

        {/* Body */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-admin-xs px-1.5 py-0.5 rounded-admin-xs bg-admin-surface-2 text-admin-muted">
              {formatTaskType(task.task_type)}
            </span>
            <span className="text-admin-xs text-admin-muted-2">{formatRelative(task.created_at)}</span>
          </div>
          <div className="font-medium text-admin-text mb-1 truncate">{task.title}</div>
          <div className="text-admin-xs text-admin-muted truncate">
            <b>{bookingNo}</b> · {customerName} · {packageTitle}
            {task.departure_date && (
              <span className="ml-1 text-admin-muted-2">(출발 {task.departure_date})</span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={(event) => {
              event.stopPropagation();
              onResolve();
            }}
            className="h-8 px-3 text-admin-sm rounded-admin-sm bg-success text-white hover:opacity-90 transition-opacity font-medium"
            title="이 Task 를 수동으로 종결합니다"
          >
            ✓ 완료
          </button>

          <div className="relative">
            <button
              onClick={(event) => {
                event.stopPropagation();
                onToggleSnoozeMenu();
              }}
              className="h-8 px-3 text-admin-sm rounded-admin-sm border border-admin-border-mid text-admin-text-2 hover:bg-admin-surface-2 hover:border-admin-border-strong transition-colors font-medium"
              title="나중에 다시 알림"
            >
              ⏰ 나중에
            </button>
            {snoozeMenuOpen && (
              <div className="absolute right-0 top-full mt-1 bg-admin-surface border border-admin-border-mid rounded-admin-sm shadow-admin-md z-20 min-w-[120px] overflow-hidden">
                {SNOOZE_PRESETS.map(preset => (
                  <button
                    key={preset.label}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSnooze(preset.hours);
                    }}
                    className="w-full text-left px-3 py-2 text-admin-sm text-admin-text-2 hover:bg-admin-surface-2 hover:text-admin-text transition-colors"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
