import fs from 'node:fs';

import { describe, expect, it } from 'vitest';

const root = process.cwd();

function source(path: string): string {
  return fs.readFileSync(`${root}/${path}`, 'utf8');
}

describe('product registration input adapter convergence', () => {
  it('keeps IR normalization preview-only and routes every persisted request through the kernel', () => {
    const route = source('src/app/api/register-via-ir/route.ts');
    const kernelStart = route.indexOf('const started = await startProductRegistrationTextWorkflow');
    expect(kernelStart).toBeGreaterThan(-1);
    expect(route).toContain('if (body.dryRun) return buildPreview(body, rawText)');
    expect(route).toContain('persisted: false');
    expect(route).not.toContain(".from('travel_packages')");
    expect(route).not.toContain(".from('normalized_intakes')");
    expect(route).toContain('providedIrIsCandidateOnly');
  });

  it('routes Band evidence through the kernel before legacy persistence', () => {
    const route = source('src/app/api/band-import/save/route.ts');
    expect(route.indexOf('const started = await startProductRegistrationTextWorkflow')).toBeLessThan(route.indexOf('persistBandImportedProduct({'));
    expect(route).toContain('previewIsEvidence: false');
    expect(route).toContain('BAND_SOURCE_EVIDENCE_REQUIRED');
  });

  it('turns reextract into a correction revision before the old mutable repair path', () => {
    const route = source('src/app/api/packages/reextract/route.ts');
    expect(route).toContain('const started = await startProductRegistrationWorkflowForSource');
    expect(route).toContain('enqueue_product_registration_correction');
    expect(route).toContain('reextract_from_immutable_source');
    expect(route).not.toContain('registerProductFromRaw({');
    expect(route).not.toContain(".from('product_prices')");
  });

  it('routes legacy inventory through the same kernel as a non-public shadow backfill', () => {
    const route = source('src/app/api/cron/product-registration-v6-backfill/route.ts');
    expect(route).toContain('startProductRegistrationTextWorkflow');
    expect(route).toContain("sourceChannel: 'legacy_backfill'");
    expect(route).toContain('archiveMode: true');
    expect(route).toContain('forceReprocess: true');
  });

  it('fails legacy CRUD and forced approval closed in kernel mode', () => {
    for (const [path, retiredCode] of [
      ['src/app/api/products/route.ts', 'PRODUCT_DIRECT_CREATE_RETIRED'],
      ['src/app/api/products/stub/route.ts', 'PRODUCT_STUB_CREATE_RETIRED'],
      ['src/app/api/products/review/route.ts', 'LEGACY_PRODUCT_REVIEW_MUTATION_RETIRED'],
      ['src/app/api/packages/[id]/approve/route.ts', 'LEGACY_PACKAGE_APPROVAL_RETIRED'],
      ['src/app/api/packages/route.ts', 'LEGACY_PACKAGE_UPDATE_RETIRED'],
    ] as const) {
      expect(source(path), path).toContain(retiredCode);
      expect(source(path), path).not.toMatch(/\.from\(['"](?:products|travel_packages)['"]\)\s*\n?\s*\.(?:insert|update|upsert|delete)\(/u);
    }
  });

  it('pins retries to the original date while explicit reprocess gets a new intake date', () => {
    const retry = source('src/app/api/admin/product-registration/jobs/[jobId]/retry/route.ts');
    const reprocess = source('src/app/api/admin/product-registration/jobs/[jobId]/reprocess/route.ts');
    const watchdog = source('src/app/api/cron/product-registration-v6-watchdog/route.ts');
    expect(retry).toContain('departureDateReferenceOverride');
    expect(retry).toContain('job.v6_reference_date');
    expect(watchdog).toContain('departureDateReferenceOverride');
    expect(watchdog).toContain('input.job.v6_reference_date');
    expect(reprocess).not.toContain('departureDateReferenceOverride');
    expect(reprocess).toContain("sourceChannel: 'admin-reprocess'");
  });
});
