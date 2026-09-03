import { createHash } from 'node:crypto';

const SHA256 = /^[0-9a-f]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const PRODUCT_REGISTRATION_HUMAN_REVIEW_CONTRACT_VERSION = 'human-review-v1' as const;
export const PRODUCT_REGISTRATION_HUMAN_REVIEW_POLICY_VERSION = 'product-registration-v6-review-1' as const;

export type ProductReviewSlot = 'first' | 'second' | 'adjudicator';

export type ProductReviewDecision =
  | 'accept_auto_candidate'
  | 'select_axis'
  | 'correct_value_with_evidence'
  | 'mark_source_insufficient'
  | 'mark_system_defect'
  | 'defer_need_more_context';

export type ProductReviewCaseStatus =
  | 'queued'
  | 'in_review'
  | 'awaiting_second'
  | 'adjudication_required'
  | 'accepted'
  | 'source_insufficient'
  | 'system_quarantined'
  | 'rejected'
  | 'expired'
  | 'cancelled';

export type ReviewEvidenceRefV1 = {
  evidenceId: string;
  quoteHash: string;
  tableKey?: string | null;
  row?: number | null;
  col?: number | null;
  page?: number | null;
  region?: { x: number; y: number; width: number; height: number } | null;
};

export type ReviewTargetV1 = {
  targetId: string;
  fieldKey: string;
  candidateAxisKeys: string[];
  candidateValues: string[];
  reasonCodes: string[];
  sourceCellEvidenceId?: string | null;
  cellAddress?: { row: number; col: number; rowSpan: number; colSpan: number } | null;
  renderContextPolicy: 'cell_with_headers' | 'page_region' | 'full_page';
};

export type ReviewPacketV1 = {
  contractVersion: typeof PRODUCT_REGISTRATION_HUMAN_REVIEW_CONTRACT_VERSION;
  caseId: string;
  sourceDocumentId: string;
  sourceHash: string;
  parentExtractionId: string;
  parentExtractionHash: string;
  normalizationId?: string | null;
  targets: ReviewTargetV1[];
  candidateAxisSetHash: string;
  policyVersion: typeof PRODUCT_REGISTRATION_HUMAN_REVIEW_POLICY_VERSION;
  packetHash: string;
};

export type ReviewReceiptV1 = {
  contractVersion: typeof PRODUCT_REGISTRATION_HUMAN_REVIEW_CONTRACT_VERSION;
  caseId: string;
  reviewerUserId: string;
  reviewerSessionId: string;
  reviewerSlot: ProductReviewSlot;
  packetHash: string;
  sourceHash: string;
  parentExtractionHash: string;
  candidateAxisSetHash: string;
  policyVersion: typeof PRODUCT_REGISTRATION_HUMAN_REVIEW_POLICY_VERSION;
  decision: ProductReviewDecision;
  decisionPayload: Record<string, unknown>;
  evidence: ReviewEvidenceRefV1[];
  reason: string;
  createdAt: string;
  receiptHash: string;
};

type JsonObject = Record<string, unknown>;

function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value.normalize('NFC'));
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('PRODUCT_REVIEW_NON_FINITE_NUMBER');
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as JsonObject)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  throw new Error('PRODUCT_REVIEW_CANONICAL_JSON_UNSUPPORTED');
}

/** Locale-independent ordering keeps hashes identical across worker regions. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function hash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function text(value: unknown, code: string): string {
  if (typeof value !== 'string' || value.normalize('NFC').trim().length === 0) throw new Error(code);
  return value.normalize('NFC').trim();
}

function sha(value: unknown, code: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new Error(code);
  return value;
}

function uuid(value: unknown, code: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error(code);
  return value.toLowerCase();
}

function object(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

function stringArray(value: unknown, code: string, allowEmpty = false): string[] {
  if (!Array.isArray(value)) throw new Error(code);
  const result = [...new Set(value.map(item => text(item, code)))].sort(compareText);
  if (!allowEmpty && result.length === 0) throw new Error(code);
  return result;
}

function candidateAxisSet(targets: readonly ReviewTargetV1[]): Record<string, string[][]> {
  const entries: Array<[string, string[][]]> = targets
    .map(target => [target.fieldKey, [
      [...target.candidateAxisKeys].sort(compareText),
      [...target.candidateValues].sort(compareText),
    ]] as [string, string[][]])
    .sort(([left], [right]) => compareText(left, right));
  return Object.fromEntries(entries);
}

function packetIdentity(packet: Omit<ReviewPacketV1, 'packetHash'>): Omit<ReviewPacketV1, 'packetHash'> {
  return packet;
}

export function reviewCandidateAxisSetHash(targets: readonly ReviewTargetV1[]): string {
  if (targets.length === 0) throw new Error('PRODUCT_REVIEW_TARGETS_REQUIRED');
  return hash(candidateAxisSet(targets));
}

export function reviewPacketHash(packet: Omit<ReviewPacketV1, 'packetHash'>): string {
  return hash(packetIdentity(packet));
}

export function createReviewPacket(input: Omit<ReviewPacketV1, 'contractVersion' | 'policyVersion' | 'candidateAxisSetHash' | 'packetHash'>): ReviewPacketV1 {
  const caseId = uuid(input.caseId, 'PRODUCT_REVIEW_CASE_ID_INVALID');
  const sourceDocumentId = uuid(input.sourceDocumentId, 'PRODUCT_REVIEW_SOURCE_ID_INVALID');
  const parentExtractionId = uuid(input.parentExtractionId, 'PRODUCT_REVIEW_PARENT_EXTRACTION_ID_INVALID');
  const sourceHash = sha(input.sourceHash, 'PRODUCT_REVIEW_SOURCE_HASH_INVALID');
  const parentExtractionHash = sha(input.parentExtractionHash, 'PRODUCT_REVIEW_PARENT_HASH_INVALID');
  const normalizationId = input.normalizationId == null
    ? null
    : uuid(input.normalizationId, 'PRODUCT_REVIEW_NORMALIZATION_ID_INVALID');
  const targets = input.targets.map((target, index) => {
    const row = object(target, `PRODUCT_REVIEW_TARGET_INVALID:${index}`);
    const renderContextPolicy = row.renderContextPolicy;
    if (!['cell_with_headers', 'page_region', 'full_page'].includes(String(renderContextPolicy))) {
      throw new Error(`PRODUCT_REVIEW_RENDER_POLICY_INVALID:${index}`);
    }
    const address = row.cellAddress == null ? null : object(row.cellAddress, `PRODUCT_REVIEW_CELL_ADDRESS_INVALID:${index}`);
    if (address && (![address.row, address.col, address.rowSpan, address.colSpan].every(value => Number.isInteger(value))
      || Number(address.row) < 0
      || Number(address.col) < 0
      || Number(address.rowSpan) < 1
      || Number(address.colSpan) < 1)) {
      throw new Error(`PRODUCT_REVIEW_CELL_ADDRESS_INVALID:${index}`);
    }
    return {
      targetId: text(row.targetId, `PRODUCT_REVIEW_TARGET_ID_REQUIRED:${index}`),
      fieldKey: text(row.fieldKey, `PRODUCT_REVIEW_FIELD_KEY_REQUIRED:${index}`),
      candidateAxisKeys: stringArray(row.candidateAxisKeys, `PRODUCT_REVIEW_AXIS_KEYS_INVALID:${index}`, true),
      candidateValues: stringArray(row.candidateValues, `PRODUCT_REVIEW_VALUES_INVALID:${index}`, true),
      reasonCodes: stringArray(row.reasonCodes, `PRODUCT_REVIEW_REASON_CODES_INVALID:${index}`),
      sourceCellEvidenceId: row.sourceCellEvidenceId == null ? null : text(row.sourceCellEvidenceId, `PRODUCT_REVIEW_EVIDENCE_ID_INVALID:${index}`),
      cellAddress: address ? {
        row: Number(address.row),
        col: Number(address.col),
        rowSpan: Number(address.rowSpan),
        colSpan: Number(address.colSpan),
      } : null,
      renderContextPolicy: renderContextPolicy as ReviewTargetV1['renderContextPolicy'],
    };
  }).sort((left, right) => compareText(left.targetId, right.targetId));
  if (new Set(targets.map(target => target.targetId)).size !== targets.length) {
    throw new Error('PRODUCT_REVIEW_TARGET_IDS_MUST_BE_UNIQUE');
  }
  if (new Set(targets.map(target => target.fieldKey)).size !== targets.length) {
    throw new Error('PRODUCT_REVIEW_FIELD_TARGETS_MUST_BE_UNIQUE');
  }
  const candidateAxisSetHash = reviewCandidateAxisSetHash(targets);
  const packetWithoutHash: Omit<ReviewPacketV1, 'packetHash'> = {
    contractVersion: PRODUCT_REGISTRATION_HUMAN_REVIEW_CONTRACT_VERSION,
    caseId,
    sourceDocumentId,
    sourceHash,
    parentExtractionId,
    parentExtractionHash,
    normalizationId,
    targets,
    candidateAxisSetHash,
    policyVersion: PRODUCT_REGISTRATION_HUMAN_REVIEW_POLICY_VERSION,
  };
  return { ...packetWithoutHash, packetHash: reviewPacketHash(packetWithoutHash) };
}

/** Rebuilds a packet so API/RPC callers cannot submit a stale or reordered hash. */
export function assertReviewPacket(packet: ReviewPacketV1): void {
  const candidate = createReviewPacket({
    caseId: packet.caseId,
    sourceDocumentId: packet.sourceDocumentId,
    sourceHash: packet.sourceHash,
    parentExtractionId: packet.parentExtractionId,
    parentExtractionHash: packet.parentExtractionHash,
    normalizationId: packet.normalizationId ?? null,
    targets: packet.targets,
  });
  if (candidate.packetHash !== packet.packetHash) throw new Error('PRODUCT_REVIEW_PACKET_HASH_MISMATCH');
}

function evidenceRef(value: unknown, index: number): ReviewEvidenceRefV1 {
  const row = object(value, `PRODUCT_REVIEW_EVIDENCE_INVALID:${index}`);
  const region = row.region == null ? null : object(row.region, `PRODUCT_REVIEW_REGION_INVALID:${index}`);
  const coordinate = (key: 'row' | 'col' | 'page'): number | null => {
    if (row[key] == null) return null;
    const number = Number(row[key]);
    if (!Number.isInteger(number) || number < 0) throw new Error(`PRODUCT_REVIEW_${key.toUpperCase()}_INVALID:${index}`);
    return number;
  };
  if (region && !['x', 'y', 'width', 'height'].every(key => Number.isFinite(Number(region[key])) && Number(region[key]) >= 0)) {
    throw new Error(`PRODUCT_REVIEW_REGION_INVALID:${index}`);
  }
  return {
    evidenceId: text(row.evidenceId, `PRODUCT_REVIEW_EVIDENCE_ID_REQUIRED:${index}`),
    quoteHash: sha(row.quoteHash, `PRODUCT_REVIEW_EVIDENCE_HASH_INVALID:${index}`),
    tableKey: row.tableKey == null ? null : text(row.tableKey, `PRODUCT_REVIEW_TABLE_KEY_INVALID:${index}`),
    row: coordinate('row'),
    col: coordinate('col'),
    page: coordinate('page'),
    region: region ? {
      x: Number(region.x), y: Number(region.y), width: Number(region.width), height: Number(region.height),
    } : null,
  };
}

function decisionPayload(value: unknown, decision: ProductReviewDecision): Record<string, unknown> {
  const payload = object(value, 'PRODUCT_REVIEW_DECISION_PAYLOAD_REQUIRED');
  if (decision === 'accept_auto_candidate' || decision === 'select_axis') {
    text(payload.selectedAxisKey, 'PRODUCT_REVIEW_SELECTED_AXIS_REQUIRED');
  }
  if (decision === 'correct_value_with_evidence') {
    if (!Array.isArray(payload.patches) || payload.patches.length === 0) {
      throw new Error('PRODUCT_REVIEW_PATCHES_REQUIRED');
    }
    payload.patches.forEach((patch, index) => {
      const row = object(patch, `PRODUCT_REVIEW_PATCH_INVALID:${index}`);
      text(row.fieldKey, `PRODUCT_REVIEW_PATCH_FIELD_REQUIRED:${index}`);
      if (typeof row.oldValue !== 'string' || typeof row.newValue !== 'string') {
        throw new Error(`PRODUCT_REVIEW_PATCH_VALUE_INVALID:${index}`);
      }
      text(row.sourceCellEvidenceId, `PRODUCT_REVIEW_PATCH_EVIDENCE_REQUIRED:${index}`);
    });
  }
  return payload;
}

function receiptIdentity(receipt: Omit<ReviewReceiptV1, 'receiptHash'>): Omit<ReviewReceiptV1, 'receiptHash'> {
  return receipt;
}

export function reviewReceiptHash(receipt: Omit<ReviewReceiptV1, 'receiptHash'>): string {
  return hash(receiptIdentity(receipt));
}

export function createReviewReceipt(input: Omit<ReviewReceiptV1, 'contractVersion' | 'policyVersion' | 'receiptHash' | 'createdAt'> & { createdAt?: string }): ReviewReceiptV1 {
  const caseId = uuid(input.caseId, 'PRODUCT_REVIEW_CASE_ID_INVALID');
  const reviewerUserId = uuid(input.reviewerUserId, 'PRODUCT_REVIEW_REVIEWER_ID_INVALID');
  const reviewerSessionId = uuid(input.reviewerSessionId, 'PRODUCT_REVIEW_SESSION_ID_INVALID');
  if (!['first', 'second', 'adjudicator'].includes(input.reviewerSlot)) throw new Error('PRODUCT_REVIEW_SLOT_INVALID');
  const decision = input.decision;
  if (!['accept_auto_candidate', 'select_axis', 'correct_value_with_evidence', 'mark_source_insufficient', 'mark_system_defect', 'defer_need_more_context'].includes(decision)) {
    throw new Error('PRODUCT_REVIEW_DECISION_INVALID');
  }
  const evidence = input.evidence.map(evidenceRef).sort((left, right) => compareText(left.evidenceId, right.evidenceId));
  if (evidence.length === 0) throw new Error('PRODUCT_REVIEW_EVIDENCE_REQUIRED');
  const reason = text(input.reason, 'PRODUCT_REVIEW_REASON_REQUIRED');
  if (reason.length < 5) throw new Error('PRODUCT_REVIEW_REASON_TOO_SHORT');
  const packetHash = sha(input.packetHash, 'PRODUCT_REVIEW_PACKET_HASH_INVALID');
  const sourceHash = sha(input.sourceHash, 'PRODUCT_REVIEW_SOURCE_HASH_INVALID');
  const parentExtractionHash = sha(input.parentExtractionHash, 'PRODUCT_REVIEW_PARENT_HASH_INVALID');
  const candidateAxisSetHash = sha(input.candidateAxisSetHash, 'PRODUCT_REVIEW_AXIS_SET_HASH_INVALID');
  const payload = decisionPayload(input.decisionPayload, decision);
  const createdAt = input.createdAt ?? new Date().toISOString();
  if (!Number.isNaN(Date.parse(createdAt))) {
    // Keep the caller's timestamp for audit replay; only malformed timestamps are rejected.
  } else {
    throw new Error('PRODUCT_REVIEW_CREATED_AT_INVALID');
  }
  const receiptWithoutHash: Omit<ReviewReceiptV1, 'receiptHash'> = {
    contractVersion: PRODUCT_REGISTRATION_HUMAN_REVIEW_CONTRACT_VERSION,
    caseId,
    reviewerUserId,
    reviewerSessionId,
    reviewerSlot: input.reviewerSlot,
    packetHash,
    sourceHash,
    parentExtractionHash,
    candidateAxisSetHash,
    policyVersion: PRODUCT_REGISTRATION_HUMAN_REVIEW_POLICY_VERSION,
    decision,
    decisionPayload: payload,
    evidence,
    reason,
    createdAt,
  };
  return { ...receiptWithoutHash, receiptHash: reviewReceiptHash(receiptWithoutHash) };
}

export function assertReviewReceipt(receipt: ReviewReceiptV1): void {
  const { receiptHash, ...withoutHash } = receipt;
  if (receiptHash !== reviewReceiptHash(withoutHash)) throw new Error('PRODUCT_REVIEW_RECEIPT_HASH_MISMATCH');
  createReviewReceipt({
    caseId: withoutHash.caseId,
    reviewerUserId: withoutHash.reviewerUserId,
    reviewerSessionId: withoutHash.reviewerSessionId,
    reviewerSlot: withoutHash.reviewerSlot,
    packetHash: withoutHash.packetHash,
    sourceHash: withoutHash.sourceHash,
    parentExtractionHash: withoutHash.parentExtractionHash,
    candidateAxisSetHash: withoutHash.candidateAxisSetHash,
    decision: withoutHash.decision,
    decisionPayload: withoutHash.decisionPayload,
    evidence: withoutHash.evidence,
    reason: withoutHash.reason,
    createdAt: withoutHash.createdAt,
  });
}

function terminalStatus(decision: ProductReviewDecision): ProductReviewCaseStatus {
  if (decision === 'mark_source_insufficient') return 'source_insufficient';
  if (decision === 'mark_system_defect') return 'system_quarantined';
  if (decision === 'accept_auto_candidate' || decision === 'select_axis' || decision === 'correct_value_with_evidence') return 'accepted';
  return 'adjudication_required';
}

export function summarizeReviewReceipts(receipts: readonly ReviewReceiptV1[]): {
  status: ProductReviewCaseStatus;
  agreeing: boolean;
  reviewerIds: string[];
} {
  const first = receipts.find(receipt => receipt.reviewerSlot === 'first');
  const second = receipts.find(receipt => receipt.reviewerSlot === 'second');
  const adjudicator = receipts.find(receipt => receipt.reviewerSlot === 'adjudicator');
  const reviewerIds = receipts.map(receipt => receipt.reviewerUserId);
  if (new Set(reviewerIds).size !== reviewerIds.length) throw new Error('PRODUCT_REVIEW_REVIEWERS_MUST_BE_INDEPENDENT');
  if (adjudicator) return { status: terminalStatus(adjudicator.decision), agreeing: false, reviewerIds };
  if (!first || !second) return { status: first ? 'awaiting_second' : 'queued', agreeing: false, reviewerIds };
  const agreeing = first.decision === second.decision
    && canonicalJson(first.decisionPayload) === canonicalJson(second.decisionPayload)
    && canonicalJson(first.evidence) === canonicalJson(second.evidence);
  return {
    status: agreeing ? terminalStatus(first.decision) : 'adjudication_required',
    agreeing,
    reviewerIds,
  };
}
