import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function routeSource(): string {
  return readFileSync(join(process.cwd(), 'src/app/api/packages/[id]/approve/route.ts'), 'utf8');
}

describe('legacy package approve route boundary', () => {
  it('keeps direct package approval retired behind the admin guard', () => {
    const source = routeSource();

    expect(source).toContain("import { withAdminGuard } from '@/lib/admin-guard'");
    expect(source).toContain('export const PATCH = withAdminGuard(patchHandler)');
    expect(source).toContain('LEGACY_PACKAGE_APPROVAL_RETIRED');
    expect(source).toContain('status: 410');
    expect(source).toContain('CAS publication pointer');
    expect(source).not.toContain('createPublicPackageSnapshotAndDecision');
    expect(source).not.toContain("status: 'active'");
  });
});
