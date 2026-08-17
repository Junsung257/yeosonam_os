import { describe, expect, it, vi } from 'vitest';

import { commitCanonicalRevisionAtomic, projectCompatibilityFromRevisionAtomic } from './repository';
import type { CommitCanonicalRevisionInput } from './types';

const HASH = 'a'.repeat(64);

function commitInput(): CommitCanonicalRevisionInput {
  return {
    tenantId: '00000000-0000-0000-0000-000000000001',
    productKey: 'source:source-1:section:section-1',
    sourceChannel: 'upload',
    operationKey: `kernel:job-1:${HASH}`,
    build: {
      tenantId: '00000000-0000-0000-0000-000000000001',
      packageId: null,
      jobId: 'job-1',
      normalizationId: 'normalization-1',
      sourceDocumentId: 'source-1',
      extractionId: 'extraction-1',
      normalizationVersion: 'normalization-1',
      canonicalPayload: { sections: [] },
      rawTextHash: HASH,
      status: 'candidate',
      payloadHash: HASH,
      lineageHash: 'b'.repeat(64),
      claims: [],
    },
    sections: [{
      index: 0,
      sectionKey: 'section-1',
      titleHint: 'sample',
      rawText: 'source text',
      rawTextHash: HASH,
      sourceNodeIds: ['node-1'],
      evidence: [{ nodeId: 'node-1', quoteHash: HASH, quote: 'source text' }],
    }],
    domainProjection: { departures: [], transportSegments: [], lodgingStays: [], golfRounds: [] },
  };
}

describe('product registration authority repository', () => {
  it('commits a package-unbound revision through the sole atomic RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        tenant_id: '00000000-0000-0000-0000-000000000001',
        catalog_product_id: 'catalog-1',
        revision_id: 'revision-1',
        revision_hash: HASH,
        inserted: true,
        claim_count: 0,
        price_rule_count: 0,
        itinerary_item_count: 0,
        domain_row_count: 0,
        authority_mode: 'shadow',
      },
      error: null,
    });
    const result = await commitCanonicalRevisionAtomic({
      supabase: { rpc } as never,
      commit: commitInput(),
    });

    expect(result.catalogProductId).toBe('catalog-1');
    expect(result.revisionId).toBe('revision-1');
    expect(rpc).toHaveBeenCalledWith('commit_product_registration_revision_atomic', expect.objectContaining({
      p_payload: expect.objectContaining({
        tenant_id: '00000000-0000-0000-0000-000000000001',
        product_key: 'source:source-1:section:section-1',
        revision_no: null,
      }),
    }));
    expect(rpc.mock.calls[0]?.[1]?.p_payload).not.toHaveProperty('package_id');
  });

  it('rejects a legacy package-bound revision before any database call', async () => {
    const rpc = vi.fn();
    const commit = commitInput();
    commit.build.packageId = 'legacy-package';
    await expect(commitCanonicalRevisionAtomic({ supabase: { rpc } as never, commit }))
      .rejects.toThrow('REGISTRATION_AUTHORITY_REVISION_MUST_PRECEDE_COMPATIBILITY_PACKAGE');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects a past canonical departure before calling the database', async () => {
    const rpc = vi.fn();
    const commit = commitInput();
    commit.build.canonicalPayload = {
      sections: [{
        departureDatePolicy: { referenceDate: '2026-08-14' },
        v3: { ledger: { variants: [] } },
      }],
    };
    commit.domainProjection.departures = [{ departure_date: '2026-08-13' }];
    await expect(commitCanonicalRevisionAtomic({ supabase: { rpc } as never, commit }))
      .rejects.toThrow('REGISTRATION_PAST_DEPARTURE_INSTANCE_FORBIDDEN');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('projects legacy compatibility rows only from an immutable revision payload', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { package_id: 'package-1', internal_code: 'KRN-ABC' },
      error: null,
    });

    const result = await projectCompatibilityFromRevisionAtomic({
      supabase: { rpc } as never,
      tenantId: '00000000-0000-0000-0000-000000000001',
      catalogProductId: 'catalog-1',
      revisionId: 'revision-1',
      revisionHash: HASH,
      sourceHash: 'b'.repeat(64),
      operationKey: 'job-1:catalog-1:projection',
      supplierCode: 'KERNEL',
      landOperator: 'sample supplier',
      commissionRate: 10,
      projection: {
        title: 'sample package',
        price: 999000,
        price_dates: [{ date: '2026-10-01', price: 999000 }],
      },
    });

    expect(result).toEqual({ packageId: 'package-1', internalCode: 'KRN-ABC' });
    expect(rpc).toHaveBeenCalledWith('project_product_registration_compatibility_atomic', {
      p_payload: expect.objectContaining({
        catalog_product_id: 'catalog-1',
        revision_id: 'revision-1',
        revision_hash: HASH,
        source_hash: 'b'.repeat(64),
        projection: expect.objectContaining({ title: 'sample package', price: 999000 }),
      }),
    });
  });
});
