export type ProductRegistrationTrustGrade = 'perfect' | 'review' | 'blocked';

export type ProductRegistrationTrustIssueSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface ProductRegistrationTrustIssue {
  code: string;
  severity: ProductRegistrationTrustIssueSeverity;
  message: string;
  deduction: number;
}

export interface ProductRegistrationTrustInput {
  inputBlocked?: boolean;
  inputNeedsReview?: boolean;
  inputIssueCodes?: string[];
  expectedProductCount?: number | null;
  actualProductCount?: number | null;
  savedProductCount?: number | null;
  priceRowsSaved?: number | null;
  priceDatesCount?: number | null;
  itineraryDaysCount?: number | null;
  durationDays?: number | null;
  standardNoticeCount?: number | null;
  structuredFactCount?: number | null;
  rawNoticeLeakRisk?: boolean;
  v3Status?: string | null;
  unmatchedActivitiesCount?: number | null;
  highRiskReviewNeededCount?: number | null;
  renderAuditStatus?: 'pass' | 'warn' | 'fail' | 'unknown' | null;
}

export interface ProductRegistrationTrustScore {
  score: number;
  grade: ProductRegistrationTrustGrade;
  publishable: boolean;
  blockers: ProductRegistrationTrustIssue[];
  warnings: ProductRegistrationTrustIssue[];
  issues: ProductRegistrationTrustIssue[];
}

function num(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function add(
  issues: ProductRegistrationTrustIssue[],
  condition: boolean,
  issue: ProductRegistrationTrustIssue,
): void {
  if (condition) issues.push(issue);
}

export function calculateProductRegistrationTrustScore(input: ProductRegistrationTrustInput): ProductRegistrationTrustScore {
  const issues: ProductRegistrationTrustIssue[] = [];
  const actualCount = input.actualProductCount ?? input.savedProductCount ?? null;

  add(issues, input.inputBlocked === true, {
    code: 'input.blocked',
    severity: 'critical',
    message: 'Input text is blocked by the upload quality gate.',
    deduction: 100,
  });
  add(issues, input.inputNeedsReview === true && input.inputBlocked !== true, {
    code: 'input.needs_review',
    severity: 'medium',
    message: 'Input text passed but needs human review.',
    deduction: 10,
  });
  add(issues, Boolean(input.expectedProductCount && actualCount != null && actualCount !== input.expectedProductCount), {
    code: 'product_count.mismatch',
    severity: 'critical',
    message: `Expected ${input.expectedProductCount} product(s), built ${actualCount ?? 0}.`,
    deduction: 100,
  });
  add(issues, num(input.savedProductCount) === 0, {
    code: 'product.none_saved',
    severity: 'critical',
    message: 'No product was saved.',
    deduction: 100,
  });
  add(issues, num(input.priceRowsSaved) === 0 && num(input.priceDatesCount) === 0, {
    code: 'price.missing',
    severity: 'critical',
    message: 'No customer price evidence was saved.',
    deduction: 35,
  });
  add(issues, num(input.itineraryDaysCount) === 0, {
    code: 'itinerary.missing',
    severity: 'critical',
    message: 'No itinerary days were saved.',
    deduction: 35,
  });
  add(issues, Boolean(input.durationDays && input.itineraryDaysCount && input.itineraryDaysCount > input.durationDays + 1), {
    code: 'itinerary.duration_mismatch',
    severity: 'high',
    message: `Itinerary has ${input.itineraryDaysCount} day(s), longer than duration ${input.durationDays}.`,
    deduction: 20,
  });
  add(issues, input.rawNoticeLeakRisk === true, {
    code: 'notice.raw_leak_risk',
    severity: 'critical',
    message: 'Customer-visible notices may contain supplier REMARK raw text.',
    deduction: 100,
  });
  add(issues, input.v3Status === 'blocked', {
    code: 'v3.blocked',
    severity: 'critical',
    message: 'Latest Product Registration V3 draft is blocked.',
    deduction: 40,
  });
  add(issues, input.v3Status === 'needs_review', {
    code: 'v3.needs_review',
    severity: 'high',
    message: 'Latest Product Registration V3 draft needs review.',
    deduction: 20,
  });
  add(issues, !input.v3Status || input.v3Status === 'none', {
    code: 'v3.missing',
    severity: 'high',
    message: 'No Product Registration V3 draft exists.',
    deduction: 25,
  });
  add(issues, num(input.standardNoticeCount) === 0 && num(input.structuredFactCount) === 0, {
    code: 'v3.facts_missing',
    severity: 'medium',
    message: 'No V3 standard notices or structured facts were found.',
    deduction: 15,
  });
  add(issues, num(input.highRiskReviewNeededCount) > 0, {
    code: 'high_risk.review_needed',
    severity: 'critical',
    message: `${num(input.highRiskReviewNeededCount)} high-risk item(s) need review.`,
    deduction: 35,
  });
  add(issues, num(input.unmatchedActivitiesCount) > 0, {
    code: 'attraction.unmatched',
    severity: 'medium',
    message: `${num(input.unmatchedActivitiesCount)} attraction candidate(s) need unmatched review.`,
    deduction: Math.min(20, 5 + Math.ceil(num(input.unmatchedActivitiesCount) / 10)),
  });
  add(issues, input.renderAuditStatus === 'fail', {
    code: 'render.audit_failed',
    severity: 'critical',
    message: 'Customer render audit failed.',
    deduction: 100,
  });
  add(issues, input.renderAuditStatus === 'warn', {
    code: 'render.audit_warn',
    severity: 'medium',
    message: 'Customer render audit has warnings.',
    deduction: 10,
  });

  const critical = issues.filter(issue => issue.severity === 'critical');
  const score = critical.some(issue => issue.deduction >= 100)
    ? 0
    : Math.max(0, 100 - issues.reduce((sum, issue) => sum + issue.deduction, 0));
  const blockers = issues.filter(issue => issue.severity === 'critical' || issue.severity === 'high');
  const warnings = issues.filter(issue => issue.severity === 'medium' || issue.severity === 'low');
  const publishable = score === 100 && blockers.length === 0;

  return {
    score,
    grade: publishable ? 'perfect' : blockers.length > 0 ? 'blocked' : 'review',
    publishable,
    blockers,
    warnings,
    issues,
  };
}
