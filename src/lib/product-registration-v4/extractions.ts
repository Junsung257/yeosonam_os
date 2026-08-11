import type { SupabaseClient } from '@supabase/supabase-js';

import { parseDocument } from '@/lib/parser';

import { createOcrDocumentIR, createTextDocumentIR, getDocumentIRValidationErrors, sha256Hex } from './document-ir';
import { parseHwpWithRhwpWasm } from './rhwp-wasm';
import { extractOcrWithCrossValidation } from '@/lib/product-registration-v6/ocr-providers';
import type { DocumentIR, ProductSourceType } from './types';
import { getProductRegistrationV4Job, transitionProductRegistrationV4Job } from './jobs';
import type { ProductRegistrationV4JobRecord, SourceDocumentRecord } from './types';
import { hashSourceBytes, validateSourceBytes } from './source-documents';

export type PersistedDocumentExtraction = { id: string; extractionHash: string };

export async function extractSourceDocumentToIR(input: {
  buffer: Buffer;
  filename: string;
  sourceType: ProductSourceType;
  disabledOcrProviders?: string[];
}): Promise<DocumentIR> {
  if (input.sourceType === 'hwp' || input.sourceType === 'hwpx') {
    return (await parseHwpWithRhwpWasm({
      buffer: input.buffer,
      filename: input.filename,
      sourceType: input.sourceType,
    })).ir;
  }

  if (input.sourceType === 'text') {
    const text = input.buffer.toString('utf8').replace(/^\uFEFF/, '').trim();
    if (text.length < 10) throw new Error('SOURCE_TEXT_TOO_SHORT');
    return createTextDocumentIR({
      filename: input.filename,
      sourceType: input.sourceType,
      text,
      parserEngine: 'text-utf8',
      parserVersion: '1',
    });
  }

  if (input.sourceType === 'pdf') {
    try {
      const parsed = await parseDocument(input.buffer, input.filename);
      const normalized = parsed.rawText.trim();
      const replacementRatio = normalized.length > 0 ? (normalized.match(/�/g)?.length ?? 0) / normalized.length : 1;
      if (normalized.length >= 100 && replacementRatio < 0.02) {
        return createTextDocumentIR({
          filename: input.filename,
          sourceType: input.sourceType,
          text: normalized,
          parserEngine: 'pdf-parse',
          parserVersion: 'existing',
        });
      }
    } catch (error) {
      if (process.env.PRODUCT_REGISTRATION_V6_OCR_ENABLED !== '1') throw error;
    }
    if ((input.disabledOcrProviders ?? []).length > 0) throw new Error('OCR_PROVIDER_KILL_SWITCH_ACTIVE');
    const ocr = await extractOcrWithCrossValidation({
      buffer: input.buffer,
      filename: input.filename,
      mime: 'application/pdf',
    });
    return createOcrDocumentIR({
      filename: input.filename,
      sourceType: input.sourceType,
      text: ocr.text,
      parserEngine: ocr.parserEngine,
      parserVersion: ocr.parserVersion,
      pages: ocr.pages,
      providerResults: ocr.providerResults,
      totalCostKrw: ocr.totalCostKrw,
    });
  }

  if (input.sourceType === 'image') {
    if ((input.disabledOcrProviders ?? []).length > 0) throw new Error('OCR_PROVIDER_KILL_SWITCH_ACTIVE');
    const mime = input.filename.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
    const ocr = await extractOcrWithCrossValidation({ buffer: input.buffer, filename: input.filename, mime });
    return createOcrDocumentIR({
      filename: input.filename,
      sourceType: input.sourceType,
      text: ocr.text,
      parserEngine: ocr.parserEngine,
      parserVersion: ocr.parserVersion,
      pages: ocr.pages,
      providerResults: ocr.providerResults,
      totalCostKrw: ocr.totalCostKrw,
    });
  }

  throw new Error('SOURCE_IMAGE_REQUIRES_OCR_PROFILE');
}

export async function persistDocumentExtraction(input: {
  supabase: SupabaseClient;
  sourceDocumentId: string;
  tenantId: string;
  documentIr: DocumentIR;
  qualityDiagnostics?: Record<string, unknown>;
}): Promise<PersistedDocumentExtraction> {
  const validationErrors = getDocumentIRValidationErrors(input.documentIr);
  if (validationErrors.length > 0) {
    throw new Error(`DOCUMENT_IR_INVALID:${validationErrors.join(',')}`);
  }
  const extractionHash = sha256Hex(JSON.stringify(input.documentIr));
  const { data, error } = await input.supabase
    .from('product_document_extractions')
    .upsert({
      tenant_id: input.tenantId,
      source_document_id: input.sourceDocumentId,
      parser_engine: input.documentIr.parser.engine,
      parser_version: input.documentIr.parser.version,
      parser_checksum: input.documentIr.parser.checksum ?? null,
      extraction_hash: extractionHash,
      document_ir: input.documentIr,
      quality_diagnostics: input.qualityDiagnostics ?? {},
      status: 'complete',
    }, { onConflict: 'source_document_id,parser_engine,parser_version,extraction_hash' })
    .select('id, extraction_hash')
    .single();
  if (error) throw error;

  await input.supabase
    .from('product_source_documents')
    .update({ status: 'ready', updated_at: new Date().toISOString() })
    .eq('id', input.sourceDocumentId);

  // The legacy sidecars may be persisted before the V4 cron extracts the
  // source. Attach the extraction later without changing their raw hashes.
  await Promise.all([
    input.supabase.from('normalized_intakes')
      .update({ extraction_id: data?.id ?? null })
      .eq('source_document_id', input.sourceDocumentId)
      .is('extraction_id', null),
    input.supabase.from('product_registration_drafts')
      .update({ extraction_id: data?.id ?? null })
      .eq('source_document_id', input.sourceDocumentId)
      .is('extraction_id', null),
  ]);

  return {
    id: String((data as { id?: unknown }).id),
    extractionHash: String((data as { extraction_hash?: unknown }).extraction_hash ?? extractionHash),
  };
}

export async function processProductRegistrationV4ExtractionJob(input: {
  supabase: SupabaseClient;
  jobId: string;
}): Promise<{ job: unknown; extraction: PersistedDocumentExtraction; documentIr: DocumentIR }> {
  const job = await getProductRegistrationV4Job({ supabase: input.supabase, jobId: input.jobId });
  if (!job) throw new Error('JOB_NOT_FOUND');
  if (!job.source_document_id) throw new Error('SOURCE_DOCUMENT_REQUIRED');

  try {
    const { data: source, error: sourceError } = await input.supabase
      .from('product_source_documents')
      .select('*')
      .eq('id', job.source_document_id)
      .eq('tenant_id', job.tenant_id)
      .single();
    if (sourceError) throw sourceError;
    const sourceDocument = source as SourceDocumentRecord;

    const extractionOwnedStages = new Set(['uploaded', 'preflight', 'extracted']);
    await transitionProductRegistrationV4Job({
      supabase: input.supabase,
      jobId: input.jobId,
      stage: extractionOwnedStages.has(job.v4_stage) ? 'preflight' : job.v4_stage,
      status: 'processing',
      state: { sourceDocumentId: sourceDocument.id, extractionBackfill: !extractionOwnedStages.has(job.v4_stage) },
    });
    const download = await input.supabase.storage
      .from(sourceDocument.storage_bucket)
      .download(sourceDocument.storage_path);
    if (download.error || !download.data) throw download.error ?? new Error('SOURCE_DOWNLOAD_EMPTY');
    const buffer = Buffer.from(await download.data.arrayBuffer());
    if (hashSourceBytes(buffer) !== sourceDocument.sha256) {
      await input.supabase
        .from('product_source_documents')
        .update({ status: 'quarantined', updated_at: new Date().toISOString() })
        .eq('id', sourceDocument.id);
      throw new Error('SOURCE_HASH_MISMATCH:stored source bytes do not match the recorded SHA-256');
    }
    const signatureErrors = validateSourceBytes({ sourceType: sourceDocument.source_type, buffer });
    if (signatureErrors.length > 0) {
      await input.supabase
        .from('product_source_documents')
        .update({ status: 'quarantined', updated_at: new Date().toISOString() })
        .eq('id', sourceDocument.id);
      throw new Error(`SOURCE_SIGNATURE_MISMATCH:${signatureErrors.join(',')}`);
    }
    const { data: ocrSwitches, error: ocrSwitchError } = await input.supabase
      .from('product_registration_v5_kill_switches')
      .select('scope_key')
      .eq('scope', 'ocr_provider')
      .eq('active', true)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
    if (ocrSwitchError) throw ocrSwitchError;
    const disabledOcrProviders = (ocrSwitches ?? []).map(row => String(row.scope_key));
    const ir = await extractSourceDocumentToIR({
      buffer,
      filename: sourceDocument.original_filename,
      sourceType: sourceDocument.source_type,
      disabledOcrProviders,
    });
    const extraction = await persistDocumentExtraction({
      supabase: input.supabase,
      sourceDocumentId: sourceDocument.id,
      tenantId: job.tenant_id,
      documentIr: ir,
      qualityDiagnostics: { pages: ir.pages, nodes: ir.nodes.length, tables: ir.tables.length, chars: ir.text.length },
    });
    const ocrAsset = ir.assets.find(asset => asset.id === 'ocr-provider-run');
    const ocrMetadata = ocrAsset?.metadata && typeof ocrAsset.metadata === 'object' ? ocrAsset.metadata : null;
    const providerResults = Array.isArray(ocrMetadata?.providerResults) ? ocrMetadata.providerResults : [];
    for (const rawResult of providerResults) {
      if (!rawResult || typeof rawResult !== 'object' || Array.isArray(rawResult)) continue;
      const providerResult = rawResult as Record<string, unknown>;
      const provider = String(providerResult.provider ?? 'unknown');
      const responseHash = sha256Hex(JSON.stringify(providerResult));
      const { data: providerCall, error: providerCallError } = await input.supabase.rpc('record_product_registration_v6_provider_call', {
        p_payload: {
          tenant_id: sourceDocument.tenant_id,
          job_id: job.id,
          product_revision_id: null,
          provider,
          operation: 'ocr_extract',
          operation_key: `${sourceDocument.sha256}:ocr:${provider}:${ir.parser.version}`,
          request_hash: sha256Hex(`${sourceDocument.sha256}:${provider}:${ir.parser.version}`),
          response_hash: responseHash,
          status: 'succeeded',
          billed_units: ir.pages,
          cost_krw: Number(providerResult.costKrw ?? 0),
          source_hash: sourceDocument.sha256,
          revision_hash: null,
          result: providerResult,
        },
      });
      if (providerCallError) throw providerCallError;
      if (!Boolean((providerCall as { inserted?: unknown } | null)?.inserted)) {
        providerResult.costKrw = 0;
      }
    }
    const ocrCost = providerResults.reduce((sum, item) => {
      const row = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {};
      return sum + Number(row.costKrw ?? 0);
    }, 0);
    if (ocrCost > 0 && Number(job.v6_fencing_token ?? 0) > 0) {
      const { error: costError } = await input.supabase.rpc('add_product_registration_v6_external_cost', {
        p_job_id: job.id,
        p_expected_fencing_token: Number(job.v6_fencing_token),
        p_cost_krw: ocrCost,
      });
      if (costError) throw costError;
    }
    const extractionState = {
      extractionHash: extraction.extractionHash,
      pages: ir.pages,
      nodes: ir.nodes.length,
      tables: ir.tables.length,
      chars: ir.text.length,
    };
    const latestJob = await getProductRegistrationV4Job({ supabase: input.supabase, jobId: input.jobId });
    if (!latestJob) throw new Error('JOB_NOT_FOUND_AFTER_EXTRACTION');

    // The compatibility upload path may finish normalization while this
    // worker is still parsing. Never rewind a later V4 stage back to
    // `extracted`; attach the extraction lineage in place instead.
    const extractionStages = new Set(['uploaded', 'preflight', 'extracted']);
    let updatedJob: ProductRegistrationV4JobRecord;
    if (extractionStages.has(latestJob.v4_stage)) {
      updatedJob = await transitionProductRegistrationV4Job({
        supabase: input.supabase,
        jobId: input.jobId,
        stage: 'extracted',
        status: 'queued',
        extractionId: extraction.id,
        clearLease: true,
        state: { ...(latestJob.v4_stage_state ?? {}), ...extractionState },
      });
    } else {
      const { data, error } = await input.supabase
        .from('upload_jobs')
        .update({
          extraction_id: extraction.id,
          v4_stage_state: { ...(latestJob.v4_stage_state ?? {}), ...extractionState },
          v4_lease_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', input.jobId)
        .select('*')
        .single();
      if (error) throw error;
      updatedJob = data as ProductRegistrationV4JobRecord;
    }
    return { job: updatedJob, extraction, documentIr: ir };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await transitionProductRegistrationV4Job({
      supabase: input.supabase,
      jobId: input.jobId,
      stage: /SOURCE_(HASH|SIGNATURE)_MISMATCH/.test(message)
        ? 'quarantined'
        : message.includes('OCR_PROFILE_DISABLED')
          ? 'needs_review'
          : message.includes('QUARANTINE')
            ? 'quarantined'
            : ['segmented', 'normalized', 'verified', 'proofed'].includes(job.v4_stage)
              ? 'needs_review'
              : 'failed',
      status: 'failed',
      errorCode: message.split(':')[0] || 'EXTRACTION_FAILED',
      errorDetail: message,
      reviewReasons: [message.split(':')[0] || 'EXTRACTION_FAILED'],
    }).catch(() => undefined);
    throw error;
  }
}
