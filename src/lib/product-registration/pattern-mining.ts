import type { ImprovementLedgerEvent } from './improvement-ledger';

export type PatternCandidateKind =
  | 'blocker_signature'
  | 'supplier_format'
  | 'deterministic_fix'
  | 'schedule_pollution'
  | 'render_failure';

export type PatternCandidate = {
  id: string;
  kind: PatternCandidateKind;
  signature: string;
  evidenceCount: number;
  successCount: number;
  failureCount: number;
  autoFixSuccessRate: number | null;
  risk: 'low' | 'medium' | 'high';
  exampleRawTextHashes: string[];
  recommendedAction: string;
  promotionReady: boolean;
};

export type MacroPatternMiningReport = {
  totalEvents: number;
  failedOrReviewNeededEvents: number;
  candidates: PatternCandidate[];
  shouldRun: boolean;
  runReasons: string[];
};

function pushCount(map: Map<string, ImprovementLedgerEvent[]>, key: string, event: ImprovementLedgerEvent): void {
  if (!key) return;
  map.set(key, [...(map.get(key) ?? []), event]);
}

function uniqueHashes(events: ImprovementLedgerEvent[]): string[] {
  return [...new Set(events.map(event => event.rawTextHash))].slice(0, 5);
}

function scoreCandidate(input: {
  kind: PatternCandidateKind;
  signature: string;
  events: ImprovementLedgerEvent[];
}): PatternCandidate {
  const successCount = input.events.filter(event => event.finalStatus === 'PASS' || event.finalStatus === 'AUTO_FIXED').length;
  const failureCount = input.events.length - successCount;
  const deterministicFixCount = input.events.filter(event =>
    event.autoFixesApplied.some(fix => fix.kind === 'deterministic'),
  ).length;
  const autoFixSuccessRate = deterministicFixCount > 0
    ? successCount / deterministicFixCount
    : null;
  const risk = failureCount >= successCount && failureCount >= 3
    ? 'high'
    : failureCount > 0
      ? 'medium'
      : 'low';
  const promotionReady = input.events.length >= 3
    && risk !== 'high'
    && (autoFixSuccessRate == null || autoFixSuccessRate >= 0.8);

  return {
    id: `${input.kind}:${input.signature}`.slice(0, 180),
    kind: input.kind,
    signature: input.signature,
    evidenceCount: input.events.length,
    successCount,
    failureCount,
    autoFixSuccessRate,
    risk,
    exampleRawTextHashes: uniqueHashes(input.events),
    recommendedAction: promotionReady
      ? 'Promote to reviewed parser-rule candidate with fixture coverage.'
      : 'Keep collecting evidence or route to human review before promotion.',
    promotionReady,
  };
}

function candidateGroups(events: ImprovementLedgerEvent[]): Array<{
  kind: PatternCandidateKind;
  signature: string;
  events: ImprovementLedgerEvent[];
}> {
  const groups: Array<{ kind: PatternCandidateKind; map: Map<string, ImprovementLedgerEvent[]> }> = [
    { kind: 'blocker_signature', map: new Map() },
    { kind: 'supplier_format', map: new Map() },
    { kind: 'deterministic_fix', map: new Map() },
    { kind: 'schedule_pollution', map: new Map() },
    { kind: 'render_failure', map: new Map() },
  ];
  const byKind = new Map(groups.map(group => [group.kind, group.map]));

  for (const event of events) {
    for (const signature of event.normalizedBlockerSignatures) {
      pushCount(byKind.get('blocker_signature')!, signature, event);
    }
    pushCount(byKind.get('supplier_format')!, event.detectedFormat, event);
    for (const fix of event.autoFixesApplied) {
      if (fix.kind === 'deterministic') pushCount(byKind.get('deterministic_fix')!, fix.field, event);
    }
    for (const removed of event.autoFixesApplied.filter(fix => fix.field.includes('schedule'))) {
      pushCount(byKind.get('schedule_pollution')!, removed.reason, event);
    }
    for (const failure of [...event.packagesAudit.failures, ...event.a4Audit.failures]) {
      pushCount(byKind.get('render_failure')!, failure, event);
    }
  }

  return groups.flatMap(group =>
    [...group.map.entries()].map(([signature, groupedEvents]) => ({
      kind: group.kind,
      signature,
      events: groupedEvents,
    })),
  );
}

export function mineProductRegistrationPatterns(input: {
  events: ImprovementLedgerEvent[];
  minEvents?: number;
  minFailedOrReviewNeeded?: number;
  minRepeatedBlockers?: number;
  supplierFailureRateThreshold?: number;
}): MacroPatternMiningReport {
  const minEvents = input.minEvents ?? 50;
  const minFailedOrReviewNeeded = input.minFailedOrReviewNeeded ?? 10;
  const minRepeatedBlockers = input.minRepeatedBlockers ?? 5;
  const supplierFailureRateThreshold = input.supplierFailureRateThreshold ?? 0.2;
  const failedOrReviewNeededEvents = input.events.filter(event =>
    event.finalStatus === 'REVIEW_NEEDED' || event.finalStatus === 'BLOCKED',
  );
  const grouped = candidateGroups(input.events);
  const repeatedBlockerCount = grouped.filter(group =>
    group.kind === 'blocker_signature' && group.events.length >= minRepeatedBlockers,
  ).length;
  const supplierFormatNeedsReview = grouped.some(group => {
    if (group.kind !== 'supplier_format' || group.events.length < 3) return false;
    const failures = group.events.filter(event => event.finalStatus === 'REVIEW_NEEDED' || event.finalStatus === 'BLOCKED').length;
    return failures / group.events.length > supplierFailureRateThreshold;
  });

  const runReasons = [
    input.events.length >= minEvents ? `events:${input.events.length}>=${minEvents}` : null,
    failedOrReviewNeededEvents.length >= minFailedOrReviewNeeded ? `failed_or_review:${failedOrReviewNeededEvents.length}>=${minFailedOrReviewNeeded}` : null,
    repeatedBlockerCount > 0 ? `repeated_blockers:${repeatedBlockerCount}` : null,
    supplierFormatNeedsReview ? 'supplier_failure_rate_exceeded' : null,
  ].filter((reason): reason is string => Boolean(reason));

  const candidates = grouped
    .filter(group => group.events.length >= 2)
    .map(scoreCandidate)
    .sort((a, b) => {
      if (a.promotionReady !== b.promotionReady) return a.promotionReady ? -1 : 1;
      return b.evidenceCount - a.evidenceCount;
    });

  return {
    totalEvents: input.events.length,
    failedOrReviewNeededEvents: failedOrReviewNeededEvents.length,
    candidates,
    shouldRun: runReasons.length > 0,
    runReasons,
  };
}
