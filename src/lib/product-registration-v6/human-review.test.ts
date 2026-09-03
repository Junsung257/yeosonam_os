import { describe, expect, it } from 'vitest';

import {
  PRODUCT_REGISTRATION_HUMAN_REVIEW_CONTRACT_VERSION,
  PRODUCT_REGISTRATION_HUMAN_REVIEW_POLICY_VERSION,
  assertReviewPacket,
  assertReviewReceipt,
  createReviewPacket,
  createReviewReceipt,
  reviewCandidateAxisSetHash,
  summarizeReviewReceipts,
  type ReviewPacketV1,
  type ReviewReceiptV1,
  type ReviewEvidenceRefV1,
  type ReviewTargetV1,
} from './human-review';

const sourceHash = 'a'.repeat(64);
const extractionHash = 'b'.repeat(64);
const quoteHash = 'c'.repeat(64);
const firstReviewer = '11111111-1111-4111-8111-111111111111';
const secondReviewer = '22222222-2222-4222-8222-222222222222';
const adjudicator = '33333333-3333-4333-8333-333333333333';

const targets: ReviewTargetV1[] = [
  {
    targetId: 'price-1',
    fieldKey: 'price',
    candidateAxisKeys: ['hotel:standard', 'hotel:superior'],
    candidateValues: ['699000', '799000'],
    reasonCodes: ['AXIS_AMBIGUOUS'],
    sourceCellEvidenceId: 'T1:R2:C3',
    cellAddress: { row: 2, col: 3, rowSpan: 1, colSpan: 1 },
    renderContextPolicy: 'cell_with_headers',
  },
];

function packet(): ReviewPacketV1 {
  return createReviewPacket({
    caseId: '44444444-4444-4444-8444-444444444444',
    sourceDocumentId: '55555555-5555-4555-8555-555555555555',
    sourceHash,
    parentExtractionId: '66666666-6666-4666-8666-666666666666',
    parentExtractionHash: extractionHash,
    normalizationId: null,
    targets,
  });
}

function receipt(overrides: Partial<Parameters<typeof createReviewReceipt>[0]> = {}): ReviewReceiptV1 {
  const current = packet();
  return createReviewReceipt({
    caseId: current.caseId,
    reviewerUserId: firstReviewer,
    reviewerSessionId: '77777777-7777-4777-8777-777777777777',
    reviewerSlot: 'first',
    packetHash: current.packetHash,
    sourceHash,
    parentExtractionHash: extractionHash,
    candidateAxisSetHash: current.candidateAxisSetHash,
    decision: 'select_axis',
    decisionPayload: { selectedAxisKey: 'hotel:standard' },
    evidence: [{ evidenceId: 'T1:R2:C3', quoteHash }],
    reason: '원문 표의 헤더와 행을 대조했습니다.',
    ...overrides,
  });
}

describe('product registration human review contract', () => {
  it('creates deterministic, source-bound packets', () => {
    const first = packet();
    const second = packet();
    expect(first.contractVersion).toBe(PRODUCT_REGISTRATION_HUMAN_REVIEW_CONTRACT_VERSION);
    expect(first.policyVersion).toBe(PRODUCT_REGISTRATION_HUMAN_REVIEW_POLICY_VERSION);
    expect(first.packetHash).toBe(second.packetHash);
    expect(first.candidateAxisSetHash).toBe(reviewCandidateAxisSetHash(targets));
    expect(() => assertReviewPacket(first)).not.toThrow();
    expect(() => assertReviewPacket({ ...first, packetHash: 'f'.repeat(64) })).toThrow(
      'PRODUCT_REVIEW_PACKET_HASH_MISMATCH',
    );
  });

  it('uses locale-independent canonical ordering and validates optional normalization lineage', () => {
    const reordered = createReviewPacket({
      ...packet(),
      normalizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      targets: [{ ...targets[0]!, candidateAxisKeys: ['호텔:품격', 'hotel:standard'] }],
    });
    const sameValues = createReviewPacket({
      ...packet(),
      normalizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      targets: [{ ...targets[0]!, candidateAxisKeys: ['hotel:standard', '호텔:품격'] }],
    });
    expect(reordered.packetHash).toBe(sameValues.packetHash);
    expect(() => createReviewPacket({ ...packet(), normalizationId: 'not-a-uuid' })).toThrow(
      'PRODUCT_REVIEW_NORMALIZATION_ID_INVALID',
    );
  });

  it('sorts targets and evidence before hashing a receipt', () => {
    const current = packet();
    const result = receipt({
      reviewerSlot: 'second',
      reviewerUserId: secondReviewer,
      reviewerSessionId: '88888888-8888-4888-8888-888888888888',
      evidence: [
        { evidenceId: 'z', quoteHash },
        { evidenceId: 'a', quoteHash },
      ] as ReviewEvidenceRefV1[],
    });
    expect(result.packetHash).toBe(current.packetHash);
    expect(result.evidence.map(item => item.evidenceId)).toEqual(['a', 'z']);
    expect(result.receiptHash).toHaveLength(64);
    expect(() => assertReviewReceipt(result)).not.toThrow();
  });

  it('requires decision-specific evidence and payload', () => {
    expect(() => receipt({ evidence: [] })).toThrow('PRODUCT_REVIEW_EVIDENCE_REQUIRED');
    expect(() => receipt({ decisionPayload: {} })).toThrow('PRODUCT_REVIEW_SELECTED_AXIS_REQUIRED');
    expect(() => receipt({
      decision: 'correct_value_with_evidence',
      decisionPayload: { patches: [] },
    })).toThrow('PRODUCT_REVIEW_PATCHES_REQUIRED');
  });

  it('accepts only exact independent agreement', () => {
    const first = receipt();
    const second = receipt({
      reviewerUserId: secondReviewer,
      reviewerSessionId: '88888888-8888-4888-8888-888888888888',
      reviewerSlot: 'second',
    });
    expect(summarizeReviewReceipts([first, second])).toMatchObject({ status: 'accepted', agreeing: true });
    const conflict = receipt({
      reviewerUserId: secondReviewer,
      reviewerSessionId: '88888888-8888-4888-8888-888888888888',
      reviewerSlot: 'second',
      decisionPayload: { selectedAxisKey: 'hotel:superior' },
    });
    expect(summarizeReviewReceipts([first, conflict])).toMatchObject({ status: 'adjudication_required', agreeing: false });
    expect(() => summarizeReviewReceipts([first, receipt({ reviewerUserId: firstReviewer, reviewerSlot: 'second' })])).toThrow('PRODUCT_REVIEW_REVIEWERS_MUST_BE_INDEPENDENT');
  });

  it('maps agreed source-insufficient and adjudicated outcomes safely', () => {
    const first = receipt({ decision: 'mark_source_insufficient', decisionPayload: {} });
    const second = receipt({
      reviewerUserId: secondReviewer,
      reviewerSessionId: '88888888-8888-4888-8888-888888888888',
      reviewerSlot: 'second',
      decision: 'mark_source_insufficient',
      decisionPayload: {},
    });
    expect(summarizeReviewReceipts([first, second]).status).toBe('source_insufficient');
    const adjudicated = receipt({
      reviewerUserId: adjudicator,
      reviewerSessionId: '99999999-9999-4999-8999-999999999999',
      reviewerSlot: 'adjudicator',
      decision: 'mark_system_defect',
      decisionPayload: {},
    });
    expect(summarizeReviewReceipts([first, second, adjudicated]).status).toBe('system_quarantined');
  });

  it('detects tampering after a receipt was created', () => {
    const value = receipt();
    expect(() => assertReviewReceipt({ ...value, reason: '조작됨' })).toThrow('PRODUCT_REVIEW_RECEIPT_HASH_MISMATCH');
  });
});
