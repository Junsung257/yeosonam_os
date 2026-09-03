import type { ProductSourceType } from '@/lib/product-registration-v4/types';
import type { RegistrationTermsPolicySnapshot } from '@/lib/standard-terms-client';

export const PRODUCT_REGISTRATION_V6_POLICY_VERSION = 'product-registration-v6-policy-10-deepseek';
export const PRODUCT_REGISTRATION_V6_WORKFLOW_VERSION = 'product-registration-v6-workflow-24';

export const PRODUCT_REGISTRATION_V6_STAGES = [
  'intake',
  'preflight',
  'deduplicate',
  'extract',
  'bundle_sources',
  'segment',
  'resolve_critical_facts',
  'analyze_unpublished',
  'detect_recovery_targets',
  'normalize',
  'resolve_shared_facts',
  'validate',
  'generate_copy',
  'build_snapshot',
  'browser_proof',
  'publish_pointer',
  'converge_surfaces',
  'complete',
] as const;

export type ProductRegistrationV6Stage = typeof PRODUCT_REGISTRATION_V6_STAGES[number];

export type ProductRegistrationV6TerminalOutcome =
  | 'published_verified'
  | 'published_degraded'
  | 'ready_verified_not_published'
  | 'ready_degraded_not_published'
  | 'discarded_source_incomplete'
  | 'discarded_non_travel'
  | 'discarded_duplicate_or_consolidated'
  | 'archived_all_departures_past'
  | 'blocked_action_required'
  | 'quarantined_unsupported_or_corrupt'
  | 'quarantined_system_failure';

export type ProductRegistrationV6PublicationState =
  | 'not_requested'
  | 'frozen'
  | 'blocked'
  | 'proof_passed'
  | 'pointer_committed'
  | 'converged'
  | 'convergence_failed';

export type ProductRegistrationV6WorkflowInput = {
  jobId: string;
  tenantId: string;
  sourceDocumentId: string;
  requestId: string;
  requestBaseUrl: string;
  publicBaseUrl: string;
  sourceType: ProductSourceType;
  fileName: string;
  declaredMime: string | null;
  fileHash: string;
  directRawText: string | null;
  originalRawText: string | null;
  parserRawText: string | null;
  analysisNormalizedText: string | null;
  uploadSourceMetadata: Record<string, unknown>;
  archiveMode: boolean;
  bulkMode: boolean;
  forceReprocess: boolean;
  fencingToken: number;
  policyVersion: string;
  departureDateReference: {
    referenceDate: string;
    timezone: 'Asia/Seoul';
    policyVersion: string;
    rollingInferenceEligible: boolean;
  };
  correctionJobId?: string | null;
};

export type ProductRegistrationV6Decision = {
  outcome: 'verified' | 'degraded' | 'blocked';
  terminalOutcome: ProductRegistrationV6TerminalOutcome;
  degradedReasons: string[];
  blockers: string[];
  packageIds: string[];
  revisionIds: string[];
  termsPolicies?: Array<RegistrationTermsPolicySnapshot & {
    revisionId: string;
    catalogProductId: string;
    sourceCancellationCovered: boolean;
  }>;
};

export type ProductRegistrationV6WorkflowResult = ProductRegistrationV6Decision & {
  analysisOutcome: ProductRegistrationV6Decision['outcome'];
  publicationState: ProductRegistrationV6PublicationState;
  publicationBlockers: string[];
  jobId: string;
  workflowVersion: string;
  completedAt: string;
};

export function toTerminalOutcome(
  outcome: ProductRegistrationV6Decision['outcome'],
): ProductRegistrationV6TerminalOutcome {
  if (outcome === 'verified') return 'published_verified';
  if (outcome === 'degraded') return 'published_degraded';
  return 'blocked_action_required';
}
