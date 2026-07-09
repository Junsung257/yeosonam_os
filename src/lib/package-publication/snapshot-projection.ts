import type { SupabaseClient } from '@supabase/supabase-js';

type AnyRecord = Record<string, unknown>;

export type SnapshotProjectionRow = {
  package_id: string;
  package_revision?: number | null;
  snapshot_json?: AnyRecord | null;
  card_projection?: AnyRecord | null;
  lp_projection?: AnyRecord | null;
  status?: string | null;
  created_at?: string | null;
};

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : null;
}

function packageId(row: AnyRecord): string | null {
  return typeof row.id === 'string' && row.id.trim() ? row.id : null;
}

function packageRevision(row: AnyRecord): number {
  const revision = Number(row.package_revision ?? 1);
  return Number.isFinite(revision) && revision > 0 ? revision : 1;
}

function snapshotPackage(row: SnapshotProjectionRow): AnyRecord {
  return asRecord(asRecord(row.snapshot_json)?.package) ?? {};
}

export function mergePackageRowsWithCurrentPublicSnapshots<T extends AnyRecord>(
  packages: T[],
  snapshotRows: SnapshotProjectionRow[],
  projection: 'card' | 'lp' = 'card',
): T[] {
  const revisionByPackage = new Map<string, number>();
  for (const pkg of packages) {
    const id = packageId(pkg);
    if (id) revisionByPackage.set(id, packageRevision(pkg));
  }

  const snapshotByPackage = new Map<string, SnapshotProjectionRow>();
  for (const row of snapshotRows) {
    const expectedRevision = revisionByPackage.get(row.package_id);
    if (!expectedRevision) continue;
    if (Number(row.package_revision ?? 1) !== expectedRevision) continue;
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
      return {
        ...pkg,
        ...snapshotPackage(snapshot),
        ...(projectionPayload ?? {}),
        id,
        _public_snapshot: {
          status: snapshot.status ?? null,
          created_at: snapshot.created_at ?? null,
          package_revision: snapshot.package_revision ?? null,
        },
      };
    }) as T[];
}

export async function fetchAndMergeCurrentPublicPackageCardSnapshots<T extends AnyRecord>(
  supabase: SupabaseClient,
  packages: T[],
): Promise<T[]> {
  const ids = packages.map(packageId).filter((id): id is string => Boolean(id));
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from('public_package_snapshots')
    .select('package_id, package_revision, snapshot_json, card_projection, lp_projection, status, created_at')
    .in('package_id', ids)
    .in('status', ['approved', 'published'])
    .order('created_at', { ascending: false });

  if (error) throw error;
  return mergePackageRowsWithCurrentPublicSnapshots(packages, (data ?? []) as SnapshotProjectionRow[], 'card');
}
