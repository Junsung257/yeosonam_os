'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

type Severity = 'critical' | 'high' | 'medium' | 'low';

interface MarketingNextAction {
  id: string;
  product_id: string | null;
  title: string;
  reason: string;
  category: string;
  severity: Severity;
  action_url: string;
  action_label: string;
  automation_level: number;
}

interface MarketingAssetGroup {
  product: {
    id: string;
    title: string;
    destination: string | null;
    status: string | null;
    price: number | null;
    ticketing_deadline: string | null;
    updated_at: string | null;
  };
  readiness_score: number;
  stages: {
    blog: { total: number; published: number; latest_slug: string | null; latest_published_at: string | null };
    card_news: { total: number; confirmed: number; ig_published: number; ig_queued: number; ig_failed: number; threads_published: number };
    ads: { campaigns: number; active_campaigns: number; creatives: number; deployed_creatives: number; total_spend_krw: number };
    distribution: { scheduled: number; published: number; failed: number };
  };
  flags: string[];
  next_actions: MarketingNextAction[];
}

interface ResponseShape {
  checked_at: string;
  groups: MarketingAssetGroup[];
  actions: MarketingNextAction[];
}

const SEVERITY_CLASS: Record<Severity, string> = {
  critical: 'border-red-200 bg-red-50 text-red-700',
  high: 'border-orange-200 bg-orange-50 text-orange-700',
  medium: 'border-amber-200 bg-amber-50 text-amber-700',
  low: 'border-slate-200 bg-slate-50 text-slate-600',
};

function formatWon(value: number | null | undefined) {
  if (!value) return '-';
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}억`;
  if (value >= 10_000) return `${Math.round(value / 10_000)}만`;
  return value.toLocaleString('ko-KR');
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric' }).format(new Date(value));
}

function scoreClass(score: number) {
  if (score >= 80) return 'text-emerald-700';
  if (score >= 55) return 'text-amber-700';
  return 'text-red-700';
}

function canCreateDraft(action: MarketingNextAction) {
  return [
    'deadline-no-active-ads',
    'missing-blog',
    'missing-card-news',
    'missing-campaign',
  ].some((suffix) => action.id.endsWith(`:${suffix}`));
}

export default function MarketingCommandCenterPage() {
  const [data, setData] = useState<ResponseShape | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [applyMessage, setApplyMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/marketing/asset-groups?limit=40', { cache: 'no-store' });
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

  async function applyAction(action: MarketingNextAction) {
    setApplyingId(action.id);
    setApplyMessage(null);
    setError(null);
    try {
      const res = await fetch('/api/admin/marketing/actions/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action_id: action.id, dry_run: false }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? `HTTP ${res.status}`);
      const plan = payload?.plan;
      if (plan?.result?.id) {
        setApplyMessage(`${plan.result.table} draft created: ${plan.result.id}`);
      } else {
        setApplyMessage(plan?.summary ?? 'Action prepared.');
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setApplyingId(null);
    }
  }

  const summary = useMemo(() => {
    const groups = data?.groups ?? [];
    const actions = data?.actions ?? [];
    return {
      products: groups.length,
      avgScore: groups.length ? Math.round(groups.reduce((sum, group) => sum + group.readiness_score, 0) / groups.length) : 0,
      critical: actions.filter((action) => action.severity === 'critical').length,
      high: actions.filter((action) => action.severity === 'high').length,
      ready: groups.filter((group) => group.readiness_score >= 80).length,
    };
  }, [data]);

  const topActions = (data?.actions ?? []).slice(0, 8);
  const groups = (data?.groups ?? []).slice().sort((a, b) => a.readiness_score - b.readiness_score);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-admin-lg font-bold text-admin-text-2">Marketing Command Center</h1>
          <p className="mt-1 text-admin-sm text-admin-muted">
            Product-level asset groups, readiness scoring, and next-best actions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="rounded-lg bg-blue-600 px-4 py-2 text-admin-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
          <Link href="/admin/marketing/system-health" className="rounded-lg border border-admin-border-strong bg-white px-4 py-2 text-admin-sm font-medium text-admin-text-2 hover:bg-admin-bg">
            System Health
          </Link>
          <Link href="/admin/marketing" className="rounded-lg border border-admin-border-strong bg-white px-4 py-2 text-admin-sm font-medium text-admin-text-2 hover:bg-admin-bg">
            Dashboard
          </Link>
        </div>
      </div>

      {error && (
        <div className="rounded-admin-md border border-red-200 bg-red-50 p-4 text-admin-sm text-red-700">
          Command Center failed: {error}
        </div>
      )}
      {applyMessage && (
        <div className="rounded-admin-md border border-emerald-200 bg-emerald-50 p-4 text-admin-sm text-emerald-700">
          {applyMessage}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-5">
        <div className="rounded-admin-md border border-admin-border-mid bg-white p-4">
          <p className="text-admin-xs font-semibold uppercase text-admin-muted">Products</p>
          <p className="mt-2 text-2xl font-bold text-admin-text-2">{loading && !data ? '--' : summary.products}</p>
        </div>
        <div className="rounded-admin-md border border-admin-border-mid bg-white p-4">
          <p className="text-admin-xs font-semibold uppercase text-admin-muted">Avg Readiness</p>
          <p className={`mt-2 text-2xl font-bold ${scoreClass(summary.avgScore)}`}>{loading && !data ? '--' : `${summary.avgScore}%`}</p>
        </div>
        <div className="rounded-admin-md border border-admin-border-mid bg-white p-4">
          <p className="text-admin-xs font-semibold uppercase text-admin-muted">Ready</p>
          <p className="mt-2 text-2xl font-bold text-emerald-700">{summary.ready}</p>
        </div>
        <div className="rounded-admin-md border border-admin-border-mid bg-white p-4">
          <p className="text-admin-xs font-semibold uppercase text-admin-muted">Critical</p>
          <p className="mt-2 text-2xl font-bold text-red-700">{summary.critical}</p>
        </div>
        <div className="rounded-admin-md border border-admin-border-mid bg-white p-4">
          <p className="text-admin-xs font-semibold uppercase text-admin-muted">High</p>
          <p className="mt-2 text-2xl font-bold text-orange-700">{summary.high}</p>
        </div>
      </div>

      <section className="rounded-admin-md border border-admin-border-mid bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-admin-base font-semibold text-admin-text-2">Next Best Actions</h2>
          <span className="text-admin-xs text-admin-muted">{topActions.length} shown</span>
        </div>
        {loading && !data ? (
          <div className="py-8 text-center text-admin-sm text-admin-muted">Loading actions...</div>
        ) : topActions.length === 0 ? (
          <div className="py-8 text-center text-admin-sm text-admin-muted">No urgent actions.</div>
        ) : (
          <div className="divide-y divide-admin-border">
            {topActions.map((action) => (
              <div key={action.id} className="grid gap-3 py-3 md:grid-cols-[120px_1fr_auto] md:items-center">
                <div>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase ${SEVERITY_CLASS[action.severity]}`}>
                    {action.severity}
                  </span>
                </div>
                <div>
                  <p className="text-admin-sm font-semibold text-admin-text-2">{action.title}</p>
                  <p className="mt-1 text-admin-xs text-admin-muted">{action.reason}</p>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  {canCreateDraft(action) && (
                    <button
                      type="button"
                      onClick={() => applyAction(action)}
                      disabled={applyingId === action.id}
                      className="rounded-lg bg-blue-600 px-3 py-2 text-admin-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {applyingId === action.id ? 'Applying...' : 'Create draft'}
                    </button>
                  )}
                  <Link href={action.action_url} className="rounded-lg border border-admin-border-strong px-3 py-2 text-center text-admin-xs font-semibold text-admin-text-2 hover:bg-admin-bg">
                    {action.action_label}
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-admin-md border border-admin-border-mid bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-admin-base font-semibold text-admin-text-2">Product Asset Groups</h2>
          <span className="text-admin-xs text-admin-muted">Lowest readiness first</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-admin-sm">
            <thead className="text-admin-xs uppercase text-admin-muted">
              <tr>
                <th className="border-b border-admin-border py-2 pr-3">Product</th>
                <th className="border-b border-admin-border py-2 pr-3">Score</th>
                <th className="border-b border-admin-border py-2 pr-3">Blog</th>
                <th className="border-b border-admin-border py-2 pr-3">Card News</th>
                <th className="border-b border-admin-border py-2 pr-3">Ads</th>
                <th className="border-b border-admin-border py-2 pr-3">Distribution</th>
                <th className="border-b border-admin-border py-2 pr-3">Deadline</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.product.id}>
                  <td className="border-b border-admin-border py-3 pr-3">
                    <div className="font-semibold text-admin-text-2">{group.product.title}</div>
                    <div className="mt-1 text-admin-xs text-admin-muted">{group.product.destination ?? '-'} / {formatWon(group.product.price)}</div>
                  </td>
                  <td className={`border-b border-admin-border py-3 pr-3 font-bold ${scoreClass(group.readiness_score)}`}>{group.readiness_score}%</td>
                  <td className="border-b border-admin-border py-3 pr-3">{group.stages.blog.published}/{group.stages.blog.total}</td>
                  <td className="border-b border-admin-border py-3 pr-3">
                    {group.stages.card_news.total} total / {group.stages.card_news.ig_published} IG
                  </td>
                  <td className="border-b border-admin-border py-3 pr-3">
                    {group.stages.ads.active_campaigns}/{group.stages.ads.campaigns} active / {group.stages.ads.deployed_creatives} creative
                  </td>
                  <td className="border-b border-admin-border py-3 pr-3">
                    {group.stages.distribution.published} pub / {group.stages.distribution.failed} fail
                  </td>
                  <td className="border-b border-admin-border py-3 pr-3 text-admin-muted">{formatDate(group.product.ticketing_deadline)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
