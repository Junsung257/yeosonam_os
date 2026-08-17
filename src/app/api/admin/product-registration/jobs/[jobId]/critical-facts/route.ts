import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';

import { resolveAdminActorId, withAdminGuard } from '@/lib/admin-guard';
import { startProductRegistrationWorkflowBySourceId } from '@/lib/product-registration-authority/start-workflow';
import {
  buildCriticalFactEvidenceAnchors,
  normalizeCriticalFactProviderAnswer,
  verifyCriticalPriceCandidates,
  CRITICAL_FACT_CONSENSUS_POLICY_VERSION,
} from '@/lib/product-registration-v6/critical-fact-consensus';
import { segmentDocumentIR } from '@/lib/product-registration-v4/canonical-worker';
import { getProductRegistrationV4Job } from '@/lib/product-registration-v4/jobs';
import { sha256Hex } from '@/lib/product-registration-v4/document-ir';
import type { DocumentIR } from '@/lib/product-registration-v4/types';
import { getSupabaseAdmin } from '@/lib/supabase';
import { DEFAULT_PRODUCT_REGISTRATION_COMMISSION_RATE, parseUploadSourceMetadata } from '@/lib/upload-source-metadata';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ jobId: string }> | { jobId: string } };
type JsonObject = Record<string, unknown>;

async function routeJobId(context?: RouteContext): Promise<string | null> {
  const params = context?.params;
  if (!params) return null;
  const resolved = typeof (params as Promise<unknown>).then === 'function'
    ? await params as { jobId: string }
    : params as { jobId: string };
  return resolved.jobId || null;
}

function adminDb(): SupabaseClient | null {
  return getSupabaseAdmin() as SupabaseClient | null;
}

async function loadConsensus(supabase: SupabaseClient, jobId: string): Promise<JsonObject[]> {
  const { data, error } = await supabase.rpc('get_product_registration_critical_fact_consensus', {
    p_job_id: jobId,
  });
  if (error) throw error;
  return Array.isArray(data)
    ? data.filter((item): item is JsonObject => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
    : [];
}

const getHandler = async (_request: NextRequest, context?: RouteContext) => {
  const supabase = adminDb();
  if (!supabase) return NextResponse.json({ success: false, code: 'SUPABASE_ADMIN_UNAVAILABLE' }, { status: 503 });
  const jobId = await routeJobId(context);
  if (!jobId) return NextResponse.json({ success: false, code: 'JOB_ID_REQUIRED' }, { status: 400 });
  try {
    const decisions = await loadConsensus(supabase, jobId);
    return NextResponse.json({ success: true, jobId, decisions }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      code: 'CRITICAL_FACT_REVIEW_LOAD_FAILED',
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
};

const postHandler = async (request: NextRequest, context?: RouteContext) => {
  const supabase = adminDb();
  if (!supabase) return NextResponse.json({ success: false, code: 'SUPABASE_ADMIN_UNAVAILABLE' }, { status: 503 });
  const reviewerId = await resolveAdminActorId(request);
  if (!reviewerId) {
    return NextResponse.json({
      success: false,
      code: 'AUTHENTICATED_HUMAN_REVIEWER_REQUIRED',
      error: '로그인한 관리자 본인만 원문 근거를 선택할 수 있습니다.',
    }, { status: 403 });
  }
  const jobId = await routeJobId(context);
  if (!jobId) return NextResponse.json({ success: false, code: 'JOB_ID_REQUIRED' }, { status: 400 });
  const body = await request.json().catch(() => null) as JsonObject | null;
  const consensusDecisionId = typeof body?.consensusDecisionId === 'string' ? body.consensusDecisionId : '';
  const decision = body?.decision === 'reject_unresolved' ? 'reject_unresolved' : 'select_source_evidence';
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (!consensusDecisionId || reason.length < 5) {
    return NextResponse.json({ success: false, code: 'CRITICAL_FACT_REVIEW_INPUT_REQUIRED' }, { status: 400 });
  }

  try {
    const prior = await getProductRegistrationV4Job({ supabase, jobId });
    if (!prior?.source_document_id || !prior.extraction_id) {
      return NextResponse.json({ success: false, code: 'CRITICAL_FACT_SOURCE_LINEAGE_REQUIRED' }, { status: 409 });
    }
    const decisions = await loadConsensus(supabase, jobId);
    const consensus = decisions.find(item => item.id === consensusDecisionId);
    if (!consensus || !['human_required', 'provider_unavailable', 'invalid', 'disagreed'].includes(String(consensus.decision_state))) {
      return NextResponse.json({ success: false, code: 'CRITICAL_FACT_REVIEW_NOT_REQUIRED' }, { status: 409 });
    }
    const sectionIndex = Number(consensus.section_index);
    const selected = decision === 'select_source_evidence'
      ? normalizeCriticalFactProviderAnswer({ status: 'resolved', candidates: body?.selectedCandidates })
      : { status: 'unresolved' as const, candidates: [] };
    if (!selected) return NextResponse.json({ success: false, code: 'CRITICAL_FACT_SELECTION_INVALID' }, { status: 400 });

    let evidenceAnchorIds: string[] = [];
    let evidenceQuoteHashes: string[] = [];
    if (decision === 'select_source_evidence') {
      const { data: extraction, error: extractionError } = await supabase
        .from('product_document_extractions')
        .select('document_ir')
        .eq('id', prior.extraction_id)
        .eq('source_document_id', prior.source_document_id)
        .eq('tenant_id', prior.tenant_id)
        .single();
      if (extractionError || !extraction) throw extractionError ?? new Error('CRITICAL_FACT_EXTRACTION_NOT_FOUND');
      const sections = segmentDocumentIR(extraction.document_ir as DocumentIR, prior.source_document_id).sections;
      const sourceSection = sections.find(section => section.index === sectionIndex);
      if (!sourceSection) return NextResponse.json({ success: false, code: 'CRITICAL_FACT_SECTION_NOT_FOUND' }, { status: 409 });
      const anchors = buildCriticalFactEvidenceAnchors(sourceSection.rawText, sectionIndex);
      const verification = verifyCriticalPriceCandidates({ candidates: selected.candidates, anchors, sectionIndex });
      if (!verification.valid) {
        return NextResponse.json({
          success: false,
          code: 'CRITICAL_FACT_SELECTION_NOT_REPLAYABLE',
          errors: verification.errors,
        }, { status: 409 });
      }
      evidenceAnchorIds = [...new Set(selected.candidates.flatMap(candidate => candidate.evidenceAnchorIds))].sort();
      evidenceQuoteHashes = [...new Set(selected.candidates.flatMap(candidate => candidate.evidenceQuoteHashes))].sort();
    }
    const candidateHash = sha256Hex(JSON.stringify(selected.candidates));
    const decisionHash = sha256Hex(JSON.stringify({
      consensusDecisionId,
      reviewerId,
      decision,
      candidateHash,
      evidenceAnchorIds,
      evidenceQuoteHashes,
      reason,
    }));
    const { data: review, error: reviewError } = await supabase.rpc(
      'record_product_registration_critical_fact_exception_review',
      {
        p_payload: {
          tenant_id: prior.tenant_id,
          job_id: jobId,
          consensus_decision_id: consensusDecisionId,
          reviewer_id: reviewerId,
          decision,
          selected_candidate: { candidates: selected.candidates },
          evidence_anchor_ids: evidenceAnchorIds,
          evidence_quote_hashes: evidenceQuoteHashes,
          decision_hash: decisionHash,
          reason,
        },
      },
    );
    if (reviewError) throw reviewError;
    if (decision === 'reject_unresolved') {
      return NextResponse.json({ success: true, code: 'CRITICAL_FACT_REVIEW_REJECTED', review }, {
        headers: { 'Cache-Control': 'private, no-store' },
      });
    }

    const { data: source, error: sourceError } = await supabase
      .from('product_source_documents')
      .select('id,tenant_id,original_filename,metadata,status')
      .eq('id', prior.source_document_id)
      .eq('tenant_id', prior.tenant_id)
      .single();
    if (sourceError || !source) throw sourceError ?? new Error('CRITICAL_FACT_SOURCE_NOT_FOUND');
    if (source.status === 'quarantined' || source.status === 'deleted') {
      return NextResponse.json({ success: false, code: 'SOURCE_REUPLOAD_REQUIRED' }, { status: 409 });
    }
    const metadata = source.metadata && typeof source.metadata === 'object'
      ? source.metadata as JsonObject
      : {};
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? request.nextUrl.origin;
    const started = await startProductRegistrationWorkflowBySourceId({
      supabase,
      tenantId: prior.tenant_id,
      sourceDocumentId: source.id,
      requestBaseUrl: request.nextUrl.origin,
      publicBaseUrl: baseUrl,
      uploadSourceMetadata: {
        ...((metadata.uploadSourceMetadata as JsonObject | undefined)
          ?? parseUploadSourceMetadata({
            fileName: source.original_filename,
            defaultCommissionRate: DEFAULT_PRODUCT_REGISTRATION_COMMISSION_RATE,
          }) as unknown as JsonObject),
        ...(prior.v4_stage_state.sourceDepartureYearContext
          ? { sourceDepartureYearContext: prior.v4_stage_state.sourceDepartureYearContext }
          : {}),
        criticalFactHumanOverrides: [{
          sectionIndex,
          decisionId: consensusDecisionId,
          candidateHash,
          policyVersion: CRITICAL_FACT_CONSENSUS_POLICY_VERSION,
          candidates: selected.candidates,
        }],
      },
      sourceChannel: 'admin-critical-fact-review',
      forceReprocess: true,
    });
    return NextResponse.json({
      success: true,
      code: 'CRITICAL_FACT_REVIEW_REPROCESS_ACCEPTED',
      review,
      priorJobId: jobId,
      jobId: started.jobId,
      workflowRunId: started.workflowRunId,
      state: 'processing',
    }, { status: 202, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return NextResponse.json({
      success: false,
      code: 'CRITICAL_FACT_REVIEW_FAILED',
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
};

export const GET = withAdminGuard(getHandler);
export const POST = withAdminGuard(postHandler);
