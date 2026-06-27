import type { MultiProductResult } from '@/lib/parser';
import { countCatalogItineraryHeaders } from '@/lib/parser/catalog-pre-split';
import { isStandardProductMarkdown } from '@/lib/standard-product-markdown';
import { planProductRegistrationV2, runProductRegistrationV2 } from '@/lib/product-registration-v2';
import {
  createSourceLineIndex,
  planProductRegistrationV3,
  runProductRegistrationV3,
  type V3PipelineResult,
} from '@/lib/product-registration-v3';
import type { AttractionData } from '@/lib/attraction-matcher';

export type UploadParsedDocumentLike = {
  rawText?: string | null;
  fileType?: string | null;
  extractedData: MultiProductResult['extractedData'];
  itineraryData?: MultiProductResult['itineraryData'] | null;
  multiProducts?: MultiProductResult[] | null;
  confidence?: number;
};

export type UploadV2PreflightResult = {
  applied: boolean;
  gateFailures: string[];
};

export async function applyUploadV2Preflight(
  parsedDocument: UploadParsedDocumentLike,
): Promise<UploadV2PreflightResult> {
  const rawText = parsedDocument.rawText ?? '';
  if (
    process.env.PRODUCT_REGISTRATION_V2_ENABLED === '0'
    || isStandardProductMarkdown(rawText)
    || rawText.trim().length < 1000
  ) {
    return { applied: false, gateFailures: [] };
  }

  const v2Plan = planProductRegistrationV2(rawText);
  const shouldUseV2 =
    v2Plan.document_type === 'multi_variant_catalog'
    && v2Plan.price_mapping_strategy === 'vertical_grade_columns'
    && v2Plan.expected_products >= 2
    && v2Plan.unresolved_parts.length === 0;
  if (!shouldUseV2) return { applied: false, gateFailures: [] };

  try {
    const v2 = await runProductRegistrationV2(rawText);
    if (v2.gate.customer_publishable && v2.products.length === v2.plan.expected_products) {
      const v2MultiProducts: MultiProductResult[] = v2.products.map(product => ({
        extractedData: {
          ...product.extractedData,
          parser_version: 'product-registration-v2',
          _v2_gate_status: v2.gate.status,
        } as MultiProductResult['extractedData'],
        itineraryData: product.itineraryData as unknown as MultiProductResult['itineraryData'],
        sectionRawText: product.section_raw_text,
      }));
      parsedDocument.multiProducts = v2MultiProducts;
      parsedDocument.extractedData = v2MultiProducts[0].extractedData;
      parsedDocument.itineraryData = v2MultiProducts[0].itineraryData;
      parsedDocument.confidence = Math.min(parsedDocument.confidence || 1, v2.plan.confidence);
      return { applied: true, gateFailures: [] };
    }

    const gateFailures = v2.gate.checks
      .filter(check => check.status === 'fail')
      .map(check => check.message);
    return {
      applied: false,
      gateFailures: gateFailures.length > 0 ? gateFailures : [`V2 gate=${v2.gate.status}`],
    };
  } catch (error) {
    return {
      applied: false,
      gateFailures: [`Product Registration V2 exception: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

export type CatalogSplitFallbackWarning = {
  headerCount: number;
  processedCount: number;
};

export function detectCatalogSplitFallback(input: {
  rawText?: string | null;
  hasMultiProducts: boolean;
}): CatalogSplitFallbackWarning | null {
  if (input.hasMultiProducts) return null;
  const headerCount = countCatalogItineraryHeaders(input.rawText ?? '');
  if (headerCount < 2) return null;
  return { headerCount, processedCount: 1 };
}

export type UploadV3CatalogPreflightResult = {
  preSaveV3Result: V3PipelineResult;
  expectedProductCount: number;
  actualProductCount: number;
  productCountMismatch: boolean;
};

export async function runUploadV3CatalogPreflight(input: {
  rawText?: string | null;
  fileType?: string | null;
  productsToSave: MultiProductResult[];
  activeAttractions: AttractionData[];
}): Promise<UploadV3CatalogPreflightResult> {
  const rawText = input.rawText ?? '';
  const structurePlan = planProductRegistrationV3(createSourceLineIndex(rawText));
  const preSaveV3Result = await runProductRegistrationV3(rawText, {
    attractions: input.activeAttractions,
    sourceType: input.fileType ?? undefined,
  });
  const expectedProductCount = structurePlan.expected_products;
  const actualProductCount = input.productsToSave.length;
  return {
    preSaveV3Result,
    expectedProductCount,
    actualProductCount,
    productCountMismatch: preSaveV3Result.gate_result.status !== 'blocked'
      && expectedProductCount >= 2
      && actualProductCount !== expectedProductCount,
  };
}
