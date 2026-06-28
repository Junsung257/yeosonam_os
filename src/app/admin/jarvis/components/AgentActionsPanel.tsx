'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import type { AutopilotDecisionPacket } from '@/lib/agent-action-registry';
import type { ReactNode } from 'react';

interface AgentAction {
  id: string;
  agent_type: string;
  action_type: string;
  summary: string;
  payload: Record<string, unknown>;
  status: string;
  result_log: string | null;
  requested_by: string;
  reviewed_by: string | null;
  priority: string;
  reject_reason: string | null;
  expires_at: string | null;
  created_at: string;
  resolved_at: string | null;
  decision_packet?: AutopilotDecisionPacket;
}

const STATUS_TABS = [
  { key: 'pending', label: 'Pending' },
  { key: 'executed', label: 'Done' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'failed', label: 'Failed' },
  { key: 'all', label: 'All' },
];

const STATUS_CLASS: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700',
  executed: 'bg-emerald-50 text-emerald-700',
  rejected: 'bg-red-50 text-red-700',
  failed: 'bg-red-50 text-red-700',
  approved: 'bg-blue-50 text-blue-700',
  expired: 'bg-slate-100 text-slate-600',
};

const RISK_CLASS: Record<string, string> = {
  low: 'bg-green-50 text-green-700',
  medium: 'bg-amber-50 text-amber-700',
  high: 'bg-red-50 text-red-700',
  critical: 'bg-red-700 text-white',
};

const RECOMMENDATION_CLASS: Record<string, string> = {
  approve: 'bg-emerald-50 text-emerald-700',
  hold: 'bg-amber-50 text-amber-700',
  reject: 'bg-red-50 text-red-700',
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function compactValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return JSON.stringify(value.length > 6 ? value.slice(0, 6) : value);
  return JSON.stringify(value);
}

function Badge({ children, className }: { children: ReactNode; className: string }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${className}`}>
      {children}
    </span>
  );
}

function DecisionPacketView({ packet }: { packet: AutopilotDecisionPacket }) {
  return (
    <div className="space-y-3 rounded-admin-md border border-admin-border-mid bg-admin-bg p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge className={RECOMMENDATION_CLASS[packet.recommendation] ?? 'bg-slate-100 text-slate-700'}>
          AI: {packet.recommendation}
        </Badge>
        <Badge className={RISK_CLASS[packet.riskLevel] ?? 'bg-slate-100 text-slate-700'}>
          Risk: {packet.riskLevel}
        </Badge>
        <span className="text-[11px] text-admin-muted">
          Confidence {Math.round(packet.confidence * 100)}%
        </span>
      </div>

      <p className="text-admin-xs text-admin-text-2">{packet.recommendationReason}</p>

      <div className="grid gap-2 md:grid-cols-2">
        <div className="rounded-admin-sm bg-white p-2">
          <p className="mb-1 text-[11px] font-semibold text-admin-text-2">Evidence</p>
          <div className="space-y-1">
            {packet.evidence.slice(0, 8).map((item, index) => (
              <div key={`${item.label}-${index}`} className="text-[11px] text-admin-muted">
                <span className="font-mono text-admin-text-2">{item.label}</span>: {item.value}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-admin-sm bg-white p-2">
          <p className="mb-1 text-[11px] font-semibold text-admin-text-2">Dry-run checks</p>
          <div className="space-y-1">
            {packet.dryRun.checks.map((check) => (
              <div key={check.id} className="flex items-start gap-1.5 text-[11px] text-admin-muted">
                {check.status === 'pass' ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                ) : (
                  <XCircle className="mt-0.5 h-3.5 w-3.5 text-red-600" aria-hidden="true" />
                )}
                <span>
                  <span className="text-admin-text-2">{check.label}</span>
                  {check.detail ? ` - ${check.detail}` : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-admin-sm bg-white p-2">
        <p className="mb-1 text-[11px] font-semibold text-admin-text-2">Expected impact</p>
        <ul className="space-y-1 text-[11px] text-admin-muted">
          {packet.dryRun.predictedEffects.map((effect) => (
            <li key={effect}>{effect}</li>
          ))}
        </ul>
      </div>

      <div className="rounded-admin-sm bg-white p-2 text-[11px] text-admin-muted">
        <span className="font-semibold text-admin-text-2">Rollback: </span>
        {packet.rollbackHint}
      </div>
    </div>
  );
}

export default function AgentActionsPanel() {
  const [actions, setActions] = useState<AgentAction[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);
  const limit = 20;

  const fetchActions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/jarvis/autopilot?status=${statusFilter}&page=${page}&limit=${limit}`);
      const data = await res.json();
      setActions(data.actions ?? []);
      setTotal(data.total ?? 0);
    } catch {
      setActions([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, page]);

  useEffect(() => {
    fetchActions();
    const interval = setInterval(fetchActions, 30000);
    return () => clearInterval(interval);
  }, [fetchActions]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter]);

  const showToast = (msg: string, type: 'ok' | 'err') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const refreshDecision = async (actionId: string) => {
    setProcessingId(actionId);
    try {
      const res = await fetch('/api/admin/jarvis/autopilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action_id: actionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Simulation failed');
      setActions((prev) => prev.map((item) => (
        item.id === actionId ? { ...item, decision_packet: data.decision_packet } : item
      )));
      showToast('Dry-run refreshed', 'ok');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Dry-run failed', 'err');
    } finally {
      setProcessingId(null);
    }
  };

  const handleAction = async (actionId: string, action: 'approve' | 'reject') => {
    setProcessingId(actionId);
    try {
      const body: Record<string, unknown> = { action_id: actionId, action };
      if (action === 'reject' && rejectReason.trim()) {
        body.reject_reason = rejectReason.trim();
      }
      const res = await fetch('/api/agent-actions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.decision_packet) {
          setActions((prev) => prev.map((item) => (
            item.id === actionId ? { ...item, decision_packet: data.decision_packet } : item
          )));
        }
        throw new Error(data.error || 'Action failed');
      }
      showToast(action === 'approve' ? 'Approved and executed' : 'Rejected', 'ok');
      setRejectId(null);
      setRejectReason('');
      fetchActions();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Action failed', 'err');
    } finally {
      setProcessingId(null);
    }
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-3">
      <div className="flex gap-1 rounded-lg bg-admin-surface-2 p-1">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setStatusFilter(tab.key)}
            className={`rounded-md px-3 py-1.5 text-admin-xs font-medium transition ${
              statusFilter === tab.key
                ? 'bg-white text-admin-text-2 shadow-admin-xs'
                : 'text-admin-muted hover:text-admin-text-2'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-admin-xs text-admin-muted">
          {total} action{total === 1 ? '' : 's'} {loading ? '(loading)' : ''}
        </p>
        <button
          onClick={fetchActions}
          className="inline-flex h-7 items-center gap-1 rounded-admin-sm border border-admin-border-mid px-2 text-[11px] text-admin-muted transition hover:bg-admin-bg hover:text-admin-text-2"
        >
          <RefreshCw size={12} aria-hidden="true" />
          Refresh
        </button>
      </div>

      {actions.length === 0 && !loading ? (
        <div className="py-12 text-center text-admin-sm text-admin-muted-2">
          No actions in this queue.
        </div>
      ) : (
        <div className="space-y-2">
          {actions.map((action) => {
            const packet = action.decision_packet;
            return (
              <div
                key={action.id}
                className="rounded-lg border border-admin-border-mid bg-white transition hover:border-admin-border-strong"
              >
                <button
                  type="button"
                  className="block w-full p-3 text-left"
                  onClick={() => setExpandedId(expandedId === action.id ? null : action.id)}
                >
                  <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                    <Badge className="bg-blue-50 text-blue-700">{action.agent_type}</Badge>
                    <Badge className={STATUS_CLASS[action.status] ?? 'bg-slate-100 text-slate-700'}>{action.status}</Badge>
                    {packet && (
                      <>
                        <Badge className={RECOMMENDATION_CLASS[packet.recommendation] ?? 'bg-slate-100 text-slate-700'}>
                          AI {packet.recommendation}
                        </Badge>
                        <Badge className={RISK_CLASS[packet.riskLevel] ?? 'bg-slate-100 text-slate-700'}>
                          {packet.riskLevel}
                        </Badge>
                      </>
                    )}
                    <span className="ml-auto text-[10px] text-admin-muted-2">{timeAgo(action.created_at)}</span>
                  </div>
                  <p className="text-admin-sm font-medium text-admin-text-2">{action.summary}</p>
                  <p className="mt-0.5 text-[11px] text-admin-muted-2">
                    {action.action_type} / {action.requested_by}
                    {action.reviewed_by ? ` / reviewed by ${action.reviewed_by}` : ''}
                  </p>
                </button>

                {expandedId === action.id && (
                  <div className="space-y-3 px-3 pb-3">
                    {packet && <DecisionPacketView packet={packet} />}

                    <div className="max-h-60 overflow-y-auto rounded-lg bg-admin-bg p-2.5 font-mono text-xs text-admin-muted">
                      {Object.keys(action.payload ?? {}).length > 0 ? (
                        Object.entries(action.payload).map(([key, value]) => (
                          <div key={key} className="break-all">
                            <span className="text-purple-700">{key}</span>: {compactValue(value)}
                          </div>
                        ))
                      ) : (
                        <span className="text-admin-muted-2">No payload</span>
                      )}
                    </div>

                    {action.result_log && (
                      <div className={`max-h-40 overflow-y-auto rounded-lg p-2.5 font-mono text-xs ${
                        action.status === 'executed' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                      }`}>
                        {action.result_log}
                      </div>
                    )}

                    {action.reject_reason && (
                      <div className="rounded-lg bg-red-50 p-2.5 text-xs text-red-700">
                        Reject reason: {action.reject_reason}
                      </div>
                    )}

                    {action.status === 'pending' && (
                      <div className="space-y-2">
                        {rejectId === action.id && (
                          <textarea
                            value={rejectReason}
                            onChange={(event) => setRejectReason(event.target.value)}
                            placeholder="Reject reason"
                            className="w-full resize-none rounded border border-admin-border-mid px-2 py-1.5 text-admin-xs focus:outline-none focus:ring-1 focus:ring-[#005d90]"
                            rows={2}
                          />
                        )}
                        <div className="flex gap-1.5">
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              refreshDecision(action.id);
                            }}
                            disabled={processingId === action.id}
                            className="inline-flex h-8 items-center justify-center gap-1 rounded border border-admin-border-mid bg-white px-3 text-[11px] font-medium text-admin-text-2 transition hover:bg-admin-bg disabled:opacity-50"
                          >
                            <RefreshCw size={12} aria-hidden="true" />
                            Dry-run
                          </button>
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              handleAction(action.id, 'approve');
                            }}
                            disabled={processingId === action.id || packet?.recommendation !== 'approve'}
                            className="flex-1 rounded bg-blue-600 py-1.5 text-[11px] font-medium text-white transition hover:bg-blue-700 disabled:bg-slate-300"
                          >
                            {processingId === action.id ? 'Processing...' : 'Approve and execute'}
                          </button>
                          {rejectId === action.id ? (
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                handleAction(action.id, 'reject');
                              }}
                              disabled={processingId === action.id}
                              className="flex-1 rounded bg-red-600 py-1.5 text-[11px] font-medium text-white transition hover:bg-red-700 disabled:bg-slate-300"
                            >
                              Confirm reject
                            </button>
                          ) : (
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                setRejectId(action.id);
                                setRejectReason('');
                              }}
                              className="flex-1 rounded border border-admin-border-strong bg-white py-1.5 text-[11px] font-medium text-admin-muted transition hover:bg-admin-bg"
                            >
                              Reject
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={page <= 1}
            className="rounded border border-admin-border-mid px-2 py-1 text-[11px] hover:bg-admin-bg disabled:opacity-40"
          >
            Prev
          </button>
          <span className="text-[11px] text-admin-muted">{page} / {totalPages}</span>
          <button
            onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
            disabled={page >= totalPages}
            className="rounded border border-admin-border-mid px-2 py-1 text-[11px] hover:bg-admin-bg disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-lg px-4 py-2.5 text-admin-sm text-white shadow-admin-md ${
          toast.type === 'err' ? 'bg-red-600' : 'bg-slate-800'
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
