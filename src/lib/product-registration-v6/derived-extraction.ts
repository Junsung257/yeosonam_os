import type { SupabaseClient } from '@supabase/supabase-js';

import {
  buildCanonicalNormalization,
  canonicalNormalizationExecutionPolicy,
  type CanonicalNormalization,
} from '@/lib/product-registration-v4/canonical-worker';
import { getDocumentIRValidationErrors, sha256Hex } from '@/lib/product-registration-v4/document-ir';
import type { DocumentIR, DocumentIrTableCell } from '@/lib/product-registration-v4/types';
import type { ProductSourceDepartureYearContext } from '@/lib/product-registration/source-departure-year-context';

/**
 * A derived extraction is an immutable child of a parser extraction.  It is
 * deliberately stored in the existing extraction ledger (with lineage in
 * quality_diagnostics) so the original parser output is never overwritten.
 */
export const PRODUCT_REGISTRATION_DERIVED_EXTRACTION_CONTRACT_VERSION = 'derived-extraction-v1' as const;
export const PRODUCT_REGISTRATION_DERIVED_EXTRACTION_PARSER_ENGINE = 'v6-derived-extraction' as const;
export const PRODUCT_REGISTRATION_DERIVED_EXTRACTION_PARSER_VERSION = '1' as const;

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

export type DerivedExtractionDerivationType =
  | 'image_recovery'
  | 'human_review'
  | 'parser_upgrade_replay';

export type DerivedExtractionCellAddress = {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
};

export type DerivedExtractionPatchInput = {
  fieldKey: string;
  axisKey: string;
  oldValue: unknown;
  newValue: unknown;
  sourceCellEvidenceId: string;
  recoveryEvidenceIds: string[];
  axisBindingHash: string;
  reasonCode: string;
  tableKey: string;
  cellAddress: DerivedExtractionCellAddress;
  /**
   * When the same text occurs more than once in DocumentIR.text, the caller
   * must identify which occurrence belongs to this cell.  Failing closed is
   * safer than replacing a sibling product's value.
   */
  documentTextOccurrence?: number | null;
};

export type DerivedExtractionPatchV1 = DerivedExtractionPatchInput & {
  patchId: string;
};

export type DerivedExtractionLineageV1 = {
  contractVersion: typeof PRODUCT_REGISTRATION_DERIVED_EXTRACTION_CONTRACT_VERSION;
  derivationType: DerivedExtractionDerivationType;
  sourceDocumentId: string;
  sourceHash: string;
  parentExtractionId: string;
  parentExtractionHash: string;
  supersedesExtractionId: string;
  patchHash: string;
  contentHash: string;
  patchIds: string[];
  createdBy: string;
  createdAt: string;
};

export type DerivedDocumentExtractionV1 = {
  id: string;
  sourceDocumentId: string;
  sourceHash: string;
  parentExtractionId: string;
  parentExtractionHash: string;
  supersedesExtractionId: string;
  derivationType: DerivedExtractionDerivationType;
  patches: DerivedExtractionPatchV1[];
  patchHash: string;
  extractionHash: string;
  contentHash: string;
  documentIr: DocumentIR;
  lineage: DerivedExtractionLineageV1;
};

export type DerivedExtractionChainNode = Pick<
  DerivedDocumentExtractionV1,
  'id' | 'sourceDocumentId' | 'sourceHash' | 'parentExtractionId' | 'supersedesExtractionId' | 'contentHash'
>;

export type DerivedCanonicalNormalizationResult = {
  normalization: CanonicalNormalization;
  executionPolicy: ReturnType<typeof canonicalNormalizationExecutionPolicy>;
  derivedExtractionId: string;
  parentExtractionId: string;
  patchHash: string;
};

function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value.normalize('NFC'));
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('DERIVED_EXTRACTION_NON_FINITE_NUMBER');
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  throw new Error('DERIVED_EXTRACTION_CANONICAL_JSON_UNSUPPORTED');
}

function requireNonEmpty(value: string, code: string): string {
  if (typeof value !== 'string' || value.normalize('NFC').trim().length === 0) throw new Error(code);
  return value.normalize('NFC').trim();
}

function assertSha256(value: string, code: string): void {
  if (!SHA256_PATTERN.test(value)) throw new Error(code);
}

function assertCellAddress(address: DerivedExtractionCellAddress): void {
  if (!address || !Number.isInteger(address.row) || !Number.isInteger(address.col)
    || !Number.isInteger(address.rowSpan) || !Number.isInteger(address.colSpan)
    || address.row < 0 || address.col < 0 || address.rowSpan < 1 || address.colSpan < 1) {
    throw new Error('DERIVED_EXTRACTION_CELL_ADDRESS_INVALID');
  }
}

function patchIdentity(input: Omit<DerivedExtractionPatchInput, 'patchId'>): Record<string, unknown> {
  return {
    fieldKey: input.fieldKey,
    axisKey: input.axisKey,
    oldValue: input.oldValue,
    newValue: input.newValue,
    sourceCellEvidenceId: input.sourceCellEvidenceId,
    recoveryEvidenceIds: [...input.recoveryEvidenceIds].sort(),
    axisBindingHash: input.axisBindingHash,
    reasonCode: input.reasonCode,
    tableKey: input.tableKey,
    cellAddress: input.cellAddress,
    documentTextOccurrence: input.documentTextOccurrence ?? null,
    contractVersion: PRODUCT_REGISTRATION_DERIVED_EXTRACTION_CONTRACT_VERSION,
  };
}

export function createDerivedExtractionPatch(input: DerivedExtractionPatchInput): DerivedExtractionPatchV1 {
  const fieldKey = requireNonEmpty(input.fieldKey, 'DERIVED_EXTRACTION_FIELD_KEY_REQUIRED');
  const axisKey = requireNonEmpty(input.axisKey, 'DERIVED_EXTRACTION_AXIS_KEY_REQUIRED');
  const tableKey = requireNonEmpty(input.tableKey, 'DERIVED_EXTRACTION_TABLE_KEY_REQUIRED');
  const sourceCellEvidenceId = requireNonEmpty(
    input.sourceCellEvidenceId,
    'DERIVED_EXTRACTION_SOURCE_CELL_EVIDENCE_REQUIRED',
  );
  const reasonCode = requireNonEmpty(input.reasonCode, 'DERIVED_EXTRACTION_REASON_CODE_REQUIRED');
  if (typeof input.oldValue !== 'string' || typeof input.newValue !== 'string') {
    throw new Error('DERIVED_EXTRACTION_CELL_PATCH_VALUES_MUST_BE_TEXT');
  }
  if (input.recoveryEvidenceIds.length === 0
    || input.recoveryEvidenceIds.some(value => typeof value !== 'string' || value.trim().length === 0)) {
    throw new Error('DERIVED_EXTRACTION_RECOVERY_EVIDENCE_REQUIRED');
  }
  assertSha256(input.axisBindingHash, 'DERIVED_EXTRACTION_AXIS_BINDING_HASH_INVALID');
  assertCellAddress(input.cellAddress);
  if (input.documentTextOccurrence != null
    && (!Number.isInteger(input.documentTextOccurrence) || input.documentTextOccurrence < 0)) {
    throw new Error('DERIVED_EXTRACTION_DOCUMENT_TEXT_OCCURRENCE_INVALID');
  }
  const normalized = {
    ...input,
    fieldKey,
    axisKey,
    tableKey,
    sourceCellEvidenceId,
    reasonCode,
    oldValue: input.oldValue.normalize('NFC'),
    newValue: input.newValue.normalize('NFC'),
    recoveryEvidenceIds: [...new Set(input.recoveryEvidenceIds.map(value => value.normalize('NFC').trim()))].sort(),
    documentTextOccurrence: input.documentTextOccurrence ?? null,
  };
  return {
    ...normalized,
    patchId: `patch_${sha256Hex(canonicalJson(patchIdentity(normalized))).slice(0, 32)}`,
  };
}

function findCell(documentIr: DocumentIR, patch: DerivedExtractionPatchV1): {
  tableIndex: number;
  cellIndex: number;
  cell: DocumentIrTableCell;
} {
  const tableIndex = documentIr.tables.findIndex(table => table.id === patch.tableKey);
  if (tableIndex < 0) throw new Error(`DERIVED_EXTRACTION_TABLE_NOT_FOUND:${patch.tableKey}`);
  const table = documentIr.tables[tableIndex]!;
  const cellIndex = table.cells.findIndex(cell => (
    cell.row === patch.cellAddress.row
    && cell.column === patch.cellAddress.col
    && cell.rowSpan === patch.cellAddress.rowSpan
    && cell.colSpan === patch.cellAddress.colSpan
  ));
  if (cellIndex < 0) throw new Error(`DERIVED_EXTRACTION_CELL_NOT_FOUND:${patch.tableKey}`);
  const cell = table.cells[cellIndex]!;
  if (cell.id !== patch.sourceCellEvidenceId) {
    throw new Error(`DERIVED_EXTRACTION_CELL_EVIDENCE_MISMATCH:${patch.patchId}`);
  }
  return { tableIndex, cellIndex, cell };
}

function replaceDocumentText(
  value: string,
  oldValue: string,
  newValue: string,
  occurrence: number | null,
): string {
  if (oldValue.length === 0) return value;
  const positions: number[] = [];
  let cursor = value.indexOf(oldValue);
  while (cursor >= 0) {
    positions.push(cursor);
    cursor = value.indexOf(oldValue, cursor + oldValue.length);
  }
  if (positions.length === 0) return value;
  const selected = occurrence == null
    ? positions.length === 1 ? positions[0] : null
    : positions[occurrence] ?? null;
  if (selected == null) throw new Error('DERIVED_EXTRACTION_DOCUMENT_TEXT_AMBIGUOUS');
  return `${value.slice(0, selected)}${newValue}${value.slice(selected + oldValue.length)}`;
}

export function applyDerivedExtractionPatches(
  parentDocumentIr: DocumentIR,
  patches: readonly DerivedExtractionPatchV1[],
): DocumentIR {
  const validationErrors = getDocumentIRValidationErrors(parentDocumentIr);
  if (validationErrors.length > 0) throw new Error(`DERIVED_EXTRACTION_PARENT_IR_INVALID:${validationErrors.join(',')}`);
  const result = JSON.parse(JSON.stringify(parentDocumentIr)) as DocumentIR;
  const seenCells = new Set<string>();
  for (const patch of patches) {
    const key = `${patch.tableKey}:${patch.cellAddress.row}:${patch.cellAddress.col}:${patch.cellAddress.rowSpan}:${patch.cellAddress.colSpan}`;
    if (seenCells.has(key)) throw new Error(`DERIVED_EXTRACTION_DUPLICATE_CELL_PATCH:${key}`);
    seenCells.add(key);
    const located = findCell(result, patch);
    const oldValue = String(patch.oldValue);
    const newValue = String(patch.newValue);
    if (located.cell.text !== oldValue) throw new Error(`DERIVED_EXTRACTION_OLD_VALUE_MISMATCH:${patch.patchId}`);
    const node = result.nodes.find(item => item.id === located.cell.nodeId);
    if (!node || node.text !== oldValue) throw new Error(`DERIVED_EXTRACTION_NODE_VALUE_MISMATCH:${patch.patchId}`);
    located.cell.text = newValue;
    located.cell.evidence.quoteHash = sha256Hex(newValue);
    node.text = newValue;
    result.text = replaceDocumentText(
      result.text,
      oldValue,
      newValue,
      patch.documentTextOccurrence ?? null,
    );
  }
  const finalErrors = getDocumentIRValidationErrors(result);
  if (finalErrors.length > 0) throw new Error(`DERIVED_EXTRACTION_RESULT_IR_INVALID:${finalErrors.join(',')}`);
  return result;
}

function normalizedPatches(patches: readonly DerivedExtractionPatchV1[]): DerivedExtractionPatchV1[] {
  return [...patches].sort((left, right) => left.patchId.localeCompare(right.patchId));
}

export function derivedExtractionPatchHash(patches: readonly DerivedExtractionPatchV1[]): string {
  if (patches.length === 0) throw new Error('DERIVED_EXTRACTION_PATCHES_REQUIRED');
  const ids = new Set<string>();
  for (const patch of patches) {
    if (ids.has(patch.patchId)) throw new Error(`DERIVED_EXTRACTION_DUPLICATE_PATCH_ID:${patch.patchId}`);
    ids.add(patch.patchId);
  }
  return sha256Hex(canonicalJson(normalizedPatches(patches)));
}

export function createDerivedDocumentExtraction(input: {
  parent: {
    id: string;
    sourceDocumentId: string;
    sourceHash: string;
    extractionHash: string;
    documentIr: DocumentIR;
  };
  derivationType: DerivedExtractionDerivationType;
  patches: readonly DerivedExtractionPatchV1[];
  createdBy: string;
  createdAt?: string;
}): DerivedDocumentExtractionV1 {
  const parentId = requireNonEmpty(input.parent.id, 'DERIVED_EXTRACTION_PARENT_ID_REQUIRED');
  const sourceDocumentId = requireNonEmpty(input.parent.sourceDocumentId, 'DERIVED_EXTRACTION_SOURCE_ID_REQUIRED');
  const createdBy = requireNonEmpty(input.createdBy, 'DERIVED_EXTRACTION_CREATED_BY_REQUIRED');
  assertSha256(input.parent.sourceHash, 'DERIVED_EXTRACTION_SOURCE_HASH_INVALID');
  assertSha256(input.parent.extractionHash, 'DERIVED_EXTRACTION_PARENT_HASH_INVALID');
  if (sha256Hex(JSON.stringify(input.parent.documentIr)) !== input.parent.extractionHash) {
    throw new Error('DERIVED_EXTRACTION_PARENT_CONTENT_HASH_MISMATCH');
  }
  if (!['image_recovery', 'human_review', 'parser_upgrade_replay'].includes(input.derivationType)) {
    throw new Error('DERIVED_EXTRACTION_DERIVATION_TYPE_INVALID');
  }
  const patches = normalizedPatches(input.patches);
  const patchHash = derivedExtractionPatchHash(patches);
  const documentIr = applyDerivedExtractionPatches(input.parent.documentIr, patches);
  const extractionHash = sha256Hex(JSON.stringify(documentIr));
  if (extractionHash === input.parent.extractionHash) throw new Error('DERIVED_EXTRACTION_NOOP');
  const createdAt = input.createdAt ?? new Date().toISOString();
  const lineageWithoutContent = {
    contractVersion: PRODUCT_REGISTRATION_DERIVED_EXTRACTION_CONTRACT_VERSION,
    derivationType: input.derivationType,
    sourceDocumentId,
    sourceHash: input.parent.sourceHash,
    parentExtractionId: parentId,
    parentExtractionHash: input.parent.extractionHash,
    supersedesExtractionId: parentId,
    patchHash,
    patchIds: patches.map(patch => patch.patchId),
    createdBy,
    createdAt,
    extractionHash,
  };
  // Wall-clock timestamps are audit metadata, not business identity. Keeping
  // them out of the content hash makes retries converge on the same child row
  // instead of creating a second logical recovery for the same patch.
  const contentHash = sha256Hex(canonicalJson({
    ...lineageWithoutContent,
    createdAt: undefined,
  }));
  const lineage: DerivedExtractionLineageV1 = { ...lineageWithoutContent, contentHash };
  return {
    id: `derived_${contentHash.slice(0, 32)}`,
    sourceDocumentId,
    sourceHash: input.parent.sourceHash,
    parentExtractionId: parentId,
    parentExtractionHash: input.parent.extractionHash,
    supersedesExtractionId: parentId,
    derivationType: input.derivationType,
    patches,
    patchHash,
    extractionHash,
    contentHash,
    documentIr,
    lineage,
  };
}

export function assertDerivedExtractionChain(chain: readonly DerivedExtractionChainNode[]): void {
  const ids = new Set<string>();
  const contentHashes = new Set<string>();
  const byId = new Map<string, DerivedExtractionChainNode>();
  for (const node of chain) {
    if (ids.has(node.id)) throw new Error(`DERIVED_EXTRACTION_CHAIN_DUPLICATE_ID:${node.id}`);
    if (contentHashes.has(node.contentHash)) throw new Error(`DERIVED_EXTRACTION_CHAIN_DUPLICATE_CONTENT:${node.id}`);
    requireNonEmpty(node.id, 'DERIVED_EXTRACTION_CHAIN_ID_REQUIRED');
    requireNonEmpty(node.sourceDocumentId, 'DERIVED_EXTRACTION_CHAIN_SOURCE_REQUIRED');
    requireNonEmpty(node.parentExtractionId, 'DERIVED_EXTRACTION_CHAIN_PARENT_REQUIRED');
    requireNonEmpty(node.supersedesExtractionId, 'DERIVED_EXTRACTION_CHAIN_SUPERSESSION_REQUIRED');
    assertSha256(node.sourceHash, 'DERIVED_EXTRACTION_CHAIN_SOURCE_HASH_INVALID');
    assertSha256(node.contentHash, 'DERIVED_EXTRACTION_CHAIN_CONTENT_HASH_INVALID');
    ids.add(node.id);
    contentHashes.add(node.contentHash);
    byId.set(node.id, node);
  }
  for (const node of chain) {
    if (node.supersedesExtractionId !== node.parentExtractionId) {
      throw new Error(`DERIVED_EXTRACTION_CHAIN_SUPERSESSION_MISMATCH:${node.id}`);
    }
    const parent = byId.get(node.parentExtractionId);
    if (!parent) continue; // The first child may point at the base extraction ledger row.
    if (parent.sourceDocumentId !== node.sourceDocumentId || parent.sourceHash !== node.sourceHash) {
      throw new Error(`DERIVED_EXTRACTION_CHAIN_SOURCE_LINEAGE_MISMATCH:${node.id}`);
    }
    if (parent.id === node.id) throw new Error(`DERIVED_EXTRACTION_CHAIN_CYCLE:${node.id}`);
  }
}

export async function persistDerivedDocumentExtraction(input: {
  supabase: SupabaseClient;
  tenantId: string;
  derived: DerivedDocumentExtractionV1;
  qualityDiagnostics?: Record<string, unknown>;
}): Promise<{ id: string; extractionHash: string; patchHash: string; contentHash: string }> {
  assertDerivedExtractionChain([{
    id: input.derived.id,
    sourceDocumentId: input.derived.sourceDocumentId,
    sourceHash: input.derived.sourceHash,
    parentExtractionId: input.derived.parentExtractionId,
    supersedesExtractionId: input.derived.supersedesExtractionId,
    contentHash: input.derived.contentHash,
  }]);
  const validationErrors = getDocumentIRValidationErrors(input.derived.documentIr);
  if (validationErrors.length > 0) throw new Error(`DERIVED_EXTRACTION_IR_INVALID:${validationErrors.join(',')}`);
  const { data: source, error: sourceError } = await input.supabase
    .from('product_source_documents')
    .select('id,sha256')
    .eq('id', input.derived.sourceDocumentId)
    .eq('tenant_id', input.tenantId)
    .single();
  if (sourceError || !source) throw sourceError ?? new Error('DERIVED_EXTRACTION_SOURCE_NOT_FOUND');
  if (String((source as { sha256?: unknown }).sha256) !== input.derived.sourceHash) {
    throw new Error('DERIVED_EXTRACTION_SOURCE_HASH_MISMATCH');
  }
  const { data: parent, error: parentError } = await input.supabase
    .from('product_document_extractions')
    .select('id,source_document_id,extraction_hash')
    .eq('id', input.derived.parentExtractionId)
    .eq('source_document_id', input.derived.sourceDocumentId)
    .eq('tenant_id', input.tenantId)
    .single();
  if (parentError || !parent) throw parentError ?? new Error('DERIVED_EXTRACTION_PARENT_NOT_FOUND');
  if (String((parent as { extraction_hash?: unknown }).extraction_hash) !== input.derived.parentExtractionHash) {
    throw new Error('DERIVED_EXTRACTION_PARENT_HASH_MISMATCH');
  }
  const qualityDiagnostics = {
    ...(input.qualityDiagnostics ?? {}),
    derivedExtraction: input.derived.lineage,
  };
  const existingQuery = await input.supabase
    .from('product_document_extractions')
    .select('id,extraction_hash,quality_diagnostics')
    .eq('source_document_id', input.derived.sourceDocumentId)
    .eq('parser_engine', PRODUCT_REGISTRATION_DERIVED_EXTRACTION_PARSER_ENGINE)
    .eq('parser_version', PRODUCT_REGISTRATION_DERIVED_EXTRACTION_PARSER_VERSION)
    .eq('extraction_hash', input.derived.extractionHash)
    .maybeSingle();
  if (existingQuery.error) throw existingQuery.error;
  if (existingQuery.data) {
    const existingLineage = (existingQuery.data as { quality_diagnostics?: Record<string, unknown> })
      .quality_diagnostics?.derivedExtraction;
    if (!existingLineage || typeof existingLineage !== 'object'
      || (existingLineage as Record<string, unknown>).contentHash !== input.derived.contentHash
      || (existingLineage as Record<string, unknown>).parentExtractionId !== input.derived.parentExtractionId) {
      throw new Error('DERIVED_EXTRACTION_EXISTING_LINEAGE_CONFLICT');
    }
    return {
      id: String((existingQuery.data as { id?: unknown }).id),
      extractionHash: String((existingQuery.data as { extraction_hash?: unknown }).extraction_hash),
      patchHash: input.derived.patchHash,
      contentHash: input.derived.contentHash,
    };
  }
  const { data, error } = await input.supabase
    .from('product_document_extractions')
    .insert({
      tenant_id: input.tenantId,
      source_document_id: input.derived.sourceDocumentId,
      parser_engine: PRODUCT_REGISTRATION_DERIVED_EXTRACTION_PARSER_ENGINE,
      parser_version: PRODUCT_REGISTRATION_DERIVED_EXTRACTION_PARSER_VERSION,
      parser_checksum: input.derived.contentHash,
      extraction_hash: input.derived.extractionHash,
      document_ir: input.derived.documentIr,
      quality_diagnostics: qualityDiagnostics,
      status: 'complete',
    })
    .select('id,extraction_hash')
    .single();
  if (error || !data) throw error ?? new Error('DERIVED_EXTRACTION_PERSIST_EMPTY');
  return {
    id: String((data as { id?: unknown }).id),
    extractionHash: String((data as { extraction_hash?: unknown }).extraction_hash),
    patchHash: input.derived.patchHash,
    contentHash: input.derived.contentHash,
  };
}

/**
 * Re-run the existing canonical normalizer in analysis-only mode against the
 * derived IR.  This returns a shadow result and intentionally has no revision,
 * snapshot, or publication-pointer authority.
 */
export async function normalizeDerivedExtraction(input: {
  derived: Pick<DerivedDocumentExtractionV1, 'id' | 'sourceDocumentId' | 'documentIr' | 'parentExtractionId' | 'patchHash'>;
  attractions?: Parameters<typeof buildCanonicalNormalization>[0]['attractions'];
  criticalPriceOverrides?: Parameters<typeof buildCanonicalNormalization>[0]['criticalPriceOverrides'];
  sourceDepartureYearContext?: ProductSourceDepartureYearContext | null;
  departureDateReference?: Parameters<typeof buildCanonicalNormalization>[0]['departureDateReference'];
  supplierProfileHints?: Parameters<typeof buildCanonicalNormalization>[0]['supplierProfileHints'];
  allowEvidenceAiSegmentation?: boolean;
}): Promise<DerivedCanonicalNormalizationResult> {
  const normalization = await buildCanonicalNormalization({
    documentIr: input.derived.documentIr,
    sourceDocumentId: input.derived.sourceDocumentId,
    extractionId: input.derived.id,
    attractions: input.attractions,
    criticalPriceOverrides: input.criticalPriceOverrides,
    sourceDepartureYearContext: input.sourceDepartureYearContext,
    departureDateReference: input.departureDateReference,
    supplierProfileHints: input.supplierProfileHints,
    allowEvidenceAiSegmentation: input.allowEvidenceAiSegmentation,
  });
  const executionPolicy = canonicalNormalizationExecutionPolicy('analysis_only');
  if (executionPolicy.commitRevisions || executionPolicy.createSnapshots
    || executionPolicy.changePublicationPointer || executionPolicy.customerPublicationAuthority) {
    throw new Error('DERIVED_EXTRACTION_ANALYSIS_POLICY_VIOLATION');
  }
  if (normalization.extractionId !== input.derived.id
    || normalization.sourceDocumentId !== input.derived.sourceDocumentId) {
    throw new Error('DERIVED_EXTRACTION_NORMALIZATION_LINEAGE_MISMATCH');
  }
  return {
    normalization,
    executionPolicy,
    derivedExtractionId: input.derived.id,
    parentExtractionId: input.derived.parentExtractionId,
    patchHash: input.derived.patchHash,
  };
}

/** Persist the derived normalization as another append-only shadow record. */
export async function persistDerivedCanonicalNormalization(input: {
  supabase: SupabaseClient;
  tenantId: string;
  jobId: string;
  derived: Pick<DerivedDocumentExtractionV1, 'id' | 'sourceDocumentId' | 'parentExtractionId' | 'patchHash'>;
  result: DerivedCanonicalNormalizationResult;
  qualityDiagnostics?: Record<string, unknown>;
}): Promise<{ id: string; normalizationVersion: string }> {
  if (input.result.derivedExtractionId !== input.derived.id
    || input.result.parentExtractionId !== input.derived.parentExtractionId
    || input.result.patchHash !== input.derived.patchHash) {
    throw new Error('DERIVED_NORMALIZATION_LINEAGE_MISMATCH');
  }
  if (input.result.executionPolicy.commitRevisions
    || input.result.executionPolicy.createSnapshots
    || input.result.executionPolicy.changePublicationPointer
    || input.result.executionPolicy.customerPublicationAuthority) {
    throw new Error('DERIVED_NORMALIZATION_PUBLICATION_POLICY_VIOLATION');
  }
  const normalizationVersion = `${input.result.normalization.version}:derived:${input.derived.patchHash.slice(0, 16)}`;
  const qualityDiagnostics = {
    ...(input.qualityDiagnostics ?? {}),
    derivedNormalization: {
      parentExtractionId: input.derived.parentExtractionId,
      derivedExtractionId: input.derived.id,
      patchHash: input.derived.patchHash,
      executionMode: input.result.executionPolicy.mode,
      revisionWriteAuthority: false,
      snapshotWriteAuthority: false,
      publicationPointerWriteAuthority: false,
      customerPublicationAuthority: false,
    },
  };
  const existing = await input.supabase
    .from('product_registration_v4_normalizations')
    .select('id')
    .eq('job_id', input.jobId)
    .eq('normalization_version', normalizationVersion)
    .eq('raw_text_hash', input.result.normalization.rawTextHash)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return {
    id: String((existing.data as { id?: unknown }).id),
    normalizationVersion,
  };
  const { data, error } = await input.supabase
    .from('product_registration_v4_normalizations')
    .insert({
      tenant_id: input.tenantId,
      job_id: input.jobId,
      source_document_id: input.derived.sourceDocumentId,
      extraction_id: input.derived.id,
      normalization_version: normalizationVersion,
      raw_text_hash: input.result.normalization.rawTextHash,
      sections: input.result.normalization.sections,
      canonical_payload: input.result.normalization.canonicalPayload,
      quality_diagnostics: qualityDiagnostics,
      status: input.result.normalization.status,
    })
    .select('id')
    .single();
  if (error || !data) throw error ?? new Error('DERIVED_NORMALIZATION_PERSIST_EMPTY');
  return {
    id: String((data as { id?: unknown }).id),
    normalizationVersion,
  };
}

export function derivedExtractionLineageMetadata(derived: DerivedDocumentExtractionV1): Record<string, unknown> {
  return {
    ...derived.lineage,
    extractionHash: derived.extractionHash,
    parserEngine: PRODUCT_REGISTRATION_DERIVED_EXTRACTION_PARSER_ENGINE,
    parserVersion: PRODUCT_REGISTRATION_DERIVED_EXTRACTION_PARSER_VERSION,
  };
}
