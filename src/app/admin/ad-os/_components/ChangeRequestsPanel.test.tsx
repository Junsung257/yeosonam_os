import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ChangeRequestsPanel } from './ChangeRequestsPanel';

describe('Ad OS ChangeRequestsPanel', () => {
  it('renders proposed and approved change request actions', () => {
    const html = renderToStaticMarkup(
      <ChangeRequestsPanel
        count={3}
        loadingId="change-1"
        onUpdate={vi.fn()}
        rows={[
          {
            id: 'change-1',
            title: 'Raise max CPC',
            platform: 'naver',
            risk_level: 'high',
            status: 'proposed',
            reason: 'Needs approval before pilot.',
          },
          {
            id: 'change-rsa',
            title: 'Google RSA copy',
            platform: 'google',
            request_type: 'create_creative_draft',
            target_table: 'ad_os_creative_asset_variants',
            risk_level: 'medium',
            status: 'proposed',
            reason: 'Search Ads RSA draft generated from product signals.',
          },
          {
            id: 'change-2',
            title: 'Apply safe copy',
            platform: 'internal',
            risk_level: 'low',
            status: 'approved',
            reason: 'Ready to apply.',
          },
          {
            id: 'change-portfolio',
            title: 'Portfolio optimizer: scale_winner',
            platform: 'google',
            request_type: 'budget_change',
            target_table: 'ad_os_portfolio_budget_plans',
            risk_level: 'medium',
            status: 'proposed',
            reason: 'Move budget toward margin-positive search terms.',
          },
        ]}
      />,
    );

    expect(html).toContain('Change requests');
    expect(html).toContain('Portfolio approvals 1');
    expect(html).toContain('Portfolio optimizer');
    expect(html).toContain('Portfolio optimizer: scale_winner');
    expect(html).toContain('Google RSA drafts 1');
    expect(html).toContain('Google RSA draft');
    expect(html).toContain('Google RSA copy');
    expect(html).toContain('Raise max CPC');
    expect(html).toContain('Approve');
    expect(html).toContain('Reject');
    expect(html).toContain('Apply safe copy');
    expect(html).toContain('Apply');
    expect(html).toContain('Roll back');
  });

  it('renders empty state when no change requests are waiting', () => {
    const html = renderToStaticMarkup(
      <ChangeRequestsPanel count={0} rows={[]} loadingId={null} onUpdate={vi.fn()} />,
    );

    expect(html).toContain('No change requests are waiting for approval.');
  });
});
