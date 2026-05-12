'use client';

import { useState, useEffect, useCallback } from 'react';
import { PageHeader } from '@/components/admin/patterns';
import Button from '@/components/ui/Button';
import { RefreshCw } from 'lucide-react';

interface Inquiry {
  id: string;
  question: string;
  inquiry_type: string;
  status: string;
  created_at: string;
  customer_name?: string;
  customer_email?: string;
}

interface AgentTask {
  id: string;
  correlation_id: string;
  status: string;
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  performative: string;
  task_context: Record<string, unknown>;
  created_at: string;
  assigned_to: string | null;
}

const ESCALATION_TYPES = 'escalation,critic_blocked,escalation_cta';

const RISK_COLOR: Record<string, string> = {
  critical: 'border-l-red-500 bg-red-50',
  high:     'border-l-orange-400 bg-orange-50',
  medium:   'border-l-amber-400 bg-amber-50',
  low:      'border-l-blue-300 bg-blue-50',
};
const RISK_BADGE: Record<string, string> = {
  critical: 'bg-red-100 text-red-700',
  high:     'bg-orange-100 text-orange-700',
  medium:   'bg-amber-100 text-amber-700',
  low:      'bg-blue-100 text-blue-700',
};
const RISK_EMOJI: Record<string, string> = {
  critical: '🚨', high: '🔴', medium: '🟡', low: '🟢',
};

function fmtDate(s: string) {
  // locale-stable: "MM-DD HH:mm" (예: "05-10 13:30")
  return s ? s.slice(5, 16).replace('T', ' ') : '';
}

function minutesAgo(s: string) {
  return Math.floor((Date.now() - new Date(s).getTime()) / 60000);
}

export default function EscalationsPage() {
  const [inquiries, setInquiries]   = useState<Inquiry[]>([]);
  const [tasks, setTasks]           = useState<AgentTask[]>([]);
  const [isLoading, setIsLoading]   = useState(true);
  const [takingOver, setTakingOver] = useState<string | null>(null);
  const [tab, setTab]               = useState<'tasks' | 'inquiries'>('tasks');

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [taskRes, inquiryRes] = await Promise.all([
        fetch('/api/admin/hitl/tasks'),
        fetch(`/api/qa?${new URLSearchParams({ status: 'pending', inquiryTypes: ESCALATION_TYPES })}`),
      ]);
      const [taskData, inquiryData] = await Promise.all([
        taskRes.json(),
        inquiryRes.json(),
      ]);
      setTasks(taskData.tasks ?? []);
      setInquiries(inquiryData.inquiries ?? []);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  async function takeover(taskId: string) {
    setTakingOver(taskId);
    try {
      await fetch('/api/admin/hitl/takeover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId }),
      });
      await load();
    } finally {
      setTakingOver(null);
    }
  }

  async function resolveInquiry(id: string) {
    await fetch('/api/qa', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inquiryId: id, status: 'resolved' }),
    });
    await load();
  }

  const totalPending = tasks.length + inquiries.length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="에스컬레이션 관제탑"
        subtitle="JARVIS 에이전트 일시정지 및 고객 직접 연결 요청을 통합 관리합니다"
        badge={
          totalPending > 0 ? (
            <span className="bg-danger text-white text-admin-xs font-bold px-2 py-0.5 rounded-full admin-num">
              {totalPending}
            </span>
          ) : undefined
        }
        actions={
          <Button variant="secondary" size="sm" onClick={load}>
            <RefreshCw size={14} />
            새로고침
          </Button>
        }
      />

      <div className="flex gap-1 bg-admin-surface-2 rounded-admin-sm p-1 w-fit">
        <button
          type="button"
          onClick={() => setTab('tasks')}
          className={`text-admin-sm px-3 h-8 rounded-admin-xs transition-colors ${
            tab === 'tasks'
              ? 'bg-admin-surface text-admin-text font-semibold shadow-admin-xs'
              : 'text-admin-muted hover:text-admin-text-2'
          }`}
        >
          JARVIS 에스컬레이션
          {tasks.length > 0 && (
            <span className="ml-1.5 bg-danger text-white text-admin-2xs px-1.5 py-0.5 rounded-full admin-num">
              {tasks.length}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setTab('inquiries')}
          className={`text-admin-sm px-3 h-8 rounded-admin-xs transition-colors ${
            tab === 'inquiries'
              ? 'bg-admin-surface text-admin-text font-semibold shadow-admin-xs'
              : 'text-admin-muted hover:text-admin-text-2'
          }`}
        >
          고객 직접 연결
          {inquiries.length > 0 && (
            <span className="ml-1.5 bg-warning text-white text-admin-2xs px-1.5 py-0.5 rounded-full admin-num">
              {inquiries.length}
            </span>
          )}
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-white rounded-admin-md border border-admin-border shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-4 flex items-start gap-3">
              <div className="w-2 h-2 rounded-full bg-admin-surface-2 animate-pulse mt-1.5 shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 bg-admin-surface-2 rounded animate-pulse w-48" />
                <div className="h-3 bg-admin-surface-2 rounded animate-pulse w-72" />
              </div>
              <div className="h-5 bg-admin-surface-2 rounded-full animate-pulse w-16" />
            </div>
          ))}
        </div>
      ) : (
        <>
          {tab === 'tasks' && (
            <div className="space-y-2">
              {tasks.length === 0 ? (
                <div className="text-center py-20 bg-white rounded-admin-md border border-admin-border shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
                  <p className="text-admin-muted text-admin-base font-medium">처리 대기 중인 에스컬레이션이 없습니다</p>
                  <p className="text-admin-muted-2 text-admin-sm mt-1">JARVIS가 모든 요청을 정상 처리 중입니다</p>
                </div>
              ) : tasks.map((task) => {
                const ctx = task.task_context ?? {};
                const preview = String(ctx.message ?? ctx.userMessage ?? ctx.summary ?? '');
                const mins = minutesAgo(task.created_at);
                return (
                  <div
                    key={task.id}
                    className={`bg-white rounded-admin-md border border-admin-border shadow-[0_1px_4px_rgba(0,0,0,0.04)] border-l-4 ${RISK_COLOR[task.risk_level]} p-4`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${RISK_BADGE[task.risk_level]}`}>
                            {RISK_EMOJI[task.risk_level]} {task.risk_level.toUpperCase()}
                          </span>
                          <span className="text-[11px] bg-admin-surface-2 text-admin-muted px-2 py-0.5 rounded-full">
                            {task.performative}
                          </span>
                          <span className={`text-[11px] font-medium ${mins > 30 ? 'text-red-500' : 'text-admin-muted-2'}`}>
                            {mins < 60 ? `${mins}분 전` : `${Math.floor(mins / 60)}시간 전`}
                            {mins > 30 && ' ⚠️ 장기 대기'}
                          </span>
                        </div>
                        {preview && (
                          <p className="text-admin-text-2 text-admin-base leading-relaxed break-words line-clamp-3">
                            {preview.slice(0, 300)}
                          </p>
                        )}
                        <p className="text-[11px] text-admin-muted-2 mt-2 font-mono">
                          task: {task.id.slice(0, 8)}…
                        </p>
                      </div>
                      <Button
                        variant="primary"
                        onClick={() => takeover(task.id)}
                        disabled={takingOver === task.id}
                        className="shrink-0 whitespace-nowrap"
                      >
                        {takingOver === task.id ? '처리 중…' : '직접 대응'}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'inquiries' && (
            <div className="space-y-2">
              {inquiries.length === 0 ? (
                <div className="text-center py-20 bg-white rounded-admin-md border border-admin-border shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
                  <p className="text-admin-muted text-admin-base font-medium">처리 대기 중인 문의가 없습니다</p>
                </div>
              ) : inquiries.map((inq) => (
                <div
                  key={inq.id}
                  className="bg-white rounded-admin-md border border-admin-border shadow-[0_1px_4px_rgba(0,0,0,0.04)] border-l-4 border-l-amber-400 p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[11px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                          {inq.inquiry_type}
                        </span>
                        <span className="text-[11px] text-admin-muted-2">{fmtDate(inq.created_at)}</span>
                      </div>
                      <p className="text-admin-text-2 text-admin-base leading-relaxed whitespace-pre-wrap break-words">
                        {inq.question}
                      </p>
                      {inq.customer_name && (
                        <p className="text-admin-sm text-admin-muted mt-2">
                          고객: {inq.customer_name}{inq.customer_email ? ` (${inq.customer_email})` : ''}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="primary"
                      onClick={() => resolveInquiry(inq.id)}
                      className="shrink-0"
                    >
                      처리 완료
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
