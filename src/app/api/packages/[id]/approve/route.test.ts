import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function routeSource(): string {
  return readFileSync(join(process.cwd(), 'src/app/api/packages/[id]/approve/route.ts'), 'utf8');
}

describe('legacy package approve route boundary', () => {
  it('retires direct package approval fail-closed', () => {
    const route = routeSource();

    expect(route).toContain("import { withAdminGuard } from '@/lib/admin-guard'");
    expect(route).toContain('export const PATCH = withAdminGuard(patchHandler)');
    expect(route).toContain('LEGACY_PACKAGE_APPROVAL_RETIRED');
    expect(route).toContain('{ status: 410');
    expect(route).toContain('CAS publication pointer');
    expect(route).toContain("next: '/admin/product-registration'");
    expect(route).not.toContain('createPublicPackageSnapshotAndDecision');
    expect(route).not.toContain("status: 'active'");
    expect(route).not.toMatch(/\.(insert|update|delete)\(/);
  });

  it('keeps the retired handler behind the admin guard', () => {
    const route = routeSource();

    expect(route).toContain('const patchHandler');
    expect(route).toContain('if (!params?.id)');
    expect(route).toContain("{ status: 400 }");
    expect(route).toContain('export const PATCH = withAdminGuard(patchHandler)');
    expect(route).not.toContain('export async function PATCH');
  });
});
