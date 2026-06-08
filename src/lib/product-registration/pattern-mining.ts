import type { ImprovementLedgerEvent } from './improvement-ledger';

export type PatternCandidateKind =
  | 'blocker_signature'
  | 'supplier_format'
  | 'deterministic_fix'
  | 'schedule_pollution'
  | 'render_failure'
  | 'section_heading_alias'
  | 'price_table_alias'
  | 'itinerary_column_alias'
  | 'optional_tour_phrase'
  | 'include_exclude_stop_heading'
  | 'hotel_room_grade_alias'
  | 'flight_time_vehicle_pollution'
  | 'entity_classification_pattern'
  | 'regional_meal_alias'
  | 'regional_transfer_alias'
  | 'shopping_phrase_pattern'
  | 'optional_tour_phrase_pattern'
  | 'hotel_alias_pattern'
  | 'non_attraction_noise_pattern'
  | 'attraction_alias_candidate';

export type PatternCandidate = {
  id: string;
  kind: PatternCandidateKind;
  signature: string;
  evidenceCount: number;
  independentSourceCount: number;
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

function uniqueHashCount(events: ImprovementLedgerEvent[]): number {
  return new Set(events.map(event => event.rawTextHash)).size;
}

function scoreCandidate(input: {
  kind: PatternCandidateKind;
  signature: string;
  events: ImprovementLedgerEvent[];
}): PatternCandidate {
  const successCount = input.events.filter(event => event.finalStatus === 'PASS' || event.finalStatus === 'AUTO_FIXED').length;
  const failureCount = input.events.length - successCount;
  const deterministicFixEvents = input.events.filter(event =>
    event.autoFixesApplied.some(fix => fix.kind === 'deterministic'),
  );
  const deterministicFixSuccessCount = deterministicFixEvents.filter(event =>
    event.finalStatus === 'PASS' || event.finalStatus === 'AUTO_FIXED',
  ).length;
  const autoFixSuccessRate = deterministicFixEvents.length > 0
    ? deterministicFixSuccessCount / deterministicFixEvents.length
    : null;
  const independentSourceCount = uniqueHashCount(input.events);
  const risk = failureCount >= successCount && failureCount >= 3
    ? 'high'
    : failureCount > 0
      ? 'medium'
      : 'low';
  const promotionReady = independentSourceCount >= 3
    && risk !== 'high'
    && (autoFixSuccessRate == null || autoFixSuccessRate >= 0.8);

  return {
    id: `${input.kind}:${input.signature}`.slice(0, 180),
    kind: input.kind,
    signature: input.signature,
    evidenceCount: input.events.length,
    independentSourceCount,
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
    { kind: 'section_heading_alias', map: new Map() },
    { kind: 'price_table_alias', map: new Map() },
    { kind: 'itinerary_column_alias', map: new Map() },
    { kind: 'optional_tour_phrase', map: new Map() },
    { kind: 'include_exclude_stop_heading', map: new Map() },
    { kind: 'hotel_room_grade_alias', map: new Map() },
    { kind: 'flight_time_vehicle_pollution', map: new Map() },
    { kind: 'entity_classification_pattern', map: new Map() },
    { kind: 'regional_meal_alias', map: new Map() },
    { kind: 'regional_transfer_alias', map: new Map() },
    { kind: 'shopping_phrase_pattern', map: new Map() },
    { kind: 'optional_tour_phrase_pattern', map: new Map() },
    { kind: 'hotel_alias_pattern', map: new Map() },
    { kind: 'non_attraction_noise_pattern', map: new Map() },
    { kind: 'attraction_alias_candidate', map: new Map() },
  ];
  const byKind = new Map(groups.map(group => [group.kind, group.map]));

  for (const event of events) {
    const eventText = [
      event.detectedFormat,
      ...event.blockersBefore,
      ...event.blockersAfter,
      ...event.normalizedBlockerSignatures,
      ...event.autoFixesApplied.flatMap(fix => [fix.field, fix.reason]),
      ...event.packagesAudit.failures,
      ...event.a4Audit.failures,
      ...event.evidenceSpans.map(span => `${span.field}:${span.quote}`),
    ].join('\n').toLowerCase();

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
    if (/heading|section|alias|표제|제목|섹션|출\s*발\s*일|판\s*매\s*가/.test(eventText)) {
      pushCount(byKind.get('section_heading_alias')!, event.detectedFormat, event);
    }
    if (/price|product_prices|price_dates|adult_selling_price|요금|가격|판매가|출\s*발\s*일|스팟특가/.test(eventText)) {
      pushCount(byKind.get('price_table_alias')!, event.detectedFormat, event);
    }
    if (/itinerary|schedule|day|column|일정|일\s*자|주요\s*행사|행사\s*일정/.test(eventText)) {
      pushCount(byKind.get('itinerary_column_alias')!, event.detectedFormat, event);
    }
    if (/optional|option|surcharge|선택\s*관광|옵션|추가\s*요금|써차지|현지\s*지불/.test(eventText)) {
      pushCount(byKind.get('optional_tour_phrase')!, event.detectedFormat, event);
    }
    if (/include|exclude|notice|stop|포함|불포함|주의|비고|공지|remark|선택관광|쇼핑센터/.test(eventText)) {
      pushCount(byKind.get('include_exclude_stop_heading')!, event.detectedFormat, event);
    }
    if (/hotel|room|grade|호텔|룸|객실|등급|숙박|2인1실/.test(eventText)) {
      pushCount(byKind.get('hotel_room_grade_alias')!, event.detectedFormat, event);
    }
    if (/flight|time|vehicle|transport|airline|항공|편명|시간|교통편|전용차량|버스|셔틀/.test(eventText)) {
      pushCount(byKind.get('flight_time_vehicle_pollution')!, event.detectedFormat, event);
    }
    if (/entity\.|segment_kind_guess|classification|unmatched|미매칭/.test(eventText)) {
      pushCount(byKind.get('entity_classification_pattern')!, event.detectedFormat, event);
    }
    if (/meal|rice noodle|식사|조식|중식|석식|특식|쌀국수|pho|현지식|호텔식/.test(eventText)) {
      pushCount(byKind.get('regional_meal_alias')!, event.detectedFormat, event);
    }
    if (/transfer|transport|이동|전용차량|버스|셔틀|픽업|송영/.test(eventText)) {
      pushCount(byKind.get('regional_transfer_alias')!, event.detectedFormat, event);
    }
    if (/shopping|쇼핑|면세|잡화|토산품|기념품/.test(eventText)) {
      pushCount(byKind.get('shopping_phrase_pattern')!, event.detectedFormat, event);
    }
    if (/optional|option|선택|옵션|마사지|스파|쇼|크루즈|호핑투어/.test(eventText)) {
      pushCount(byKind.get('optional_tour_phrase_pattern')!, event.detectedFormat, event);
    }
    if (/hotel|resort|호텔|리조트|객실|숙박|hotel_canonical/.test(eventText)) {
      pushCount(byKind.get('hotel_alias_pattern')!, event.detectedFormat, event);
    }
    if (/price_noise|free_time|noise|가격표|요금표|자유시간|휴식|노이즈/.test(eventText)) {
      pushCount(byKind.get('non_attraction_noise_pattern')!, event.detectedFormat, event);
    }
    if (/attraction|관광지|alias|별칭|match-existing-only-no-auto-create/.test(eventText)) {
      pushCount(byKind.get('attraction_alias_candidate')!, event.detectedFormat, event);
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
