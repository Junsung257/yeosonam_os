export interface BlogSearchRefreshObservationV4 {
  impressions?: number | null;
  clicks?: number | null;
  position?: number | null;
}

export interface BlogSearchRefreshOpportunityV4 {
  eligible: boolean;
  reason: 'position_4_20_refresh' | 'zero_impression_reconsider' | 'position_not_refresh_band';
  impressions: number;
  clicks: number;
  ctr: number;
  averagePosition: number | null;
}

function nonnegative(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * A material refresh requires observed demand. Zero-impression pages are
 * reconsideration/audit candidates, never automatic generation candidates.
 */
export function evaluateBlogSearchRefreshOpportunityV4(
  observations: BlogSearchRefreshObservationV4[],
): BlogSearchRefreshOpportunityV4 {
  let impressions = 0;
  let clicks = 0;
  let weightedPosition = 0;
  let positionWeight = 0;

  for (const observation of observations) {
    const rowImpressions = nonnegative(observation.impressions);
    const rowClicks = nonnegative(observation.clicks);
    const position = Number(observation.position);
    impressions += rowImpressions;
    clicks += rowClicks;
    if (Number.isFinite(position) && position > 0) {
      const weight = Math.max(1, rowImpressions);
      weightedPosition += position * weight;
      positionWeight += weight;
    }
  }

  const averagePosition = positionWeight > 0 ? weightedPosition / positionWeight : null;
  const ctr = impressions > 0 ? clicks / impressions : 0;
  if (impressions <= 0) {
    return {
      eligible: false,
      reason: 'zero_impression_reconsider',
      impressions,
      clicks,
      ctr,
      averagePosition,
    };
  }
  const eligible = averagePosition != null && averagePosition >= 4 && averagePosition <= 20;
  return {
    eligible,
    reason: eligible ? 'position_4_20_refresh' : 'position_not_refresh_band',
    impressions,
    clicks,
    ctr,
    averagePosition,
  };
}
