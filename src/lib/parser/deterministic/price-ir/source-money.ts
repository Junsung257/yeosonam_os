export type SourceWonNotation =
  | 'full'
  | 'dot_thousands'
  | 'supplier_thousand_shorthand'
  | 'bare_sale_shorthand'
  | 'man_won';

export type SourceWonAmount = {
  amount: number;
  raw: string;
  notation: SourceWonNotation;
  sourceAmountScale: 1 | 1000 | 10000;
};

export type SourceWonParseOptions = {
  allowBareSaleShorthand?: boolean;
  minAmount?: number;
  maxAmount?: number;
};

const DEFAULT_MIN_AMOUNT = 30_000;
const DEFAULT_MAX_AMOUNT = 50_000_000;
const SALE_CUE_RE = /(?:특가|판매\s*가|상품\s*가|행사\s*가|할인\s*가|최종\s*가|여행\s*(?:경비|요금)|성인\s*(?:기준\s*)?(?:가|요금)|1\s*인(?:당)?\s*(?:가|요금)?)/iu;
const NON_MONEY_QUANTITY_SUFFIX_RE = /^\s*(?:여\s*)?(?:개(?:소)?|명|곳|석|실|회|대|홀|마리|톤|평|년|월|일|m\b|km\b|㎡)/iu;

function inRange(amount: number, options: SourceWonParseOptions): boolean {
  const min = options.minAmount ?? DEFAULT_MIN_AMOUNT;
  const max = options.maxAmount ?? DEFAULT_MAX_AMOUNT;
  return Number.isInteger(amount) && amount >= min && amount <= max;
}

function stripDecorations(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/^(?:판매\s*가|상품\s*가|행사\s*가|할인\s*가|최종\s*가|성인(?:\s*기준)?\s*(?:가|요금)?|1\s*인(?:당)?\s*(?:가|요금)?)\s*[:：]?\s*/iu, '')
    // Some HWP exports render the won sign as a literal backslash (e.g. `\\1,499,000`).
    // Treat it as a currency marker only when it is immediately before a money token;
    // the original quote is still retained as evidence.
    .replace(/^\s*(?:₩|￦|KRW|\\)\s*/iu, '')
    .replace(/\s*(?:원|KRW|\/\s*인|\/\s*성인)\s*$/iu, '')
    .replace(/\s*(?:특가|판매\s*가|상품\s*가|행사\s*가|할인\s*가|최종\s*가)\s*$/iu, '')
    .trim();
}

/**
 * Parses one KRW source token without changing the original evidence text.
 *
 * Supplier shorthand is accepted only by this KRW-specific parser:
 * `899,`, `699,---`, `999,-`, and `1,079,-` are all amounts expressed in
 * thousands of won. A bare `399` is scaled only when a sale cue is present or
 * the caller explicitly establishes a trusted price-cell context.
 */
export function parseSourceWonAmount(
  value: string,
  options: SourceWonParseOptions = {},
): SourceWonAmount | null {
  const original = value.normalize('NFKC').trim();
  if (!original) return null;

  const manWon = original.match(/^(?:[^\d]*)?([1-9]\d{0,3}(?:\.\d+)?)\s*만\s*원(?:[^\d]*)?$/u);
  if (manWon) {
    const amount = Number(manWon[1]) * 10_000;
    return inRange(amount, options)
      ? { amount, raw: value, notation: 'man_won', sourceAmountScale: 10000 }
      : null;
  }

  const token = stripDecorations(original);
  const supplierShorthand = token.match(/^([1-9]\d{1,3}|[1-9]\d{0,2}(?:,\d{3})+)\s*,\s*[-–—]{0,8}$/u);
  if (supplierShorthand) {
    const amount = Number(supplierShorthand[1].replace(/,/gu, '')) * 1_000;
    return inRange(amount, options)
      ? { amount, raw: value, notation: 'supplier_thousand_shorthand', sourceAmountScale: 1000 }
      : null;
  }

  const grouped = token.match(/^([1-9]\d{0,2}(?:[,.]\d{3})+)$/u);
  if (grouped) {
    const rawNumber = Number(grouped[1].replace(/[,.]/gu, ''));
    if (rawNumber >= 10_000 && inRange(rawNumber, options)) {
      return {
        amount: rawNumber,
        raw: value,
        notation: grouped[1].includes('.') ? 'dot_thousands' : 'full',
        sourceAmountScale: 1,
      };
    }
    if (options.allowBareSaleShorthand && inRange(rawNumber * 1_000, options)) {
      return {
        amount: rawNumber * 1_000,
        raw: value,
        notation: 'bare_sale_shorthand',
        sourceAmountScale: 1000,
      };
    }
    return null;
  }

  const fullDigits = token.match(/^([1-9]\d{4,8})$/u);
  if (fullDigits) {
    const amount = Number(fullDigits[1]);
    return inRange(amount, options)
      ? { amount, raw: value, notation: 'full', sourceAmountScale: 1 }
      : null;
  }

  const bare = token.match(/^([1-9]\d{1,3})$/u);
  if (bare && options.allowBareSaleShorthand) {
    const amount = Number(bare[1]) * 1_000;
    return inRange(amount, options)
      ? { amount, raw: value, notation: 'bare_sale_shorthand', sourceAmountScale: 1000 }
      : null;
  }

  return null;
}

type LocatedAmount = SourceWonAmount & { start: number; end: number };

function overlaps(left: LocatedAmount, right: LocatedAmount): boolean {
  return left.start < right.end && right.start < left.end;
}

/** Extracts KRW values from a line while keeping the exact source token. */
export function extractSourceWonAmounts(
  value: string,
  options: SourceWonParseOptions = {},
): SourceWonAmount[] {
  const normalized = value.normalize('NFKC');
  const located: LocatedAmount[] = [];
  const add = (raw: string, start: number, parseOptions: SourceWonParseOptions = options) => {
    const trailing = normalized.slice(start + raw.length, start + raw.length + 16);
    if (NON_MONEY_QUANTITY_SUFFIX_RE.test(trailing)) return;
    const parsed = parseSourceWonAmount(raw, parseOptions);
    if (!parsed) return;
    const candidate = { ...parsed, start, end: start + raw.length };
    if (located.some(existing => overlaps(existing, candidate))) return;
    located.push(candidate);
  };

  // Longest and most explicit forms must be collected first so a suffix of a
  // million-won amount is never interpreted as a second price.
  const explicitPatterns = [
    /[1-9]\d{0,3}(?:\.\d+)?\s*만\s*원/gu,
    /(?:[1-9]\d{1,3}|[1-9]\d{0,2}(?:,\d{3})+)\s*,(?:\s*[-–—]{1,8}|(?=\s*(?:$|[^\s\d-])))/gu,
    /[1-9]\d{0,2}(?:[,.]\d{3})+\s*(?:원|KRW)?/giu,
    /(?:₩|￦|KRW|\\)\s*[1-9]\d{4,8}|[1-9]\d{4,8}\s*(?:원|KRW)?/giu,
  ];
  for (const pattern of explicitPatterns) {
    for (const match of normalized.matchAll(pattern)) add(match[0], match.index);
  }

  if (located.length === 0 && options.allowBareSaleShorthand && SALE_CUE_RE.test(normalized)) {
    for (const match of normalized.matchAll(/(?<![\d.$/,-])([1-9]\d{1,3})(?![\d%./,-])/gu)) {
      const token = match[1]!;
      const tokenStart = match.index + match[0].indexOf(token);
      const precedingText = normalized.slice(0, tokenStart).trimEnd();
      // `특가 8/24, 31` continues a departure-date list. It must never turn
      // into a 31,000-won price merely because the line also contains `특가`.
      if (precedingText.endsWith(',') || precedingText.endsWith('/')) continue;
      // Leading-zero compact dates (`0711`) and explicit years are not prices.
      if (token.startsWith('0') || /^20\d{2}$/u.test(token)) continue;
      add(token, tokenStart, { ...options, allowBareSaleShorthand: true });
    }
  }

  return located
    .sort((left, right) => left.start - right.start || right.end - left.end)
    .map(({ start: _start, end: _end, ...amount }) => amount);
}

export function sourceWonEvidenceContainsAmount(value: string, expectedAmount: number): boolean {
  return extractSourceWonAmounts(value, { allowBareSaleShorthand: SALE_CUE_RE.test(value.normalize('NFKC')) })
    .some(candidate => candidate.amount === expectedAmount);
}
