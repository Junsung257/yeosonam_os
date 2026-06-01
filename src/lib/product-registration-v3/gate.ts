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
    check(checks, `${variant.variant_key}.price`, variant.price_calendar.length > 0, 'critical', 'variant has price evidence');
    check(checks, `${variant.variant_key}.flight`, variant.flight_segments.length > 0, 'critical', 'variant has flight evidence');
    check(checks, `${variant.variant_key}.days`, variant.days.length > 0, 'critical', 'variant has itinerary days');
    check(checks, `${variant.variant_key}.minimum_departure`, Boolean(variant.minimum_departure), 'high', 'minimum departure evidence exists');
    check(checks, `${variant.variant_key}.inclusions`, variant.inclusions.length > 0, 'high', 'inclusion evidence exists');
    check(checks, `${variant.variant_key}.exclusions`, variant.exclusions.length > 0, 'high', 'exclusion evidence exists');
    check(
      checks,
      `${variant.variant_key}.meals_or_notice`,
      variant.days.some(day => Object.values(day.meals).some(value => Object.keys(value).length > 0)),
      'medium',
      'meal evidence exists',
    );
    check(
      checks,
      `${variant.variant_key}.hotel_or_notice`,
      variant.days.some(day => Object.keys(day.hotel).length > 0),
      'medium',
      'hotel evidence exists',
    );
    check(
      checks,
      `${variant.variant_key}.meeting_not_flight`,
      !variant.flight_segments.some(segment => plan.flight_pattern.meeting_times.includes(segment.dep_time ?? '')),
      'critical',
      'meeting time is not reused as flight departure time',
    );
    check(
      checks,
      `${variant.variant_key}.options_reflected`,
      plan.option_section_locations.length === 0 || variant.options.length > 0,
      'high',
      'source option section is reflected in ledger',
    );
    check(
      checks,
      `${variant.variant_key}.shopping_reflected`,
      plan.shopping_section_locations.length === 0 || variant.shopping.length > 0,
      'high',
      'source shopping section is reflected in ledger',
    );
    const highRiskNotices = variant.standard_notices.filter(n => n.risk_level === 'high');
    check(
      checks,
      `${variant.variant_key}.high_risk_notice_values`,
      highRiskNotices.every(n => n.review_status !== 'review_needed'),
      'critical',
      'high-risk standard notices must have required values and review status',
    );
  }

  if (matchSummary) {
    check(
      checks,
      'attraction_unmatched_queue_clear',
      matchSummary.attraction_unmatched_count === 0,
      'high',
      `${matchSummary.attraction_unmatched_count} unmatched attraction events require review`,
    );
    check(
      checks,
      'option_review_queue_clear',
      matchSummary.option_review_count === 0,
      'medium',
      `${matchSummary.option_review_count} option events require review`,
    );
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
