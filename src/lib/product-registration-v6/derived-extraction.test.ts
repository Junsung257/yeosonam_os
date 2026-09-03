import { describe, expect, it } from 'vitest';

import { sha256Hex } from '@/lib/product-registration-v4/document-ir';
import type { DocumentIR } from '@/lib/product-registration-v4/types';

import {
  applyDerivedExtractionPatches,
  assertDerivedExtractionChain,
  bindPersistedDerivedExtractionId,
  createDerivedDocumentExtraction,
  createDerivedExtractionPatch,
  derivedExtractionLineageMetadata,
  derivedExtractionPatchHash,
} from './derived-extraction';

function fixture(): DocumentIR {
  const price = '699,000원';
  return {
    version: 'v4',
    filename: 'supplier.hwp',
    sourceType: 'hwp',
    pages: 1,
    text: `상품 A\n${price}\n상품 B\n${price}`,
    nodes: [
      { id: 'node-price-a', kind: 'cell', text: price, page: 0, order: 0 },
      { id: 'node-price-b', kind: 'cell', text: price, page: 0, order: 1 },
    ],
    tables: [{
      id: 'table-1',
      page: 0,
      rows: 1,
      columns: 2,
      cells: [
        {
          id: 'cell-price-a',
          row: 0,
          column: 0,
          rowSpan: 1,
          colSpan: 1,
          text: price,
          nodeId: 'node-price-a',
          evidence: { page: 0, quoteHash: sha256Hex(price) },
        },
        {
          id: 'cell-price-b',
          row: 0,
          column: 1,
          rowSpan: 1,
          colSpan: 1,
          text: price,
          nodeId: 'node-price-b',
          evidence: { page: 0, quoteHash: sha256Hex(price) },
        },
      ],
    }],
    assets: [],
    parser: { engine: 'fixture', version: '1' },
  };
}

function patch(overrides: Partial<Parameters<typeof createDerivedExtractionPatch>[0]> = {}) {
  return createDerivedExtractionPatch({
    fieldKey: 'sections[0].variants[0].price',
    axisKey: 'table-1:price:a',
    oldValue: '699,000원',
    newValue: '799,000원',
    sourceCellEvidenceId: 'cell-price-a',
    recoveryEvidenceIds: ['ocr:clova:1'],
    axisBindingHash: sha256Hex('axis-a'),
    reasonCode: 'ocr_consensus_recovered',
    tableKey: 'table-1',
    cellAddress: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
    documentTextOccurrence: 0,
    ...overrides,
  });
}

describe('derived extraction append-only contract', () => {
  it('creates deterministic patch identity and updates only the child IR', () => {
    const parent = fixture();
    const first = patch();
    const second = patch();
    expect(first.patchId).toBe(second.patchId);
    expect(derivedExtractionPatchHash([first])).toBe(derivedExtractionPatchHash([second]));

    const derived = createDerivedDocumentExtraction({
      parent: {
        id: 'extraction-parent',
        sourceDocumentId: 'source-1',
        sourceHash: sha256Hex('source-bytes'),
        extractionHash: sha256Hex(JSON.stringify(parent)),
        documentIr: parent,
      },
      derivationType: 'image_recovery',
      patches: [first],
      createdBy: 'recovery-worker',
      createdAt: '2026-09-04T00:00:00.000Z',
    });

    expect(parent.tables[0]!.cells[0]!.text).toBe('699,000원');
    expect(derived.documentIr.tables[0]!.cells[0]!.text).toBe('799,000원');
    expect(derived.documentIr.nodes[0]!.text).toBe('799,000원');
    expect(derived.documentIr.tables[0]!.cells[0]!.evidence.quoteHash).toBe(sha256Hex('799,000원'));
    expect(derived.lineage).toMatchObject({
      parentExtractionId: 'extraction-parent',
      supersedesExtractionId: 'extraction-parent',
      derivationType: 'image_recovery',
      patchHash: derived.patchHash,
      contentHash: derived.contentHash,
    });
    expect(derivedExtractionLineageMetadata(derived)).toMatchObject({
      parentExtractionId: 'extraction-parent',
      parserEngine: 'v6-derived-extraction',
      parserVersion: '1',
    });
    const retried = createDerivedDocumentExtraction({
      parent: {
        id: 'extraction-parent',
        sourceDocumentId: 'source-1',
        sourceHash: sha256Hex('source-bytes'),
        extractionHash: sha256Hex(JSON.stringify(parent)),
        documentIr: parent,
      },
      derivationType: 'image_recovery',
      patches: [first],
      createdBy: 'recovery-worker',
      createdAt: '2026-09-04T00:05:00.000Z',
    });
    expect(retried.id).toBe(derived.id);
    expect(retried.contentHash).toBe(derived.contentHash);
    expect(bindPersistedDerivedExtractionId(derived, '00000000-0000-0000-0000-000000000001').id)
      .toBe('00000000-0000-0000-0000-000000000001');
  });

  it('fails closed when ownership evidence is stale or text replacement is ambiguous', () => {
    expect(() => applyDerivedExtractionPatches(fixture(), [patch({ oldValue: 'wrong' })])).toThrow(
      'DERIVED_EXTRACTION_OLD_VALUE_MISMATCH',
    );
    expect(() => applyDerivedExtractionPatches(fixture(), [patch({ documentTextOccurrence: null })])).toThrow(
      'DERIVED_EXTRACTION_DOCUMENT_TEXT_AMBIGUOUS',
    );
    expect(() => createDerivedDocumentExtraction({
      parent: {
        id: 'extraction-parent',
        sourceDocumentId: 'source-1',
        sourceHash: sha256Hex('source-bytes'),
        extractionHash: sha256Hex(JSON.stringify(fixture())),
        documentIr: fixture(),
      },
      derivationType: 'human_review',
      patches: [patch({ newValue: '699,000원' })],
      createdBy: 'reviewer',
    })).toThrow('DERIVED_EXTRACTION_NOOP');
    expect(() => createDerivedDocumentExtraction({
      parent: {
        id: 'extraction-parent',
        sourceDocumentId: 'source-1',
        sourceHash: sha256Hex('source-bytes'),
        extractionHash: sha256Hex('not-the-fixture'),
        documentIr: fixture(),
      },
      derivationType: 'image_recovery',
      patches: [patch()],
      createdBy: 'recovery-worker',
    })).toThrow('DERIVED_EXTRACTION_PARENT_CONTENT_HASH_MISMATCH');
  });

  it('rejects duplicate patch identities and invalid chain supersession', () => {
    const first = patch();
    expect(() => applyDerivedExtractionPatches(fixture(), [first, first])).toThrow(
      'DERIVED_EXTRACTION_DUPLICATE_CELL_PATCH',
    );
    expect(() => assertDerivedExtractionChain([{
      id: 'derived-1',
      sourceDocumentId: 'source-1',
      sourceHash: sha256Hex('source-bytes'),
      parentExtractionId: 'base-1',
      supersedesExtractionId: 'other-base',
      contentHash: sha256Hex('content'),
    }])).toThrow('DERIVED_EXTRACTION_CHAIN_SUPERSESSION_MISMATCH');
  });
});
