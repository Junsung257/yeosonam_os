import { describe, expect, it } from 'vitest';
import {
  buildCompletionFallbackRequirements,
  completionAuditTone,
  selectOperatorCriticalRequirements,
  type CompletionAuditView,
} from './ad-os-completion-view';

describe('ad-os-completion-view', () => {
  it('maps completion audit statuses to dashboard tones', () => {
    expect(completionAuditTone('ready')).toBe('good');
    expect(completionAuditTone('needs_attention')).toBe('warn');
    expect(completionAuditTone('blocked')).toBe('bad');
    expect(completionAuditTone()).toBe('neutral');
  });

  it('selects only operator-critical completion requirements', () => {
    const audit: CompletionAuditView = {
      status: 'blocked',
      readiness_score: 70,
      passed: 2,
      warnings: 1,
      failed: 1,
      top_blocker: 'External write safety',
      next_action: 'Review execution logs.',
      requirements: [
        { id: 'learning_loop_margin_fact', label: 'Learning', status: 'warn', evidence: 'missing', next_action: 'Sync facts' },
        { id: 'external_write_zero', label: 'External write', status: 'pass', evidence: '0 writes', next_action: 'Keep gated' },
        { id: 'full_auto_default_off', label: 'Full auto', status: 'pass', evidence: 'off', next_action: 'Keep off' },
        { id: 'tenant_budget_guardrails', label: 'Budget', status: 'warn', evidence: 'cap missing', next_action: 'Set caps' },
        { id: 'incident_response_clear', label: 'Incidents', status: 'fail', evidence: 'critical 1', next_action: 'Clear incident' },
      ],
    };

    expect(selectOperatorCriticalRequirements(audit).map((row) => row.id)).toEqual([
      'external_write_zero',
      'full_auto_default_off',
      'tenant_budget_guardrails',
      'incident_response_clear',
    ]);
  });

  it('builds blocked fallback evidence when the audit is unavailable', () => {
    expect(buildCompletionFallbackRequirements('HTTP 503')).toEqual([{
      id: 'completion_evidence_unavailable',
      label: 'Audit evidence',
      status: 'fail',
      evidence: 'HTTP 503',
      next_action: 'Recover /api/admin/ad-os/summary and /api/admin/ad-os/completion-audit.',
    }]);
  });
});
