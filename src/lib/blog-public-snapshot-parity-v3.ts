export interface BlogPublicSnapshotIdentityV3 {
  slug: string | null | undefined;
  creative_id?: string | null;
  id?: string | null;
}

export interface BlogPublicSnapshotParityDiagnosticsV3 {
  liveCount: number;
  snapshotCount: number;
  missingInSnapshot: string[];
  extraInSnapshot: string[];
  duplicateLiveSlugs: string[];
  duplicateSnapshotSlugs: string[];
  parity: boolean;
}

function normalizedSlugs(rows: readonly BlogPublicSnapshotIdentityV3[]): string[] {
  return rows.map((row) => row.slug?.trim() || '').filter(Boolean).sort();
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicate = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicate.add(value);
    seen.add(value);
  }
  return [...duplicate].sort();
}

export function buildBlogPublicSnapshotParityDiagnosticsV3(input: {
  live: readonly BlogPublicSnapshotIdentityV3[];
  snapshot: readonly BlogPublicSnapshotIdentityV3[];
  detailLimit?: number;
}): BlogPublicSnapshotParityDiagnosticsV3 {
  const live = normalizedSlugs(input.live);
  const snapshot = normalizedSlugs(input.snapshot);
  const liveSet = new Set(live);
  const snapshotSet = new Set(snapshot);
  const detailLimit = Math.max(1, Math.min(input.detailLimit ?? 20, 100));
  const duplicateLiveSlugs = duplicates(live);
  const duplicateSnapshotSlugs = duplicates(snapshot);
  const missingInSnapshot = [...liveSet].filter((slug) => !snapshotSet.has(slug)).slice(0, detailLimit);
  const extraInSnapshot = [...snapshotSet].filter((slug) => !liveSet.has(slug)).slice(0, detailLimit);
  return {
    liveCount: liveSet.size,
    snapshotCount: snapshotSet.size,
    missingInSnapshot,
    extraInSnapshot,
    duplicateLiveSlugs: duplicateLiveSlugs.slice(0, detailLimit),
    duplicateSnapshotSlugs: duplicateSnapshotSlugs.slice(0, detailLimit),
    parity: missingInSnapshot.length === 0
      && extraInSnapshot.length === 0
      && duplicateLiveSlugs.length === 0
      && duplicateSnapshotSlugs.length === 0,
  };
}
