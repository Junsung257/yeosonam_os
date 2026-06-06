import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { EnterpriseOpsQueuePanel } from './EnterpriseOpsQueuePanel';

describe('Ad OS EnterpriseOpsQueuePanel', () => {
  it('renders queue counts and gated queue actions', () => {
    const html = renderToStaticMarkup(
      <EnterpriseOpsQueuePanel
        opsQueues={{
          executor_ready: 1,
          confirmation_pending: 1,
          failed_or_blocked: 1,
          live_writes: 0,
          next_action: 'Review dry-run output before approval.',
        }}
        executorRows={[
          {
            id: 'job-1',
            title: 'Naver keyword dry-run',
            source: 'platform_job',
            platform: 'naver',
            status: 'approved',
            reason: 'Ready for dry-run',
          },
        ]}
        confirmationRows={[
          {
            id: 'confirm-1',
            title: 'Failed upload confirmation',
            source: 'platform_job_confirmation',
            platform: 'google',
            status: 'failed',
            next_action: 'Confirm failed result.',
          },
        ]}
        failedRows={[
          {
            id: 'blocked-1',
            title: 'Blocked write packet',
            source: 'platform_job',
            platform: 'naver',
            status: 'blocked',
            reason: 'Missing approval.',
            next_action: 'Acknowledge blocker.',
          },
        ]}
        loadingId="platform_job:job-1:executor_dry_run"
        onAction={vi.fn()}
      />,
    );

    expect(html).toContain('Operations queue');
    expect(html).toContain('Review dry-run output before approval.');
    expect(html).toContain('executor 1');
    expect(html).toContain('confirm 1');
    expect(html).toContain('blocked 1');
    expect(html).toContain('live write 0');
    expect(html).toContain('Naver keyword dry-run');
    expect(html).toContain('Dry-run');
    expect(html).toContain('Failed upload confirmation');
    expect(html).toContain('Blocked write packet');
  });

  it('renders stable empty states before queues are loaded', () => {
    const html = renderToStaticMarkup(
      <EnterpriseOpsQueuePanel
        opsQueues={undefined}
        executorRows={[]}
        confirmationRows={[]}
        failedRows={[]}
        loadingId={null}
        onAction={vi.fn()}
      />,
    );

    expect(html).toContain('Review ready execution jobs');
    expect(html).toContain('No approved execution jobs');
    expect(html).toContain('No failed external result confirmation');
    expect(html).toContain('No blocked job or failed executor attempt');
  });
});
