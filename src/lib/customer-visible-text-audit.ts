import {
  customerCopyQualityIssues,
  normalizeCustomerVisibleCopy,
} from '@/lib/customer-copy-quality';

export type CustomerVisibleTextIssue = {
  fieldPath: string;
  code: string;
  detail: string;
  value: string;
  normalizedValue: string;
  safeFixable: boolean;
};

const CUSTOMER_TEXT_FIELDS = [
  'title',
  'display_title',
  'hero_tagline',
  'product_summary',
  'destination',
  'trip_style',
  'airline',
  'departure_airport',
  'departure_days',
  'price_dates',
  'price_tiers',
  'itinerary_data',
  'inclusions',
  'excludes',
  'surcharges',
  'optional_tours',
  'accommodations',
  'notices_parsed',
  'customer_notes',
  'products',
  'product_prices',
] as const;

function excerpt(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 220);
}

function isSafeFixableIssue(value: string, normalized: string, codes: string[]): boolean {
  if (value === normalized) return false;
  if (codes.some(code => (
    code === 'placeholder_or_mojibake'
    || code === 'internal_source_copy'
    || code === 'customer_forbidden_internal_terms'
  ))) return false;
  return true;
}

function walkCustomerStrings(value: unknown, pathParts: string[], visit: (fieldPath: string, value: string) => void) {
  if (typeof value === 'string') {
    visit(pathParts.join('.'), value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkCustomerStrings(item, [...pathParts, String(index)], visit));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'raw_text' || key === 'net_price' || key === 'cost_price' || key === 'margin_rate') continue;
    walkCustomerStrings(item, [...pathParts, key], visit);
  }
}

export function auditCustomerVisibleProductText(pkg: Record<string, unknown>): CustomerVisibleTextIssue[] {
  const issues: CustomerVisibleTextIssue[] = [];
  const inspect = (fieldPath: string, value: string) => {
    const found = customerCopyQualityIssues(value);
    if (found.length === 0) return;
    const normalized = normalizeCustomerVisibleCopy(value);
    const codes = found.map(issue => issue.code);
    const safeFixable = isSafeFixableIssue(value, normalized, codes);
    for (const issue of found) {
      issues.push({
        fieldPath,
        code: issue.code,
        detail: issue.detail,
        value: excerpt(value),
        normalizedValue: excerpt(normalized),
        safeFixable,
      });
    }
  };

  for (const key of CUSTOMER_TEXT_FIELDS) {
    walkCustomerStrings(pkg[key], [key], inspect);
  }

  return issues;
}

export function blockingCustomerVisibleTextIssues(pkg: Record<string, unknown>): CustomerVisibleTextIssue[] {
  return auditCustomerVisibleProductText(pkg).filter(issue => !issue.safeFixable);
}
