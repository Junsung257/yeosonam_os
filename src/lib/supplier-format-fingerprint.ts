import crypto from 'crypto';

export type SupplierSectionFingerprint = {
  label: string;
  /**
   * Format-level hash with volatile facts masked. Use only for prompt guidance,
   * supplier profile matching, and analytics.
   */
  hash: string;
  /**
   * Exact section hash with customer-visible facts preserved. This is the only
   * section key that may be used for cache reuse.
   */
  exactHash: string;
  charLength: number;
};

export type SupplierFormatFingerprint = {
  formatHash: string;
  normalizedPreview: string;
  sections: SupplierSectionFingerprint[];
};

export type SupplierSectionFingerprintBlock = SupplierSectionFingerprint & {
  text: string;
};

const SECTION_HINTS: Array<[RegExp, string]> = [
  [/요금|가격|price|출발일자\s*[|／/]\s*성인|성인\s*[|／/]\s*아동/i, 'price'],
  [/일정|itinerary|day/i, 'itinerary'],
  [/포함|불포함|include|exclude/i, 'terms'],
  [/선택\s*관광|옵션|optional/i, 'optional'],
  [/공지|비고|약관|취소|환불|notice|policy/i, 'notice'],
];

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeExactSectionText(rawText: string): string {
  return rawText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

export function normalizeSupplierFormatText(rawText: string): string {
  return rawText
    .replace(/\r\n/g, '\n')
    .replace(/[A-Z0-9]{2}\d{2,4}/g, '<FLIGHT>')
    .replace(/\d{4}[./-]\d{1,2}[./-]\d{1,2}/g, '<DATE>')
    .replace(/\d{1,2}[./-]\d{1,2}/g, '<MDATE>')
    .replace(/\d{1,2}:\d{2}/g, '<TIME>')
    .replace(/\d[\d,]*\s*원/g, '<KRW>')
    .replace(/\$\s*\d+(?:\.\d+)?/g, '<USD>')
    .replace(/\d+\s*명/g, '<PAX>')
    .replace(/\d+\s*박\s*\d+\s*일/g, '<DURATION>')
    .replace(/\[[^\]\n]{1,80}\]/g, '<TITLE_TAG>')
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function classifySection(line: string): string | null {
  for (const [pattern, label] of SECTION_HINTS) {
    if (pattern.test(line)) return label;
  }
  if (/^\s*(?:#{1,4}\s*)?day\s*\d+|^\s*(?:제\s*)?\d+\s*일차/i.test(line)) return 'itinerary';
  return null;
}

export function splitSupplierFormatSectionBlocks(rawText: string): SupplierSectionFingerprintBlock[] {
  const buckets = new Map<string, string[]>();
  let current = 'header';

  for (const rawLine of rawText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const next = classifySection(line);
    if (next) current = next;
    buckets.set(current, [...(buckets.get(current) ?? []), line]);
  }

  return [...buckets.entries()].map(([label, lines]) => {
    const rawSection = lines.join('\n');
    const normalized = normalizeSupplierFormatText(rawSection);
    const exact = normalizeExactSectionText(rawSection);
    return {
      label,
      hash: sha256(`${label}\n${normalized}`).slice(0, 32),
      exactHash: sha256(`${label}\n${exact}`).slice(0, 32),
      charLength: lines.join('\n').length,
      text: rawSection,
    };
  });
}

export function splitSupplierFormatSections(rawText: string): SupplierSectionFingerprint[] {
  return splitSupplierFormatSectionBlocks(rawText).map(({ text: _text, ...section }) => section);
}

export function buildSupplierFormatFingerprint(rawText: string): SupplierFormatFingerprint {
  const normalized = normalizeSupplierFormatText(rawText);
  return {
    formatHash: sha256(normalized).slice(0, 32),
    normalizedPreview: normalized.slice(0, 1200),
    sections: splitSupplierFormatSections(rawText),
  };
}
