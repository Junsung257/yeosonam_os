import { describe, expect, it } from 'vitest';
import { evaluateJarvisGoldenSet } from './offline-evaluator';

describe('Jarvis offline golden-set evaluator', () => {
  it('passes every deterministic guardrail/HITL/orchestration case', () => {
    const summary = evaluateJarvisGoldenSet();

    expect(summary.total).toBeGreaterThanOrEqual(8);
    expect(summary.failed).toBe(0);
    expect(summary.passRate).toBe(1);
  });
});
