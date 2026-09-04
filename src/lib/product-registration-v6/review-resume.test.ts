import { describe, expect, it } from 'vitest';

import { sha256Hex } from '@/lib/product-registration-v4/document-ir';
import type { DocumentIR } from '@/lib/product-registration-v4/types';

import { createReviewPacket, createReviewReceipt, reviewReceiptHash, type ReviewReceiptV1 } from './human-review';
import {
  buildReviewResumePlan,
  createHumanReviewDerivedExtraction,
  type ReviewResumeInput,
} from './review-resume';

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const TENANT_ID = '22222222-2222-4222-8222-222222222222';
const JOB_ID = '33333333-3333-4333-8333-333333333333';
const SOURCE_ID = '44444444-4444-4444-8444-444444444444';
const EXTRACTION_ID = '55555555-5555-4555-8555-555555555555';
const FIRST_USER = '66666666-6666-4666-8666-666666666666';
const SECOND_USER = '77777777-7777-4777-8777-777777777777';
const FIRST_SESSION = '88888888-8888-4888-8888-888888888888';
const SECOND_SESSION = '99999999-9999-4999-8999-999999999999';

function documentIr(): DocumentIR {
  const value = '699,000원';
  return {
    version: 'v4',
    filename: 'supplier.hwp',
    sourceType: 'hwp',
    pages: 1,
    text: `상품 A\n${value}`,
    nodes: [
      { id: 'node-title', kind: 'paragraph', text: '상품 A', order: 0 },
      { id: 'node-price', kind: 'cell', text: value, order: 1, page: 0 },
    ],
    tables: [{
      id: 'table-1', page: 0, rows: 1, columns: 1,
      cells: [{
        id: 'cell-price', row: 0, column: 0, rowSpan: 1, colSpan: 1,
        text: value, nodeId: 'node-price', evidence: { page: 0, quoteHash: sha256Hex(value) },
      }],
    }],
    assets: [],
    parser: { engine: 'fixture', version: '1' },
  };
}

function packet(decisionTargetCount = 1) {
  return createReviewPacket({
    caseId: CASE_ID,
    sourceDocumentId: SOURCE_ID,
    sourceHash: sha256Hex('source-bytes'),
    parentExtractionId: EXTRACTION_ID,
    parentExtractionHash: sha256Hex(JSON.stringify(documentIr())),
    normalizationId: null,
    targets: Array.from({ length: decisionTargetCount }, (_, index) => ({
      targetId: `target-${index}`,
      fieldKey: `sections[${index}].variants[0].price`,
      candidateAxisKeys: ['axis:a'],
      candidateValues: ['699,000원'],
      reasonCodes: ['ambiguous_price_owner'],
      sourceCellEvidenceId: 'cell-price',
      cellAddress: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
      renderContextPolicy: 'cell_with_headers' as const,
    })),
  });
}

function receipt(input: {
  packet: ReturnType<typeof packet>;
  reviewerUserId: string;
  reviewerSessionId: string;
  decision: 'correct_value_with_evidence' | 'select_axis' | 'mark_source_insufficient';
  decisionPayload: Record<string, unknown>;
}): ReviewReceiptV1 {
  return createReviewReceipt({
    caseId: CASE_ID,
    reviewerUserId: input.reviewerUserId,
    reviewerSessionId: input.reviewerSessionId,
    reviewerSlot: input.reviewerUserId === FIRST_USER ? 'first' : 'second',
    packetHash: input.packet.packetHash,
    sourceHash: input.packet.sourceHash,
    parentExtractionHash: input.packet.parentExtractionHash,
    candidateAxisSetHash: input.packet.candidateAxisSetHash,
    decision: input.decision,
    decisionPayload: input.decisionPayload,
    evidence: [{ evidenceId: 'cell-price', quoteHash: sha256Hex('699,000원'), tableKey: 'table-1', row: 0, col: 0, page: 0 }],
    reason: '원문 셀과 상품축을 대조했습니다.',
    createdAt: '2026-09-04T00:00:00.000Z',
  });
}

function input(overrides: Partial<ReviewResumeInput> = {}): ReviewResumeInput {
  const reviewPacket = packet();
  const decisionPayload = {
    selectedAxisKey: 'axis:a',
    patches: [{
      fieldKey: 'sections[0].variants[0].price',
      oldValue: '699,000원',
      newValue: '799,000원',
      sourceCellEvidenceId: 'cell-price',
    }],
  };
  return {
    caseId: CASE_ID,
    jobId: JOB_ID,
    tenantId: TENANT_ID,
    status: 'accepted',
    packet: reviewPacket,
    receipts: [
      receipt({ packet: reviewPacket, reviewerUserId: FIRST_USER, reviewerSessionId: FIRST_SESSION, decision: 'correct_value_with_evidence', decisionPayload }),
      receipt({ packet: reviewPacket, reviewerUserId: SECOND_USER, reviewerSessionId: SECOND_SESSION, decision: 'correct_value_with_evidence', decisionPayload }),
    ],
    parent: {
      id: EXTRACTION_ID,
      sourceDocumentId: SOURCE_ID,
      sourceHash: reviewPacket.sourceHash,
      extractionHash: reviewPacket.parentExtractionHash,
      documentIr: documentIr(),
    },
    ...overrides,
  };
}

describe('human review resume loop', () => {
  it('keeps receipt identity stable when persistence rewrites the server timestamp', () => {
    const reviewPacket = packet();
    const base = receipt({
      packet: reviewPacket,
      reviewerUserId: FIRST_USER,
      reviewerSessionId: FIRST_SESSION,
      decision: 'select_axis',
      decisionPayload: { selectedAxisKey: 'axis:a' },
    });
    const { createdAt: _createdAt, receiptHash: _receiptHash, ...identity } = base;
    expect(reviewReceiptHash({ ...identity, createdAt: '2026-09-04T01:02:03.000Z' })).toBe(
      reviewReceiptHash({ ...identity, createdAt: '2026-09-04T09:08:07.000Z' }),
    );
  });

  it('turns two agreeing correction receipts into one lineage-bound derived extraction', () => {
    const plan = buildReviewResumePlan(input());
    expect(plan.disposition).toBe('derive_and_revalidate');
    if (plan.disposition !== 'derive_and_revalidate') return;
    expect(plan.patches).toHaveLength(1);
    expect(plan.patches[0]!.axisKey).toBe('axis:a');
    const derived = createHumanReviewDerivedExtraction({ plan, parent: input().parent, createdBy: FIRST_USER });
    expect(derived.derivationType).toBe('human_review');
    expect(derived.documentIr.tables[0]!.cells[0]!.text).toBe('799,000원');
    expect(derived.documentIr.text).toContain('799,000원');
    expect(derived.parentExtractionHash).toBe(input().parent.extractionHash);
  });

  it('revalidates an accepted axis decision without inventing a text patch', () => {
    const base = input();
    const reviewPacket = packet();
    const payload = { selectedAxisKey: 'axis:a' };
    const receipts = [
      receipt({ packet: reviewPacket, reviewerUserId: FIRST_USER, reviewerSessionId: FIRST_SESSION, decision: 'select_axis', decisionPayload: payload }),
      receipt({ packet: reviewPacket, reviewerUserId: SECOND_USER, reviewerSessionId: SECOND_SESSION, decision: 'select_axis', decisionPayload: payload }),
    ];
    const plan = buildReviewResumePlan({ ...base, packet: reviewPacket, receipts });
    expect(plan).toMatchObject({ disposition: 'revalidate_parent', selectedAxisKey: 'axis:a' });
  });

  it('closes source-insufficient cases without creating a derived extraction', () => {
    const base = input();
    const reviewPacket = packet();
    const payload = {};
    const receipts = [
      receipt({ packet: reviewPacket, reviewerUserId: FIRST_USER, reviewerSessionId: FIRST_SESSION, decision: 'mark_source_insufficient', decisionPayload: payload }),
      receipt({ packet: reviewPacket, reviewerUserId: SECOND_USER, reviewerSessionId: SECOND_SESSION, decision: 'mark_source_insufficient', decisionPayload: payload }),
    ];
    const plan = buildReviewResumePlan({ ...base, packet: reviewPacket, receipts, status: 'source_insufficient' });
    expect(plan).toMatchObject({ disposition: 'terminal_without_derivation', status: 'source_insufficient' });
  });

  it('fails closed when a correction does not bind to the packet cell', () => {
    const base = input();
    const badPacket = packet();
    const badReceipt = createReviewReceipt({
      caseId: CASE_ID,
      reviewerUserId: FIRST_USER,
      reviewerSessionId: FIRST_SESSION,
      reviewerSlot: 'first',
      packetHash: badPacket.packetHash,
      sourceHash: badPacket.sourceHash,
      parentExtractionHash: badPacket.parentExtractionHash,
      candidateAxisSetHash: badPacket.candidateAxisSetHash,
      decision: 'correct_value_with_evidence',
      decisionPayload: { selectedAxisKey: 'axis:a', patches: [{ fieldKey: 'wrong.field', oldValue: '699,000원', newValue: '799,000원', sourceCellEvidenceId: 'cell-price' }] },
      evidence: [{ evidenceId: 'cell-price', quoteHash: sha256Hex('699,000원') }],
      reason: '잘못된 필드로 제출합니다.',
    });
    const secondBadReceipt = createReviewReceipt({
      caseId: CASE_ID,
      reviewerUserId: SECOND_USER,
      reviewerSessionId: SECOND_SESSION,
      reviewerSlot: 'second',
      packetHash: badPacket.packetHash,
      sourceHash: badPacket.sourceHash,
      parentExtractionHash: badPacket.parentExtractionHash,
      candidateAxisSetHash: badPacket.candidateAxisSetHash,
      decision: 'correct_value_with_evidence',
      decisionPayload: badReceipt.decisionPayload,
      evidence: badReceipt.evidence,
      reason: '잘못된 필드로 다시 제출합니다.',
    });
    expect(() => buildReviewResumePlan({ ...base, packet: badPacket, receipts: [badReceipt, secondBadReceipt] }))
      .toThrow('REVIEW_RESUME_TARGET_NOT_UNIQUE:wrong.field');
  });
});
