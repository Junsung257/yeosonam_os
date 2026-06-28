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

const CUSTOMER_FORBIDDEN_TOKEN_RE =
  /\b(?:NET|OP|PAX)\b|랜드사|공급사|거래처|원가|마진|수익|정산|송금|인폼|컨펌|수배|어드민|내부\s*확인|담당자\s*확인|대기\s*인폼|인폼\s*나가/i;
const CUSTOMER_FORBIDDEN_TOKEN_RE_GLOBAL =
  /\b(?:NET|OP|PAX)\b|랜드사|공급사|거래처|원가|마진|수익|정산|송금|인폼|컨펌|수배|어드민|내부\s*확인|담당자\s*확인|대기\s*인폼|인폼\s*나가/gi;

const OPERATIONAL_RESIDUE_RE =
  /(?:기준으로|기준|후|되면|나가주세요|진행해주세요|확인해주세요)|대기\s*$/g;

function compactText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function hasUnsafeIssue(codes: string[]): boolean {
  return codes.some(code => UNSAFE_CODES.has(code));
}

function stripForbiddenOperationalCopy(value: string): string | null {
  const parts = value
    .split(/(?:\r?\n|[;|]|(?:\s+[-–—]\s+))/)
    .map(part => compactText(part))
    .filter(Boolean)
    .filter(part => !CUSTOMER_FORBIDDEN_TOKEN_RE.test(part));

  const candidate = compactText(
    (parts.length > 0 ? parts.join(' ') : value)
      .replace(CUSTOMER_FORBIDDEN_TOKEN_RE_GLOBAL, '')
      .replace(OPERATIONAL_RESIDUE_RE, ''),
  );

  if (candidate.length < 2) return null;
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

function repairValue(value: unknown, pathParts: string[]): { value: unknown; changes: CustomerVisibleCopyRepairChange[] } {
  if (typeof value === 'string') return repairString(value, pathParts.join('.'));

  if (Array.isArray(value)) {
    const changes: CustomerVisibleCopyRepairChange[] = [];
    const next: unknown[] = [];
    value.forEach((item, index) => {
      const repaired = repairValue(item, [...pathParts, String(index)]);
      changes.push(...repaired.changes);
      if (repaired.value == null) return;
      if (typeof repaired.value === 'string' && repaired.value.trim() === '') return;
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
      if (repaired.value == null) continue;
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
  return {
    value: repaired.value as T,
    changes: repaired.changes,
  };
}
