export function verifyBlogReleaseCandidateResponsesV4(input: {
  aiModelCanary: Record<string, unknown>;
  analyticsCanary: Record<string, unknown>;
  rankTracking: Record<string, unknown>;
  dataReadiness: Record<string, unknown>;
}): { passed: true; checks: string[] } {
  const failures: string[] = [];
  const modelResults = input.aiModelCanary.results;
  if (input.aiModelCanary.ok !== true
    || input.aiModelCanary.read_only !== true
    || Number(input.aiModelCanary.model_calls) !== 3
    || !Array.isArray(modelResults)
    || modelResults.length !== 3
    || modelResults.some((result) => (
      !result || typeof result !== 'object' || (result as Record<string, unknown>).passed !== true
    ))) {
    failures.push('ai_model_canary_contract_failed');
  }
  if (input.analyticsCanary.ok !== true
    || input.analyticsCanary.stored !== true
    || Number(input.analyticsCanary.external_delivery_jobs) !== 0
    || !Array.isArray(input.analyticsCanary.errors)
    || input.analyticsCanary.errors.length > 0) {
    failures.push('analytics_canary_contract_failed');
  }
  if (input.rankTracking.ok !== true
    || !Array.isArray(input.rankTracking.requested_dates)
    || !Array.isArray(input.rankTracking.errors)
    || input.rankTracking.errors.length > 0) {
    failures.push('rank_tracking_contract_failed');
  }
  const schema = input.dataReadiness.schemaReadiness as Record<string, unknown> | undefined;
  const parity = input.dataReadiness.snapshotParity as Record<string, unknown> | undefined;
  const remote = input.dataReadiness.remoteSnapshots as Record<string, unknown> | undefined;
  const autopublish = input.dataReadiness.autopublish as Record<string, unknown> | undefined;
  if (input.dataReadiness.ok !== true
    || schema?.fullyReady !== true
    || parity?.parity !== true
    || remote?.catalog !== true
    || remote?.detail !== true
    || Number(input.dataReadiness.analyticsCanary24h) < 1
    || Number(input.dataReadiness.approvedForSlotCount) < 1
    || autopublish?.effectiveMode !== 'draft_only') {
    failures.push('data_readiness_contract_failed');
  }
  if (failures.length > 0) throw new Error(failures.join(','));
  return {
    passed: true,
    checks: ['analytics_canary', 'rank_tracking', 'data_readiness'],
  };
}
