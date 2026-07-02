import {
  customerCopyQualityIssues,
  normalizeCustomerVisibleCopy,
} from '@/lib/customer-copy-quality';

export type CustomerVisibleCopyRepairChange = {
  fieldPath: string;
  action: 'normalized' | 'removed';
  codes: string[];
  before: string;
  after: string | null;
};

export type CustomerVisibleCopyRepairResult<T> = {
  value: T;
  changes: CustomerVisibleCopyRepairChange[];
};

const UNSAFE_CODES = new Set([
  'placeholder_or_mojibake',
  'internal_source_copy',
  'customer_forbidden_internal_terms',
]);

const CUSTOMER_COPY_REPAIR_SKIP_KEYS = new Set([
  'raw_text',
  'sourceText',
  'source',
  'sources',
  'evidence',
  'evidence_index',
  'evidenceIndex',
  'quote',
  'quotes',
  'raw_quote',
  'rawQuote',
]);

const CUSTOMER_FORBIDDEN_TOKEN_RE =
  /\b(?:NET|OP|PAX)\b|랜드사|공급가|거래처\s*원가|상품\s*원가|마진|수익|컴프|커펌|배분|어드민|담당자\s*확인|대기\s*입금|입금\s*확인|(?:거래처|랜드사|내부|마진).{0,12}정산|정산\s*(?:메모|요청|확인)/i;
const CUSTOMER_FORBIDDEN_TOKEN_RE_GLOBAL =
  /\b(?:NET|OP|PAX)\b|랜드사|공급가|거래처\s*원가|상품\s*원가|마진|수익|컴프|커펌|배분|어드민|담당자\s*확인|대기\s*입금|입금\s*확인|(?:거래처|랜드사|내부|마진).{0,12}정산|정산\s*(?:메모|요청|확인)/gi;

const OPERATIONAL_RESIDUE_RE =
  /(?:기준으로|기준|하시면|해주세요|진행해주세요|확인해주세요|확인 후|대기)\s*$/g;

function compactText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function hasUnsafeIssue(codes: string[]): boolean {
  return codes.some(code => UNSAFE_CODES.has(code));
}

function stripForbiddenOperationalCopy(value: string): string | null {
  const parts = value
    .split(/\r?\n|[;|]|(?:\s+[-–—]\s+)/)
    .map(part => compactText(part))
    .filter(Boolean)
    .filter(part => !CUSTOMER_FORBIDDEN_TOKEN_RE.test(part));

  const candidate = compactText(
    (parts.length > 0 ? parts.join(' ') : value)
      .replace(CUSTOMER_FORBIDDEN_TOKEN_RE_GLOBAL, '')
      .replace(OPERATIONAL_RESIDUE_RE, ''),
  );

  if (candidate.length <= 4 || /^(확인|요청|메모|기준|기준으로|확인 후|후)$/.test(candidate)) return null;
  const remainingCodes = customerCopyQualityIssues(candidate).map(issue => issue.code);
  return hasUnsafeIssue(remainingCodes) ? null : candidate;
}

function repairString(value: string, fieldPath: string): { value: string | null; changes: CustomerVisibleCopyRepairChange[] } {
  const normalized = normalizeCustomerVisibleCopy(value);
  const normalizedIssues = customerCopyQualityIssues(normalized);
  const codes = normalizedIssues.map(issue => issue.code);
  const changes: CustomerVisibleCopyRepairChange[] = [];

  if (normalized !== value) {
    changes.push({
      fieldPath,
      action: 'normalized',
      codes: customerCopyQualityIssues(value).map(issue => issue.code),
      before: value,
      after: normalized,
    });
  }

  if (normalizedIssues.length === 0) return { value: normalized, changes };

  if (!hasUnsafeIssue(codes)) return { value: normalized, changes };

  const stripped = stripForbiddenOperationalCopy(normalized);
  changes.push({
    fieldPath,
    action: 'removed',
    codes,
    before: normalized,
    after: stripped,
  });
  return { value: stripped, changes };
}

function dedupeCandidateSignature(value: unknown): string | null {
  if (typeof value === 'string') {
    const key = normalizeCustomerVisibleCopy(value).replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase();
    return key.length >= 5 ? key : null;
  }
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const source = obj.displayName ?? obj.name ?? obj.title ?? obj.label ?? obj.activity;
  if (typeof source !== 'string') return null;
  const key = normalizeCustomerVisibleCopy(source).replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase();
  return key.length >= 5 ? key : null;
}

function shouldDeduplicateCustomerArray(pathParts: string[]): boolean {
  const joined = pathParts.join('.');
  if (joined.includes('.schedule')) return false;
  return (
    joined.endsWith('inclusions')
    || joined.endsWith('excludes')
    || joined.endsWith('optional_tours')
    || joined.endsWith('surcharges')
    || joined.endsWith('customer_notes')
    || joined.endsWith('notices_parsed')
    || joined.includes('highlights')
  );
}

function shouldPreserveStructuredNull(pathParts: string[], key: string): boolean {
  const parent = pathParts.at(-1);
  const collection = parent && /^\d+$/.test(parent) ? pathParts.at(-2) : parent;
  if (collection === 'product_prices') {
    return [
      'target_date',
      'day_of_week',
      'adult_selling_price',
      'child_price',
      'note',
    ].includes(key);
  }
  if (collection === 'price_dates') {
    return key === 'child_price' || key === 'confirmed';
  }
  if (collection === 'price_tiers') {
    return [
      'departure_day_of_week',
      'child_price',
      'infant_price',
      'note',
    ].includes(key);
  }
  return false;
}

function hasOptionalTourPrice(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return ['price', 'price_usd', 'price_krw', 'price_jpy', 'price_vnd', 'amount'].some(key => {
    const candidate = obj[key];
    if (typeof candidate === 'number') return candidate > 0;
    if (typeof candidate === 'string') return /\d/.test(candidate);
    return false;
  });
}

function collectReferenceSignatures(value: unknown, signatures: Set<string>) {
  const signature = dedupeCandidateSignature(value);
  if (signature) signatures.add(signature);
  if (Array.isArray(value)) {
    value.forEach(item => collectReferenceSignatures(item, signatures));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const item of Object.values(value as Record<string, unknown>)) {
    collectReferenceSignatures(item, signatures);
  }
}

function pruneDuplicateOptionalTours(value: unknown, changes: CustomerVisibleCopyRepairChange[]): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj.optional_tours)) return value;

  const referenceSignatures = new Set<string>();
  collectReferenceSignatures(obj.title, referenceSignatures);
  collectReferenceSignatures(obj.display_title, referenceSignatures);
  collectReferenceSignatures(obj.inclusions, referenceSignatures);
  const itineraryData = obj.itinerary_data as { highlights?: unknown } | null | undefined;
  collectReferenceSignatures(itineraryData?.highlights, referenceSignatures);

  const nextTours = obj.optional_tours.filter((tour, index) => {
    const signature = dedupeCandidateSignature(tour);
    if (!signature || hasOptionalTourPrice(tour) || !referenceSignatures.has(signature)) return true;
    changes.push({
      fieldPath: `optional_tours.${index}`,
      action: 'removed',
      codes: ['optional_inclusion_duplicate'],
      before: typeof tour === 'string' ? tour : JSON.stringify(tour),
      after: null,
    });
    return false;
  });
  if (nextTours.length === obj.optional_tours.length) return value;
  return { ...obj, optional_tours: nextTours };
}

function pruneDuplicateHighlights(value: unknown, changes: CustomerVisibleCopyRepairChange[]): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const obj = value as Record<string, unknown>;
  const itineraryData = obj.itinerary_data;
  if (!itineraryData || typeof itineraryData !== 'object' || Array.isArray(itineraryData)) return value;
  const itineraryObj = itineraryData as Record<string, unknown>;
  const highlights = itineraryObj.highlights;
  if (!highlights || typeof highlights !== 'object' || Array.isArray(highlights)) return value;

  const protectedSignatures = new Set<string>();
  collectReferenceSignatures(obj.title, protectedSignatures);
  collectReferenceSignatures(obj.display_title, protectedSignatures);
  collectReferenceSignatures(obj.product_summary, protectedSignatures);
  collectReferenceSignatures(obj.inclusions, protectedSignatures);
  collectReferenceSignatures(obj.excludes, protectedSignatures);
  collectReferenceSignatures(obj.surcharges, protectedSignatures);
  collectReferenceSignatures(obj.optional_tours, protectedSignatures);
  collectReferenceSignatures(obj.notices_parsed, protectedSignatures);

  const nextHighlights: Record<string, unknown> = {};
  let changed = false;
  const seenHighlightSignatures = new Set<string>();

  for (const [key, item] of Object.entries(highlights as Record<string, unknown>)) {
    if (!Array.isArray(item)) {
      nextHighlights[key] = item;
      continue;
    }

    const nextItems: unknown[] = [];
    item.forEach((entry, index) => {
      const signature = dedupeCandidateSignature(entry);
      if (signature && protectedSignatures.has(signature)) {
        changes.push({
          fieldPath: `itinerary_data.highlights.${key}.${index}`,
          action: 'removed',
          codes: ['duplicate_customer_visible_phrase'],
          before: typeof entry === 'string' ? entry : JSON.stringify(entry),
          after: null,
        });
        changed = true;
        return;
      }
      if (signature && seenHighlightSignatures.has(signature)) {
        changes.push({
          fieldPath: `itinerary_data.highlights.${key}.${index}`,
          action: 'removed',
          codes: ['duplicate_customer_visible_phrase'],
          before: typeof entry === 'string' ? entry : JSON.stringify(entry),
          after: null,
        });
        changed = true;
        return;
      }
      if (signature) seenHighlightSignatures.add(signature);
      nextItems.push(entry);
    });
    nextHighlights[key] = nextItems;
  }

  if (!changed) return value;
  return {
    ...obj,
    itinerary_data: {
      ...itineraryObj,
      highlights: nextHighlights,
    },
  };
}

function pruneDuplicateOptionalTourNotes(value: unknown, changes: CustomerVisibleCopyRepairChange[]): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj.optional_tours)) return value;

  let changed = false;
  const seenNotes = new Set<string>();
  const nextTours = obj.optional_tours.map((tour, index) => {
    if (!tour || typeof tour !== 'object' || Array.isArray(tour)) return tour;
    const tourObj = tour as Record<string, unknown>;
    const signature = dedupeCandidateSignature(tourObj.note);
    if (!signature) return tour;
    if (!seenNotes.has(signature)) {
      seenNotes.add(signature);
      return tour;
    }
    changed = true;
    changes.push({
      fieldPath: `optional_tours.${index}.note`,
      action: 'removed',
      codes: ['duplicate_customer_visible_phrase'],
      before: String(tourObj.note),
      after: null,
    });
    const { note: _note, ...rest } = tourObj;
    return rest;
  });

  if (!changed) return value;
  return { ...obj, optional_tours: nextTours };
}

function repairValue(value: unknown, pathParts: string[]): { value: unknown; changes: CustomerVisibleCopyRepairChange[] } {
  const key = pathParts[pathParts.length - 1] ?? '';
  if (CUSTOMER_COPY_REPAIR_SKIP_KEYS.has(key)) return { value, changes: [] };

  if (typeof value === 'string') return repairString(value, pathParts.join('.'));

  if (Array.isArray(value)) {
    const changes: CustomerVisibleCopyRepairChange[] = [];
    const next: unknown[] = [];
    const seen = new Set<string>();
    value.forEach((item, index) => {
      const repaired = repairValue(item, [...pathParts, String(index)]);
      changes.push(...repaired.changes);
      if (repaired.value == null) return;
      if (typeof repaired.value === 'string' && repaired.value.trim() === '') return;
      if (shouldDeduplicateCustomerArray(pathParts)) {
        const signature = dedupeCandidateSignature(repaired.value);
        if (signature && seen.has(signature)) {
          changes.push({
            fieldPath: [...pathParts, String(index)].join('.'),
            action: 'removed',
            codes: ['duplicate_customer_visible_phrase'],
            before: typeof item === 'string' ? item : JSON.stringify(item),
            after: null,
          });
          return;
        }
        if (signature) seen.add(signature);
      }
      next.push(repaired.value);
    });
    return { value: next, changes };
  }

  if (value && typeof value === 'object') {
    const changes: CustomerVisibleCopyRepairChange[] = [];
    const inputObject = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(inputObject)) {
      const repaired = repairValue(item, [...pathParts, key]);
      changes.push(...repaired.changes);
      if (repaired.value == null && !shouldPreserveStructuredNull(pathParts, key)) continue;
      if (typeof repaired.value === 'string' && repaired.value.trim() === '') continue;
      next[key] = repaired.value;
    }
    if (Object.prototype.hasOwnProperty.call(inputObject, 'activity') && next.activity == null) {
      return { value: null, changes };
    }
    if (Object.prototype.hasOwnProperty.call(inputObject, 'name') && next.name == null && pathParts.at(-1) === 'hotel') {
      return { value: null, changes };
    }
    return { value: next, changes };
  }

  return { value, changes: [] };
}

export function repairCustomerVisibleCopyPayload<T>(value: T): CustomerVisibleCopyRepairResult<T> {
  const repaired = repairValue(value, []);
  const changes = [...repaired.changes];
  const valueWithOptionalTours = pruneDuplicateOptionalTours(repaired.value, changes);
  const valueWithPrunedTourNotes = pruneDuplicateOptionalTourNotes(valueWithOptionalTours, changes);
  const valueWithPrunedHighlights = pruneDuplicateHighlights(valueWithPrunedTourNotes, changes);
  return {
    value: valueWithPrunedHighlights as T,
    changes,
  };
}
