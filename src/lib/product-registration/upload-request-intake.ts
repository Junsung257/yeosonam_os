import { createHash } from 'crypto';
import type { NextRequest } from 'next/server';

import { analyzeUploadInputText, normalizePastedSupplierText, type UploadInputAnalysis } from '@/lib/product-registration-input-guard';
import {
  DEFAULT_PRODUCT_REGISTRATION_COMMISSION_RATE,
  parseUploadSourceMetadata,
  type UploadSourceMetadataResult,
} from '@/lib/upload-source-metadata';
import { inferProductSourceType } from '@/lib/product-registration-v4/source-documents';
import { PRODUCT_REGISTRATION_V4_MAX_BYTES, type ProductSourceType } from '@/lib/product-registration-v4/types';
import { parseProductSourceUploadBatch, type ProductSourceUploadBatch } from './source-upload-batch';
import { productSourceLineageHash } from './source-lineage-fingerprint';
import {
  parseProductSourceDepartureYearContext,
  type ProductSourceDepartureYearContext,
} from './source-departure-year-context';

const ALLOWED_UPLOAD_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.hwp', '.hwpx', '.txt', '.md'];

export type UploadRequestIntakeResult = {
  ok: true;
  buffer: Buffer;
  fileHash: string;
  fileName: string;
  directRawText: string | null;
  originalRawText: string | null;
  parserRawText: string | null;
  documentRawText: string | null;
  declaredMime?: string | null;
  sourceType?: ProductSourceType;
  sourceDocumentId?: string | null;
  registrationJobId?: string | null;
  analysisNormalizedText: string | null;
  uploadSourceMetadata: UploadSourceMetadataResult;
  sourceBatch?: ProductSourceUploadBatch | null;
  sourceDepartureYearContext?: ProductSourceDepartureYearContext | null;
  sourceLineageHash?: string | null;
  inputAnalysisForTrust: UploadInputAnalysis | null;
  archiveMode: boolean;
  bulkMode: boolean;
  forceReprocess: boolean;
} | {
  ok: false;
  status: 400 | 413 | 415 | 422;
  payload: Record<string, unknown>;
};

export type UploadRequestIntakeSuccess = Extract<UploadRequestIntakeResult, { ok: true }>;

function hashBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function buildUploadInputQualityError(analysis: UploadInputAnalysis, sourceType: 'text' | 'file') {
  const primary = analysis.issues.find(issue => issue.severity === 'block') ?? analysis.issues[0];
  const code = primary?.code === 'encoding_corrupted'
    ? 'INPUT_ENCODING_CORRUPTED'
    : primary?.code === 'web_page_copy'
      ? 'INPUT_WEB_PAGE_COPY'
      : primary?.code === 'non_product_prompt'
        ? 'INPUT_NOT_PRODUCT_SOURCE'
        : 'INPUT_QUALITY_BLOCKED';

  return {
    success: false,
    code,
    error: primary?.message ?? 'Upload input did not pass source quality checks.',
    suggestion: sourceType === 'text'
      ? 'Paste only the original supplier product text. Remove copied UI chrome, menus, CTAs, and work instructions.'
      : 'The extracted file text is too corrupted or does not look like supplier product source text.',
    inputQuality: {
      blocked: analysis.blocked,
      needsReview: analysis.needsReview,
      issues: analysis.issues.map(issue => ({
        code: issue.code,
        severity: issue.severity,
        message: issue.message,
        evidence: issue.evidence,
      })),
      metrics: analysis.metrics,
    },
  };
}

export async function prepareUploadRequestIntake(request: NextRequest): Promise<UploadRequestIntakeResult> {
  const contentType = request.headers.get('content-type') || '';
  const urlParams = new URL(request.url).searchParams;
  const sourceDocumentId = request.headers.get('x-product-source-document-id')?.trim() || null;
  const registrationJobId = request.headers.get('x-product-registration-job-id')?.trim() || null;
  let directRawText: string | null = null;
  let originalRawText: string | null = null;
  let parserRawText: string | null = null;
  const documentRawText: string | null = null;
  let analysisNormalizedText: string | null = null;
  let textSourceLabel: string | null = null;
  let uploadSourceMetadata: UploadSourceMetadataResult | null = null;
  let file: File | null = null;
  let declaredMime: string | null = null;
  let sourceBatchInput: { id?: unknown; index?: unknown; size?: unknown } = {};
  let sourceDepartureYearInput: unknown = null;

  if (contentType.includes('application/json')) {
    const body = await request.json();
    sourceBatchInput = {
      id: body.sourceBatchId,
      index: body.sourceBatchIndex,
      size: body.sourceBatchSize,
    };
    sourceDepartureYearInput = body.sourceDepartureYear;
    originalRawText = typeof body.rawText === 'string' ? body.rawText : '';
    directRawText = originalRawText;
    declaredMime = 'text/plain';
    textSourceLabel = typeof body.sourceLabel === 'string' ? body.sourceLabel : null;
    uploadSourceMetadata = parseUploadSourceMetadata({
      rawText: originalRawText,
      sourceLabel: textSourceLabel,
      explicitLandOperator: typeof body.landOperator === 'string' ? body.landOperator : undefined,
      explicitCommissionRate: typeof body.commissionRate !== 'undefined' ? body.commissionRate : undefined,
      defaultCommissionRate: DEFAULT_PRODUCT_REGISTRATION_COMMISSION_RATE,
    });

    const invalidCommission = uploadSourceMetadata.issues.find(issue => issue.code === 'commission_rate_out_of_range');
    if (invalidCommission?.severity === 'error') {
      return {
        ok: false,
        status: 422,
        payload: {
          success: false,
          code: 'COMMISSION_RATE_OUT_OF_RANGE',
          error: invalidCommission.message,
          uploadMetadata: {
            landOperator: uploadSourceMetadata.landOperator,
            commissionRate: uploadSourceMetadata.commissionRate,
            issues: uploadSourceMetadata.issues,
          },
        },
      };
    }

    parserRawText = uploadSourceMetadata.parserRawText ?? originalRawText ?? '';
    analysisNormalizedText = normalizePastedSupplierText(parserRawText).normalizedText;
    directRawText = parserRawText;
    if (!parserRawText || parserRawText.trim().length < 50) {
      return {
        ok: false,
        status: 400,
        payload: { error: '텍스트가 너무 짧습니다. 최소 50자 이상 입력하세요.' },
      };
    }

    console.log('[Upload API] text mode:', parserRawText.length, 'chars', {
      landOperator: uploadSourceMetadata.landOperator,
      commissionRate: uploadSourceMetadata.commissionRate,
      source: uploadSourceMetadata.source,
    });
  } else {
    const formData = await request.formData();
    sourceBatchInput = {
      id: formData.get('sourceBatchId'),
      index: formData.get('sourceBatchIndex'),
      size: formData.get('sourceBatchSize'),
    };
    sourceDepartureYearInput = formData.get('sourceDepartureYear');
    file = formData.get('file') as File;
    if (!file) {
      return {
        ok: false,
        status: 400,
        payload: { error: '파일이 업로드되지 않았습니다.' },
      };
    }
    declaredMime = file.type || null;
    if (file.size > PRODUCT_REGISTRATION_V4_MAX_BYTES) {
      return {
        ok: false,
        status: 413,
        payload: { error: '파일 크기는 10MB 이하여야 합니다.' },
      };
    }
  }

  const sourceBatchResult = parseProductSourceUploadBatch(sourceBatchInput);
  if (!sourceBatchResult.ok) {
    return {
      ok: false,
      status: 422,
      payload: {
        success: false,
        code: sourceBatchResult.code,
        error: sourceBatchResult.message,
      },
    };
  }

  const sourceDepartureYearResult = parseProductSourceDepartureYearContext(sourceDepartureYearInput);
  if (!sourceDepartureYearResult.ok) {
    return {
      ok: false,
      status: 422,
      payload: {
        success: false,
        code: sourceDepartureYearResult.code,
        error: sourceDepartureYearResult.message,
      },
    };
  }

  const archiveMode = !directRawText && urlParams.get('mode') === 'archive';
  const bulkMode = urlParams.get('mode') === 'bulk';
  if (archiveMode) console.log('[Upload API] archive mode: skip AI parsing');
  if (bulkMode) console.log('[Upload API] bulk mode: skip classification/marketing/attractions');

  const fileName = file?.name || uploadSourceMetadata?.cleanSourceLabel || textSourceLabel || 'text-input.txt';
  const sourceType = inferProductSourceType(fileName, declaredMime);
  if (!sourceType) {
    return {
      ok: false,
      status: 415,
      payload: { success: false, code: 'SOURCE_TYPE_UNSUPPORTED', error: '지원하지 않는 상품 원본 형식입니다.' },
    };
  }
  if (!uploadSourceMetadata) {
    uploadSourceMetadata = parseUploadSourceMetadata({
      fileName,
      defaultCommissionRate: DEFAULT_PRODUCT_REGISTRATION_COMMISSION_RATE,
    });
  }

  let buffer: Buffer;
  let inputAnalysisForTrust: UploadInputAnalysis | null = null;
  if (directRawText) {
    const inputAnalysis = analyzeUploadInputText(originalRawText ?? directRawText);
    inputAnalysisForTrust = inputAnalysis;
    if (inputAnalysis.blocked) {
      return {
        ok: false,
        status: 422,
        payload: buildUploadInputQualityError(inputAnalysis, 'text'),
      };
    }
    if (!analysisNormalizedText) analysisNormalizedText = inputAnalysis.normalizedText;
    buffer = Buffer.from(parserRawText ?? directRawText, 'utf-8');
  } else {
    const ext = '.' + (file!.name.split('.').pop()?.toLowerCase() ?? '');
    if (!ALLOWED_UPLOAD_EXTENSIONS.includes(ext)) {
      return {
        ok: false,
        status: 415,
        payload: { error: `지원하지 않는 파일 형식입니다. (${ALLOWED_UPLOAD_EXTENSIONS.join(', ')})` },
      };
    }
    console.log('[Upload API] file info:', { name: file!.name, size: file!.size });
    buffer = Buffer.from(await file!.arrayBuffer());
  }

  const fileHash = hashBuffer(buffer);
  if (directRawText) {
    console.log('[Upload API] text mode hash:', fileHash.slice(0, 12));
  }
  const forceReprocess = urlParams.get('force') === '1' || urlParams.get('reprocess') === '1';

  return {
    ok: true,
    buffer,
    fileHash,
    fileName,
    directRawText,
    originalRawText,
    parserRawText,
    documentRawText,
    declaredMime,
    sourceType,
    sourceDocumentId,
    registrationJobId,
    analysisNormalizedText,
    uploadSourceMetadata,
    sourceBatch: sourceBatchResult.value,
    sourceDepartureYearContext: sourceDepartureYearResult.value,
    sourceLineageHash: directRawText ? productSourceLineageHash(parserRawText ?? directRawText) : null,
    inputAnalysisForTrust,
    archiveMode,
    bulkMode,
    forceReprocess,
  };
}
