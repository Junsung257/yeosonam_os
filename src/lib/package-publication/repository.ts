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

type AnyRecord = Record<string, unknown>;

type SnapshotRow = {
  id: string;
  package_id: string;
  package_revision: number;
  snapshot_hash: string;
  snapshot_json: PublicPackageSnapshot | AnyRecord;
  card_projection: AnyRecord;
  lp_projection: AnyRecord;
  route_text_dump: string[];
  status: string;
  created_at: string;
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

function hasSourceBackedPriceDates(value: unknown): boolean {
  const pkg = asRecord(value);
  const priceDates = Array.isArray(pkg?.price_dates) ? pkg.price_dates : [];
  if (priceDates.length === 0) return false;

  return priceDates.every((item) => {
    const row = asRecord(item);
    const date = typeof row?.date === 'string' ? row.date.trim() : '';
    const price = asNumber(row?.adult_selling_price ?? row?.price ?? row?.selling_price);
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && typeof price === 'number' && price > 0;
  });
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

  const routeText = Array.isArray(row.route_text_dump) ? row.route_text_dump.join('\n') : '';
  return auditCustomerVisibleScreenText(routeText, { surface: 'public_snapshot' })
    .some(issue => !issue.safeFixable);
}

function snapshotPackage(row: SnapshotRow): AnyRecord | null {
  const snapshot = asRecord(row.snapshot_json);
  const pkg = asRecord(snapshot?.package);
  const cardProjection = asRecord(row.card_projection);
  const lpProjection = asRecord(row.lp_projection);
  if (!snapshot) return null;
  if (!pkg) return null;
  if (!hasSourceBackedPriceDates(pkg)) return null;
  if (!hasPublicImageCandidate(snapshot, pkg)) return null;
  const publicTitle = asNonEmptyString(cardProjection?.title) ?? asNonEmptyString(lpProjection?.title);
  if (!publicTitle) return null;
  const publicSummary = asNonEmptyString(lpProjection?.summary);
  const customerPackage = {
    ...pkg,
    ...(publicTitle ? { title: publicTitle, display_title: publicTitle } : {}),
    product_summary: publicSummary,
    _canonical_view: asRecord(snapshot?.canonical_view),
    _lp_projection: lpProjection,
    _card_projection: cardProjection,
    _public_snapshot: {
      id: row.id,
      package_id: row.package_id,
      package_revision: row.package_revision,
      snapshot_hash: row.snapshot_hash,
      status: row.status,
      created_at: row.created_at,
    },
  };
  return hasBlockingSnapshotCopy(customerPackage, row) ? null : customerPackage;
}

export async function fetchLatestPublicPackageSnapshot(
  supabase: SupabaseClient,
  packageId: string,
  options: { expectedPackageRevision?: number | null } = {},
): Promise<{ row: SnapshotRow; package: AnyRecord } | null> {
  let query = supabase
    .from('public_package_snapshots')
    .select('id, package_id, package_revision, snapshot_hash, snapshot_json, card_projection, lp_projection, route_text_dump, status, created_at')
    .eq('package_id', packageId)
    .in('status', ['approved', 'published']);

  if (Number.isFinite(Number(options.expectedPackageRevision))) {
    query = query.eq('package_revision', Number(options.expectedPackageRevision));
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

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
  const { snapshot, snapshotHash } = buildPublicPackageSnapshot(pkg);
  const publicSnapshotPackage = asRecord(snapshot.package) ?? {};
  const gatePackage = {
    ...pkg,
    title: snapshot.public_title,
    display_title: snapshot.public_title,
    hero_tagline: snapshot.public_subtitle ?? pkg.hero_tagline,
    product_summary: publicSnapshotPackage.product_summary ?? pkg.product_summary,
    product_highlights: publicSnapshotPackage.product_highlights ?? [],
    marketing_copies: publicSnapshotPackage.marketing_copies ?? [],
    inclusions: snapshot.inclusions_public,
    excludes: snapshot.exclusions_public,
    optional_tours: snapshot.optional_tours_public,
    customer_notes: publicSnapshotPackage.customer_notes ?? null,
    itinerary_data: snapshot.itinerary_public,
    price: publicSnapshotPackage.price ?? pkg.price,
    price_dates: publicSnapshotPackage.price_dates ?? pkg.price_dates,
    product_prices: publicSnapshotPackage.product_prices ?? pkg.product_prices,
    images_public: snapshot.images_public,
    hero_image_url: publicSnapshotPackage.hero_image_url ?? pkg.hero_image_url,
    lp_hero_image_url: publicSnapshotPackage.lp_hero_image_url ?? pkg.lp_hero_image_url,
    thumbnail_urls: publicSnapshotPackage.thumbnail_urls ?? pkg.thumbnail_urls,
    _public_notice_source_paths: snapshot.public_notice_source_paths,
    _card_projection: snapshot.card_projection,
    _lp_projection: snapshot.lp_projection,
  };
  const packageId = String(pkg.id ?? snapshot.package_id);
  const packageRevision = Number(pkg.package_revision ?? snapshot.package_revision ?? 1);
  const attractionIds = collectItineraryAttractionIds(pkg.itinerary_data);
  const attractionValidation = await validateCustomerPublishableAttractionIds(supabase, attractionIds);
  const auditQueryFailed = [
    gateInput.auditQueryFailed,
    attractionValidation.lookupError,
  ].filter((item): item is string => typeof item === 'string' && item.trim().length > 0).join('; ') || null;
  const gate = evaluatePublicSnapshotPublishGate({
    ...gateInput,
    pkg: gatePackage,
    sourcePkg: pkg,
    publicSnapshotHash: snapshotHash,
    publicSnapshotTitle: snapshot.public_title,
    snapshotExists: true,
    routeTextDump: snapshot.route_text_dump,
    publicNoticeSourcePaths: snapshot.public_notice_source_paths,
    auditQueryFailed,
    invalidAttractionIds: attractionValidation.invalidIds,
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
    p_app_build_id: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_BUILD_ID ?? null,
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
