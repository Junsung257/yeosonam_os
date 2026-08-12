import fs from 'node:fs';

import { describe, expect, it } from 'vitest';

const root = process.cwd();

function source(path: string): string {
  return fs.readFileSync(`${root}/${path}`, 'utf8');
}

describe('channel pointer reader convergence', () => {
  it('lists current packages from exact publication pointers without compatibility rows', () => {
    const projection = source('src/lib/package-publication/snapshot-projection.ts');
    const helper = projection.slice(projection.indexOf('export async function listCurrentPublicPackageCardSnapshots'));
    expect(helper).toContain(".from('product_registration_v5_publication_pointers')");
    expect(helper).toContain(".eq('tenant_id', tenantId)");
    expect(helper).toContain(".eq('state', 'published')");
    expect(helper).toContain('fetchAndMergeCurrentPublicPackageCardSnapshots');
    expect(helper).not.toContain(".from('travel_packages')");
  });

  it('uses pointer-only list, detail, and aggregate paths for every customer request', () => {
    const route = source('src/app/api/packages/route.ts');
    expect(route).toContain('const pointerOnly = !isAdmin;');
    expect(route).not.toContain("authorityMode === 'kernel'");
    expect(route).toContain('listCurrentPublicPackageCardSnapshots');
    expect(route).toContain('getCurrentPublicPackage');
    expect(route).toContain('tenantId: PLATFORM_PRODUCT_REGISTRATION_TENANT_ID');
    expect(route.indexOf('if (pointerOnly)')).toBeLessThan(route.indexOf("const queryBase = supabaseAdmin.from('travel_packages')"));
  });

  it('builds the sitemap only from pointer snapshots', () => {
    const sitemap = source('src/app/sitemap.ts');
    expect(sitemap).not.toContain("authorityMode === 'kernel'");
    expect(sitemap).toContain('listCurrentPublicPackageCardSnapshots');
    expect(sitemap).toContain('const snapshotDestinations = packageDestinations');
    expect(sitemap).not.toContain(".from('travel_packages')");
  });

  it('allows generated customer content only from the current publication pointer', () => {
    const contentPackage = source('src/lib/content-public-package.ts');
    expect(contentPackage).toContain('getCurrentPublicPackage');
    expect(contentPackage).toContain('PLATFORM_PRODUCT_REGISTRATION_TENANT_ID');
    expect(contentPackage).not.toContain(".from('travel_packages')");
    expect(contentPackage).not.toContain('fetchAndMergeCurrentPublicPackageCardSnapshots');
  });
});
