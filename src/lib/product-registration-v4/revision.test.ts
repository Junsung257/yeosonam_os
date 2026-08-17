import { describe, expect, it } from 'vitest';

import {
  buildProductRegistrationV5Revision,
  criticalityForPath,
  stableJson,
} from './revision';

const normalization = {
  version: 'v4-canonical-test' as string,
  rawTextHash: 'a'.repeat(64),
  status: 'complete' as const,
  sections: [{
    index: 0,
    sectionKey: 'source:0:hash',
    titleHint: '오사카 3일',
    rawText: 'DAY 1 KE123 출발 10:00',
    rawTextHash: 'b'.repeat(64),
    sourceNodeIds: ['paragraph-1'],
    evidence: [{ nodeId: 'paragraph-1', quoteHash: 'c'.repeat(64), quote: 'DAY 1 KE123 출발 10:00' }],
  }],
  canonicalPayload: {
    sections: [{
      index: 0,
      v3: {
        ledger: {
          variants: [{
            price_calendar: [{
              amount: 599000,
              currency: 'KRW',
              date: '2026-09-01',
              evidence: { node_id: 'paragraph-1', quote: '599,000원 2026-09-01' },
            }],
            flight_segments: [{
              code: 'KE123',
              dep_time: '10:00',
              evidence: { node_id: 'paragraph-1', quote: 'KE123 출발 10:00' },
            }],
            days: [{
              day: 1,
              events: [{ evidence: { node_id: 'paragraph-1', quote: 'DAY 1' } }],
            }],
          }],
        },
        gate_result: { status: 'ready_to_publish' },
      },
    }],
  },
};

describe('product registration V5 revision', () => {
  it('sorts object keys but preserves array order for deterministic hashes', () => {
    expect(stableJson({ b: 1, a: { d: 2, c: 3 }, list: [2, 1] }))
      .toBe('{"a":{"c":3,"d":2},"b":1,"list":[2,1]}');
    expect(stableJson({ list: [2, 1] })).not.toBe(stableJson({ list: [1, 2] }));
  });

  it('builds a lineage-bound candidate and critical claims from canonical sections', () => {
    const revision = buildProductRegistrationV5Revision({
      tenantId: 'tenant-1',
      jobId: 'job-1',
      normalizationId: 'normalization-1',
      sourceDocumentId: 'source-1',
      extractionId: 'extraction-1',
      normalization,
    });
    expect(revision.status).toBe('candidate');
    expect(revision.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(revision.lineageHash).toMatch(/^[0-9a-f]{64}$/);
    expect(revision.claims.map(claim => claim.fieldPath)).toEqual([
      'sections[0].v3.ledger.variants[0].price_calendar',
      'sections[0].v3.ledger.variants[0].flight_segments',
      'sections[0].v3.ledger.variants[0].days',
      'sections[0].v3.gate_result',
    ]);
    expect(revision.claims.every(claim => claim.evidenceStatus === 'verified')).toBe(true);
    expect(revision.claims.every(claim => claim.evidence.length === 1)).toBe(true);
  });

  it('keeps evidence on its actual bundle member instead of the primary source', () => {
    const bundled = structuredClone(normalization) as Parameters<
      typeof buildProductRegistrationV5Revision
    >[0]['normalization'];
    bundled.sections[0]!.evidence = [{
      nodeId: 'bundle-price-node',
      quoteHash: 'd'.repeat(64),
      quote: '599,000\uC6D0 2026-09-01',
      sourceDocumentId: 'source-price-sheet',
      extractionId: 'extraction-price-sheet',
      sourceHash: 'e'.repeat(64),
    }];
    const section = bundled.canonicalPayload.sections[0] as {
      v3: { ledger: { variants: Array<{ price_calendar: Array<{ evidence: Record<string, unknown> }> }> } };
    };
    section.v3.ledger.variants[0].price_calendar[0].evidence = {
      node_id: 'bundle-price-node',
      quote: '599,000\uC6D0 2026-09-01',
    };
    const revision = buildProductRegistrationV5Revision({
      tenantId: 'tenant-1',
      jobId: 'job-1',
      normalizationId: 'normalization-1',
      sourceDocumentId: 'source-primary-itinerary',
      extractionId: 'extraction-primary-itinerary',
      normalization: bundled,
    });
    const priceClaim = revision.claims.find(claim => claim.fieldPath.endsWith('.price_calendar'));

    expect(priceClaim?.evidence[0]).toEqual(expect.objectContaining({
      sourceDocumentId: 'source-price-sheet',
      extractionId: 'extraction-price-sheet',
      nodeId: 'bundle-price-node',
    }));
  });

  it('fails closed when canonical normalization needs review', () => {
    const revision = buildProductRegistrationV5Revision({
      jobId: 'job-1',
      normalizationId: 'normalization-1',
      sourceDocumentId: 'source-1',
      extractionId: 'extraction-1',
      normalization: { ...normalization, status: 'needs_review' },
    });
    expect(revision.status).toBe('needs_review');
  });

  it('classifies business-critical paths separately from editorial fields', () => {
    expect(criticalityForPath('price_dates')).toBe('critical');
    expect(criticalityForPath('itinerary.days')).toBe('high');
    expect(criticalityForPath('title')).toBe('normal');
  });
});
