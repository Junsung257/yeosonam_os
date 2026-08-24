import { renderPackage } from '@/lib/render-contract';
import type { V3DraftLedger, V3GateCheck, V3GateResult, V3MatchSummary, V3StructurePlan } from './types';
import { ledgerToRenderPackageInputs } from './render-contract-adapter';

function check(
  checks: V3GateCheck[],
  id: string,
  passed: boolean,
  severity: V3GateCheck['severity'],
  message: string,
): void {
  checks.push({ id, status: passed ? 'pass' : severity === 'info' ? 'warn' : 'fail', severity, message });
}

function planRequiresAirTransport(plan: V3StructurePlan): boolean {
  if (typeof plan.transport_profile?.requires_air === 'boolean') {
    return plan.transport_profile.requires_air;
  }
  return plan.flight_pattern.outbound_codes.length > 0 || plan.flight_pattern.inbound_codes.length > 0;
}

function inclusionValues(variant: V3DraftLedger['variants'][number]): string[] {
  return variant.inclusions.map(inclusion => String(inclusion.value ?? '').trim()).filter(Boolean);
}

function isSubstantiveCommercialTerm(value: unknown): boolean {
  const normalized = String(value ?? '').replace(/\s+/g, '').replace(/[:\uff1a]$/, '');
  return normalized.length >= 2
    && !/^(?:include|included|exclude|excluded|\ud3ec\ud568(?:\ub0b4\uc5ed|\uc0ac\ud56d|\uc870\uac74)?|\ubd88\ud3ec\ud568(?:\ub0b4\uc5ed|\uc0ac\ud56d)?|\uc81c\uc678\uc0ac\ud56d)$/i.test(normalized);
}

function hasIncludedMealEvidence(variant: V3DraftLedger['variants'][number]): boolean {
  return inclusionValues(variant).some(value =>
    /\bmeal\b/i.test(value)
    || value.includes('\uc2dd\uc0ac')
    || value.includes('\uc77c\uc815\ud45c\uc0c1\uc758 \uc2dd\uc0ac')
  );
}

function hasIncludedHotelEvidence(variant: V3DraftLedger['variants'][number]): boolean {
  return inclusionValues(variant).some(value =>
    /\bhotel\b/i.test(value)
    || value.includes('\ud638\ud154')
    || value.includes('\uc219\ubc15')
    || value.includes('\ub9ac\uc870\ud2b8')
  );
}

function meetingTimeIsReusedAsFlightDeparture(variant: V3DraftLedger['variants'][number]): boolean {
  const meetings = variant.days
    .flatMap(day => day.events)
    .filter(event => event.type === 'meeting' && Boolean(event.time));
  if (meetings.length === 0) return false;
  return variant.flight_segments.some(segment => {
    if (!segment.dep_time) return false;
    return meetings.some(meeting => {
      if (meeting.time !== segment.dep_time) return false;
      const meetingLine = meeting.evidence?.line_start;
      const flightLine = segment.evidence?.line_start;
      // HWP tables often place a flight code and its time in adjacent rows.
      // A meeting elsewhere in the itinerary with the same clock time is not
      // evidence that the parser reused it as the flight departure.
      return typeof meetingLine === 'number'
        && typeof flightLine === 'number'
        && Math.abs(meetingLine - flightLine) <= 2;
    });
  });
}

const SAFE_HIGH_RISK_REVIEW_CATEGORIES = new Set([
  'local_law_restriction',
  'passport_validity',
  'passport_visa_law',
  'visa_entry_rule',
  'group_schedule_penalty',
  'surcharge',
  // An amount-less guide/driver tip is safe only as a source-bound inquiry
  // notice.  The resolver never invents an amount; an included/local
  // contradiction is still blocked by guide_tip_not_contradictory below.
  'guide_tip',
  'tip_guideline',
]);

function hasSourceBoundDisclosure(value: {
  category?: unknown;
  source_text?: unknown;
  standard_text?: unknown;
  evidence?: unknown;
}): boolean {
  const sourceText = String(value.source_text ?? '').trim();
  const evidenceQuotes = Array.isArray(value.evidence)
    ? value.evidence.some(item => {
        if (typeof item !== 'object' || item === null) return false;
        return String((item as { quote?: unknown }).quote ?? '').trim().length > 0;
      })
    : false;
  return SAFE_HIGH_RISK_REVIEW_CATEGORIES.has(String(value.category ?? ''))
    && (sourceText.length > 0 || evidenceQuotes)
    && String(value.standard_text ?? '').trim().length > 0
    && Array.isArray(value.evidence)
    && value.evidence.length > 0;
}

function isExplicitAdditionalOption(option: V3DraftLedger['variants'][number]['options'][number]): boolean {
  const source = [
    option.raw_name,
    option.normalized_name,
    option.evidence?.quote,
  ].filter(Boolean).join(' ');
  return option.price_amount != null
    || /추천|추가|별도|현지\s*지불|optional|extra/i.test(source);
}

export function evaluateProductRegistrationV3Gate(
  plan: V3StructurePlan,
  ledger: V3DraftLedger,
  matchSummary?: V3MatchSummary,
): V3GateResult {
  const checks: V3GateCheck[] = [];
  check(
    checks,
    'expected_products_match',
    ledger.variants.length === plan.expected_products,
    'critical',
    `expected ${plan.expected_products}, built ${ledger.variants.length}`,
  );

  for (const variant of ledger.variants) {
    const requiresAirTransport = planRequiresAirTransport(plan);
    const hasMealEvidence = variant.days.some(day => Object.values(day.meals).some(value => Object.keys(value).length > 0))
      || hasIncludedMealEvidence(variant)
      || variant.standard_notices.some(notice => notice.category === 'meal_plan' && notice.review_status !== 'rejected')
      || (variant.structured_facts ?? []).some(fact => fact.category === 'meal_plan' && fact.review_status !== 'rejected');
    const hasHotelEvidence = variant.days.some(day => Object.keys(day.hotel).length > 0)
      || hasIncludedHotelEvidence(variant)
      || variant.standard_notices.some(notice => notice.category === 'hotel_notice' && notice.review_status !== 'rejected')
      || (variant.structured_facts ?? []).some(fact =>
        (fact.category === 'hotel_grade' || fact.category === 'room_policy')
        && fact.review_status !== 'rejected'
      );
    check(checks, `${variant.variant_key}.price`, variant.price_calendar.length > 0, 'info', 'variant has price evidence; final price is owned by ProductRegistrationResult pricing');
    check(
      checks,
      `${variant.variant_key}.flight`,
      !requiresAirTransport || variant.flight_segments.length > 0,
      'critical',
      requiresAirTransport ? 'air package has flight evidence' : 'air flight evidence is not required for this transport profile',
    );
    check(
      checks,
      `${variant.variant_key}.flight_times_complete`,
      !requiresAirTransport || variant.flight_segments
        .filter(segment => segment.leg === 'outbound' || segment.leg === 'inbound')
        .filter(segment => Boolean(segment.dep_time || segment.arr_time))
        .every(segment => Boolean(segment.dep_time && segment.arr_time)),
      'critical',
      'source-timed outbound/inbound flight segments must include both departure and arrival times',
    );
    check(checks, `${variant.variant_key}.days`, variant.days.length > 0, 'critical', 'variant has itinerary days');
    check(checks, `${variant.variant_key}.minimum_departure`, Boolean(variant.minimum_departure), 'high', 'minimum departure evidence exists');
    check(
      checks,
      `${variant.variant_key}.inclusions`,
      variant.inclusions.some(item => isSubstantiveCommercialTerm(item.value)),
      'high',
      'substantive inclusion evidence exists',
    );
    check(
      checks,
      `${variant.variant_key}.exclusions`,
      variant.exclusions.some(item => isSubstantiveCommercialTerm(item.value)),
      'high',
      'substantive exclusion evidence exists',
    );
    check(
      checks,
      `${variant.variant_key}.meals_or_notice`,
      hasMealEvidence,
      'medium',
      'meal evidence exists or explicit meal notice is present',
    );
    check(
      checks,
      `${variant.variant_key}.hotel_or_notice`,
      hasHotelEvidence,
      'medium',
      'hotel evidence exists or explicit hotel notice is present',
    );
    check(
      checks,
      `${variant.variant_key}.meeting_not_flight`,
      !meetingTimeIsReusedAsFlightDeparture(variant),
      'critical',
      'meeting time is not reused as flight departure time',
    );
    check(
      checks,
      `${variant.variant_key}.options_reflected`,
      plan.option_section_locations.length === 0
        || variant.options.length > 0
        || variant.standard_notices.some(notice => notice.category === 'optional_tour' && notice.template_key === 'optional.none')
        || (variant.structured_facts ?? []).some(fact => fact.category === 'optional_tour' && fact.values.none === true),
      'high',
      'source option section is reflected in ledger',
    );
    check(
      checks,
      `${variant.variant_key}.shopping_reflected`,
      plan.shopping_section_locations.length === 0
        || variant.shopping.length > 0
        || variant.standard_notices.some(notice => notice.category === 'shopping_visit' && notice.template_key === 'shopping.none')
        || variant.standard_notices.some(notice => notice.category === 'shopping_visit' && notice.review_status === 'auto_clean')
        || (variant.structured_facts ?? []).some(fact => fact.category === 'shopping_policy' && (fact.values.none === true || fact.review_status === 'auto_clean')),
      'high',
      'source shopping section is reflected in ledger',
    );
    const highRiskNotices = variant.standard_notices.filter(n => n.risk_level === 'high');
    const safeReviewedNotices = highRiskNotices.filter(notice =>
      notice.review_status === 'review_needed' && hasSourceBoundDisclosure(notice),
    );
    const unsafeReviewedNotices = highRiskNotices.filter(notice =>
      notice.review_status === 'review_needed' && !hasSourceBoundDisclosure(notice),
    );
    const noticeKeys = new Set(variant.standard_notices
      .filter(notice => notice.review_status !== 'rejected')
      .map(notice => notice.template_key));
    check(
      checks,
      `${variant.variant_key}.guide_tip_not_contradictory`,
      !(noticeKeys.has('guide.tip_included') && noticeKeys.has('guide.tip_amount_local_payment')),
      'critical',
      'guide/driver tip cannot be both included and payable locally',
    );
    check(
      checks,
      `${variant.variant_key}.optional_tour_not_contradictory`,
      !(noticeKeys.has('optional.none')
        && variant.options.length > 0
        && !variant.options.every(isExplicitAdditionalOption)),
      'critical',
      'no-option notice cannot coexist with unscoped customer-visible optional tours',
    );
    check(
      checks,
      `${variant.variant_key}.shopping_not_contradictory`,
      !(noticeKeys.has('shopping.none') && variant.shopping.length > 0),
      'critical',
      'no-shopping notice cannot coexist with shopping visits',
    );
    check(
      checks,
      `${variant.variant_key}.high_risk_notice_values`,
      unsafeReviewedNotices.length === 0,
      'critical',
      'high-risk standard notices must have required values and review status',
    );
    check(
      checks,
      `${variant.variant_key}.high_risk_notice_disclosure`,
      safeReviewedNotices.length === 0,
      'info',
      safeReviewedNotices.length > 0
        ? '일부 법규·현지비용 고지는 원문 근거를 유지한 상담 확인 문구로 표시합니다.'
        : '고위험 고지의 원문 근거와 공개 상태가 확인되었습니다.',
    );
    const highRiskFacts = (variant.structured_facts ?? []).filter(fact => fact.risk_level === 'high');
    const safeReviewedFacts = highRiskFacts.filter(fact =>
      fact.review_status === 'review_needed' && hasSourceBoundDisclosure(fact),
    );
    const unsafeReviewedFacts = highRiskFacts.filter(fact =>
      fact.review_status === 'review_needed' && !hasSourceBoundDisclosure(fact),
    );
    check(
      checks,
      `${variant.variant_key}.high_risk_structured_fact_values`,
      unsafeReviewedFacts.length === 0,
      'critical',
      'high-risk structured facts must have values or an explicit safe state',
    );
    check(
      checks,
      `${variant.variant_key}.high_risk_structured_fact_disclosure`,
      safeReviewedFacts.length === 0,
      'info',
      safeReviewedFacts.length > 0
        ? '일부 현지비용·입국 고지는 원문 근거를 유지한 상담 확인 문구로 표시합니다.'
        : '고위험 구조 사실의 원문 근거와 공개 상태가 확인되었습니다.',
    );
  }

  if (matchSummary) {
    const entity = matchSummary.entity_summary;
    const unresolvedAttractionCount = entity?.attraction_unresolved_count ?? matchSummary.attraction_unmatched_count;
    check(
      checks,
      'attraction_unmatched_queue_clear',
      unresolvedAttractionCount === 0,
      // A missing master match is not a missing itinerary fact.  The raw
      // activity text remains customer-visible, while media/detail enrichment
      // is withheld and queued for later resolution.  Treat it as a warning
      // so publication can safely degrade instead of inventing a destination
      // record or blocking an otherwise sellable package.
      'info',
      `${unresolvedAttractionCount} unmatched attraction events require enrichment review`,
    );
    check(
      checks,
      'option_review_queue_clear',
      matchSummary.option_review_count === 0,
      'info',
      `${matchSummary.option_review_count} option events require review`,
    );
    if (entity) {
      check(
        checks,
        'entity_attraction_unresolved_clear',
        entity.attraction_unresolved_count === 0,
        'info',
        `${entity.attraction_unresolved_count} unresolved attraction entities require enrichment review`,
      );
      check(
        checks,
        'entity_shopping_review_clear',
        entity.shopping_review_needed_count === 0,
        'high',
        `${entity.shopping_review_needed_count} shopping entities require customer-disclosure review`,
      );
      check(
        checks,
        'entity_option_review_clear',
        entity.option_review_needed_count === 0,
        'high',
        `${entity.option_review_needed_count} optional-tour entities require customer-disclosure review`,
      );
      check(
        checks,
        'entity_unknown_customer_visible_clear',
        entity.unknown_customer_visible_count === 0,
        'high',
        `${entity.unknown_customer_visible_count} customer-visible unknown entities require review`,
      );
    }
  }

  try {
    for (const input of ledgerToRenderPackageInputs(ledger)) {
      renderPackage(input);
    }
    check(checks, 'render_contract', true, 'critical', 'canonical render contract can be generated');
  } catch (error) {
    check(checks, 'render_contract', false, 'critical', error instanceof Error ? error.message : 'render contract failed');
  }

  const failedCritical = checks.some(c => c.status === 'fail' && c.severity === 'critical');
  const failedAny = checks.some(c => c.status === 'fail');
  return {
    status: failedCritical ? 'blocked' : failedAny ? 'needs_review' : 'ready_to_publish',
    customer_publishable: !failedAny,
    checks,
  };
}
