import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function routeSourceWithoutComments() {
  const source = readFileSync(join(process.cwd(), 'src/app/api/packages/route.ts'), 'utf8');
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function sourceWithoutComments(path: string) {
  const source = readFileSync(join(process.cwd(), path), 'utf8');
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('packages bulk/customer publication gate', () => {
  it('keeps customer reads pointer-only regardless of writer authority mode', () => {
    const source = routeSourceWithoutComments();

    expect(source).toContain('const pointerOnly = !isAdmin;');
    expect(source).not.toMatch(/pointerOnly\s*=\s*!isAdmin[\s\S]{0,120}authorityMode/);
  });

  it('serves customer package API responses only from current public snapshots', () => {
    const source = routeSourceWithoutComments();
    const detailIndex = source.indexOf('if (id) {');
    const detailSnapshotIndex = source.indexOf('fetchLatestPublicPackageSnapshot', detailIndex);
    const detailCandidateIndex = source.indexOf('isCustomerPublicSnapshotCandidate', detailSnapshotIndex);
    const responsePkgIndex = source.indexOf('const responsePkg: Record<string, unknown> = isAdmin', detailCandidateIndex);
    const listIndex = source.indexOf('const visibleRows = isAdmin', responsePkgIndex);
    const listSnapshotIndex = source.indexOf('fetchAndMergeCurrentPublicPackageCardSnapshots', listIndex);
    const aggregateIndex = source.indexOf("if (aggregate === 'destination')");
    const aggregateSnapshotIndex = source.indexOf('fetchAndMergeCurrentPublicPackageCardSnapshots', aggregateIndex);

    expect(source).toContain('function isCustomerPublicSnapshotCandidate');
    expect(detailSnapshotIndex).toBeGreaterThan(detailIndex);
    expect(detailCandidateIndex).toBeGreaterThan(detailSnapshotIndex);
    expect(responsePkgIndex).toBeGreaterThan(detailCandidateIndex);
    expect(listSnapshotIndex).toBeGreaterThan(listIndex);
    expect(aggregateSnapshotIndex).toBeGreaterThan(aggregateIndex);
  });

  it('retires mutable source repair and requires correction revision proof', () => {
    const source = routeSourceWithoutComments();
    expect(source).toContain('LEGACY_PACKAGE_MUTATION_RETIRED');
    expect(source).toContain('/api/admin/product-registration/products/{catalogProductId}/corrections');
  });

  it('removes bulk mutable approval in favor of CAS publication', () => {
    const source = routeSourceWithoutComments();
    expect(source).not.toContain("if (action === 'bulk_approve')");
    expect(source).toContain('LEGACY_PACKAGE_UPDATE_RETIRED');
    expect(source).not.toMatch(/\.from\(\s*['"]travel_packages['"]\s*\)[\s\S]{0,900}\.\s*update\s*\(/);
  });

  it('keeps legacy helper exports fail-closed', () => {
    const source = routeSourceWithoutComments();
    const dbHelper = sourceWithoutComments('src/lib/db/packages.ts');
    expect(source).toContain('LEGACY_PACKAGE_CREATE_RETIRED');
    expect(dbHelper).toContain('LEGACY_PACKAGE_APPROVAL_RETIRED_USE_PUBLISH_SNAPSHOT_ATOMIC');
  });

  it('routes generic PATCH callers to correction revisions', () => {
    const source = routeSourceWithoutComments();
    expect(source).toContain('LEGACY_PACKAGE_UPDATE_RETIRED');
    expect(source).toContain('/api/admin/product-registration/products/{catalogProductId}/corrections');
  });
});
