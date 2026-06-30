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
  surface?: string;
  line?: number;
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

const UNSAFE_CODES = new Set([
  'placeholder_or_mojibake',
  'internal_source_copy',
  'customer_forbidden_internal_terms',
]);

const LOW_VALUE_SCREEN_LINES = new Set([
  '여소남',
  '예약',
  '상담',
  '문의',
  '포함',
  '불포함',
  '일정',
  '호텔',
  '항공',
  '선택관광',
]);

type TextRow = {
  fieldPath: string;
  value: string;
  normalized: string;
  comparable: string;
  surface?: string;
  line?: number;
};

function excerpt(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 220);
}

function hasUnsafeIssue(codes: string[]): boolean {
  return codes.some(code => UNSAFE_CODES.has(code));
}

function isSafeFixableIssue(value: string, normalized: string): boolean {
  if (value === normalized) return false;
  const normalizedCodes = customerCopyQualityIssues(normalized).map(issue => issue.code);
  return !hasUnsafeIssue(normalizedCodes);
}

function comparableText(value: string): string {
  return normalizeCustomerVisibleCopy(value)
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .toLowerCase();
}

function hasUsefulComparableText(value: string): boolean {
  if (value.length < 8) return false;
  if (/^\d+$/.test(value)) return false;
  return !LOW_VALUE_SCREEN_LINES.has(value);
}

function pathHasAny(fieldPath: string, needles: string[]): boolean {
  return needles.some(needle => fieldPath.includes(needle));
}

function isDuplicateComparablePath(fieldPath: string): boolean {
  if (pathHasAny(fieldPath, [
    'entity_kind',
    'attraction_query',
    'attraction_queries',
    'attraction_names',
    'a4_sentence',
    'landing_sentence',
  ])) return false;
  return (
    fieldPath === 'title'
    || fieldPath === 'display_title'
    || fieldPath === 'hero_tagline'
    || fieldPath === 'product_summary'
    || fieldPath.startsWith('inclusions')
    || fieldPath.startsWith('optional_tours')
    || fieldPath.startsWith('customer_notes')
    || fieldPath.includes('highlights')
  );
}

function isEquivalentTitlePair(firstPath: string, secondPath: string): boolean {
  const pair = new Set([firstPath, secondPath]);
  return pair.has('title') && pair.has('display_title');
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

function issueFromRow(row: TextRow, code: string, detail: string, safeFixable = true): CustomerVisibleTextIssue {
  return {
    fieldPath: row.fieldPath,
    code,
    detail,
    value: excerpt(row.value),
    normalizedValue: excerpt(row.normalized),
    safeFixable,
    surface: row.surface,
    line: row.line,
  };
}

function addSingleValueContextIssues(rows: TextRow[], issues: CustomerVisibleTextIssue[]) {
  const duplicateDestinationRe = /(^|[^가-힣A-Za-z0-9])([가-힣A-Za-z][가-힣A-Za-z0-9·]{1,12})\s+\2(?=$|[^가-힣A-Za-z0-9])/u;

  for (const row of rows) {
    if (duplicateDestinationRe.test(row.value) || duplicateDestinationRe.test(row.normalized)) {
      issues.push(issueFromRow(
        row,
        'duplicate_destination_token',
        '동일 여행지/표현이 한 문장 안에서 반복됩니다.',
      ));
    }
  }
}

function addCrossFieldContextIssues(rows: TextRow[], issues: CustomerVisibleTextIssue[]) {
  const seen = new Map<string, TextRow>();

  for (const row of rows) {
    if (!hasUsefulComparableText(row.comparable)) continue;
    if (!isDuplicateComparablePath(row.fieldPath)) continue;
    const first = seen.get(row.comparable);
    if (!first) {
      seen.set(row.comparable, row);
      continue;
    }
    if (first.fieldPath === row.fieldPath) continue;
    if (isEquivalentTitlePair(first.fieldPath, row.fieldPath)) continue;

    const optionalInclusionDuplicate =
      (pathHasAny(first.fieldPath, ['optional_tours']) && pathHasAny(row.fieldPath, ['inclusions', 'highlights']))
      || (pathHasAny(row.fieldPath, ['optional_tours']) && pathHasAny(first.fieldPath, ['inclusions', 'highlights']));

    issues.push(issueFromRow(
      row,
      optionalInclusionDuplicate ? 'optional_inclusion_duplicate' : 'duplicate_customer_visible_phrase',
      optionalInclusionDuplicate
        ? '선택관광/특식 후보가 포함사항 또는 하이라이트에도 중복 노출됩니다.'
        : `동일 고객 문구가 다른 위치에도 반복됩니다. first=${first.fieldPath}`,
    ));
  }
}

function collectProductRows(pkg: Record<string, unknown>): TextRow[] {
  const rows: TextRow[] = [];
  for (const key of CUSTOMER_TEXT_FIELDS) {
    walkCustomerStrings(pkg[key], [key], (fieldPath, value) => {
      const normalized = normalizeCustomerVisibleCopy(value);
      rows.push({
        fieldPath,
        value,
        normalized,
        comparable: comparableText(normalized),
      });
    });
  }
  return rows;
}

export function auditCustomerVisibleProductText(pkg: Record<string, unknown>): CustomerVisibleTextIssue[] {
  const issues: CustomerVisibleTextIssue[] = [];
  const rows = collectProductRows(pkg);

  for (const row of rows) {
    const found = customerCopyQualityIssues(row.value);
    for (const issue of found) {
      issues.push({
        fieldPath: row.fieldPath,
        code: issue.code,
        detail: issue.detail,
        value: excerpt(row.value),
        normalizedValue: excerpt(row.normalized),
        safeFixable: isSafeFixableIssue(row.value, row.normalized),
      });
    }
  }

  addSingleValueContextIssues(rows, issues);
  addCrossFieldContextIssues(rows, issues);

  return issues;
}

export function auditCustomerVisibleScreenText(
  text: string,
  options: { surface?: string; maxLines?: number } = {},
): CustomerVisibleTextIssue[] {
  const surface = options.surface ?? 'screen';
  const maxLines = options.maxLines ?? 2_000;
  const rows = text
    .split(/\n+/)
    .map((line, index) => ({ line, index: index + 1 }))
    .map(({ line, index }) => ({
      fieldPath: `${surface}.line.${index}`,
      value: line.trim(),
      normalized: normalizeCustomerVisibleCopy(line.trim()),
      comparable: comparableText(line.trim()),
      surface,
      line: index,
    }))
    .filter(row => row.value.length > 0)
    .slice(0, maxLines);

  const issues: CustomerVisibleTextIssue[] = [];
  for (const row of rows) {
    const found = customerCopyQualityIssues(row.value);
    for (const issue of found) {
      issues.push({
        fieldPath: row.fieldPath,
        code: issue.code,
        detail: issue.detail,
        value: excerpt(row.value),
        normalizedValue: excerpt(row.normalized),
        safeFixable: isSafeFixableIssue(row.value, row.normalized),
        surface,
        line: row.line,
      });
    }
  }

  addSingleValueContextIssues(rows, issues);

  return issues;
}

export function blockingCustomerVisibleTextIssues(pkg: Record<string, unknown>): CustomerVisibleTextIssue[] {
  return auditCustomerVisibleProductText(pkg).filter(issue => !issue.safeFixable);
}
