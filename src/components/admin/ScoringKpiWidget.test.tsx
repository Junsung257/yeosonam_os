import { describe, expect, it } from 'vitest';
import { normalizeScoringKpiStats } from './ScoringKpiWidget';

describe('normalizeScoringKpiStats', () => {
  it('fills missing scoring widget fields with safe dashboard defaults', () => {
    const stats = normalizeScoringKpiStats({ active_policy_version: null });

    expect(stats).toMatchObject({
      active_policy_version: null,
      total_groups: 0,
      total_score_rows: 0,
      ltr_samples: 0,
      ltr_ready: false,
      unacked_alerts: 0,
      recent_winner: null,
    });
  });

  it('keeps valid KPI values and drops malformed recent winner fields', () => {
    const stats = normalizeScoringKpiStats({
      active_policy_version: 'v3.7',
      total_groups: 12,
      total_score_rows: 240,
      ltr_samples: 1000,
      ltr_ready: true,
      unacked_alerts: 3,
      recent_winner: { policy_version: 42, confidence: Number.NaN },
    });

    expect(stats).toMatchObject({
      active_policy_version: 'v3.7',
      total_groups: 12,
      total_score_rows: 240,
      ltr_samples: 1000,
      ltr_ready: true,
      unacked_alerts: 3,
      recent_winner: { policy_version: null, confidence: null },
    });
  });
});
