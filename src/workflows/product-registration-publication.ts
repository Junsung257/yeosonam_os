import { getWorkflowMetadata, sleep } from 'workflow';
import type { SupabaseClient } from '@supabase/supabase-js';

import { observeProductRegistrationV5ConvergenceBatch } from '@/lib/product-registration-v4/convergence-observer';
import { processProductRegistrationV5OutboxBatch } from '@/lib/product-registration-v4/outbox-worker';
import { sha256Hex } from '@/lib/product-registration-v4/document-ir';
import { stableJson } from '@/lib/product-registration-v4/revision';
import {
  claimProductRegistrationPublicationRequest,
  issueProductRegistrationReleaseAuthorization,
  loadProductRegistrationPublicationRequest,
  markProductRegistrationConvergenceFailed,
  publishProductRegistrationSnapshotBundle,
  transitionProductRegistrationPublicationRequest,
  type PublicationWorkflowRequest,
} from '@/lib/product-registration-authority';
import {
  loadProductRegistrationV6CandidateSnapshot,
  proveOrReuseProductRegistrationV6Snapshot,
  runProductRegistrationV6LiveCanary,
  type ProductRegistrationV6CandidateSnapshot,
} from '@/lib/product-registration-v6/snapshot-publication';
import { currentProductRegistrationRendererBuildId } from '@/lib/product-registration-v6/renderer-build';
import {
  PRODUCT_REGISTRATION_V6_POLICY_VERSION,
  PRODUCT_REGISTRATION_V6_WORKFLOW_VERSION,
} from '@/lib/product-registration-v6/types';
import { getSupabaseAdmin } from '@/lib/supabase';

type JsonObject = Record<string, unknown>;

export const PRODUCT_REGISTRATION_PUBLICATION_WORKFLOW_VERSION = 'product-registration-publication-workflow-1';

export type ProductRegistrationPublicationWorkflowInput = {
  publicationRequestId: string;
  requestBaseUrl: string;
  publicBaseUrl: string;
};

export type ProductRegistrationPublicationWorkflowResult = {
  publicationRequestId: string;
  status: string;
  snapshotId: string | null;
  proofId: string | null;
  publicationWorkflowVersion: string;
  completedAt: string;
  detail?: string;
};

function db(): SupabaseClient {
  const client = getSupabaseAdmin();
  if (!client) throw new Error('SUPABASE_ADMIN_NOT_CONFIGURED');
  return client as SupabaseClient;
}

function object(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function liveCanaryEvidence(
  result: Awaited<ReturnType<typeof runProductRegistrationV6LiveCanary>>,
): JsonObject {
  return {
    status: result.status,
    browserMode: result.browserMode,
    browserVersion: result.browserVersion,
    viewport: result.viewport,
    checkedAt: result.checkedAt,
    surfaces: result.surfaces.map(({ screenshotPng: _screenshotPng, ...surface }) => surface),
  };
}

async function claimStep(input: ProductRegistrationPublicationWorkflowInput, workflowRunId: string) {
  'use step';
  return claimProductRegistrationPublicationRequest({
    supabase: db(),
    publicationRequestId: input.publicationRequestId,
    workflowRunId,
  });
}

async function loadSnapshotStep(request: PublicationWorkflowRequest) {
  'use step';
  return loadProductRegistrationV6CandidateSnapshot({
    supabase: db(),
    tenantId: request.tenantId,
    catalogProductId: request.catalogProductId,
    packageId: request.packageId,
    revisionId: request.expectedRevisionId,
  });
}

async function proveStep(input: {
  workflowInput: ProductRegistrationPublicationWorkflowInput;
  workflowRunId: string;
  request: PublicationWorkflowRequest;
}): Promise<{ snapshot: ProductRegistrationV6CandidateSnapshot; proofId: string; proofReused: boolean }> {
  'use step';
  const supabase = db();
  await transitionProductRegistrationPublicationRequest({
    supabase,
    publicationRequestId: input.request.id,
    workflowRunId: input.workflowRunId,
    expectedStatus: 'revalidating',
    nextStatus: 'proving',
  });
  const snapshot = await loadProductRegistrationV6CandidateSnapshot({
    supabase,
    tenantId: input.request.tenantId,
    catalogProductId: input.request.catalogProductId,
    packageId: input.request.packageId,
    revisionId: input.request.expectedRevisionId,
  });
  const proof = await proveOrReuseProductRegistrationV6Snapshot({
    supabase,
    snapshot,
    baseUrl: input.workflowInput.requestBaseUrl || input.workflowInput.publicBaseUrl,
  });
  return { snapshot, proofId: proof.proofRunId, proofReused: proof.reused };
}

async function publishStep(input: {
  workflowRunId: string;
  request: PublicationWorkflowRequest;
  snapshot: ProductRegistrationV6CandidateSnapshot;
  proofId: string;
}): Promise<{ proofHash: string; releaseManifestHash: string; outcome: 'published_verified' | 'published_degraded' }> {
  'use step';
  const supabase = db();
  const [{ data: revision, error: revisionError }, { data: proof, error: proofError }, { data: snapshotRow, error: snapshotError }] = await Promise.all([
    supabase
      .from('product_registration_v5_revisions')
      .select('payload_hash,source_hash')
      .eq('id', input.request.expectedRevisionId)
      .eq('tenant_id', input.request.tenantId)
      .eq('catalog_product_id', input.request.catalogProductId)
      .single(),
    supabase
      .from('product_registration_v5_proof_runs')
      .select('proof_hash,status,snapshot_hash,renderer_build_id')
      .eq('id', input.proofId)
      .single(),
    supabase
      .from('public_package_snapshots')
      .select('snapshot_json')
      .eq('id', input.snapshot.snapshotId)
      .single(),
  ]);
  if (revisionError || proofError || snapshotError || !revision || !proof || !snapshotRow) {
    throw new Error('REGISTRATION_PUBLICATION_RELEASE_EVIDENCE_MISSING');
  }
  if (revision.payload_hash !== input.snapshot.revisionContentHash
    || revision.source_hash !== input.request.expectedSourceHash
    || proof.status !== 'passed'
    || proof.snapshot_hash !== input.snapshot.snapshotHash
    || proof.renderer_build_id !== input.snapshot.rendererBuildId
    || typeof proof.proof_hash !== 'string') {
    throw new Error('REGISTRATION_PUBLICATION_RELEASE_EVIDENCE_MISMATCH');
  }
  const productionCommit = process.env.VERCEL_GIT_COMMIT_SHA?.trim();
  if (process.env.VERCEL_ENV === 'production' && !productionCommit) {
    throw new Error('REGISTRATION_PUBLICATION_RELEASE_COMMIT_UNPINNED');
  }
  const releaseManifestHash = sha256Hex(stableJson({
    schemaVersion: 'product-registration-publication-release-1',
    gitCommit: productionCommit ?? 'local-unpinned',
    rendererBuildId: currentProductRegistrationRendererBuildId(),
    registrationWorkflowVersion: PRODUCT_REGISTRATION_V6_WORKFLOW_VERSION,
    publicationWorkflowVersion: PRODUCT_REGISTRATION_PUBLICATION_WORKFLOW_VERSION,
    policyVersion: PRODUCT_REGISTRATION_V6_POLICY_VERSION,
    revisionId: input.request.expectedRevisionId,
    revisionHash: revision.payload_hash,
    sourceHash: revision.source_hash,
    snapshotId: input.snapshot.snapshotId,
    snapshotHash: input.snapshot.snapshotHash,
    proofId: input.proofId,
    proofHash: proof.proof_hash,
  }));
  const snapshotJson = object(snapshotRow.snapshot_json);
  const packageRow = object(snapshotJson.package);
  const disclosure = object(packageRow.product_registration_disclosure);
  const outcome = disclosure.state === 'published_degraded'
    ? 'published_degraded' as const
    : 'published_verified' as const;
  const ready = await transitionProductRegistrationPublicationRequest({
    supabase,
    publicationRequestId: input.request.id,
    workflowRunId: input.workflowRunId,
    expectedStatus: 'proving',
    nextStatus: 'ready',
    snapshotId: input.snapshot.snapshotId,
    proofId: input.proofId,
    releaseManifestHash,
  });
  const authorizations = [];
  for (const channel of ready.channels) {
    const authorization = await issueProductRegistrationReleaseAuthorization({
      supabase,
      request: ready,
      snapshotId: input.snapshot.snapshotId,
      snapshotHash: input.snapshot.snapshotHash,
      revisionHash: revision.payload_hash,
      proofId: input.proofId,
      proofHash: proof.proof_hash,
      channel,
      policyVersion: PRODUCT_REGISTRATION_V6_POLICY_VERSION,
    });
    authorizations.push({ channel, ...authorization });
  }
  await publishProductRegistrationSnapshotBundle({
    supabase,
    request: ready,
    snapshotId: input.snapshot.snapshotId,
    snapshotHash: input.snapshot.snapshotHash,
    revisionHash: revision.payload_hash,
    proofId: input.proofId,
    proofHash: proof.proof_hash,
    releaseManifestHash,
    outcome,
    policyVersion: PRODUCT_REGISTRATION_V6_POLICY_VERSION,
    authorizations,
  });
  return { proofHash: proof.proof_hash, releaseManifestHash, outcome };
}

async function convergenceStep(input: {
  workflowInput: ProductRegistrationPublicationWorkflowInput;
  request: PublicationWorkflowRequest;
  snapshot: ProductRegistrationV6CandidateSnapshot;
  attempt: number;
}): Promise<{ complete: boolean; detail: string }> {
  'use step';
  const supabase = db();
  const outbox = await processProductRegistrationV5OutboxBatch({
    supabase,
    limit: 20,
    workerId: `publication:${input.request.id}:${input.attempt}`,
    aggregateIds: [input.snapshot.packageId],
  });
  await observeProductRegistrationV5ConvergenceBatch({
    supabase,
    baseUrl: input.workflowInput.publicBaseUrl || input.workflowInput.requestBaseUrl,
    limit: 20,
    snapshotHashes: [input.snapshot.snapshotHash],
  });
  const { data, error } = await supabase
    .from('product_registration_v5_cache_convergence_runs')
    .select('surface,status,error_detail')
    .eq('package_id', input.snapshot.packageId)
    .eq('snapshot_hash', input.snapshot.snapshotHash)
    .in('surface', ['packages', 'lp']);
  if (error) throw error;
  const rows = data ?? [];
  const complete = ['packages', 'lp'].every(surface => rows.some(row => (
    row.surface === surface && row.status === 'converged'
  )));
  return {
    complete,
    detail: stableJson({
      outboxDelivered: outbox.filter(row => row.ok).length,
      rows,
    }).slice(0, 2_000),
  };
}

async function liveCanaryStep(input: {
  workflowInput: ProductRegistrationPublicationWorkflowInput;
  snapshot: ProductRegistrationV6CandidateSnapshot;
}) {
  'use step';
  const result = await runProductRegistrationV6LiveCanary({
    snapshot: input.snapshot,
    baseUrl: input.workflowInput.publicBaseUrl || input.workflowInput.requestBaseUrl,
  });
  return liveCanaryEvidence(result);
}

async function completeStep(input: {
  workflowRunId: string;
  request: PublicationWorkflowRequest;
  snapshot: ProductRegistrationV6CandidateSnapshot;
  proofId: string;
  liveCanaryResult: JsonObject;
}): Promise<PublicationWorkflowRequest> {
  'use step';
  return transitionProductRegistrationPublicationRequest({
    supabase: db(),
    publicationRequestId: input.request.id,
    workflowRunId: input.workflowRunId,
    expectedStatus: 'pointer_committed',
    nextStatus: 'published_verified',
    snapshotId: input.snapshot.snapshotId,
    proofId: input.proofId,
    liveCanaryResult: input.liveCanaryResult,
  });
}

async function failClosedStep(input: {
  workflowRunId: string;
  requestId: string;
  snapshot?: ProductRegistrationV6CandidateSnapshot | null;
  error: string;
  liveCanaryResult?: JsonObject | null;
}): Promise<PublicationWorkflowRequest | null> {
  'use step';
  const supabase = db();
  const current = await loadProductRegistrationPublicationRequest({
    supabase,
    publicationRequestId: input.requestId,
  });
  if (!current) return null;
  if (current.status === 'pointer_committed' && input.snapshot) {
    await markProductRegistrationConvergenceFailed({
      supabase,
      publicationRequestId: current.id,
      tenantId: current.tenantId,
      catalogProductId: current.catalogProductId,
      packageId: current.packageId,
      revisionId: current.expectedRevisionId,
      snapshotId: input.snapshot.snapshotId,
      reason: 'SURFACE_CONVERGENCE_FAILED',
      errorDetail: input.error,
      liveCanaryResult: input.liveCanaryResult ?? null,
    });
    return loadProductRegistrationPublicationRequest({ supabase, publicationRequestId: current.id });
  }
  if (['requested', 'revalidating', 'proving', 'ready'].includes(current.status)
    && current.workflowRunId === input.workflowRunId) {
    return transitionProductRegistrationPublicationRequest({
      supabase,
      publicationRequestId: current.id,
      workflowRunId: input.workflowRunId,
      expectedStatus: current.status,
      nextStatus: 'blocked',
      errorCode: input.error.split(':')[0] || 'REGISTRATION_PUBLICATION_WORKFLOW_FAILED',
      errorDetail: input.error,
    });
  }
  return current;
}

export async function productRegistrationPublicationWorkflow(
  input: ProductRegistrationPublicationWorkflowInput,
): Promise<ProductRegistrationPublicationWorkflowResult> {
  'use workflow';
  const { workflowRunId } = getWorkflowMetadata();
  let snapshot: ProductRegistrationV6CandidateSnapshot | null = null;
  let proofId: string | null = null;
  try {
    const claimed = await claimStep(input, workflowRunId);
    if (claimed.action === 'compensate') {
      snapshot = await loadSnapshotStep(claimed.request);
      const failed = await failClosedStep({
        workflowRunId,
        requestId: claimed.request.id,
        snapshot,
        error: 'PUBLICATION_WORKFLOW_LEASE_EXPIRED_AFTER_POINTER_COMMIT',
      });
      return {
        publicationRequestId: claimed.request.id,
        status: failed?.status ?? 'convergence_failed',
        snapshotId: snapshot.snapshotId,
        proofId: claimed.request.proofId,
        publicationWorkflowVersion: PRODUCT_REGISTRATION_PUBLICATION_WORKFLOW_VERSION,
        completedAt: new Date().toISOString(),
        detail: 'fail_closed_compensation',
      };
    }
    if (claimed.action !== 'execute') {
      return {
        publicationRequestId: input.publicationRequestId,
        status: claimed.request.status,
        snapshotId: claimed.request.snapshotId,
        proofId: claimed.request.proofId,
        publicationWorkflowVersion: PRODUCT_REGISTRATION_PUBLICATION_WORKFLOW_VERSION,
        completedAt: new Date().toISOString(),
        detail: claimed.action,
      };
    }
    const proved = await proveStep({ workflowInput: input, workflowRunId, request: claimed.request });
    snapshot = proved.snapshot;
    proofId = proved.proofId;
    await publishStep({ workflowRunId, request: claimed.request, snapshot, proofId });
    let convergence = await convergenceStep({ workflowInput: input, request: claimed.request, snapshot, attempt: 0 });
    for (const [index, delay] of (['5s', '15s'] as const).entries()) {
      if (convergence.complete) break;
      await sleep(delay);
      convergence = await convergenceStep({
        workflowInput: input,
        request: claimed.request,
        snapshot,
        attempt: index + 1,
      });
    }
    if (!convergence.complete) throw new Error(`SURFACE_CONVERGENCE_FAILED:${convergence.detail}`);
    const canary = await liveCanaryStep({ workflowInput: input, snapshot });
    if (canary.status !== 'passed') {
      await failClosedStep({
        workflowRunId,
        requestId: claimed.request.id,
        snapshot,
        error: 'LIVE_CHROME_CANARY_FAILED',
        liveCanaryResult: canary,
      });
      return {
        publicationRequestId: claimed.request.id,
        status: 'convergence_failed',
        snapshotId: snapshot.snapshotId,
        proofId,
        publicationWorkflowVersion: PRODUCT_REGISTRATION_PUBLICATION_WORKFLOW_VERSION,
        completedAt: new Date().toISOString(),
        detail: 'LIVE_CHROME_CANARY_FAILED',
      };
    }
    const completed = await completeStep({
      workflowRunId,
      request: claimed.request,
      snapshot,
      proofId,
      liveCanaryResult: canary,
    });
    return {
      publicationRequestId: completed.id,
      status: completed.status,
      snapshotId: snapshot.snapshotId,
      proofId,
      publicationWorkflowVersion: PRODUCT_REGISTRATION_PUBLICATION_WORKFLOW_VERSION,
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const failed = await failClosedStep({
      workflowRunId,
      requestId: input.publicationRequestId,
      snapshot,
      error: detail,
    }).catch(() => null);
    return {
      publicationRequestId: input.publicationRequestId,
      status: failed?.status ?? 'blocked',
      snapshotId: snapshot?.snapshotId ?? null,
      proofId,
      publicationWorkflowVersion: PRODUCT_REGISTRATION_PUBLICATION_WORKFLOW_VERSION,
      completedAt: new Date().toISOString(),
      detail,
    };
  }
}
