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

type AnyRecord = Record<string, unknown>;

export type SnapshotProjectionRow = {
  package_id: string;
  package_revision?: number | null;
  snapshot_json?: AnyRecord | null;
  card_projection?: AnyRecord | null;
  lp_projection?: AnyRecord | null;
  route_text_dump?: string[] | null;
  status?: string | null;
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

export function mergePackageRowsWithCurrentPublicSnapshots<T extends AnyRecord>(
  packages: T[],
  snapshotRows: SnapshotProjectionRow[],
  projection: 'card' | 'lp' = 'card',
): T[] {
  const revisionByPackage = new Map<string, number>();
  for (const pkg of packages) {
    if (!isPublicPackageRowOpenable(pkg)) continue;
    const id = packageId(pkg);
    if (id) revisionByPackage.set(id, packageRevision(pkg));
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
): Promise<T[]> {
  const ids = packages.map(packageId).filter((id): id is string => Boolean(id));
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from('public_package_snapshots')
    .select('package_id, package_revision, snapshot_json, card_projection, lp_projection, route_text_dump, status, created_at')
    .in('package_id', ids)
    .in('status', ['approved', 'published'])
    .order('created_at', { ascending: false });

  if (error) throw error;
  const publishableSnapshotRows = await filterSnapshotsWithPublishableAttractions(
    supabase,
    (data ?? []) as SnapshotProjectionRow[],
  );
  return mergePackageRowsWithCurrentPublicSnapshots(packages, publishableSnapshotRows, 'card');
}
