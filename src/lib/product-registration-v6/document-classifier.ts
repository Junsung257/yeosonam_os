import { analyzeUploadInputText } from '@/lib/product-registration-input-guard';
import type { DocumentIR, ProductSourceType } from '@/lib/product-registration-v4/types';

export type ProductSourceDocumentClass =
  | 'travel_product'
  | 'non_travel'
  | 'unsupported'
  | 'corrupt';

export type ProductSourceDocumentClassification = {
  documentClass: ProductSourceDocumentClass;
  reasonCode:
    | 'TRAVEL_PRODUCT_DOCUMENT'
    | 'NOT_TRAVEL_PRODUCT_DOCUMENT'
    | 'UNSUPPORTED_DOCUMENT_COHORT'
    | 'CORRUPT_SOURCE_DOCUMENT';
  confidence: number;
  evidence: string[];
  metrics: {
    characterCount: number;
    productAnchorScore: number;
    travelDomainScore: number;
    commercialScore: number;
    replacementRatio: number;
  };
};

const TRAVEL_DOMAIN_PATTERNS: Array<[RegExp, string]> = [
  [/(?:항공|출발편|귀국편|편명|[A-Z][A-Z0-9]\s*\d{2,4}|인천|김포|김해|부산|공항)/iu, 'transport'],
  [/(?:호텔|리조트|숙박|조식|중식|석식|가이드|전용\s*차량)/u, 'travel-components'],
  [/(?:DAY\s*\d+|\d+\s*일차|\d+\s*박\s*\d+\s*일)/iu, 'itinerary'],
  [/(?:골프|라운드|티오프|그린피|캐디|카트|관광|선택관광|쇼핑)/u, 'activity'],
];

const COMMERCIAL_PATTERNS: Array<[RegExp, string]> = [
  [/(?:성인|아동|소아|판매가|상품가|요금|가격)\s*[:：]?\s*(?:₩|￦|KRW|USD|\$)?\s*\d/iu, 'price'],
  [/(?:₩|￦|KRW|USD|\$)\s*\d|\d{1,3}(?:,\d{3})+\s*(?:원|달러)?/iu, 'currency'],
  [/(?:포함\s*사항|포함\s*내역|불포함\s*사항|불포함\s*내역|포함|불포함)/u, 'commercial-terms'],
  [/(?:취소|환불|예약금|계약금|출발일|출발\s*날짜)/u, 'sale-terms'],
];

const NON_PRODUCT_DOCUMENT_PATTERNS: Array<[RegExp, string]> = [
  [/(?:\uD559\uC704\s*\uB17C\uBB38|\uB17C\uBB38\s*\uC791\uC131\s*(?:\uC11C\uC2DD|\uAC00\uC774\uB4DC)|\uC218\uD5D8\uBC88\uD638|\uACE0\uC0AC\uC7A5|\uBC1C\uBA85\s*\uC544\uC774\uB514\uC5B4|\uAC1C\uC778\s*\uD65C\uB3D9\uC9C0)/u, 'academic-or-form'],
  [/(?:\uC704\uD0C1\uC6A9\uC5ED\s*(?:\uACFC\uC5C5\uC9C0\uC2DC\uC11C|\uC81C\uC548\s*\uC694\uCCAD\uC11C)|\uC785\uCC30\s*(?:\uACF5\uACE0|\uC720\uC758\uC11C)|\uC81C\uC548\uC11C\s*\uD3C9\uAC00\s*\uAE30\uC900)/u, 'procurement'],
];

export function classifyProductSourceFilename(input: {
  sourceType: ProductSourceType;
  filename: string;
}): ProductSourceDocumentClassification | null {
  if (input.sourceType !== 'hwp' && input.sourceType !== 'text') return null;
  const filename = input.filename.normalize('NFKC');
  const nonProduct = score(filename, NON_PRODUCT_DOCUMENT_PATTERNS);
  if (nonProduct.count === 0) return null;
  return {
    documentClass: 'non_travel',
    reasonCode: 'NOT_TRAVEL_PRODUCT_DOCUMENT',
    confidence: 0.99,
    evidence: nonProduct.evidence.map(value => `filename:non-product:${value}`),
    metrics: {
      characterCount: 0,
      productAnchorScore: 0,
      travelDomainScore: 0,
      commercialScore: 0,
      replacementRatio: 0,
    },
  };
}

function score(text: string, patterns: Array<[RegExp, string]>): { count: number; evidence: string[] } {
  const evidence: string[] = [];
  for (const [pattern, label] of patterns) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) evidence.push(label);
  }
  return { count: evidence.length, evidence };
}

export function classifyProductSourceDocument(input: {
  sourceType: ProductSourceType;
  documentIr?: DocumentIR | null;
}): ProductSourceDocumentClassification {
  if (input.sourceType !== 'hwp' && input.sourceType !== 'text') {
    return {
      documentClass: 'unsupported',
      reasonCode: 'UNSUPPORTED_DOCUMENT_COHORT',
      confidence: 1,
      evidence: [`source-type:${input.sourceType}`],
      metrics: { characterCount: 0, productAnchorScore: 0, travelDomainScore: 0, commercialScore: 0, replacementRatio: 0 },
    };
  }

  const text = input.documentIr?.text?.normalize('NFKC').trim() ?? '';
  const replacementCount = (text.match(/\uFFFD/g) ?? []).length;
  const replacementRatio = replacementCount / Math.max(1, text.length);
  if (text.length < 10 || replacementRatio >= 0.01) {
    return {
      documentClass: 'corrupt',
      reasonCode: 'CORRUPT_SOURCE_DOCUMENT',
      confidence: 1,
      evidence: [text.length < 10 ? 'text-too-short' : 'replacement-character-ratio'],
      metrics: { characterCount: text.length, productAnchorScore: 0, travelDomainScore: 0, commercialScore: 0, replacementRatio },
    };
  }

  const guard = analyzeUploadInputText(text);
  const travel = score(text, TRAVEL_DOMAIN_PATTERNS);
  const commercial = score(text, COMMERCIAL_PATTERNS);
  const explicitlyNonProduct = guard.issues.some(issue => (
    issue.code === 'non_product_prompt' || issue.code === 'web_page_copy'
  ) && issue.severity === 'block');
  const filename = input.documentIr?.filename?.normalize('NFKC') ?? '';
  const nonProduct = score(`${filename}\n${text.slice(0, 8_000)}`, NON_PRODUCT_DOCUMENT_PATTERNS);
  const operationalText = text.slice(0, 8_000);
  const operationalSignals = [
    /(?:\uC608\uC57D\uC790|\uC5EC\uD589\uC790|\uB300\uD45C\uC790|\uC608\uC57D\s*\uC778\uC6D0|\uD655\uC815\s*\uC778\uC6D0)/u,
    /\uCD1D\s*\d+\s*(?:\uBD84|\uBA85|\uC778)\b/u,
    /\uBBF8\uD305\s*(?:\uC7A5\uC18C|\uB2F4\uB2F9\uC790|\uD53C\uCF13)/u,
    /\uD604\uC9C0\s*(?:\uAC00\uC774\uB4DC|\uBBF8\uD305)/u,
    /(?:\uCC28\uB7C9\s*\uC885\uB958|\uAC1D\uC2E4\s*\uC885\uB958)/u,
    /(?:\+?82[-\s]?)?0?1[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/u,
    /(?:\uCD1D\s*\uC561|\uACAC\uC801)/u,
  ].filter(pattern => pattern.test(operationalText)).length;
  const explicitSellingPrice = /(?:\uC0C1\uD488\uAC00|\uD310\uB9E4\uAC00|\uC131\uC778(?:\s*\uAE30\uC900)?\s*(?:\uAC00|\uC694\uAE08)|1\uC778(?:\uB2F9)?\s*(?:\uC694\uAE08|\uD310\uB9E4\uAC00))[^\n]{0,30}\d{1,3}(?:[,.]\d{3})+/u.test(operationalText);
  const operationalBookingDocument = /(?:\uD655\uC815\uC11C|\uACAC\uC801\uC11C)/u.test(filename)
    && (/(?:\uC608\uC57D\uC790|\uC5EC\uD589\uC790|\uB300\uD45C\uC790|\uC608\uC57D\s*\uC778\uC6D0|\uD655\uC815\s*\uC778\uC6D0|\uCD1D\s*\uC561|\uACAC\uC801)/u.test(operationalText)
      || (operationalSignals >= 3 && !explicitSellingPrice));
  const isTravelProduct = !explicitlyNonProduct
    && nonProduct.count === 0
    && !operationalBookingDocument
    && travel.count >= 2
    && commercial.count >= 1
    && guard.metrics.productAnchorScore >= 3;

  if (!isTravelProduct) {
    return {
      documentClass: 'non_travel',
      reasonCode: 'NOT_TRAVEL_PRODUCT_DOCUMENT',
      confidence: explicitlyNonProduct || nonProduct.count > 0 || operationalBookingDocument || travel.count === 0 ? 0.99 : 0.85,
      evidence: [
        ...guard.issues.map(issue => issue.code),
        ...nonProduct.evidence.map(value => `non-product:${value}`),
        ...(operationalBookingDocument ? ['non-product:operational-booking-document'] : []),
        ...travel.evidence.map(value => `travel:${value}`),
        ...commercial.evidence.map(value => `commercial:${value}`),
      ],
      metrics: {
        characterCount: text.length,
        productAnchorScore: guard.metrics.productAnchorScore,
        travelDomainScore: travel.count,
        commercialScore: commercial.count,
        replacementRatio,
      },
    };
  }

  return {
    documentClass: 'travel_product',
    reasonCode: 'TRAVEL_PRODUCT_DOCUMENT',
    confidence: Math.min(0.99, 0.75 + travel.count * 0.04 + commercial.count * 0.03),
    evidence: [
      ...travel.evidence.map(value => `travel:${value}`),
      ...commercial.evidence.map(value => `commercial:${value}`),
    ],
    metrics: {
      characterCount: text.length,
      productAnchorScore: guard.metrics.productAnchorScore,
      travelDomainScore: travel.count,
      commercialScore: commercial.count,
      replacementRatio,
    },
  };
}
