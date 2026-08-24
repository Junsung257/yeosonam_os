import { createHash, randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';
import { start } from 'workflow/api';

import {
  PRODUCT_REGISTRATION_V4_PARSER_ENGINE,
  PRODUCT_REGISTRATION_V4_PARSER_VERSION,
} from '@/lib/product-registration-v4/types';
import { ensureSourceDocumentStored } from '@/lib/product-registration-v4/source-documents';
import type { SourceDocumentRecord } from '@/lib/product-registration-v4/types';
import {
  mergeProductSourceUploadMetadata,
  parseProductSourceDepartureYearContext,
} from '@/lib/product-registration/source-departure-year-context';
import {
  PRODUCT_REGISTRATION_V6_POLICY_VERSION,
  PRODUCT_REGISTRATION_V6_SCHEMA_VERSION,
  PRODUCT_REGISTRATION_V6_WORKFLOW_VERSION,
  type ProductRegistrationV6WorkflowInput,
} from '@/lib/product-registration-v6/types';
import {
  assertProductDepartureReferenceDate,
  PRODUCT_SOURCE_DEPARTURE_DATE_POLICY_VERSION,
  PRODUCT_SOURCE_DEPARTURE_TIMEZONE,
} from '@/lib/product-registration/future-departure-date-policy';
import { productRegistrationV6Workflow } from '@/workflows/product-registration-v6';
import { currentProductRegistrationRendererBuildId } from '@/lib/product-registration-v6/renderer-build';

type CorrectionBinding = {
  correctionJobId: string;
  catalogProductId: string;
  baseRevisionId: string;
  productKey: string;
  operationKey: string;
};

type IdentityBinding = {
  catalogProductId: string;
  baseRevisionId?: string | null;
  productKey: string;
  operationKey: string;
  bindingKind: 'legacy_backfill';
  targetTitle?: string | null;
  targetInternalCode?: string | null;
};

type DepartureDateReferenceOverride = {
  referenceDate: string;
  rollingInferenceEligible: boolean;
};

function defaultRollingDepartureDateInferenceEligible(input: {
  sourceChannel: string;
  archiveMode: boolean;
}): boolean {
  return !input.archiveMode && [
    'upload',
    'admin-reprocess',
    'admin-critical-fact-review',
    'admin-extract',
    'admin-job',
    // Legacy inventory is reprocessed as a live product-registration input.
    // It must use the same yearless month/day policy as a fresh upload; treating
    // it as archive-only turns otherwise valid upcoming departures into
    // PRICE_DATE_YEAR_MISSING blockers.
    'legacy_backfill',
  ].includes(input.sourceChannel);
}

export type KernelWorkflowStartResult = {
  jobId: string;
  workflowRunId: string | null;
  sourceDocumentId: string;
  sourceHash: string;
  dedupeHit: boolean;
  currentStage: string;
  jobState: string;
  terminalOutcome: string | null;
  workflowVersion: string;
};

const SOURCE_DOCUMENT_COLUMNS = [
  'id',
  'original_filename',
  'storage_bucket',
  'storage_path',
  'sha256',
  'byte_size',
  'declared_mime',
  'detected_mime',
  'source_type',
  'status',
  'security_scan',
  'metadata',
  'tenant_id',
  'uploaded_by',
  'created_at',
  'updated_at',
].join(',');

export async function loadProductRegistrationSource(input: {
  supabase: SupabaseClient;
  sourceDocumentId: string;
  tenantId?: string | null;
}): Promise<SourceDocumentRecord> {
  let query = input.supabase
    .from('product_source_documents')
    .select(SOURCE_DOCUMENT_COLUMNS)
    .eq('id', input.sourceDocumentId);
  if (input.tenantId) query = query.eq('tenant_id', input.tenantId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('REGISTRATION_SOURCE_DOCUMENT_NOT_FOUND');
  const source = data as unknown as SourceDocumentRecord;
  if (!source.tenant_id) throw new Error('REGISTRATION_SOURCE_TENANT_REQUIRED');
  if (source.status === 'quarantined' || source.status === 'deleted') {
    throw new Error(`REGISTRATION_SOURCE_NOT_PROCESSABLE:${source.status}`);
  }
  return source;
}

export async function storeProductRegistrationTextSource(input: {
  supabase: SupabaseClient;
  tenantId: string;
  rawText: string;
  fileName: string;
  requestId?: string;
  sourceChannel: string;
  metadata?: Record<string, unknown>;
}): Promise<{ source: SourceDocumentRecord; dedupeHit: boolean }> {
  const rawText = input.rawText.trim();
  if (rawText.length < 50) throw new Error('REGISTRATION_SOURCE_TEXT_TOO_SHORT');
  const buffer = Buffer.from(rawText, 'utf8');
  const sourceHash = createHash('sha256').update(buffer).digest('hex');
  const { data: existing, error: existingError } = await input.supabase
    .from('product_source_documents')
    .select('id')
    .eq('tenant_id', input.tenantId)
    .eq('sha256', sourceHash)
    .eq('byte_size', buffer.byteLength)
    .maybeSingle();
  if (existingError) throw existingError;
  const source = await ensureSourceDocumentStored({
    supabase: input.supabase,
    tenantId: input.tenantId,
    buffer,
    filename: input.fileName,
    declaredMime: 'text/plain',
    sourceType: 'text',
    requestKey: input.requestId ?? randomUUID(),
    sourceChannel: input.sourceChannel,
    metadata: {
      sourceChannel: input.sourceChannel,
      ...(input.metadata ?? {}),
    },
  });
  return { source, dedupeHit: Boolean(existing) };
}

export async function startProductRegistrationWorkflowForSource(input: {
  supabase: SupabaseClient;
  tenantId: string;
  source: SourceDocumentRecord;
  requestId?: string;
  requestBaseUrl: string;
  publicBaseUrl: string;
  uploadSourceMetadata: Record<string, unknown>;
  sourceChannel: string;
  forceReprocess?: boolean;
  archiveMode?: boolean;
  bulkMode?: boolean;
  correction?: CorrectionBinding;
  identityBinding?: IdentityBinding;
  dedupeHit?: boolean;
  departureDateReferenceOverride?: DepartureDateReferenceOverride;
  operationKey?: string | null;
}): Promise<KernelWorkflowStartResult> {
  const requestId = input.requestId ?? randomUUID();
  const sourceDepartureYearContext = parseProductSourceDepartureYearContext(
    input.uploadSourceMetadata.sourceDepartureYearContext,
  );
  if (!sourceDepartureYearContext.ok) throw new Error(sourceDepartureYearContext.code);
  let jobId: string | null = null;
  let fencingToken: number | null = null;
  try {
    const rollingDepartureDateInferenceEligible = input.departureDateReferenceOverride
      ?.rollingInferenceEligible
      ?? defaultRollingDepartureDateInferenceEligible({
        sourceChannel: input.sourceChannel,
        archiveMode: input.archiveMode ?? false,
      });
    const initialState = {
        sourceChannel: input.sourceChannel,
        archiveMode: input.archiveMode ?? false,
        bulkMode: input.bulkMode ?? false,
        rollingDepartureDateInferenceEligible,
        sourceDepartureYearContext: sourceDepartureYearContext.value,
        ...(Array.isArray(input.uploadSourceMetadata.criticalFactHumanOverrides)
          ? {
              criticalFactOverrides: input.uploadSourceMetadata.criticalFactHumanOverrides,
              criticalFactOverrideAuthority: 'authorized_human_evidence_selection',
            }
          : {}),
        ...(input.identityBinding ? {
          authorityBindingKind: input.identityBinding.bindingKind,
          correctionCatalogProductId: input.identityBinding.catalogProductId,
          correctionBaseRevisionId: input.identityBinding.baseRevisionId ?? null,
          correctionProductKey: input.identityBinding.productKey,
          authorityBindingOperationKey: input.identityBinding.operationKey,
          authorityBindingTargetTitle: input.identityBinding.targetTitle ?? null,
          authorityBindingTargetInternalCode: input.identityBinding.targetInternalCode ?? null,
        } : {}),
        ...(input.correction ? {
          correctionJobId: input.correction.correctionJobId,
          correctionCatalogProductId: input.correction.catalogProductId,
          correctionBaseRevisionId: input.correction.baseRevisionId,
          correctionProductKey: input.correction.productKey,
          correctionOperationKey: input.correction.operationKey,
        } : {}),
    };
    const operationKey = input.operationKey?.trim()
      || input.correction?.operationKey
      || input.identityBinding?.operationKey
      || `v61:${createHash('sha256').update(JSON.stringify({
        tenantId: input.tenantId,
        sourceDocumentId: input.source.id,
        sourceHash: input.source.sha256,
        sourceChannel: input.sourceChannel,
        workflowVersion: PRODUCT_REGISTRATION_V6_WORKFLOW_VERSION,
        forceRequestId: input.forceReprocess ? requestId : null,
      })).digest('hex')}`;
    const { data: reserved, error: reserveError } = await input.supabase.rpc(
      'reserve_product_registration_v61_job',
      { p_payload: {
        tenant_id: input.tenantId,
        source_document_id: input.source.id,
        operation_key: operationKey,
        source_type: input.source.source_type === 'text' ? 'text' : 'file',
        normalized_hash: input.source.sha256,
        parser_engine: PRODUCT_REGISTRATION_V4_PARSER_ENGINE,
        parser_version: PRODUCT_REGISTRATION_V4_PARSER_VERSION,
        normalizer_version: PRODUCT_REGISTRATION_V4_PARSER_VERSION,
        initial_state: initialState,
        date_policy_version: PRODUCT_SOURCE_DEPARTURE_DATE_POLICY_VERSION,
        source_channel: input.sourceChannel,
        reference_date: input.departureDateReferenceOverride?.referenceDate ?? null,
        workflow_version: PRODUCT_REGISTRATION_V6_WORKFLOW_VERSION,
        publication_policy_version: PRODUCT_REGISTRATION_V6_POLICY_VERSION,
        renderer_version: currentProductRegistrationRendererBuildId(),
        schema_version: PRODUCT_REGISTRATION_V6_SCHEMA_VERSION,
        engine_commit_sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      } },
    );
    if (reserveError) throw reserveError;
    const reservation = (reserved ?? {}) as Record<string, unknown>;
    jobId = String(reservation.job_id ?? '');
    if (!jobId) throw new Error('PRODUCT_REGISTRATION_JOB_RESERVATION_MISSING');
    const jobDedupeHit = reservation.dedupe_hit === true;
    const currentStage = String(reservation.current_stage ?? 'RECEIVED');
    const jobState = String(reservation.job_state ?? 'QUEUED');
    const terminalOutcome = typeof reservation.terminal_outcome === 'string'
      ? reservation.terminal_outcome
      : null;
    const existingWorkflowRunId = typeof reservation.workflow_run_id === 'string'
      ? reservation.workflow_run_id
      : null;
    if (jobDedupeHit && (jobState !== 'QUEUED' || existingWorkflowRunId)) {
      return {
        jobId,
        workflowRunId: existingWorkflowRunId,
        sourceDocumentId: input.source.id,
        sourceHash: input.source.sha256,
        dedupeHit: true,
        currentStage,
        jobState,
        terminalOutcome,
        workflowVersion: String(reservation.workflow_version ?? PRODUCT_REGISTRATION_V6_WORKFLOW_VERSION),
      };
    }
    if (typeof reservation.reference_date !== 'string') {
      throw new Error('PRODUCT_REGISTRATION_DEPARTURE_REFERENCE_DATE_MISSING');
    }
    const referenceDate = assertProductDepartureReferenceDate(reservation.reference_date);
    if (reservation.date_policy_version !== PRODUCT_SOURCE_DEPARTURE_DATE_POLICY_VERSION) {
      throw new Error('PRODUCT_REGISTRATION_DEPARTURE_DATE_POLICY_VERSION_MISMATCH');
    }
    if (input.correction) {
      const { error: bindError } = await input.supabase.rpc('bind_product_registration_correction_workflow', {
        p_payload: {
          correction_job_id: input.correction.correctionJobId,
          workflow_job_id: jobId,
        },
      });
      if (bindError) throw bindError;
    }
    const { data: claim, error: claimError } = await input.supabase.rpc('claim_product_registration_v6_workflow', {
      p_job_id: jobId,
    });
    if (claimError) throw claimError;
    fencingToken = Number((claim as { fencing_token?: unknown } | null)?.fencing_token);
    if (!Number.isInteger(fencingToken) || fencingToken < 1) {
      throw new Error('PRODUCT_REGISTRATION_V6_FENCING_TOKEN_INVALID');
    }
    const workflowInput: ProductRegistrationV6WorkflowInput = {
      jobId,
      tenantId: input.tenantId,
      sourceDocumentId: input.source.id,
      requestId,
      requestBaseUrl: input.requestBaseUrl,
      publicBaseUrl: input.publicBaseUrl,
      sourceType: input.source.source_type,
      fileName: input.source.original_filename,
      declaredMime: input.source.declared_mime,
      fileHash: input.source.sha256,
      directRawText: null,
      originalRawText: null,
      parserRawText: null,
      analysisNormalizedText: null,
      uploadSourceMetadata: input.uploadSourceMetadata,
      archiveMode: input.archiveMode ?? false,
      bulkMode: input.bulkMode ?? false,
      forceReprocess: input.forceReprocess ?? false,
      fencingToken,
      policyVersion: PRODUCT_REGISTRATION_V6_POLICY_VERSION,
      departureDateReference: {
        referenceDate,
        timezone: PRODUCT_SOURCE_DEPARTURE_TIMEZONE,
        policyVersion: PRODUCT_SOURCE_DEPARTURE_DATE_POLICY_VERSION,
        rollingInferenceEligible: rollingDepartureDateInferenceEligible,
      },
      correctionJobId: input.correction?.correctionJobId,
    };
    const run = await start(productRegistrationV6Workflow, [workflowInput]);
    const { error: bindRunError } = await input.supabase.rpc('bind_product_registration_v6_workflow_run', {
      p_job_id: jobId,
      p_fencing_token: fencingToken,
      p_workflow_run_id: run.runId,
    });
    if (bindRunError) {
      await run.cancel().catch(() => undefined);
      throw bindRunError;
    }
    return {
      jobId,
      workflowRunId: run.runId,
      sourceDocumentId: input.source.id,
      sourceHash: input.source.sha256,
      dedupeHit: jobDedupeHit,
      currentStage: 'RECEIVED',
      jobState: 'RUNNING',
      terminalOutcome: null,
      workflowVersion: PRODUCT_REGISTRATION_V6_WORKFLOW_VERSION,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (jobId != null && fencingToken != null) {
      try {
        await input.supabase.rpc('record_product_registration_v6_terminal_state', {
          p_payload: {
            job_id: jobId,
            tenant_id: input.tenantId,
            workflow_run_id: `start-failed:${requestId}`,
            expected_fencing_token: fencingToken,
            analysis_outcome: 'blocked',
            publication_state: 'not_requested',
            compatibility_outcome: 'blocked_action_required',
            policy_version: PRODUCT_REGISTRATION_V6_POLICY_VERSION,
            degraded_reasons: [],
            blockers: [`WORKFLOW_START_FAILED:${detail}`],
          },
        });
      } catch {
        // The watchdog can recover a claimed job when persistence itself is unavailable.
      }
    }
    if (input.correction) {
      try {
        await input.supabase.rpc('finalize_product_registration_correction', {
          p_payload: {
            correction_job_id: input.correction.correctionJobId,
            workflow_job_id: jobId,
            status: 'failed',
            resulting_revision_id: null,
          },
        });
      } catch {
        // The workflow terminal outcome remains the source of recovery truth.
      }
    }
    throw error;
  }
}

export async function startProductRegistrationWorkflowBySourceId(input: {
  supabase: SupabaseClient;
  sourceDocumentId: string;
  tenantId?: string | null;
  requestId?: string;
  requestBaseUrl: string;
  publicBaseUrl: string;
  uploadSourceMetadata?: Record<string, unknown>;
  sourceChannel: string;
  forceReprocess?: boolean;
  archiveMode?: boolean;
  bulkMode?: boolean;
  correction?: CorrectionBinding;
  identityBinding?: IdentityBinding;
  dedupeHit?: boolean;
  departureDateReferenceOverride?: DepartureDateReferenceOverride;
  operationKey?: string | null;
}): Promise<KernelWorkflowStartResult> {
  const source = await loadProductRegistrationSource({
    supabase: input.supabase,
    sourceDocumentId: input.sourceDocumentId,
    tenantId: input.tenantId,
  });
  const sourceMetadata = source.metadata && typeof source.metadata === 'object'
    ? source.metadata
    : {};
  return startProductRegistrationWorkflowForSource({
    ...input,
    tenantId: source.tenant_id!,
    source,
    uploadSourceMetadata: mergeProductSourceUploadMetadata({
      sourceMetadata,
      requestMetadata: input.uploadSourceMetadata,
    }),
  });
}

export async function startProductRegistrationTextWorkflow(input: {
  supabase: SupabaseClient;
  tenantId: string;
  rawText: string;
  fileName: string;
  requestId?: string;
  requestBaseUrl: string;
  publicBaseUrl: string;
  uploadSourceMetadata: Record<string, unknown>;
  sourceChannel: string;
  metadata?: Record<string, unknown>;
  forceReprocess?: boolean;
  archiveMode?: boolean;
  bulkMode?: boolean;
  identityBinding?: IdentityBinding;
  departureDateReferenceOverride?: DepartureDateReferenceOverride;
}): Promise<KernelWorkflowStartResult> {
  const stored = await storeProductRegistrationTextSource(input);
  return startProductRegistrationWorkflowForSource({
    ...input,
    source: stored.source,
    dedupeHit: stored.dedupeHit,
  });
}
