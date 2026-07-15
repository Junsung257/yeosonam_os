import type { SupabaseClient } from '@supabase/supabase-js';

type AnyRecord = Record<string, unknown>;

type MarketingProjectionRow = {
  package_id: string;
  published_snapshot_id: string;
  snapshot_hash: string;
  snapshot_schema_version: string;
  source_evidence_digest: string;
  published_at: string | null;
  marketing_projection?: AnyRecord | null;
};

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as AnyRecord
    : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export async function getPublishedPackageMarketingClaims(
  supabase: SupabaseClient,
  packageIds: string[],
): Promise<AnyRecord[]> {
  const ids = [...new Set(packageIds.map(id => id.trim()).filter(Boolean))];
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from('published_public_package_marketing_v1')
    .select('package_id, published_snapshot_id, snapshot_hash, snapshot_schema_version, source_evidence_digest, marketing_projection, published_at')
    .in('package_id', ids);
  if (error) throw error;

  return ((data ?? []) as unknown as MarketingProjectionRow[]).flatMap((row) => {
    const projection = asRecord(row.marketing_projection);
    if (!projection || Object.keys(projection).length === 0) return [];
    if (!asNonEmptyString(row.published_snapshot_id)) return [];
    if (!asNonEmptyString(row.snapshot_hash)) return [];
    if (!asNonEmptyString(row.snapshot_schema_version)) return [];
    if (!asNonEmptyString(row.source_evidence_digest)) return [];
    return [{
      ...projection,
      package_id: row.package_id,
      _public_snapshot: {
        id: row.published_snapshot_id,
        hash: row.snapshot_hash,
        schema_version: row.snapshot_schema_version,
        source_evidence_digest: row.source_evidence_digest,
        published_at: row.published_at,
      },
    }];
  });
}
