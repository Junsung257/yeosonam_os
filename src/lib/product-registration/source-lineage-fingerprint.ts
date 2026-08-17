import { createHash } from 'node:crypto';

export const PRODUCT_SOURCE_LINEAGE_FINGERPRINT_VERSION = 'source-lineage-fingerprint-1';

/**
 * Conservative exact-lineage fingerprint for comparing HWP extraction text
 * with text pasted from the same document. It ignores presentation whitespace
 * and zero-width characters, but preserves wording, punctuation, and numbers.
 * A mismatch is not a product mismatch; only an exact match is affirmative.
 */
export function normalizeProductSourceLineageText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/gu, '')
    .replace(/\s+/gu, '')
    .trim();
}

export function productSourceLineageHash(value: string): string | null {
  const normalized = normalizeProductSourceLineageText(value);
  if (!normalized) return null;
  return createHash('sha256').update(`${PRODUCT_SOURCE_LINEAGE_FINGERPRINT_VERSION}\n${normalized}`).digest('hex');
}
