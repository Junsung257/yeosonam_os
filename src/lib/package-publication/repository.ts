import type { SupabaseClient } from '@supabase/supabase-js';

import {
  auditCustomerVisibleScreenText,
  blockingCustomerVisibleTextIssues,
} from '@/lib/customer-visible-text-audit';
import { evaluateCustomerSurfaceParity } from './customer-surface-parity';
import { resolveCustomerRouteState } from './customer-route-state';
import type { PublicSnapshotGateInput } from './publish-gate';
import type { PublicPackageSnapshot } from './types';

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

export function snapshotPackage(
  row: SnapshotRow,
  options: { allowProofCopyIssues?: boolean } = {},
): AnyRecord | null {
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
      renderer_build_id: row.renderer_build_id ?? null,
      status: row.status,
      created_at: row.created_at,
    },
  };
  // A signed proof is a private diagnostic render of an immutable candidate.
  // It must be able to show the exact text that caused a proof or copy gate to
  // fail; otherwise the proof route returns a misleading 404 and the workflow
  // records a system failure without any inspectable customer output. Public
  // readers keep the strict audit below, while proof callers opt in explicitly.
  return !options.allowProofCopyIssues && hasBlockingSnapshotCopy(customerPackage, row)
    ? null
    : customerPackage;
}

/** Loads one exact immutable snapshot for a signed V6 proof request. It does
 * not require a publication pointer and must never be used by customer reads. */
export async function fetchPublicPackageSnapshotById(
  supabase: SupabaseClient,
  snapshotId: string,
  options: { allowProofCopyIssues?: boolean } = {},
): Promise<{ row: SnapshotRow; package: AnyRecord } | null> {
  const { data, error } = await supabase
    .from('public_package_snapshots')
    .select('id, package_id, catalog_product_id, package_revision, canonical_revision_id, snapshot_hash, snapshot_json, card_projection, lp_projection, route_text_dump, renderer_build_id, status, created_at')
    .eq('id', snapshotId)
    .in('status', ['candidate', 'approved', 'published'])
    .maybeSingle();
  if (error || !data) return null;
  const pkg = snapshotPackage(data as SnapshotRow, options);
  return pkg ? { row: data as SnapshotRow, package: pkg } : null;
}

export type CurrentPublicPackageResolution =
  | { state: 'PUBLIC'; row: SnapshotRow; package: AnyRecord }
  | { state: 'UNDER_REVIEW' }
  | { state: 'NOT_FOUND' }
  | { state: 'UNAVAILABLE' };

/**
 * Visibility-first customer read. The lightweight authority RPC must decide
 * under-review/not-found before this function is allowed to select snapshot_json.
 */
export async function resolveCurrentPublicPackage(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    packageRef: string;
    channel?: string;
    locale?: string;
  },
): Promise<CurrentPublicPackageResolution> {
  const routeState = await resolveCustomerRouteState(supabase, input);
  if (routeState.state !== 'PUBLIC') return routeState;
  const { data, error } = await supabase
    .from('public_catalog_view')
    .select('id,catalog_product_id,revision_id,snapshot_id,snapshot_hash,pointer_version,booking_mode,last_verified_at,public_detail')
    .eq('id', routeState.packageId)
    .eq('catalog_product_id', routeState.catalogProductId)
    .eq('revision_id', routeState.revisionId)
    .eq('snapshot_id', routeState.snapshotId)
    .eq('pointer_version', routeState.pointerVersion)
    .maybeSingle();
  if (error) return { state: 'UNAVAILABLE' };
  if (!data) return { state: 'NOT_FOUND' };
  const detail = asRecord(data.public_detail);
  if (!detail) return { state: 'NOT_FOUND' };
  const row: SnapshotRow = {
    id: String(data.snapshot_id),
    package_id: String(data.id),
    catalog_product_id: String(data.catalog_product_id),
    package_revision: asNumber(detail.package_revision) ?? 1,
    canonical_revision_id: String(data.revision_id),
    snapshot_hash: String(data.snapshot_hash),
    snapshot_json: detail,
    card_projection: asRecord(detail.card_projection) ?? {},
    lp_projection: asRecord(detail.lp_projection) ?? {},
    route_text_dump: Array.isArray(detail.route_text_dump)
      ? detail.route_text_dump.filter((item): item is string => typeof item === 'string')
      : [],
    renderer_build_id: asNonEmptyString(detail.renderer_build_id),
    status: 'published',
    created_at: String(data.last_verified_at),
  };
  const pkg = snapshotPackage(row);
  return pkg
    ? {
        state: 'PUBLIC',
        row,
        package: {
          ...pkg,
          booking_mode: asNonEmptyString(data.booking_mode) ?? 'inquiry',
          last_verified_at: String(data.last_verified_at),
        },
      }
    : { state: 'NOT_FOUND' };
}

/** Backwards-compatible public-only reader. New customer routes should use the
 * discriminated resolver so UNDER_REVIEW never degrades into a 404. */
export async function getCurrentPublicPackage(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    packageRef: string;
    channel?: string;
    locale?: string;
  },
): Promise<{ row: SnapshotRow; package: AnyRecord } | null> {
  const resolved = await resolveCurrentPublicPackage(supabase, input);
  return resolved.state === 'PUBLIC'
    ? { row: resolved.row, package: resolved.package }
    : null;
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
  _supabase: SupabaseClient,
  _pkg: AnyRecord,
  _gateInput: Omit<PublicSnapshotGateInput, 'pkg' | 'sourcePkg' | 'publicSnapshotHash' | 'publicSnapshotTitle' | 'snapshotExists' | 'routeTextDump'> = {},
  _options: { packagePatch?: AnyRecord; blockedPackagePatch?: AnyRecord } = {},
): Promise<{
  snapshot: PublicPackageSnapshot;
  snapshotHash: string;
  publicationState: string;
  publishable: boolean;
  blockers: unknown[];
  v5ShadowLink: null;
}> {
  throw new Error('LEGACY_PUBLICATION_WRITER_RETIRED_USE_REGISTRATION_KERNEL');
}
