import { sha256Hex } from '@/lib/product-registration-v4/document-ir';
import type { DocumentIR, DocumentIrTable, DocumentIrTableCell } from '@/lib/product-registration-v4/types';

import {
  createDerivedDocumentExtraction,
  createDerivedExtractionPatch,
  type DerivedDocumentExtractionV1,
  type DerivedExtractionPatchV1,
} from './derived-extraction';
import {
  assertReviewPacket,
  assertReviewReceipt,
  summarizeReviewReceipts,
  type ProductReviewCaseStatus,
  type ReviewPacketV1,
  type ReviewReceiptV1,
} from './human-review';

/**
 * The resume worker receives this shape from the private claim RPC.  Keeping
 * the worker input explicit makes it impossible to accidentally resume from a
 * customer-facing product row or from a mutable draft.
 */
export type ReviewResumeInput = {
  caseId: string;
  jobId: string;
  tenantId: string;
  status: ProductReviewCaseStatus;
  packet: ReviewPacketV1;
  receipts: ReviewReceiptV1[];
  parent: {
    id: string;
    sourceDocumentId: string;
    sourceHash: string;
    extractionHash: string;
    documentIr: DocumentIR;
  };
};

export type ReviewResumePlan =
  | {
    disposition: 'not_ready';
    status: ProductReviewCaseStatus;
    reasonCode: string;
  }
  | {
    disposition: 'terminal_without_derivation';
    status: Extract<ProductReviewCaseStatus, 'source_insufficient' | 'system_quarantined'>;
    receiptHash: string;
    reasonCode: string;
  }
  | {
    disposition: 'revalidate_parent';
    status: 'accepted';
    receipt: ReviewReceiptV1;
    receiptHash: string;
    selectedAxisKey: string | null;
  }
  | {
    disposition: 'derive_and_revalidate';
    status: 'accepted';
    receipt: ReviewReceiptV1;
    receiptHash: string;
    patches: DerivedExtractionPatchV1[];
    selectedAxisKey: string | null;
  };

type JsonObject = Record<string, unknown>;

function object(value: unknown, code: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
  return value as JsonObject;
}

function requiredText(value: unknown, code: string): string {
  if (typeof value !== 'string' || value.normalize('NFC').trim().length === 0) throw new Error(code);
  return value.normalize('NFC').trim();
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.normalize('NFC').trim().length > 0
    ? value.normalize('NFC').trim()
    : null;
}

function tableCell(documentIr: DocumentIR, evidenceId: string): { table: DocumentIrTable; cell: DocumentIrTableCell } {
  const matches: Array<{ table: DocumentIrTable; cell: DocumentIrTableCell }> = [];
  for (const table of documentIr.tables) {
    for (const cell of table.cells) {
      if (cell.id === evidenceId) matches.push({ table, cell });
    }
  }
  if (matches.length !== 1) throw new Error('REVIEW_RESUME_SOURCE_CELL_NOT_UNIQUE');
  return matches[0]!;
}

function targetForField(packet: ReviewPacketV1, fieldKey: string) {
  const matches = packet.targets.filter(target => target.fieldKey === fieldKey);
  if (matches.length !== 1) throw new Error(`REVIEW_RESUME_TARGET_NOT_UNIQUE:${fieldKey}`);
  return matches[0]!;
}

function selectedAxis(target: ReviewPacketV1['targets'][number], payload: JsonObject): string {
  const requested = optionalText(payload.selectedAxisKey);
  if (requested && target.candidateAxisKeys.includes(requested)) return requested;
  if (!requested && target.candidateAxisKeys.length === 1) return target.candidateAxisKeys[0]!;
  throw new Error(`REVIEW_RESUME_AXIS_SELECTION_REQUIRED:${target.fieldKey}`);
}

function textOccurrence(documentIr: DocumentIR, cell: DocumentIrTableCell, oldValue: string): number {
  const cellNode = documentIr.nodes.find(node => node.id === cell.nodeId);
  if (!cellNode) throw new Error('REVIEW_RESUME_CELL_NODE_NOT_FOUND');
  const occurrences = documentIr.nodes
    .filter(node => typeof node.text === 'string' && node.text === oldValue && node.order <= cellNode.order)
    .length;
  if (occurrences < 1) throw new Error('REVIEW_RESUME_DOCUMENT_TEXT_OCCURRENCE_NOT_FOUND');
  return occurrences - 1;
}

function axisBindingHash(input: {
  caseId: string;
  parentExtractionHash: string;
  fieldKey: string;
  axisKey: string;
  tableKey: string;
  cell: DocumentIrTableCell;
  normalizedValue: string;
}): string {
  return sha256Hex(JSON.stringify({
    algorithm: 'product-registration-v6-axis-binding-v1',
    caseId: input.caseId,
    parentExtractionHash: input.parentExtractionHash,
    fieldKey: input.fieldKey,
    axisKey: input.axisKey,
    tableKey: input.tableKey,
    cellAddress: {
      row: input.cell.row,
      col: input.cell.column,
      rowSpan: input.cell.rowSpan,
      colSpan: input.cell.colSpan,
    },
    normalizedValue: input.normalizedValue.normalize('NFC'),
  }));
}

function reviewPatches(input: ReviewResumeInput, receipt: ReviewReceiptV1): DerivedExtractionPatchV1[] {
  const payload = object(receipt.decisionPayload, 'REVIEW_RESUME_DECISION_PAYLOAD_INVALID');
  if (!Array.isArray(payload.patches) || payload.patches.length === 0) {
    throw new Error('REVIEW_RESUME_PATCHES_REQUIRED');
  }
  const seenFields = new Set<string>();
  return payload.patches.map((rawPatch, index) => {
    const patch = object(rawPatch, `REVIEW_RESUME_PATCH_INVALID:${index}`);
    const fieldKey = requiredText(patch.fieldKey, `REVIEW_RESUME_PATCH_FIELD_REQUIRED:${index}`);
    if (seenFields.has(fieldKey)) throw new Error(`REVIEW_RESUME_DUPLICATE_PATCH_FIELD:${fieldKey}`);
    seenFields.add(fieldKey);
    const oldValue = requiredText(patch.oldValue, `REVIEW_RESUME_PATCH_OLD_VALUE_REQUIRED:${index}`);
    const newValue = requiredText(patch.newValue, `REVIEW_RESUME_PATCH_NEW_VALUE_REQUIRED:${index}`);
    const sourceCellEvidenceId = requiredText(
      patch.sourceCellEvidenceId,
      `REVIEW_RESUME_PATCH_EVIDENCE_REQUIRED:${index}`,
    );
    const target = targetForField(input.packet, fieldKey);
    if (target.sourceCellEvidenceId !== sourceCellEvidenceId) {
      throw new Error(`REVIEW_RESUME_PATCH_TARGET_EVIDENCE_MISMATCH:${fieldKey}`);
    }
    const address = target.cellAddress;
    if (!address) throw new Error(`REVIEW_RESUME_PATCH_CELL_REQUIRED:${fieldKey}`);
    const located = tableCell(input.parent.documentIr, sourceCellEvidenceId);
    const { table, cell } = located;
    if (cell.row !== address.row || cell.column !== address.col
      || cell.rowSpan !== address.rowSpan || cell.colSpan !== address.colSpan) {
      throw new Error(`REVIEW_RESUME_PATCH_CELL_ADDRESS_MISMATCH:${fieldKey}`);
    }
    if (cell.text !== oldValue) throw new Error(`REVIEW_RESUME_PATCH_OLD_VALUE_MISMATCH:${fieldKey}`);
    const axisKey = selectedAxis(target, payload);
    const evidenceIds = receipt.evidence.map(evidence => evidence.evidenceId);
    if (!evidenceIds.includes(sourceCellEvidenceId)) {
      throw new Error(`REVIEW_RESUME_PATCH_EVIDENCE_NOT_IN_RECEIPT:${fieldKey}`);
    }
    const sourceEvidence = receipt.evidence.find(evidence => evidence.evidenceId === sourceCellEvidenceId);
    if (!sourceEvidence || sourceEvidence.quoteHash !== cell.evidence.quoteHash) {
      throw new Error(`REVIEW_RESUME_PATCH_QUOTE_HASH_MISMATCH:${fieldKey}`);
    }
    return createDerivedExtractionPatch({
      fieldKey,
      axisKey,
      oldValue,
      newValue,
      sourceCellEvidenceId,
      recoveryEvidenceIds: evidenceIds,
      axisBindingHash: axisBindingHash({
        caseId: input.caseId,
        parentExtractionHash: input.parent.extractionHash,
        fieldKey,
        axisKey,
        tableKey: table.id,
        cell,
        normalizedValue: newValue,
      }),
      reasonCode: 'human_review_receipt',
      tableKey: table.id,
      cellAddress: {
        row: cell.row,
        col: cell.column,
        rowSpan: cell.rowSpan,
        colSpan: cell.colSpan,
      },
      documentTextOccurrence: textOccurrence(input.parent.documentIr, cell, oldValue),
    });
  });
}

function finalReceipt(input: ReviewResumeInput): { status: ProductReviewCaseStatus; receipt: ReviewReceiptV1 | null } {
  const summary = summarizeReviewReceipts(input.receipts);
  const adjudicator = input.receipts.find(receipt => receipt.reviewerSlot === 'adjudicator') ?? null;
  const first = input.receipts.find(receipt => receipt.reviewerSlot === 'first') ?? null;
  return { status: summary.status, receipt: adjudicator ?? (summary.agreeing ? first : null) };
}

/**
 * Turns a terminal review case into a deterministic, side-effect-free resume
 * plan.  It validates every receipt against the packet and refuses to guess a
 * product axis or a repeated source-text occurrence.
 */
export function buildReviewResumePlan(input: ReviewResumeInput): ReviewResumePlan {
  assertReviewPacket(input.packet);
  if (input.packet.caseId !== input.caseId) throw new Error('REVIEW_RESUME_CASE_ID_MISMATCH');
  if (input.packet.parentExtractionId !== input.parent.id
    || input.packet.parentExtractionHash !== input.parent.extractionHash
    || input.packet.sourceDocumentId !== input.parent.sourceDocumentId
    || input.packet.sourceHash !== input.parent.sourceHash) {
    throw new Error('REVIEW_RESUME_PARENT_LINEAGE_MISMATCH');
  }
  input.receipts.forEach(receipt => {
    assertReviewReceipt(receipt);
    if (receipt.caseId !== input.caseId
      || receipt.packetHash !== input.packet.packetHash
      || receipt.sourceHash !== input.parent.sourceHash
      || receipt.parentExtractionHash !== input.parent.extractionHash
      || receipt.candidateAxisSetHash !== input.packet.candidateAxisSetHash) {
      throw new Error('REVIEW_RESUME_RECEIPT_LINEAGE_MISMATCH');
    }
  });
  const resolved = finalReceipt(input);
  if (!resolved.receipt || resolved.status === 'queued' || resolved.status === 'in_review'
    || resolved.status === 'awaiting_second' || resolved.status === 'adjudication_required') {
    return { disposition: 'not_ready', status: resolved.status, reasonCode: 'REVIEW_NOT_TERMINAL' };
  }
  if (resolved.status === 'source_insufficient' || resolved.status === 'system_quarantined') {
    return {
      disposition: 'terminal_without_derivation',
      status: resolved.status,
      receiptHash: resolved.receipt.receiptHash,
      reasonCode: resolved.status === 'source_insufficient' ? 'SOURCE_INSUFFICIENT' : 'SYSTEM_QUARANTINED',
    };
  }
  if (resolved.status !== 'accepted') throw new Error('REVIEW_RESUME_UNSUPPORTED_TERMINAL_STATUS');
  const payload = object(resolved.receipt.decisionPayload, 'REVIEW_RESUME_DECISION_PAYLOAD_INVALID');
  const selected = optionalText(payload.selectedAxisKey);
  if (resolved.receipt.decision === 'correct_value_with_evidence') {
    const patches = reviewPatches(input, resolved.receipt);
    return {
      disposition: 'derive_and_revalidate',
      status: 'accepted',
      receipt: resolved.receipt,
      receiptHash: resolved.receipt.receiptHash,
      patches,
      selectedAxisKey: patches.length === 1 ? patches[0]!.axisKey : selected,
    };
  }
  if (resolved.receipt.decision !== 'accept_auto_candidate' && resolved.receipt.decision !== 'select_axis') {
    throw new Error('REVIEW_RESUME_ACCEPTED_DECISION_UNSUPPORTED');
  }
  if (!selected) throw new Error('REVIEW_RESUME_SELECTED_AXIS_REQUIRED');
  const selectedTargets = input.packet.targets.filter(target => target.candidateAxisKeys.includes(selected));
  if (selectedTargets.length !== 1 && resolved.receipt.decision === 'select_axis') {
    throw new Error('REVIEW_RESUME_SELECTED_AXIS_AMBIGUOUS');
  }
  return {
    disposition: 'revalidate_parent',
    status: 'accepted',
    receipt: resolved.receipt,
    receiptHash: resolved.receipt.receiptHash,
    selectedAxisKey: selected,
  };
}

/** Creates the immutable child extraction after the plan has passed checks. */
export function createHumanReviewDerivedExtraction(input: {
  plan: Extract<ReviewResumePlan, { disposition: 'derive_and_revalidate' }>;
  parent: ReviewResumeInput['parent'];
  createdBy: string;
  createdAt?: string;
}): DerivedDocumentExtractionV1 {
  return createDerivedDocumentExtraction({
    parent: input.parent,
    derivationType: 'human_review',
    patches: input.plan.patches,
    createdBy: input.createdBy,
    createdAt: input.createdAt,
  });
}
