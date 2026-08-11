import { sha256Hex } from '@/lib/product-registration-v4/document-ir';
import { stableJson } from '@/lib/product-registration-v4/revision';

type JsonObject = Record<string, unknown>;

export type CanonicalTermsRevision = {
  termsType: 'cancellation' | 'refund' | 'inclusion' | 'exclusion' | 'shopping' | 'optional_tour' | 'entry' | 'general';
  termsPayload: JsonObject;
  termsHash: string;
  validationState: 'verified' | 'blocked' | 'conflicting';
  claimFieldPaths: string[];
};

function object(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function noticeType(notice: JsonObject): CanonicalTermsRevision['termsType'] {
  const value = [notice.category, notice.template_key, notice.source_text, notice.standard_text]
    .map(text)
    .filter(Boolean)
    .join(' ');
  if (/(cancel|cancellation|취소|위약)/i.test(value)) return 'cancellation';
  if (/(refund|환불)/i.test(value)) return 'refund';
  if (/(entry|visa|passport|입국|비자|여권)/i.test(value)) return 'entry';
  return 'general';
}

function pushTerms(
  rows: CanonicalTermsRevision[],
  termsType: CanonicalTermsRevision['termsType'],
  items: unknown[],
  claimFieldPath: string,
): void {
  if (items.length === 0) return;
  const termsPayload = { items };
  rows.push({
    termsType,
    termsPayload,
    termsHash: sha256Hex(stableJson({ termsType, termsPayload })),
    validationState: 'verified',
    claimFieldPaths: [claimFieldPath],
  });
}

/** Converts source-backed canonical ledger fields into immutable terms rows.
 * It never supplies a default cancellation policy: absence remains a blocker. */
export function buildCanonicalTermsRevisions(canonicalPayload: JsonObject): CanonicalTermsRevision[] {
  const rows: CanonicalTermsRevision[] = [];
  array(canonicalPayload.sections).forEach((rawSection, sectionIndex) => {
    const ledger = object(object(object(rawSection)?.v3)?.ledger);
    array(ledger?.variants).forEach((rawVariant, variantIndex) => {
      const variant = object(rawVariant) ?? {};
      const prefix = `sections[${sectionIndex}].v3.ledger.variants[${variantIndex}]`;
      const inclusions = array(variant.inclusions)
        .map(item => text(object(item)?.value ?? item))
        .filter((item): item is string => Boolean(item));
      const exclusions = array(variant.exclusions)
        .map(item => text(object(item)?.value ?? item))
        .filter((item): item is string => Boolean(item));
      const shopping = array(variant.shopping)
        .map(item => text(object(item)?.value ?? item))
        .filter((item): item is string => Boolean(item));
      const options = array(variant.options).map(item => object(item) ?? { value: item });
      pushTerms(rows, 'inclusion', unique(inclusions), `${prefix}.inclusions`);
      pushTerms(rows, 'exclusion', unique(exclusions), `${prefix}.exclusions`);
      pushTerms(rows, 'shopping', unique(shopping), `${prefix}.shopping`);
      pushTerms(rows, 'optional_tour', options, `${prefix}.options`);

      const noticesByType = new Map<CanonicalTermsRevision['termsType'], JsonObject[]>();
      for (const rawNotice of array(variant.standard_notices)) {
        const notice = object(rawNotice);
        if (!notice) continue;
        const type = noticeType(notice);
        const list = noticesByType.get(type) ?? [];
        list.push(notice);
        noticesByType.set(type, list);
      }
      for (const [type, notices] of noticesByType) {
        pushTerms(rows, type, notices, `${prefix}.standard_notices`);
      }
    });
  });

  return rows;
}
