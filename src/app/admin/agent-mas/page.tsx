'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fmtDateTime } from '@/lib/admin-utils';
import { PageHeader } from '@/components/admin/patterns';
import Button from '@/components/ui/Button';
import { RefreshCw } from 'lucide-react';

type Tab = 'tasks' | 'approvals' | 'incidents';

type AgentTaskRow = {
  id: string;
  correlation_id: string;
  session_id: string | null;
  tenant_id: string | null;
  source: string;
  agent_type: string;
  specialist_id: string | null;
  performative: string;
  risk_level: string;
  status: string;
  retry_count: number;
  max_retries: number;
  last_error: string | null;
  created_by: string;
  assigned_to: string | null;
  approved_by: string | null;
  started_at: string | null;
  completed_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  task_context: Record<string, unknown>;
};

type AgentApprovalRow = {
  id: string;
  task_id: string;
  action_id: string | null;
  status: string;
  reason: string | null;
  requested_by: string;
  reviewed_by: string | null;
  requested_at: string;
  reviewed_at: string | null;
  expires_at: string | null;
  metadata: Record<string, unknown>;
};

type AgentIncidentRow = {
  id: string;
  correlation_id: string | null;
  task_id: string | null;
  session_id: string | null;
  tenant_id: string | null;
  severity: string;
  category: string;
  message: string;
  details: Record<string, unknown>;
  detected_by: string;
  created_at: string;
};

export default function AgentMasPage() {
  const [tab, setTab] = useState<Tab>('approvals');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tasks, setTasks] = useState<AgentTaskRow[]>([]);
  const [tasksTotal, setTasksTotal] = useState(0);
  const [taskStatus, setTaskStatus] = useState('');

  const [approvals, setApprovals] = useState<AgentApprovalRow[]>([]);
  const [approvalsTotal, setApprovalsTotal] = useState(0);
  const [approvalStatus, setApprovalStatus] = useState('pending');

  const [incidents, setIncidents] = useState<AgentIncidentRow[]>([]);
  const [incidentsTotal, setIncidentsTotal] = useState(0);
  const [incidentSeverity, setIncidentSeverity] = useState('');
  const [approvalActionTarget, setApprovalActionTarget] = useState<{
    approval: AgentApprovalRow;
    action: 'approve' | 'reject';
  } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const approvalDialogRef = useRef<HTMLDivElement | null>(null);
  const approvalCancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const rejectReasonRef = useRef<HTMLTextAreaElement | null>(null);
  const approvalActionTitleId = 'agent-approval-action-title';
  const approvalActionDescriptionId = 'agent-approval-action-description';

  const loadTasks = useCallback(async () => {
    const q = new URLSearchParams({ limit: '40', offset: '0' });
    if (taskStatus) q.set('status', taskStatus);
    const res = await fetch(`/api/admin/agent/tasks?${q}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'tasks 로드 실패');
    setTasks(json.tasks ?? []);
    setTasksTotal(json.total ?? 0);
  }, [taskStatus]);

  const loadApprovals = useCallback(async () => {
    const q = new URLSearchParams({ limit: '40', offset: '0' });
    if (approvalStatus) q.set('status', approvalStatus);
    const res = await fetch(`/api/admin/agent/approvals?${q}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'approvals 로드 실패');
    setApprovals(json.approvals ?? []);
    setApprovalsTotal(json.total ?? 0);
  }, [approvalStatus]);

  const loadIncidents = useCallback(async () => {
    const q = new URLSearchParams({ limit: '40', offset: '0' });
    if (incidentSeverity) q.set('severity', incidentSeverity);
    const res = await fetch(`/api/admin/agent/incidents?${q}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'incidents 로드 실패');
    setIncidents(json.incidents ?? []);
    setIncidentsTotal(json.total ?? 0);
  }, [incidentSeverity]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (tab === 'tasks') await loadTasks();
      if (tab === 'approvals') await loadApprovals();
      if (tab === 'incidents') await loadIncidents();
    } catch (e) {
      setError(e instanceof Error ? e.message : '로드 실패');
    } finally {
      setLoading(false);
    }
  }, [tab, loadTasks, loadApprovals, loadIncidents]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!approvalActionTarget) return undefined;

    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (approvalActionTarget.action === 'reject') {
      rejectReasonRef.current?.focus();
    } else {
      approvalCancelButtonRef.current?.focus();
    }

    const getFocusableElements = () => Array.from(
      approvalDialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    ).filter(element => !element.hasAttribute('disabled') && !element.getAttribute('aria-hidden'));

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setApprovalActionTarget(null);
        setRejectReason('');
        return;
      }
      if (event.key !== 'Tab') return;

      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) {
        event.preventDefault();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousActiveElement?.focus();
    };
  }, [approvalActionTarget]);

  const openApprovalAction = (approval: AgentApprovalRow, action: 'approve' | 'reject') => {
    setRejectReason('');
    setApprovalActionTarget({ approval, action });
  };

  const actOnApproval = async (id: string, action: 'approve' | 'reject', reason?: string) => {
    const res = await fetch(`/api/agent/approvals/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, reason }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error || '처리 실패');
      return;
    }
    setApprovalActionTarget(null);
    setRejectReason('');
    setError(null);
    await refresh();
  };

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="MAS 관제"
        subtitle={
          <>고객 QA·자비스에서 생성된 <strong className="text-admin-text">작업(agent_tasks)</strong>, <strong className="text-admin-text">승인(agent_approvals)</strong>, <strong className="text-admin-text">사고(agent_incidents)</strong>를 한 화면에서 확인합니다. 승인은 고위험 요청이 freeze 된 뒤에만 쌓입니다.</>
        }
      />
      {error && (
        <p className="text-danger text-admin-sm mb-4 bg-danger-light border border-danger/20 rounded-admin-sm px-3 py-2">{error}</p>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {(['approvals', 'tasks', 'incidents'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`h-9 px-3.5 text-admin-sm rounded-admin-sm font-medium transition-colors ${
              tab === t
                ? 'bg-brand text-white'
                : 'bg-admin-surface border border-admin-border-mid text-admin-text-2 hover:bg-admin-surface-2 hover:border-admin-border-strong'
            }`}
          >
            {t === 'approvals' ? '승인 큐' : t === 'tasks' ? '작업' : '사고'}
          </button>
        ))}
        <Button variant="secondary" size="sm" onClick={() => refresh()} className="ml-auto">
          <RefreshCw size={14} />
          새로고침
        </Button>
      </div>

      {tab === 'approvals' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <select
              value={approvalStatus}
              onChange={(e) => setApprovalStatus(e.target.value)}
              className="border border-admin-border-mid rounded-lg px-3 py-2 text-sm"
            >
              <option value="">전체 상태</option>
              <option value="pending">pending</option>
              <option value="approved">approved</option>
              <option value="rejected">rejected</option>
              <option value="expired">expired</option>
            </select>
            <span className="text-sm text-admin-muted">총 {approvalsTotal}건</span>
          </div>
          {loading ? (
            <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => (<div key={i} className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-4 space-y-2"><div className="h-3.5 bg-admin-surface-2 rounded animate-pulse w-1/2" /><div className="h-3 bg-admin-surface-2 rounded animate-pulse w-full" /></div>))}</div>
          ) : approvals.length === 0 ? (
            <p className="text-admin-muted text-sm">데이터가 없거나 테이블이 아직 없습니다.</p>
          ) : (
            approvals.map((a) => (
              <div key={a.id} className="border border-admin-border-mid rounded-admin-md p-4 bg-white text-sm shadow-admin-xs">
                <div className="flex flex-wrap gap-2 text-xs text-admin-muted mb-2">
                  <span className="font-mono text-admin-text-2">{a.status}</span>
                  <span>{fmtDateTime(a.requested_at)}</span>
                  <span>task: {a.task_id.slice(0, 8)}…</span>
                </div>
                {a.reason && <p className="text-admin-text-2 mb-2">{a.reason}</p>}
                <pre className="text-[11px] bg-admin-bg rounded-lg p-2 overflow-x-auto text-admin-text-2 mb-3">
                  {JSON.stringify(a.metadata, null, 2)}
                </pre>
                {a.status === 'pending' && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="text-xs rounded-lg px-3 py-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
                      onClick={() => openApprovalAction(a, 'approve')}
                      aria-haspopup="dialog"
                      aria-expanded={approvalActionTarget?.approval.id === a.id && approvalActionTarget.action === 'approve'}
                      aria-controls="agent-approval-action-dialog"
                    >
                      승인
                    </button>
                    <button
                      type="button"
                      className="text-xs rounded-lg px-3 py-1.5 bg-white border border-red-200 text-red-700 hover:bg-red-50"
                      onClick={() => openApprovalAction(a, 'reject')}
                      aria-haspopup="dialog"
                      aria-expanded={approvalActionTarget?.approval.id === a.id && approvalActionTarget.action === 'reject'}
                      aria-controls="agent-approval-action-dialog"
                    >
                      반려
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'tasks' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <select
              value={taskStatus}
              onChange={(e) => setTaskStatus(e.target.value)}
              className="border border-admin-border-mid rounded-lg px-3 py-2 text-sm"
            >
              <option value="">전체 상태</option>
              <option value="queued">queued</option>
              <option value="running">running</option>
              <option value="frozen">frozen</option>
              <option value="resumed">resumed</option>
              <option value="done">done</option>
              <option value="failed">failed</option>
              <option value="expired">expired</option>
            </select>
            <span className="text-sm text-admin-muted">총 {tasksTotal}건</span>
          </div>
          {loading ? (
            <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => (<div key={i} className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-4 space-y-2"><div className="h-3.5 bg-admin-surface-2 rounded animate-pulse w-1/2" /><div className="h-3 bg-admin-surface-2 rounded animate-pulse w-full" /></div>))}</div>
          ) : tasks.length === 0 ? (
            <p className="text-admin-muted text-sm">데이터가 없거나 테이블이 아직 없습니다.</p>
          ) : (
            tasks.map((t) => (
              <div key={t.id} className="border border-admin-border-mid rounded-admin-md p-4 bg-white text-sm shadow-admin-xs">
                <div className="flex flex-wrap gap-2 text-xs text-admin-muted mb-2">
                  <span className="font-mono text-admin-text-2">{t.status}</span>
                  <span className="font-mono text-violet-700">{t.risk_level}</span>
                  <span>{t.agent_type}</span>
                  {t.specialist_id && <span className="truncate max-w-[240px]">spec: {t.specialist_id}</span>}
                  <span>{fmtDateTime(t.created_at)}</span>
                </div>
                {t.last_error && (
                  <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded px-2 py-1 mb-2">
                    {t.last_error}
                  </p>
                )}
                <pre className="text-[11px] bg-admin-bg rounded-lg p-2 overflow-x-auto text-admin-text-2">
                  {JSON.stringify(t.task_context, null, 2)}
                </pre>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'incidents' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <select
              value={incidentSeverity}
              onChange={(e) => setIncidentSeverity(e.target.value)}
              className="border border-admin-border-mid rounded-lg px-3 py-2 text-sm"
            >
              <option value="">전체 심각도</option>
              <option value="info">info</option>
              <option value="warn">warn</option>
              <option value="error">error</option>
              <option value="critical">critical</option>
            </select>
            <span className="text-sm text-admin-muted">총 {incidentsTotal}건</span>
          </div>
          {loading ? (
            <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => (<div key={i} className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-4 space-y-2"><div className="h-3.5 bg-admin-surface-2 rounded animate-pulse w-1/2" /><div className="h-3 bg-admin-surface-2 rounded animate-pulse w-full" /></div>))}</div>
          ) : incidents.length === 0 ? (
            <p className="text-admin-muted text-sm">데이터가 없거나 테이블이 아직 없습니다.</p>
          ) : (
            incidents.map((i) => (
              <div key={i.id} className="border border-admin-border-mid rounded-admin-md p-4 bg-white text-sm shadow-admin-xs">
                <div className="flex flex-wrap gap-2 text-xs text-admin-muted mb-2">
                  <span className="font-mono text-admin-text-2">{i.severity}</span>
                  <span className="font-mono">{i.category}</span>
                  <span>{fmtDateTime(i.created_at)}</span>
                </div>
                <p className="text-admin-text-2 mb-2">{i.message}</p>
                <pre className="text-[11px] bg-admin-bg rounded-lg p-2 overflow-x-auto text-admin-text-2">
                  {JSON.stringify(i.details, null, 2)}
                </pre>
              </div>
            ))
          )}
        </div>
      )}

      {approvalActionTarget && (
        <div className="fixed inset-0 z-50 flex h-dvh max-h-dvh items-end justify-center bg-black/30 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] sm:items-center">
          <div
            ref={approvalDialogRef}
            id="agent-approval-action-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={approvalActionTitleId}
            aria-describedby={approvalActionDescriptionId}
            className="w-full max-w-lg overflow-hidden rounded-admin-md border border-admin-border-mid bg-white shadow-admin-lg"
          >
            <div className="border-b border-admin-border-mid px-4 py-3">
              <p id={approvalActionTitleId} className="text-admin-sm font-semibold text-admin-text-2">
                {approvalActionTarget.action === 'approve' ? '에이전트 요청 승인' : '에이전트 요청 반려'}
              </p>
              <p id={approvalActionDescriptionId} className="mt-1 text-[11px] text-admin-muted">
                고위험 요청의 freeze 상태를 검토합니다. 처리 후 승인 큐가 새로고침됩니다.
              </p>
            </div>
            <div className="space-y-3 px-4 py-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded bg-admin-bg px-2.5 py-2">
                  <p className="text-[10px] text-admin-muted-2">상태</p>
                  <p className="text-admin-sm font-semibold text-admin-text-2">{approvalActionTarget.approval.status}</p>
                </div>
                <div className="rounded bg-admin-bg px-2.5 py-2">
                  <p className="text-[10px] text-admin-muted-2">요청</p>
                  <p className="text-admin-sm font-semibold text-admin-text-2">{fmtDateTime(approvalActionTarget.approval.requested_at)}</p>
                </div>
              </div>
              <div className="rounded border border-admin-border-mid bg-admin-bg p-2">
                <p className="mb-1 text-[10px] font-semibold uppercase text-admin-muted-2">Metadata</p>
                <pre className="max-h-48 overflow-auto text-[11px] text-admin-text-2">
                  {JSON.stringify(approvalActionTarget.approval.metadata, null, 2)}
                </pre>
              </div>
              {approvalActionTarget.action === 'reject' && (
                <div>
                  <label htmlFor="agent-approval-reject-reason" className="mb-1 block text-[11px] font-semibold text-admin-muted">
                    반려 사유
                  </label>
                  <textarea
                    ref={rejectReasonRef}
                    id="agent-approval-reject-reason"
                    value={rejectReason}
                    onChange={(event) => setRejectReason(event.target.value)}
                    placeholder="비워두면 기본 반려 문구로 기록됩니다."
                    rows={3}
                    className="w-full resize-none rounded-lg border border-admin-border-mid px-3 py-2 text-admin-sm text-admin-text-2 focus:outline-none focus:ring-1 focus:ring-brand"
                  />
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-admin-border-mid px-4 py-3">
              <button
                ref={approvalCancelButtonRef}
                type="button"
                onClick={() => {
                  setApprovalActionTarget(null);
                  setRejectReason('');
                }}
                className="rounded border border-admin-border-strong bg-white px-3 py-1.5 text-admin-sm text-admin-text-2 hover:bg-admin-bg"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void actOnApproval(
                  approvalActionTarget.approval.id,
                  approvalActionTarget.action,
                  approvalActionTarget.action === 'reject' ? rejectReason.trim() || undefined : undefined,
                )}
                className={`rounded px-3 py-1.5 text-admin-sm font-medium text-white ${
                  approvalActionTarget.action === 'approve'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {approvalActionTarget.action === 'approve' ? '승인' : '반려'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
