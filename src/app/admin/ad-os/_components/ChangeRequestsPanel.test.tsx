import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ChangeRequestsPanel } from './ChangeRequestsPanel';

describe('Ad OS ChangeRequestsPanel', () => {
  it('renders proposed and approved change request actions', () => {
    const html = renderToStaticMarkup(
      <ChangeRequestsPanel
        count={2}
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
            id: 'change-2',
            title: 'Apply safe copy',
            platform: 'internal',
            risk_level: 'low',
            status: 'approved',
            reason: 'Ready to apply.',
          },
        ]}
      />,
    );

    expect(html).toContain('Change requests');
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
