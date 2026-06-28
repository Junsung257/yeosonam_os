import { describe, expect, it } from 'vitest';
import { FREE_TRAVEL_SCENARIO_CASES } from './scenario-cases';
import { evaluateFreeTravel100Scenarios } from './scenario-evaluator';

describe('free travel 100 scenario evaluator', () => {
  it('passes the executable 100-scenario corpus with the expected priority mix', () => {
    const summary = evaluateFreeTravel100Scenarios();

    expect(FREE_TRAVEL_SCENARIO_CASES).toHaveLength(100);
    expect(summary.status).toBe('pass');
    expect(summary.score).toBe(100);
    expect(summary.passed).toBe(100);
    expect(summary.priorityCounts).toEqual({ P0: 30, P1: 40, P2: 30 });
    expect(summary.p0Failures).toEqual([]);
  });

  it('fails the release gate when a P0 scenario loses its guardrail evidence', () => {
    const broken = FREE_TRAVEL_SCENARIO_CASES.map((scenario) => (
      scenario.id === 1
        ? {
          ...scenario,
          expected: {
            ...scenario.expected,
            api: scenario.expected.api.filter((item) => item !== 'p0_guardrail'),
          },
        }
        : scenario
    ));
    const summary = evaluateFreeTravel100Scenarios(broken);

    expect(summary.status).toBe('fail');
    expect(summary.p0Failures.map((failure) => failure.id)).toContain(1);
  });
});
