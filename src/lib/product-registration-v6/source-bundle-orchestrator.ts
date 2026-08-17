import type { SupabaseClient } from '@supabase/supabase-js';

import { persistDocumentExtraction } from '@/lib/product-registration-v4/extractions';
import { mergeSourceBundleDocumentIR } from '@/lib/product-registration-v4/source-bundle-document-ir';
import type { DocumentIR } from '@/lib/product-registration-v4/types';

import {
  buildSourceBundleFingerprint,
  resolveSourceDocumentBundles,
  type SourceBundleDocument,
} from './source-bundle-resolver';

type JsonObject = Record<string, unknown>;

export type SourceBundleWorkflowResolution = {
  state: 'not_applicable' | 'waiting_for_peer' | 'not_matched' | 'coordinator' | 'consolidated_by_peer';
  extractionId: string;
  bundleId: string | null;
  bundleHash: string | null;
  coordinatorJobId: string | null;
};

function object(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function supplierKey(metadata: unknown): string | null {
  const root = object(metadata);
  const upload = object(root.uploadSourceMetadata);
  const value = upload.landOperator ?? root.landOperator;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export async function resolveSourceBundleForWorkflow(input: {
  supabase: SupabaseClient;
  tenantId: string;
  jobId: string;
  fencingToken: number;
  sourceDocumentId: string;
  extractionId: string;
  uploadSourceMetadata: Record<string, unknown>;
}): Promise<SourceBundleWorkflowResolution> {
  const rawBatch = object(input.uploadSourceMetadata.sourceBatch);
  const batchId = typeof rawBatch.id === 'string' ? rawBatch.id.trim() : '';
  const batchSize = Number(rawBatch.size);
  const base = {
    extractionId: input.extractionId,
    bundleId: null,
    bundleHash: null,
    coordinatorJobId: null,
  };
  if (!batchId || !Number.isInteger(batchSize) || batchSize < 2) {
    return { ...base, state: 'not_applicable' };
  }

  const { data: sourceRows, error: sourceError } = await input.supabase
    .from('product_source_documents')
    .select('id,tenant_id,sha256,original_filename,metadata,status')
    .eq('tenant_id', input.tenantId)
    .contains('metadata', { sourceBatch: { id: batchId } })
    .not('status', 'in', '(quarantined,deleted)')
    .limit(Math.min(100, batchSize + 5));
  if (sourceError) throw sourceError;
  if ((sourceRows ?? []).length < batchSize) return { ...base, state: 'waiting_for_peer' };
  const sourceIds = (sourceRows ?? []).map(row => String(row.id));
  const { data: extractionRows, error: extractionError } = await input.supabase
    .from('product_document_extractions')
    .select('id,source_document_id,document_ir,created_at,parser_engine')
    .eq('tenant_id', input.tenantId)
    .in('source_document_id', sourceIds)
    .eq('status', 'complete')
    .neq('parser_engine', 'source-bundle-evidence-ir')
    .order('created_at', { ascending: false });
  if (extractionError) throw extractionError;
  const extractionBySource = new Map<string, { id: string; documentIr: DocumentIR }>();
  for (const row of extractionRows ?? []) {
    const sourceDocumentId = String(row.source_document_id);
    if (!extractionBySource.has(sourceDocumentId)) {
      extractionBySource.set(sourceDocumentId, {
        id: String(row.id),
        documentIr: row.document_ir as DocumentIR,
      });
    }
  }
  if (extractionBySource.size < batchSize) return { ...base, state: 'waiting_for_peer' };

  const documents: SourceBundleDocument[] = (sourceRows ?? []).flatMap(row => {
    const extraction = extractionBySource.get(String(row.id));
    if (!extraction) return [];
    const documentIr = extraction.documentIr;
    return [{
      id: String(row.id),
      tenantId: input.tenantId,
      supplierKey: supplierKey(row.metadata),
      sourceHash: String(row.sha256),
      filename: String(row.original_filename),
      text: documentIr.text,
      uploadBatchKey: batchId,
    }];
  });
  const bundle = resolveSourceDocumentBundles(documents).find(candidate => (
    candidate.priceDocumentId === input.sourceDocumentId
    || candidate.itineraryDocumentId === input.sourceDocumentId
  ));
  if (!bundle) return { ...base, state: 'not_matched' };
  const members = bundle.members.map(bundleMember => {
    const sourceDocumentId = bundleMember.documentId;
    const document = documents.find(row => row.id === sourceDocumentId)!;
    const extraction = extractionBySource.get(sourceDocumentId)!;
    const role = buildSourceBundleFingerprint(document).role;
    if (role !== bundleMember.role) {
      throw new Error('SOURCE_BUNDLE_MEMBER_ROLE_CHANGED');
    }
    return { document, extraction, role };
  });
  const { data: claim, error: claimError } = await input.supabase.rpc('claim_product_registration_source_bundle', {
    p_payload: {
      tenant_id: input.tenantId,
      job_id: input.jobId,
      source_document_id: input.sourceDocumentId,
      bundle_hash: bundle.bundleHash,
      resolver_version: bundle.resolverVersion,
      supplier_key: bundle.supplierKey,
      grouping_authority: bundle.groupingAuthority,
      grouping_key: bundle.groupingKey,
      score: bundle.score,
      ambiguity_margin: bundle.ambiguityMargin,
      resolution_metadata: { reasons: bundle.reasons, memberSourceHashes: bundle.memberSourceHashes },
      members: members.map(member => ({
        source_document_id: member.document.id,
        source_hash: member.document.sourceHash,
        document_role: member.role,
        evidence_scope: { extraction_id: member.extraction.id },
      })),
    },
  });
  if (claimError) throw claimError;
  const claimRow = object(claim);
  const bundleId = typeof claimRow.id === 'string' ? claimRow.id : null;
  const coordinatorJobId = typeof claimRow.coordinator_job_id === 'string' ? claimRow.coordinator_job_id : null;
  if (claimRow.claimed !== true) {
    return {
      ...base,
      state: 'consolidated_by_peer',
      bundleId,
      bundleHash: bundle.bundleHash,
      coordinatorJobId,
    };
  }

  const mergedIr = mergeSourceBundleDocumentIR({
    bundleHash: bundle.bundleHash,
    members: members.map(member => ({
      sourceDocumentId: member.document.id,
      extractionId: member.extraction.id,
      sourceHash: member.document.sourceHash,
      role: member.role,
      documentIr: member.extraction.documentIr,
    })),
  });
  const mergedExtraction = await persistDocumentExtraction({
    supabase: input.supabase,
    sourceDocumentId: input.sourceDocumentId,
    tenantId: input.tenantId,
    documentIr: mergedIr,
    qualityDiagnostics: {
      sourceBundleId: bundleId,
      sourceBundleHash: bundle.bundleHash,
      memberSourceHashes: bundle.memberSourceHashes,
      resolverVersion: bundle.resolverVersion,
    },
  });
  const { data: currentJob, error: jobError } = await input.supabase
    .from('upload_jobs')
    .select('v4_stage_state')
    .eq('id', input.jobId)
    .eq('v6_fencing_token', input.fencingToken)
    .single();
  if (jobError || !currentJob) throw jobError ?? new Error('SOURCE_BUNDLE_JOB_NOT_FOUND');
  const currentState = object(currentJob.v4_stage_state);
  const { data: updated, error: updateError } = await input.supabase
    .from('upload_jobs')
    .update({
      extraction_id: mergedExtraction.id,
      v4_stage_state: {
        ...currentState,
        sourceBundleId: bundleId,
        sourceBundleHash: bundle.bundleHash,
        sourceBundleResolverVersion: bundle.resolverVersion,
        sourceBundleMemberHashes: bundle.memberSourceHashes,
      },
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.jobId)
    .eq('v6_fencing_token', input.fencingToken)
    .select('id')
    .maybeSingle();
  if (updateError) throw updateError;
  if (!updated) throw new Error('V6_WORKFLOW_FENCING_CONFLICT');
  return {
    state: 'coordinator',
    extractionId: mergedExtraction.id,
    bundleId,
    bundleHash: bundle.bundleHash,
    coordinatorJobId: input.jobId,
  };
}
