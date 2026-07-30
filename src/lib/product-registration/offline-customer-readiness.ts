export type OfflineCustomerReadinessInput = {
  publishable: boolean;
  blockers: string[];
  warnings: string[];
  activeAttractionCatalogVerified: boolean;
};

export type OfflineCustomerReadinessResult = {
  ready: boolean;
  reviewWarnings: string[];
};

export const ACTIVE_ATTRACTION_CATALOG_UNAVAILABLE =
  'offline_context:active_attractions_unavailable';

export function getOfflineCustomerReviewWarnings(
  warnings: string[],
): string[] {
  return [...new Set(warnings.filter(warning => (
    warning.startsWith('v3:gate:')
    || warning === 'v3:needs_review'
    || warning.startsWith('mobile_media:')
    || warning.includes('unmatched')
    || warning === ACTIVE_ATTRACTION_CATALOG_UNAVAILABLE
  )))];
}

export function evaluateOfflineCustomerReadiness(
  input: OfflineCustomerReadinessInput,
): OfflineCustomerReadinessResult {
  const contextWarnings = input.activeAttractionCatalogVerified
    ? input.warnings
    : [...input.warnings, ACTIVE_ATTRACTION_CATALOG_UNAVAILABLE];
  const reviewWarnings = getOfflineCustomerReviewWarnings(contextWarnings);

  return {
    ready: input.publishable && input.blockers.length === 0 && reviewWarnings.length === 0,
    reviewWarnings,
  };
}
