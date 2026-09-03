import { FatalError, getWorkflowMetadata, sleep } from 'workflow';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  parseCriticalPriceFactOverrides,
  processProductRegistrationV4CanonicalNormalizationJob,
  segmentDocumentIR,
  sliceCanonicalNormalizationForRevisionSections,
} from '@/lib/product-registration-v4/canonical-worker';
import { processProductRegistrationV4ExtractionJob } from '@/lib/product-registration-v4/extractions';
import { getProductRegistrationV4Job } from '@/lib/product-registration-v4/jobs';
import { observeProductRegistrationV5ConvergenceBatch } from '@/lib/product-registration-v4/convergence-observer';
import { processProductRegistrationV5OutboxBatch } from '@/lib/product-registration-v4/outbox-worker';
import { getSupabaseAdmin } from '@/lib/supabase';
import { sha256Hex } from '@/lib/product-registration-v4/document-ir';
import { buildSupplierFormatFingerprint } from '@/lib/supplier-format-fingerprint';
import { classifyProductSourceDocument, classifyProductSourceFilename } from '@/lib/product-registration-v6/document-classifier';
import { resolveSourceBundleForWorkflow } from '@/lib/product-registration-v6/source-bundle-orchestrator';
import {
  catalogProductsEligibleForScheduleDriftClear,
  resolveSharedFactsForJob,
  type SharedFactJobResult,
} from '@/lib/product-registration-v6/shared-fact-orchestrator';
import {
  buildProductRegistrationV6CandidateSnapshots,
  proveProductRegistrationV6Snapshot,
  publishProductRegistrationV6Snapshot,
  type ProductRegistrationV6CandidateSnapshot,
} from '@/lib/product-registration-v6/snapshot-publication';
import { evaluateRegistrationPublicationPolicy } from '@/lib/product-registration-kernel/publication-policy';
import { loadProductRegistrationV6PublicationBlockers } from '@/lib/product-registration-v6/publication-control';
import { buildProductRegistrationV6Copy, persistProductRegistrationV6Copy } from '@/lib/product-registration-v6/copy-revision';
import {
  buildPackageProjectionFromRevision,
  loadProductRegistrationRevisionAggregate,
  productRegistrationRevisionProjectionBlocker,
} from '@/lib/product-registration-authority/revision-aggregate';
import { projectCompatibilityFromRevisionAtomic } from '@/lib/product-registration-authority/repository';
import { resolveRegistrationTermsPolicy } from '@/lib/standard-terms';
import {
  PRODUCT_REGISTRATION_V6_WORKFLOW_VERSION,
  PRODUCT_REGISTRATION_V6_STAGES,
  type ProductRegistrationV6Decision,
  type ProductRegistrationV6PublicationState,
  type ProductRegistrationV6Stage,
  type ProductRegistrationV6WorkflowInput,
  type ProductRegistrationV6WorkflowResult,
} from '@/lib/product-registration-v6/types';
import { DEFAULT_PRODUCT_REGISTRATION_COMMISSION_RATE } from '@/lib/upload-source-metadata';
import { runCriticalPriceFactAutomation } from '@/lib/product-registration-v6/critical-fact-automation';
import type { DocumentIR } from '@/lib/product-registration-v4/types';
import {
  resolveQualifiedSupplierLayoutProfile,
  type SupplierProfileResolution,
} from '@/lib/product-registration-v6/supplier-profile-registry';
import {
  buildProductRegistrationAnalysisRecoveryPlan,
  type AnalysisRecoveryPlanV1,
} from '@/lib/product-registration-v6/analysis-recovery';
import { getProductRegistrationV6RuntimeConfig } from '@/lib/product-registration-v6/runtime-config';

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
    .select('tenant_id,v4_stage_state,v6_workflow_run_id')
    .eq('id', input.jobId)
    .eq('v6_fencing_token', input.fencingToken)
    .maybeSingle();
  if (jobError) throw jobError;
  if (!job) throw new FatalError('V6_WORKFLOW_FENCING_CONFLICT');
  const { error: stageError } = await supabase.rpc('record_product_registration_v6_stage_run', {
    p_payload: {
      tenant_id: job.tenant_id,
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
  await recordStage({
    jobId: input.jobId,
    fencingToken: input.fencingToken,
    stage: 'intake',
    status: 'succeeded',
    output: {
      workflowRunId,
      departureDateReference: input.departureDateReference,
    },
  });
}

async function preflightStep(input: ProductRegistrationV6WorkflowInput) {
  'use step';
  await recordStage({ jobId: input.jobId, fencingToken: input.fencingToken, stage: 'preflight', status: 'running' });
  const supabase = db();
  const [{ data: job, error: jobError }, { data: source, error: sourceError }] = await Promise.all([
    supabase.from('upload_jobs').select('id,tenant_id,source_document_id,v6_fencing_token,v6_outcome,v6_reference_date,v6_date_policy_version').eq('id', input.jobId).single(),
    supabase.from('product_source_documents').select('id,sha256,status,source_type,byte_size,tenant_id').eq('id', input.sourceDocumentId).single(),
  ]);
  if (jobError || sourceError || !job || !source) throw new FatalError('V6_PREFLIGHT_LINEAGE_UNAVAILABLE');
  if (job.source_document_id !== source.id
    || job.tenant_id !== input.tenantId
    || source.tenant_id !== input.tenantId
    || Number(job.v6_fencing_token) !== input.fencingToken
    || job.v6_reference_date !== input.departureDateReference.referenceDate
    || job.v6_date_policy_version !== input.departureDateReference.policyVersion) {
    throw new FatalError('V6_PREFLIGHT_LINEAGE_MISMATCH');
  }
  if (source.status === 'quarantined' || Number(source.byte_size) <= 0) throw new FatalError('V6_SOURCE_QUARANTINED');
  await recordStage({
    jobId: input.jobId,
    fencingToken: input.fencingToken,
    stage: 'preflight',
    status: 'succeeded',
    output: {
      sourceHash: source.sha256,
      sourceTenantId: source.tenant_id ?? null,
      departureDateReference: input.departureDateReference,
    },
  });
  return { sourceHash: String(source.sha256), sourceTenantId: input.tenantId };
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

async function classifyInputStep(input: ProductRegistrationV6WorkflowInput) {
  'use step';
  const cohort = classifyProductSourceDocument({ sourceType: input.sourceType });
  const filenameClassification = classifyProductSourceFilename({
    sourceType: input.sourceType,
    filename: input.fileName,
  });
  return { cohort, filenameClassification };
}

async function extractStep(input: ProductRegistrationV6WorkflowInput) {
  'use step';
  await recordStage({ jobId: input.jobId, fencingToken: input.fencingToken, stage: 'extract', status: 'running' });
  const result = await processProductRegistrationV4ExtractionJob({ supabase: db(), jobId: input.jobId });
  const classification = classifyProductSourceDocument({
    sourceType: input.sourceType,
    documentIr: result.documentIr,
  });
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
      documentClassification: classification,
    },
  });
  return { extractionId: result.extraction.id, extractionHash: result.extraction.extractionHash, classification };
}

async function bundleSourcesStep(
  input: ProductRegistrationV6WorkflowInput,
  extracted: { extractionId: string; extractionHash: string; classification: ReturnType<typeof classifyProductSourceDocument> },
  attempt = 0,
) {
  'use step';
  await recordStage({
    jobId: input.jobId,
    fencingToken: input.fencingToken,
    stage: 'bundle_sources',
    status: 'running',
  });
  const result = await resolveSourceBundleForWorkflow({
    supabase: db(),
    tenantId: input.tenantId,
    jobId: input.jobId,
    fencingToken: input.fencingToken,
    sourceDocumentId: input.sourceDocumentId,
    extractionId: extracted.extractionId,
    uploadSourceMetadata: input.uploadSourceMetadata,
  });
  await recordStage({
    jobId: input.jobId,
    fencingToken: input.fencingToken,
    stage: 'bundle_sources',
    status: 'succeeded',
    output: { ...result, attempt },
  });
  return { ...extracted, ...result };
}

async function resolveSupplierProfileStep(
  input: ProductRegistrationV6WorkflowInput,
): Promise<SupplierProfileResolution> {
  'use step';
  const supabase = db();
  const { data: job, error: jobError } = await supabase
    .from('upload_jobs')
    .select('extraction_id')
    .eq('id', input.jobId)
    .eq('v6_fencing_token', input.fencingToken)
    .single();
  if (jobError || !job?.extraction_id) throw jobError ?? new FatalError('V6_PROFILE_EXTRACTION_LINEAGE_MISSING');
  const { data: extraction, error: extractionError } = await supabase
    .from('product_document_extractions')
    .select('document_ir')
    .eq('id', job.extraction_id)
    .eq('tenant_id', input.tenantId)
    .single();
  if (extractionError || !extraction?.document_ir) {
    throw extractionError ?? new FatalError('V6_PROFILE_DOCUMENT_IR_MISSING');
  }
  const documentText = String((extraction.document_ir as { text?: unknown }).text ?? '');
  const fingerprint = buildSupplierFormatFingerprint(documentText);
  const documentFamily = `${input.sourceType}:${fingerprint.formatHash}`;
  return resolveQualifiedSupplierLayoutProfile({
    supabase,
    tenantId: input.tenantId,
    supplierName: metadataString(input.uploadSourceMetadata, 'landOperator'),
    documentFamily,
  });
}

async function resolveCriticalFactsStep(
  input: ProductRegistrationV6WorkflowInput,
  supplierProfile: SupplierProfileResolution,
) {
  'use step';
  await recordStage({
    jobId: input.jobId,
    fencingToken: input.fencingToken,
    stage: 'resolve_critical_facts',
    status: 'running',
  });
  const supabase = db();
  const { data: job, error: jobError } = await supabase
    .from('upload_jobs')
    .select('extraction_id,v4_stage_state')
    .eq('id', input.jobId)
    .eq('tenant_id', input.tenantId)
    .eq('v6_fencing_token', input.fencingToken)
    .single();
  if (jobError || !job?.extraction_id) {
    throw jobError ?? new FatalError('V6_CRITICAL_FACT_EXTRACTION_LINEAGE_MISSING');
  }
  const { data: extraction, error: extractionError } = await supabase
    .from('product_document_extractions')
    .select('document_ir')
    .eq('id', job.extraction_id)
    .eq('tenant_id', input.tenantId)
    .eq('source_document_id', input.sourceDocumentId)
    .single();
  if (extractionError || !extraction?.document_ir) {
    throw extractionError ?? new FatalError('V6_CRITICAL_FACT_DOCUMENT_IR_MISSING');
  }
  const currentState = job.v4_stage_state && typeof job.v4_stage_state === 'object'
    ? job.v4_stage_state as JsonObject
    : {};
  const existingOverrides = parseCriticalPriceFactOverrides(currentState.criticalFactOverrides);
  const sourceYearContext = currentState.sourceDepartureYearContext
    && typeof currentState.sourceDepartureYearContext === 'object'
    && !Array.isArray(currentState.sourceDepartureYearContext)
    ? currentState.sourceDepartureYearContext as JsonObject
    : null;
  const explicitYear = Number(sourceYearContext?.year);
  const sections = segmentDocumentIR(
    extraction.document_ir as DocumentIR,
    input.sourceDocumentId,
    supplierProfile.profile?.segmentationHints,
  ).sections;
  const automated = await runCriticalPriceFactAutomation({
    supabase,
    tenantId: input.tenantId,
    jobId: input.jobId,
    sourceHash: input.fileHash,
    sections,
    existingOverrides,
    referenceDate: input.departureDateReference.referenceDate,
    rollingInferenceEligible: input.departureDateReference.rollingInferenceEligible,
    explicitYear: Number.isInteger(explicitYear) ? explicitYear : null,
    datePolicyVersion: input.departureDateReference.policyVersion,
  });
  const priorAuthority = typeof currentState.criticalFactOverrideAuthority === 'string'
    ? currentState.criticalFactOverrideAuthority
    : null;
  const authority = priorAuthority === 'authorized_human_evidence_selection'
    ? 'authorized_human_evidence_selection_and_dual_ai_source_replay'
    : 'dual_ai_consensus_and_deterministic_source_replay';
  const { overrides: _persistedSeparately, ...automationStats } = automated;
  const { data: updated, error: updateError } = await supabase
    .from('upload_jobs')
    .update({
      v4_stage_state: {
        ...currentState,
        criticalFactOverrides: automated.overrides,
        criticalFactOverrideAuthority: authority,
        criticalFactAutomation: {
          enginePolicyVersion: input.policyVersion,
          ...automationStats,
        },
      },
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.jobId)
    .eq('tenant_id', input.tenantId)
    .eq('v6_fencing_token', input.fencingToken)
    .select('id')
    .maybeSingle();
  if (updateError) throw updateError;
  if (!updated) throw new FatalError('V6_WORKFLOW_FENCING_CONFLICT');
  await recordStage({
    jobId: input.jobId,
    fencingToken: input.fencingToken,
    stage: 'resolve_critical_facts',
    status: 'succeeded',
    output: {
      enabled: true,
      authority,
      candidateSectionCount: automated.candidateSectionCount,
      overrideCount: automated.overrides.length,
      autoAgreedCount: automated.agreedCount,
      humanRequiredCount: automated.humanRequiredCount,
      providerUnavailableCount: automated.providerUnavailableCount,
      invalidCount: automated.invalidCount,
      overflowCount: automated.overflowCount,
    },
  });

}

function terminalDocumentDecision(
  reasonCode: string,
  terminalOutcome: ProductRegistrationV6Decision['terminalOutcome'],
): ProductRegistrationV6Decision {
  return {
    outcome: 'blocked',
    terminalOutcome,
    degradedReasons: [],
    blockers: [reasonCode],
    packageIds: [],
    revisionIds: [],
  };
}

function unpublishedReadyDecision(
  decision: ProductRegistrationV6Decision,
): ProductRegistrationV6Decision {
  return {
    ...decision,
    terminalOutcome: decision.outcome === 'verified'
      ? 'ready_verified_not_published'
      : 'ready_degraded_not_published',
  };
}

function allDeparturesPastDecision(): ProductRegistrationV6Decision {
  return {
    outcome: 'blocked',
    terminalOutcome: 'archived_all_departures_past',
    degradedReasons: [],
    blockers: ['ALL_DEPARTURES_PAST'],
    packageIds: [],
    revisionIds: [],
  };
}

function discardedSourceIncompleteDecision(sectionIndexes: number[]): ProductRegistrationV6Decision {
  return {
    outcome: 'blocked',
    terminalOutcome: 'discarded_source_incomplete',
    degradedReasons: [],
    blockers: [
      'SOURCE_SALE_PRICE_ABSENT',
      `DISCARDED_SOURCE_SECTION_INDEXES:${sectionIndexes.join(',')}`,
    ],
    packageIds: [],
    revisionIds: [],
  };
}

function analysisRecoveryPreviewDecision(plan: AnalysisRecoveryPlanV1): ProductRegistrationV6Decision {
  return {
    outcome: 'blocked',
    terminalOutcome: 'blocked_action_required',
    degradedReasons: [],
    blockers: [
      'ANALYSIS_RECOVERY_PREVIEW_ONLY',
      `ANALYSIS_RECOVERY_DISPOSITION:${plan.disposition}`,
      `ANALYSIS_RECOVERY_PLAN_HASH:${plan.planHash}`,
      `RECOVERY_TARGET_COUNT:${plan.targets.length}`,
      `SOURCE_INSUFFICIENT_FIELD_COUNT:${plan.sourceInsufficientFields.length}`,
      ...(plan.selectionTruncated ? ['RECOVERY_TARGET_SELECTION_TRUNCATED'] : []),
    ],
    packageIds: [],
    revisionIds: [],
  };
}

function metadataString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function metadataNumber(metadata: Record<string, unknown>, key: string): number | null {
  const value = Number(metadata[key]);
  return Number.isFinite(value) ? value : null;
}

function compatibilitySupplierCode(landOperator: string | null): string {
  if (!landOperator) return 'KERNEL';
  const ascii = landOperator.normalize('NFKD').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return ascii.slice(0, 16) || 'KERNEL';
}

async function projectCompatibilityStep(
  input: ProductRegistrationV6WorkflowInput,
  normalized: Awaited<ReturnType<typeof normalizeStep>>,
) {
  'use step';
  const supabase = db();
  const landOperator = metadataString(input.uploadSourceMetadata, 'landOperator');
  const commissionRate = metadataNumber(input.uploadSourceMetadata, 'commissionRate')
    ?? DEFAULT_PRODUCT_REGISTRATION_COMMISSION_RATE;
  const supplierCode = compatibilitySupplierCode(landOperator);
  const packageIds: string[] = [];
  const bindings: Array<{
    catalogProductId: string;
    packageId: string;
    operationalIdentity: JsonObject;
  }> = [];

  for (const [index] of normalized.revisionIds.entries()) {
    const revisionId = normalized.revisionIds[index];
    const revisionHash = normalized.revisionHashes[index];
    const catalogProductId = normalized.catalogProductIds[index];
    if (!revisionId || !revisionHash || !catalogProductId) throw new FatalError('V6_COMPATIBILITY_LINEAGE_MISSING');

    const aggregate = await loadProductRegistrationRevisionAggregate({ supabase, revisionId });
    if (aggregate.revision.tenant_id !== input.tenantId
      || aggregate.revision.catalog_product_id !== catalogProductId
      || aggregate.revision.payload_hash !== revisionHash
      || aggregate.revision.source_hash !== input.fileHash) {
      throw new FatalError(`V6_COMPATIBILITY_REVISION_LINEAGE_MISMATCH:${revisionId}`);
    }
    const projection = buildPackageProjectionFromRevision({
      packageId: catalogProductId,
      aggregate,
    });
    const projected = await projectCompatibilityFromRevisionAtomic({
      supabase,
      tenantId: input.tenantId,
      catalogProductId,
      revisionId,
      revisionHash,
      sourceHash: input.fileHash,
      operationKey: `${input.jobId}:${catalogProductId}:${revisionHash}:compatibility-project`,
      projection,
      supplierCode,
      landOperator,
      commissionRate,
    });
    for (const channel of ['customer', 'b2b', 'partner'] as const) {
      const { error: routeAliasError } = await supabase.rpc(
        'register_product_registration_public_route_aliases',
        {
          p_payload: {
            tenant_id: input.tenantId,
            catalog_product_id: catalogProductId,
            package_id: projected.packageId,
            channel,
            locale: 'ko-KR',
            route_refs: [catalogProductId, projected.packageId],
          },
        },
      );
      if (routeAliasError) throw routeAliasError;
    }
    packageIds.push(projected.packageId);
    bindings.push({
      catalogProductId,
      packageId: projected.packageId,
      operationalIdentity: {
        internal_code: projected.internalCode,
        land_operator: landOperator,
      },
    });
  }

  if (packageIds.length !== normalized.revisionIds.length) {
    throw new FatalError(`V6_COMPATIBILITY_IDENTITY_COUNT_MISMATCH:packages=${packageIds.length}:revisions=${normalized.revisionIds.length}`);
  }
  return {
    packageIds,
    bindings,
    projectionPayload: {
      source: 'immutable-revision',
      supplierCode,
      projectionCount: packageIds.length,
    },
  };
}

async function analysisRecoveryPreviewEnabledStep(): Promise<boolean> {
  'use step';
  return getProductRegistrationV6RuntimeConfig().analysisRecoveryPreviewEnabled;
}

async function analyzeUnpublishedStep(
  input: ProductRegistrationV6WorkflowInput,
  preflight: { sourceHash: string; sourceTenantId: string | null },
  supplierProfile: SupplierProfileResolution,
): Promise<AnalysisRecoveryPlanV1> {
  'use step';
  await recordStage({
    jobId: input.jobId,
    fencingToken: input.fencingToken,
    stage: 'analyze_unpublished',
    status: 'running',
  });
  const supabase = db();
  const job = await getProductRegistrationV4Job({ supabase, jobId: input.jobId });
  if (!job) throw new FatalError('V6_JOB_NOT_FOUND_FOR_ANALYSIS');
  const result = await processProductRegistrationV4CanonicalNormalizationJob({
    supabase,
    job,
    supplierProfileHints: supplierProfile.profile?.segmentationHints,
    allowEvidenceAiSegmentation: true,
    executionMode: 'analysis_only',
  });
  if (result.executionPolicy.commitRevisions
    || result.executionPolicy.createSnapshots
    || result.executionPolicy.changePublicationPointer
    || result.executionPolicy.customerPublicationAuthority) {
    throw new FatalError('V6_ANALYSIS_ONLY_WRITE_POLICY_VIOLATION');
  }
  const { data: extraction, error: extractionError } = await supabase
    .from('product_document_extractions')
    .select('id,source_document_id,tenant_id,document_ir')
    .eq('id', result.normalization.extractionId)
    .eq('source_document_id', result.normalization.sourceDocumentId)
    .eq('tenant_id', input.tenantId)
    .single();
  if (extractionError || !extraction?.document_ir) {
    throw extractionError ?? new FatalError('V6_ANALYSIS_DOCUMENT_IR_MISSING');
  }
  if (preflight.sourceHash !== input.fileHash) {
    throw new FatalError('V6_ANALYSIS_SOURCE_HASH_MISMATCH');
  }
  await recordStage({
    jobId: input.jobId,
    fencingToken: input.fencingToken,
    stage: 'analyze_unpublished',
    status: 'succeeded',
    output: {
      normalizationId: result.normalizationId,
      normalizationStatus: result.normalization.status,
      candidateSectionIndexes: result.candidateSectionIndexes,
      executionMode: result.executionPolicy.mode,
      revisionWriteAuthority: false,
      snapshotWriteAuthority: false,
      publicationPointerWriteAuthority: false,
    },
  });
  await recordStage({
    jobId: input.jobId,
    fencingToken: input.fencingToken,
    stage: 'detect_recovery_targets',
    status: 'running',
  });
  const plan = buildProductRegistrationAnalysisRecoveryPlan({
    documentIr: extraction.document_ir as DocumentIR,
    normalization: result.normalization,
    normalizationId: result.normalizationId,
    sourceHash: preflight.sourceHash,
  });
  await recordStage({
    jobId: input.jobId,
    fencingToken: input.fencingToken,
    stage: 'detect_recovery_targets',
    status: 'succeeded',
    output: {
      analysisRecoveryPlanVersion: plan.version,
      analysisRecoveryPlanHash: plan.planHash,
      disposition: plan.disposition,
      recoveryTargetCount: plan.targets.length,
      recoveryTargets: plan.targets,
      sourceInsufficientFields: plan.sourceInsufficientFields,
      unresolvedReviewFields: plan.unresolvedReviewFields,
      selectionTruncated: plan.selectionTruncated,
      customerPublicationAuthority: false,
    },
  });
  return plan;
}

async function normalizeStep(
  input: ProductRegistrationV6WorkflowInput,
  preflight: { sourceHash: string; sourceTenantId: string | null },
  supplierProfile: SupplierProfileResolution,
) {
  'use step';
  await recordStage({ jobId: input.jobId, fencingToken: input.fencingToken, stage: 'segment', status: 'running' });
  await recordStage({ jobId: input.jobId, fencingToken: input.fencingToken, stage: 'normalize', status: 'running' });
  const supabase = db();
  const job = await getProductRegistrationV4Job({ supabase, jobId: input.jobId });
  if (!job) throw new FatalError('V6_JOB_NOT_FOUND_FOR_NORMALIZATION');
  const result = await processProductRegistrationV4CanonicalNormalizationJob({
    supabase,
    job,
    supplierProfileHints: supplierProfile.profile?.segmentationHints,
    allowEvidenceAiSegmentation: true,
  });
  const revisionIds = Array.isArray(result.job.v4_stage_state.v5RevisionIds)
    ? result.job.v4_stage_state.v5RevisionIds.map(String).filter(Boolean)
    : [];
  const catalogProductIds = Array.isArray(result.job.v4_stage_state.catalogProductIds)
    ? result.job.v4_stage_state.catalogProductIds.map(String).filter(Boolean)
    : [];
  const revisionSectionIndexes = Array.isArray(result.job.v4_stage_state.revisionSectionIndexes)
    ? result.job.v4_stage_state.revisionSectionIndexes
        .map(Number)
        .filter(index => Number.isInteger(index) && index >= 0)
    : [];
  const pastOnlySectionIndexes = Array.isArray(result.job.v4_stage_state.pastOnlySectionIndexes)
    ? result.job.v4_stage_state.pastOnlySectionIndexes
        .map(Number)
        .filter(index => Number.isInteger(index) && index >= 0)
    : [];
  const discardedMissingSalePriceSectionIndexes = Array.isArray(
    result.job.v4_stage_state.discardedMissingSalePriceSectionIndexes,
  )
    ? result.job.v4_stage_state.discardedMissingSalePriceSectionIndexes
        .map(Number)
        .filter(index => Number.isInteger(index) && index >= 0)
    : [];
  if (revisionIds.length !== revisionSectionIndexes.length
    || catalogProductIds.length !== revisionIds.length) {
    throw new FatalError('V6_KERNEL_REVISION_COUNT_MISMATCH');
  }
  const revisionNormalization = sliceCanonicalNormalizationForRevisionSections(
    result.normalization,
    revisionSectionIndexes,
  );
  const revisionTenantIds = new Set<string>();
  const lineageBlockers: string[] = [];
  const revisionHashes: string[] = [];
  for (const [index, revisionId] of revisionIds.entries()) {
    const { data: revision, error: revisionError } = await supabase
      .from('product_registration_v5_revisions')
      .select('id,tenant_id,catalog_product_id,job_id,source_document_id,payload_hash')
      .eq('id', revisionId)
      .single();
    if (revisionError || !revision) throw revisionError ?? new FatalError('V6_KERNEL_REVISION_NOT_FOUND');
    if (typeof revision.tenant_id === 'string') revisionTenantIds.add(revision.tenant_id);
    if (preflight.sourceTenantId && revision.tenant_id !== preflight.sourceTenantId) {
      lineageBlockers.push(`revision:${revisionId}:TENANT_LINEAGE_MISMATCH`);
    }
    if (revision.job_id !== input.jobId) {
      lineageBlockers.push(`revision:${revisionId}:REVISION_JOB_LINEAGE_MISMATCH`);
    }
    if (revision.source_document_id !== input.sourceDocumentId) {
      lineageBlockers.push(`revision:${revisionId}:REVISION_SOURCE_LINEAGE_MISMATCH`);
    }
    if (revision.catalog_product_id !== catalogProductIds[index]) {
      lineageBlockers.push(`revision:${revisionId}:CATALOG_IDENTITY_MISMATCH`);
    }
    revisionHashes.push(String(revision.payload_hash));
  }
  if (revisionTenantIds.size > 1) lineageBlockers.push('REVISION_TENANT_LINEAGE_MISMATCH');
  const tenantId = [...revisionTenantIds][0] ?? input.tenantId;
  const sourceBundleId = typeof result.job.v4_stage_state.sourceBundleId === 'string'
    ? result.job.v4_stage_state.sourceBundleId
    : null;
  const sourceBundleHash = typeof result.job.v4_stage_state.sourceBundleHash === 'string'
    ? result.job.v4_stage_state.sourceBundleHash
    : null;
  if (sourceBundleId && sourceBundleHash) {
    for (const revisionId of revisionIds) {
      const { error: bundleLinkError } = await supabase.rpc('link_product_registration_revision_source_bundle', {
        p_payload: {
          tenant_id: tenantId,
          job_id: input.jobId,
          product_revision_id: revisionId,
          source_bundle_id: sourceBundleId,
          bundle_hash: sourceBundleHash,
        },
      });
      if (bundleLinkError) throw bundleLinkError;
    }
  }
  await recordStage({
    jobId: input.jobId,
    fencingToken: input.fencingToken,
    stage: 'segment',
    status: 'succeeded',
    output: {
      sectionCount: revisionNormalization.sections.length,
      sourceSectionCount: result.normalization.sections.length,
      revisionSectionIndexes,
      catalogProductIds,
      pastOnlySectionIndexes,
      discardedMissingSalePriceSectionIndexes,
      departureDateReference: input.departureDateReference,
      supplierProfile: {
        supplierKey: supplierProfile.supplierKey,
        documentFamily: supplierProfile.documentFamily,
        reason: supplierProfile.reason,
        profileId: supplierProfile.profile?.id ?? null,
        profileVersion: supplierProfile.profile?.profileVersion ?? null,
        profileHash: supplierProfile.profile?.profileHash ?? null,
      },
    },
  });
  await recordStage({
    jobId: input.jobId,
    fencingToken: input.fencingToken,
    stage: 'normalize',
    status: 'succeeded',
    output: {
      normalizationId: result.normalizationId,
      revisionIds,
      catalogProductIds,
      normalizationStatus: revisionNormalization.status,
      tenantId,
      lineageBlockers,
      pastOnlySectionIndexes,
      discardedMissingSalePriceSectionIndexes,
      inferredDepartureDateCount: Number(result.job.v4_stage_state.inferredDepartureDateCount ?? 0),
      excludedPastDateCount: Number(result.job.v4_stage_state.excludedPastDateCount ?? 0),
      futureDepartureCount: Number(result.job.v4_stage_state.futureDepartureCount ?? 0),
      departureDateReference: input.departureDateReference,
      supplierProfile: {
        supplierKey: supplierProfile.supplierKey,
        documentFamily: supplierProfile.documentFamily,
        reason: supplierProfile.reason,
        profileId: supplierProfile.profile?.id ?? null,
        profileVersion: supplierProfile.profile?.profileVersion ?? null,
        profileHash: supplierProfile.profile?.profileHash ?? null,
      },
    },
  });
  return {
    normalizationId: result.normalizationId,
    revisionIds,
    revisionHashes,
    catalogProductIds,
    packageIds: [] as string[],
    normalization: revisionNormalization,
    revisionSectionIndexes,
    tenantId,
    lineageBlockers,
    pastOnlySectionIndexes,
    discardedMissingSalePriceSectionIndexes,
    inferredDepartureDateCount: Number(result.job.v4_stage_state.inferredDepartureDateCount ?? 0),
    excludedPastDateCount: Number(result.job.v4_stage_state.excludedPastDateCount ?? 0),
    futureDepartureCount: Number(result.job.v4_stage_state.futureDepartureCount ?? 0),
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
  const driftClears = catalogProductsEligibleForScheduleDriftClear({
    packageIds: normalized.packageIds,
    catalogProductIds: normalized.catalogProductIds,
    shared: result,
  });
  for (const catalogProductId of driftClears) {
    const { error: overlayError } = await db().rpc('set_product_registration_availability_overlay', {
      p_payload: {
        tenant_id: normalized.tenantId ?? preflight.sourceTenantId,
        catalog_product_id: catalogProductId,
        channel: 'customer',
        sale_state: 'available',
        reason: 'SCHEDULE_REVALIDATED_CURRENT_SOURCE',
        expected_reason_prefix: 'FLIGHT_SCHEDULE_DRIFT:',
      },
    });
    if (overlayError) throw overlayError;
  }
  await recordStage({
    jobId: input.jobId,
    fencingToken: input.fencingToken,
    stage: 'resolve_shared_facts',
    status: 'succeeded',
    output: {
      blockerCount: result.blockers.length,
      degradedCount: result.degradedReasons.length,
      resolvedTransportCount: result.resolvedTransport.length,
      scheduleDriftClearCount: driftClears.length,
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
    .select('segment_index,raw_text')
    .eq('job_id', input.jobId)
    .in('segment_index', normalized.revisionSectionIndexes)
    .order('segment_index', { ascending: true });
  if (segmentError) throw segmentError;
  const aggregates = await Promise.all(normalized.revisionIds.map(revisionId =>
    loadProductRegistrationRevisionAggregate({ supabase, revisionId })));
  const termsTypes = [...new Set(aggregates.flatMap(aggregate =>
    aggregate.terms.map(row => String(row.terms_type ?? '')).filter(Boolean)))];
  const projectionBlockers: string[] = [];
  const termsPolicies = (await Promise.all(aggregates.map(async (aggregate, index) => {
    const revisionId = normalized.revisionIds[index] ?? aggregate.revision.id;
    const catalogProductId = normalized.packageIds[index] ?? aggregate.revision.catalog_product_id;
    let pkg: JsonObject;
    try {
      pkg = buildPackageProjectionFromRevision({ packageId: catalogProductId, aggregate });
    } catch (error) {
      const code = productRegistrationRevisionProjectionBlocker(error);
      if (code) {
        projectionBlockers.push(`package:${catalogProductId}:${code}`);
        return null;
      }
      throw error;
    }
    const policy = await resolveRegistrationTermsPolicy(pkg, 'mobile');
    return {
      ...policy,
      revisionId,
      catalogProductId,
      sourceCancellationCovered: aggregate.terms.some(row =>
        row.terms_type === 'cancellation' && row.validation_state === 'verified'),
    };
  }))).filter((policy): policy is NonNullable<typeof policy> => Boolean(policy));
  const decision = evaluateRegistrationPublicationPolicy({
    canonicalPayload: normalized.normalization.canonicalPayload,
    packageIds: normalized.packageIds,
    revisionIds: normalized.revisionIds,
    sourceTexts: (segments ?? []).map(row => String(row.raw_text ?? '')),
    sourceHash: preflight.sourceHash,
    expectedSourceHash: input.fileHash,
    tenantId: normalized.tenantId,
    sourceTenantId: preflight.sourceTenantId,
    sharedFactBlockers: [...shared.blockers, ...projectionBlockers],
    sharedFactDegradedReasons: shared.degradedReasons,
    termsTypes,
    cancellationCoverage: termsPolicies.map(policy => ({
      revisionId: policy.revisionId,
      catalogProductId: policy.catalogProductId,
      covered: policy.has_cancellation_policy,
      policyHash: policy.policy_hash,
      conflict: policy.cancellation_conflict === true,
      conflictReasons: policy.cancellation_conflict_reasons ?? [],
    })),
    departureDateReference: input.departureDateReference,
  });
  decision.termsPolicies = termsPolicies;
  await recordStage({
    jobId: input.jobId,
    fencingToken: input.fencingToken,
    stage: 'validate',
    status: 'succeeded',
    output: {
      outcome: decision.outcome,
      blockers: decision.blockers,
      degradedReasons: decision.degradedReasons,
      findings: decision.findings,
      decisionHash: decision.decisionHash,
      termsPolicyHashes: termsPolicies.map(policy => policy.policy_hash),
      projectionBlockers,
    },
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
    const [aggregate, { data: claims, error: claimError }] = await Promise.all([
      loadProductRegistrationRevisionAggregate({ supabase, revisionId }),
      supabase.from('product_registration_v5_claims').select('id,field_path,normalized_value,criticality,evidence_status,conflict_status').eq('revision_id', revisionId),
    ]);
    if (claimError) throw claimError;
    let pkg: JsonObject;
    try {
      pkg = buildPackageProjectionFromRevision({ packageId, aggregate });
    } catch (error) {
      blockers.push(`package:${packageId}:${error instanceof Error ? error.message : 'COPY_REVISION_PROJECTION_FAILED'}`);
      continue;
    }
    const built = buildProductRegistrationV6Copy({
      pkg: pkg as JsonObject,
      claims: (claims ?? []) as Array<{ id: string; field_path: string; normalized_value: unknown; criticality: string; evidence_status: string; conflict_status: string }>,
      degradedReasons: decision.degradedReasons,
    });
    blockers.push(...built.blockers.map(reason => `package:${packageId}:${reason}`));
    const persisted = await persistProductRegistrationV6Copy({
      supabase,
      tenantId: aggregate.revision.tenant_id,
      revisionId,
      revisionHash: aggregate.revision.payload_hash,
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

async function buildSnapshotsStep(
  input: ProductRegistrationV6WorkflowInput,
  decision: ProductRegistrationV6Decision,
  shared: SharedFactJobResult,
  compatibilityBindings: Array<{
    catalogProductId: string;
    packageId: string;
    operationalIdentity?: JsonObject;
  }>,
) {
  'use step';
  await recordStage({ jobId: input.jobId, fencingToken: input.fencingToken, stage: 'build_snapshot', status: 'running' });
  const snapshots = await buildProductRegistrationV6CandidateSnapshots({
    supabase: db(),
    decision,
    compatibilityBindings,
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
    proofs.push(await proveProductRegistrationV6Snapshot({ supabase, snapshot, baseUrl: input.requestBaseUrl || input.publicBaseUrl }));
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
  const channels = ['customer', 'b2b', 'partner'] as const;
  for (const proof of proofs) {
    for (const channel of channels) {
      await publishProductRegistrationV6Snapshot({
        supabase,
        snapshot: proof.snapshot,
        proofRunId: proof.proofRunId,
        outcome: decision.terminalOutcome as 'published_verified' | 'published_degraded',
        policyVersion: input.policyVersion,
        idempotencyKey: `${input.jobId}:${proof.snapshot.snapshotHash}:${channel}:publish-v6`,
        channel,
        locale: 'ko-KR',
      });
    }
  }
  await recordStage({
    jobId: input.jobId,
    fencingToken: input.fencingToken,
    stage: 'publish_pointer',
    status: 'succeeded',
    output: {
      publishedPackageIds: proofs.map(proof => proof.snapshot.packageId),
      channels,
    },
  });
}

async function publicationControlStep(
  input: ProductRegistrationV6WorkflowInput,
  decision: ProductRegistrationV6Decision,
): Promise<{ allowed: boolean; publicationState: ProductRegistrationV6PublicationState; blockers: string[] }> {
  'use step';
  const blockers = await loadProductRegistrationV6PublicationBlockers({
    supabase: db(),
    catalogProductIds: decision.packageIds,
    supplierKeys: [metadataString(input.uploadSourceMetadata, 'landOperator')].filter(
      (value): value is string => Boolean(value),
    ),
  });
  if (blockers.length === 0) {
    return { allowed: true, publicationState: 'proof_passed', blockers: [] };
  }
  const publicationState: ProductRegistrationV6PublicationState = blockers.includes('PUBLICATION_FREEZE_ACTIVE')
    || blockers.includes('V6_SHADOW_MODE_PUBLICATION_DISABLED')
    ? 'frozen'
    : 'blocked';
  await recordStage({
    jobId: input.jobId,
    fencingToken: input.fencingToken,
    stage: 'publish_pointer',
    status: 'succeeded',
    output: { published: false, analysisOutcome: decision.outcome, publicationState, blockers },
  });
  return { allowed: false, publicationState, blockers };
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
  publicationState: ProductRegistrationV6PublicationState,
  publicationBlockers: string[] = [],
  options: {
    enqueueReviewAlert?: boolean;
    finalizeCorrection?: boolean;
  } = {},
): Promise<ProductRegistrationV6WorkflowResult> {
  'use step';
  const supabase = db();
  const { error } = await supabase.rpc('record_product_registration_v6_terminal_state', {
    p_payload: {
      job_id: input.jobId,
      tenant_id: input.tenantId,
      workflow_run_id: workflowRunId,
      expected_fencing_token: input.fencingToken,
      analysis_outcome: decision.outcome,
      publication_state: publicationState,
      compatibility_outcome: decision.terminalOutcome,
      policy_version: input.policyVersion,
      degraded_reasons: decision.degradedReasons,
      blockers: decision.blockers,
      publication_blockers: publicationBlockers,
    },
  });
  if (error) throw new FatalError(error.message);
  let reviewAlertId: string | null = null;
  if (options.enqueueReviewAlert !== false && (decision.terminalOutcome === 'discarded_source_incomplete'
    || decision.terminalOutcome === 'blocked_action_required')) {
    const resolutionConditions = decision.terminalOutcome === 'discarded_source_incomplete'
      ? [
          '원문에서 성인 판매가와 통화를 확인합니다.',
          '요금표가 별도 파일이면 일정표와 같은 다중 파일 업로드 묶음으로 다시 올립니다.',
        ]
      : [
          '차단 사유의 원문 위치에서 가격·출발일·포함조건 중 충돌한 값을 확인합니다.',
          '수정된 원문을 재업로드하거나 correction revision을 생성합니다.',
        ];
    const { data: alertId, error: alertError } = await supabase.rpc(
      'enqueue_product_registration_review_alert',
      {
        p_payload: {
          job_id: input.jobId,
          tenant_id: input.tenantId,
          source_document_id: input.sourceDocumentId,
          source_filename: input.fileName,
          file_hash: input.fileHash,
          workflow_run_id: workflowRunId,
          policy_version: input.policyVersion,
          terminal_outcome: decision.terminalOutcome,
          blockers: decision.blockers,
          resolution_conditions: resolutionConditions,
        },
      },
    );
    if (alertError) throw new FatalError(alertError.message);
    reviewAlertId = typeof alertId === 'string' ? alertId : null;
  }
  if (options.finalizeCorrection !== false && input.correctionJobId) {
    const { error: correctionError } = await supabase.rpc('finalize_product_registration_correction', {
      p_payload: {
        correction_job_id: input.correctionJobId,
        workflow_job_id: input.jobId,
        status: decision.terminalOutcome === 'blocked_action_required'
          || decision.terminalOutcome.startsWith('quarantined_')
          ? 'blocked'
          : 'completed',
        resulting_revision_id: decision.revisionIds[0] ?? null,
      },
    });
    if (correctionError) throw new FatalError(correctionError.message);
  }
  await recordStage({
    jobId: input.jobId,
    fencingToken: input.fencingToken,
    stage: 'complete',
    status: 'succeeded',
    output: {
      terminalOutcome: decision.terminalOutcome,
      analysisOutcome: decision.outcome,
      publicationState,
      publicationBlockers,
      reviewAlertId,
    },
  });
  return {
    ...decision,
    analysisOutcome: decision.outcome,
    publicationState,
    publicationBlockers,
    jobId: input.jobId,
    workflowVersion: PRODUCT_REGISTRATION_V6_WORKFLOW_VERSION,
    completedAt: new Date().toISOString(),
  };
}

async function blockFailedWorkflowStep(
  input: ProductRegistrationV6WorkflowInput,
  workflowRunId: string,
  error: string,
): Promise<ProductRegistrationV6WorkflowResult> {
  'use step';
  const expectedIdentityBlock = error.includes('REGISTRATION_CORRECTION_IDENTITY_AMBIGUOUS');
  // A cohort-quality miss is a deliberate publication policy decision, not a
  // worker/system failure. Keep the source and revision available for a later
  // benchmark-approved retry, but terminate the upload as an actionable
  // business block instead of sending it to the dead-letter system queue.
  const cohortQualityBlock = error.includes('REGISTRATION_PUBLICATION_COHORT_NOT_ELIGIBLE');
  const proofEvidenceBlock = error.includes('V6_BROWSER_PROOF_FAILED:');
  const expectedPublicationBlock = expectedIdentityBlock || cohortQualityBlock || proofEvidenceBlock;
  const proofCategory = proofEvidenceBlock
    ? error.split(':')[1]?.replace(/[^A-Z0-9_]/giu, '_').toUpperCase() || 'CONTRACT'
    : null;
  const workflowBlocker = expectedIdentityBlock
    ? 'IDENTITY_BINDING_AMBIGUOUS'
    : cohortQualityBlock
      ? 'V6_COHORT_QUALITY_INCOMPLETE'
      : proofEvidenceBlock
        ? `V6_BROWSER_PROOF_${proofCategory}`
        : `WORKFLOW_FAILED:${error}`;
  const decision: ProductRegistrationV6Decision = {
    outcome: 'blocked',
    terminalOutcome: expectedPublicationBlock
      ? 'blocked_action_required'
      : 'quarantined_system_failure',
    degradedReasons: [],
    blockers: [workflowBlocker],
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
  if (!expectedPublicationBlock) {
    await supabase.rpc('record_product_registration_v6_dead_letter', {
      p_payload: {
        tenant_id: input.tenantId,
        job_id: input.jobId,
        workflow_run_id: workflowRunId,
        failed_stage: failedStage,
        operation_key: `${input.jobId}:${input.fencingToken}:dead-letter`,
        error_code: error.split(':')[0] || 'WORKFLOW_FAILED',
        error_detail: error,
        source_hash: input.fileHash,
        payload: { workflowVersion: PRODUCT_REGISTRATION_V6_WORKFLOW_VERSION },
        created_version: PRODUCT_REGISTRATION_V6_WORKFLOW_VERSION,
      },
    });
  }
  const { error: terminalError } = await supabase.rpc('record_product_registration_v6_terminal_state', {
    p_payload: {
      job_id: input.jobId,
      tenant_id: input.tenantId,
      workflow_run_id: workflowRunId,
      expected_fencing_token: input.fencingToken,
      analysis_outcome: decision.outcome,
      publication_state: 'blocked',
      compatibility_outcome: decision.terminalOutcome,
      policy_version: input.policyVersion,
      degraded_reasons: decision.degradedReasons,
      blockers: decision.blockers,
      publication_blockers: expectedPublicationBlock ? [workflowBlocker] : [],
    },
  });
  if (terminalError) throw new FatalError(terminalError.message);
  if (input.correctionJobId) {
    await supabase.rpc('finalize_product_registration_correction', {
      p_payload: {
        correction_job_id: input.correctionJobId,
        workflow_job_id: input.jobId,
        status: 'failed',
        resulting_revision_id: null,
      },
    });
  }
  await recordStage({
    jobId: input.jobId,
    fencingToken: input.fencingToken,
    stage: 'complete',
    status: 'succeeded',
    output: { terminalOutcome: decision.terminalOutcome, failed: !expectedIdentityBlock },
  });
  return {
    ...decision,
    analysisOutcome: decision.outcome,
    publicationState: 'blocked',
    publicationBlockers: [],
    jobId: input.jobId,
    workflowVersion: PRODUCT_REGISTRATION_V6_WORKFLOW_VERSION,
    completedAt: new Date().toISOString(),
  };
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
    const { cohort, filenameClassification } = await classifyInputStep(input);
    if (cohort.documentClass === 'unsupported') {
      return await terminalStep(
        input,
        workflowRunId,
        terminalDocumentDecision(cohort.reasonCode, 'quarantined_unsupported_or_corrupt'),
        'not_requested',
      );
    }
    if (filenameClassification) {
      return await terminalStep(
        input,
        workflowRunId,
        terminalDocumentDecision(filenameClassification.reasonCode, 'discarded_non_travel'),
        'not_requested',
      );
    }
    const extracted = await extractStep(input);
    if (extracted.classification.documentClass !== 'travel_product') {
      const terminalOutcome = extracted.classification.documentClass === 'non_travel'
        ? 'discarded_non_travel'
        : 'quarantined_unsupported_or_corrupt';
      return await terminalStep(
        input,
        workflowRunId,
        terminalDocumentDecision(extracted.classification.reasonCode, terminalOutcome),
        'not_requested',
      );
    }
    let bundled = await bundleSourcesStep(input, extracted, 0);
    // Keep the total wait below the 30 minute stale-job threshold. Each retry
    // has a distinct attempt argument so Workflow DevKit does not replay a
    // memoized step result while another member of the upload batch arrives.
    const bundleWaits = ['30s', '90s', '3m', '5m', '10m'] as const;
    for (const [waitIndex, waitDuration] of bundleWaits.entries()) {
      if (bundled.state !== 'waiting_for_peer') break;
      await sleep(waitDuration);
      bundled = await bundleSourcesStep(input, extracted, waitIndex + 1);
    }
    if (bundled.state === 'waiting_for_peer') {
      return await terminalStep(
        input,
        workflowRunId,
        terminalDocumentDecision('SOURCE_BATCH_MEMBERS_TIMEOUT', 'blocked_action_required'),
        'not_requested',
      );
    }
    if (bundled.state === 'consolidated_by_peer') {
      return await terminalStep(
        input,
        workflowRunId,
        terminalDocumentDecision(
          `SOURCE_BATCH_CONSOLIDATED_BY:${bundled.coordinatorJobId ?? 'peer'}`,
          'discarded_duplicate_or_consolidated',
        ),
        'not_requested',
      );
    }
    const supplierProfile = await resolveSupplierProfileStep(input);
    await resolveCriticalFactsStep(input, supplierProfile);
    if (await analysisRecoveryPreviewEnabledStep()) {
      const analysisPlan = await analyzeUnpublishedStep(input, preflight, supplierProfile);
      return await terminalStep(
        input,
        workflowRunId,
        analysisRecoveryPreviewDecision(analysisPlan),
        'not_requested',
        [],
        { enqueueReviewAlert: false, finalizeCorrection: false },
      );
    }
    const canonical = await normalizeStep(input, preflight, supplierProfile);
    if (canonical.revisionIds.length === 0
      && canonical.discardedMissingSalePriceSectionIndexes.length > 0) {
      return await terminalStep(
        input,
        workflowRunId,
        discardedSourceIncompleteDecision(canonical.discardedMissingSalePriceSectionIndexes),
        'not_requested',
      );
    }
    if (canonical.revisionIds.length === 0 && canonical.pastOnlySectionIndexes.length > 0) {
      return await terminalStep(input, workflowRunId, allDeparturesPastDecision(), 'not_requested');
    }
    const normalized = { ...canonical, packageIds: canonical.catalogProductIds };
    const shared = await resolveSharedFactsStep(input, normalized, preflight);
    const decision = await validateStep(input, normalized, shared, preflight);
    if (decision.outcome === 'blocked') return await terminalStep(input, workflowRunId, decision, 'not_requested');
    const copyDecision = await generateCopyStep(input, decision);
    if (copyDecision.outcome === 'blocked') return await terminalStep(input, workflowRunId, copyDecision, 'not_requested');
    const compatibility = await projectCompatibilityStep(input, canonical);
    const snapshots = await buildSnapshotsStep(input, copyDecision, shared, compatibility.bindings);
    const proofs = await proveSnapshotsStep(input, snapshots);
    const publication = await publicationControlStep(input, copyDecision);
    if (!publication.allowed) {
      return await terminalStep(
        input,
        workflowRunId,
        unpublishedReadyDecision(copyDecision),
        publication.publicationState,
        publication.blockers,
      );
    }
    await publishSnapshotsStep(input, copyDecision, proofs);
    await convergeStep(input, snapshots);
    return await terminalStep(input, workflowRunId, copyDecision, 'converged');
  } catch (error) {
    return await blockFailedWorkflowStep(input, workflowRunId, error instanceof Error ? error.message : String(error));
  }
}
