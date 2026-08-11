import fs from 'node:fs';

import { describe, expect, it } from 'vitest';

const root = process.cwd();

function source(path: string): string {
  return fs.readFileSync(`${root}/${path}`, 'utf8');
}

describe('product registration correction revision contract', () => {
  it('requires a replacement source and enters the same durable workflow', () => {
    const route = source('src/app/api/admin/product-registration/products/[catalogProductId]/corrections/route.ts');
    expect(route).toContain('replacementSourceDocumentId');
    expect(route).toContain('enqueue_product_registration_correction');
    expect(route).toContain('productRegistrationV6Workflow');
    expect(route).toContain('finalize_product_registration_correction');
    expect(route).toContain('workflow_job_id: workflowJobId');
    expect(route).not.toContain(".from('travel_packages').update");
  });

  it('binds the new immutable revision to the existing catalog identity', () => {
    const worker = source('src/lib/product-registration-v4/canonical-worker.ts');
    expect(worker).toContain('correctionCatalogProductId');
    expect(worker).toContain('correctionBaseRevisionId');
    expect(worker).toContain('v5Build.supersedesRevisionId = correctionBaseRevisionId');
    expect(worker).toContain('catalogProductId: correctionCatalogProductId');
  });
});
