import { StatusPill } from './StatusPill';

export function NaverAssetPlanPanel({ plan }: { plan: Record<string, unknown> | null }) {
  if (!plan) return null;

  const summary = plan.summary as Record<string, number> | undefined;
  const body = plan.plan as { mutations?: Array<Record<string, unknown>>; nextAction?: string } | undefined;
  const mutations = body?.mutations || [];

  return (
    <div className="mt-3 rounded-admin-sm border border-admin-border bg-admin-surface-2 p-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-admin-sm font-semibold text-admin-text">Naver asset plan</p>
          <p className="mt-1 text-admin-2xs text-admin-muted">
            Prepares campaign, ad group, and paused keyword mutations with audit evidence before any guarded approval.
          </p>
        </div>
        <StatusPill tone={Number(summary?.inserted_change_requests || 0) > 0 ? 'warn' : 'neutral'}>
          CR {Number(summary?.inserted_change_requests || 0).toLocaleString('ko-KR')}
        </StatusPill>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-4">
        {mutations.map((mutation) => (
          <div key={String(mutation.mutationType)} className="rounded-admin-xs border border-admin-border bg-admin-surface px-3 py-2">
            <p className="text-admin-xs font-semibold text-admin-text">{String(mutation.title || mutation.mutationType || '-')}</p>
            <p className="mt-1 text-admin-2xs text-admin-muted">{String(mutation.requestType || '-')} - guarded approval</p>
          </div>
        ))}
      </div>

      <p className="mt-3 text-admin-2xs text-admin-muted">
        Next action: {String(body?.nextAction || '-')}
      </p>
    </div>
  );
}
