export type EntityMasterCandidatePublicGateInput = {
  category?: string | null;
  promotion_status?: string | null;
  auto_action?: string | null;
  auto_verification_status?: string | null;
};

export type EntityMasterCandidatePublicGateDecision = {
  unresolved: boolean;
  hardBlocker: boolean;
  warning: boolean;
  reason: string;
};

const UNRESOLVED_STATUSES = new Set([
  'candidate',
  'auto_internal',
  'needs_review',
  'publishable_ready',
]);

const CUSTOMER_DISCLOSURE_CATEGORIES = new Set([
  'optional_tour',
  'shopping',
  'notice',
  'unknown',
]);

const NON_BLOCKING_ENTITY_CATEGORIES = new Set([
  'attraction',
  'hotel',
]);

const TERMINAL_NON_MASTER_ACTIONS = new Set([
  'reject_noise',
  'structure_non_master',
]);

const TERMINAL_NON_MASTER_VERIFICATION_STATUSES = new Set([
  'rejected_noise',
  'structured_non_master',
  'template_matched',
]);

export function evaluateEntityMasterCandidatePublicGate(
  input: EntityMasterCandidatePublicGateInput,
): EntityMasterCandidatePublicGateDecision {
  const status = String(input.promotion_status ?? '').trim();
  const category = String(input.category ?? '').trim();
  const autoAction = String(input.auto_action ?? '').trim();
  const autoVerificationStatus = String(input.auto_verification_status ?? '').trim();
  const unresolved = UNRESOLVED_STATUSES.has(status);

  if (
    TERMINAL_NON_MASTER_ACTIONS.has(autoAction) ||
    TERMINAL_NON_MASTER_VERIFICATION_STATUSES.has(autoVerificationStatus)
  ) {
    return {
      unresolved: false,
      hardBlocker: false,
      warning: false,
      reason: 'terminal_non_master_or_noise',
    };
  }

  if (!unresolved) {
    return {
      unresolved: false,
      hardBlocker: false,
      warning: false,
      reason: 'resolved_or_ignored',
    };
  }

  if (
    CUSTOMER_DISCLOSURE_CATEGORIES.has(category) &&
    (status === 'needs_review' || autoVerificationStatus === 'needs_review')
  ) {
    return {
      unresolved: true,
      hardBlocker: true,
      warning: false,
      reason: 'customer_disclosure_candidate_requires_review',
    };
  }

  if (
    category === 'optional_tour' ||
    (autoAction === 'needs_review' && CUSTOMER_DISCLOSURE_CATEGORIES.has(category))
  ) {
    return {
      unresolved: true,
      hardBlocker: true,
      warning: false,
      reason: 'customer_commercial_candidate_requires_review',
    };
  }

  if (NON_BLOCKING_ENTITY_CATEGORIES.has(category)) {
    return {
      unresolved: true,
      hardBlocker: false,
      warning: true,
      reason: 'unmatched_entity_candidate_without_customer_claim',
    };
  }

  return {
    unresolved: true,
    hardBlocker: status === 'needs_review',
    warning: status !== 'needs_review',
    reason: status === 'needs_review'
      ? 'unclassified_candidate_requires_review'
      : 'unclassified_candidate_warning',
  };
}
