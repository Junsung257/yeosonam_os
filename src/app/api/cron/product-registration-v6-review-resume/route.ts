import { randomUUID } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import type { DocumentIR } from '@/lib/product-registration-v4/types';
import type { ProductReviewCaseStatus, ReviewPacketV1, ReviewReceiptV1 } from '@/lib/product-registration-v6/human-review';
import { callProductReviewRpc } from '@/lib/product-registration-v6/human-review-rpc';
import { buildReviewResumePlan, createHumanReviewDerivedExtraction, type ReviewResumeInput } from '@/lib/product-registration-v6/review-resume';
import {
  normalizeDerivedExtraction,
  normalizeHumanReviewDecision,
  persistDerivedCanonicalNormalization,
  persistDerivedDocumentExtraction,
  persistHumanReviewNormalization,
} from '@/lib/product-registration-v6/derived-extraction';
import { getProductRegistrationV6RuntimeConfig } from '@/lib/product-registration-v6/runtime-config';
import { withCronGuard } from '@/lib/cron-auth';
import { getSupabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type ClaimedResume = {
  runId: string;
  caseId: string;
  tenantId: string;
  jobId: string;
  caseStatus: ProductReviewCaseStatus;
  packet: ReviewPacketV1;
  receipt: Record<string, unknown>;
  receipts: Record<string, unknown>[];
  parentExtraction: {
    id: string;
    sourceDocumentId: string;
    sourceHash: string;
    extractionHash: string;
    documentIr: DocumentIR;
  };
};

function text(value: unknown, code: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(code);
  return value.normalize('NFC').trim();
}

function uuid(value: unknown, code: string): string {
  const candidate = text(value, code);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(candidate)) throw new Error(code);
  return candidate.toLowerCase();
}

function receiptFromDb(raw: Record<string, unknown>): ReviewReceiptV1 {
  return {
    contractVersion: 'human-review-v1',
    caseId: uuid(raw.case_id, 'REVIEW_RESUME_RECEIPT_CASE_ID_INVALID'),
    reviewerUserId: uuid(raw.reviewer_id, 'REVIEW_RESUME_RECEIPT_REVIEWER_ID_INVALID'),
    reviewerSessionId: uuid(raw.reviewer_session_id, 'REVIEW_RESUME_RECEIPT_SESSION_ID_INVALID'),
    reviewerSlot: text(raw.reviewer_slot, 'REVIEW_RESUME_RECEIPT_SLOT_INVALID') as ReviewReceiptV1['reviewerSlot'],
    packetHash: text(raw.packet_hash, 'REVIEW_RESUME_RECEIPT_PACKET_HASH_INVALID'),
    sourceHash: text(raw.source_hash, 'REVIEW_RESUME_RECEIPT_SOURCE_HASH_INVALID'),
    parentExtractionHash: text(raw.parent_extraction_hash, 'REVIEW_RESUME_RECEIPT_PARENT_HASH_INVALID'),
    candidateAxisSetHash: text(raw.candidate_axis_set_hash, 'REVIEW_RESUME_RECEIPT_AXIS_HASH_INVALID'),
    policyVersion: text(raw.policy_version, 'REVIEW_RESUME_RECEIPT_POLICY_INVALID') as ReviewReceiptV1['policyVersion'],
    decision: text(raw.decision, 'REVIEW_RESUME_RECEIPT_DECISION_INVALID') as ReviewReceiptV1['decision'],
    decisionPayload: (raw.decision_payload && typeof raw.decision_payload === 'object' && !Array.isArray(raw.decision_payload))
      ? raw.decision_payload as Record<string, unknown>
      : {},
    evidence: Array.isArray(raw.evidence) ? raw.evidence as ReviewReceiptV1['evidence'] : [],
    reason: text(raw.reason, 'REVIEW_RESUME_RECEIPT_REASON_INVALID'),
    createdAt: text(raw.created_at, 'REVIEW_RESUME_RECEIPT_CREATED_AT_INVALID'),
    receiptHash: text(raw.receipt_hash, 'REVIEW_RESUME_RECEIPT_HASH_INVALID'),
  };
}

function claimedFromRpc(value: unknown): ClaimedResume[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`REVIEW_RESUME_CLAIM_INVALID:${index}`);
    const row = raw as Record<string, unknown>;
    const parentRaw = row.parentExtraction;
    if (!parentRaw || typeof parentRaw !== 'object' || Array.isArray(parentRaw)) throw new Error(`REVIEW_RESUME_PARENT_INVALID:${index}`);
    const parent = parentRaw as Record<string, unknown>;
    const packet = row.packet as ReviewPacketV1;
    const receiptRaw = row.receipt;
    if (!receiptRaw || typeof receiptRaw !== 'object' || Array.isArray(receiptRaw)) throw new Error(`REVIEW_RESUME_RECEIPT_INVALID:${index}`);
    const receiptsRaw = row.receipts;
    if (!Array.isArray(receiptsRaw)) throw new Error(`REVIEW_RESUME_RECEIPTS_INVALID:${index}`);
    return {
      runId: uuid(row.runId, `REVIEW_RESUME_RUN_ID_INVALID:${index}`),
      caseId: uuid(row.caseId, `REVIEW_RESUME_CASE_ID_INVALID:${index}`),
      tenantId: uuid(row.tenantId, `REVIEW_RESUME_TENANT_ID_INVALID:${index}`),
      jobId: uuid(row.jobId, `REVIEW_RESUME_JOB_ID_INVALID:${index}`),
      caseStatus: text(row.caseStatus, `REVIEW_RESUME_STATUS_INVALID:${index}`) as ProductReviewCaseStatus,
      packet,
      receipt: receiptRaw as Record<string, unknown>,
      receipts: receiptsRaw.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item))),
      parentExtraction: {
        id: uuid(parent.id, `REVIEW_RESUME_PARENT_ID_INVALID:${index}`),
        sourceDocumentId: uuid(parent.sourceDocumentId, `REVIEW_RESUME_SOURCE_ID_INVALID:${index}`),
        sourceHash: text(parent.sourceHash, `REVIEW_RESUME_SOURCE_HASH_INVALID:${index}`),
        extractionHash: text(parent.extractionHash, `REVIEW_RESUME_EXTRACTION_HASH_INVALID:${index}`),
        documentIr: parent.documentIr as DocumentIR,
      },
    };
  });
}

async function complete(
  db: ReturnType<typeof getSupabaseAdmin>,
  claim: ClaimedResume,
  workerId: string,
  payload: Record<string, unknown>,
) {
  if (!db) throw new Error('SUPABASE_ADMIN_UNAVAILABLE');
  return callProductReviewRpc(db, 'complete_product_registration_review_resume', {
    p_payload: { run_id: claim.runId, worker_id: workerId, ...payload },
  });
}

async function processClaim(db: NonNullable<ReturnType<typeof getSupabaseAdmin>>, claim: ClaimedResume, workerId: string) {
  const receipts = claim.receipts.map(receiptFromDb);
  const input: ReviewResumeInput = {
    caseId: claim.caseId,
    jobId: claim.jobId,
    tenantId: claim.tenantId,
    status: claim.caseStatus,
    packet: claim.packet,
    receipts,
    parent: claim.parentExtraction,
  };
  // The claim RPC returns the complete immutable receipt set. A terminal case
  // is already dual-reviewed or adjudicated, so the plan can independently
  // recompute agreement instead of trusting a mutable status alone.
  const plan = buildReviewResumePlan(input);
  if (plan.disposition === 'not_ready') {
    await complete(db, claim, workerId, { status: 'failed', error_code: plan.reasonCode });
    return { caseId: claim.caseId, status: 'not_ready', error: plan.reasonCode };
  }
  if (plan.disposition === 'terminal_without_derivation') {
    await complete(db, claim, workerId, { status: 'skipped', reason_code: plan.reasonCode });
    return { caseId: claim.caseId, status: 'skipped', reason: plan.reasonCode };
  }
  let sideEffectAttempted = false;
  try {
    if (plan.disposition === 'revalidate_parent') {
      sideEffectAttempted = true;
      const result = await normalizeHumanReviewDecision({
        parent: claim.parentExtraction,
        reviewReceiptHash: plan.receiptHash,
      });
      const persisted = await persistHumanReviewNormalization({
        supabase: db,
        tenantId: claim.tenantId,
        jobId: claim.jobId,
        parent: claim.parentExtraction,
        result,
        selectedAxisKey: plan.selectedAxisKey,
      });
      await complete(db, claim, workerId, {
        status: 'succeeded',
        normalization_id: persisted.id,
      });
      return { caseId: claim.caseId, status: 'revalidated', normalizationId: persisted.id };
    }
    const derived = createHumanReviewDerivedExtraction({
      plan,
      parent: claim.parentExtraction,
      createdBy: plan.receipt.reviewerUserId,
    });
    sideEffectAttempted = true;
    const persistedDerived = await persistDerivedDocumentExtraction({
      supabase: db,
      tenantId: claim.tenantId,
      derived,
      qualityDiagnostics: { reviewReceiptHash: plan.receiptHash, reviewCaseId: claim.caseId },
    });
    const result = await normalizeDerivedExtraction({ derived: persistedDerived.derived });
    const persistedNormalization = await persistDerivedCanonicalNormalization({
      supabase: db,
      tenantId: claim.tenantId,
      jobId: claim.jobId,
      derived: persistedDerived.derived,
      result,
      qualityDiagnostics: { reviewReceiptHash: plan.receiptHash, reviewCaseId: claim.caseId },
    });
    await complete(db, claim, workerId, {
      status: 'succeeded',
      derived_extraction_id: persistedDerived.id,
      normalization_id: persistedNormalization.id,
    });
    return {
      caseId: claim.caseId,
      status: 'derived_and_revalidated',
      derivedExtractionId: persistedDerived.id,
      normalizationId: persistedNormalization.id,
    };
  } catch (error) {
    const errorCode = error instanceof Error ? error.message : String(error);
    await complete(db, claim, workerId, {
      status: sideEffectAttempted ? 'unknown_outcome' : 'failed',
      error_code: errorCode.slice(0, 240),
    }).catch(() => undefined);
    return { caseId: claim.caseId, status: sideEffectAttempted ? 'unknown_outcome' : 'failed', error: errorCode };
  }
}

async function handler(request: NextRequest): Promise<NextResponse> {
  const config = getProductRegistrationV6RuntimeConfig();
  if (process.env.PRODUCT_REGISTRATION_V6_REVIEW_RESUME_ENABLED !== '1') {
    return apiResponse({ success: false, code: 'V6_REVIEW_RESUME_DISABLED' }, { status: 409 });
  }
  if (config.authorityMode === 'legacy' || !config.workflowEnabled || !config.publicationFrozen) {
    return apiResponse({ success: false, code: 'V6_REVIEW_RESUME_SAFETY_GATE_BLOCKED' }, { status: 409 });
  }
  const db = getSupabaseAdmin();
  if (!db) return apiResponse({ success: false, code: 'SUPABASE_ADMIN_UNAVAILABLE' }, { status: 503 });
  const requested = Number(request.nextUrl.searchParams.get('limit') ?? 5);
  const limit = Number.isFinite(requested) ? Math.max(1, Math.min(Math.floor(requested), 10)) : 5;
  const workerId = `v6-review-resume:${randomUUID()}`;
  try {
    const claimed = await callProductReviewRpc(db, 'claim_product_registration_review_resume', {
      p_limit: limit,
      p_worker_id: workerId,
    });
    const claims = claimedFromRpc(claimed);
    const results = [] as Array<Record<string, unknown>>;
    for (const claim of claims) results.push(await processClaim(db, claim, workerId));
    return apiResponse({ success: results.every(result => result.status === 'revalidated' || result.status === 'derived_and_revalidated' || result.status === 'skipped'), claimed: claims.length, results }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[product-registration-v6-review-resume]', error);
    return apiResponse({ success: false, code: error instanceof Error ? error.message : 'V6_REVIEW_RESUME_FAILED' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}

export const GET = withCronGuard(handler);
