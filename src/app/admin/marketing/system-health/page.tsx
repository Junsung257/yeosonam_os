'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

type Status = 'ok' | 'warn' | 'fail';

interface HealthCheck {
  key: string;
  label: string;
  status: Status;
  message: string;
  detail?: Record<string, unknown>;
}

interface HealthResponse {
  ok: boolean;
  score: number;
  checked_at: string;
  checks: HealthCheck[];
}

const STATUS_CLASS: Record<Status, string> = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warn: 'border-amber-200 bg-amber-50 text-amber-700',
  fail: 'border-red-200 bg-red-50 text-red-700',
};

const GROUP_LABELS: Record<string, string> = {
  env: 'Environment',
  db: 'Database',
  cron: 'Automation',
  ad_os: 'Ad OS control plane',
  probe: 'Live probes',
};

function groupKey(check: HealthCheck) {
  return check.key.split('.')[0] ?? 'etc';
}

function formatDate(value?: string) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export default function MarketingSystemHealthPage() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/marketing/system-health', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, HealthCheck[]>();
    for (const check of data?.checks ?? []) {
      const key = groupKey(check);
      map.set(key, [...(map.get(key) ?? []), check]);
    }
    return Array.from(map.entries());
  }, [data]);

  const counts = {
    ok: data?.checks.filter((check) => check.status === 'ok').length ?? 0,
    warn: data?.checks.filter((check) => check.status === 'warn').length ?? 0,
    fail: data?.checks.filter((check) => check.status === 'fail').length ?? 0,
  };
  const adOsCompletion = data?.checks.find((check) => check.key === 'ad_os.completion_audit');
  const adOsSafety = data?.checks.find((check) => check.key === 'ad_os.external_write_safety');
  const adOsAutoPolicy = data?.checks.find((check) => check.key === 'ad_os.full_auto_policy');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-admin-lg font-bold text-admin-text-2">Marketing System Health</h1>
          <p className="mt-1 text-admin-sm text-admin-muted">Read-only checks for channel automation readiness.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="rounded-lg bg-blue-600 px-4 py-2 text-admin-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Checking...' : 'Run check'}
          </button>
          <Link href="/admin/marketing" className="rounded-lg border border-admin-border-strong bg-white px-4 py-2 text-admin-sm font-medium text-admin-text-2 hover:bg-admin-bg">
            Back
          </Link>
        </div>
      </div>

      {error && <div className="rounded-admin-md border border-red-200 bg-red-50 p-4 text-admin-sm text-red-700">Health check failed: {error}</div>}

      <section className="rounded-admin-md border border-admin-border-mid bg-white p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-admin-base font-semibold text-admin-text-2">Ad OS 운영 가능성</h2>
              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase ${STATUS_CLASS[adOsCompletion?.status ?? 'warn']}`}>
                {adOsCompletion?.status ?? 'checking'}
              </span>
            </div>
            <p className="mt-1 text-admin-sm text-admin-text-2">
              {adOsCompletion?.message ?? 'Completion audit evidence is loading.'}
            </p>
            <p className="mt-1 text-admin-xs text-admin-muted">
              {typeof adOsCompletion?.detail?.next_action === 'string'
                ? adOsCompletion.detail.next_action
                : 'Ad OS summary evidence must be available before declaring the marketing OS complete.'}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Link href="/admin/ad-os" className="rounded-lg border border-admin-border-strong bg-white px-4 py-2 text-admin-sm font-semibold text-admin-text-2 hover:bg-admin-bg">
              Ad OS 열기
            </Link>
            <Link href="/admin/ad-os?panel=completion-audit" className="rounded-lg bg-blue-600 px-4 py-2 text-admin-sm font-semibold text-white hover:bg-blue-700">
              감사 보기
            </Link>
          </div>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {[
            { label: '완성도 감사', check: adOsCompletion },
            { label: '외부 광고비 안전', check: adOsSafety },
            { label: '완전자동 정책', check: adOsAutoPolicy },
          ].map(({ label, check }) => (
            <div key={label} className="rounded-admin-sm border border-admin-border bg-admin-surface p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-admin-sm font-semibold text-admin-text-2">{label}</p>
                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase ${STATUS_CLASS[check?.status ?? 'warn']}`}>
                  {check?.status ?? 'wait'}
                </span>
              </div>
              <p className="mt-2 line-clamp-3 text-admin-xs text-admin-muted">
                {check?.message ?? 'No evidence yet.'}
              </p>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-admin-md border border-admin-border-mid bg-white p-4">
          <p className="text-admin-xs font-semibold uppercase text-admin-muted">Score</p>
          <p className="mt-2 text-3xl font-bold text-admin-text-2">{loading && !data ? '--' : `${data?.score ?? 0}%`}</p>
          <p className="mt-1 text-admin-xs text-admin-muted">Checked {formatDate(data?.checked_at)}</p>
        </div>
        {(['ok', 'warn', 'fail'] as const).map((status) => (
          <div key={status} className="rounded-admin-md border border-admin-border-mid bg-white p-4">
            <p className="text-admin-xs font-semibold uppercase text-admin-muted">{status}</p>
            <p className={`mt-2 text-2xl font-bold ${status === 'ok' ? 'text-emerald-700' : status === 'warn' ? 'text-amber-700' : 'text-red-700'}`}>
              {counts[status]}
            </p>
          </div>
        ))}
      </div>

      {loading && !data ? (
        <div className="rounded-admin-md border border-admin-border-mid bg-white p-5 text-admin-sm text-admin-muted">Running checks...</div>
      ) : (
        grouped.map(([group, checks]) => (
          <section key={group} className="rounded-admin-md border border-admin-border-mid bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-admin-base font-semibold text-admin-text-2">{GROUP_LABELS[group] ?? group}</h2>
              <span className="text-admin-xs text-admin-muted">{checks.length} checks</span>
            </div>
            <div className="divide-y divide-admin-border">
              {checks.map((check) => (
                <div key={check.key} className="grid gap-3 py-3 md:grid-cols-[190px_1fr]">
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase ${STATUS_CLASS[check.status]}`}>{check.status}</span>
                    <span className="text-admin-sm font-semibold text-admin-text-2">{check.label}</span>
                  </div>
                  <div>
                    <p className="text-admin-sm text-admin-text-2">{check.message}</p>
                    {check.detail && (
                      <pre className="mt-2 max-h-36 overflow-auto rounded bg-admin-surface-2 p-3 text-[11px] text-admin-muted">
                        {JSON.stringify(check.detail, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
