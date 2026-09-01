import { describe, expect, it } from 'vitest';
import { autoQueueFromInsights, movingAverageForecast } from './predictive-marketing';

describe('predictive marketing safety boundary', () => {
  it('does not label residual bounds as a fabricated confidence level', () => {
    const forecast = movingAverageForecast(Array.from({ length: 28 }, (_, index) => index % 7), 7, 14);
    expect(forecast).toHaveLength(14);
    expect(forecast.every((point) => point.confidence === undefined)).toBe(true);
  });

  it('never mutates the blog queue from a forecast result', async () => {
    await expect(autoQueueFromInsights({ minPriority: 1, maxInsights: 100 })).resolves.toEqual({
      queued: 0,
      insights: [],
      status: 'automation_disabled',
      reason: 'FORECAST_DOWNSTREAM_MUTATION_FORBIDDEN',
    });
  });
});
