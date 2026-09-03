import { describe, expect, it } from 'vitest';

import {
  PRODUCT_REGISTRATION_V4_NORMALIZATION_VERSION,
  canonicalNormalizationExecutionPolicy,
  type CanonicalNormalization,
} from '@/lib/product-registration-v4/canonical-worker';
import { sha256Hex } from '@/lib/product-registration-v4/document-ir';
import { buildDocumentIrTablePriceCalendars } from '@/lib/product-registration-v4/table-grid-price-calendar';
import type { DocumentIR, DocumentIrTableCell } from '@/lib/product-registration-v4/types';

import { buildProductRegistrationAnalysisRecoveryPlan } from './analysis-recovery';

function documentIr(input: {
  text?: string;
  cell?: Partial<DocumentIrTableCell> | null;
  assets?: DocumentIR['assets'];
} = {}): DocumentIR {
  const text = input.text ?? '정상 상품 안내';
  const cell = input.cell === null ? null : {
    id: 'cell-0',
    nodeId: 'node-0',
    row: 0,
    column: 0,
    rowSpan: 1,
    colSpan: 1,
    text,
    evidence: { page: 0, quoteHash: sha256Hex(text) },
    ...input.cell,
  } satisfies DocumentIrTableCell;
  return {
    version: 'v4',
    sourceType: 'hwp',
    filename: 'supplier.hwp',
    pages: 1,
    text,
    nodes: cell ? [{ id: cell.nodeId, kind: 'cell', order: 0, page: 0, text: cell.text }] : [],
    tables: cell ? [{
      id: 'table-0',
      page: 0,
      rows: Math.max(1, cell.row + cell.rowSpan),
      columns: Math.max(1, cell.column + cell.colSpan),
      cells: [cell],
    }] : [],
    assets: input.assets ?? [],
    parser: { engine: 'fixture', version: '1' },
  };
}

function normalization(input: {
  rawText?: string;
  status?: CanonicalNormalization['status'];
  fields?: CanonicalNormalization['qualityDiagnostics']['completeness']['fields'];
  canonicalSections?: Array<Record<string, unknown>>;
} = {}): CanonicalNormalization {
  const rawText = input.rawText ?? '정상 상품 안내';
  const fields = input.fields ?? [];
  return {
    version: PRODUCT_REGISTRATION_V4_NORMALIZATION_VERSION,
    sourceDocumentId: 'source-1',
    extractionId: 'extraction-1',
    rawTextHash: sha256Hex(rawText),
    sections: [{
      index: 0,
      sectionKey: 'section-0',
      titleHint: '상품',
      rawText,
      rawTextHash: sha256Hex(rawText),
      sourceNodeIds: [],
      evidence: [],
    }],
    canonicalPayload: {
      sections: input.canonicalSections ?? [{}],
      lineage: { attractionMasterHash: null },
    },
    lineage: { attractionMasterHash: null },
    qualityDiagnostics: {
      sectionCount: 1,
      normalizedSectionCount: 1,
      blockedSectionCount: input.status === 'needs_review' ? 1 : 0,
      segmentationSource: 'single-document',
      gateStatuses: [],
      completeness: {
        confirmedCount: fields.filter(field => field.state === 'confirmed').length,
        pendingSupplierCount: fields.filter(field => field.state === 'pending_supplier').length,
        conflictingCount: fields.filter(field => field.state === 'conflicting').length,
        unavailableCount: fields.filter(field => field.state === 'unavailable').length,
        publicReadySectionCount: input.status === 'needs_review' ? 0 : 1,
        verifiedSectionCount: input.status === 'needs_review' ? 0 : 1,
        degradedSectionCount: 0,
        blockedSectionCount: input.status === 'needs_review' ? 1 : 0,
        degradedReasons: [],
        blockers: [],
        fields,
      },
      departureDatePolicy: {
        referenceDate: '2027-01-01',
        policyVersion: 'fixture-policy',
        inferredDateCount: 0,
        explicitDateCount: 0,
        excludedPastDateCount: 0,
        futureDepartureCount: 0,
        pastOnlySectionIndexes: [],
        blockers: [],
      },
    },
    status: input.status ?? 'complete',
  };
}

function plan(ir: DocumentIR, canonical: CanonicalNormalization = normalization({ rawText: ir.text })) {
  return buildProductRegistrationAnalysisRecoveryPlan({
    documentIr: ir,
    normalization: canonical,
    normalizationId: 'normalization-1',
    sourceHash: sha256Hex('source-bytes'),
  });
}

describe('analysis-only normalization policy', () => {
  it('cannot create revisions, snapshots, or publication pointers', () => {
    expect(canonicalNormalizationExecutionPolicy('analysis_only')).toEqual({
      mode: 'analysis_only',
      persistNormalization: true,
      commitRevisions: false,
      createSnapshots: false,
      changePublicationPointer: false,
      customerPublicationAuthority: false,
    });
    expect(canonicalNormalizationExecutionPolicy().commitRevisions).toBe(true);
  });
});

describe('buildProductRegistrationAnalysisRecoveryPlan', () => {
  it('keeps a structurally valid merged cell authoritative without forcing OCR', () => {
    const ir = documentIr({
      text: '공통 안내',
      cell: { rowSpan: 1, colSpan: 2 },
    });
    const result = plan(ir);

    expect(result.disposition).toBe('analysis_clear');
    expect(result.targets).toEqual([]);
    expect(result).toMatchObject({
      analysisOnly: true,
      revisionWriteAuthority: false,
      snapshotWriteAuthority: false,
      publicationPointerWriteAuthority: false,
      customerPublicationAuthority: false,
    });
  });

  it('creates deterministic cell evidence when the native quote hash is invalid', () => {
    const ir = documentIr({ cell: { evidence: { page: 0, quoteHash: 'broken' } } });
    const first = plan(ir);
    const second = plan(ir);

    expect(first.disposition).toBe('recovery_required');
    expect(first.targets).toHaveLength(1);
    expect(first.targets[0]).toMatchObject({
      tableKey: 'table-0',
      cellAddress: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
      reasonCodes: ['table_cell_evidence_hash_mismatch'],
    });
    expect(first.targets[0]!.targetId).toBe(second.targets[0]!.targetId);
    expect(first.targets[0]!.businessIdempotencyKey).toBe(second.targets[0]!.businessIdempotencyKey);
    expect(first.planHash).toBe(second.planHash);
  });

  it('separates a fact absent from the source from a recoverable parser miss', () => {
    const field = {
      fieldPath: 'sections[0].variants[0].price',
      state: 'unavailable' as const,
      criticality: 'critical' as const,
      reason: '가격 없음',
      safeToDegrade: false,
    };
    const insufficientIr = documentIr({ text: '일정 안내만 있음', cell: null });
    const insufficient = plan(insufficientIr, normalization({
      rawText: insufficientIr.text,
      status: 'needs_review',
      fields: [field],
    }));
    expect(insufficient.disposition).toBe('source_insufficient');
    expect(insufficient.sourceInsufficientFields).toEqual([field.fieldPath]);
    expect(insufficient.targets).toEqual([]);

    const recoverableIr = documentIr({ text: '판매가 699,000원' });
    const recoverable = plan(recoverableIr, normalization({
      rawText: recoverableIr.text,
      status: 'needs_review',
      fields: [field],
    }));
    expect(recoverable.disposition).toBe('recovery_required');
    expect(recoverable.sourceInsufficientFields).toEqual([]);
    expect(recoverable.targets).toEqual([
      expect.objectContaining({
        fieldKey: field.fieldPath,
        reasonCodes: ['canonical_field_unavailable_with_source_signal'],
      }),
    ]);
  });

  it('does not treat a successful parser parity manifest as a warning', () => {
    const ir = documentIr({
      assets: [{
        id: 'rhwp-table-structure-parity',
        kind: 'manifest',
        metadata: { status: 'match', publicationSafe: true, warnings: [] },
      }],
    });
    expect(plan(ir).targets).toEqual([]);
  });

  it('routes equal-valued sibling price axes to recovery instead of picking the first product', () => {
    const rows = [
      ['출발일 & 2박3일', '', '실속', '품격'],
      ['5월', '월,화,수', '699,000', '699,000'],
      ['5월', '5/5', '999,000', '999,000'],
    ];
    const cells = rows.flatMap((values, row) => values.flatMap((text, column) => {
      if (!text) return [];
      return [{
        id: `cell-${row}-${column}`,
        nodeId: `node-${row}-${column}`,
        row,
        column,
        rowSpan: 1,
        colSpan: 1,
        text,
        evidence: { page: 0, quoteHash: sha256Hex(text) },
      }];
    }));
    const text = `2027년 청도 2박3일 가격표\n${cells.map(cell => cell.text).join('\n')}`;
    const ir: DocumentIR = {
      version: 'v4',
      sourceType: 'hwp',
      filename: 'same-price-axes.hwp',
      pages: 1,
      text,
      nodes: cells.map((cell, order) => ({ id: cell.nodeId, kind: 'cell', order, page: 0, text: cell.text })),
      tables: [{ id: 'same-price-axes', page: 0, rows: rows.length, columns: 4, cells }],
      assets: [],
      parser: { engine: 'fixture', version: '1' },
    };
    const calendars = buildDocumentIrTablePriceCalendars({
      documentIr: ir,
      sectionRawText: text,
      fallbackYear: 2027,
      fallbackDurationDays: 3,
    });
    expect(calendars).toHaveLength(2);
    const canonical = normalization({
      rawText: text,
      canonicalSections: [{
        v3: {
          ledger: {
            variants: [{ variant_key: 'unknown', price_calendar: calendars[0]!.prices }],
          },
        },
      }],
    });

    const result = plan(ir, canonical);

    expect(result.disposition).toBe('recovery_required');
    expect(result.targets.filter(target => target.reasonCodes.includes('price_axis_ambiguous'))).toHaveLength(2);
    expect(result.axisBinding.bindings).toEqual([]);
    expect(result.axisBinding.ambiguousAxisKeys).toHaveLength(2);
  });
});
