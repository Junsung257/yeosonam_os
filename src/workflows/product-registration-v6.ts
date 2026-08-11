import { FatalError, getWorkflowMetadata } from 'workflow';
import type { SupabaseClient } from '@supabase/supabase-js';

import { postAlert } from '@/lib/admin-alerts';
import { analyzeUploadInputText } from '@/lib/product-registration-input-guard';
import { runUploadRegistrationPipeline } from '@/lib/product-registration/upload-registration-pipeline';
import type { UploadRequestIntakeSuccess } from '@/lib/product-registration/upload-request-intake';
import { processProductRegistrationV4CanonicalNormalizationJob } from '@/lib/product-registration-v4/canonical-worker';
import { processProductRegistrationV4ExtractionJob } from '@/lib/product-registration-v4/extractions';
import { getProductRegistrationV4Job } from '@/lib/product-registration-v4/jobs';
import { observeProductRegistrationV5ConvergenceBatch } from '@/lib/product-registration-v4/convergence-observer';
import { processProductRegistrationV5OutboxBatch } from '@/lib/product-registration-v4/outbox-worker';
import { getSupabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import type { UploadSourceMetadataResult } from '@/lib/upload-source-metadata';
import { sha256Hex } from '@/lib/product-registration-v4/document-ir';
import { resolveSharedFactsForJob, type SharedFactJobResult } from '@/lib/product-registration-v6/shared-fact-orchestrator';
import {
  buildProductRegistrationV6CandidateSnapshots,
  proveProductRegistrationV6Snapshot,
  publishProductRegistrationV6Snapshot,
  type ProductRegistrationV6CandidateSnapshot,
} from '@/lib/product-registration-v6/snapshot-publication';
import { evaluateProductRegistrationV6Policy } from '@/lib/product-registration-v6/terminal-policy';
import { loadProductRegistrationV6PublicationBlockers } from '@/lib/product-registration-v6/publication-control';
import { buildProductRegistrationV6DomainProjection, persistProductRegistrationV6DomainProjection } from '@/lib/product-registration-v6/domain-projections';
import { buildProductRegistrationV6Copy, persistProductRegistrationV6Copy } from '@/lib/product-registration-v6/copy-revision';
import {
  PRODUCT_REGISTRATION_V6_WORKFLOW_VERSION,
  PRODUCT_REGISTRATION_V6_STAGES,
  type ProductRegistrationV6Decision,
  type ProductRegistrationV6Stage,
  type ProductRegistrationV6WorkflowInput,
  type ProductRegistrationV6WorkflowResult,
} from '@/lib/product-registration-v6/types';

type JsonObject = Record<string, unknown>;

function db(): SupabaseClient {
  const client = getSupabaseAdmin();
  if (!client) throw new FatalError('SUPABASE_ADMIN_NOT_CONFIGURED');
  // V6 migrations intentionally land before the generated Database type is
  // refreshed. Keep the boundary typed as the public Supabase client so new
  // append-only tables/RPCs do not collapse to `never` during that window.
  return client as SupabaseClient;
}

async function recordStage(input: {
  jobId: string;
  fencingToken: number;
  stage: ProductRegistrationV6Stage;
  status: 'running' | 'succeeded' | 'failed';
  output?: JsonObject;
  error?: string | null;
}) {
  const supabase = db();
  const inputHash = sha256Hex(JSON.stringify({
    jobId: input.jobId,
    fencingToken: input.fencingToken,
    stage: input.stage,
    workflowVersion: PRODUCT_REGISTRATION_V6_WORKFLOW_VERSION,
  }));
  const now = new Date().toISOString();
  const { data: job, error: jobError } = await supabase
    .from('upload_jobs')
    .select('v4_stage_state,v6_workflow_run_id')
    .eq('id', input.jobId)
    .eq('v6_fencing_token', input.fencingToken)
    .maybeSingle();
  if (jobError) throw jobError;
  if (!job) throw new FatalError('V6_WORKFLOW_FENCING_CONFLICT');
  const { error: stageError } = await supabase.rpc('record_product_registration_v6_stage_run', {
    p_payload: {
      tenant_id: null,
      job_id: input.jobId,
      workflow_run_id: job.v6_workflow_run_id,
      fencing_token: input.fencingToken,
      stage_name: input.stage,
      stage_version: PRODUCT_REGISTRATION_V6_WORKFLOW_VERSION,
      input_hash: inputHash,
      status: input.status,
      output: input.output ?? {},
      error_code: input.error?.split(':')[0] ?? null,
      error_detail: input.error ?? null,
    },
  });
  if (stageError) throw stageError;
  const currentState = job.v4_stage_state && typeof job.v4_stage_state === 'object'
    ? job.v4_stage_state as JsonObject
    : {};
  const { data: updated, error: heartbeatError } = await supabase
    .from('upload_jobs')
    .update({
      v6_last_heartbeat_at: now,
      v4_stage_state: {
        ...currentState,
        v6: {
          ...(currentState.v6 && typeof currentState.v6 === 'object' ? currentState.v6 as JsonObject : {}),
          stage: input.stage,
          stageStatus: input.status,
          heartbeatAt: now,
          ...(input.output ?? {}),
        },
      },
      updated_at: now,
    })
    .eq('id', input.jobId)
    .eq('v6_fencing_token', input.fencingToken)
    .select('id')
    .maybeSingle();
  if (heartbeatError) throw heartbeatError;
  if (!updated) throw new FatalError('V6_WORKFLOW_FENCING_CONFLICT');
}

async function bindWorkflowStep(input: ProductRegistrationV6WorkflowInput, workflowRunId: string) {
  'use step';
  const supabase = db();
  const { error } = await supabase.rpc('bind_product_registration_v6_workflow_run', {
    p_job_id: input.jobId,
    p_fencing_token: input.fencingToken,
    p_workflow_run_id: workflowRunId,
  });
  if (error) throw new FatalError(error.message);
  await recordStage({ jobId: input.jobId, fencingToken: input.fencingToken, stage: 'intake', status: 'succeeded', output: { workflowRunId } });
}

async function preflightStep(input: ProductRegistrationV6WorkflowInput) {
  'use step';
  await recordStage({ jobId: input.jobId, fencingToken: input.fencingToken, stage: 'preflight', status: 'running' });
  const supabase = db();
  const [{ data: job, error: jobError }, { data: source, error: sourceError }] = await Promise.all([
    supabase.from('upload_jobs').select('id,source_document_id,v6_fencing_token,v6_outcome').eq('id', input.jobId).single(),
    supabase.from('product_source_documents').select('id,sha256,status,source_type,byte_size,tenant_id').eq('id', input.sourceDocumentId).single(),
  ]);
  if (jobError || sourceError || !job || !source) throw new FatalError('V6_PREFLIGHT_LINEAGE_UNAVAILABLE');
  if (job.source_document_id !== source.id || Number(job.v6_fencing_token) !== input.fencingToken) {
    throw new FatalError('V6_PREFLIGHT_LINEAGE_MISMATCH');
  }
  if (source.status === 'quarantined' || Number(source.byte_size) <= 0) throw new FatalError('V6_SOURCE_QUARANTINED');
  await recordStage({
    jobId: input.jobId,
    fencingToken: input.fencingToken,
    stage: 'preflight',
    status: 'succeeded',
    output: { sourceHash: source.sha256, sourceTenantId: source.tenant_id ?? null },
  });
  return { sourceHash: String(source.sha256), sourceTenantId: typeof source.tenant_id === 'string' ? source.tenant_id : null };
}

async function deduplicateStep(input: ProductRegistrationV6WorkflowInput) {
  'use step';
  await recordStage({
    jobId: input.jobId,
    fencingToken: input.fencingToken,
    stage: 'deduplicate',
    status: 'succeeded',
    output: { sourceHash: input.fileHash, dedupeMode: input.forceReprocess ? 'reprocess' : 'content-addressed' },
  });
}

async function extractStep(input: ProductRegistrationV6WorkflowInput) {
  'use step';
  await recordStage({ jobId: input.jobId, fencingToken: input.fencingToken, stage: 'extract', status: 'running' });
  const result = await processProductRegistrationV4ExtractionJob({ supabase: db(), jobId: input.jobId });
  await recordStage({
    jobId: input.jobId,
    fencingToken: input.fencingToken,
    stage: 'extract',
    status: 'succeeded',
    output: {
      extractionId: result.extraction.id,
      extractionHash: result.extraction.extractionHash,
      pages: result.documentIr.pages,
      tables: result.documentIr.tables.length,
    },
  });
  return { extractionId: result.extraction.id, extractionHash: result.extraction.extractionHash };
}

async function legacyCompatibilityStep(input: ProductRegistrationV6WorkflowInput) {
  'use step';
  await recordStage({ jobId: input.jobId, fencingToken: input.fencingToken, stage: 'segment', status: 'running' });
  const supabase = db();
  const { data: source, error: sourceError } = await supabase
    .from('product_source_documents')
    .select('storage_bucket,storage_path,original_filename,declared_mime,source_type')
    .eq('id', input.sourceDocumentId)
    .single();
  if (sourceError || !source) throw new FatalError('V6_SOURCE_DOWNLOAD_METADATA_MISSING');
  const download = await supabase.storage.from(source.storage_bucket).download(source.storage_path);
  if (download.error || !download.data) throw download.error ?? new Error('V6_SOURCE_DOWNLOAD_EMPTY');
  const buffer = Buffer.from(await download.data.arrayBuffer());
  const directRawText = source.source_type === 'text' ? buffer.toString('utf8') : null;
  const inputAnalysisForTrust = directRawText ? analyzeUploadInputText(directRawText) : null;
  const intake: UploadRequestIntakeSuccess = {
    ok: true,
    buffer,
    fileHash: input.fileHash,
    fileName: input.fileName || source.original_filename,
    directRawText,
    originalRawText: directRawText,
    parserRawText: directRawText,
    documentRawText: null,
    declaredMime: input.declaredMime ?? source.declared_mime,
    sourceType: input.sourceType,
    sourceDocumentId: input.sourceDocumentId,
    registrationJobId: input.jobId,
    analysisNormalizedText: directRawText ? inputAnalysisForTrust?.normalizedText ?? directRawText : null,
    uploadSourceMetadata: input.uploadSourceMetadata as unknown as UploadSourceMetadataResult,
    inputAnalysisForTrust,
    archiveMode: input.archiveMode,
    bulkMode: input.bulkMode,
    forceReprocess: input.forceReprocess,
  };
  const deferredTasks: Array<() => Promise<void> | void> = [];
  const pipeline = await runUploadRegistrationPipeline({
    intake,
    supabase,
    isSupabaseConfigured,
    safeAfter: task => deferredTasks.push(task),
    postAlert,
    requestBaseUrl: input.requestBaseUrl,
    publicBaseUrl: input.publicBaseUrl,
    deferPublicationAutopilot: true,
  });
  const deferredResults = await Promise.allSettled(deferredTasks.map(task => Promise.resolve().then(task)));
  const deferredFailures = deferredResults.filter(result => result.status === 'rejected').length;
  if (pipeline.status >= 400 || pipeline.payload.success === false) {
    throw new FatalError(`V6_COMPATIBILITY_PIPELINE_BLOCKED:${String(pipeline.payload.error ?? pipeline.payload.code ?? pipeline.status)}`);
  }
  const job = await getProductRegistrationV4Job({ supabase, jobId: input.jobId });
  const packageIds = Array.isArray(job?.v4_stage_state.packageIds)
    ? job!.v4_stage_state.packageIds.map(String).filter(Boolean)
    : [];
  await recordStage({
    jobId: input.jobId,
    fencingToken: input.fencingToken,
    stage: 'segment',
    status: 'succeeded',
    output: { packageIds, deferredFailures },
  });
  return { packageIds, pipelinePayload: pipeline.payload };
}

async function normalizeStep(
  input: ProductRegistrationV6WorkflowInput,
  preflight: { sourceHash: string; sourceTenantId: string | null },
) {
  'use step';
  await recordStage({ jobId: input.jobId, fencingToken: input.fencingToken, stage: 'normalize', status: 'running' });
  const supabase = db();
  const job = await getProductRegistrationV4Job({ supabase, jobId: input.jobId });
  if (!job) throw new FatalError('V6_JOB_NOT_FOUND_FOR_NORMALIZATION');
  const result = await processProductRegistrationV4CanonicalNormalizationJob({ supabase, job });
  const revisionIds = Array.isArray(result.job.v4_stage_state.v5RevisionIds)
    ? result.job.v4_stage_state.v5RevisionIds.map(String).filter(Boolean)
    : [];
  const packageIds = Array.isArray(result.job.v4_stage_state.packageIds)
    ? result.job.v4_stage_state.packageIds.map(String).filter(Boolean)
    : [];
  const projectionCounts = { departures: 0, transportSegments: 0, lodgingStays: 0, golfRounds: 0 };
  const revisionTenantIds = new Set<string>();
  const lineageBlockers: string[] = [];
  const projectionRows: Array<{
    tenantId: string | null;
    revisionId: string;
    revisionHash: string;
    projection: ReturnType<typeof buildProductRegistrationV6DomainProjection>;
  }> = [];
  for (const packageId of packageIds) {
    const { data: revision, error: revisionError } = await supabase
      .from('product_registration_v5_revisions')
      .select('id,tenant_id,job_id,source_document_id,payload_hash,canonical_payload')
      .eq('package_id', packageId)
      .in('id', revisionIds)
      .order('revision_no', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (revisionError || !revision) throw revisionError ?? new FatalError('V6_DOMAIN_REVISION_NOT_FOUND');
    if (typeof revision.tenant_id === 'string') revisionTenantIds.add(revision.tenant_id);
    if (preflight.sourceTenantId && revision.tenant_id !== preflight.sourceTenantId) {
      lineageBlockers.push(`package:${packageId}:TENANT_LINEAGE_MISMATCH`);
    }
    if (revision.job_id !== input.jobId) {
      lineageBlockers.push(`package:${packageId}:REVISION_JOB_LINEAGE_MISMATCH`);
    }
    if (revision.source_document_id !== input.sourceDocumentId) {
      lineageBlockers.push(`package:${packageId}:REVISION_SOURCE_LINEAGE_MISMATCH`);
    }
    const projection = buildProductRegistrationV6DomainProjection({
      canonicalPayload: revision.canonical_payload as JsonObject,
      packageId,
    });
    projectionRows.push({
      tenantId: typeof revision.tenant_id === 'string' ? revision.tenant_id : null,
      revisionId: String(revision.id),
      revisionHash: String(revision.payload_hash),
      projection,
    });
  }
  if (revisionTenantIds.size > 1) lineageBlockers.push('REVISION_TENANT_LINEAGE_MISMATCH');
  const tenantId = [...revisionTenantIds][0] ?? null;
  if (lineageBlockers.length === 0) {
    for (const row of projectionRows) {
      await persistProductRegistrationV6DomainProjection({
        supabase,
        tenantId: row.tenantId,
        revisionId: row.revisionId,
        revisionHash: row.revisionHash,
        sourceHash: input.fileHash,
        projection: row.projection,
      });
      projectionCounts.departures += row.projection.departures.length;
      projectionCounts.transportSegments += row.projection.transportSegments.length;
      projectionCounts.lodgingStays += row.projection.lodgingStays.length;
      projectionCounts.golfRounds += row.projection.golfRounds.length;
    }
  }
  await recordStage({
    jobId: input.jobId,
    fencingToken: input.fencingToken,
    stage: 'normalize',
    status: 'succeeded',
    output: {
      normalizationId: result.normalizationId,
      revisionIds,
      packageIds,
      normalizationStatus: result.normalization.status,
      projectionCounts,
      tenantId,
      lineageBlockers,
    },
  });
  return {
    normalizationId: result.normalizationId,
    revisionIds,
    packageIds,
    normalization: result.normalization,
    tenantId,
    lineageBlockers,
  };
}

async function resolveSharedFactsStep(
  input: ProductRegistrationV6WorkflowInput,
  normalized: Awaited<ReturnType<typeof normalizeStep>>,
  preflight: { sourceHash: string; sourceTenantId: string | null },
) {
  'use step';
  await recordStage({ jobId: input.jobId, fencingToken: input.fencingToken, stage: 'resolve_shared_facts', status: 'running' });
  const tenantMismatch = normalized.tenantId && preflight.sourceTenantId
    && normalized.tenantId !== preflight.sourceTenantId
    ? ['TENANT_LINEAGE_MISMATCH']
    : [];
  const lineageBlockers = [...normalized.lineageBlockers, ...tenantMismatch];
  if (lineageBlockers.length > 0) {
    const blocked: SharedFactJobResult = {
      blockers: [...new Set(lineageBlockers)],
      degradedReasons: [],
      resolvedTransport: [],
      totalExternalCostKrw: 0,
    };
    await recordStage({
      jobId: input.jobId,
      fencingToken: input.fencingToken,
      stage: 'resolve_shared_facts',
      status: 'succeeded',
      output: { blockerCount: blocked.blockers.length, blockers: blocked.blockers, skipped: true },
    });
    return blocked;
  }
  const result = await resolveSharedFactsForJob({
    supabase: db(),
    jobId: input.jobId,
    packageIds: normalized.packageIds,
    revisionIds: normalized.revisionIds,
    sourceDocumentId: input.sourceDocumentId,
    sourceHash: preflight.sourceHash,
    tenantId: normalized.tenantId ?? preflight.sourceTenantId,
  });
  const { error: costError } = await db().rpc('add_product_registration_v6_external_cost', {
    p_job_id: input.jobId,
    p_expected_fencing_token: input.fencingToken,
    p_cost_krw: result.totalExternalCostKrw,
  });
  if (costError) throw costError;
  await recordStage({
    jobId: input.jobId,
    fencingToken: input.fencingToken,
    stage: 'resolve_shared_facts',
    status: 'succeeded',
    output: {
      blockerCount: result.blockers.length,
      degradedCount: result.degradedReasons.length,
      resolvedTransportCount: result.resolvedTransport.length,
      totalExternalCostKrw: result.totalExternalCostKrw,
    },
  });
  return result;
}

async function validateStep(
  input: ProductRegistrationV6WorkflowInput,
  normalized: Awaited<ReturnType<typeof normalizeStep>>,
  shared: SharedFactJobResult,
  preflight: { sourceHash: string; sourceTenantId: string | null },
) {
  'use step';
  await recordStage({ jobId: input.jobId, fencingToken: input.fencingToken, stage: 'validate', status: 'running' });
  const supabase = db();
  const { data: segments, error: segmentError } = await supabase
    .from('product_registration_v5_segments')
    .select('raw_text')
    .eq('job_id', input.jobId)
    .order('segment_index', { ascending: true });
  if (segmentError) throw segmentError;
  const decision = evaluateProductRegistrationV6Policy({
    canonicalPayload: normalized.normalization.canonicalPayload,
    packageIds: normalized.packageIds,
    revisionIds: normalized.revisionIds,
    sourceTexts: (segments ?? []).map(row => String(row.raw_text ?? '')),
    sourceHash: preflight.sourceHash,
    expectedSourceHash: input.fileHash,
    tenantId: normalized.tenantId,
    sourceTenantId: preflight.sourceTenantId,
    sharedFactBlockers: shared.blockers,
    sharedFactDegradedReasons: shared.degradedReasons,
  });
  await recordStage({
    jobId: input.jobId,
    fencingToken: input.fencingToken,
    stage: 'validate',
    status: 'succeeded',
    output: { outcome: decision.outcome, blockers: decision.blockers, degradedReasons: decision.degradedReasons, decisionHash: decision.decisionHash },
  });
  return decision;
}

async function generateCopyStep(
  input: ProductRegistrationV6WorkflowInput,
  decision: ProductRegistrationV6Decision,
): Promise<ProductRegistrationV6Decision> {
  'use step';
  const supabase = db();
  const blockers: string[] = [];
  const copyHashes: string[] = [];
  for (const [index, packageId] of decision.packageIds.entries()) {
    const revisionId = decision.revisionIds[index] ?? decision.revisionIds[0];
    if (!revisionId) {
      blockers.push(`package:${packageId}:COPY_REVISION_MISSING`);
      continue;
    }
    const [{ data: pkg, error: packageError }, { data: revision, error: revisionError }, { data: claims, error: claimError }] = await Promise.all([
      supabase.from('travel_packages').select('title,product_summary,product_highlights').eq('id', packageId).single(),
      supabase.from('product_registration_v5_revisions').select('tenant_id,payload_hash').eq('id', revisionId).eq('package_id', packageId).single(),
      supabase.from('product_registration_v5_claims').select('id,field_path,normalized_value,criticality,evidence_status,conflict_status').eq('revision_id', revisionId),
    ]);
    if (packageError || revisionError || claimError || !pkg || !revision) throw packageError ?? revisionError ?? claimError ?? new Error('V6_COPY_INPUT_MISSING');
    const built = buildProductRegistrationV6Copy({
      pkg: pkg as JsonObject,
      claims: (claims ?? []) as Array<{ id: string; field_path: string; normalized_value: unknown; criticality: string; evidence_status: string; conflict_status: string }>,
      degradedReasons: decision.degradedReasons,
    });
    blockers.push(...built.blockers.map(reason => `package:${packageId}:${reason}`));
    const persisted = await persistProductRegistrationV6Copy({
      supabase,
      tenantId: typeof revision.tenant_id === 'string' ? revision.tenant_id : null,
      revisionId,
      revisionHash: String(revision.payload_hash),
      sourceHash: input.fileHash,
      payload: built.payload,
      claimLinks: built.claimLinks,
      validationState: built.blockers.length > 0 ? 'blocked' : 'verified',
    });
    copyHashes.push(persisted.copyHash);
  }
  const nextDecision: ProductRegistrationV6Decision = blockers.length > 0
    ? {
        ...decision,
        outcome: 'blocked',
        terminalOutcome: 'blocked_action_required',
        blockers: [...new Set([...decision.blockers, ...blockers])],
      }
    : decision;
  await recordStage({
    jobId: input.jobId,
    fencingToken: input.fencingToken,
    stage: 'generate_copy',
    status: 'succeeded',
    output: {
      copyPolicy: 'validated-facts-template-only',
      degradedNoticeApplied: decision.outcome === 'degraded',
      copyHashes,
      blockers,
    },
  });
  return nextDecision;
}

async function buildSnapshotsStep(input: ProductRegistrationV6WorkflowInput, decision: ProductRegistrationV6Decision, shared: SharedFactJobResult) {
  'use step';
  await recordStage({ jobId: input.jobId, fencingToken: input.fencingToken, stage: 'build_snapshot', status: 'running' });
  const snapshots = await buildProductRegistrationV6CandidateSnapshots({
    supabase: db(),
    decision,
    resolvedTransport: shared.resolvedTransport,
  });
  await recordStage({
    jobId: input.jobId,
    fencingToken: input.fencingToken,
    stage: 'build_snapshot',
    status: 'succeeded',
    output: { snapshotIds: snapshots.map(snapshot => snapshot.snapshotId), snapshotHashes: snapshots.map(snapshot => snapshot.snapshotHash) },
  });
  return snapshots;
}

async function proveSnapshotsStep(input: ProductRegistrationV6WorkflowInput, snapshots: ProductRegistrationV6CandidateSnapshot[]) {
  'use step';
  await recordStage({ jobId: input.jobId, fencingToken: input.fencingToken, stage: 'browser_proof', status: 'running' });
  const supabase = db();
  const proofs = [];
  for (const snapshot of snapshots) {
    proofs.push(await proveProductRegistrationV6Snapshot({ supabase, snapshot, baseUrl: input.publicBaseUrl || input.requestBaseUrl }));
  }
  await recordStage({
    jobId: input.jobId,
    fencingToken: input.fencingToken,
    stage: 'browser_proof',
    status: 'succeeded',
    output: { proofRunIds: proofs.map(proof => proof.proofRunId) },
  });
  return proofs.map((proof, index) => ({ proofRunId: proof.proofRunId, snapshot: snapshots[index]! }));
}

async function publishSnapshotsStep(
  input: ProductRegistrationV6WorkflowInput,
  decision: ProductRegistrationV6Decision,
  proofs: Array<{ proofRunId: string; snapshot: ProductRegistrationV6CandidateSnapshot }>,
) {
  'use step';
  await recordStage({ jobId: input.jobId, fencingToken: input.fencingToken, stage: 'publish_pointer', status: 'running' });
  const supabase = db();
  for (const proof of proofs) {
    await publishProductRegistrationV6Snapshot({
      supabase,
      snapshot: proof.snapshot,
      proofRunId: proof.proofRunId,
      outcome: decision.terminalOutcome as 'published_verified' | 'published_degraded',
      policyVersion: input.policyVersion,
      idempotencyKey: `${input.jobId}:${proof.snapshot.snapshotHash}:publish-v6`,
    });
  }
  await recordStage({
    jobId: input.jobId,
    fencingToken: input.fencingToken,
    stage: 'publish_pointer',
    status: 'succeeded',
    output: { publishedPackageIds: proofs.map(proof => proof.snapshot.packageId) },
  });
}

async function publicationControlStep(
  input: ProductRegistrationV6WorkflowInput,
  decision: ProductRegistrationV6Decision,
): Promise<ProductRegistrationV6Decision> {
  'use step';
  const blockers = await loadProductRegistrationV6PublicationBlockers({
    supabase: db(),
    packageIds: decision.packageIds,
  });
  if (blockers.length === 0) return decision;
  const blocked: ProductRegistrationV6Decision = {
    ...decision,
    outcome: 'blocked',
    terminalOutcome: 'blocked_action_required',
    blockers: [...new Set([...decision.blockers, ...blockers])],
  };
  await recordStage({
    jobId: input.jobId,
    fencingToken: input.fencingToken,
    stage: 'publish_pointer',
    status: 'succeeded',
    output: { published: false, blockers: blocked.blockers },
  });
  return blocked;
}

async function convergeStep(input: ProductRegistrationV6WorkflowInput, snapshots: ProductRegistrationV6CandidateSnapshot[]) {
  'use step';
  await recordStage({ jobId: input.jobId, fencingToken: input.fencingToken, stage: 'converge_surfaces', status: 'running' });
  const supabase = db();
  const outbox = await processProductRegistrationV5OutboxBatch({
    supabase,
    limit: Math.max(10, snapshots.length * 10),
    workerId: `v6:${input.jobId}`,
    aggregateIds: snapshots.map(snapshot => snapshot.packageId),
  });
  const convergence = await observeProductRegistrationV5ConvergenceBatch({
    supabase,
    baseUrl: input.publicBaseUrl || input.requestBaseUrl,
    limit: Math.max(10, snapshots.length * 10),
    snapshotHashes: snapshots.map(snapshot => snapshot.snapshotHash),
  });
  const { data: convergenceRows, error: convergenceError } = await supabase
    .from('product_registration_v5_cache_convergence_runs')
    .select('snapshot_hash,surface,status')
    .in('snapshot_hash', snapshots.map(snapshot => snapshot.snapshotHash));
  if (convergenceError) throw convergenceError;
  const requiredSurfaces = ['packages', 'lp', 'og', 'affiliate'];
  const incomplete = snapshots.filter(snapshot => requiredSurfaces.some(surface =>
    !(convergenceRows ?? []).some(row => row.snapshot_hash === snapshot.snapshotHash
      && row.surface === surface
      && row.status === 'converged')));
  if (incomplete.length > 0) throw new Error(`V6_SURFACE_CONVERGENCE_PENDING:${incomplete.length}`);
  await recordStage({
    jobId: input.jobId,
    fencingToken: input.fencingToken,
    stage: 'converge_surfaces',
    status: 'succeeded',
    output: { outboxDelivered: outbox.filter(row => row.ok).length, converged: convergence.length },
  });
}

async function terminalStep(
  input: ProductRegistrationV6WorkflowInput,
  workflowRunId: string,
  decision: ProductRegistrationV6Decision,
): Promise<ProductRegistrationV6WorkflowResult> {
  'use step';
  const supabase = db();
  const { error } = await supabase.rpc('record_product_registration_v6_terminal_outcome', {
    p_job_id: input.jobId,
    p_workflow_run_id: workflowRunId,
    p_expected_fencing_token: input.fencingToken,
    p_outcome: decision.terminalOutcome,
    p_policy_version: input.policyVersion,
    p_degraded_reasons: decision.degradedReasons,
    p_blockers: decision.blockers,
  });
  if (error) throw new FatalError(error.message);
  await recordStage({
    jobId: input.jobId,
    fencingToken: input.fencingToken,
    stage: 'complete',
    status: 'succeeded',
    output: { terminalOutcome: decision.terminalOutcome },
  });
  return { ...decision, jobId: input.jobId, workflowVersion: PRODUCT_REGISTRATION_V6_WORKFLOW_VERSION, completedAt: new Date().toISOString() };
}

async function blockFailedWorkflowStep(
  input: ProductRegistrationV6WorkflowInput,
  workflowRunId: string,
  error: string,
): Promise<ProductRegistrationV6WorkflowResult> {
  'use step';
  const decision: ProductRegistrationV6Decision = {
    outcome: 'blocked',
    terminalOutcome: 'blocked_action_required',
    degradedReasons: [],
    blockers: [`WORKFLOW_FAILED:${error}`],
    packageIds: [],
    revisionIds: [],
  };
  const supabase = db();
  const { data: failedJob } = await supabase
    .from('upload_jobs')
    .select('v4_stage_state')
    .eq('id', input.jobId)
    .eq('v6_fencing_token', input.fencingToken)
    .maybeSingle();
  const v6State = failedJob?.v4_stage_state && typeof failedJob.v4_stage_state === 'object'
    ? (failedJob.v4_stage_state as JsonObject).v6
    : null;
  const failedStage = v6State && typeof v6State === 'object' && !Array.isArray(v6State)
    ? String((v6State as JsonObject).stage ?? 'workflow')
    : 'workflow';
  if (PRODUCT_REGISTRATION_V6_STAGES.includes(failedStage as ProductRegistrationV6Stage)) {
    await recordStage({
      jobId: input.jobId,
      fencingToken: input.fencingToken,
      stage: failedStage as ProductRegistrationV6Stage,
      status: 'failed',
      error,
    }).catch(() => undefined);
  }
  await supabase.rpc('record_product_registration_v6_dead_letter', {
    p_payload: {
      tenant_id: null,
      job_id: input.jobId,
      workflow_run_id: workflowRunId,
      failed_stage: failedStage,
      operation_key: `${input.jobId}:${input.fencingToken}:dead-letter`,
      error_code: error.split(':')[0] || 'WORKFLOW_FAILED',
      error_detail: error,
      source_hash: input.fileHash,
      payload: { workflowVersion: PRODUCT_REGISTRATION_V6_WORKFLOW_VERSION },
    },
  });
  const { error: terminalError } = await supabase.rpc('record_product_registration_v6_terminal_outcome', {
    p_job_id: input.jobId,
    p_workflow_run_id: workflowRunId,
    p_expected_fencing_token: input.fencingToken,
    p_outcome: decision.terminalOutcome,
    p_policy_version: input.policyVersion,
    p_degraded_reasons: decision.degradedReasons,
    p_blockers: decision.blockers,
  });
  if (terminalError) throw new FatalError(terminalError.message);
  await recordStage({
    jobId: input.jobId,
    fencingToken: input.fencingToken,
    stage: 'complete',
    status: 'succeeded',
    output: { terminalOutcome: decision.terminalOutcome, failed: true },
  });
  return { ...decision, jobId: input.jobId, workflowVersion: PRODUCT_REGISTRATION_V6_WORKFLOW_VERSION, completedAt: new Date().toISOString() };
}

export async function productRegistrationV6Workflow(
  input: ProductRegistrationV6WorkflowInput,
): Promise<ProductRegistrationV6WorkflowResult> {
  'use workflow';
  const { workflowRunId } = getWorkflowMetadata();
  try {
    await bindWorkflowStep(input, workflowRunId);
    const preflight = await preflightStep(input);
    await deduplicateStep(input);
    await extractStep(input);
    await legacyCompatibilityStep(input);
    const normalized = await normalizeStep(input, preflight);
    const shared = await resolveSharedFactsStep(input, normalized, preflight);
    const decision = await validateStep(input, normalized, shared, preflight);
    if (decision.outcome === 'blocked') return await terminalStep(input, workflowRunId, decision);
    const copyDecision = await generateCopyStep(input, decision);
    if (copyDecision.outcome === 'blocked') return await terminalStep(input, workflowRunId, copyDecision);
    const snapshots = await buildSnapshotsStep(input, copyDecision, shared);
    const proofs = await proveSnapshotsStep(input, snapshots);
    const publishDecision = await publicationControlStep(input, copyDecision);
    if (publishDecision.outcome === 'blocked') return await terminalStep(input, workflowRunId, publishDecision);
    await publishSnapshotsStep(input, copyDecision, proofs);
    await convergeStep(input, snapshots);
    return await terminalStep(input, workflowRunId, copyDecision);
  } catch (error) {
    return await blockFailedWorkflowStep(input, workflowRunId, error instanceof Error ? error.message : String(error));
  }
}
