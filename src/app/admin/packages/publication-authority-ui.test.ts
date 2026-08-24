import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('admin package publication authority UI', () => {
  it('renders the compatibility package list read-only', () => {
    const page = source('src/app/admin/packages/page.tsx');
    const client = source('src/app/admin/packages/PackagesReadOnlyClient.tsx');

    expect(page).toContain('PackagesReadOnlyClient');
    expect(page).not.toContain("from './PackagesPageClient'");
    expect(client).toContain('읽기 전용');
    expect(client).toContain('/admin/product-registration');
    expect(client).not.toContain('/api/packages');
    expect(client).not.toContain('onHandleAction');
    expect(client).not.toContain('onSetApprovalTarget');
  });

  it('does not equate a legacy approved upload result with customer publication', () => {
    const upload = source('src/app/admin/upload/page.tsx');

    expect(upload).not.toContain("r.status === 'approved' ? '✅ 판매중'");
    expect(upload).not.toContain('function isPublicPackageStatus');
    expect(upload).toContain('고객 공개 확인');
    expect(upload).toContain('/admin/product-registration');
  });

  it('attributes publication requests and pointer versions on the server', () => {
    const route = source('src/app/api/admin/product-registration/products/[catalogProductId]/publication-requests/route.ts');

    expect(route).toContain('resolveAdminActorLabel(request)');
    expect(route).toContain('resolveAdminActorId(request)');
    expect(route).toContain(".from('product_registration_v5_publication_pointers')");
    expect(route).toContain('expectedPointerVersions');
    expect(route).toContain('start(productRegistrationPublicationWorkflow');
    expect(route).not.toContain('body.requestedActor');
    expect(route).not.toContain('body.expectedPointerVersions');
  });
});
