import type { CustomerMobileProofResult } from '@/lib/customer-mobile-proof';
import type { PublishGateResult as LegacyPublishGateResult } from '@/lib/product-publish-gate';
import { hasRiskyCustomerCopy, isOptionalTourFragment } from './public-snapshot';
import type { PublicationState, PublishFinding } from './types';

type AnyRecord = Record<string, unknown>;

export type PublicSnapshotGateInput = {
  pkg: AnyRecord;
  legacyPublishGate?: LegacyPublishGateResult | null;
  mobileProof?: CustomerMobileProofResult | null;
  customerOpenContractOk?: boolean | null;
  customerOpenContractBlockers?: string[];
  publicSnapshotHash?: string | null;
  expectedPublicSnapshotHash?: string | null;
  snapshotExists?: boolean;
  routeTextDump?: string[];
  auditQueryFailed?: string | null;
};

export type PublicSnapshotGateResult = {
  publication_state: PublicationState;
  publishable: boolean;
  hard_blockers: PublishFinding[];
  soft_warnings: PublishFinding[];
  required_actions: string[];
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INTERNAL_ENGLISH_RE = /\bDecision\s*guide\b|\boperator\b|\binternal\b|\bpublish_gate\b/i;

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : null;
}

function addBlocker(blockers: PublishFinding[], code: string, message: string, fieldPath?: string) {
  blockers.push({ code, message, fieldPath, severity: 'critical' });
}

function walk(value: unknown, visit: (value: unknown, path: string) => void, path = '') {
  visit(value, path);
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, visit, `${path}.${index}`.replace(/^\./, '')));
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  for (const [key, item] of Object.entries(record)) {
    if (key === 'raw_text' || key === 'audit_report') continue;
    walk(item, visit, `${path}.${key}`.replace(/^\./, ''));
  }
}

function findBrokenAttractionId(pkg: AnyRecord): string | null {
  let broken: string | null = null;
  walk(pkg.itinerary_data, (value, path) => {
    if (broken || !path.endsWith('attraction_ids')) return;
    if (!Array.isArray(value)) return;
    const bad = value.find(item => typeof item !== 'string' || !UUID_RE.test(item));
    if (bad !== undefined) broken = `${path}: ${String(bad)}`;
  });
  return broken;
}

function hasOptionalTourPollution(pkg: AnyRecord): boolean {
  const tours = Array.isArray(pkg.optional_tours) ? pkg.optional_tours : [];
  return tours.some(isOptionalTourFragment);
}

function hasInternalEnglishCopy(input: PublicSnapshotGateInput): string | null {
  const texts = [
    ...(input.routeTextDump ?? []),
    input.pkg.title,
    input.pkg.display_title,
    input.pkg.product_summary,
  ].map(value => String(value ?? ''));
  return texts.find(text => INTERNAL_ENGLISH_RE.test(text)) ?? null;
}

function titleHasUnsupportedClaim(pkg: AnyRecord): string | null {
  const title = String(pkg.display_title || pkg.title || '');
  const raw = String(pkg.raw_text || '');
  const itinerary = JSON.stringify(pkg.itinerary_data ?? {});
  const titleHasOnsen = /온천/.test(title);
  if (titleHasOnsen && !/온천/.test(raw) && !/온천/.test(itinerary)) {
    return 'title claims onsen without source or itinerary evidence';
  }
  if (/출발\s*확정|출발확정/.test(title)) {
    return 'title contains risky departure-confirmed claim';
  }
  return null;
}

function legacyGateBlockers(input: PublicSnapshotGateInput): PublishFinding[] {
  const result: PublishFinding[] = [];
  const gate = input.legacyPublishGate;
  if (!gate) return result;
  if (gate.decision === 'block') {
    for (const reason of gate.reasons) {
      result.push({
        code: 'unsupported_customer_claim',
        message: reason,
        severity: 'critical',
      });
    }
  }
  return result;
}

export function evaluatePublicSnapshotPublishGate(input: PublicSnapshotGateInput): PublicSnapshotGateResult {
  const hard: PublishFinding[] = [];
  const soft: PublishFinding[] = [];

  if (input.auditQueryFailed) {
    addBlocker(hard, 'audit_query_failed', input.auditQueryFailed);
  }

  if (input.customerOpenContractOk === false) {
    for (const blocker of input.customerOpenContractBlockers ?? ['customer_open_contract blocked']) {
      addBlocker(hard, 'unsupported_customer_claim', blocker);
    }
  }

  if (input.mobileProof && !input.mobileProof.ok) {
    addBlocker(hard, 'stale_mobile_proof', input.mobileProof.reason);
  }

  if (input.snapshotExists === false) {
    addBlocker(hard, 'public_snapshot_missing', 'approved public package snapshot is missing');
  }

  if (
    input.expectedPublicSnapshotHash
    && input.publicSnapshotHash
    && input.expectedPublicSnapshotHash !== input.publicSnapshotHash
  ) {
    addBlocker(hard, 'public_snapshot_hash_mismatch', 'mobile proof hash does not match the public package snapshot hash');
  }

  if (hasOptionalTourPollution(input.pkg)) {
    addBlocker(hard, 'optional_tour_display_pollution', 'optional_tours contains no-option, price-table, inclusion, or header fragments', 'optional_tours');
    addBlocker(hard, 'masked_data_pollution', 'renderer may hide optional_tours pollution, but source DB still contains polluted customer data', 'optional_tours');
  }

  const brokenAttraction = findBrokenAttractionId(input.pkg);
  if (brokenAttraction) {
    addBlocker(hard, 'broken_attraction_id', brokenAttraction, 'itinerary_data');
  }

  const unsupportedTitle = titleHasUnsupportedClaim(input.pkg);
  if (unsupportedTitle) {
    addBlocker(hard, 'unsupported_title_claim', unsupportedTitle, 'title');
  }

  if (hasRiskyCustomerCopy(input.routeTextDump ?? input.pkg)) {
    addBlocker(hard, 'risky_reservation_claim', 'customer copy contains risky reservation/guarantee wording');
  }

  const internalCopy = hasInternalEnglishCopy(input);
  if (internalCopy) {
    addBlocker(hard, 'english_internal_copy', `internal or English operational copy is customer-visible: ${internalCopy.slice(0, 120)}`);
  }

  hard.push(...legacyGateBlockers(input));

  if (input.legacyPublishGate?.decision === 'force_required') {
    soft.push(...input.legacyPublishGate.warnings.map(message => ({
      code: 'legacy_publish_warning',
      message,
      severity: 'warning' as const,
    })));
  }

  const publishable = hard.length === 0;
  return {
    publication_state: publishable ? 'published' : 'blocked',
    publishable,
    hard_blockers: hard,
    soft_warnings: soft,
    required_actions: publishable
      ? []
      : [
          'Repair or quarantine polluted DB fields',
          'Rebuild public_package_snapshot',
          'Regenerate current /packages and /lp mobile proof',
          'Rerun publish gate',
        ],
  };
}
