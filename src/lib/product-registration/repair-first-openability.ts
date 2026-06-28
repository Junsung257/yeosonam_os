export type RepairFirstOpenabilityState =
  | 'openable'
  | 'auto_fixed_openable'
  | 'needs_human_source_review';

export type RepairFirstReviewActionLike = {
  reason: string;
  category: string;
  canBeMadeUsable: boolean;
  nextAction: string;
};

export type RepairFirstOpenabilitySummary = {
  state: RepairFirstOpenabilityState;
  can_be_made_usable: boolean;
  human_source_review_required: boolean;
  automatic_repair_attempted: boolean;
  repair_attempt_count: number;
  repairs_applied: string[];
  unresolved_reasons: string[];
  unresolved_categories: string[];
  next_actions: string[];
};

function unique(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

export function buildRepairFirstOpenabilitySummary(input: {
  reasons: string[];
  repairs: string[];
  reviewActions?: RepairFirstReviewActionLike[];
}): RepairFirstOpenabilitySummary {
  const reasons = unique(input.reasons);
  const repairs = unique(input.repairs);
  const reviewActions = input.reviewActions ?? [];
  const automaticRepairAttempted = repairs.length > 0;
  const unresolvedCategories = unique(reviewActions.map(action => action.category));
  const nextActions = unique(reviewActions.map(action => action.nextAction));
  const humanSourceReviewRequired = reasons.length > 0
    && (reviewActions.length === 0 || reviewActions.some(action => !action.canBeMadeUsable));

  const state: RepairFirstOpenabilityState = reasons.length === 0
    ? (automaticRepairAttempted ? 'auto_fixed_openable' : 'openable')
    : 'needs_human_source_review';

  return {
    state,
    can_be_made_usable: reasons.length === 0 || (reviewActions.length > 0 && reviewActions.every(action => action.canBeMadeUsable)),
    human_source_review_required: humanSourceReviewRequired,
    automatic_repair_attempted: automaticRepairAttempted,
    repair_attempt_count: repairs.length,
    repairs_applied: repairs,
    unresolved_reasons: reasons,
    unresolved_categories: unresolvedCategories,
    next_actions: nextActions,
  };
}
