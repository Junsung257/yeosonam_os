import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { OpsQueueList } from './OpsQueueList';

describe('Ad OS OpsQueueList', () => {
  it('renders empty state without action buttons', () => {
    const html = renderToStaticMarkup(<OpsQueueList rows={[]} empty="No queued work" />);

    expect(html).toContain('No queued work');
    expect(html).not.toContain('Dry-run');
  });

  it('renders status, platform label, reason, next action, and gated action buttons', () => {
    const html = renderToStaticMarkup(
      <OpsQueueList
        rows={[
          {
            id: 'job-1',
            title: 'Keyword dry run',
            source: 'platform_job',
            platform: 'naver',
            status: 'approved',
            reason: 'ready for dry-run',
            next_action: 'operator confirms result',
          },
        ]}
        empty="No queued work"
        loadingId="platform_job:job-1:executor_dry_run"
        onAction={vi.fn()}
        actions={['executor_dry_run', 'confirm_failed', 'acknowledge_blocker']}
      />,
    );

    expect(html).toContain('Keyword dry run');
    expect(html).toContain('네이버');
    expect(html).toContain('approved');
    expect(html).toContain('ready for dry-run');
    expect(html).toContain('operator confirms result');
    expect(html).toContain('Dry-run');
    expect(html).toContain('차단 확인');
    expect(html).not.toContain('실패 확정');
  });
});
