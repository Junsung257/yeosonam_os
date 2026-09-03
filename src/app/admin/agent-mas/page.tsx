'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bot,
  Clock,
  Database,
  GitBranch,
  LayoutDashboard,
  PauseCircle,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { fmtDateTime, fmtNum } from '@/lib/admin-utils';
import { EmptyState, PageHeader } from '@/components/admin/patterns';
import Button from '@/components/ui/Button';
import TechnologyScoutPilotPanel from '@/components/admin/TechnologyScoutPilotPanel';
import type {
  AgentOfficeRisk,
  AgentOfficeSnapshot,
  AgentOfficeTaskStatus,
  AgentOfficeWorkroom,
  AgentOfficeWorkroomStatus,
} from '@/lib/agent-office';

type Tab = 'office' | 'approvals' | 'tasks' | 'incidents';
type WorkroomFilter = 'all' | 'active' | 'stale';
type TaskFilter = 'all' | 'failed' | 'terminal';

const WORKROOM_STATUS_LABEL: Record<AgentOfficeWorkroomStatus, string> = {
  queued: '대기',
  running: '실행 중',
  blocked: '승인 대기',
  stale: '정체',
  failed: '실패',
  done: '완료',
  closed: '종료',
};

const WORKROOM_STATUS_CLASS: Record<AgentOfficeWorkroomStatus, string> = {
  queued: 'border-slate-200 bg-slate-50 text-slate-700',
  running: 'border-blue-200 bg-blue-50 text-blue-700',
  blocked: 'border-amber-200 bg-amber-50 text-amber-800',
  stale: 'border-orange-200 bg-orange-50 text-orange-800',
  failed: 'border-rose-200 bg-rose-50 text-rose-700',
  done: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  closed: 'border-slate-200 bg-slate-50 text-slate-500',
};

const TASK_STATUS_LABEL: Record<AgentOfficeTaskStatus, string> = {
  queued: '대기',
  running: '실행 중',
  frozen: '승인 대기',
  resumed: '재개',
  done: '완료',
  failed: '실패',
  expired: '만료',
  cancelled: '취소',
};

const RISK_LABEL: Record<AgentOfficeRisk, string> = {
  low: '낮음',
  medium: '보통',
  high: '높음',
  critical: '긴급',
};

const RISK_CLASS: Record<AgentOfficeRisk, string> = {
  low: 'text-slate-600',
  medium: 'text-blue-700',
  high: 'text-amber-700',
  critical: 'text-rose-700',
};

const TIMELINE_DOT: Record<string, string> = {
  neutral: 'bg-slate-400',
  info: 'bg-blue-500',
  warning: 'bg-amber-500',
  danger: 'bg-rose-500',
  success: 'bg-emerald-500',
};

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}…` : value;
}

function formatDuration(value: number | null): string {
  if (value == null) return '기록 없음';
  if (value < 1000) return `${fmtNum(value)}ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1)}초`;
  return `${(value / 60_000).toFixed(1)}분`;
}

function StatusBadge({ status }: { status: AgentOfficeWorkroomStatus }) {
  return (
    <span className={`inline-flex h-6 items-center rounded-admin-sm border px-2 text-[11px] font-semibold ${WORKROOM_STATUS_CLASS[status]}`}>
      {WORKROOM_STATUS_LABEL[status]}
    </span>
  );
}

function MetricButton({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'neutral',
  onClick,
}: {
  label: string;
  value: string;
  hint: string;
  icon: typeof Activity;
  tone?: 'neutral' | 'warning' | 'danger' | 'positive';
  onClick: () => void;
}) {
  const toneClass = {
    neutral: 'text-admin-text',
    warning: 'text-amber-700',
    danger: 'text-rose-700',
    positive: 'text-emerald-700',
  }[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-[116px] w-full rounded-admin-md border border-admin-border-mid bg-admin-surface p-4 text-left shadow-admin-xs transition-colors hover:border-admin-border-strong hover:bg-admin-surface-2 focus-visible:outline-none focus-visible:shadow-admin-focus"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-admin-xs font-medium text-admin-muted">{label}</span>
        <Icon size={15} className="text-admin-muted-2" aria-hidden="true" />
      </div>
      <p className={`mt-2 text-[26px] font-bold leading-none admin-num ${toneClass}`}>{value}</p>
      <p className="mt-2 text-admin-xs leading-snug text-admin-muted">{hint}</p>
    </button>
  );
}

function LoadingView() {
  return (
    <div className="space-y-4" aria-label="AI 운영실 로딩 중">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-[116px] animate-pulse rounded-admin-md bg-admin-surface-2" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="h-[420px] animate-pulse rounded-admin-md bg-admin-surface-2" />
        <div className="h-[420px] animate-pulse rounded-admin-md bg-admin-surface-2" />
      </div>
    </div>
  );
}

function WorkroomList({
  workrooms,
  selectedId,
  onSelect,
}: {
  workrooms: AgentOfficeWorkroom[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (workrooms.length === 0) {
    return (
      <EmptyState
        icon={GitBranch}
        title="표시할 작업실이 없습니다"
        description="자비스·QA·백그라운드 작업이 생성되면 correlation 단위로 여기에 묶입니다."
      />
    );
  }

  return (
    <div className="divide-y divide-admin-border">
      {workrooms.map((workroom) => {
        const selected = workroom.correlationId === selectedId;
        return (
          <button
            key={workroom.correlationId}
            type="button"
            onClick={() => onSelect(workroom.correlationId)}
            className={`w-full px-4 py-3 text-left transition-colors ${
              selected ? 'bg-blue-50/70' : 'hover:bg-admin-surface-2'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-admin-sm font-semibold text-admin-text">{workroom.title}</p>
                <p className="mt-1 truncate font-mono text-[10px] text-admin-muted-2">
                  {shortId(workroom.correlationId)}
                </p>
              </div>
              <StatusBadge status={workroom.status} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-admin-muted">
              <span>{workroom.progress.done}/{workroom.progress.total} 완료</span>
              <span>{workroom.roleLabels.length}개 역할</span>
              {workroom.pendingApprovals > 0 && (
                <span className="font-semibold text-amber-700">승인 {workroom.pendingApprovals}</span>
              )}
              {workroom.incidentCount > 0 && (
                <span className="font-semibold text-rose-700">사고 {workroom.incidentCount}</span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function WorkroomDetail({ workroom }: { workroom: AgentOfficeWorkroom | null }) {
  if (!workroom) {
    return (
      <EmptyState
        icon={Activity}
        title="작업실을 선택하세요"
        description="왼쪽 목록에서 실행 단위를 선택하면 역할, 진행률, 승인과 trace를 시간순으로 볼 수 있습니다."
      />
    );
  }

  const researchSignals = workroom.tasks.flatMap((task) => task.researchSignal
    ? [{ taskId: task.id, ...task.researchSignal }]
    : []);

  return (
    <div>
      <div className="border-b border-admin-border px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-admin-h3 text-admin-text">{workroom.title}</h2>
              <StatusBadge status={workroom.status} />
            </div>
            <p className="mt-1 font-mono text-[10px] text-admin-muted-2">{workroom.correlationId}</p>
          </div>
          <span className={`text-admin-xs font-semibold ${RISK_CLASS[workroom.risk]}`}>
            위험 {RISK_LABEL[workroom.risk]}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <p className="text-[10px] text-admin-muted-2">진행</p>
            <p className="mt-0.5 text-admin-sm font-semibold text-admin-text">
              {workroom.progress.done}/{workroom.progress.total}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-admin-muted-2">활성 작업</p>
            <p className="mt-0.5 text-admin-sm font-semibold text-admin-text">{workroom.progress.active}</p>
          </div>
          <div>
            <p className="text-[10px] text-admin-muted-2">승인 대기</p>
            <p className="mt-0.5 text-admin-sm font-semibold text-admin-text">{workroom.pendingApprovals}</p>
          </div>
          <div>
            <p className="text-[10px] text-admin-muted-2">최근 갱신</p>
            <p className="mt-0.5 text-admin-xs font-medium text-admin-text">{fmtDateTime(workroom.updatedAt)}</p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {workroom.roleLabels.map((label) => (
            <span
              key={label}
              className="rounded-admin-sm border border-admin-border-mid bg-admin-surface-2 px-2 py-1 text-[11px] text-admin-text-2"
            >
              {label}
            </span>
          ))}
        </div>
      </div>

      {researchSignals.length > 0 && (
        <section className="border-b border-admin-border bg-sky-50/40 px-5 py-4" aria-labelledby="research-evidence-heading">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 id="research-evidence-heading" className="text-admin-sm font-semibold text-admin-text">
                외부 조사 근거
              </h3>
              <p className="mt-0.5 text-[11px] text-admin-muted">
                조사 신호는 검토 대기 자료이며 공개·상품 사실 근거로 자동 전환되지 않습니다.
              </p>
            </div>
            <span className="rounded-admin-sm border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-800">
              검토 필요
            </span>
          </div>

          <div className="mt-3 space-y-3">
            {researchSignals.map((signal) => (
              <article key={signal.taskId} className="rounded-admin-md border border-sky-200 bg-white p-3 shadow-admin-xs">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-words text-admin-sm font-semibold text-admin-text">{signal.title}</p>
                    <p className="mt-1 text-[11px] text-admin-muted">
                      {signal.sourcePlatform} · {signal.sourceHostname} · 신뢰도 {Math.round(signal.confidence * 100)}%
                    </p>
                  </div>
                  <a
                    href={signal.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-[11px] font-semibold text-blue-700 hover:underline"
                  >
                    원문 열기
                  </a>
                </div>
                <p className="mt-2 break-words text-admin-xs leading-relaxed text-admin-text-2">{signal.excerpt}</p>
                <div className="mt-3 flex flex-wrap gap-1.5 text-[10px]">
                  <span className="rounded-admin-sm border border-admin-border-mid bg-admin-surface-2 px-2 py-1 text-admin-muted">
                    {signal.evidenceClass}
                  </span>
                  <span className="rounded-admin-sm border border-rose-200 bg-rose-50 px-2 py-1 font-semibold text-rose-700">
                    공개 불가
                  </span>
                  <span className="rounded-admin-sm border border-rose-200 bg-rose-50 px-2 py-1 font-semibold text-rose-700">
                    상품 사실 근거 불가
                  </span>
                  <span className="rounded-admin-sm border border-admin-border-mid bg-admin-surface-2 px-2 py-1 text-admin-muted">
                    {signal.collector}@{signal.collectorVersion}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <div className="px-5 py-4">
        <h3 className="text-admin-sm font-semibold text-admin-text">활동 타임라인</h3>
        {workroom.timeline.length === 0 ? (
          <p className="mt-3 text-admin-sm text-admin-muted">아직 기록된 활동이 없습니다.</p>
        ) : (
          <ol className="mt-3">
            {workroom.timeline.map((event, index) => (
              <li key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
                {index < workroom.timeline.length - 1 && (
                  <span className="absolute left-[5px] top-3 h-full w-px bg-admin-border" aria-hidden="true" />
                )}
                <span
                  className={`relative mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full ring-2 ring-white ${TIMELINE_DOT[event.tone]}`}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-admin-xs font-semibold text-admin-text-2">{event.label}</p>
                    <time className="text-[10px] text-admin-muted-2">{fmtDateTime(event.occurredAt)}</time>
                  </div>
                  <p className="mt-0.5 break-words text-admin-xs leading-relaxed text-admin-muted">{event.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

export default function AgentMasPage() {
  const [tab, setTab] = useState<Tab>('office');
  const [snapshot, setSnapshot] = useState<AgentOfficeSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approvalStatus, setApprovalStatus] = useState('pending');
  const [workroomFilter, setWorkroomFilter] = useState<WorkroomFilter>('all');
  const [taskFilter, setTaskFilter] = useState<TaskFilter>('all');

  const load = useCallback(async (background = false) => {
    if (background) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/agent/office', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'AI 운영실 데이터를 불러오지 못했습니다.');
      setSnapshot(data as AgentOfficeSnapshot);
      setSelectedId((current) => current ?? data.workrooms?.[0]?.correlationId ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'AI 운영실 데이터를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleWorkrooms = useMemo(() => {
    const workrooms = snapshot?.workrooms ?? [];
    if (workroomFilter === 'active') {
      return workrooms.filter((workroom) => ['queued', 'running', 'blocked'].includes(workroom.status));
    }
    if (workroomFilter === 'stale') {
      return workrooms.filter((workroom) => workroom.status === 'stale');
    }
    return workrooms;
  }, [snapshot, workroomFilter]);

  const selectedWorkroom = useMemo(
    () => visibleWorkrooms.find((workroom) => workroom.correlationId === selectedId)
      ?? visibleWorkrooms[0]
      ?? null,
    [selectedId, visibleWorkrooms],
  );

  const allTasks = useMemo(
    () => (snapshot?.workrooms ?? []).flatMap((workroom) =>
      workroom.tasks.map((task) => ({ ...task, correlationId: workroom.correlationId, workroomTitle: workroom.title }))),
    [snapshot],
  );

  const visibleTasks = useMemo(() => {
    if (taskFilter === 'failed') return allTasks.filter((task) => task.status === 'failed');
    if (taskFilter === 'terminal') return allTasks.filter((task) => ['done', 'failed'].includes(task.status));
    return allTasks;
  }, [allTasks, taskFilter]);

  const visibleApprovals = useMemo(
    () => (snapshot?.approvals ?? []).filter((approval) => !approvalStatus || approval.status === approvalStatus),
    [approvalStatus, snapshot],
  );

  const showActiveWorkrooms = () => {
    setTab('office');
    setWorkroomFilter('active');
  };

  const showPendingApprovals = () => {
    setTab('approvals');
    setApprovalStatus('pending');
  };

  const showStaleWorkrooms = () => {
    setTab('office');
    setWorkroomFilter('stale');
  };

  const showFailedTasks = () => {
    setTab('tasks');
    setTaskFilter('failed');
  };

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="AI 운영실"
        subtitle="실행은 백엔드에서, 협업 기록은 correlation 타임라인으로 관리합니다. 안전한 재개 경로가 연결되기 전에는 승인 결정을 잠급니다."
        badge={(
          <span className="rounded-admin-sm border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">
            관찰 전용 V1
          </span>
        )}
        actions={(
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void load(true)}
            loading={refreshing}
          >
            <RefreshCw size={14} aria-hidden="true" />
            새로고침
          </Button>
        )}
      />

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-admin-md border border-rose-200 bg-rose-50 px-3 py-2 text-admin-sm text-rose-700">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <LoadingView />
      ) : !snapshot ? (
        <EmptyState
          icon={AlertTriangle}
          title="AI 운영실을 열 수 없습니다"
          description="새로고침 후에도 계속되면 에이전트 원장과 관리자 인증 상태를 확인하세요."
          action={(
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              <RefreshCw size={14} aria-hidden="true" />
              다시 확인
            </Button>
          )}
        />
      ) : (
        <>
          {snapshot.freshness.isStale && (
            <div className="mb-4 flex items-start gap-2 rounded-admin-md border border-orange-200 bg-orange-50 px-4 py-3">
              <Clock size={15} className="mt-0.5 shrink-0 text-orange-700" aria-hidden="true" />
              <div>
                <p className="text-admin-xs font-semibold text-orange-900">운영 원장 갱신이 정체됐습니다</p>
                <p className="mt-0.5 text-[11px] text-orange-800">
                  {snapshot.freshness.latestTaskUpdatedAt
                    ? `마지막 작업 갱신은 약 ${fmtNum(Math.round(snapshot.freshness.latestTaskAgeHours ?? 0))}시간 전입니다.`
                    : '작업 갱신 기록이 없습니다.'}
                  {' '}이 화면의 상태를 현재 실행 상태로 간주하지 마세요.
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricButton
              label="활성 작업실"
              value={fmtNum(snapshot.metrics.activeWorkrooms)}
              hint="대기·실행·승인 대기 상태"
              icon={Activity}
              tone={snapshot.metrics.activeWorkrooms > 0 ? 'neutral' : 'positive'}
              onClick={showActiveWorkrooms}
            />
            <MetricButton
              label="승인 대기"
              value={fmtNum(snapshot.metrics.pendingApprovals)}
              hint={`기한 경과 ${fmtNum(snapshot.metrics.overdueApprovals)}건 · 관찰 전용`}
              icon={PauseCircle}
              tone={snapshot.metrics.pendingApprovals > 0 ? 'warning' : 'positive'}
              onClick={showPendingApprovals}
            />
            <MetricButton
              label="정체 작업실"
              value={fmtNum(snapshot.metrics.staleWorkrooms)}
              hint="24시간 넘게 갱신되지 않은 활성 작업"
              icon={Clock}
              tone={snapshot.metrics.staleWorkrooms > 0 ? 'danger' : 'positive'}
              onClick={showStaleWorkrooms}
            />
            <MetricButton
              label="24시간 실패"
              value={fmtNum(snapshot.metrics.failedTasks24h)}
              hint={`7일 완료율 ${snapshot.metrics.completionRate7d == null ? '산정 불가' : `${snapshot.metrics.completionRate7d}%`}`}
              icon={XCircle}
              tone={snapshot.metrics.failedTasks24h > 0 ? 'danger' : 'positive'}
              onClick={showFailedTasks}
            />
          </div>

          <section className="mt-4 border-y border-admin-border-mid bg-admin-surface px-4 py-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="flex items-start gap-2">
                <Database size={15} className="mt-0.5 shrink-0 text-blue-600" aria-hidden="true" />
                <div>
                  <p className="text-admin-xs font-semibold text-admin-text-2">백엔드 실행</p>
                  <p className="mt-0.5 text-[11px] text-admin-muted">durable workflow가 실제 작업 담당</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <GitBranch size={15} className="mt-0.5 shrink-0 text-slate-600" aria-hidden="true" />
                <div>
                  <p className="text-admin-xs font-semibold text-admin-text-2">증거 스레드</p>
                  <p className="mt-0.5 text-[11px] text-admin-muted">잡담 대신 correlation 활동 원장</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <LayoutDashboard size={15} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
                <div>
                  <p className="text-admin-xs font-semibold text-admin-text-2">사람 관제</p>
                  <p className="mt-0.5 text-[11px] text-admin-muted">진행·실패·승인을 한 화면에서 확인</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <ShieldCheck size={15} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
                <div>
                  <p className="text-admin-xs font-semibold text-admin-text-2">변경 경계</p>
                  <p className="mt-0.5 text-[11px] text-admin-muted">재개 런타임 연결 전에는 관찰만 허용</p>
                </div>
              </div>
            </div>
          </section>

          {snapshot.sourceIssues.length > 0 && (
            <div className="mt-4 rounded-admin-md border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-admin-xs font-semibold text-amber-800">부분 집계 상태</p>
              {snapshot.sourceIssues.map((issue) => (
                <p key={issue} className="mt-1 text-[11px] text-amber-700">{issue}</p>
              ))}
            </div>
          )}

          <TechnologyScoutPilotPanel />

          <div className="mt-5 flex flex-wrap items-center gap-1 border-b border-admin-border-mid">
            {([
              ['office', '작업실', LayoutDashboard],
              ['approvals', '승인', ShieldCheck],
              ['tasks', '작업', Bot],
              ['incidents', '사고', AlertTriangle],
            ] as const).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                onClick={() => setTab(value)}
                className={`inline-flex h-10 items-center gap-1.5 border-b-2 px-3 text-admin-sm font-medium transition-colors ${
                  tab === value
                    ? 'border-blue-600 text-blue-700'
                    : 'border-transparent text-admin-muted hover:text-admin-text'
                }`}
              >
                <Icon size={14} aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>

          {tab === 'office' && (
            <div className="mt-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setWorkroomFilter('all')}
                    className={`h-8 rounded-admin-sm border px-3 text-admin-xs font-medium ${
                      workroomFilter === 'all'
                        ? 'border-blue-600 bg-blue-50 text-blue-700'
                        : 'border-admin-border-mid bg-admin-surface text-admin-muted'
                    }`}
                  >
                    전체
                  </button>
                  <button
                    type="button"
                    onClick={() => setWorkroomFilter('active')}
                    className={`h-8 rounded-admin-sm border px-3 text-admin-xs font-medium ${
                      workroomFilter === 'active'
                        ? 'border-blue-600 bg-blue-50 text-blue-700'
                        : 'border-admin-border-mid bg-admin-surface text-admin-muted'
                    }`}
                  >
                    활성
                  </button>
                  <button
                    type="button"
                    onClick={() => setWorkroomFilter('stale')}
                    className={`h-8 rounded-admin-sm border px-3 text-admin-xs font-medium ${
                      workroomFilter === 'stale'
                        ? 'border-orange-600 bg-orange-50 text-orange-800'
                        : 'border-admin-border-mid bg-admin-surface text-admin-muted'
                    }`}
                  >
                    정체
                  </button>
                </div>
                <p className="text-admin-xs text-admin-muted">
                  실제 복수 역할 작업실 {snapshot.metrics.multiAgentWorkrooms7d}개 · trace P95 {formatDuration(snapshot.metrics.p95TraceDurationMs)}
                </p>
              </div>

              <div className="grid grid-cols-1 overflow-hidden rounded-admin-md border border-admin-border-mid bg-admin-surface shadow-admin-xs lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
                <div className="max-h-[680px] overflow-y-auto border-b border-admin-border lg:border-b-0 lg:border-r">
                  <WorkroomList
                    workrooms={visibleWorkrooms}
                    selectedId={selectedWorkroom?.correlationId ?? null}
                    onSelect={setSelectedId}
                  />
                </div>
                <div className="min-h-[420px] max-h-[680px] overflow-y-auto">
                  <WorkroomDetail workroom={selectedWorkroom} />
                </div>
              </div>
            </div>
          )}

          {tab === 'approvals' && (
            <section className="mt-4 overflow-hidden rounded-admin-md border border-admin-border-mid bg-admin-surface shadow-admin-xs">
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-admin-border px-4 py-3">
                <div>
                  <h2 className="text-admin-sm font-semibold text-admin-text">승인 큐</h2>
                  <p className="mt-0.5 text-[11px] text-admin-muted">
                    현재는 관찰 전용입니다. 안전한 실행 재개 경로가 연결된 뒤 처리 기능을 엽니다.
                  </p>
                </div>
                <select
                  value={approvalStatus}
                  onChange={(event) => setApprovalStatus(event.target.value)}
                  className="h-8 rounded-admin-sm border border-admin-border-mid bg-white px-2 text-admin-xs text-admin-text"
                >
                  <option value="">전체 상태</option>
                  <option value="pending">대기</option>
                  <option value="approved">승인</option>
                  <option value="rejected">반려</option>
                  <option value="expired">만료</option>
                  <option value="cancelled">취소</option>
                </select>
              </header>

              {visibleApprovals.length === 0 ? (
                <EmptyState
                  icon={ShieldCheck}
                  title="해당 승인 요청이 없습니다"
                  description="고위험 작업이 멈추면 승인 패킷이 이 목록에 나타납니다."
                />
              ) : (
                <div className="divide-y divide-admin-border">
                  {visibleApprovals.map((approval) => (
                    <div key={approval.id} className="px-4 py-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-admin-xs font-semibold text-admin-text-2">
                              {approval.status}
                            </span>
                            {approval.isOverdue && (
                              <span className="rounded-admin-sm border border-orange-200 bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold text-orange-800">
                                기한 경과
                              </span>
                            )}
                            <span className="text-[11px] text-admin-muted">{fmtDateTime(approval.requested_at)}</span>
                            <span className="font-mono text-[10px] text-admin-muted-2">
                              task {shortId(approval.task_id)}
                            </span>
                          </div>
                          <p className="mt-2 break-words text-admin-sm text-admin-text-2">
                            {'safeReason' in approval && approval.safeReason
                              ? String(approval.safeReason)
                              : '승인 사유가 기록되지 않았습니다.'}
                          </p>
                          {approval.reviewed_by && (
                            <p className="mt-1 text-[11px] text-admin-muted">
                              검토 {approval.reviewed_by} · {fmtDateTime(approval.reviewed_at)}
                            </p>
                          )}
                        </div>
                        {approval.status === 'pending' && (
                          <span className="shrink-0 rounded-admin-sm border border-admin-border-mid bg-admin-surface-2 px-2 py-1 text-[10px] font-semibold text-admin-muted">
                            처리 잠금
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {tab === 'tasks' && (
            <section className="mt-4 overflow-hidden rounded-admin-md border border-admin-border-mid bg-admin-surface shadow-admin-xs">
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-admin-border px-4 py-3">
                <div>
                  <h2 className="text-admin-sm font-semibold text-admin-text">작업 원장</h2>
                  <p className="mt-0.5 text-[11px] text-admin-muted">payload 대신 역할·상태·재시도·오류만 표시합니다.</p>
                </div>
                <select
                  value={taskFilter}
                  onChange={(event) => setTaskFilter(event.target.value as TaskFilter)}
                  className="h-8 rounded-admin-sm border border-admin-border-mid bg-white px-2 text-admin-xs text-admin-text"
                >
                  <option value="all">전체 작업</option>
                  <option value="failed">실패 작업</option>
                  <option value="terminal">완료·실패</option>
                </select>
              </header>

              {visibleTasks.length === 0 ? (
                <EmptyState
                  icon={Bot}
                  title="해당 작업이 없습니다"
                  description="필터를 바꾸거나 새로운 에이전트 실행 기록을 기다리세요."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-[880px] w-full text-left">
                    <thead className="bg-admin-surface-2 text-[11px] text-admin-muted">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">작업실</th>
                        <th className="px-4 py-2.5 font-medium">역할</th>
                        <th className="px-4 py-2.5 font-medium">상태</th>
                        <th className="px-4 py-2.5 font-medium">위험</th>
                        <th className="px-4 py-2.5 font-medium">재시도</th>
                        <th className="px-4 py-2.5 font-medium">최근 갱신</th>
                        <th className="px-4 py-2.5 font-medium">오류</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-admin-border text-admin-xs">
                      {visibleTasks.map((task) => (
                        <tr key={task.id} className="hover:bg-admin-surface-2">
                          <td className="max-w-[240px] px-4 py-3">
                            <p className="truncate font-medium text-admin-text">{task.workroomTitle}</p>
                            <p className="mt-0.5 font-mono text-[10px] text-admin-muted-2">{shortId(task.correlationId)}</p>
                          </td>
                          <td className="px-4 py-3 text-admin-text-2">{task.roleLabel}</td>
                          <td className="px-4 py-3 font-medium text-admin-text-2">{TASK_STATUS_LABEL[task.status]}</td>
                          <td className={`px-4 py-3 font-semibold ${RISK_CLASS[task.risk]}`}>{RISK_LABEL[task.risk]}</td>
                          <td className="px-4 py-3 admin-num text-admin-muted">{task.retryCount}/{task.maxRetries}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-admin-muted">{fmtDateTime(task.updatedAt)}</td>
                          <td className="max-w-[280px] px-4 py-3">
                            <p className="truncate text-rose-700">{task.lastError ?? '—'}</p>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {tab === 'incidents' && (
            <section className="mt-4 overflow-hidden rounded-admin-md border border-admin-border-mid bg-admin-surface shadow-admin-xs">
              <header className="border-b border-admin-border px-4 py-3">
                <h2 className="text-admin-sm font-semibold text-admin-text">사고 원장</h2>
                <p className="mt-0.5 text-[11px] text-admin-muted">정책 위반, 도구 검증, 시간 초과, 수동 이관 기록입니다.</p>
              </header>
              {snapshot.incidents.length === 0 ? (
                <EmptyState
                  icon={ShieldCheck}
                  title="기록된 사고가 없습니다"
                  description="사고가 발생하면 심각도와 탐지 주체를 포함해 이 목록에 표시됩니다."
                />
              ) : (
                <div className="divide-y divide-admin-border">
                  {snapshot.incidents.map((incident) => (
                    <div key={incident.id} className="flex items-start gap-3 px-4 py-3">
                      <AlertTriangle
                        size={15}
                        className={`mt-0.5 shrink-0 ${
                          ['critical', 'error'].includes(incident.severity) ? 'text-rose-600' : 'text-amber-600'
                        }`}
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-admin-xs font-semibold text-admin-text-2">
                            {incident.severity}
                          </span>
                          <span className="font-mono text-[11px] text-admin-muted">{incident.category}</span>
                          <span className="text-[10px] text-admin-muted-2">{fmtDateTime(incident.created_at)}</span>
                        </div>
                        <p className="mt-1 break-words text-admin-sm text-admin-text-2">{incident.safeMessage}</p>
                        <p className="mt-1 text-[10px] text-admin-muted-2">탐지 {incident.detected_by}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          <footer className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-admin-border pt-3 text-[10px] text-admin-muted-2">
            <span>
              원장 표본: 작업 {snapshot.sourceCounts.tasks} · 승인 {snapshot.sourceCounts.approvals} · 사고 {snapshot.sourceCounts.incidents} · trace {snapshot.sourceCounts.traces}
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock size={11} aria-hidden="true" />
              생성 {fmtDateTime(snapshot.generatedAt)}
            </span>
          </footer>
        </>
      )}
    </div>
  );
}
