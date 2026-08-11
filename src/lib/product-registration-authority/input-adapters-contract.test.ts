import fs from 'node:fs';

import { describe, expect, it } from 'vitest';

const root = process.cwd();

function source(path: string): string {
  return fs.readFileSync(`${root}/${path}`, 'utf8');
}

describe('product registration input adapter convergence', () => {
  it('routes IR through the kernel before the legacy normalizer or direct package insert', () => {
    const route = source('src/app/api/register-via-ir/route.ts');
    const kernelStart = route.indexOf('const started = await startProductRegistrationTextWorkflow');
    const legacyNormalize = route.indexOf('normalizeWithLlm({');
    const legacyInsert = route.indexOf(".from('travel_packages')");
    expect(kernelStart).toBeGreaterThan(-1);
    expect(kernelStart).toBeLessThan(legacyNormalize);
    expect(kernelStart).toBeLessThan(legacyInsert);
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
    expect(route.indexOf('const started = await startProductRegistrationWorkflowForSource')).toBeLessThan(route.indexOf('registerProductFromRaw({'));
    expect(route).toContain('enqueue_product_registration_correction');
    expect(route).toContain('reextract_from_immutable_source');
  });

  it('routes legacy inventory through the same kernel as a non-public shadow backfill', () => {
    const route = source('src/app/api/cron/product-registration-v6-backfill/route.ts');
    expect(route).toContain('startProductRegistrationTextWorkflow');
    expect(route).toContain("sourceChannel: 'legacy_backfill'");
    expect(route).toContain('archiveMode: true');
    expect(route).toContain('forceReprocess: true');
  });

  it('fails legacy CRUD and forced approval closed in kernel mode', () => {
    for (const path of [
      'src/app/api/products/route.ts',
      'src/app/api/packages/route.ts',
      'src/app/api/products/review/route.ts',
      'src/app/api/products/stub/route.ts',
      'src/app/api/packages/[id]/approve/route.ts',
    ]) {
      expect(source(path), path).toContain('productRegistrationLegacyWriterBlocker');
    }
  });
});
