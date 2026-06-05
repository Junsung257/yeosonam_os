import type { SupabaseClient } from '@supabase/supabase-js';

import type { MultiProductResult } from '@/lib/parser';
import { shouldSampleToIrCanary } from '@/lib/ir-canary';
import { canUseSupplierRawDeterministicPreflight } from '@/lib/supplier-raw-deterministic-facts';
import { tryExtractUploadViaIr } from '@/lib/upload-ir-extract';
import type { AlertInput } from '@/lib/admin-alerts';

import {
  resolveDepartingLocationId,
  type UploadDepartingLocationRow,
} from './upload-supplier-context';

type ParsedDocumentForUploadNormalizer = {
  rawText: string;
  multiProducts?: MultiProductResult[];
  extractedData: Record<string, any>;
  itineraryData?: unknown;
  confidence: number;
};

export type UploadRawNormalizerResult<TDocument extends ParsedDocumentForUploadNormalizer> = {
  parsedDocument: TDocument;
  departingLocationId: string | null;
  irCanaryPrimary: boolean;
  rawNormalizerFailedReason: string | null;
  landOperatorName: string;
  deterministicPreflightUsed: boolean;
};

export async function applyUploadRawNormalizer<TDocument extends ParsedDocumentForUploadNormalizer>(input: {
  parsedDocument: TDocument;
  normalizedCatalogHash: string;
  isStructuredMarkdownUpload: boolean;
  isSupabaseConfigured: boolean;
  landOperatorName: string;
  marginRate: number;
  supabase: SupabaseClient;
  filename: string;
  filenameCleanName: string;
  departingLocations: UploadDepartingLocationRow[];
  postAlert: (row: AlertInput) => Promise<unknown> | unknown;
}): Promise<UploadRawNormalizerResult<TDocument>> {
  let departingLocationId = resolveDepartingLocationId(
    input.parsedDocument.extractedData.departure_airport ?? input.filenameCleanName,
    input.departingLocations,
  );
  let irCanaryPrimary = false;
  let rawNormalizerFailedReason: string | null = null;

  const deterministicPreflightUsed =
    !input.isStructuredMarkdownUpload
    && canUseSupplierRawDeterministicPreflight(input.parsedDocument.rawText ?? '');
  const rawUploadNormalizerEnabled = process.env.RAW_UPLOAD_NORMALIZER_ENABLED !== '0';
  const shouldRunRawUploadNormalizer =
    !input.isStructuredMarkdownUpload
    && input.isSupabaseConfigured
    && Boolean(input.landOperatorName)
    && !deterministicPreflightUsed
    && !input.parsedDocument.multiProducts?.length
    && (
      rawUploadNormalizerEnabled
      || shouldSampleToIrCanary(input.normalizedCatalogHash)
    );

  if (deterministicPreflightUsed) {
    console.log('[Upload API] raw deterministic preflight passed; skipping LLM normalizer');
  }

  if (shouldRunRawUploadNormalizer) {
    const irExtract = await tryExtractUploadViaIr({
      rawText: input.parsedDocument.rawText ?? '',
      landOperator: input.landOperatorName,
      commissionRate: input.marginRate * 100,
      sb: input.supabase,
      filename: input.filename,
    });

    if (irExtract.ok) {
      input.parsedDocument.multiProducts = irExtract.products;
      input.parsedDocument.extractedData = irExtract.products[0].extractedData as Record<string, any>;
      input.parsedDocument.itineraryData = irExtract.products[0].itineraryData;
      input.parsedDocument.confidence = irExtract.confidence;
      departingLocationId = resolveDepartingLocationId(
        input.parsedDocument.extractedData.departure_airport ?? input.filenameCleanName,
        input.departingLocations,
      );
      irCanaryPrimary = true;
      console.log(
        '[Upload API] raw upload normalizer primary extraction:',
        irExtract.engine,
        'products=',
        irExtract.products.length,
        'confidence=',
        irExtract.confidence,
      );
    } else {
      console.warn(
        '[Upload API] raw upload normalizer failed; keeping parseDocument fallback:',
        irExtract.errors?.slice(0, 2).join('; '),
      );
      rawNormalizerFailedReason = irExtract.errors?.slice(0, 3).join('; ') || 'unknown normalizer failure';
      void input.postAlert({
        category: 'general',
        severity: 'warning',
        title: 'Supplier raw normalizer failed',
        message: rawNormalizerFailedReason,
        ref_type: 'upload',
        ref_id: input.normalizedCatalogHash.slice(0, 16),
        meta: {
          filename: input.filename,
          landOperator: input.landOperatorName,
          normalizedCatalogHash: input.normalizedCatalogHash,
        },
        dedupe: true,
      });
    }
  }

  return {
    parsedDocument: input.parsedDocument,
    departingLocationId,
    irCanaryPrimary,
    rawNormalizerFailedReason,
    landOperatorName: input.landOperatorName,
    deterministicPreflightUsed,
  };
}
