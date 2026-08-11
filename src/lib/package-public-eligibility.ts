import { isCustomerVisibleStatus } from '@/lib/visibility-status';
import { evaluateCustomerMobileProof } from '@/lib/customer-mobile-proof';

export type PublicEligibilityBlockerCode =
  | 'status_not_customer_visible'
  | 'audit_status_blocked'
  | 'customer_open_contract_missing'
  | 'customer_open_contract_blocked'
  | 'stale_or_missing_mobile_proof'
  | 'optional_tour_display_pollution'
  | 'broken_attraction_id'
  | 'mobile_readiness_failed'
  | 'attraction_unlinked_registered'
  | 'entity_review_unresolved'
  | 'entity_master_candidate_unresolved'
  | 'trust_score_blocked';

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

export type CustomerPublicEligibilityOptions = {
  /**
   * V5 publication has its own immutable snapshot/proof gate. Once that gate
   * is authoritative, legacy audit fields must not hide the already-approved
   * customer artifact (they are still retained for audit/history).
   */
  authoritativeV5Snapshot?: boolean;
  packageRevision?: string | number | null;
  publicSnapshotHash?: string | null;
};

export type OptionalTourPublicEligibilityClassification =
  | 'valid_paid_option'
  | 'no_option_evidence'
  | 'price_table_fragment'
  | 'inclusion_fragment'
  | 'header_fragment'
  | 'date_fragment'
  | 'unknown_fragment';

export type OptionalTourPublicEligibilityFinding = {
  classification: OptionalTourPublicEligibilityClassification;
  text: string;
  item: unknown;
};

export type OptionalTourPublicEligibilityRepair = {
  optionalTours: unknown[];
  repaired: boolean;
  removed: OptionalTourPublicEligibilityFinding[];
  kept: OptionalTourPublicEligibilityFinding[];
  status: 'none_explicit' | 'paid_options' | 'unknown' | 'polluted';
};

export type AttractionIdPublicEligibilityRemoval = {
  path: string;
  id: unknown;
  reason: 'malformed_uuid' | 'unknown_attraction_id';
};

export type AttractionIdPublicEligibilityRepair = {
  itineraryData: unknown;
  repaired: boolean;
  removed: AttractionIdPublicEligibilityRemoval[];
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

const NO_OPTION_EVIDENCE_RE =
  /(?:\ub178\s*\uc635\uc158|no\s*option|\uc120\ud0dd\s*\uad00\uad11\s*(?:\uc5c6\uc74c|\ubb34|0))/iu;
const INCLUSION_FRAGMENT_RE =
  /(?:\ud3ec\s*\ud568\s*\ub0b4\s*\uc5ed|\ud3ec\ud568\ub0b4\uc5ed|\ubd88\ud3ec\ud568\ub0b4\uc5ed|\ucc28\ub7c9|\uac00\uc774\ub4dc|\uae30\uc0ac|\uc219\ubc15\ub8cc|\uc2dd\uc0ac|\uad00\uad11\uc9c0\s*\uc785\uc7a5\ub8cc|\uc5ec\ud589\uc790\s*\ubcf4\ud5d8|\uc720\ub958\ud560\uc99d\ub8cc)/iu;
const PRICE_TABLE_FRAGMENT_RE =
  /(?:\uc0c1\ud488\uac00|\uc608\uc57d\uae08|\ucd5c\uc800\uac00|\d[\d,]*\s*\uc6d0\s*\/?\s*\uc778|\uc6d0\/\uc778)/iu;
const DATE_FRAGMENT_RE =
  /(?:^\d{1,2}\s*\/\s*\d{1,2}$|^\d{1,2}\s*\uc6d4\s*\d{1,2}\s*\uc77c?$|^\d{1,2}\s*\uc77c\s*\[[^\]]+\]\s*\ucd9c\ubc1c$|\ucd9c\ubc1c\uc77c)/iu;
const EXACT_HEADER_FRAGMENT_RE =
  /^(?:\uc120\ud0dd\s*\uad00\uad11|\uc1fc\ud551\s*\uc13c\ud130|\ud3ec\ud568|\ubd88\ud3ec\ud568|\ube44\s*\uace0|r\s*m\s*k|remark|\uc77c\s*\uc790)$/iu;
const PAID_OPTION_SIGNAL_RE =
  /(?:\uc120\ud0dd\s*\uad00\uad11|\uc635\uc158|\ub9c8\uc0ac\uc9c0|\uc2a4\ud30c|\uc628\ucc9c|\uc628\ucc9c\uc695|\ud638\ud551|\uc2a4\ub178\ucfe8\ub9c1|\uc2a4\ub178\ud074\ub9c1|\ud22c\uc5b4|\ud06c\ub8e8\uc988|\uc1fc|\uacf5\uc5f0|\uccb4\ud5d8|\uc785\uc7a5\uad8c|\uc601\ud654\uad00|\uc2dc\ub124\ub9c8|\ucf00\uc774\ube14\uce74|\uc6cc\ud130\ud30c\ud06c|massage|spa|tour|cruise|show|ticket|cinema|cable\s*car|water\s*park)/iu;
const MONEY_SIGNAL_RE =
  /(?:[$]\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*[$]|\bUSD\s*\d+(?:\.\d+)?|\d[\d,]*\s*(?:\uc6d0|KRW|VND|JPY)|\uc720\ub8cc|\ubcc4\ub3c4\s*(?:\ubb38\uc758|\ube44\uc6a9|\uacb0\uc81c))/iu;

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

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(String).map((item) => item.trim()).filter(Boolean);
}

export function getStoredCustomerOpenContract(auditReport: unknown): CustomerOpenContractPayload | null {
  const report = asRecord(auditReport);
  return asContract(report?.customer_open_contract)
    ?? asContract(asRecord(report?.upload_to_open_autopilot)?.customer_open_contract);
}

function isMobileProofOnlyContractBlocker(value: unknown): boolean {
  const text = String(value ?? '').trim();
  if (!text) return false;
  return /(?:mobile.*proof|proof.*mobile|mobile_browser_proof|requires_mobile_reproof|reproof|stale_or_missing_proof|MOBILE_BROWSER_PROOF_REQUIRED|quality_scorecard:(?:packages_mobile|lp_mobile))/i.test(text);
}

export function isProofOnlyCustomerOpenContractBlock(contract: CustomerOpenContractPayload): boolean {
  const blockers = Array.isArray(contract.blockers)
    ? contract.blockers.map(String).filter(Boolean)
    : [];
  const proofFlag = contract.stale_or_missing_proof === true || contract.mobile_browser_proof?.ok === false;
  if (blockers.length === 0) return proofFlag;
  return blockers.every(isMobileProofOnlyContractBlocker);
}

function collectStoredReadinessSignals(auditReport: unknown): {
  failed: boolean;
  failures: string[];
  trustScoreBlocked: boolean;
  trustScoreBlockers: string[];
} {
  const report = asRecord(auditReport);
  if (!report) {
    return { failed: false, failures: [], trustScoreBlocked: false, trustScoreBlockers: [] };
  }

  const currentReadiness = asRecord(report.mobile_landing_readiness);
  if (currentReadiness) {
    const failures = asStringArray(currentReadiness.failures);
    const trustScore = asRecord(currentReadiness.trust_score);
    const trustScoreBlockers = asStringArray(trustScore?.blockers);
    return {
      failed: currentReadiness.status === 'fail' || failures.length > 0,
      failures,
      trustScoreBlocked: trustScore?.publishable === false || trustScoreBlockers.length > 0,
      trustScoreBlockers,
    };
  }

  const readiness = asRecord(report.readiness);
  const failures = asStringArray(readiness?.failures);
  const failed = readiness?.status === 'fail'
    || report.quality_status === 'blocked'
    || failures.length > 0;

  const trustScore = asRecord(report.trust_score);
  const trustScoreBlockers = asStringArray(trustScore?.blockers);
  const trustScoreBlocked = trustScore?.publishable === false || trustScoreBlockers.length > 0;

  return { failed, failures, trustScoreBlocked, trustScoreBlockers };
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

export function classifyOptionalTourForPublicEligibility(
  tour: unknown,
): OptionalTourPublicEligibilityFinding {
  const text = stringifyOptionalTour(tour).replace(/\s+/g, ' ').trim();
  const compact = text.replace(/\s+/g, '');
  let classification: OptionalTourPublicEligibilityClassification = 'unknown_fragment';
  if (!text) {
    classification = 'unknown_fragment';
  } else if (NO_OPTION_EVIDENCE_RE.test(text) || NO_OPTION_EVIDENCE_RE.test(compact)) {
    classification = 'no_option_evidence';
  } else if (/^\d{1,3}$/.test(compact) || PRICE_TABLE_FRAGMENT_RE.test(text) || PRICE_TABLE_FRAGMENT_RE.test(compact)) {
    classification = 'price_table_fragment';
  } else if (INCLUSION_FRAGMENT_RE.test(text) || INCLUSION_FRAGMENT_RE.test(compact)) {
    classification = 'inclusion_fragment';
  } else if (DATE_FRAGMENT_RE.test(text) || DATE_FRAGMENT_RE.test(compact)) {
    classification = 'date_fragment';
  } else if (EXACT_HEADER_FRAGMENT_RE.test(text) || EXACT_HEADER_FRAGMENT_RE.test(compact)) {
    classification = 'header_fragment';
  } else if (PAID_OPTION_SIGNAL_RE.test(text) && MONEY_SIGNAL_RE.test(text)) {
    classification = 'valid_paid_option';
  }
  return { classification, text, item: tour };
}

export function sanitizeOptionalToursForPublicEligibility(
  optionalTours: unknown,
): OptionalTourPublicEligibilityRepair {
  if (!Array.isArray(optionalTours) || optionalTours.length === 0) {
    return {
      optionalTours: [],
      repaired: Array.isArray(optionalTours) && optionalTours.length > 0,
      removed: [],
      kept: [],
      status: 'unknown',
    };
  }

  const removed: OptionalTourPublicEligibilityFinding[] = [];
  const kept: OptionalTourPublicEligibilityFinding[] = [];
  const next: unknown[] = [];
  let hasNoOptionEvidence = false;
  let hasPollution = false;
  let hasUnknown = false;
  let hasPaidOption = false;

  for (const item of optionalTours) {
    const finding = classifyOptionalTourForPublicEligibility(item);
    if (finding.classification === 'valid_paid_option') {
      hasPaidOption = true;
      kept.push(finding);
      next.push(item);
      continue;
    }
    if (finding.classification === 'unknown_fragment') hasUnknown = true;
    if (finding.classification === 'no_option_evidence') hasNoOptionEvidence = true;
    hasPollution = true;
    removed.push(finding);
  }

  const status = hasPaidOption
    ? 'paid_options'
    : hasUnknown
      ? 'unknown'
    : hasNoOptionEvidence
      ? 'none_explicit'
      : hasPollution
        ? 'polluted'
        : 'unknown';

  return {
    optionalTours: next,
    repaired: removed.length > 0 || next.length !== optionalTours.length,
    removed,
    kept,
    status,
  };
}

export function hasOptionalTourDisplayPollution(optionalTours: unknown): boolean {
  if (!Array.isArray(optionalTours)) return false;
  return optionalTours.some((tour) => {
    const text = stringifyOptionalTour(tour).replace(/\s+/g, ' ').trim();
    if (!text) return false;
    const finding = classifyOptionalTourForPublicEligibility(tour);
    if (finding.classification !== 'valid_paid_option') return true;
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

function sanitizeAttractionIdsNode(
  value: unknown,
  removed: AttractionIdPublicEligibilityRemoval[],
  path: string,
  validAttractionIds?: ReadonlySet<string>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeAttractionIdsNode(item, removed, `${path}[${index}]`, validAttractionIds));
  }
  const record = asRecord(value);
  if (!record) return value;
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    if (key === 'attraction_ids' && Array.isArray(child)) {
      const kept: unknown[] = [];
      child.forEach((id, index) => {
        const idText = typeof id === 'string' ? id.trim() : '';
        if (!idText || !UUID_RE.test(idText)) {
          removed.push({ path: `${path}.${key}[${index}]`, id, reason: 'malformed_uuid' });
          changed = true;
          return;
        }
        if (validAttractionIds && !validAttractionIds.has(idText)) {
          removed.push({ path: `${path}.${key}[${index}]`, id: idText, reason: 'unknown_attraction_id' });
          changed = true;
          return;
        }
        kept.push(idText);
      });
      next[key] = kept;
      continue;
    }
    const repairedChild = sanitizeAttractionIdsNode(child, removed, `${path}.${key}`, validAttractionIds);
    if (repairedChild !== child) changed = true;
    next[key] = repairedChild;
  }
  return changed ? next : value;
}

export function sanitizeBrokenAttractionIdsForPublicEligibility(
  itineraryData: unknown,
  validAttractionIds?: ReadonlySet<string>,
): AttractionIdPublicEligibilityRepair {
  const removed: AttractionIdPublicEligibilityRemoval[] = [];
  const itineraryDataNext = sanitizeAttractionIdsNode(itineraryData, removed, '$', validAttractionIds);
  return {
    itineraryData: itineraryDataNext,
    repaired: removed.length > 0,
    removed,
  };
}

export function getPackagePublicEligibilityBlockers(
  row: unknown,
  options: CustomerPublicEligibilityOptions = {},
): PublicEligibilityBlocker[] {
  const blockers: PublicEligibilityBlocker[] = [];
  const pkg = (asRecord(row) ?? {}) as PackagePublicEligibilityRow;

  if (!isCustomerVisibleStatus(pkg.status)) {
    blockers.push({
      code: 'status_not_customer_visible',
      message: `status=${pkg.status ?? 'null'} is not customer visible`,
    });
  }

  if (pkg.audit_status === 'blocked' && !options.authoritativeV5Snapshot) {
    blockers.push({
      code: 'audit_status_blocked',
      message: 'audit_status=blocked',
    });
  }

  const readinessSignals = collectStoredReadinessSignals(pkg.audit_report);
  if (readinessSignals.failed) {
    blockers.push({
      code: 'mobile_readiness_failed',
      message: readinessSignals.failures.length > 0
        ? `stored mobile readiness failed: ${readinessSignals.failures.slice(0, 3).join(', ')}`
        : 'stored mobile readiness or quality status is blocked',
    });
  }
  if (
    readinessSignals.failures.includes('attraction_unlinked_registered')
    || readinessSignals.trustScoreBlockers.includes('attraction.unlinked_registered')
  ) {
    blockers.push({
      code: 'attraction_unlinked_registered',
      message: 'registered attraction is mentioned but not linked to a validated attraction_id',
    });
  }
  if (
    readinessSignals.failures.some((failure) => failure.startsWith('entity_'))
    || readinessSignals.trustScoreBlockers.some((blocker) => blocker.startsWith('entity.'))
  ) {
    blockers.push({
      code: 'entity_review_unresolved',
      message: 'customer-visible entity review or attraction resolution is still unresolved',
    });
  }
  if (readinessSignals.trustScoreBlocked) {
    blockers.push({
      code: 'trust_score_blocked',
      message: readinessSignals.trustScoreBlockers.length > 0
        ? `trust score blockers: ${readinessSignals.trustScoreBlockers.slice(0, 3).join(', ')}`
        : 'trust score is not publishable',
    });
  }

  const contract = getStoredCustomerOpenContract(pkg.audit_report);
  if (!contract) {
    blockers.push({
      code: 'customer_open_contract_missing',
      message: 'customer_open_contract is missing',
    });
  } else {
    const currentMobileProof = evaluateCustomerMobileProof({
      auditReport: pkg.audit_report,
      packageUpdatedAt: pkg.updated_at ?? null,
      packageRevision: options.packageRevision,
      publicSnapshotHash: options.publicSnapshotHash,
    });
    const proofOnlyBlockResolved = currentMobileProof.ok && isProofOnlyCustomerOpenContractBlock(contract);
    const contractPass = contract.ok === true || contract.status === 'pass';
    if (!contractPass && !proofOnlyBlockResolved) {
      const reasons = Array.isArray(contract.blockers)
        ? contract.blockers.map(String).filter(Boolean).slice(0, 3).join(' | ')
        : 'customer_open_contract is not pass';
      blockers.push({
        code: 'customer_open_contract_blocked',
        message: reasons || 'customer_open_contract is not pass',
      });
    }
    if ((contract.stale_or_missing_proof || contract.mobile_browser_proof?.ok === false) && !currentMobileProof.ok) {
      blockers.push({
        code: 'stale_or_missing_mobile_proof',
        message: currentMobileProof.reason || contract.mobile_browser_proof?.reason || 'mobile proof is stale or missing',
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

export function isCustomerPubliclyOpenable(row: unknown): boolean;
export function isCustomerPubliclyOpenable(row: unknown, options: CustomerPublicEligibilityOptions): boolean;
export function isCustomerPubliclyOpenable(
  row: unknown,
  options: CustomerPublicEligibilityOptions = {},
): boolean {
  return getPackagePublicEligibilityBlockers(row, options).length === 0;
}
