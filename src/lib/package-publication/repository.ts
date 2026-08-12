import type { SupabaseClient } from '@supabase/supabase-js';

import {
  auditCustomerVisibleScreenText,
  blockingCustomerVisibleTextIssues,
} from '@/lib/customer-visible-text-audit';
import {
  collectItineraryAttractionIds,
  validateCustomerPublishableAttractionIds,
} from './attraction-validation';
import { buildPublicPackageSnapshot } from './public-snapshot';
import { evaluateCustomerSurfaceParity } from './customer-surface-parity';
import { evaluatePublicSnapshotPublishGate, type PublicSnapshotGateInput } from './publish-gate';
import type { PublicPackageSnapshot } from './types';
import { loadProductRegistrationV4PublicationGate } from '@/lib/product-registration-v4/publication-gate';
import { linkV5ShadowRevisionToSnapshot } from '@/lib/product-registration-v4/snapshot-link';
import { productRegistrationLegacyWriterBlocker } from '@/lib/product-registration-v6/runtime-config';

type AnyRecord = Record<string, unknown>;

type SnapshotRow = {
  id: string;
  package_id: string;
  catalog_product_id?: string | null;
  package_revision: number;
  canonical_revision_id?: string | null;
  snapshot_hash: string;
  snapshot_json: PublicPackageSnapshot | AnyRecord;
  card_projection: AnyRecord;
  lp_projection: AnyRecord;
  route_text_dump: string[];
  renderer_build_id?: string | null;
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

function hasBlockingSnapshotCopy(pkg: AnyRecord, row: SnapshotRow): boolean {
  const productIssues = blockingCustomerVisibleTextIssues(pkg);
  if (productIssues.length > 0) return true;

  const routeText = Array.isArray(row.route_text_dump) ? row.route_text_dump.join('\n') : '';
  return auditCustomerVisibleScreenText(routeText, { surface: 'public_snapshot' })
    .some(issue => !issue.safeFixable);
}

export function snapshotPackage(row: SnapshotRow): AnyRecord | null {
  const snapshot = asRecord(row.snapshot_json);
  const pkg = asRecord(snapshot?.package);
  const cardProjection = asRecord(row.card_projection);
  const lpProjection = asRecord(row.lp_projection);
  if (!snapshot) return null;
  if (!pkg) return null;
  if (!hasSourceBackedPriceDates(pkg)) return null;
  const publicTitle = asNonEmptyString(cardProjection?.title) ?? asNonEmptyString(lpProjection?.title);
  if (!publicTitle) return null;
  const surfaceParity = evaluateCustomerSurfaceParity({
    package: pkg,
    cardProjection,
    lpProjection,
  });
  if (!surfaceParity.ok) return null;
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
      catalog_product_id: row.catalog_product_id ?? null,
      package_revision: row.package_revision,
      canonical_revision_id: row.canonical_revision_id ?? null,
      snapshot_hash: row.snapshot_hash,
      status: row.status,
      created_at: row.created_at,
    },
  };
  return hasBlockingSnapshotCopy(customerPackage, row) ? null : customerPackage;
}

/** Loads one exact immutable snapshot for a signed V6 proof request. It does
 * not require a publication pointer and must never be used by customer reads. */
export async function fetchPublicPackageSnapshotById(
  supabase: SupabaseClient,
  snapshotId: string,
): Promise<{ row: SnapshotRow; package: AnyRecord } | null> {
  const { data, error } = await supabase
    .from('public_package_snapshots')
    .select('id, package_id, catalog_product_id, package_revision, canonical_revision_id, snapshot_hash, snapshot_json, card_projection, lp_projection, route_text_dump, renderer_build_id, status, created_at')
    .eq('id', snapshotId)
    .in('status', ['candidate', 'approved', 'published'])
    .maybeSingle();
  if (error || !data) return null;
  const pkg = snapshotPackage(data as SnapshotRow);
  return pkg ? { row: data as SnapshotRow, package: pkg } : null;
}

/** Single pointer-first customer read. Content comes only from one immutable
 * snapshot; travel_packages may be used only to resolve a legacy short code. */
export async function getCurrentPublicPackage(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    packageRef: string;
    channel?: string;
    locale?: string;
  },
): Promise<{ row: SnapshotRow; package: AnyRecord } | null> {
  let packageId = input.packageRef;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(packageId)) {
    const { data: identity, error: identityError } = await supabase
      .from('travel_packages')
      .select('id')
      .eq('tenant_id', input.tenantId)
      .eq('short_code', packageId)
      .maybeSingle();
    if (identityError || !identity?.id) return null;
    packageId = String(identity.id);
  }
  const pointerQuery = supabase
    .from('product_registration_v5_publication_pointers')
    .select('tenant_id,catalog_product_id,current_revision_id,current_snapshot_id,state')
    .eq('package_id', packageId)
    .eq('tenant_id', input.tenantId)
    .eq('channel', input.channel ?? 'customer')
    .eq('locale', input.locale ?? 'ko-KR');
  const { data: pointer, error: pointerError } = await pointerQuery.maybeSingle();
  if (pointerError || !pointer || pointer.state !== 'published'
    || !pointer.catalog_product_id || !pointer.current_snapshot_id || !pointer.current_revision_id) return null;

  const { data, error } = await supabase
    .from('public_package_snapshots')
    .select('id, package_id, catalog_product_id, package_revision, canonical_revision_id, snapshot_hash, snapshot_json, card_projection, lp_projection, route_text_dump, renderer_build_id, status, created_at')
    .eq('id', pointer.current_snapshot_id)
    .eq('tenant_id', input.tenantId)
    .eq('package_id', packageId)
    .eq('catalog_product_id', pointer.catalog_product_id)
    .eq('canonical_revision_id', pointer.current_revision_id)
    .eq('status', 'published')
    .maybeSingle();
  if (error || !data) return null;
  const row = data as SnapshotRow;
  const pkg = snapshotPackage(row);
  if (!pkg) return null;

  const supplier = typeof pkg.land_operator === 'string' ? pkg.land_operator : '';
  const { data: switches, error: switchError } = await supabase
    .from('product_registration_v5_kill_switches')
    .select('scope,scope_key')
    .eq('tenant_id', input.tenantId)
    .eq('active', true)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
  if (switchError) return null;
  if ((switches ?? []).some(item => item.scope === 'global'
    || (item.scope === 'product' && [packageId, pointer.catalog_product_id, '*'].includes(String(item.scope_key)))
    || (item.scope === 'supplier' && [supplier, '*'].includes(String(item.scope_key))))) return null;
  const { data: overlays, error: overlayError } = await supabase.rpc(
    'get_product_registration_availability_overlays',
    {
      p_catalog_product_ids: [pointer.catalog_product_id],
      p_channel: input.channel ?? 'customer',
    },
  );
  if (overlayError || !Array.isArray(overlays)) return null;
  if (overlays.some(item => {
    const overlay = asRecord(item);
    if (!overlay) return false;
    return overlay.catalog_product_id === pointer.catalog_product_id
      && ['closed', 'sold_out', 'suspended'].includes(String(overlay.sale_state ?? ''));
  })) return null;

  const v4PublicationGate = await loadProductRegistrationV4PublicationGate({ supabase, packageId }).catch(() => null);
  if (!v4PublicationGate || (v4PublicationGate.required && !v4PublicationGate.ok)) return null;
  const attractionValidation = await validateCustomerPublishableAttractionIds(
    supabase,
    collectItineraryAttractionIds(pkg.itinerary_data),
  );
  if (attractionValidation.lookupError || attractionValidation.invalidIds.length > 0) return null;
  return { row, package: pkg };
}

export async function fetchLatestPublicPackageSnapshot(
  supabase: SupabaseClient,
  packageId: string,
  options: { tenantId: string; expectedPackageRevision?: number | null },
): Promise<{ row: SnapshotRow; package: AnyRecord } | null> {
  const pointerSnapshot = await getCurrentPublicPackage(supabase, {
    tenantId: options.tenantId,
    packageRef: packageId,
    channel: 'customer',
    locale: 'ko-KR',
  });
  if (pointerSnapshot) {
    if (Number.isFinite(Number(options.expectedPackageRevision))
      && pointerSnapshot.row.package_revision !== Number(options.expectedPackageRevision)) return null;
    return pointerSnapshot;
  }
  return null;
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
  v5ShadowLink: Awaited<ReturnType<typeof linkV5ShadowRevisionToSnapshot>> | null;
}> {
  const authorityBlocker = productRegistrationLegacyWriterBlocker();
  if (authorityBlocker) throw new Error(authorityBlocker);
  const packageId = String(pkg.id ?? '');
  const v4PublicationGate = packageId
    ? await loadProductRegistrationV4PublicationGate({ supabase, packageId })
    : null;
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
  const resolvedPackageId = packageId || String(snapshot.package_id);
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
    customerSurfaceParity: evaluateCustomerSurfaceParity({
      package: snapshot.package,
      cardProjection: snapshot.card_projection,
      lpProjection: snapshot.lp_projection,
    }),
    v4PublicationGate,
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
    p_package_id: resolvedPackageId,
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

  // During the V5 shadow rollout, bind only a successfully published legacy
  // snapshot to a source-backed V5 revision. This is intentionally best
  // effort so a missing V5 migration/revision cannot change legacy customer
  // publication behavior; the V5 CAS writer will make this atomic later.
  let v5ShadowLink: Awaited<ReturnType<typeof linkV5ShadowRevisionToSnapshot>> | null = null;
  if (process.env.PRODUCT_REGISTRATION_V5_SHADOW === '1' && gate.publishable) {
    v5ShadowLink = await linkV5ShadowRevisionToSnapshot({
      supabase,
      packageId: resolvedPackageId,
      snapshotHash,
      revisionId: typeof pkg.canonical_revision_id === 'string' ? pkg.canonical_revision_id : null,
      rendererBuildId: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_BUILD_ID ?? null,
    });
    if (v5ShadowLink.status === 'unavailable') {
      console.warn('[Product Registration V5] shadow snapshot lineage link unavailable:', v5ShadowLink.reason);
    }
  }

  return {
    snapshot,
    snapshotHash,
    publicationState: gate.publication_state,
    publishable: gate.publishable,
    blockers: gate.hard_blockers,
    v5ShadowLink,
  };
}
