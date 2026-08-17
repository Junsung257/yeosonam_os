import { describe, expect, it } from 'vitest';

import { kernelFindingFromReason } from './publication-policy';

describe('Registration Kernel publication findings', () => {
  it('normalizes a section blocker into the stable KernelFinding contract', () => {
    expect(kernelFindingFromReason(
      'sections[2].variants[0].price_calendar[1]:PRICE_SCOPE_CONFLICT:599000:699000',
      'blocker',
      'policy-test',
    )).toEqual({
      fieldPath: 'sections[2].variants[0].price_calendar[1]',
      severity: 'blocker',
      code: 'PRICE_SCOPE_CONFLICT',
      message: 'sections[2].variants[0].price_calendar[1]:PRICE_SCOPE_CONFLICT:599000:699000',
      sourceAnchor: 'sections[2].variants[0].price_calendar[1]',
      ruleVersion: 'policy-test',
      resolutionState: 'blocked',
    });
  });

  it('gives Korean legacy findings a deterministic stable code', () => {
    const finding = kernelFindingFromReason(
      'sections[0].variants[0].price_calendar[0]: 판매가와 출발일 적용 관계가 불명확합니다.',
      'blocker',
    );
    expect(finding.code).toBe('PRICE_DEPARTURE_SCOPE_AMBIGUOUS');
    expect(finding.fieldPath).toBe('sections[0].variants[0].price_calendar[0]');
  });
});
