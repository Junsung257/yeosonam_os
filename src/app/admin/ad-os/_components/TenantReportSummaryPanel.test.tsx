import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TenantReportSummaryPanel, type TenantReportBody } from './TenantReportSummaryPanel';

const report: TenantReportBody = {
  budget_usage_pct: 35,
  revenue_roas_pct: 280,
  margin_roas_pct: 120,
  cpa_krw: 15000,
  paused_waste_keywords: 4,
  discovered_cheap_keywords: 9,
  keyword_clusters: 3,
  external_mutations: 0,
  next_actions: ['Review low-margin terms.', 'Keep external writes in dry-run.'],
};

describe('Ad OS TenantReportSummaryPanel', () => {
  it('renders tenant report metrics, period, and next actions', () => {
    const html = renderToStaticMarkup(
      <TenantReportSummaryPanel
        report={report}
        period={{ from: '2026-06-01', to: '2026-06-05' }}
      />,
    );

    expect(html).toContain('Tenant report summary');
    expect(html).toContain('2026-06-01');
    expect(html).toContain('2026-06-05');
    expect(html).toContain('Budget usage');
    expect(html).toContain('35%');
    expect(html).toContain('Revenue ROAS');
    expect(html).toContain('280%');
    expect(html).toContain('CPA');
    expect(html).toContain('2만원');
    expect(html).toContain('Review low-margin terms.');
  });

  it('renders nothing before report data exists', () => {
    const html = renderToStaticMarkup(
      <TenantReportSummaryPanel report={undefined} period={undefined} />,
    );

    expect(html).toBe('');
  });
});
