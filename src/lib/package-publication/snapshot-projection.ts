import type { SupabaseClient } from '@supabase/supabase-js';

import {
  auditCustomerVisibleScreenText,
  blockingCustomerVisibleTextIssues,
} from '@/lib/customer-visible-text-audit';
import { sanitizeCustomerPackageForClient } from '@/lib/customer-package-payload';
import { isCustomerPubliclyOpenable } from '@/lib/package-public-eligibility';
import {
  collectItineraryAttractionIds,
  validateCustomerPublishableAttractionIds,
} from './attraction-validation';
import { isPublicPublicationState } from './types';
import { PLATFORM_PRODUCT_REGISTRATION_TENANT_ID } from '@/lib/product-registration-authority/types';

type AnyRecord = Record<string, unknown>;

export type SnapshotProjectionRow = {
  id?: string;
  package_id: string;
  catalog_product_id?: string | null;
  package_revision?: number | null;
  canonical_revision_id?: string | null;
  snapshot_json?: AnyRecord | null;
  card_projection?: AnyRecord | null;
  lp_projection?: AnyRecord | null;
  route_text_dump?: string[] | null;
  status?: string | null;
  snapshot_hash?: string | null;
  created_at?: string | null;
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

function hasSourceBackedPriceDates(row: SnapshotProjectionRow): boolean {
  const snapshot = asRecord(row.snapshot_json);
  const pkg = asRecord(snapshot?.package);
  const priceDates = Array.isArray(pkg?.price_dates) ? pkg.price_dates : [];
  if (priceDates.length === 0) return false;

  return priceDates.every((item) => {
    const priceDate = asRecord(item);
    const date = typeof priceDate?.date === 'string' ? priceDate.date.trim() : '';
    const price = asNumber(priceDate?.adult_selling_price ?? priceDate?.price ?? priceDate?.selling_price);
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && typeof price === 'number' && price > 0;
  });
}

function packageId(row: AnyRecord): string | null {
  return typeof row.id === 'string' && row.id.trim() ? row.id : null;
}

function packageRevision(row: AnyRecord): number {
  const revision = Number(row.package_revision ?? 1);
  return Number.isFinite(revision) && revision > 0 ? revision : 1;
}

function isPublicPackageRowOpenable(row: AnyRecord): boolean {
  const publicationState = typeof row.publication_state === 'string' ? row.publication_state : null;
  return isPublicPublicationState(publicationState) && isCustomerPubliclyOpenable(row);
}

function snapshotPackage(row: SnapshotProjectionRow): AnyRecord {
  const snapshot = asRecord(row.snapshot_json);
  const pkg = asRecord(snapshot?.package) ?? {};
  return {
    ...pkg,
    _canonical_view: asRecord(snapshot?.canonical_view),
  };
}

const RAW_CUSTOMER_FIELD_KEYS = [
  'title',
  'display_title',
  'hero_tagline',
  'destination',
  'country',
  'duration',
  'days',
  'nights',
  'price',
  'price_display',
  'price_tiers',
  'price_dates',
  'summary',
  'product_summary',
  'badges',
  'product_highlights',
  'marketing_copies',
  'inclusions',
  'included',
  'excludes',
  'itinerary',
  'itinerary_data',
  'optional_tours',
  'airline',
  'departure_airport',
  'product_type',
  'hero_image_url',
  'lp_hero_image_url',
  'thumbnail_urls',
];

function stripRawCustomerFields(row: AnyRecord): AnyRecord {
  const stripped = { ...row };
  for (const key of RAW_CUSTOMER_FIELD_KEYS) {
    delete stripped[key];
  }
  return stripped;
}

function hasPublicTitle(row: SnapshotProjectionRow, projection: 'card' | 'lp'): boolean {
  const snapshot = asRecord(row.snapshot_json);
  const pkg = asRecord(snapshot?.package);
  const projectionPayload = projection === 'lp' ? asRecord(row.lp_projection) : asRecord(row.card_projection);
  return Boolean(
    asNonEmptyString(projectionPayload?.title) ||
      asNonEmptyString(pkg?.title) ||
      asNonEmptyString(pkg?.display_title),
  );
}

function hasBlockingSnapshotCopy(row: SnapshotProjectionRow, projection: 'card' | 'lp'): boolean {
  const projectionPayload = projection === 'lp' ? asRecord(row.lp_projection) : asRecord(row.card_projection);
  const customerPackage = {
    ...snapshotPackage(row),
    ...(projectionPayload ?? {}),
  };
  if (typeof customerPackage.summary === 'string' && typeof customerPackage.product_summary !== 'string') {
    customerPackage.product_summary = customerPackage.summary;
  }

  const productIssues = blockingCustomerVisibleTextIssues(customerPackage);
  if (productIssues.length > 0) return true;

  const routeText = Array.isArray(row.route_text_dump) ? row.route_text_dump.join('\n') : '';
  return auditCustomerVisibleScreenText(routeText, { surface: 'public_snapshot' })
    .some(issue => !issue.safeFixable);
}

function snapshotItineraryAttractionIds(row: SnapshotProjectionRow): string[] {
  return collectItineraryAttractionIds(snapshotPackage(row).itinerary_data);
}

async function filterSnapshotsWithPublishableAttractions(
  supabase: SupabaseClient,
  snapshotRows: SnapshotProjectionRow[],
): Promise<SnapshotProjectionRow[]> {
  const idsByRow = new Map<SnapshotProjectionRow, string[]>();
  const allIds = new Set<string>();
  for (const row of snapshotRows) {
    const ids = snapshotItineraryAttractionIds(row);
    idsByRow.set(row, ids);
    ids.forEach(id => allIds.add(id));
  }
  if (allIds.size === 0) return snapshotRows;

  const validation = await validateCustomerPublishableAttractionIds(supabase, [...allIds]);
  const invalidIds = new Set(validation.invalidIds);
  if (validation.lookupError) {
    return snapshotRows.filter(row => (idsByRow.get(row) ?? []).length === 0);
  }

  return snapshotRows.filter((row) => {
    const ids = idsByRow.get(row) ?? [];
    return ids.every(id => !invalidIds.has(id));
  });
}

function packageIdsFromState(state: unknown): string[] {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return [];
  const record = state as AnyRecord;
  const ids = Array.isArray(record.packageIds)
    ? record.packageIds.filter((value): value is string => typeof value === 'string')
    : [];
  return [
    ...(typeof record.packageId === 'string' ? [record.packageId] : []),
    ...ids,
  ];
}

function hasCanonicalSections(payload: unknown): boolean {
  const record = asRecord(payload);
  return Array.isArray(record?.sections) && record.sections.length > 0;
}

async function filterSnapshotsWithReadyV4Lineage(
  supabase: SupabaseClient,
  snapshotRows: SnapshotProjectionRow[],
): Promise<SnapshotProjectionRow[]> {
  const packageIds = [...new Set(snapshotRows.map(row => row.package_id).filter(Boolean))];
  if (packageIds.length === 0) return snapshotRows;

  const { data: drafts, error: draftsError } = await supabase
    .from('product_registration_drafts')
    .select('package_id, upload_job_id')
    .in('package_id', packageIds)
    .not('upload_job_id', 'is', null);
  if (draftsError) throw draftsError;

  const draftRows = (drafts ?? []) as Array<{ package_id?: string | null; upload_job_id?: string | null }>;
  const draftJobIds = [...new Set(draftRows.map(row => row.upload_job_id).filter((id): id is string => typeof id === 'string' && id.length > 0))];
  const draftPackageIds = new Set(
    draftRows.map(row => row.package_id).filter((id): id is string => typeof id === 'string' && id.length > 0),
  );

  let directJobs: unknown[] = [];
  if (draftJobIds.length > 0) {
    const { data, error } = await supabase
      .from('upload_jobs')
      .select('id, source_document_id, extraction_id, v4_stage, v4_stage_state, v4_canonical_normalization_id')
      .in('id', draftJobIds);
    if (error) throw error;
    directJobs = (data ?? []) as unknown[];
  }
  const { data: fallbackJobs, error: fallbackJobsError } = await supabase
    .from('upload_jobs')
    .select('id, source_document_id, extraction_id, v4_stage, v4_stage_state, v4_canonical_normalization_id')
    .in('v4_stage', ['normalized', 'verified', 'proofed', 'published', 'needs_review', 'failed'])
    .not('source_document_id', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(2000);
  if (fallbackJobsError) throw fallbackJobsError;

  type LineageJob = {
    id?: string | null;
    source_document_id?: string | null;
    extraction_id?: string | null;
    v4_stage?: string | null;
    v4_stage_state?: unknown;
    v4_canonical_normalization_id?: string | null;
  };
  const jobsById = new Map<string, LineageJob>();
  for (const row of [...directJobs, ...(fallbackJobs ?? [])] as LineageJob[]) {
    if (typeof row.id === 'string' && !jobsById.has(row.id)) jobsById.set(row.id, row);
  }

  const packageIdsByJobId = new Map<string, Set<string>>();
  const addJobPackage = (jobId: string, packageId: string) => {
    const ids = packageIdsByJobId.get(jobId) ?? new Set<string>();
    ids.add(packageId);
    packageIdsByJobId.set(jobId, ids);
  };
  for (const row of draftRows) {
    if (row.package_id && row.upload_job_id) addJobPackage(row.upload_job_id, row.package_id);
  }
  for (const job of jobsById.values()) {
    if (!job.id) continue;
    for (const packageId of packageIdsFromState(job.v4_stage_state)) addJobPackage(job.id, packageId);
  }

  const normalizationIds = [...new Set(
    [...jobsById.values()]
      .map(job => job.v4_canonical_normalization_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  )];
  const { data: normalizations, error: normalizationsError } = normalizationIds.length > 0
    ? await supabase
      .from('product_registration_v4_normalizations')
      .select('id, job_id, source_document_id, extraction_id, canonical_payload, status')
      .in('id', normalizationIds)
      .eq('status', 'complete')
    : { data: [], error: null };
  if (normalizationsError) throw normalizationsError;
  const completeNormalizations = new Map<string, {
    job_id?: string | null;
    source_document_id?: string | null;
    extraction_id?: string | null;
    canonical_payload?: unknown;
  }>();
  for (const row of (normalizations ?? []) as Array<Record<string, unknown>>) {
    if (typeof row.id === 'string') completeNormalizations.set(row.id, row);
  }

  const v4PackageIds = new Set<string>(draftPackageIds);
  const readyPackageIds = new Set<string>();
  for (const [jobId, jobPackageIds] of packageIdsByJobId.entries()) {
    const job = jobsById.get(jobId);
    if (!job) continue;
    const normalizationId = typeof job.v4_canonical_normalization_id === 'string'
      ? job.v4_canonical_normalization_id
      : null;
    const normalization = normalizationId ? completeNormalizations.get(normalizationId) : null;
    const ready = Boolean(
      job.source_document_id
      && job.extraction_id
      && ['normalized', 'verified', 'proofed', 'published'].includes(job.v4_stage ?? '')
      && normalization
      && normalization.job_id === job.id
      && normalization.source_document_id === job.source_document_id
      && normalization.extraction_id === job.extraction_id
      && hasCanonicalSections(normalization.canonical_payload),
    );
    for (const packageId of jobPackageIds) {
      v4PackageIds.add(packageId);
      if (ready) readyPackageIds.add(packageId);
    }
  }

  return snapshotRows.filter(row => !v4PackageIds.has(row.package_id) || readyPackageIds.has(row.package_id));
}

export function mergePackageRowsWithCurrentPublicSnapshots<T extends AnyRecord>(
  packages: T[],
  snapshotRows: SnapshotProjectionRow[],
  projection: 'card' | 'lp' = 'card',
): T[] {
  const revisionByPackage = new Map<string, number>();
  const authoritativeV5ByPackage = new Set<string>();
  for (const snapshot of snapshotRows) {
    if (snapshot.canonical_revision_id && ['approved', 'published'].includes(String(snapshot.status ?? ''))) {
      authoritativeV5ByPackage.add(snapshot.package_id);
    }
  }
  for (const pkg of packages) {
    const id = packageId(pkg);
    if (!id) continue;
    if (!isPublicPackageRowOpenable(pkg) && !authoritativeV5ByPackage.has(id)) continue;
    const authoritative = snapshotRows.find(snapshot => snapshot.package_id === id && snapshot.canonical_revision_id);
    revisionByPackage.set(id, authoritative ? Number(authoritative.package_revision ?? 1) : packageRevision(pkg));
  }

  const snapshotByPackage = new Map<string, SnapshotProjectionRow>();
  for (const row of snapshotRows) {
    const expectedRevision = revisionByPackage.get(row.package_id);
    if (!expectedRevision) continue;
    if (Number(row.package_revision ?? 1) !== expectedRevision) continue;
    if (!hasPublicTitle(row, projection)) continue;
    if (!hasSourceBackedPriceDates(row)) continue;
    if (hasBlockingSnapshotCopy(row, projection)) continue;
    if (!snapshotByPackage.has(row.package_id)) snapshotByPackage.set(row.package_id, row);
  }

  return packages
    .filter(pkg => {
      const id = packageId(pkg);
      return Boolean(id && snapshotByPackage.has(id));
    })
    .map((pkg) => {
      const id = packageId(pkg) as string;
      const snapshot = snapshotByPackage.get(id) as SnapshotProjectionRow;
      const projectionPayload = projection === 'lp' ? snapshot.lp_projection : snapshot.card_projection;
      const mergedPackage = {
        ...stripRawCustomerFields(pkg),
        ...snapshotPackage(snapshot),
        ...(projectionPayload ?? {}),
        id,
        _public_snapshot: {
          id: snapshot.id ?? null,
          snapshot_hash: snapshot.snapshot_hash ?? null,
          status: snapshot.status ?? null,
          created_at: snapshot.created_at ?? null,
          package_revision: snapshot.package_revision ?? null,
        },
      };
      return sanitizeCustomerPackageForClient(mergedPackage) ?? { id };
    }) as unknown as T[];
}

export async function fetchAndMergeCurrentPublicPackageCardSnapshots<T extends AnyRecord>(
  supabase: SupabaseClient,
  packages: T[],
  options: { tenantId?: string; channel?: string; locale?: string } = {},
): Promise<T[]> {
  const ids = packages.map(packageId).filter((id): id is string => Boolean(id));
  if (ids.length === 0) return [];
  const tenantId = options.tenantId ?? PLATFORM_PRODUCT_REGISTRATION_TENANT_ID;

  const { data: pointers, error: pointerError } = await supabase
    .from('product_registration_v5_publication_pointers')
    .select('package_id,catalog_product_id,current_revision_id,current_snapshot_id,state')
    .eq('tenant_id', tenantId)
    .in('package_id', ids)
    .eq('channel', options.channel ?? 'customer')
    .eq('locale', options.locale ?? 'ko-KR')
    .eq('state', 'published');
  if (pointerError) throw pointerError;
  const pointerByPackage = new Map((pointers ?? []).map(pointer => [String(pointer.package_id), pointer]));
  const catalogProductIds = [...new Set((pointers ?? [])
    .map(pointer => String(pointer.catalog_product_id ?? ''))
    .filter(Boolean))];
  const { data: overlays, error: overlayError } = await supabase.rpc(
    'get_product_registration_availability_overlays',
    {
      p_catalog_product_ids: catalogProductIds,
      p_channel: options.channel ?? 'customer',
    },
  );
  if (overlayError || !Array.isArray(overlays)) throw overlayError ?? new Error('PACKAGE_AVAILABILITY_OVERLAY_UNAVAILABLE');
  const blockedCatalogProducts = new Set(overlays
    .map(asRecord)
    .filter((row): row is AnyRecord => Boolean(row
      && ['closed', 'sold_out', 'suspended'].includes(String(row.sale_state ?? ''))))
    .map(row => String(row.catalog_product_id ?? ''))
    .filter(Boolean));
  const { data: activeSwitches, error: switchError } = await supabase
    .from('product_registration_v5_kill_switches')
    .select('scope,scope_key')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
  if (switchError) throw switchError;
  if ((activeSwitches ?? []).some(item => item.scope === 'global')) return [];
  const blockedProducts = new Set((activeSwitches ?? [])
    .filter(item => item.scope === 'product')
    .map(item => String(item.scope_key)));
  const blockedSuppliers = new Set((activeSwitches ?? [])
    .filter(item => item.scope === 'supplier')
    .map(item => String(item.scope_key)));
  const safePackages = packages.filter(pkg => {
    const id = packageId(pkg);
    const catalogProductId = id
      ? String(pointerByPackage.get(id)?.catalog_product_id ?? '')
      : '';
    const supplier = typeof pkg.land_operator === 'string' ? pkg.land_operator : '';
    return Boolean(id && !blockedProducts.has('*') && !blockedProducts.has(id)
      && !blockedProducts.has(catalogProductId)
      && !blockedCatalogProducts.has(catalogProductId)
      && !blockedSuppliers.has('*') && !blockedSuppliers.has(supplier));
  });

  const { data, error } = await supabase
    .from('public_package_snapshots')
    .select('id, package_id, catalog_product_id, package_revision, canonical_revision_id, snapshot_hash, snapshot_json, card_projection, lp_projection, route_text_dump, status, created_at')
    .in('package_id', ids)
    .eq('tenant_id', tenantId)
    .in('status', ['approved', 'published'])
    .order('created_at', { ascending: false });

  if (error) throw error;
  const pointerBoundRows = ((data ?? []) as SnapshotProjectionRow[]).filter(row => {
    const pointer = pointerByPackage.get(row.package_id);
    if (!pointer) return false;
    return Boolean(pointer.catalog_product_id)
      && pointer.catalog_product_id === row.catalog_product_id
      && pointer.current_snapshot_id === row.id
      && pointer.current_revision_id === row.canonical_revision_id
      && row.status === 'published';
  });
  const publishableSnapshotRows = await filterSnapshotsWithPublishableAttractions(
    supabase,
    pointerBoundRows,
  );
  const v4ReadySnapshotRows = await filterSnapshotsWithReadyV4Lineage(supabase, publishableSnapshotRows);
  return mergePackageRowsWithCurrentPublicSnapshots(safePackages, v4ReadySnapshotRows, 'card')
    .filter(pkg => {
      const supplier = typeof pkg.land_operator === 'string' ? pkg.land_operator : '';
      return !blockedSuppliers.has('*') && !blockedSuppliers.has(supplier);
    });
}

/** Lists customer/channel packages from publication pointers alone. The
 * compatibility table is not queried, so this is the required discovery
 * reader once Registration Kernel authority is active. */
export async function listCurrentPublicPackageCardSnapshots(
  supabase: SupabaseClient,
  options: {
    tenantId?: string;
    channel?: string;
    locale?: string;
    limit?: number;
  } = {},
): Promise<AnyRecord[]> {
  const limit = Math.max(1, Math.min(5_000, options.limit ?? 1_000));
  const tenantId = options.tenantId ?? PLATFORM_PRODUCT_REGISTRATION_TENANT_ID;
  const pointerQuery = supabase
    .from('product_registration_v5_publication_pointers')
    .select('package_id,catalog_product_id,current_revision_id,current_snapshot_id,state')
    .eq('tenant_id', tenantId)
    .eq('channel', options.channel ?? 'customer')
    .eq('locale', options.locale ?? 'ko-KR')
    .eq('state', 'published')
    .not('package_id', 'is', null)
    .not('catalog_product_id', 'is', null)
    .not('current_revision_id', 'is', null)
    .not('current_snapshot_id', 'is', null)
    .limit(limit);
  const { data: pointers, error } = await pointerQuery;
  if (error) throw error;
  const candidates = (pointers ?? []).map(pointer => ({
    id: String(pointer.package_id),
    catalog_product_id: String(pointer.catalog_product_id),
    publication_state: 'published',
    status: 'active',
  }));
  return fetchAndMergeCurrentPublicPackageCardSnapshots(supabase, candidates, {
    tenantId,
    channel: options.channel,
    locale: options.locale,
  });
}
