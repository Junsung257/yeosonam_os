import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { StagingSmoke, Summary } from '../_lib/types';
import { CompletionAuditPanel } from './CompletionAuditPanel';

type CompletionAudit = NonNullable<NonNullable<Summary['enterprise_layer']>['completion_audit']>;

const completionAuditFixture: CompletionAudit = {
  status: 'needs_attention',
  readiness_score: 88,
  passed: 7,
  warnings: 1,
  failed: 0,
  top_blocker: 'Smoke evidence needs review.',
  next_action: 'Review staging smoke before completion.',
  requirements: [
    {
      id: 'smoke',
      label: 'Staging smoke',
      status: 'warn',
      evidence: 'Smoke ran in read-only mode.',
      next_action: 'Attach latest smoke output.',
    },
  ],
};

const smokeFixture: StagingSmoke = {
  ok: true,
  checked_at: '2026-06-05T00:00:00.000Z',
  source: 'fixture',
  smoke: {
    status: 'pass',
    passed_assertions: 11,
    failed_assertions: 0,
    next_action: 'Smoke is ready.',
    counts: {
      scenarios: 2,
      keywords: 34,
      intent_signals: 5,
      creative_variants: 8,
      platform_jobs: 1,
      conversion_upload_jobs: 1,
      portfolio_plans: 1,
    },
    evidence: {
      package_id: 'pkg_1',
      platform_job_status: 'dry_run',
      conversion_upload_status: 'dry_run',
      external_api_write_zero: true,
    },
  },
  safety: {
    read_only: true,
    external_api_write: false,
    database_mutation: false,
    fixture_only: true,
    external_spend_krw: 0,
  },
};

describe('Ad OS CompletionAuditPanel', () => {
  it('renders completion audit, staging smoke metrics, safety state, and evidence', () => {
    const html = renderToStaticMarkup(
      <CompletionAuditPanel
        completionAudit={completionAuditFixture}
        completionDrilldown={completionAuditFixture.requirements}
        highlighted
        stagingSmoke={smokeFixture}
        checkingStagingSmoke={false}
        onRunStagingSmoke={() => {}}
      />,
    );

    expect(html).toContain('Completion Audit');
    expect(html).toContain('88%');
    expect(html).toContain('Staging Smoke');
    expect(html).toContain('11 / 11');
    expect(html).toContain('Smoke ran in read-only mode.');
    expect(html).toContain('DB write off - external write off');
    expect(html).toContain('ring-2');
  });

  it('renders empty and not-checked states before data is loaded', () => {
    const html = renderToStaticMarkup(
      <CompletionAuditPanel
        completionDrilldown={[]}
        highlighted={false}
        stagingSmoke={null}
        checkingStagingSmoke={false}
        onRunStagingSmoke={() => {}}
      />,
    );

    expect(html).toContain('unknown');
    expect(html).toContain('not checked');
    expect(html).toContain('No completion evidence loaded.');
  });
});
