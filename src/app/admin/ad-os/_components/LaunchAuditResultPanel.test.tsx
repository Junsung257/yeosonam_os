import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { LaunchAudit } from '../_lib/types';
import { LaunchAuditResultPanel } from './LaunchAuditResultPanel';

const launchAudit: LaunchAudit = {
  readiness: {
    pass: 3,
    warn: 1,
    fail: 1,
    total: 5,
    today_launch_ready: false,
    next_action: 'Resolve publisher approval before launch.',
  },
  items: [
    {
      id: 'budget',
      label: 'Budget guardrail',
      status: 'pass',
      evidence: 'Daily cap and max CPC are configured.',
      next_action: 'Keep caps unchanged for pilot.',
    },
    {
      id: 'publisher',
      label: 'Publisher approval',
      status: 'fail',
      evidence: 'External account approval is missing.',
      next_action: 'Attach publisher approval evidence.',
    },
  ],
};

describe('Ad OS LaunchAuditResultPanel', () => {
  it('renders launch audit readiness counts and evidence', () => {
    const html = renderToStaticMarkup(<LaunchAuditResultPanel launchAudit={launchAudit} />);

    expect(html).toContain('Launch audit result');
    expect(html).toContain('Resolve publisher approval before launch.');
    expect(html).toContain('pass 3');
    expect(html).toContain('warn 1');
    expect(html).toContain('fail 1');
    expect(html).toContain('Budget guardrail');
    expect(html).toContain('Daily cap and max CPC are configured.');
    expect(html).toContain('Attach publisher approval evidence.');
  });

  it('renders nothing before launch audit data exists', () => {
    const html = renderToStaticMarkup(<LaunchAuditResultPanel launchAudit={null} />);

    expect(html).toBe('');
  });
});
