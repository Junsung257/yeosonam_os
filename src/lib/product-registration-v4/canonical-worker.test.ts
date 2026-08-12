import { describe, expect, it } from 'vitest';

import { createTextDocumentIR } from './document-ir';
import {
  buildCanonicalNormalization,
  canonicalNormalizationJobStatus,
  segmentDocumentIR,
  selectCanonicalSectionForIdentity,
  type CanonicalSection,
} from './canonical-worker';

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

  it('binds a legacy package to one local catalog section without using shared-prefix titles as facts', () => {
    const sections: CanonicalSection[] = [
      {
        index: 0,
        sectionKey: 'source:0',
        titleHint: '공통 판매 안내',
        rawText: '마카오/홍콩 2박4일\n마카오+1일자유 2박4일\n\n---\n\n마카오/홍콩 2박4일\n전일 관광',
        rawTextHash: 'a', sourceNodeIds: [], evidence: [],
      },
      {
        index: 1,
        sectionKey: 'source:1',
        titleHint: '공통 판매 안내',
        rawText: '마카오/홍콩 2박4일\n마카오+1일자유 2박4일\n\n---\n\n마카오+1일자유 2박4일\n자유 일정',
        rawTextHash: 'b', sourceNodeIds: [], evidence: [],
      },
    ];
    expect(selectCanonicalSectionForIdentity(sections, { title: '마카오+1일자유 2박4일' })?.index).toBe(1);
  });

  it('keeps an indistinguishable legacy package identity blocked', () => {
    const sections: CanonicalSection[] = [0, 1].map(index => ({
      index,
      sectionKey: `source:${index}`,
      titleHint: '공통 안내',
      rawText: `모든 상품 공통 제목\n\n---\n\n${index + 1}일차 관광`,
      rawTextHash: String(index),
      sourceNodeIds: [],
      evidence: [],
    }));
    expect(selectCanonicalSectionForIdentity(sections, { title: '구분할 수 없는 상품' })).toBeNull();
  });
});
