import { fmtWon } from '../_lib/display';
import { StatusPill } from './StatusPill';

export type TenantReportBody = {
  budget_usage_pct?: number;
  revenue_roas_pct?: number;
  margin_roas_pct?: number;
  cpa_krw?: number;
  paused_waste_keywords?: number;
  discovered_cheap_keywords?: number;
  keyword_clusters?: number;
  external_mutations?: number;
  next_actions?: string[];
};
export type TenantReportPeriod = { from?: string; to?: string };

export function TenantReportSummaryPanel({
  report,
  period,
}: {
  report: TenantReportBody | undefined;
  period: TenantReportPeriod | undefined;
}) {
  if (!report) return null;

  const metrics = [
    ['예산 사용률', `${Number(report.budget_usage_pct || 0)}%`],
    ['매출 ROAS', `${Number(report.revenue_roas_pct || 0)}%`],
    ['마진 ROAS', `${Number(report.margin_roas_pct || 0)}%`],
    ['CPA', fmtWon(Number(report.cpa_krw || 0))],
    ['낭비 키워드', Number(report.paused_waste_keywords || 0).toLocaleString('ko-KR')],
    ['저비용 키워드', Number(report.discovered_cheap_keywords || 0).toLocaleString('ko-KR')],
    ['키워드 묶음', Number(report.keyword_clusters || 0).toLocaleString('ko-KR')],
    ['외부 변경', Number(report.external_mutations || 0).toLocaleString('ko-KR')],
  ];

  return (
    <div className="mt-3 rounded-admin-sm border border-admin-border bg-admin-surface-2 p-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-admin-sm font-semibold text-admin-text">광고주 리포트 요약</p>
          <p className="mt-1 text-admin-2xs text-admin-muted">
            예산 사용률, 매출 ROAS, 마진 ROAS, 다음 조치 신호를 한눈에 보여줍니다.
          </p>
        </div>
        <StatusPill tone="neutral">
          {String(period?.from || '')}
          {' ~ '}
          {String(period?.to || '')}
        </StatusPill>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-6">
        {metrics.map(([label, value]) => (
          <div key={label} className="rounded-admin-xs bg-admin-surface px-3 py-2">
            <p className="text-admin-2xs text-admin-muted">{label}</p>
            <p className="mt-1 text-admin-xs font-semibold text-admin-text">{value}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
        {(report.next_actions || []).map((action) => (
          <div key={action} className="rounded-admin-xs border border-admin-border bg-admin-surface px-3 py-2 text-admin-2xs leading-5 text-admin-muted">
            {action}
          </div>
        ))}
      </div>
    </div>
  );
}
