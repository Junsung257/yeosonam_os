import type { CustomerMobileProofResult } from '@/lib/customer-mobile-proof';
import { customerCopyQualityIssues } from '@/lib/customer-copy-quality';
import { isSafeImageSrc } from '@/lib/image-url';
import type { PublishGateResult as LegacyPublishGateResult } from '@/lib/product-publish-gate';
import { hasRiskyCustomerCopy, isOptionalTourFragment } from './public-snapshot';
import type { PublicationState, PublishFinding } from './types';

type AnyRecord = Record<string, unknown>;
type CustomerClaimSurface = {
  label: string;
  fieldPath: string;
  text: string;
};

export type PublicSnapshotGateInput = {
  pkg: AnyRecord;
  legacyPublishGate?: LegacyPublishGateResult | null;
  mobileProof?: CustomerMobileProofResult | null;
  customerOpenContractOk?: boolean | null;
  customerOpenContractBlockers?: string[];
  publicSnapshotHash?: string | null;
  expectedPublicSnapshotHash?: string | null;
  publicSnapshotTitle?: string | null;
  snapshotExists?: boolean;
  routeTextDump?: string[];
  auditQueryFailed?: string | null;
  invalidAttractionIds?: string[];
};

export type PublicSnapshotGateResult = {
  publication_state: PublicationState;
  publishable: boolean;
  hard_blockers: PublishFinding[];
  soft_warnings: PublishFinding[];
  required_actions: string[];
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PUBLIC_TITLE_DURATION_RE = /\d+\s*박\s*\d+\s*일|\d+\s*일/;
const INTERNAL_ENGLISH_RE = /\bDecision\s*guide\b|\boperator\b|\binternal\b|\bpublish_gate\b/i;
const BLOCKING_CUSTOMER_COPY_CODES = new Set([
  'placeholder_or_mojibake',
  'internal_source_copy',
  'customer_forbidden_internal_terms',
]);

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : null;
}

function asNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
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

function sourceBackedPriceDateProblem(pkg: AnyRecord): string | null {
  const priceDates = Array.isArray(pkg.price_dates) ? pkg.price_dates : [];
  if (priceDates.length === 0) {
    return 'public package snapshot requires source-backed price_dates before customer opening';
  }

  for (const [index, value] of priceDates.entries()) {
    const row = asRecord(value);
    const date = String(row?.date ?? '');
    const price = asNumber(row?.adult_selling_price ?? row?.price ?? row?.selling_price);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return `price_dates.${index} has no valid departure date`;
    }
    if (!price || price <= 0) {
      return `price_dates.${index} has no valid customer price`;
    }
  }

  return null;
}

function hasPublicImageCandidate(pkg: AnyRecord): boolean {
  const images = Array.isArray(pkg.images_public) ? pkg.images_public : [];
  for (const item of images) {
    if (isSafeImageSrc(item)) return true;
    const image = asRecord(item);
    if (isSafeImageSrc(image?.url ?? image?.src_large ?? image?.src_medium)) return true;
  }

  if (isSafeImageSrc(pkg.hero_image_url) || isSafeImageSrc(pkg.lp_hero_image_url)) return true;
  const thumbnails = Array.isArray(pkg.thumbnail_urls) ? pkg.thumbnail_urls : [];
  return thumbnails.some(isSafeImageSrc);
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

function findBlockingCustomerCopy(input: PublicSnapshotGateInput): { code: string; text: string } | null {
  const texts = [
    ...(input.routeTextDump ?? []),
    input.pkg.title,
    input.pkg.display_title,
    input.pkg.hero_tagline,
    input.pkg.product_summary,
    ...(Array.isArray(input.pkg.product_highlights) ? input.pkg.product_highlights : []),
    ...(Array.isArray(input.pkg.inclusions) ? input.pkg.inclusions : []),
    ...(Array.isArray(input.pkg.excludes) ? input.pkg.excludes : []),
    ...(Array.isArray(input.pkg.customer_notes) ? input.pkg.customer_notes : []),
  ].map(value => String(value ?? '')).filter(Boolean);

  for (const text of texts) {
    const issue = customerCopyQualityIssues(text).find(item => BLOCKING_CUSTOMER_COPY_CODES.has(item.code));
    if (issue) return { code: issue.code, text };
  }
  return null;
}

function unsupportedClaimInSurface(surface: CustomerClaimSurface, sourceText: string): string | null {
  const text = surface.text;
  if (!text) return null;
  const hasOnsen = /온천/.test(text);
  const strongOnsenEvidence = (sourceText.match(/온천/g) ?? []).length >= 2
    && /온천(?:호텔|료칸|숙박|마을|지구|대표|테마|리조트|여행|관광)/.test(sourceText);
  if (hasOnsen && !strongOnsenEvidence) {
    return `${surface.label} claims onsen as a theme without strong source evidence`;
  }
  const hasHotelGrade = /(?:준\s*5성|정\s*5성|5성|오성|특급\s*호텔|특급호텔)/.test(text);
  const hotelGradeEvidence =
    /(?:호텔|리조트|숙박|동급).{0,16}(?:준\s*5성|정\s*5성|5성|오성)|(?:준\s*5성|정\s*5성|5성|오성).{0,16}(?:호텔|리조트|숙박|동급|월드체인)|특급\s*호텔|특급호텔/.test(sourceText);
  if (hasHotelGrade && !hotelGradeEvidence) {
    return `${surface.label} claims 5-star or premium hotel grade without hotel-grade evidence`;
  }
  if (/출발\s*확정|출발확정/.test(text)) {
    return `${surface.label} contains risky departure-confirmed claim`;
  }
  return null;
}

function customerClaimSurfaces(input: PublicSnapshotGateInput): CustomerClaimSurface[] {
  const pkg = input.pkg;
  const card = asRecord(pkg._card_projection);
  const lp = asRecord(pkg._lp_projection);
  const badgeSurfaces = [
    ...(Array.isArray(card?.badges)
      ? card.badges.map((badge, index) => ({
        label: 'card badge',
        fieldPath: `_card_projection.badges.${index}`,
        text: String(badge ?? ''),
      }))
      : []),
    ...(Array.isArray(lp?.badges)
      ? lp.badges.map((badge, index) => ({
        label: 'LP badge',
        fieldPath: `_lp_projection.badges.${index}`,
        text: String(badge ?? ''),
      }))
      : []),
    ...(Array.isArray(pkg.badges)
      ? pkg.badges.map((badge, index) => ({
        label: 'badge',
        fieldPath: `badges.${index}`,
        text: String(badge ?? ''),
      }))
      : []),
  ];

  return [
    { label: 'title', fieldPath: 'title', text: String(pkg.display_title || pkg.title || '') },
    { label: 'subtitle', fieldPath: 'hero_tagline', text: String(pkg.hero_tagline || '') },
    { label: 'summary', fieldPath: 'product_summary', text: String(pkg.product_summary || '') },
    { label: 'card title', fieldPath: '_card_projection.title', text: String(card?.title || '') },
    { label: 'card summary', fieldPath: '_card_projection.summary', text: String(card?.summary || '') },
    { label: 'LP title', fieldPath: '_lp_projection.title', text: String(lp?.title || '') },
    { label: 'LP summary', fieldPath: '_lp_projection.summary', text: String(lp?.summary || '') },
    ...badgeSurfaces,
  ].filter(surface => surface.text.trim());
}

function findUnsupportedCustomerClaim(input: PublicSnapshotGateInput): { message: string; fieldPath: string } | null {
  const pkg = input.pkg;
  const raw = String(pkg.raw_text || '');
  const itinerary = JSON.stringify(pkg.itinerary_data ?? {});
  const sourceText = [
    raw,
    pkg.product_summary,
    ...(Array.isArray(pkg.product_highlights) ? pkg.product_highlights : []),
    ...(Array.isArray(pkg.inclusions) ? pkg.inclusions : []),
    itinerary,
  ].map(value => String(value ?? '')).join(' ');

  for (const surface of customerClaimSurfaces(input)) {
    const message = unsupportedClaimInSurface(surface, sourceText);
    if (message) return { message, fieldPath: surface.fieldPath };
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

function addMobileProofBlockers(input: PublicSnapshotGateInput, hard: PublishFinding[]): void {
  if (!input.mobileProof) {
    addBlocker(hard, 'stale_mobile_proof', 'actual /packages and /lp mobile browser proof is missing');
    return;
  }

  if (!input.mobileProof.ok) {
    addBlocker(hard, 'stale_mobile_proof', input.mobileProof.reason);
    return;
  }

  const expectedSnapshotHash = input.expectedPublicSnapshotHash?.trim() || input.publicSnapshotHash?.trim();
  if (!expectedSnapshotHash) return;

  const proof = input.mobileProof.proof;
  if (!proof?.public_snapshot_hash) {
    addBlocker(hard, 'public_snapshot_hash_mismatch', 'mobile proof is not bound to the public package snapshot hash');
    return;
  }

  if (proof.public_snapshot_hash !== expectedSnapshotHash) {
    addBlocker(hard, 'public_snapshot_hash_mismatch', 'mobile proof hash does not match the public package snapshot hash');
  }

  for (const surfaceResult of proof.surface_results ?? []) {
    if (!surfaceResult.public_snapshot_hash) {
      addBlocker(
        hard,
        'public_snapshot_hash_mismatch',
        `mobile proof ${surfaceResult.surface ?? 'surface'} result is not bound to the public package snapshot hash`,
      );
      continue;
    }
    if (surfaceResult.public_snapshot_hash !== expectedSnapshotHash) {
      addBlocker(
        hard,
        'public_snapshot_hash_mismatch',
        `mobile proof ${surfaceResult.surface ?? 'surface'} hash does not match the public package snapshot hash`,
      );
    }
  }
}

export function evaluatePublicSnapshotPublishGate(input: PublicSnapshotGateInput): PublicSnapshotGateResult {
  const hard: PublishFinding[] = [];
  const soft: PublishFinding[] = [];

  if (input.auditQueryFailed) {
    addBlocker(hard, 'audit_query_failed', input.auditQueryFailed);
  }

  if (input.customerOpenContractOk !== true) {
    for (const blocker of input.customerOpenContractBlockers ?? ['customer_open_contract missing or blocked']) {
      addBlocker(hard, 'unsupported_customer_claim', blocker);
    }
  }

  addMobileProofBlockers(input, hard);

  if (input.snapshotExists === false) {
    addBlocker(hard, 'public_snapshot_missing', 'approved public package snapshot is missing');
  }

  const priceDateProblem = sourceBackedPriceDateProblem(input.pkg);
  if (priceDateProblem) {
    addBlocker(hard, 'price_source_missing', priceDateProblem, 'price_dates');
  }

  if (!hasPublicImageCandidate(input.pkg)) {
    addBlocker(
      hard,
      'public_image_missing',
      'public package snapshot requires at least one approved customer image candidate',
      'images_public',
    );
  }

  if (input.publicSnapshotTitle !== undefined) {
    const title = String(input.publicSnapshotTitle ?? '').trim();
    if (!title) {
      addBlocker(hard, 'public_title_missing', 'public package snapshot title is missing or not policy-generated', 'public_title');
    } else if (!PUBLIC_TITLE_DURATION_RE.test(title)) {
      addBlocker(hard, 'unsupported_title_claim', 'public package snapshot title must include the verified trip duration', 'public_title');
    }
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
  for (const id of input.invalidAttractionIds ?? []) {
    addBlocker(hard, 'broken_attraction_id', `itinerary_data references an inactive, missing, or non-customer-publishable attraction_id: ${id}`, 'itinerary_data');
  }

  const unsupportedClaim = findUnsupportedCustomerClaim(input);
  if (unsupportedClaim) {
    addBlocker(hard, 'unsupported_title_claim', unsupportedClaim.message, unsupportedClaim.fieldPath);
  }

  if (hasRiskyCustomerCopy(input.routeTextDump ?? input.pkg)) {
    addBlocker(hard, 'risky_reservation_claim', 'customer copy contains risky reservation/guarantee wording');
  }

  const blockingCopy = findBlockingCustomerCopy(input);
  if (blockingCopy) {
    addBlocker(
      hard,
      blockingCopy.code,
      `blocking customer-visible copy remains in public snapshot text: ${blockingCopy.text.slice(0, 120)}`,
    );
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
