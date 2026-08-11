import { createHash, randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';
import { start } from 'workflow/api';

import { createProductRegistrationV4Job } from '@/lib/product-registration-v4/jobs';
import { ensureSourceDocumentStored } from '@/lib/product-registration-v4/source-documents';
import type { SourceDocumentRecord } from '@/lib/product-registration-v4/types';
import {
  PRODUCT_REGISTRATION_V6_POLICY_VERSION,
  type ProductRegistrationV6WorkflowInput,
} from '@/lib/product-registration-v6/types';
import { productRegistrationV6Workflow } from '@/workflows/product-registration-v6';

type CorrectionBinding = {
  correctionJobId: string;
  catalogProductId: string;
  baseRevisionId: string;
  productKey: string;
  operationKey: string;
};

export type KernelWorkflowStartResult = {
  jobId: string;
  workflowRunId: string;
  sourceDocumentId: string;
  sourceHash: string;
  dedupeHit: boolean;
};

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
  correction?: CorrectionBinding;
  dedupeHit?: boolean;
}): Promise<KernelWorkflowStartResult> {
  const requestId = input.requestId ?? randomUUID();
  let jobId: string | null = null;
  let fencingToken: number | null = null;
  try {
    const job = await createProductRegistrationV4Job({
      supabase: input.supabase,
      sourceType: input.source.source_type === 'text' ? 'text' : 'file',
      sourceDocumentId: input.source.id,
      normalizedHash: input.source.sha256,
      tenantId: input.tenantId,
      initialState: {
        sourceChannel: input.sourceChannel,
        ...(input.correction ? {
          correctionJobId: input.correction.correctionJobId,
          correctionCatalogProductId: input.correction.catalogProductId,
          correctionBaseRevisionId: input.correction.baseRevisionId,
          correctionProductKey: input.correction.productKey,
          correctionOperationKey: input.correction.operationKey,
        } : {}),
      },
    });
    jobId = job.id;
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
      archiveMode: false,
      bulkMode: false,
      forceReprocess: input.forceReprocess ?? false,
      fencingToken,
      policyVersion: PRODUCT_REGISTRATION_V6_POLICY_VERSION,
      correctionJobId: input.correction?.correctionJobId,
    };
    const run = await start(productRegistrationV6Workflow, [workflowInput]);
    return {
      jobId,
      workflowRunId: run.runId,
      sourceDocumentId: input.source.id,
      sourceHash: input.source.sha256,
      dedupeHit: input.dedupeHit ?? false,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (jobId != null && fencingToken != null) {
      try {
        await input.supabase.rpc('record_product_registration_v6_terminal_outcome', {
          p_job_id: jobId,
          p_workflow_run_id: `start-failed:${requestId}`,
          p_expected_fencing_token: fencingToken,
          p_outcome: 'blocked_action_required',
          p_policy_version: PRODUCT_REGISTRATION_V6_POLICY_VERSION,
          p_degraded_reasons: [],
          p_blockers: [`WORKFLOW_START_FAILED:${detail}`],
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
}): Promise<KernelWorkflowStartResult> {
  const stored = await storeProductRegistrationTextSource(input);
  return startProductRegistrationWorkflowForSource({
    ...input,
    source: stored.source,
    dedupeHit: stored.dedupeHit,
  });
}
