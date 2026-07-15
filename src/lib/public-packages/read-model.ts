import type { SupabaseClient } from '@supabase/supabase-js';

import { fetchPromotedPublicPackageSnapshot } from '@/lib/package-publication/repository';
import { fetchAndMergeCurrentPublicPackageCardSnapshots } from '@/lib/package-publication/snapshot-projection';

type AnyRecord = Record<string, unknown>;

export type PublishedPackageCard = AnyRecord & {
  id: string;
  title: string;
  destination?: string | null;
  price?: number | null;
  price_display?: string | null;
  airline?: string | null;
  duration?: string | number | null;
  nights?: number | null;
  product_highlights?: string[] | null;
};

export type PublishedMarketingPackage = {
  id: string;
  title: string;
  destination?: string;
  duration?: number;
  nights?: number;
  price?: number;
  price_display?: string;
  product_type?: string;
  airline?: string;
  departure_airport?: string;
  product_summary?: string;
  product_highlights?: string[];
  hero_image_url?: string;
  cta_copy?: string;
  cta_helper?: string;
  _public_snapshot: {
    id: string;
    hash: string;
    schema_version: string;
    source_evidence_digest: string;
    published_at?: string | null;
  };
};

type ProjectionKind = 'public_api' | 'marketing' | 'partner';

type ProjectionRow = {
  package_id: string;
  published_snapshot_id: string;
  snapshot_hash: string;
  snapshot_schema_version: string;
  source_evidence_digest: string;
  published_at: string | null;
  public_api_projection?: AnyRecord | null;
  marketing_projection?: AnyRecord | null;
  partner_projection?: AnyRecord | null;
};

const PROJECTION_CONFIG: Record<ProjectionKind, { view: string; column: string }> = {
  public_api: {
    view: 'published_public_package_api_v1',
    column: 'public_api_projection',
  },
  marketing: {
    view: 'published_public_package_marketing_v1',
    column: 'marketing_projection',
  },
  partner: {
    view: 'published_public_package_partner_v1',
    column: 'partner_projection',
  },
};

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as AnyRecord
    : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(item => String(item).trim()).filter(Boolean) : [];
}

function uniquePackageIds(ids: string[]): string[] {
  return [...new Set(ids.map(id => id.trim()).filter(Boolean))];
}

function projectionPayload(row: ProjectionRow, kind: ProjectionKind): AnyRecord | null {
  const value = kind === 'public_api'
    ? row.public_api_projection
    : kind === 'marketing'
      ? row.marketing_projection
      : row.partner_projection;
  const projection = asRecord(value);
  if (!projection || Object.keys(projection).length === 0) return null;
  if (!asNonEmptyString(row.published_snapshot_id)) return null;
  if (!asNonEmptyString(row.snapshot_hash)) return null;
  if (!asNonEmptyString(row.snapshot_schema_version)) return null;
  if (!asNonEmptyString(row.source_evidence_digest)) return null;
  return {
    ...projection,
    package_id: row.package_id,
    _public_snapshot: {
      id: row.published_snapshot_id,
      hash: row.snapshot_hash,
      schema_version: row.snapshot_schema_version,
      source_evidence_digest: row.source_evidence_digest,
      published_at: row.published_at,
    },
  };
}

async function getPublishedProjections(
  supabase: SupabaseClient,
  kind: ProjectionKind,
  packageIds: string[],
): Promise<AnyRecord[]> {
  const ids = uniquePackageIds(packageIds);
  if (ids.length === 0) return [];
  const config = PROJECTION_CONFIG[kind];
  const { data, error } = await supabase
    .from(config.view)
    .select(`package_id, published_snapshot_id, snapshot_hash, snapshot_schema_version, source_evidence_digest, ${config.column}, published_at`)
    .in('package_id', ids);
  if (error) throw error;
  return ((data ?? []) as unknown as ProjectionRow[])
    .map(row => projectionPayload(row, kind))
    .filter((row): row is AnyRecord => Boolean(row));
}

export async function getPublishedPackageCards<T extends AnyRecord>(
  supabase: SupabaseClient,
  selectionRows: T[],
): Promise<Array<T & PublishedPackageCard>> {
  return fetchAndMergeCurrentPublicPackageCardSnapshots(
    supabase,
    selectionRows,
  ) as Promise<Array<T & PublishedPackageCard>>;
}

export async function getPublishedPackageCard(
  supabase: SupabaseClient,
  packageId: string,
): Promise<PublishedPackageCard | null> {
  const rows = await getPublishedPackageCards(supabase, [{ id: packageId }]);
  return rows[0] ?? null;
}

export async function getPublishedPackageDetail(
  supabase: SupabaseClient,
  packageId: string,
): Promise<AnyRecord | null> {
  const published = await fetchPromotedPublicPackageSnapshot(supabase, packageId);
  return published?.package ?? null;
}

export async function getPublishedPackagePublicApi(
  supabase: SupabaseClient,
  packageIds: string[],
): Promise<AnyRecord[]> {
  return getPublishedProjections(supabase, 'public_api', packageIds);
}

export async function getPublishedPackageMarketingClaims(
  supabase: SupabaseClient,
  packageIds: string[],
): Promise<AnyRecord[]> {
  return getPublishedProjections(supabase, 'marketing', packageIds);
}

export async function getPublishedMarketingPackage(
  supabase: SupabaseClient,
  packageId: string,
): Promise<PublishedMarketingPackage | null> {
  const row = (await getPublishedPackageMarketingClaims(supabase, [packageId]))[0];
  if (!row) return null;
  const id = asNonEmptyString(row.id) ?? asNonEmptyString(row.package_id);
  const title = asNonEmptyString(row.title);
  const snapshot = asRecord(row._public_snapshot);
  const snapshotId = asNonEmptyString(snapshot?.id);
  const snapshotHash = asNonEmptyString(snapshot?.hash);
  const schemaVersion = asNonEmptyString(snapshot?.schema_version);
  const sourceEvidenceDigest = asNonEmptyString(snapshot?.source_evidence_digest);
  if (!id || !title || !snapshotId || !snapshotHash || !schemaVersion || !sourceEvidenceDigest) return null;
  return {
    id,
    title,
    destination: asNonEmptyString(row.destination) ?? undefined,
    duration: asNumber(row.duration) ?? undefined,
    nights: asNumber(row.nights) ?? undefined,
    price: asNumber(row.price) ?? undefined,
    price_display: asNonEmptyString(row.price_display) ?? undefined,
    product_type: asNonEmptyString(row.product_type) ?? undefined,
    airline: asNonEmptyString(row.airline) ?? undefined,
    departure_airport: asNonEmptyString(row.departure_airport) ?? undefined,
    product_summary: asNonEmptyString(row.summary) ?? undefined,
    product_highlights: asStringArray(row.claims),
    hero_image_url: asNonEmptyString(row.hero_image_url) ?? undefined,
    cta_copy: asNonEmptyString(row.cta_copy) ?? undefined,
    cta_helper: asNonEmptyString(row.cta_helper) ?? undefined,
    _public_snapshot: {
      id: snapshotId,
      hash: snapshotHash,
      schema_version: schemaVersion,
      source_evidence_digest: sourceEvidenceDigest,
      published_at: asNonEmptyString(snapshot?.published_at),
    },
  };
}

export async function getPublishedPartnerPackages(
  supabase: SupabaseClient,
  packageIds: string[],
): Promise<AnyRecord[]> {
  return getPublishedProjections(supabase, 'partner', packageIds);
}

export async function getPublishedPartnerPackagePage(
  supabase: SupabaseClient,
  input: { offset: number; limit: number },
): Promise<{ packages: AnyRecord[]; total: number }> {
  const offset = Math.max(0, Math.trunc(input.offset));
  const limit = Math.max(1, Math.trunc(input.limit));
  const { data, count, error } = await supabase
    .from(PROJECTION_CONFIG.partner.view)
    .select('package_id, published_snapshot_id, snapshot_hash, snapshot_schema_version, source_evidence_digest, partner_projection, published_at', { count: 'exact' })
    .order('published_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return {
    packages: ((data ?? []) as unknown as ProjectionRow[])
      .map(row => projectionPayload(row, 'partner'))
      .filter((row): row is AnyRecord => Boolean(row)),
    total: count ?? 0,
  };
}
