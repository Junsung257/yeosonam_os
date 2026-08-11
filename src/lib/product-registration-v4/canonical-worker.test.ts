import { describe, expect, it } from 'vitest';

import { createTextDocumentIR } from './document-ir';
import { buildCanonicalNormalization, canonicalNormalizationJobStatus, segmentDocumentIR } from './canonical-worker';

describe('product registration V4 canonical worker', () => {
  const documentIr = createTextDocumentIR({
    filename: 'supplier.txt',
    sourceType: 'text',
    text: '방콕 3박 5일 패키지\n출발일 2027-01-01\n성인 1,299,000원\n제1일 방콕 도착',
    parserEngine: 'text-utf8',
    parserVersion: '1',
  });

  it('creates one deterministic section when no catalog boundary exists', () => {
    const segmented = segmentDocumentIR(documentIr, 'source-1');
    expect(segmented.segmentationSource).toBe('single-document');
    expect(segmented.sections).toHaveLength(1);
    expect(segmented.sections[0]?.rawTextHash).toHaveLength(64);
    expect(segmented.sections[0]?.sourceNodeIds.length).toBeGreaterThan(0);
  });

  it('produces a lineage-bound canonical payload without writing customer data', async () => {
    const normalized = await buildCanonicalNormalization({
      documentIr,
      sourceDocumentId: 'source-1',
      extractionId: 'extraction-1',
    });
    expect(normalized.version).toBe('v6-canonical-2026-08-12.2');
    expect(normalized.sourceDocumentId).toBe('source-1');
    expect(normalized.canonicalPayload.sections).toHaveLength(1);
    expect(normalized.qualityDiagnostics.sectionCount).toBe(1);
    expect(['complete', 'needs_review']).toContain(normalized.status);
  });

  it('does not report an active V6 review workflow as a failed legacy job', () => {
    expect(canonicalNormalizationJobStatus({ normalizationStatus: 'needs_review', workflowEnabled: true })).toBe('processing');
    expect(canonicalNormalizationJobStatus({ normalizationStatus: 'needs_review', workflowEnabled: false })).toBe('failed');
  });
});
