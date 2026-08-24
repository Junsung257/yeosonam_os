export const BLOG_CONTENT_OPERATION_WORKFLOW_VERSION = 'blog-content-operation-workflow-v1' as const;

export const BLOG_CONTENT_OPERATION_TYPES = [
  'new_info',
  'new_commercial',
  'new_seasonal',
  'material_refresh',
  'product_refresh',
  'merge_review',
] as const;

export type BlogContentOperationType = (typeof BLOG_CONTENT_OPERATION_TYPES)[number];
export type BlogDemandClusterDecision = 'new' | 'refresh' | 'commercial_companion' | 'research_backlog';
export type BlogContentOperationRisk = 'LOW' | 'MEDIUM' | 'HIGH';

export type BlogContentOperationStage =
  | 'demand_verified'
  | 'brief_verified'
  | 'research_ready'
  | 'drafting'
  | 'evaluating'
  | 'repairing'
  | 'human_review'
  | 'approved_for_slot'
  | 'publishing'
  | 'published'
  | 'indexed'
  | 'research_backlog'
  | 'quarantined'
  | 'failed'
  | 'cancelled';

export type BlogContentOperationStatus =
  | 'queued'
  | 'running'
  | 'human_review'
  | 'approved_for_slot'
  | 'research_backlog'
  | 'quarantined'
  | 'publishing'
  | 'published'
  | 'indexed'
  | 'failed'
  | 'cancelled';

export type BlogDemandSignalProviderV4 =
  | 'google_search_console'
  | 'naver_search_advisor'
  | 'customer_question'
  | 'consultation_aggregate'
  | 'active_product'
  | 'active_product_question'
  | 'product_view'
  | 'product_inquiry'
  | 'operator_note'
  | 'editor_seed'
  | 'search_volume'
  | 'search_trend';

export interface BlogDemandSignalV4 {
  provider: BlogDemandSignalProviderV4;
  signalKey: string;
  sourceReference: string;
  sourceRowHash: string;
  observedAt: string;
  expiresAt?: string | null;
  verifiedAt: string;
  verifierType?: 'system' | 'operator' | 'editor';
  metricValue?: number | null;
  metrics?: Record<string, unknown>;
}

export interface BlogDemandRepresentativeV4 {
  representativeKey: string;
  canonicalCreativeId: string;
  canonicalSlug: string;
  status: 'active' | 'reserved' | 'retired';
}

export interface BlogPackageSnapshotPinV4 {
  packageId: string;
  snapshotId: string;
  revision: number;
  hash: string;
}

export interface BlogDemandMaterializationInputV4 {
  primaryQuery: string;
  destinationId?: string | null;
  audience?: string | null;
  locale?: string | null;
  riskLevel?: BlogContentOperationRisk;
  signal: BlogDemandSignalV4;
  representative?: BlogDemandRepresentativeV4 | null;
  refreshTargetCreativeId?: string | null;
  packageSnapshot?: BlogPackageSnapshotPinV4 | null;
  seasonal?: boolean;
  emergency?: boolean;
  queueId?: string | null;
  creativeId?: string | null;
  operationDayKst: string;
}

export interface BlogDemandMaterializationDecisionV4 {
  clusterKey: string;
  normalizedQuery: string;
  primaryQuery: string;
  intent: string;
  destinationId: string | null;
  audience: string;
  locale: string;
  demandScore: number;
  scoreComponents: Record<string, number>;
  riskLevel: BlogContentOperationRisk;
  freshnessExpiresAt: string | null;
  decision: BlogDemandClusterDecision;
  decisionReason: string;
  representativeKey: string | null;
  canonicalCreativeId: string | null;
  refreshTargetCreativeId: string | null;
  operationType: BlogContentOperationType;
  createsNewUrl: boolean;
  idempotencyKey: string;
  operationDayKst: string;
  signal: BlogDemandSignalV4;
  packageSnapshot: BlogPackageSnapshotPinV4 | null;
  queueId: string | null;
  creativeId: string | null;
}

export interface BlogContentOperationWorkflowInput {
  operationId: string;
  queueId: string;
  fencingToken: number;
  leaseOwner: string;
  requestBaseUrl: string;
  workflowVersion: typeof BLOG_CONTENT_OPERATION_WORKFLOW_VERSION;
}
