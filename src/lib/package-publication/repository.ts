import type { SupabaseClient } from '@supabase/supabase-js';

import {
  auditCustomerVisibleScreenText,
  blockingCustomerVisibleTextIssues,
} from '@/lib/customer-visible-text-audit';
import { isSafeImageSrc } from '@/lib/image-url';
import {
  collectItineraryAttractionIds,
  validateCustomerPublishableAttractionIds,
} from './attraction-validation';
import { buildPublicPackageSnapshot } from './public-snapshot';
import { evaluatePublicSnapshotPublishGate, type PublicSnapshotGateInput } from './publish-gate';
import type { PublicPackageSnapshot } from './types';
import { applyDeterministicFieldQuarantine } from './field-quarantine';
import { buildFieldEvidenceRecords } from './field-evidence';
import { buildCustomerPackageMobileProofInputHash } from './proof-input';

type AnyRecord = Record<string, unknown>;

type SnapshotRow = {
  package_id: string;
  published_snapshot_id?: string;
  package_revision: number;
  snapshot_hash: string;
  snapshot_schema_version?: string;
  publish_gate_version?: string;
  source_evidence_digest?: string;
  snapshot_json: PublicPackageSnapshot | AnyRecord;
  detail_projection?: AnyRecord;
  lp_projection?: AnyRecord;
  route_text_projection?: string[];
  route_text_dump?: string[];
  snapshot_created_at?: string;
  created_at?: string;
  published_at: string | null;
};

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function hasSourceBackedCustomerPrice(snapshot: AnyRecord, pkg: AnyRecord): boolean {
  const priceDates = Array.isArray(pkg?.price_dates) ? pkg.price_dates : [];
  const hasValidPriceDates = priceDates.length > 0 && priceDates.every((item) => {
    const row = asRecord(item);
    const date = typeof row?.date === 'string' ? row.date.trim() : '';
    const price = asNumber(row?.adult_selling_price ?? row?.price ?? row?.selling_price);
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && typeof price === 'number' && price > 0;
  });
  if (hasValidPriceDates) return true;
  const price = asNumber(pkg.price);
  return Boolean(price && price > 0 && asNonEmptyString(snapshot.price_display));
}

function hasPublicImageCandidate(snapshot: AnyRecord, pkg: AnyRecord): boolean {
  const images = Array.isArray(snapshot.images_public) ? snapshot.images_public : [];
  for (const item of images) {
    if (isSafeImageSrc(item)) return true;
    const image = asRecord(item);
    if (isSafeImageSrc(image?.url ?? image?.src_large ?? image?.src_medium)) return true;
  }

  if (isSafeImageSrc(pkg.hero_image_url) || isSafeImageSrc(pkg.lp_hero_image_url)) return true;
  const thumbnails = Array.isArray(pkg.thumbnail_urls) ? pkg.thumbnail_urls : [];
  return thumbnails.some(isSafeImageSrc);
}

function hasBlockingSnapshotCopy(pkg: AnyRecord, row: SnapshotRow): boolean {
  const productIssues = blockingCustomerVisibleTextIssues(pkg);
  if (productIssues.length > 0) return true;

  const routeTextValues = row.route_text_projection ?? row.route_text_dump;
  const routeText = Array.isArray(routeTextValues) ? routeTextValues.join('\n') : '';
  return auditCustomerVisibleScreenText(routeText, { surface: 'public_snapshot' })
    .some(issue => !issue.safeFixable);
}

function snapshotPackage(row: SnapshotRow): AnyRecord | null {
  const snapshot = asRecord(row.snapshot_json);
  const pkg = asRecord(snapshot?.package);
  const lpProjection = asRecord(row.detail_projection ?? row.lp_projection);
  if (!snapshot) return null;
  if (!pkg) return null;
  if (!hasSourceBackedCustomerPrice(snapshot, pkg)) return null;
  if (!hasPublicImageCandidate(snapshot, pkg)) return null;
  const publicTitle = asNonEmptyString(lpProjection?.title) ?? asNonEmptyString(snapshot?.public_title);
  if (!publicTitle) return null;
  const publicSummary = asNonEmptyString(lpProjection?.summary);
  const customerPackage = {
    ...pkg,
    ...(publicTitle ? { title: publicTitle, display_title: publicTitle } : {}),
    product_summary: publicSummary,
    _canonical_view: asRecord(snapshot?.canonical_view),
    _lp_projection: lpProjection,
    _public_snapshot: {
      id: row.published_snapshot_id ?? null,
      package_id: row.package_id,
      package_revision: row.package_revision,
      snapshot_hash: row.snapshot_hash,
      snapshot_schema_version: row.snapshot_schema_version,
      publish_gate_version: row.publish_gate_version,
      source_evidence_digest: row.source_evidence_digest,
      status: 'published',
      created_at: row.snapshot_created_at ?? row.created_at ?? null,
      published_at: row.published_at,
    },
  };
  return hasBlockingSnapshotCopy(customerPackage, row) ? null : customerPackage;
}

export async function fetchPromotedPublicPackageSnapshot(
  supabase: SupabaseClient,
  packageId: string,
): Promise<{ row: SnapshotRow; package: AnyRecord } | null> {
  const query = supabase
    .from('published_public_package_details_v1')
    .select('package_id, published_snapshot_id, package_revision, snapshot_hash, snapshot_schema_version, publish_gate_version, source_evidence_digest, snapshot_json, detail_projection, route_text_projection, snapshot_created_at, published_at')
    .eq('package_id', packageId);

  const { data, error } = await query.maybeSingle();

  if (error || !data) return null;
  const pkg = snapshotPackage(data as SnapshotRow);
  if (!pkg) return null;
  const attractionValidation = await validateCustomerPublishableAttractionIds(
    supabase,
    collectItineraryAttractionIds(pkg.itinerary_data),
  );
  if (attractionValidation.lookupError || attractionValidation.invalidIds.length > 0) return null;
  return { row: data as SnapshotRow, package: pkg };
}

export async function createPublicPackageSnapshotAndDecision(
  supabase: SupabaseClient,
  pkg: AnyRecord,
  gateInput: Omit<PublicSnapshotGateInput, 'pkg' | 'sourcePkg' | 'publicSnapshotHash' | 'publicSnapshotTitle' | 'snapshotExists' | 'routeTextDump'> = {},
  options: { packagePatch?: AnyRecord; blockedPackagePatch?: AnyRecord } = {},
): Promise<{
  snapshot: PublicPackageSnapshot;
  snapshotHash: string;
  publicationState: string;
  publishable: boolean;
  blockers: unknown[];
}> {
  const { repairedPackage, findings: quarantineFindings } = applyDeterministicFieldQuarantine(pkg);
  const { snapshot, snapshotHash } = buildPublicPackageSnapshot(repairedPackage);
  const fieldEvidenceRecords = buildFieldEvidenceRecords(repairedPackage, snapshot);
  const evidenceFields = new Set(fieldEvidenceRecords.map(record => record.field_path));
  const missingRequiredEvidenceFields = [
    'public_title',
    'duration',
    'destinations',
    'price_display',
    'itinerary_public',
    'images_public',
    'cta_copy',
  ].filter(field => !evidenceFields.has(field));
  const appBuildId = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_BUILD_ID ?? null;
  const expectedProofInputHash = buildCustomerPackageMobileProofInputHash({
    publicSnapshotHash: snapshotHash,
    sourceEvidenceDigest: snapshot.source_evidence_digest,
    assetUrls: snapshot.images_public.map(image => image.url),
    appBuildId,
  });
  const publicSnapshotPackage = asRecord(snapshot.package) ?? {};
  const gatePackage = {
    ...repairedPackage,
    title: snapshot.public_title,
    display_title: snapshot.public_title,
    hero_tagline: snapshot.public_subtitle ?? repairedPackage.hero_tagline,
    product_summary: publicSnapshotPackage.product_summary ?? repairedPackage.product_summary,
    product_highlights: publicSnapshotPackage.product_highlights ?? [],
    marketing_copies: publicSnapshotPackage.marketing_copies ?? [],
    inclusions: snapshot.inclusions_public,
    excludes: snapshot.exclusions_public,
    optional_tours: snapshot.optional_tours_public,
    customer_notes: publicSnapshotPackage.customer_notes ?? null,
    itinerary_data: snapshot.itinerary_public,
    price: publicSnapshotPackage.price ?? repairedPackage.price,
    price_dates: publicSnapshotPackage.price_dates ?? repairedPackage.price_dates,
    product_prices: publicSnapshotPackage.product_prices ?? repairedPackage.product_prices,
    images_public: snapshot.images_public,
    hero_image_url: publicSnapshotPackage.hero_image_url ?? repairedPackage.hero_image_url,
    lp_hero_image_url: publicSnapshotPackage.lp_hero_image_url ?? repairedPackage.lp_hero_image_url,
    thumbnail_urls: publicSnapshotPackage.thumbnail_urls ?? repairedPackage.thumbnail_urls,
    _public_notice_source_paths: snapshot.public_notice_source_paths,
    _card_projection: snapshot.card_projection,
    _lp_projection: snapshot.lp_projection,
  };
  const packageId = String(pkg.id ?? snapshot.package_id);
  const packageRevision = Number(pkg.package_revision ?? snapshot.package_revision ?? 1);
  const attractionIds = collectItineraryAttractionIds(repairedPackage.itinerary_data);
  const [attractionValidation, quarantineResult] = await Promise.all([
    validateCustomerPublishableAttractionIds(supabase, attractionIds),
    supabase
      .from('quarantined_package_fields')
      .select('field_path, original_value_hash, detector_rule_version')
      .eq('package_id', packageId)
      .eq('resolution_status', 'active_unresolved'),
  ]);
  const auditQueryFailed = [
    gateInput.auditQueryFailed,
    attractionValidation.lookupError,
    quarantineResult.error ? `quarantine lookup failed: ${quarantineResult.error.message}` : null,
  ].filter((item): item is string => typeof item === 'string' && item.trim().length > 0).join('; ') || null;
  const plannedQuarantineKeys = new Set(quarantineFindings.map(item => (
    `${item.fieldPath}:${item.originalValueHash}:${item.detectorRuleVersion}`
  )));
  const activeUnresolvedPollutionCount = ((quarantineResult.data ?? []) as Array<{
    field_path: string;
    original_value_hash: string;
    detector_rule_version: string;
  }>).filter(item => !plannedQuarantineKeys.has(
    `${item.field_path}:${item.original_value_hash}:${item.detector_rule_version}`,
  )).length;
  const gate = evaluatePublicSnapshotPublishGate({
    ...gateInput,
    pkg: gatePackage,
    sourcePkg: repairedPackage,
    publicSnapshotHash: snapshotHash,
    publicSnapshotTitle: snapshot.public_title,
    snapshotExists: true,
    routeTextDump: snapshot.route_text_dump,
    publicNoticeSourcePaths: snapshot.public_notice_source_paths,
    auditQueryFailed,
    invalidAttractionIds: attractionValidation.invalidIds,
    activeUnresolvedPollutionCount,
    missingRequiredEvidenceFields,
    expectedProofInputHash,
  });
  const snapshotStatus = gate.publishable ? 'published' : 'blocked';
  const callerPatch = gate.publishable
    ? options.packagePatch ?? {}
    : options.blockedPackagePatch ?? options.packagePatch ?? {};
  const patchUpdatedAt = typeof callerPatch.updated_at === 'string'
    ? callerPatch.updated_at
    : new Date().toISOString();
  const packagePatch = {
    ...callerPatch,
    ...(quarantineFindings.length > 0 ? {
      optional_tours: repairedPackage.optional_tours,
      itinerary_data: repairedPackage.itinerary_data,
    } : {}),
    status: gate.publishable ? 'active' : 'draft',
    publication_state: gate.publication_state,
    package_revision: packageRevision,
    updated_at: patchUpdatedAt,
  };

  const { error: publishError } = await supabase.rpc('publish_package_snapshot_atomic', {
    p_package_id: packageId,
    p_package_revision: packageRevision,
    p_package_patch: packagePatch,
    p_snapshot_hash: snapshotHash,
    p_snapshot_json: snapshot,
    p_card_projection: snapshot.card_projection,
    p_lp_projection: snapshot.lp_projection,
    p_route_text_dump: snapshot.route_text_dump,
    p_source_raw_text_hash: typeof pkg.raw_text_hash === 'string' ? pkg.raw_text_hash : null,
    p_audit_revision: typeof pkg.audit_checked_at === 'string' ? pkg.audit_checked_at : null,
    p_mobile_proof_revision: typeof gateInput.mobileProof?.proof?.checked_at === 'string'
      ? gateInput.mobileProof.proof.checked_at
      : null,
    p_app_build_id: appBuildId,
    p_snapshot_status: snapshotStatus,
    p_publication_state: gate.publication_state,
    p_publishable: gate.publishable,
    p_hard_blockers: gate.hard_blockers,
    p_soft_warnings: gate.soft_warnings,
    p_required_actions: gate.required_actions,
    p_audit_run_ref: null,
    p_mobile_proof_ref: typeof gateInput.mobileProof?.proof?.checked_at === 'string'
      ? gateInput.mobileProof.proof.checked_at
      : null,
    p_decision_source: 'publish_gate_v1',
    p_quarantine_candidates: quarantineFindings.map(item => ({
      field_path: item.fieldPath,
      old_value: item.originalValue,
      original_value_hash: item.originalValueHash,
      source_section: item.sourceSection,
      reason_code: item.reasonCode,
      detector_rule_version: item.detectorRuleVersion,
      resolution_status: 'historical_quarantined',
      audit_payload: { repair: 'deterministic_field_quarantine' },
    })),
    p_field_evidence_records: fieldEvidenceRecords,
    p_render_proof_payload: gateInput.mobileProof?.proof ?? {},
    p_revoke_previous: false,
    p_revocation_reason: null,
  });

  if (publishError) throw publishError;

  return {
    snapshot,
    snapshotHash,
    publicationState: gate.publication_state,
    publishable: gate.publishable,
    blockers: gate.hard_blockers,
  };
}
