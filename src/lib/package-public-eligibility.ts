import { isCustomerVisibleStatus } from '@/lib/visibility-status';

export type PublicEligibilityBlockerCode =
  | 'status_not_customer_visible'
  | 'audit_status_blocked'
  | 'customer_open_contract_missing'
  | 'customer_open_contract_blocked'
  | 'stale_or_missing_mobile_proof'
  | 'optional_tour_display_pollution'
  | 'broken_attraction_id';

export type PublicEligibilityBlocker = {
  code: PublicEligibilityBlockerCode;
  message: string;
};

export type PackagePublicEligibilityRow = {
  status?: string | null;
  audit_status?: string | null;
  audit_report?: unknown;
  updated_at?: string | null;
  optional_tours?: unknown;
  itinerary_data?: unknown;
};

type CustomerOpenContractPayload = {
  ok?: boolean | null;
  status?: string | null;
  blockers?: unknown;
  stale_or_missing_proof?: boolean | null;
  mobile_browser_proof?: {
    ok?: boolean | null;
    reason?: string | null;
  } | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const OPTIONAL_TOUR_FRAGMENT_RE = new RegExp(
  [
    '^\\d{1,3}$',
    '^\\d{1,2}/\\d{1,2}$',
    '^\\d{1,2}\\uc6d4\\d{1,2}\\uc77c?$',
    '\\ub178\\uc635\\uc158',
    '\\ud3ec\\s*\\ud568\\s*\\ub0b4\\s*\\uc5ed',
    '\\ud3ec\\ud568\\ub0b4\\uc5ed',
    '\\ubd88\\ud3ec\\ud568\\ub0b4\\uc5ed',
    '\\uc0c1\\ud488\\uac00',
    '\\ucd9c\\ubc1c\\uc77c',
    '\\uc608\\uc57d\\uae08',
    '\\uc720\\ub958\\ud560\\uc99d\\ub8cc',
    '\\ucc28\\ub7c9',
    '\\uac00\\uc774\\ub4dc',
    '\\uae30\\uc0ac',
    '\\uc6d0/\\uc778',
  ].join('|'),
  'iu',
);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asContract(value: unknown): CustomerOpenContractPayload | null {
  const record = asRecord(value);
  return record ? (record as CustomerOpenContractPayload) : null;
}

export function getStoredCustomerOpenContract(auditReport: unknown): CustomerOpenContractPayload | null {
  const report = asRecord(auditReport);
  return asContract(report?.customer_open_contract);
}

function uniqueBlockers(blockers: PublicEligibilityBlocker[]): PublicEligibilityBlocker[] {
  const seen = new Set<string>();
  return blockers.filter((blocker) => {
    const key = `${blocker.code}:${blocker.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stringifyOptionalTour(tour: unknown): string {
  if (typeof tour === 'string') return tour;
  const record = asRecord(tour);
  if (!record) return '';
  return [record.name, record.price, record.note]
    .filter((value) => value !== null && value !== undefined && String(value).trim().length > 0)
    .map(String)
    .join(' ');
}

export function hasOptionalTourDisplayPollution(optionalTours: unknown): boolean {
  if (!Array.isArray(optionalTours)) return false;
  return optionalTours.some((tour) => {
    const text = stringifyOptionalTour(tour).replace(/\s+/g, ' ').trim();
    if (!text) return false;
    const compact = text.replace(/\s+/g, '');
    return OPTIONAL_TOUR_FRAGMENT_RE.test(compact);
  });
}

export function collectBrokenAttractionIds(value: unknown): string[] {
  const broken = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const record = asRecord(node);
    if (!record) return;
    if (Array.isArray(record.attraction_ids)) {
      for (const id of record.attraction_ids) {
        if (typeof id === 'string' && id.trim() && !UUID_RE.test(id.trim())) {
          broken.add(id.trim());
        }
      }
    }
    for (const child of Object.values(record)) visit(child);
  };
  visit(value);
  return [...broken];
}

export function getPackagePublicEligibilityBlockers(
  row: unknown,
): PublicEligibilityBlocker[] {
  const blockers: PublicEligibilityBlocker[] = [];
  const pkg = (asRecord(row) ?? {}) as PackagePublicEligibilityRow;

  if (!isCustomerVisibleStatus(pkg.status)) {
    blockers.push({
      code: 'status_not_customer_visible',
      message: `status=${pkg.status ?? 'null'} is not customer visible`,
    });
  }

  if (pkg.audit_status === 'blocked') {
    blockers.push({
      code: 'audit_status_blocked',
      message: 'audit_status=blocked',
    });
  }

  const contract = getStoredCustomerOpenContract(pkg.audit_report);
  if (!contract) {
    blockers.push({
      code: 'customer_open_contract_missing',
      message: 'customer_open_contract is missing',
    });
  } else {
    const contractPass = contract.ok === true || contract.status === 'pass';
    if (!contractPass) {
      const reasons = Array.isArray(contract.blockers)
        ? contract.blockers.map(String).filter(Boolean).slice(0, 3).join(' | ')
        : 'customer_open_contract is not pass';
      blockers.push({
        code: 'customer_open_contract_blocked',
        message: reasons || 'customer_open_contract is not pass',
      });
    }
    if (contract.stale_or_missing_proof || contract.mobile_browser_proof?.ok === false) {
      blockers.push({
        code: 'stale_or_missing_mobile_proof',
        message: contract.mobile_browser_proof?.reason || 'mobile proof is stale or missing',
      });
    }
  }

  if (hasOptionalTourDisplayPollution(pkg.optional_tours)) {
    blockers.push({
      code: 'optional_tour_display_pollution',
      message: 'optional_tours contains non-customer table or price fragments',
    });
  }

  const brokenAttractionIds = collectBrokenAttractionIds(pkg.itinerary_data);
  if (brokenAttractionIds.length > 0) {
    blockers.push({
      code: 'broken_attraction_id',
      message: `itinerary_data contains invalid attraction_ids: ${brokenAttractionIds.slice(0, 3).join(', ')}`,
    });
  }

  return uniqueBlockers(blockers);
}

export function isCustomerPubliclyOpenable(row: unknown): boolean {
  return getPackagePublicEligibilityBlockers(row).length === 0;
}
