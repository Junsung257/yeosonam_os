import { describe, expect, it } from 'vitest';

import { createTextDocumentIR } from './document-ir';
import {
  buildCanonicalNormalization,
  canonicalNormalizationJobStatus,
  segmentDocumentIR,
  selectCanonicalSectionForIdentity,
  sliceCanonicalNormalizationForRevisionSections,
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

  it('inherits one terminal commercial context block into every catalog product', () => {
    const catalog = createTextDocumentIR({
      filename: 'catalog.txt',
      sourceType: 'text',
      parserEngine: 'text-utf8',
      parserVersion: '1',
      text: [
        '공통 가격표',
        '2027-01-01 599,000원',
        '[ZE] 다낭 실속 3박5일 일정표',
        '제1일 부산 출발',
        '[BX] 다낭 골프 3박5일 일정표',
        '제1일 부산 출발',
        '포함 내역',
        '왕복 항공료, 숙박',
        '불포함 내역',
        '개인 경비',
        '취소 및 환불 규정',
        '출발 20일 전 취소 시 여행요금의 10% 공제',
      ].join('\n'),
    });
    const result = segmentDocumentIR(catalog, 'source-catalog');
    expect(result.sections).toHaveLength(2);
    for (const section of result.sections) {
      expect(section.rawText).toContain('왕복 항공료, 숙박');
      expect(section.rawText).toContain('개인 경비');
      expect(section.rawText).toContain('출발 20일 전 취소 시');
    }
  });

  it('does not mix repeated product-specific commercial blocks', () => {
    const catalog = createTextDocumentIR({
      filename: 'catalog.txt', sourceType: 'text', parserEngine: 'text-utf8', parserVersion: '1',
      text: [
        '[ZE] 다낭 실속 3박5일 일정표', '제1일 일정 A', '포함 내역', '상품 A 전용 포함',
        '[BX] 다낭 골프 3박5일 일정표', '제1일 일정 B', '포함 내역', '상품 B 전용 포함',
      ].join('\n'),
    });
    const result = segmentDocumentIR(catalog, 'source-specific');
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0]?.rawText).not.toContain('상품 B 전용 포함');
    expect(result.sections[1]?.rawText).not.toContain('상품 A 전용 포함');
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

  it('hands only revision-bound sections and payloads to downstream policy', () => {
    const sections: CanonicalSection[] = [0, 1].map(index => ({
      index,
      sectionKey: `source:${index}`,
      titleHint: `상품 ${index}`,
      rawText: `상품 ${index} 원문`,
      rawTextHash: `hash-${index}`,
      sourceNodeIds: [],
      evidence: [],
    }));
    const normalization = {
      version: 'v6-canonical-2026-08-12.2' as const,
      sourceDocumentId: 'source', extractionId: 'extraction', rawTextHash: 'full', sections,
      canonicalPayload: { sections: [{ index: 0 }, { index: 1 }] },
      lineage: { attractionMasterHash: null },
      qualityDiagnostics: {
        sectionCount: 2, normalizedSectionCount: 2, blockedSectionCount: 0,
        segmentationSource: 'catalog-pre-split' as const, gateStatuses: ['blocked', 'ready_to_publish'],
        completeness: {
          confirmedCount: 0, pendingSupplierCount: 0, conflictingCount: 0, unavailableCount: 0,
          publicReadySectionCount: 1, verifiedSectionCount: 1, degradedSectionCount: 0,
          blockedSectionCount: 1, degradedReasons: [], blockers: [], fields: [],
        },
      },
      status: 'needs_review' as const,
    };
    const sliced = sliceCanonicalNormalizationForRevisionSections(normalization, [1]);
    expect(sliced.sections.map(section => section.index)).toEqual([1]);
    expect(sliced.canonicalPayload.sections).toEqual([{ index: 1 }]);
    expect(sliced.qualityDiagnostics.gateStatuses).toEqual(['ready_to_publish']);
  });
});
