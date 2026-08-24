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
  latestRevisionId: string | null;
  latestRevisionNo: number | null;
  latestRevisionStatus: string | null;
  sourceHash: string | null;
  pointerState: string | null;
  pointerVersion: number;
  pointerRevisionId: string | null;
  pointerSnapshotId: string | null;
  snapshotStatus: string | null;
  snapshotHash: string | null;
  rendererBuildId: string | null;
  proofId: string | null;
  proofStatus: string | null;
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
  expectedPointerVersions: Record<'customer' | 'b2b' | 'partner', number>;
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

function truthRow(value: unknown): AdminPackagePublicationTruth {
  const row = object(value);
  return {
    tenantId: required(row.tenant_id, 'tenant_id'),
    catalogProductId: required(row.catalog_product_id, 'catalog_product_id'),
    productKey: required(row.product_key, 'product_key'),
    packageId: string(row.package_id),
    latestRevisionId: string(row.latest_revision_id),
    latestRevisionNo: number(row.latest_revision_no),
    latestRevisionStatus: string(row.latest_revision_status),
    sourceHash: string(row.source_hash),
    pointerState: string(row.pointer_state),
    pointerVersion: number(row.pointer_version) ?? 0,
    pointerRevisionId: string(row.pointer_revision_id),
    pointerSnapshotId: string(row.pointer_snapshot_id),
    snapshotStatus: string(row.snapshot_status),
    snapshotHash: string(row.snapshot_hash),
    rendererBuildId: string(row.renderer_build_id),
    proofId: string(row.proof_id),
    proofStatus: string(row.proof_status),
    customerVisibilityState: string(row.customer_visibility_state) ?? 'public',
    saleState: string(row.sale_state) ?? 'available',
    latestPublicationRequestId: string(row.latest_publication_request_id),
    latestPublicationRequestStatus: string(row.latest_publication_request_status),
    actualCustomerPublic: row.actual_customer_public === true,
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
        expected_pointer_versions: request.expectedPointerVersions,
        channels: ['customer', 'b2b', 'partner'],
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
      },
    },
  );
  if (error) throw new Error(error.message);
  return object(data);
}
