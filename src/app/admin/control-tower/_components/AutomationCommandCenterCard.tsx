'use client';

import Link from 'next/link';
import { AlertTriangle, CheckCircle2, ExternalLink, RefreshCw, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AutomationCommandCenterSnapshot,
  AutomationCommandCenterStatus,
} from '@/lib/automation-command-center';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

const STATUS_LABEL: Record<AutomationCommandCenterStatus, string> = {
  ready: 'Operational',
  watch: 'Review needed',
  blocked: 'Blocked',
};

const STATUS_CLASS: Record<AutomationCommandCenterStatus, string> = {
  ready: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  watch: 'border-amber-200 bg-amber-50 text-amber-800',
  blocked: 'border-rose-200 bg-rose-50 text-rose-800',
};

const DOT_CLASS: Record<AutomationCommandCenterStatus, string> = {
  ready: 'bg-emerald-500',
  watch: 'bg-amber-500',
  blocked: 'bg-rose-500',
};

function statusIcon(status: AutomationCommandCenterStatus) {
  if (status === 'ready') return <CheckCircle2 className="h-4 w-4" aria-hidden="true" />;
  if (status === 'watch') return <AlertTriangle className="h-4 w-4" aria-hidden="true" />;
  return <ShieldCheck className="h-4 w-4" aria-hidden="true" />;
}

function MetricBlock({
  label,
  value,
  detail,
  status,
}: {
  label: string;
  value: string;
  detail: string;
  status: AutomationCommandCenterStatus;
}) {
  return (
    <div className="min-h-[92px] rounded-admin-md border border-admin-border-mid bg-admin-surface px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase text-admin-muted-2">{label}</p>
        <span className={`h-2 w-2 rounded-full ${DOT_CLASS[status]}`} />
      </div>
      <p className="mt-1 text-[22px] font-bold leading-tight text-admin-text-2">{value}</p>
      <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-admin-muted">{detail}</p>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="rounded-admin-md border border-admin-border-mid bg-admin-surface px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-admin-sm font-semibold text-admin-text-2">AI command center</p>
          <p className="mt-1 text-[11px] text-admin-muted">Loading automation command center snapshot.</p>
        </div>
        <div className="h-4 w-20 animate-pulse rounded bg-admin-surface-2" />
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-[92px] animate-pulse rounded-admin-md bg-admin-surface-2" />
        ))}
      </div>
    </div>
  );
}

export function AutomationCommandCenterCard() {
  const [snapshot, setSnapshot] = useState<AutomationCommandCenterSnapshot | null>(null);
  const [state, setState] = useState<LoadState>('idle');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState((prev) => (prev === 'ready' ? prev : 'loading'));
    setError(null);
    try {
      const res = await fetch('/api/admin/automation-command-center', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not load the AI command center.');
      setSnapshot(data as AutomationCommandCenterSnapshot);
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the AI command center.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const primaryBlocker = useMemo(() => snapshot?.blockers[0] ?? null, [snapshot]);

  if (state === 'loading' || state === 'idle') return <Skeleton />;

  if (state === 'error' || !snapshot) {
    return (
      <section className="rounded-admin-md border border-rose-200 bg-rose-50 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-admin-sm font-semibold text-rose-800">AI command center blocked</p>
            <p className="mt-1 text-[11px] text-rose-700">{error}</p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex h-8 items-center gap-1 rounded-admin-sm border border-rose-200 bg-white px-2 text-[11px] font-medium text-rose-700"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Retry
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-admin-md border border-admin-border-mid bg-admin-surface px-4 py-4 shadow-admin-xs">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-admin-md font-semibold text-admin-text-2">AI command center</h2>
            <span className={`inline-flex items-center gap-1 rounded-admin-sm border px-2 py-0.5 text-[11px] font-semibold ${STATUS_CLASS[snapshot.status]}`}>
              {statusIcon(snapshot.status)}
              {STATUS_LABEL[snapshot.status]}
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-snug text-admin-muted">
            One read-only view for Jarvis readiness, Ad OS evidence, approval packets, blockers, and the next safe action.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex h-8 items-center gap-1 rounded-admin-sm border border-admin-border-mid bg-admin-surface-2 px-2 text-[11px] font-medium text-admin-text-2"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Refresh
          </button>
          <Link
            href={snapshot.one_click_recommendation.target_href}
            className="inline-flex h-8 items-center gap-1 rounded-admin-sm bg-blue-600 px-3 text-[11px] font-semibold text-white"
          >
            {snapshot.one_click_recommendation.label}
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-4">
        <MetricBlock
          label="Overall score"
          value={`${snapshot.score}/100`}
          detail={primaryBlocker?.next_action || 'No blockers are currently reported.'}
          status={snapshot.status}
        />
        <MetricBlock
          label="Jarvis"
          value={`${snapshot.jarvis.score}/${snapshot.jarvis.max_score}`}
          detail={snapshot.jarvis.next_action}
          status={snapshot.jarvis.status}
        />
        <MetricBlock
          label="Ad OS"
          value={`${snapshot.ad_os.current_lowest_score}/95`}
          detail={`Ready proof ${snapshot.ad_os.ready_fixture_lowest_score}/95; current gaps ${snapshot.ad_os.gap_count}, P0 ${snapshot.ad_os.p0_gap_count}`}
          status={snapshot.ad_os.status}
        />
        <MetricBlock
          label="Approval queue"
          value={`${snapshot.approval_queue.pending_count}`}
          detail={`High risk ${snapshot.approval_queue.high_risk_count}; ${snapshot.approval_queue.next_action}`}
          status={snapshot.approval_queue.status}
        />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
        <div className="rounded-admin-md border border-admin-border bg-admin-bg px-3 py-2">
          <p className="text-[10px] font-semibold uppercase text-admin-muted-2">Top blocker</p>
          {primaryBlocker ? (
            <div className="mt-1">
              <p className="text-admin-xs font-semibold text-admin-text-2">{primaryBlocker.message}</p>
              <p className="mt-1 text-[11px] text-admin-muted">{primaryBlocker.next_action}</p>
            </div>
          ) : (
            <p className="mt-1 text-admin-xs text-admin-muted">No blocker is currently reported.</p>
          )}
        </div>
        <div className="rounded-admin-md border border-admin-border bg-admin-bg px-3 py-2">
          <p className="text-[10px] font-semibold uppercase text-admin-muted-2">Safety boundary</p>
          <p className="mt-1 text-admin-xs font-semibold text-admin-text-2">
            Read-only, external API writes 0, live spend 0 KRW, full-auto off
          </p>
          <p className="mt-1 text-[11px] text-admin-muted">
            Bookings, payments, payouts, PII, credentials, external publishing, and ad spend still require the existing approval screens.
          </p>
        </div>
      </div>
    </section>
  );
}
