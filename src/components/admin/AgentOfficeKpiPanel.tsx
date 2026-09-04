'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, BarChart3, CheckCircle2, Clock, Database, RefreshCw } from 'lucide-react';

import Button from '@/components/ui/Button';
import {
  AGENT_OFFICE_KPI_WINDOWS,
  type AgentOfficeKpiSnapshot,
  type AgentOfficeKpiWindow,
} from '@/lib/agent-office-kpi';

const WINDOW_LABEL: Record<AgentOfficeKpiWindow, string> = {
  '24h': '최근 24시간',
  '7d': '최근 7일',
  '30d': '최근 30일',
};

const UNAVAILABLE_REASON: Record<string, string> = {
  SUPABASE_NOT_CONFIGURED: 'Supabase 연결이 구성되지 않았습니다.',
  KPI_RPC_NOT_APPLIED: 'KPI 집계 계약이 아직 Preview/Production에 적용되지 않았습니다.',
  KPI_RPC_FAILED: 'KPI 집계 원장을 읽지 못했습니다.',
};

const KPI_AUTO_REFRESH_MS = 30_000;

function formatMetric(value: number | null, unit: 'count' | 'milliseconds'): string {
  if (value === null) return '—';
  if (unit === 'milliseconds') return `${Math.round(value).toLocaleString('ko-KR')}ms`;
  return Math.round(value).toLocaleString('ko-KR');
}

function formatDate(value: string | null): string {
  if (!value) return '기록 없음';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '기록 없음';
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Seoul',
  }).format(timestamp);
}

export default function AgentOfficeKpiPanel() {
  const [window, setWindow] = useState<AgentOfficeKpiWindow>('7d');
  const [snapshot, setSnapshot] = useState<AgentOfficeKpiSnapshot & { reason?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (selectedWindow: AgentOfficeKpiWindow) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/agent/office/kpi?window=${selectedWindow}`, { cache: 'no-store' });
      const payload = await response.json() as AgentOfficeKpiSnapshot & { reason?: string; error?: string };
      if (!response.ok) throw new Error(payload.error || 'KPI 원장을 불러오지 못했습니다.');
      setSnapshot(payload);
    } catch (loadError) {
      setSnapshot(null);
      setError(loadError instanceof Error ? loadError.message : 'KPI 원장을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(window);
  }, [load, window]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void load(window);
    };
    const timer = globalThis.setInterval(refreshWhenVisible, KPI_AUTO_REFRESH_MS);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      globalThis.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [load, window]);

  const unavailable = snapshot?.status === 'unavailable';
  return (
    <section className="mt-4 overflow-hidden rounded-admin-md border border-admin-border-mid bg-admin-surface shadow-admin-xs" aria-labelledby="agent-office-kpi-heading">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-admin-border px-4 py-3">
        <div className="flex items-start gap-2">
          <BarChart3 size={16} className="mt-0.5 shrink-0 text-blue-600" aria-hidden="true" />
          <div>
            <h2 id="agent-office-kpi-heading" className="text-admin-sm font-semibold text-admin-text">기간 KPI</h2>
            <p className="mt-0.5 text-[11px] text-admin-muted">기존 업무 원장 집계 RPC만 권위로 사용합니다. Shadow Run은 포함하지 않습니다. (표시 중 30초 자동 갱신)</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="agent-office-kpi-window" className="sr-only">KPI 기간</label>
          <select
            id="agent-office-kpi-window"
            value={window}
            onChange={(event) => setWindow(event.target.value as AgentOfficeKpiWindow)}
            className="h-8 rounded-admin-sm border border-admin-border-mid bg-white px-2 text-admin-xs text-admin-text focus:border-blue-600 focus:outline-none focus:shadow-admin-focus"
          >
            {AGENT_OFFICE_KPI_WINDOWS.map((key) => <option key={key} value={key}>{WINDOW_LABEL[key]}</option>)}
          </select>
          <Button variant="secondary" size="sm" onClick={() => void load(window)} loading={loading} aria-label="기간 KPI 새로고침">
            <RefreshCw size={13} aria-hidden="true" />
            새로고침
          </Button>
        </div>
      </header>

      {error && (
        <div className="mx-4 mt-3 rounded-admin-sm border border-rose-200 bg-rose-50 px-3 py-2 text-admin-xs text-rose-700" role="alert">
          {error}
        </div>
      )}

      {loading && !snapshot ? (
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4" aria-label="기간 KPI 로딩 중">
          {Array.from({ length: 8 }).map((_, index) => <div key={index} className="h-16 animate-pulse rounded-admin-sm bg-admin-surface-2" />)}
        </div>
      ) : unavailable ? (
        <div className="flex items-start gap-3 px-4 py-5">
          <AlertTriangle size={17} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
          <div>
            <p className="text-admin-sm font-semibold text-admin-text">기간 KPI 데이터 계약 준비 중</p>
            <p className="mt-1 text-admin-xs leading-relaxed text-admin-muted">
              {UNAVAILABLE_REASON[snapshot?.reason ?? ''] ?? '집계 원장을 사용할 수 없습니다.'} 기간 합계를 최근 화면 배열로 대신 계산하지 않습니다.
            </p>
          </div>
        </div>
      ) : snapshot ? (
        <>
          <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
            {snapshot.metrics.map((metric) => (
              <div key={metric.key} className="rounded-admin-sm border border-admin-border bg-admin-surface-2 px-3 py-2.5">
                <p className="text-[10px] font-medium text-admin-muted">{metric.label}</p>
                <p className={`mt-1 text-lg font-bold leading-none admin-num ${metric.status === 'available' ? 'text-admin-text' : 'text-admin-muted-2'}`}>
                  {formatMetric(metric.value, metric.unit)}
                </p>
                <p className="mt-1 line-clamp-2 text-[10px] leading-snug text-admin-muted-2">{metric.description}</p>
              </div>
            ))}
          </div>
          <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-admin-border px-4 py-2.5 text-[10px] text-admin-muted">
            <span className="inline-flex items-center gap-1"><Database size={12} aria-hidden="true" />{snapshot.calculationVersion}</span>
            <span className="inline-flex items-center gap-1"><Clock size={12} aria-hidden="true" />원장 기준 {formatDate(snapshot.freshness.sourceUpdatedAt)}</span>
            <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 size={12} aria-hidden="true" />권위 집계</span>
          </footer>
        </>
      ) : null}
    </section>
  );
}
