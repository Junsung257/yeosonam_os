import { createHash } from 'crypto';

type PriceLike = {
  date?: string | null;
  target_date?: string | null;
  price?: number | string | null;
  adult_price?: number | string | null;
  adult_selling_price?: number | string | null;
  selling_price?: number | string | null;
  net_price?: number | string | null;
};

export type CustomerSourceRawTextInput = {
  productRawText: string;
  documentRawText: string;
  priceDates?: PriceLike[] | null;
  priceRows?: PriceLike[] | null;
};

export type CustomerSourceRawTextResult = {
  rawText: string;
  rawTextHash: string;
  appendedSharedEvidence: boolean;
};

const EVIDENCE_HEADER = '[공통 가격표 원문 근거]';

function normalizeComparable(value: string): string {
  return value.replace(/\s+/g, '').replace(/[,\u00a0]/g, '').toLowerCase();
}

function containsToken(text: string, token: string): boolean {
  if (!text || !token) return false;
  if (text.includes(token)) return true;
  return normalizeComparable(text).includes(normalizeComparable(token));
}

function coercePrice(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.round(value);
  if (typeof value !== 'string') return null;
  const numeric = Number(value.replace(/[^\d]/g, ''));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function dateTokens(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  const match = value.match(/^(20\d{2})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return [value].filter(Boolean);
  const year = match[1];
  const yy = year.slice(2);
  const month = String(Number(match[2]));
  const day = String(Number(match[3]));
  const mm = match[2].padStart(2, '0');
  const dd = match[3].padStart(2, '0');
  return [
    value,
    `${year}.${mm}.${dd}`,
    `${year}.${month}.${day}`,
    `${yy}년 ${month}월 ${day}일`,
    `${month}월 ${day}일`,
    `${month}월${day}일`,
    `${mm}/${dd}`,
    `${month}/${day}`,
    `${mm}.${dd}`,
    `${month}.${day}`,
  ];
}

function priceTokens(value: unknown): string[] {
  const price = coercePrice(value);
  if (!price) return [];
  const formatted = price.toLocaleString('ko-KR');
  const thousand = Math.round(price / 1000).toLocaleString('ko-KR');
  const man = price % 10_000 === 0 ? `${Math.round(price / 10_000)}만` : null;
  return [
    String(price),
    formatted,
    `${formatted}원`,
    thousand,
    `${thousand},-`,
    man,
  ].filter((token): token is string => Boolean(token));
}

function collectPriceItems(input: CustomerSourceRawTextInput): PriceLike[] {
  return [
    ...(Array.isArray(input.priceDates) ? input.priceDates : []),
    ...(Array.isArray(input.priceRows) ? input.priceRows : []),
  ];
}

function collectEvidenceTokens(input: CustomerSourceRawTextInput): string[] {
  const tokens = new Set<string>();
  for (const item of collectPriceItems(input)) {
    for (const token of dateTokens(item.date ?? item.target_date)) tokens.add(token);
    for (const token of priceTokens(
      item.price
      ?? item.adult_price
      ?? item.adult_selling_price
      ?? item.selling_price
      ?? item.net_price,
    )) tokens.add(token);
  }
  return [...tokens].filter(token => token.length >= 2);
}

function needsSharedEvidence(input: CustomerSourceRawTextInput): boolean {
  const productRaw = input.productRawText ?? '';
  const documentRaw = input.documentRawText ?? '';
  if (!documentRaw.trim()) return false;
  if (productRaw.includes(EVIDENCE_HEADER)) return false;

  const items = collectPriceItems(input);
  if (items.length === 0) return false;

  return items.some((item) => {
    const dateValues = dateTokens(item.date ?? item.target_date);
    const priceValues = priceTokens(
      item.price
      ?? item.adult_price
      ?? item.adult_selling_price
      ?? item.selling_price
      ?? item.net_price,
    );
    const productHasDate = dateValues.length === 0 || dateValues.some(token => containsToken(productRaw, token));
    const productHasPrice = priceValues.length === 0 || priceValues.some(token => containsToken(productRaw, token));
    const documentHasPrice = priceValues.length === 0 || priceValues.some(token => containsToken(documentRaw, token));
    const documentHasDate = dateValues.length === 0 || dateValues.some(token => containsToken(documentRaw, token));
    return (!productHasPrice && documentHasPrice) || (!productHasDate && documentHasDate);
  });
}

function buildEvidenceExcerpt(documentRawText: string, tokens: string[]): string | null {
  const source = documentRawText.replace(/\r\n/g, '\n');
  const lines = source.split('\n');
  const matched = new Set<number>();
  lines.forEach((line, index) => {
    if (tokens.some(token => containsToken(line, token))) {
      for (let i = Math.max(0, index - 2); i <= Math.min(lines.length - 1, index + 2); i += 1) {
        matched.add(i);
      }
    }
  });

  let excerpt = [...matched]
    .sort((a, b) => a - b)
    .map(index => lines[index].trim())
    .filter(Boolean)
    .join('\n');

  if (!excerpt) {
    const compactSource = source.replace(/\s+/g, ' ');
    const firstToken = tokens.find(token => containsToken(compactSource, token));
    if (firstToken) {
      const index = normalizeComparable(compactSource).indexOf(normalizeComparable(firstToken));
      const start = Math.max(0, index - 1200);
      excerpt = compactSource.slice(start, start + 3000).trim();
    }
  }

  return excerpt ? excerpt.slice(0, 6000) : null;
}

export function buildCustomerSourceRawText(input: CustomerSourceRawTextInput): CustomerSourceRawTextResult {
  const baseRawText = input.productRawText ?? '';
  let rawText = baseRawText;
  let appendedSharedEvidence = false;

  if (needsSharedEvidence(input)) {
    const excerpt = buildEvidenceExcerpt(input.documentRawText, collectEvidenceTokens(input));
    if (excerpt && !containsToken(baseRawText, excerpt.slice(0, 80))) {
      rawText = `${baseRawText.trim()}\n\n${EVIDENCE_HEADER}\n${excerpt}`.trim();
      appendedSharedEvidence = true;
    }
  }

  return {
    rawText,
    rawTextHash: createHash('sha256').update(rawText ?? '').digest('hex'),
    appendedSharedEvidence,
  };
}
