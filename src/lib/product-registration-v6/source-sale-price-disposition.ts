import { extractSourceWonAmounts } from '@/lib/parser/deterministic/price-ir';

type JsonObject = Record<string, unknown>;

export const SOURCE_SALE_PRICE_DISPOSITION_POLICY_VERSION =
  'source-sale-price-disposition-7';

export type SourceSalePriceDispositionState =
  | 'canonical_price_present'
  | 'source_price_requires_resolution'
  | 'source_price_absent';

export type SourceSalePriceDisposition = {
  state: SourceSalePriceDispositionState;
  shouldDiscard: boolean;
  reasonCode:
    | 'CANONICAL_SALE_PRICE_PRESENT'
    | 'SOURCE_SALE_PRICE_REQUIRES_RESOLUTION'
    | 'SOURCE_SALE_PRICE_ABSENT';
  canonicalPriceCandidateCount: number;
  explicitSourceCandidateCount: number;
  unlabeledSourceCandidateCount: number;
  sourcePriceStructureHintCount: number;
  ignoredNonSaleAmountCount: number;
  policyVersion: typeof SOURCE_SALE_PRICE_DISPOSITION_POLICY_VERSION;
};

const EXPLICIT_SALE_CONTEXT_RE =
  /(?:성인|대인|판매\s*가|상품\s*가|여행\s*경비|여행\s*요금|상품\s*가격|패키지\s*가격|1\s*인(?:당)?|특가|할인\s*가|최종\s*가|총액)/iu;

const NON_SALE_CONTEXT_RE =
  /(?:아동|소아|유아|인펀트|싱글|독실|추가\s*요금|유류|택스|세금|현지\s*(?:비|지불)|가이드\s*팁|기사\s*팁|매너\s*팁|선택\s*관광|옵션|커미션|수수료|예약금|계약금|취소|환불|패널티|위약금|벌금|원가|\bnet\b|지상비|입장료|렌탈|캐디|카트|그린피|총\s*톤\s*수|전\s*장|전\s*폭|전\s*고|수용\s*인원|객실\s*수)/iu;

// These lines often contain `1인` and a six-digit amount, but describe a
// supplement or an operating cost rather than the adult package sale price.
// Keep this vocabulary separate from the broad context regex so a supplier's
// real `1인 판매가` continues to win when it is explicitly labeled.
const NON_SALE_BUSINESS_AMOUNT_RE =
  /(?:기사\s*\/?\s*가이드\s*(?:경비|비용|수고비|팁)|가이드\s*(?:경비|비용|수고비)|싱글\s*(?:차지|챠지|추가|룸)|독실\s*(?:차지|챠지|추가)|유류\s*(?:할증료|비)|선택\s*관광|옵션\s*(?:비|요금)|캐디\s*(?:피|비)|카트\s*(?:피|비)|그린피|예약금|계약금|취소\s*(?:료|수수료)|환불\s*(?:금|수수료)|개인\s*경비|입장료|커미션|수수료|\bNET\b)/iu;

const ABBREVIATED_AMOUNT_BEFORE_SALE_CONTEXT_RE =
  /(?:^|[^\d])([1-9]\d{1,3})(?![\d.,])\s*(?:천\s*원|특가)(?:[^\p{L}\d]|$)/giu;
const ABBREVIATED_AMOUNT_AFTER_SALE_CONTEXT_RE =
  /(?:판매\s*가|상품\s*가|여행\s*(?:경비|요금)|패키지\s*가격|할인\s*가|최종\s*가|특가)\s*[:：]?\s*([1-9]\d{1,3})(?![\d.,])/giu;
const SOURCE_PRICE_STRUCTURE_HINT_RE =
  /(?:요금\s*표|가격\s*표|판매\s*가격|성인\s*(?:기준\s*)?요금|출발(?:일|일자).{0,20}(?:요금|가격))/iu;
const EXPLICIT_NO_SALE_PRICE_RE =
  /(?:(?:판매\s*가|상품\s*가|성인\s*요금|가격).{0,12}(?:별도\s*문의|문의\s*요망|미정|추후\s*안내|없음)|요금표\s*참고|(?:별첨|별도)\s*요금표\s*(?:참고|확인)?)/iu;

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function canonicalPriceCandidateCount(canonicalSection: Record<string, unknown>): number {
  const ledger = asObject(asObject(canonicalSection.v3)?.ledger);
  return asArray(ledger?.variants).reduce<number>((count, rawVariant) => {
    const variant = asObject(rawVariant);
    return count + asArray(variant?.price_calendar).filter(rawPrice => {
      const price = asObject(rawPrice);
      const amount = Number(price?.amount);
      if (!Number.isFinite(amount) || amount <= 0) return false;
      const evidence = asObject(price?.evidence);
      const quote = typeof evidence?.quote === 'string' ? evidence.quote : '';
      const amountDigits = String(Math.trunc(amount));
      // Table-cell evidence may include the next fee/terms row after the
      // actual sale amount. Use the line that contains this exact amount for
      // commercial classification, rather than letting a neighbouring
      // `유류할증료` or `싱글차지` line poison an otherwise valid sale price.
      const amountLine = quote
        .split(/\r?\n/gu)
        .find(line => line.replace(/[^\d]/gu, '').includes(amountDigits));
      const priceContext = [amountLine ?? quote, price?.label]
        .filter(value => typeof value === 'string')
        .join(' ')
        .normalize('NFKC');
      // A numeric value extracted from a NET/original-cost/commission cell is
      // not a customer sale price. A sale-price label on the same evidence can
      // override the non-sale token because some suppliers print both columns
      // in one merged cell.
      return !NON_SALE_CONTEXT_RE.test(priceContext) || EXPLICIT_SALE_CONTEXT_RE.test(priceContext);
    }).length;
  }, 0);
}

function sourceAmounts(line: string): number[] {
  return [...new Set(extractSourceWonAmounts(line, {
    minAmount: 30_000,
    maxAmount: 100_000_000,
  }).map(candidate => candidate.amount))];
}

function explicitAbbreviatedSaleAmounts(line: string): number[] {
  const normalized = line.normalize('NFKC');
  const values = extractSourceWonAmounts(normalized, {
    allowBareSaleShorthand: true,
    minAmount: 30_000,
    maxAmount: 100_000_000,
  }).filter(candidate => candidate.notation === 'bare_sale_shorthand').map(candidate => candidate.amount);
  for (const pattern of [
    ABBREVIATED_AMOUNT_BEFORE_SALE_CONTEXT_RE,
    ABBREVIATED_AMOUNT_AFTER_SALE_CONTEXT_RE,
  ]) {
    for (const match of normalized.matchAll(pattern)) {
      const amount = Number(match[1]) * 1_000;
      if (Number.isFinite(amount) && amount >= 30_000 && amount <= 100_000_000) {
        values.push(amount);
      }
    }
  }
  return [...new Set(values)];
}

function canonicalTitleHint(canonicalSection: Record<string, unknown>): string {
  return typeof canonicalSection.titleHint === 'string' ? canonicalSection.titleHint.trim() : '';
}

/**
 * Separates an actually price-less source from a price-resolution failure.
 *
 * This detector never manufactures a selling price. Any non-decoy amount in
 * the source is enough to keep the case in the parser/resolver queue. A source
 * is discardable only when both the canonical section and the original
 * section text contain no plausible adult-sale amount.
 */
export function resolveSourceSalePriceDisposition(input: {
  sourceText: string;
  canonicalSection: Record<string, unknown>;
}): SourceSalePriceDisposition {
  const canonicalCandidates = canonicalPriceCandidateCount(input.canonicalSection);
  if (canonicalCandidates > 0) {
    return {
      state: 'canonical_price_present',
      shouldDiscard: false,
      reasonCode: 'CANONICAL_SALE_PRICE_PRESENT',
      canonicalPriceCandidateCount: canonicalCandidates,
      explicitSourceCandidateCount: 0,
      unlabeledSourceCandidateCount: 0,
      sourcePriceStructureHintCount: 0,
      ignoredNonSaleAmountCount: 0,
      policyVersion: SOURCE_SALE_PRICE_DISPOSITION_POLICY_VERSION,
    };
  }

  let explicitSourceCandidateCount = 0;
  let unlabeledSourceCandidateCount = 0;
  let sourcePriceStructureHintCount = 0;
  let ignoredNonSaleAmountCount = 0;
  const candidateText = [input.sourceText, canonicalTitleHint(input.canonicalSection)]
    .filter(Boolean)
    .join('\n');
  for (const rawLine of candidateText.normalize('NFKC').split(/\r?\n/gu)) {
    const line = rawLine.replace(/\s+/gu, ' ').trim();
    if (!line) continue;
    const amounts = sourceAmounts(line);
    const abbreviatedSaleAmounts = explicitAbbreviatedSaleAmounts(line);
    if (SOURCE_PRICE_STRUCTURE_HINT_RE.test(line) && !EXPLICIT_NO_SALE_PRICE_RE.test(line)) {
      sourcePriceStructureHintCount += 1;
    }
    if (amounts.length === 0 && abbreviatedSaleAmounts.length === 0) continue;
    const explicitSaleContext = EXPLICIT_SALE_CONTEXT_RE.test(line);
    const nonSaleContext = NON_SALE_CONTEXT_RE.test(line) || NON_SALE_BUSINESS_AMOUNT_RE.test(line);
    const explicitSaleLabel = /(?:판매\s*가|상품\s*가|여행\s*(?:경비|요금)|패키지\s*가격|할인\s*가|최종\s*가|특가)/iu.test(line);
    if (explicitSaleContext && (!nonSaleContext || explicitSaleLabel)) {
      explicitSourceCandidateCount += new Set([...amounts, ...abbreviatedSaleAmounts]).size;
      continue;
    }
    if (nonSaleContext) {
      ignoredNonSaleAmountCount += amounts.length;
      continue;
    }
    // Standalone table-cell amounts are deliberately unresolved, not absent.
    // They may be a sale-price column whose header was separated by HWP layout.
    if (amounts.some(amount => amount >= 100_000)) {
      unlabeledSourceCandidateCount += amounts.filter(amount => amount >= 100_000).length;
    } else {
      ignoredNonSaleAmountCount += amounts.length;
    }
  }

  const sourceCandidateCount = explicitSourceCandidateCount
    + unlabeledSourceCandidateCount
    + sourcePriceStructureHintCount;
  if (sourceCandidateCount > 0) {
    return {
      state: 'source_price_requires_resolution',
      shouldDiscard: false,
      reasonCode: 'SOURCE_SALE_PRICE_REQUIRES_RESOLUTION',
      canonicalPriceCandidateCount: 0,
      explicitSourceCandidateCount,
      unlabeledSourceCandidateCount,
      sourcePriceStructureHintCount,
      ignoredNonSaleAmountCount,
      policyVersion: SOURCE_SALE_PRICE_DISPOSITION_POLICY_VERSION,
    };
  }

  return {
    state: 'source_price_absent',
    shouldDiscard: true,
    reasonCode: 'SOURCE_SALE_PRICE_ABSENT',
    canonicalPriceCandidateCount: 0,
    explicitSourceCandidateCount: 0,
    unlabeledSourceCandidateCount: 0,
    sourcePriceStructureHintCount,
    ignoredNonSaleAmountCount,
    policyVersion: SOURCE_SALE_PRICE_DISPOSITION_POLICY_VERSION,
  };
}

export function partitionProductSectionsBySalePrice<T extends { index: number; rawText: string }>(input: {
  sections: T[];
  canonicalSections: Array<Record<string, unknown>>;
  documentText?: string;
  sourceSectionCount?: number;
}): {
  eligibleSections: T[];
  discardedSectionIndexes: number[];
  dispositions: Array<{ sectionIndex: number; disposition: SourceSalePriceDisposition }>;
} {
  const localDispositions = input.sections.map(section => ({
    sectionIndex: section.index,
    disposition: resolveSourceSalePriceDisposition({
      sourceText: section.rawText,
      canonicalSection: input.canonicalSections[section.index] ?? {},
    }),
  }));
  const documentDisposition = resolveSourceSalePriceDisposition({
    sourceText: input.documentText ?? input.sections.map(section => section.rawText).join('\n'),
    canonicalSection: {},
  });
  const sharedDocumentPriceMayApply = (input.sourceSectionCount ?? input.sections.length) > 1 && (
    documentDisposition.state !== 'source_price_absent'
    || localDispositions.some(item => item.disposition.state !== 'source_price_absent')
  );
  const dispositions = localDispositions.map(item => {
    if (!sharedDocumentPriceMayApply || !item.disposition.shouldDiscard) return item;
    return {
      ...item,
      disposition: {
        ...item.disposition,
        state: 'source_price_requires_resolution' as const,
        shouldDiscard: false,
        reasonCode: 'SOURCE_SALE_PRICE_REQUIRES_RESOLUTION' as const,
      },
    };
  });
  const discardedSectionIndexes = dispositions
    .filter(item => item.disposition.shouldDiscard)
    .map(item => item.sectionIndex);
  const discarded = new Set(discardedSectionIndexes);
  return {
    eligibleSections: input.sections.filter(section => !discarded.has(section.index)),
    discardedSectionIndexes,
    dispositions,
  };
}
