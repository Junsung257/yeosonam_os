import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { StagingValidation } from '../_lib/types';
import { StagingValidationPanel } from './StagingValidationPanel';

const validationFixture: StagingValidation = {
  ok: true,
  generated_at: '2026-06-05T00:00:00.000Z',
  validation: {
    status: 'pass',
    readiness_score: 92,
    passed: 6,
    warnings: 0,
    failed: 0,
    top_blocker: null,
    next_action: 'Staging validation is ready for operator review.',
    checks: [
      {
        id: 'read-only-smoke',
        label: 'Read-only smoke',
        status: 'pass',
        evidence: 'No database or external API writes were observed.',
        next_action: 'Keep this guardrail active.',
      },
    ],
    safety: {
      read_only: true,
      database_mutation: false,
      external_api_write: false,
      live_spend_krw: 0,
      full_auto_allowed: false,
    },
  },
};

describe('Ad OS StagingValidationPanel', () => {
  it('renders validation status, metrics, evidence, and safety gates', () => {
    const html = renderToStaticMarkup(
      <StagingValidationPanel stagingValidation={validationFixture} checking={false} onRefresh={() => {}} />,
    );

    expect(html).toContain('Staging Validation Package');
    expect(html).toContain('Staging validation is ready for operator review.');
    expect(html).toContain('92%');
    expect(html).toContain('Read-only smoke');
    expect(html).toContain('No database or external API writes were observed.');
    expect(html).toContain('DB write off - external write off - full auto off');
  });

  it('renders the empty state before validation data is loaded', () => {
    const html = renderToStaticMarkup(
      <StagingValidationPanel stagingValidation={null} checking={false} onRefresh={() => {}} />,
    );

    expect(html).toContain('not checked');
    expect(html).toContain('Review the staging validation package.');
    expect(html).toContain('Run validation check to load smoke');
  });
});
