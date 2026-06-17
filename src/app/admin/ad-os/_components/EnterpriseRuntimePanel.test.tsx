import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Summary } from '../_lib/types';
import type {
  EnterpriseRuntimeActionHandlers,
  EnterpriseRuntimeActionLoading,
} from './EnterpriseRuntimeActionBar';
import { EnterpriseRuntimePanel } from './EnterpriseRuntimePanel';

const summary = {
  enterprise_layer: {
    platform_job_queue: {
      total: 1,
      blocked: 0,
      approved_or_running: 1,
      external_api_write_count: 0,
      safety_note: 'No live writes.',
    },
    ops_queues: {
      executor_ready: 1,
      confirmation_pending: 0,
      failed_or_blocked: 0,
      live_writes: 0,
      next_action: 'Review queued dry-run jobs.',
    },
  },
  samples: {
    ops_executor_queue: [{
      id: 'job-1',
      title: 'Runtime dry-run',
      source: 'platform_job',
      status: 'approved',
    }],
    ops_confirmation_queue: [],
    ops_failed_queue: [],
  },
} as unknown as Summary;

describe('Ad OS EnterpriseRuntimePanel', () => {
  it('composes runtime controls and queue evidence', () => {
    const html = renderToStaticMarkup(
      <EnterpriseRuntimePanel
        summary={summary}
        actions={{} as EnterpriseRuntimeActionHandlers}
        loading={{} as EnterpriseRuntimeActionLoading}
        opsQueueActionId={null}
        onOpsQueueAction={vi.fn()}
      />,
    );

    expect(html).toContain('Enterprise runtime');
    expect(html).toContain('external write 0');
    expect(html).toContain('Runtime readiness');
    expect(html).toContain('Operations queue');
    expect(html).toContain('Runtime dry-run');
  });

  it('renders degraded summaries without enterprise queue evidence', () => {
    const html = renderToStaticMarkup(
      <EnterpriseRuntimePanel
        summary={{ enterprise_layer: {}, samples: {} } as unknown as Summary}
        actions={{} as EnterpriseRuntimeActionHandlers}
        loading={{} as EnterpriseRuntimeActionLoading}
        opsQueueActionId={null}
        onOpsQueueAction={vi.fn()}
      />,
    );

    expect(html).toContain('Enterprise runtime');
    expect(html).toContain('external write 0');
    expect(html).not.toContain('Operations queue');
  });
});
