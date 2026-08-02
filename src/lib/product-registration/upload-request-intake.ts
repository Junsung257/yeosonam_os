import { createHash } from 'crypto';
import type { NextRequest } from 'next/server';

import { analyzeUploadInputText, normalizePastedSupplierText, type UploadInputAnalysis } from '@/lib/product-registration-input-guard';
import { resolveVerifiedCommercialContract } from '@/lib/product-registration/commercial-contract-resolver';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import {
  applyVerifiedUploadCommercialContract,
  DEFAULT_LAND_OPERATOR_COMMISSION_RATE,
  parseUploadSourceMetadata,
  type UploadSourceMetadataResult,
} from '@/lib/upload-source-metadata';

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
  analysisNormalizedText: string | null;
  uploadSourceMetadata: UploadSourceMetadataResult;
  inputAnalysisForTrust: UploadInputAnalysis | null;
  archiveMode: boolean;
  bulkMode: boolean;
  forceReprocess: boolean;
} | {
  ok: false;
  status: 400 | 422;
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

function buildUploadCommercialMetadataError(metadata: UploadSourceMetadataResult) {
  const issue = metadata.issues.find(candidate => candidate.severity === 'error');
  if (!issue) return null;

  const code = issue.code === 'commission_rate_out_of_range'
    ? 'COMMISSION_RATE_OUT_OF_RANGE'
    : issue.code === 'commission_rate_invalid'
      ? 'COMMISSION_RATE_INVALID'
    : issue.code === 'commercial_contract_ambiguous'
      ? 'COMMERCIAL_CONTRACT_AMBIGUOUS'
    : issue.code === 'commission_rate_required'
      ? 'COMMISSION_RATE_REQUIRED'
      : issue.code === 'land_operator_required'
        ? 'LAND_OPERATOR_REQUIRED'
        : 'UPLOAD_COMMERCIAL_METADATA_REQUIRED';

  return {
    success: false,
    code,
    error: issue.message,
    suggestion: '실제 랜드사명과 계약 커미션율을 입력하거나 파일명을 [랜드사_커미션%]상품명 형식으로 작성하세요.',
    uploadMetadata: {
      landOperator: metadata.landOperator ?? null,
      commissionRate: metadata.commissionRate,
      commissionRateWasDefaulted: metadata.commissionRateWasDefaulted,
      source: metadata.source,
      issues: metadata.issues,
    },
  };
}

async function resolveCommercialMetadata(input: {
  metadata: UploadSourceMetadataResult;
  fileName?: string | null;
  sourceLabel?: string | null;
  rawText?: string | null;
}): Promise<UploadSourceMetadataResult> {
  const missingCommercialMetadata = input.metadata.commissionRateWasDefaulted
    || input.metadata.issues.some(issue =>
      issue.code === 'land_operator_required' || issue.code === 'commission_rate_required'
    );
  const hasOtherBlockingError = input.metadata.issues.some(issue =>
    issue.severity === 'error'
    && issue.code !== 'land_operator_required'
    && issue.code !== 'commission_rate_required'
  );
  if (!missingCommercialMetadata || hasOtherBlockingError || !isSupabaseConfigured) {
    return input.metadata;
  }

  const resolution = await resolveVerifiedCommercialContract({
    supabase: supabaseAdmin,
    source: {
      fileName: input.fileName,
      sourceLabel: input.sourceLabel,
      rawText: input.rawText,
    },
  });
  if (resolution.status === 'resolved') {
    return applyVerifiedUploadCommercialContract(input.metadata, {
      contractId: resolution.contractId,
      landOperator: resolution.landOperator,
      commissionRate: resolution.commissionRate,
      evidence: resolution.evidence,
    });
  }
  if (resolution.status === 'ambiguous') {
    return {
      ...input.metadata,
      issues: [
        ...input.metadata.issues,
        {
          code: 'commercial_contract_ambiguous',
          message: '둘 이상의 유효한 계약이 같은 우선순위로 일치합니다. 계약 원장의 표식 또는 우선순위를 정리해 주세요.',
          severity: 'error',
        },
      ],
    };
  }
  return input.metadata;
}

export async function prepareUploadRequestIntake(request: NextRequest): Promise<UploadRequestIntakeResult> {
  const contentType = request.headers.get('content-type') || '';
  const urlParams = new URL(request.url).searchParams;
  let directRawText: string | null = null;
  let originalRawText: string | null = null;
  let parserRawText: string | null = null;
  const documentRawText: string | null = null;
  let analysisNormalizedText: string | null = null;
  let textSourceLabel: string | null = null;
  let uploadSourceMetadata: UploadSourceMetadataResult | null = null;
  let file: File | null = null;

  if (contentType.includes('application/json')) {
    const body = await request.json();
    originalRawText = typeof body.rawText === 'string' ? body.rawText : '';
    directRawText = originalRawText;
    textSourceLabel = typeof body.sourceLabel === 'string' ? body.sourceLabel : null;
    uploadSourceMetadata = await resolveCommercialMetadata({
      metadata: parseUploadSourceMetadata({
      rawText: originalRawText,
      sourceLabel: textSourceLabel,
      explicitLandOperator: typeof body.landOperator === 'string' ? body.landOperator : undefined,
      explicitCommissionRate: typeof body.commissionRate !== 'undefined' ? body.commissionRate : undefined,
      defaultCommissionRate: DEFAULT_LAND_OPERATOR_COMMISSION_RATE,
      }),
      rawText: originalRawText,
      sourceLabel: textSourceLabel,
    });

    const metadataError = buildUploadCommercialMetadataError(uploadSourceMetadata);
    if (metadataError) {
      return {
        ok: false,
        status: 422,
        payload: metadataError,
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
    file = formData.get('file') as File;
    if (!file) {
      return {
        ok: false,
        status: 400,
        payload: { error: '파일이 업로드되지 않았습니다.' },
      };
    }
    if (file.size > 10 * 1024 * 1024) {
      return {
        ok: false,
        status: 400,
        payload: { error: '파일 크기는 10MB 이하여야 합니다.' },
      };
    }
    const explicitLandOperator = formData.get('landOperator');
    const explicitCommissionRate = formData.get('commissionRate');
    uploadSourceMetadata = await resolveCommercialMetadata({
      metadata: parseUploadSourceMetadata({
        fileName: file.name,
        explicitLandOperator: typeof explicitLandOperator === 'string' ? explicitLandOperator : undefined,
        explicitCommissionRate: typeof explicitCommissionRate === 'string' ? explicitCommissionRate : undefined,
        defaultCommissionRate: DEFAULT_LAND_OPERATOR_COMMISSION_RATE,
      }),
      fileName: file.name,
    });
    const metadataError = buildUploadCommercialMetadataError(uploadSourceMetadata);
    if (metadataError) {
      return {
        ok: false,
        status: 422,
        payload: metadataError,
      };
    }
  }

  const archiveMode = !directRawText && urlParams.get('mode') === 'archive';
  const bulkMode = urlParams.get('mode') === 'bulk';
  if (archiveMode) console.log('[Upload API] archive mode: skip AI parsing');
  if (bulkMode) console.log('[Upload API] bulk mode: skip classification/marketing/attractions');

  const fileName = file?.name || uploadSourceMetadata?.cleanSourceLabel || textSourceLabel || 'text-input.txt';
  if (!uploadSourceMetadata) {
    uploadSourceMetadata = await resolveCommercialMetadata({
      metadata: parseUploadSourceMetadata({
        fileName,
        defaultCommissionRate: DEFAULT_LAND_OPERATOR_COMMISSION_RATE,
      }),
      fileName,
    });
    const metadataError = buildUploadCommercialMetadataError(uploadSourceMetadata);
    if (metadataError) {
      return {
        ok: false,
        status: 422,
        payload: metadataError,
      };
    }
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
        status: 400,
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
    analysisNormalizedText,
    uploadSourceMetadata,
    inputAnalysisForTrust,
    archiveMode,
    bulkMode,
    forceReprocess,
  };
}
