import { fmtWon } from '../_lib/display';
import { StatusPill } from './StatusPill';

export function OpsPlanResultPanel({ opsPlan }: { opsPlan: Record<string, unknown> | null }) {
  if (!opsPlan) return null;

  const publisher = opsPlan.publisher as Record<string, { state?: string; defaultMutationMode?: string }> | undefined;
  const measurement = opsPlan.measurement as Record<string, number | string> | undefined;
  const keywordMining = opsPlan.keyword_mining as {
    candidates?: Array<Record<string, unknown>>;
    duplicate_content_action?: Record<string, unknown>;
  } | undefined;
  const tenantPackaging = opsPlan.tenant_packaging as { productReadinessLabel?: string } | undefined;

  const metrics = [
    ['Naver', String(publisher?.naver?.state || '-')],
    ['Google', String(publisher?.google?.state || '-')],
    ['Mutation', String(publisher?.naver?.defaultMutationMode || 'dry_run')],
    ['Margin ROAS', `${Number(measurement?.margin_roas_pct || 0)}%`],
    ['Keyword candidates', Number(keywordMining?.candidates?.length || 0).toLocaleString('ko-KR')],
    ['Product readiness', String(tenantPackaging?.productReadinessLabel || '-')],
  ];

  return (
    <div className="mt-3 rounded-admin-sm border border-admin-border bg-admin-surface-2 p-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-admin-sm font-semibold text-admin-text">Ops plan result</p>
          <p className="mt-1 text-admin-2xs text-admin-muted">
            Summarizes publisher state, measurement, keyword mining, pacing, creative drafts, and tenant packaging readiness.
          </p>
        </div>
        <StatusPill tone={Number(opsPlan.inserted_change_requests || 0) > 0 ? 'warn' : 'neutral'}>
          CR {Number(opsPlan.inserted_change_requests || 0).toLocaleString('ko-KR')}
        </StatusPill>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-6">
        {metrics.map(([label, value]) => (
          <div key={label} className="rounded-admin-xs bg-admin-surface px-3 py-2">
            <p className="text-admin-2xs text-admin-muted">{label}</p>
            <p className="mt-1 break-words text-admin-xs font-semibold text-admin-text">{value}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
        {(keywordMining?.candidates || []).slice(0, 6).map((candidate) => (
          <div key={String(candidate.keyword)} className="rounded-admin-xs border border-admin-border bg-admin-surface px-3 py-2">
            <p className="text-admin-xs font-semibold text-admin-text">{String(candidate.keyword || '-')}</p>
            <p className="mt-1 text-admin-2xs text-admin-muted">
              {String(candidate.intent || 'intent')} - {fmtWon(Number(candidate.bidKrw || 0))}
            </p>
          </div>
        ))}
      </div>

      <p className="mt-3 text-admin-2xs text-admin-muted">
        Duplicate content action: {String(keywordMining?.duplicate_content_action?.action || '-')} - {String(keywordMining?.duplicate_content_action?.reason || '-')}
      </p>
    </div>
  );
}
