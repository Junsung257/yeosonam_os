export type SectionCacheCanaryRecommendation =
  | 'collect_more_data'
  | 'investigate_quality'
  | 'enable_reduce_input_canary'
  | 'continue_canary';

export type SectionCacheCanaryInput = {
  totalRegistrations: number;
  reduceReadyCount: number;
  reducedChars: number;
  qualityIncidentCount: number;
  minReadySamples?: number;
  maxQualityIncidentRate?: number;
};

export type SectionCacheCanaryResult = {
  recommendation: SectionCacheCanaryRecommendation;
  readyRatio: number;
  qualityIncidentRate: number;
  reason: string;
};

export function evaluateSectionCacheCanary(input: SectionCacheCanaryInput): SectionCacheCanaryResult {
  const minReadySamples = input.minReadySamples ?? 10;
  const maxQualityIncidentRate = input.maxQualityIncidentRate ?? 0.02;
  const total = Math.max(0, input.totalRegistrations);
  const readyRatio = total > 0 ? input.reduceReadyCount / total : 0;
  const qualityIncidentRate = total > 0 ? input.qualityIncidentCount / total : 0;

  if (input.reduceReadyCount < minReadySamples) {
    return {
      recommendation: 'collect_more_data',
      readyRatio,
      qualityIncidentRate,
      reason: `reduce-ready samples ${input.reduceReadyCount}/${minReadySamples}`,
    };
  }

  if (qualityIncidentRate > maxQualityIncidentRate) {
    return {
      recommendation: 'investigate_quality',
      readyRatio,
      qualityIncidentRate,
      reason: `quality incident rate ${(qualityIncidentRate * 100).toFixed(1)}% exceeds ${(maxQualityIncidentRate * 100).toFixed(1)}%`,
    };
  }

  if (input.reducedChars > 0) {
    return {
      recommendation: 'continue_canary',
      readyRatio,
      qualityIncidentRate,
      reason: 'input reduction is already producing measurable savings',
    };
  }

  return {
    recommendation: 'enable_reduce_input_canary',
    readyRatio,
    qualityIncidentRate,
    reason: 'reduce-ready coverage is sufficient and quality incidents are low',
  };
}
