import {
  customerCopyQualityIssues,
  normalizeCustomerVisibleCopy,
} from '@/lib/customer-copy-quality';
import { hasRiskyCustomerPromiseCopy } from '@/lib/customer-risky-copy';
import { classifyOptionalTourForPublicEligibility } from '@/lib/package-public-eligibility';

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
  'product_highlights',
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

const NON_CUSTOMER_VISIBLE_STRING_KEYS = new Set([
  'id',
  'package_id',
  'product_id',
  'internal_code',
  'short_code',
  'attraction_id',
  'attraction_ids',
  'resolved_attraction_id',
  'entity_id',
  'entity_kind',
  'source_id',
  'source_ids',
  'raw_text_hash',
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
    if (NON_CUSTOMER_VISIBLE_STRING_KEYS.has(key)) continue;
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

function addRiskyCustomerPromiseIssues(rows: TextRow[], issues: CustomerVisibleTextIssue[]) {
  for (const row of rows) {
    if (!hasRiskyCustomerPromiseCopy(row.value) && !hasRiskyCustomerPromiseCopy(row.normalized)) continue;
    issues.push(issueFromRow(
      row,
      'risky_customer_promise_copy',
      '고객에게 확정·보장처럼 보일 수 있는 문구는 담당자 확인/예약 가능 여부 중심으로 바꿔야 합니다.',
      false,
    ));
  }
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
        ? '선택관광/특식 정보가 포함사항 또는 하이라이트에도 중복 노출됩니다.'
        : `동일 고객 문구가 다른 위치에도 반복됩니다. first=${first.fieldPath}`,
    ));
  }
}

function addOptionalTourPollutionIssues(value: unknown, pathParts: string[], issues: CustomerVisibleTextIssue[]) {
  if (Array.isArray(value) && pathParts.at(-1) === 'optional_tours') {
    value.forEach((item, index) => {
      const finding = classifyOptionalTourForPublicEligibility(item);
      if (finding.classification === 'valid_paid_option') return;
      issues.push({
        fieldPath: [...pathParts, String(index)].join('.'),
        code: 'optional_tour_display_pollution',
        detail: '선택관광에는 가격/비용 근거가 있는 유료 옵션만 고객에게 보여야 합니다.',
        value: excerpt(finding.text || JSON.stringify(item)),
        normalizedValue: excerpt(normalizeCustomerVisibleCopy(finding.text || JSON.stringify(item))),
        safeFixable: false,
      });
    });
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => addOptionalTourPollutionIssues(item, [...pathParts, String(index)], issues));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    addOptionalTourPollutionIssues(item, [...pathParts, key], issues);
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

  addRiskyCustomerPromiseIssues(rows, issues);
  addOptionalTourPollutionIssues(pkg, [], issues);
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

  addRiskyCustomerPromiseIssues(rows, issues);
  addSingleValueContextIssues(rows, issues);

  return issues;
}

export function blockingCustomerVisibleTextIssues(pkg: Record<string, unknown>): CustomerVisibleTextIssue[] {
  return auditCustomerVisibleProductText(pkg).filter(issue => !issue.safeFixable);
}
