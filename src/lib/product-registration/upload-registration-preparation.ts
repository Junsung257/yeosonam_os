import { randomUUID } from 'crypto';

import type { AlertInput } from '@/lib/admin-alerts';
import type { AttractionData } from '@/lib/attraction-matcher';
import type { MultiProductResult, ParsedDocument } from '@/lib/parser';
import { safeRawTextExcerpt } from '@/lib/raw-text-privacy';
import { recoverCatalogSplitFromRawText } from './catalog-split-recovery';
import {
  detectCatalogSplitFallback,
  runUploadV3CatalogPreflight,
  type UploadV3CatalogPreflightResult,
} from './upload-preflight';

type PostAlert = (input: AlertInput) => Promise<unknown> | unknown;

export type UploadRegistrationPreparationResult = {
  ok: true;
  productsToSave: MultiProductResult[];
  catalogGroupId: string | null;
  preSaveV3Result: UploadV3CatalogPreflightResult['preSaveV3Result'];
} | {
  ok: false;
  status: 422;
  payload: Record<string, unknown>;
};

function buildProductsToSave(parsedDocument: ParsedDocument): MultiProductResult[] {
  const recoveredProducts = recoverCatalogSplitFromRawText(parsedDocument.rawText);

  if (parsedDocument.multiProducts && parsedDocument.multiProducts.length >= 2) {
    if (recoveredProducts.length === parsedDocument.multiProducts.length) {
      parsedDocument.multiProducts = parsedDocument.multiProducts.map((product, index) => {
        const recovered = recoveredProducts[index];
        return {
          ...product,
          sectionRawText: recovered.sectionRawText ?? product.sectionRawText,
          extractedData: {
            ...product.extractedData,
            title: recovered.extractedData.title ?? product.extractedData.title,
            rawText: recovered.sectionRawText ?? product.extractedData.rawText,
            destination: product.extractedData.destination ?? recovered.extractedData.destination,
            duration: product.extractedData.duration ?? recovered.extractedData.duration,
            nights: product.extractedData.nights ?? recovered.extractedData.nights,
            trip_style: product.extractedData.trip_style ?? recovered.extractedData.trip_style,
          },
        };
      });
    }
    return parsedDocument.multiProducts;
  }

  if (recoveredProducts.length >= 2) {
    console.warn(`[Upload API] recovered catalog split from raw text: ${recoveredProducts.length} products`);
    parsedDocument.multiProducts = recoveredProducts;
    parsedDocument.extractedData = recoveredProducts[0].extractedData;
    parsedDocument.itineraryData = recoveredProducts[0].itineraryData ?? null;
    return recoveredProducts;
  }

  return parsedDocument.multiProducts ?? [
    { extractedData: parsedDocument.extractedData, itineraryData: parsedDocument.itineraryData ?? null },
  ];
}

export async function prepareUploadRegistrationProducts(input: {
  parsedDocument: ParsedDocument;
  activeAttractions: AttractionData[];
  fileName: string;
  isSupabaseConfigured: boolean;
  postAlert: PostAlert;
}): Promise<UploadRegistrationPreparationResult> {
  const productsToSave = buildProductsToSave(input.parsedDocument);
  const catalogGroupId = productsToSave.length >= 2 ? randomUUID() : null;
  if (catalogGroupId) {
    console.log(`[Upload API] catalog_id group prepared: ${catalogGroupId.slice(0, 8)} (${productsToSave.length} sub-packages)`);
  }

  const catalogSplitWarning = detectCatalogSplitFallback({
    rawText: input.parsedDocument.rawText,
    hasMultiProducts: productsToSave.length >= 2,
  });
  if (catalogSplitWarning) {
    const rawExcerpt = safeRawTextExcerpt(input.parsedDocument.rawText) ?? '';
    console.warn(`[Upload API] catalog split fallback blocked: headers=${catalogSplitWarning.headerCount}, processed=1`);
    if (input.isSupabaseConfigured) {
      void input.postAlert({
        category: 'catalog-split-fallback',
        severity: 'warning',
        title: `Catalog split failed: ${catalogSplitWarning.headerCount} headers processed as 1 product`,
        message: `${input.fileName ?? 'direct-text'}: ${catalogSplitWarning.headerCount} product headers detected but parser produced 1 product. Manual review is required before customer delivery.`,
        ref_type: 'upload',
        meta: { headerCount: catalogSplitWarning.headerCount, fileName: input.fileName, raw_excerpt: rawExcerpt },
      });
    }
    return {
      ok: false,
      status: 422,
      payload: {
        success: false,
        code: 'CATALOG_SPLIT_REQUIRED',
        error: '다중 상품 원문으로 감지됐지만 1개 상품으로만 분리되었습니다. 고객용 모바일 랜딩/A4 생성 전에 상품별 분리를 먼저 완료해야 합니다.',
        details: { ...catalogSplitWarning, raw_excerpt: rawExcerpt },
      },
    };
  }

  const v3CatalogPreflight = await runUploadV3CatalogPreflight({
    rawText: input.parsedDocument.rawText,
    fileType: input.parsedDocument.fileType,
    productsToSave,
    activeAttractions: input.activeAttractions,
  });
  const preSaveV3Result = v3CatalogPreflight.preSaveV3Result;
  if (v3CatalogPreflight.productCountMismatch) {
    return {
      ok: false,
      status: 422,
      payload: {
        success: false,
        code: 'PRODUCT_COUNT_MISMATCH',
        error: 'V3 expected product count does not match parsed product count. Review product splitting before saving.',
        expectedProductCount: v3CatalogPreflight.expectedProductCount,
        actualProductCount: v3CatalogPreflight.actualProductCount,
        v3Gate: preSaveV3Result.gate_result,
      },
    };
  }

  return {
    ok: true,
    productsToSave,
    catalogGroupId,
    preSaveV3Result,
  };
}
