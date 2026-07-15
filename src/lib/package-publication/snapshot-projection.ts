import type { SupabaseClient } from '@supabase/supabase-js';

import {
  auditCustomerVisibleScreenText,
  blockingCustomerVisibleTextIssues,
} from '@/lib/customer-visible-text-audit';
import { sanitizeCustomerPackageForClient } from '@/lib/customer-package-payload';
import { isSafeImageSrc } from '@/lib/image-url';
import {
  collectItineraryAttractionIds,
  validateCustomerPublishableAttractionIds,
} from './attraction-validation';

type AnyRecord = Record<string, unknown>;

export type SnapshotProjectionRow = {
  package_id: string;
  published_snapshot_id?: string | null;
  package_revision?: number | null;
  snapshot_hash?: string | null;
  snapshot_schema_version?: string | null;
  publish_gate_version?: string | null;
  source_evidence_digest?: string | null;
  snapshot_json?: AnyRecord | null;
  card_projection?: AnyRecord | null;
  lp_projection?: AnyRecord | null;
  detail_projection?: AnyRecord | null;
  route_text_projection?: string[] | null;
  route_text_dump?: string[] | null;
  status?: string | null;
  snapshot_created_at?: string | null;
  created_at?: string | null;
  published_at?: string | null;
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

function hasSourceBackedCustomerPrice(row: SnapshotProjectionRow, projection: 'card' | 'lp'): boolean {
  const snapshot = asRecord(row.snapshot_json);
  const pkg = asRecord(snapshot?.package);
  const priceDates = Array.isArray(pkg?.price_dates) ? pkg.price_dates : [];
  const hasValidPriceDates = priceDates.length > 0 && priceDates.every((item) => {
    const priceDate = asRecord(item);
    const date = typeof priceDate?.date === 'string' ? priceDate.date.trim() : '';
    const price = asNumber(priceDate?.adult_selling_price ?? priceDate?.price ?? priceDate?.selling_price);
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && typeof price === 'number' && price > 0;
  });
  if (hasValidPriceDates) return true;

  const projectionPayload = projection === 'lp'
    ? asRecord(row.detail_projection ?? row.lp_projection)
    : asRecord(row.card_projection);
  const display = asNonEmptyString(projectionPayload?.price_display ?? snapshot?.price_display);
  const price = asNumber(projectionPayload?.price ?? pkg?.price);
  return Boolean(display && price && price > 0);
}

function hasPublicImageCandidate(row: SnapshotProjectionRow): boolean {
  const snapshot = asRecord(row.snapshot_json);
  const pkg = asRecord(snapshot?.package);
  const images = Array.isArray(snapshot?.images_public) ? snapshot.images_public : [];
  for (const item of images) {
    if (isSafeImageSrc(item)) return true;
    const image = asRecord(item);
    if (isSafeImageSrc(image?.url ?? image?.src_large ?? image?.src_medium)) return true;
  }

  if (isSafeImageSrc(pkg?.hero_image_url) || isSafeImageSrc(pkg?.lp_hero_image_url)) return true;
  const thumbnails = Array.isArray(pkg?.thumbnail_urls) ? pkg.thumbnail_urls : [];
  return thumbnails.some(isSafeImageSrc);
}

function packageId(row: AnyRecord): string | null {
  return typeof row.id === 'string' && row.id.trim() ? row.id : null;
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
  const projectionPayload = projection === 'lp'
    ? asRecord(row.detail_projection ?? row.lp_projection)
    : asRecord(row.card_projection);
  return Boolean(
    asNonEmptyString(projectionPayload?.title) ||
      asNonEmptyString(pkg?.title) ||
      asNonEmptyString(pkg?.display_title),
  );
}

function hasBlockingSnapshotCopy(row: SnapshotProjectionRow, projection: 'card' | 'lp'): boolean {
  const projectionPayload = projection === 'lp'
    ? asRecord(row.detail_projection ?? row.lp_projection)
    : asRecord(row.card_projection);
  const customerPackage = {
    ...snapshotPackage(row),
    ...(projectionPayload ?? {}),
  };
  if (typeof customerPackage.summary === 'string' && typeof customerPackage.product_summary !== 'string') {
    customerPackage.product_summary = customerPackage.summary;
  }

  const productIssues = blockingCustomerVisibleTextIssues(customerPackage);
  if (productIssues.length > 0) return true;

  const routeTextValues = row.route_text_projection ?? row.route_text_dump;
  const routeText = Array.isArray(routeTextValues) ? routeTextValues.join('\n') : '';
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

export function mergePackageRowsWithCurrentPublicSnapshots<T extends AnyRecord>(
  packages: T[],
  snapshotRows: SnapshotProjectionRow[],
  projection: 'card' | 'lp' = 'card',
): T[] {
  const selectedPackageIds = new Set(packages.map(packageId).filter((id): id is string => Boolean(id)));

  const snapshotByPackage = new Map<string, SnapshotProjectionRow>();
  for (const row of snapshotRows) {
    if (!selectedPackageIds.has(row.package_id)) continue;
    if (!hasPublicTitle(row, projection)) continue;
    if (!hasSourceBackedCustomerPrice(row, projection)) continue;
    if (!hasPublicImageCandidate(row)) continue;
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
      const projectionPayload = projection === 'lp'
        ? snapshot.detail_projection ?? snapshot.lp_projection
        : snapshot.card_projection;
      const mergedPackage = {
        ...stripRawCustomerFields(pkg),
        ...snapshotPackage(snapshot),
        ...(projectionPayload ?? {}),
        id,
        _public_snapshot: {
          id: snapshot.published_snapshot_id ?? null,
          hash: snapshot.snapshot_hash ?? null,
          schema_version: snapshot.snapshot_schema_version ?? null,
          publish_gate_version: snapshot.publish_gate_version ?? null,
          source_evidence_digest: snapshot.source_evidence_digest ?? null,
          status: 'published',
          created_at: snapshot.snapshot_created_at ?? snapshot.created_at ?? null,
          published_at: snapshot.published_at ?? null,
          package_revision: snapshot.package_revision ?? null,
        },
      };
      return sanitizeCustomerPackageForClient(mergedPackage) ?? { id };
    }) as unknown as T[];
}

export async function fetchAndMergeCurrentPublicPackageCardSnapshots<T extends AnyRecord>(
  supabase: SupabaseClient,
  packages: T[],
): Promise<T[]> {
  const ids = packages.map(packageId).filter((id): id is string => Boolean(id));
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from('published_public_package_cards_v1')
    .select('package_id, published_snapshot_id, package_revision, snapshot_hash, snapshot_schema_version, publish_gate_version, source_evidence_digest, snapshot_json, card_projection, route_text_projection, snapshot_created_at, published_at')
    .in('package_id', ids);

  if (error) throw error;
  const publishableSnapshotRows = await filterSnapshotsWithPublishableAttractions(
    supabase,
    (data ?? []) as SnapshotProjectionRow[],
  );
  return mergePackageRowsWithCurrentPublicSnapshots(packages, publishableSnapshotRows, 'card');
}
