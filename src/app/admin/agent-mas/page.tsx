'use client';

import { useCallback, useEffect, useState } from 'react';

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

  const actOnApproval = async (id: string, action: 'approve' | 'reject') => {
    const reason =
      action === 'reject'
        ? window.prompt('반려 사유(선택, 비우면 기본 문구)') || undefined
        : undefined;
    const res = await fetch(`/api/agent/approvals/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, reason }),
    });
    const json = await res.json();
    if (!res.ok) {
      window.alert(json.error || '처리 실패');
      return;
    }
    await refresh();
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">MAS 관제 (Concierge PoC)</h1>
        <p className="text-sm text-slate-500 mt-1">
          고객 QA·자비스에서 생성된 <strong>작업(agent_tasks)</strong>, <strong>승인(agent_approvals)</strong>,{' '}
          <strong>사고(agent_incidents)</strong>를 한 화면에서 확인합니다. 승인은 고위험 요청이 freeze 된 뒤에만
          쌓입니다.
        </p>
        {error && (
          <p className="text-red-700 text-sm mt-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
        )}
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {(['approvals', 'tasks', 'incidents'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`text-sm rounded-lg px-3 py-2 border ${
              tab === t ? 'bg-violet-600 text-white border-violet-600' : 'bg-white border-slate-200 hover:bg-slate-50'
            }`}
          >
            {t === 'approvals' ? '승인 큐' : t === 'tasks' ? '작업' : '사고'}
          </button>
        ))}
        <button
          type="button"
          onClick={() => refresh()}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 ml-auto"
        >
          새로고침
        </button>
      </div>

      {tab === 'approvals' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <select
              value={approvalStatus}
              onChange={(e) => setApprovalStatus(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">전체 상태</option>
              <option value="pending">pending</option>
              <option value="approved">approved</option>
              <option value="rejected">rejected</option>
              <option value="expired">expired</option>
            </select>
            <span className="text-sm text-slate-500">총 {approvalsTotal}건</span>
          </div>
          {loading ? (
            <p className="text-slate-500 text-sm">불러오는 중…</p>
          ) : approvals.length === 0 ? (
            <p className="text-slate-500 text-sm">데이터가 없거나 테이블이 아직 없습니다.</p>
          ) : (
            approvals.map((a) => (
              <div key={a.id} className="border border-slate-200 rounded-xl p-4 bg-white text-sm shadow-sm">
                <div className="flex flex-wrap gap-2 text-xs text-slate-500 mb-2">
                  <span className="font-mono text-slate-800">{a.status}</span>
                  <span>{new Date(a.requested_at).toLocaleString('ko-KR')}</span>
                  <span>task: {a.task_id.slice(0, 8)}…</span>
                </div>
                {a.reason && <p className="text-slate-700 mb-2">{a.reason}</p>}
                <pre className="text-[11px] bg-slate-50 rounded-lg p-2 overflow-x-auto text-slate-700 mb-3">
                  {JSON.stringify(a.metadata, null, 2)}
                </pre>
                {a.status === 'pending' && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="text-xs rounded-lg px-3 py-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
                      onClick={() => void actOnApproval(a.id, 'approve')}
                    >
                      승인
                    </button>
                    <button
                      type="button"
                      className="text-xs rounded-lg px-3 py-1.5 bg-white border border-red-200 text-red-700 hover:bg-red-50"
                      onClick={() => void actOnApproval(a.id, 'reject')}
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
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
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
            <span className="text-sm text-slate-500">총 {tasksTotal}건</span>
          </div>
          {loading ? (
            <p className="text-slate-500 text-sm">불러오는 중…</p>
          ) : tasks.length === 0 ? (
            <p className="text-slate-500 text-sm">데이터가 없거나 테이블이 아직 없습니다.</p>
          ) : (
            tasks.map((t) => (
              <div key={t.id} className="border border-slate-200 rounded-xl p-4 bg-white text-sm shadow-sm">
                <div className="flex flex-wrap gap-2 text-xs text-slate-500 mb-2">
                  <span className="font-mono text-slate-800">{t.status}</span>
                  <span className="font-mono text-violet-700">{t.risk_level}</span>
                  <span>{t.agent_type}</span>
                  {t.specialist_id && <span className="truncate max-w-[240px]">spec: {t.specialist_id}</span>}
                  <span>{new Date(t.created_at).toLocaleString('ko-KR')}</span>
                </div>
                {t.last_error && (
                  <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded px-2 py-1 mb-2">
                    {t.last_error}
                  </p>
                )}
                <pre className="text-[11px] bg-slate-50 rounded-lg p-2 overflow-x-auto text-slate-700">
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
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">전체 심각도</option>
              <option value="info">info</option>
              <option value="warn">warn</option>
              <option value="error">error</option>
              <option value="critical">critical</option>
            </select>
            <span className="text-sm text-slate-500">총 {incidentsTotal}건</span>
          </div>
          {loading ? (
            <p className="text-slate-500 text-sm">불러오는 중…</p>
          ) : incidents.length === 0 ? (
            <p className="text-slate-500 text-sm">데이터가 없거나 테이블이 아직 없습니다.</p>
          ) : (
            incidents.map((i) => (
              <div key={i.id} className="border border-slate-200 rounded-xl p-4 bg-white text-sm shadow-sm">
                <div className="flex flex-wrap gap-2 text-xs text-slate-500 mb-2">
                  <span className="font-mono text-slate-800">{i.severity}</span>
                  <span className="font-mono">{i.category}</span>
                  <span>{new Date(i.created_at).toLocaleString('ko-KR')}</span>
                </div>
                <p className="text-slate-800 mb-2">{i.message}</p>
                <pre className="text-[11px] bg-slate-50 rounded-lg p-2 overflow-x-auto text-slate-700">
                  {JSON.stringify(i.details, null, 2)}
                </pre>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
