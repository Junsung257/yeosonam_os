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
  it('routes every non-admin read through the public catalog before legacy admin branches', () => {
    const source = routeSourceWithoutComments();
    const getIndex = source.indexOf('export async function GET');
    const publicBranchIndex = source.indexOf('if (!isAdmin)', getIndex);
    const aggregateIndex = source.indexOf("if (aggregate === 'destination')", publicBranchIndex);

    expect(source).toContain('handlePublicPackageGet');
    expect(source).toContain('listPublicCatalog');
    expect(source).toContain('getPublicCatalogDetail');
    expect(publicBranchIndex).toBeGreaterThan(getIndex);
    expect(aggregateIndex).toBeGreaterThan(publicBranchIndex);
  });

  it('serves customer package API responses from an allowlisted legacy-compatible DTO', () => {
    const source = routeSourceWithoutComments();
    const helperIndex = source.indexOf('async function handlePublicPackageGet');
    const helperEndIndex = source.indexOf('const CUSTOMER_PUBLIC_REAUDIT_FIELDS', helperIndex);
    const helperSource = source.slice(helperIndex, helperEndIndex);

    expect(helperSource).toContain('publicLegacyCard');
    expect(helperSource).toContain('getPublicCatalogDetail');
    expect(helperSource).toContain('listPublicCatalog');
    expect(helperSource).not.toContain(".from('travel_packages')");
    expect(helperSource).not.toContain('snapshot_hash');
    expect(helperSource).not.toContain('package_revision');
    expect(helperSource).not.toContain('land_operator');
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
