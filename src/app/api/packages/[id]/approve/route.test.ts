import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function routeSource() {
  return readFileSync(join(process.cwd(), 'src/app/api/packages/[id]/approve/route.ts'), 'utf8');
}

describe('retired package approval route', () => {
  it('does not retain a second mutable publication writer', () => {
    const source = routeSource();
    expect(source).toContain('LEGACY_PACKAGE_APPROVAL_RETIRED');
    expect(source).toContain('CAS publication pointer');
    expect(source).toContain('withAdminGuard');
    expect(source).not.toContain('createPublicPackageSnapshotAndDecision');
    expect(source).not.toContain("status: 'active'");
    expect(source).not.toContain("publication_state: 'needs_review'");
  });

  it('fails closed with a migration path for callers', () => {
    const source = routeSource();
    expect(source).toContain('status: 410');
    expect(source).toContain("next: '/admin/product-registration'");
    expect(source).toContain('Cache-Control');
  });
});
