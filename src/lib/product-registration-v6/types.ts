import type { ProductSourceType } from '@/lib/product-registration-v4/types';

export const PRODUCT_REGISTRATION_V6_POLICY_VERSION = 'product-registration-v6-policy-1';
export const PRODUCT_REGISTRATION_V6_WORKFLOW_VERSION = 'product-registration-v6-workflow-1';

export const PRODUCT_REGISTRATION_V6_STAGES = [
  'intake',
  'preflight',
  'deduplicate',
  'extract',
  'segment',
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
  | 'blocked_action_required';

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
  correctionJobId?: string | null;
};

export type ProductRegistrationV6Decision = {
  outcome: 'verified' | 'degraded' | 'blocked';
  terminalOutcome: ProductRegistrationV6TerminalOutcome;
  degradedReasons: string[];
  blockers: string[];
  packageIds: string[];
  revisionIds: string[];
};

export type ProductRegistrationV6WorkflowResult = ProductRegistrationV6Decision & {
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
