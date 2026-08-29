import type { SupabaseClient } from '@supabase/supabase-js';

type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

type JsonObject = Record<string, unknown>;

export type AdminPackagePublicationTruth = {
  tenantId: string;
  catalogProductId: string;
  productKey: string;
  packageId: string | null;
  packageTitle: string | null;
  latestRevisionId: string | null;
  latestRevisionNo: number | null;
  latestRevisionStatus: string | null;
  sourceHash: string | null;
  candidateSnapshotId: string | null;
  candidateSnapshotStatus: string | null;
  candidateSnapshotHash: string | null;
  candidateRendererBuildId: string | null;
  pointerState: string | null;
  pointerVersion: number;
  pointerRevisionId: string | null;
  pointerSnapshotId: string | null;
  snapshotStatus: string | null;
  snapshotHash: string | null;
  rendererBuildId: string | null;
  proofId: string | null;
  proofStatus: string | null;
  futureDepartureCount: number;
  pricedDepartureCount: number;
  requestOnlyDepartureCount: number;
  invalidPriceLineageCount: number;
  copyPolicyVersion: string | null;
  copyQualityScore: number | null;
  documentaryProductMediaCount: number;
  customerReadinessBlockerCodes: string[];
  customerVisibilityState: string;
  saleState: string;
  latestPublicationRequestId: string | null;
  latestPublicationRequestStatus: string | null;
  actualCustomerPublic: boolean;
  blockerCodes: string[];
  nextAction: string;
};

export type PublicationRequestInput = {
  tenantId: string;
  catalogProductId: string;
  packageId: string;
  expectedRevisionId: string;
  expectedRevisionNo: number;
  expectedSourceHash: string;
  expectedPointerVersions: Record<'customer', number>;
  sourceReviewDecisionId?: string | null;
  requestedBy?: string | null;
  requestedActor: string;
  requestReason: string;
  idempotencyKey: string;
};

export type PublicationRequestResult = {
  requestId: string;
  status: string;
  requestHash: string;
  replayed: boolean;
};

export type PublicationWorkflowRequest = {
  id: string;
  tenantId: string;
  catalogProductId: string;
  packageId: string;
  expectedRevisionId: string;
  expectedRevisionNo: number;
  expectedSourceHash: string;
  expectedPointerVersions: Record<string, number>;
  channels: Array<'customer' | 'b2b' | 'partner'>;
  locale: string;
  requestedBy: string | null;
  requestedActor: string;
  requestReason: string;
  status: string;
  snapshotId: string | null;
  proofId: string | null;
  workflowRunId: string | null;
};

function rpcClient(supabase: SupabaseClient): RpcClient {
  return supabase as unknown as RpcClient;
}

function object(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function number(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item))
    : [];
}

function required(value: unknown, field: string): string {
  const parsed = string(value);
  if (!parsed) throw new Error(`REGISTRATION_PUBLICATION_RESPONSE_MISSING:${field}`);
  return parsed;
}

function publicationWorkflowRequest(value: unknown): PublicationWorkflowRequest {
  const row = object(value);
  const channels = strings(row.channels).filter(
    (channel): channel is 'customer' | 'b2b' | 'partner' => (
      channel === 'customer' || channel === 'b2b' || channel === 'partner'
    ),
  );
  const rawVersions = object(row.expected_pointer_versions);
  const expectedPointerVersions = Object.fromEntries(Object.entries(rawVersions).map(([channel, version]) => [
    channel,
    Number(version),
  ]));
  return {
    id: required(row.id, 'id'),
    tenantId: required(row.tenant_id, 'tenant_id'),
    catalogProductId: required(row.catalog_product_id, 'catalog_product_id'),
    packageId: required(row.package_id, 'package_id'),
    expectedRevisionId: required(row.expected_revision_id, 'expected_revision_id'),
    expectedRevisionNo: number(row.expected_revision_no) ?? 0,
    expectedSourceHash: required(row.expected_source_hash, 'expected_source_hash'),
    expectedPointerVersions,
    channels,
    locale: string(row.locale) ?? 'ko-KR',
    requestedBy: string(row.requested_by),
    requestedActor: required(row.requested_actor, 'requested_actor'),
    requestReason: required(row.request_reason, 'request_reason'),
    status: required(row.status, 'status'),
    snapshotId: string(row.snapshot_id),
    proofId: string(row.proof_id),
    workflowRunId: string(row.workflow_run_id),
  };
}

function truthRow(value: unknown): AdminPackagePublicationTruth {
  const row = object(value);
  return {
    tenantId: required(row.tenant_id, 'tenant_id'),
    catalogProductId: required(row.catalog_product_id, 'catalog_product_id'),
    productKey: required(row.product_key, 'product_key'),
    packageId: string(row.package_id),
    packageTitle: string(row.package_title),
    latestRevisionId: string(row.latest_revision_id),
    latestRevisionNo: number(row.latest_revision_no),
    latestRevisionStatus: string(row.latest_revision_status),
    sourceHash: string(row.source_hash),
    candidateSnapshotId: string(row.candidate_snapshot_id),
    candidateSnapshotStatus: string(row.candidate_snapshot_status),
    candidateSnapshotHash: string(row.candidate_snapshot_hash),
    candidateRendererBuildId: string(row.candidate_renderer_build_id),
    pointerState: string(row.pointer_state),
    pointerVersion: number(row.pointer_version) ?? 0,
    pointerRevisionId: string(row.pointer_revision_id),
    pointerSnapshotId: string(row.pointer_snapshot_id),
    snapshotStatus: string(row.snapshot_status),
    snapshotHash: string(row.snapshot_hash),
    rendererBuildId: string(row.renderer_build_id),
    proofId: string(row.proof_id),
    proofStatus: string(row.proof_status),
    futureDepartureCount: number(row.future_departure_count) ?? 0,
    pricedDepartureCount: number(row.priced_departure_count) ?? 0,
    requestOnlyDepartureCount: number(row.request_only_departure_count) ?? 0,
    invalidPriceLineageCount: number(row.invalid_price_lineage_count) ?? 0,
    copyPolicyVersion: string(row.copy_policy_version),
    copyQualityScore: number(row.copy_quality_score),
    documentaryProductMediaCount: number(row.documentary_product_media_count) ?? 0,
    customerReadinessBlockerCodes: strings(row.customer_readiness_blocker_codes),
    customerVisibilityState: string(row.customer_visibility_state) ?? 'public',
    saleState: string(row.sale_state) ?? 'available',
    latestPublicationRequestId: string(row.latest_publication_request_id),
    latestPublicationRequestStatus: string(row.latest_publication_request_status),
    actualCustomerPublic: row.actual_customer_catalog_public === true,
    blockerCodes: strings(row.blocker_codes),
    nextAction: string(row.next_action) ?? '등록 상태를 확인하세요.',
  };
}

export async function loadAdminPackagePublicationTruth(input: {
  supabase: SupabaseClient;
  tenantId: string;
  catalogProductId?: string | null;
  limit?: number;
  offset?: number;
}): Promise<AdminPackagePublicationTruth[]> {
  const { data, error } = await rpcClient(input.supabase).rpc(
    'get_product_registration_admin_publication_truth',
    {
      p_tenant_id: input.tenantId,
      p_catalog_product_id: input.catalogProductId ?? null,
      p_limit: Math.min(Math.max(input.limit ?? 100, 1), 200),
      p_offset: Math.max(input.offset ?? 0, 0),
    },
  );
  if (error) throw new Error(`REGISTRATION_PUBLICATION_TRUTH_FAILED:${error.message}`);
  return (Array.isArray(data) ? data : []).map(truthRow);
}

export async function requestProductRegistrationPublication(input: {
  supabase: SupabaseClient;
  request: PublicationRequestInput;
}): Promise<PublicationRequestResult> {
  const { request } = input;
  const { data, error } = await rpcClient(input.supabase).rpc(
    'request_product_registration_publication',
    {
      p_payload: {
        tenant_id: request.tenantId,
        catalog_product_id: request.catalogProductId,
        package_id: request.packageId,
        expected_revision_id: request.expectedRevisionId,
        expected_revision_no: request.expectedRevisionNo,
        expected_source_hash: request.expectedSourceHash,
        expected_pointer_versions: { customer: request.expectedPointerVersions.customer },
        // P0 customer publication is one independently fenced transaction.
        // B2B and partner delivery are secondary commands and cannot block or
        // silently ride along with a customer publication decision.
        channels: ['customer'],
        locale: 'ko-KR',
        source_review_decision_id: request.sourceReviewDecisionId ?? null,
        requested_by: request.requestedBy ?? null,
        requested_actor: request.requestedActor,
        request_reason: request.requestReason,
        idempotency_key: request.idempotencyKey,
      },
    },
  );
  if (error) throw new Error(error.message);
  const result = object(data);
  return {
    requestId: required(result.request_id, 'request_id'),
    status: required(result.status, 'status'),
    requestHash: required(result.request_hash, 'request_hash'),
    replayed: result.replayed === true,
  };
}

export async function claimProductRegistrationPublicationRequest(input: {
  supabase: SupabaseClient;
  publicationRequestId: string;
  workflowRunId: string;
}): Promise<{ action: string; request: PublicationWorkflowRequest }> {
  const { data, error } = await rpcClient(input.supabase).rpc(
    'claim_product_registration_publication_request',
    { p_payload: {
      publication_request_id: input.publicationRequestId,
      workflow_run_id: input.workflowRunId,
    } },
  );
  if (error) throw new Error(error.message);
  const result = object(data);
  return {
    action: required(result.action, 'action'),
    request: publicationWorkflowRequest(result.request),
  };
}

export async function loadProductRegistrationPublicationRequest(input: {
  supabase: SupabaseClient;
  publicationRequestId: string;
}): Promise<PublicationWorkflowRequest | null> {
  const { data, error } = await rpcClient(input.supabase).rpc(
    'get_product_registration_publication_request',
    { p_request_id: input.publicationRequestId },
  );
  if (error) throw new Error(error.message);
  if (!data) return null;
  return publicationWorkflowRequest(data);
}

export async function transitionProductRegistrationPublicationRequest(input: {
  supabase: SupabaseClient;
  publicationRequestId: string;
  workflowRunId: string;
  expectedStatus: string;
  nextStatus: string;
  snapshotId?: string | null;
  proofId?: string | null;
  releaseManifestHash?: string | null;
  liveCanaryResult?: JsonObject | null;
  errorCode?: string | null;
  errorDetail?: string | null;
}): Promise<PublicationWorkflowRequest> {
  const payload: JsonObject = {
    publication_request_id: input.publicationRequestId,
    workflow_run_id: input.workflowRunId,
    expected_status: input.expectedStatus,
    next_status: input.nextStatus,
    snapshot_id: input.snapshotId ?? null,
    proof_id: input.proofId ?? null,
    release_manifest_hash: input.releaseManifestHash ?? null,
    error_code: input.errorCode ?? null,
    error_detail: input.errorDetail ?? null,
  };
  if (input.liveCanaryResult) payload.live_canary_result = input.liveCanaryResult;
  const { data, error } = await rpcClient(input.supabase).rpc(
    'transition_product_registration_publication_request',
    { p_payload: payload },
  );
  if (error) throw new Error(error.message);
  return publicationWorkflowRequest(object(data).request);
}

export async function issueProductRegistrationReleaseAuthorization(input: {
  supabase: SupabaseClient;
  request: PublicationWorkflowRequest;
  snapshotId: string;
  snapshotHash: string;
  revisionHash: string;
  proofId: string;
  proofHash: string;
  channel: 'customer' | 'b2b' | 'partner';
  policyVersion: string;
}): Promise<{ authorizationId: string; expectedPointerVersion: number }> {
  const expectedPointerVersion = Number(input.request.expectedPointerVersions[input.channel] ?? 0);
  const { data, error } = await rpcClient(input.supabase).rpc(
    'issue_product_registration_release_authorization',
    { p_payload: {
      tenant_id: input.request.tenantId,
      product_id: input.request.catalogProductId,
      package_id: input.request.packageId,
      revision_id: input.request.expectedRevisionId,
      revision_hash: input.revisionHash,
      snapshot_id: input.snapshotId,
      snapshot_hash: input.snapshotHash,
      proof_id: input.proofId,
      proof_hash: input.proofHash,
      expected_pointer_version: expectedPointerVersion,
      policy_version: input.policyVersion,
      approved_by: input.request.requestedBy,
      approved_actor: input.request.requestedActor,
      approval_reason: input.request.requestReason,
      expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
      channel: input.channel,
      locale: input.request.locale,
    } },
  );
  if (error) throw new Error(error.message);
  const result = object(data);
  return {
    authorizationId: required(result.authorization_id, 'authorization_id'),
    expectedPointerVersion: number(result.expected_pointer_version) ?? expectedPointerVersion,
  };
}

export async function publishProductRegistrationSnapshotBundle(input: {
  supabase: SupabaseClient;
  request: PublicationWorkflowRequest;
  snapshotId: string;
  snapshotHash: string;
  revisionHash: string;
  proofId: string;
  proofHash: string;
  releaseManifestHash: string;
  outcome: 'published_verified' | 'published_degraded';
  policyVersion: string;
  authorizations: Array<{
    channel: 'customer' | 'b2b' | 'partner';
    authorizationId: string;
    expectedPointerVersion: number;
  }>;
}): Promise<JsonObject> {
  const { data, error } = await rpcClient(input.supabase).rpc(
    'publish_product_registration_snapshot_bundle_atomic',
    { p_payload: {
      publication_request_id: input.request.id,
      tenant_id: input.request.tenantId,
      catalog_product_id: input.request.catalogProductId,
      package_id: input.request.packageId,
      revision_id: input.request.expectedRevisionId,
      revision_hash: input.revisionHash,
      snapshot_id: input.snapshotId,
      snapshot_hash: input.snapshotHash,
      proof_run_id: input.proofId,
      proof_hash: input.proofHash,
      policy_version: input.policyVersion,
      outcome: input.outcome,
      release_manifest_hash: input.releaseManifestHash,
      operation_key: `publication-request:${input.request.id}:bundle`,
      publications: input.authorizations.map(authorization => ({
        channel: authorization.channel,
        expected_pointer_version: authorization.expectedPointerVersion,
        release_authorization_id: authorization.authorizationId,
        operation_key: `publication-request:${input.request.id}:${authorization.channel}`,
      })),
    } },
  );
  if (error) throw new Error(error.message);
  return object(data);
}

export async function markProductRegistrationConvergenceFailed(input: {
  supabase: SupabaseClient;
  publicationRequestId?: string | null;
  tenantId: string;
  catalogProductId: string;
  packageId: string;
  revisionId: string;
  snapshotId: string;
  reason: string;
  errorDetail?: string | null;
  liveCanaryResult?: JsonObject | null;
}): Promise<JsonObject> {
  const { data, error } = await rpcClient(input.supabase).rpc(
    'mark_product_registration_convergence_failed',
    {
      p_payload: {
        publication_request_id: input.publicationRequestId ?? null,
        tenant_id: input.tenantId,
        catalog_product_id: input.catalogProductId,
        package_id: input.packageId,
        revision_id: input.revisionId,
        snapshot_id: input.snapshotId,
        reason: input.reason,
        error_detail: input.errorDetail ?? null,
        ...(input.liveCanaryResult ? { live_canary_result: input.liveCanaryResult } : {}),
      },
    },
  );
  if (error) throw new Error(error.message);
  return object(data);
}
