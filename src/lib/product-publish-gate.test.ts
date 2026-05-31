import { describe, expect, it } from 'vitest';
import { evaluateProductPublishGate } from './product-publish-gate';

describe('evaluateProductPublishGate', () => {
  it('blocks when audit is missing', () => {
    const gate = evaluateProductPublishGate({});
    expect(gate.decision).toBe('block');
    expect(gate.reasons[0]).toContain('감사 상태');
  });

  it('blocks critical quality failures even when audit status is clean', () => {
    const gate = evaluateProductPublishGate({
      auditStatus: 'clean',
      failedChecks: [{ id: 'cove_unknown', severity: 'critical', passed: false, message: '원문에 없는 문장' }],
    });
    expect(gate.decision).toBe('block');
    expect(gate.reasons.join('\n')).toContain('critical');
  });

  it('requires force for warnings', () => {
    const gate = evaluateProductPublishGate({
      auditStatus: 'warnings',
      failedChecks: [{ id: 'mobile_attraction_match_low', severity: 'high', passed: false }],
    });
    expect(gate.decision).toBe('force_required');
    expect(gate.warnings.length).toBeGreaterThan(0);
  });

  it('allows clean audit with no failed quality checks', () => {
    const gate = evaluateProductPublishGate({ auditStatus: 'clean', failedChecks: [] });
    expect(gate.decision).toBe('allow');
  });

  it('blocks when required source evidence coverage is below threshold', () => {
    const gate = evaluateProductPublishGate({
      auditStatus: 'clean',
      sourceEvidence: {
        'meta.airline': [{ rawTextHash: 'h', start: 0, end: 2, quote: 'LJ', confidence: 1, source: 'raw' }],
      },
      requiredEvidenceFields: ['meta.airline', 'meta.minParticipants'],
      minEvidenceCoverage: 1,
    });
    expect(gate.decision).toBe('block');
    expect(gate.reasons.join('\n')).toContain('coverage');
  });

  it('blocks when required source evidence is missing entirely', () => {
    const gate = evaluateProductPublishGate({
      auditStatus: 'clean',
      sourceEvidence: null,
      requiredEvidenceFields: ['meta.airline'],
      minEvidenceCoverage: 1,
    });
    expect(gate.decision).toBe('block');
    expect(gate.reasons.join('\n')).toContain('coverage');
  });
});
