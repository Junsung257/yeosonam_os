import { bindCanonicalVariantsToTablePriceAxes } from '@/lib/product-registration-v4/canonical-table-axis-binding';
import type { CanonicalNormalization } from '@/lib/product-registration-v4/canonical-worker';
import { sha256Hex } from '@/lib/product-registration-v4/document-ir';
import {
  buildDocumentIrTablePriceCalendars,
  documentIrTablePriceCalendarAxisKey,
  type DocumentIrTablePriceCalendar,
} from '@/lib/product-registration-v4/table-grid-price-calendar';
import type {
  DocumentIR,
  DocumentIrTable,
  DocumentIrTableCell,
} from '@/lib/product-registration-v4/types';

export const PRODUCT_REGISTRATION_RECOVERY_TARGET_CONTRACT_VERSION = 'recovery-target-v1' as const;
export const PRODUCT_REGISTRATION_ANALYSIS_RECOVERY_PLAN_VERSION = 'analysis-recovery-plan-v1' as const;
export const PRODUCT_REGISTRATION_RENDER_CONTEXT_POLICY =
  'target-cell-plus-row-column-headers-merged-boundary-product-axis-v1' as const;

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const DATE_PATTERN = /(?:20\d{2}[./-])?\d{1,2}[./-]\d{1,2}/u;
const MONEY_PATTERN = /(?:₩|￦|KRW|USD|\$)?\s*\d{1,3}(?:[,.]\d{3})+(?:\s*(?:원|달러))?/iu;
const FLIGHT_PATTERN = /\b[A-Z0-9]{2,3}\s*[- ]?\s*\d{2,4}\b/iu;
const DAY_PATTERN = /(?:제\s*)?\d{1,2}\s*일\s*차|DAY\s*\d{1,2}/iu;

export type RecoveryTargetReasonCode =
  | 'table_cell_address_invalid'
  | 'table_cell_overlap'
  | 'table_cell_evidence_hash_mismatch'
  | 'parser_structure_warning'
  | 'price_axis_ambiguous'
  | 'price_axis_unbound'
  | 'price_axis_conflict'
  | 'canonical_field_conflict'
  | 'canonical_field_unavailable_with_source_signal'
  | 'canonical_section_error'
  | 'price_calendar_analysis_failed';

export type RecoveryTargetV1 = {
  targetId: string;
  sourceId: string;
  sourceHash: string;
  parentExtractionId: string;
  documentType: DocumentIR['sourceType'];
  pageIndex: number | null;
  sectionIndex: number | null;
  tableKey: string | null;
  cellAddress: {
    row: number;
    col: number;
    rowSpan: number;
    colSpan: number;
  } | null;
  sourceEvidence: {
    cellId: string;
    nodeId: string;
    quoteHash: string;
  } | null;
  fieldKey: string;
  candidateAxisKeys: string[];
  candidateValues: string[];
  reasonCodes: RecoveryTargetReasonCode[];
  renderContextPolicy: typeof PRODUCT_REGISTRATION_RENDER_CONTEXT_POLICY;
  businessIdempotencyKey: string;
  contractVersion: typeof PRODUCT_REGISTRATION_RECOVERY_TARGET_CONTRACT_VERSION;
};

export type AnalysisRecoveryPlanV1 = {
  version: typeof PRODUCT_REGISTRATION_ANALYSIS_RECOVERY_PLAN_VERSION;
  sourceId: string;
  sourceHash: string;
  parentExtractionId: string;
  normalizationId: string;
  normalizationHash: string;
  disposition: 'analysis_clear' | 'recovery_required' | 'source_insufficient' | 'human_review_required';
  analysisOnly: true;
  revisionWriteAuthority: false;
  snapshotWriteAuthority: false;
  publicationPointerWriteAuthority: false;
  customerPublicationAuthority: false;
  targets: RecoveryTargetV1[];
  sourceInsufficientFields: string[];
  unresolvedReviewFields: string[];
  axisBinding: ReturnType<typeof bindCanonicalVariantsToTablePriceAxes>;
  selectionTruncated: boolean;
  planHash: string;
};

type TargetSeed = Omit<
  RecoveryTargetV1,
  'targetId' | 'sourceId' | 'sourceHash' | 'parentExtractionId' | 'documentType'
  | 'businessIdempotencyKey' | 'contractVersion' | 'renderContextPolicy'
>;

type CalendarContext = {
  calendar: DocumentIrTablePriceCalendar;
  sectionIndexes: number[];
  factHashes: string[];
};

function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value.normalize('NFC'));
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('ANALYSIS_RECOVERY_NON_FINITE_NUMBER');
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
  throw new Error('ANALYSIS_RECOVERY_CANONICAL_JSON_UNSUPPORTED');
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values.map(value => value.normalize('NFC').trim()).filter(Boolean))].sort();
}

function criticalValues(text: string): string[] {
  const normalized = text.normalize('NFKC');
  return sortedUnique([
    ...[...normalized.matchAll(new RegExp(DATE_PATTERN.source, 'giu'))].map(match => match[0]),
    ...[...normalized.matchAll(new RegExp(MONEY_PATTERN.source, 'giu'))].map(match => match[0]),
    ...[...normalized.matchAll(new RegExp(FLIGHT_PATTERN.source, 'giu'))].map(match => match[0]),
  ]);
}

function cellAddress(cell: DocumentIrTableCell): RecoveryTargetV1['cellAddress'] {
  return { row: cell.row, col: cell.column, rowSpan: cell.rowSpan, colSpan: cell.colSpan };
}

function sourceEvidence(cell: DocumentIrTableCell): NonNullable<RecoveryTargetV1['sourceEvidence']> {
  return { cellId: cell.id, nodeId: cell.nodeId, quoteHash: cell.evidence.quoteHash };
}

function targetSeed(input: {
  sectionIndex?: number | null;
  table?: DocumentIrTable | null;
  cell?: DocumentIrTableCell | null;
  fieldKey: string;
  candidateAxisKeys?: string[];
  candidateValues?: string[];
  reasonCodes: RecoveryTargetReasonCode[];
}): TargetSeed {
  const table = input.table ?? null;
  const cell = input.cell ?? null;
  return {
    pageIndex: cell?.evidence.page ?? table?.page ?? null,
    sectionIndex: input.sectionIndex ?? null,
    tableKey: table?.id ?? null,
    cellAddress: cell ? cellAddress(cell) : null,
    sourceEvidence: cell ? sourceEvidence(cell) : null,
    fieldKey: input.fieldKey,
    candidateAxisKeys: sortedUnique(input.candidateAxisKeys ?? []),
    candidateValues: sortedUnique(input.candidateValues ?? (cell ? criticalValues(cell.text) : [])),
    reasonCodes: sortedUnique(input.reasonCodes) as RecoveryTargetReasonCode[],
  };
}

function materializeTarget(input: {
  sourceId: string;
  sourceHash: string;
  extractionId: string;
  documentType: DocumentIR['sourceType'];
  seed: TargetSeed;
}): RecoveryTargetV1 {
  const identity = {
    sourceHash: input.sourceHash,
    parentExtractionId: input.extractionId,
    pageIndex: input.seed.pageIndex,
    sectionIndex: input.seed.sectionIndex,
    tableKey: input.seed.tableKey,
    cellAddress: input.seed.cellAddress,
    fieldKey: input.seed.fieldKey,
    candidateAxisKeys: input.seed.candidateAxisKeys,
    candidateValues: input.seed.candidateValues,
    reasonCodes: input.seed.reasonCodes,
    contractVersion: PRODUCT_REGISTRATION_RECOVERY_TARGET_CONTRACT_VERSION,
  };
  const identityHash = sha256Hex(canonicalJson(identity));
  return {
    targetId: `recovery_${identityHash.slice(0, 32)}`,
    sourceId: input.sourceId,
    sourceHash: input.sourceHash,
    parentExtractionId: input.extractionId,
    documentType: input.documentType,
    ...input.seed,
    renderContextPolicy: PRODUCT_REGISTRATION_RENDER_CONTEXT_POLICY,
    businessIdempotencyKey: sha256Hex(canonicalJson({
      purpose: 'product_registration_evidence_recovery',
      identityHash,
      sourceId: input.sourceId,
    })),
    contractVersion: PRODUCT_REGISTRATION_RECOVERY_TARGET_CONTRACT_VERSION,
  };
}

function sourceHasFieldSignal(fieldPath: string, text: string): boolean {
  if (fieldPath.endsWith('.price')) return MONEY_PATTERN.test(text);
  if (fieldPath.endsWith('.itinerary') || fieldPath.endsWith('.itinerary_variants')) return DAY_PATTERN.test(text);
  if (fieldPath.endsWith('.flight') || fieldPath.endsWith('.flight_times')) return FLIGHT_PATTERN.test(text);
  if (fieldPath.endsWith('.lodging')) return /(?:호텔|리조트|숙박|HOTEL|RESORT)/iu.test(text);
  if (fieldPath.endsWith('.inclusions')) return /(?:포\s*함|INCLUD)/iu.test(text);
  if (fieldPath.endsWith('.exclusions')) return /(?:불\s*포\s*함|제\s*외|EXCLUD)/iu.test(text);
  if (fieldPath.endsWith('.variants')) return /(?:PKG|패키지|상품|\d+\s*박\s*\d+\s*일)/iu.test(text);
  return false;
}

function cellMatchesField(fieldPath: string, cell: DocumentIrTableCell): boolean {
  const text = cell.text;
  if (fieldPath.endsWith('.price')) return MONEY_PATTERN.test(text) || DATE_PATTERN.test(text);
  if (fieldPath.endsWith('.itinerary') || fieldPath.endsWith('.itinerary_variants')) return DAY_PATTERN.test(text);
  if (fieldPath.endsWith('.flight') || fieldPath.endsWith('.flight_times')) return FLIGHT_PATTERN.test(text);
  if (fieldPath.endsWith('.lodging')) return /(?:호텔|리조트|숙박|HOTEL|RESORT)/iu.test(text);
  if (fieldPath.endsWith('.inclusions')) return /(?:포\s*함|INCLUD)/iu.test(text);
  if (fieldPath.endsWith('.exclusions')) return /(?:불\s*포\s*함|제\s*외|EXCLUD)/iu.test(text);
  return false;
}

function sectionIndexFromFieldPath(fieldPath: string): number | null {
  const match = fieldPath.match(/^sections\[(\d+)\]/u);
  return match ? Number(match[1]) : null;
}

function findFieldRegion(
  documentIr: DocumentIR,
  normalization: CanonicalNormalization,
  fieldPath: string,
): { table: DocumentIrTable | null; cell: DocumentIrTableCell | null; sectionIndex: number | null } {
  const sectionIndex = sectionIndexFromFieldPath(fieldPath);
  const section = sectionIndex == null ? null : normalization.sections.find(item => item.index === sectionIndex) ?? null;
  const matches = documentIr.tables.flatMap(table => table.cells
    .filter(cell => (!section || section.rawText.includes(cell.text.trim())) && cellMatchesField(fieldPath, cell))
    .map(cell => ({ table, cell })))
    .sort((left, right) => (
      (left.table.page ?? Number.MAX_SAFE_INTEGER) - (right.table.page ?? Number.MAX_SAFE_INTEGER)
      || left.cell.row - right.cell.row
      || left.cell.column - right.cell.column
    ));
  return { table: matches[0]?.table ?? null, cell: matches[0]?.cell ?? null, sectionIndex };
}

function tableStructureTargets(documentIr: DocumentIR): TargetSeed[] {
  const targets: TargetSeed[] = [];
  for (const table of documentIr.tables) {
    const occupied = new Map<string, DocumentIrTableCell>();
    for (const cell of table.cells) {
      const addressInvalid = !Number.isInteger(cell.row)
        || !Number.isInteger(cell.column)
        || !Number.isInteger(cell.rowSpan)
        || !Number.isInteger(cell.colSpan)
        || cell.row < 0
        || cell.column < 0
        || cell.rowSpan < 1
        || cell.colSpan < 1
        || cell.row + cell.rowSpan > table.rows
        || cell.column + cell.colSpan > table.columns;
      const evidenceInvalid = !SHA256_PATTERN.test(cell.evidence.quoteHash)
        || cell.evidence.quoteHash !== sha256Hex(cell.text);
      const overlaps = new Set<DocumentIrTableCell>();
      if (!addressInvalid) {
        for (let row = cell.row; row < cell.row + cell.rowSpan; row += 1) {
          for (let column = cell.column; column < cell.column + cell.colSpan; column += 1) {
            const key = `${row}:${column}`;
            const previous = occupied.get(key);
            if (previous && previous.id !== cell.id) overlaps.add(previous);
            else occupied.set(key, cell);
          }
        }
      }
      const reasons: RecoveryTargetReasonCode[] = [];
      if (addressInvalid) reasons.push('table_cell_address_invalid');
      if (evidenceInvalid) reasons.push('table_cell_evidence_hash_mismatch');
      if (overlaps.size > 0) reasons.push('table_cell_overlap');
      if (reasons.length > 0) {
        targets.push(targetSeed({
          table,
          cell,
          fieldKey: 'table_structure',
          reasonCodes: reasons,
        }));
      }
    }
  }
  return targets;
}

function parserWarningTargets(documentIr: DocumentIR): TargetSeed[] {
  const targets: TargetSeed[] = [];
  for (const asset of documentIr.assets) {
    if (asset.kind !== 'manifest' || !/(?:rhwp|parser|table[-_ ]?structure)/iu.test(asset.id)) continue;
    const metadata = asset.metadata;
    const warnings = metadata && Array.isArray(metadata.warnings) ? metadata.warnings : [];
    const status = typeof metadata?.status === 'string' ? metadata.status.toLowerCase() : '';
    const hasStructuralConcern = warnings.length > 0
      || metadata?.publicationSafe === false
      || ['mismatch', 'warning', 'blocked', 'failed'].includes(status);
    if (!hasStructuralConcern) continue;
    const tableKeys = warnings.flatMap(warning => {
      if (!warning || typeof warning !== 'object' || Array.isArray(warning)) return [];
      const key = (warning as Record<string, unknown>).tableKey;
      return typeof key === 'string' && key.trim() ? [key.trim()] : [];
    });
    const tables = tableKeys.length > 0
      ? documentIr.tables.filter(table => tableKeys.some(key => table.id.includes(key) || key.includes(table.id)))
      : [];
    if (tables.length === 0) {
      targets.push(targetSeed({ fieldKey: 'parser_structure', reasonCodes: ['parser_structure_warning'] }));
      continue;
    }
    for (const table of tables) {
      targets.push(targetSeed({ table, fieldKey: 'parser_structure', reasonCodes: ['parser_structure_warning'] }));
    }
  }
  return targets;
}

function priceFactValue(calendar: DocumentIrTablePriceCalendar): string[] {
  return calendar.prices.map(price => canonicalJson({
    date: price.date ?? null,
    dateRange: price.date_range ?? null,
    weekday: price.weekday ?? null,
    amount: price.amount,
    currency: price.currency,
  }));
}

function calendarContexts(input: {
  documentIr: DocumentIR;
  normalization: CanonicalNormalization;
}): { contexts: CalendarContext[]; analysisFailures: number[] } {
  const byAxis = new Map<string, Array<{ calendar: DocumentIrTablePriceCalendar; sectionIndex: number; factHash: string }>>();
  const analysisFailures: number[] = [];
  for (const section of input.normalization.sections) {
    try {
      const calendars = buildDocumentIrTablePriceCalendars({
        documentIr: input.documentIr,
        sectionRawText: section.rawText,
        fallbackYear: input.normalization.qualityDiagnostics.departureDatePolicy.referenceDate
          ? Number(input.normalization.qualityDiagnostics.departureDatePolicy.referenceDate.slice(0, 4))
          : null,
      });
      for (const calendar of calendars) {
        const axisKey = documentIrTablePriceCalendarAxisKey(calendar);
        const factHash = sha256Hex(canonicalJson(priceFactValue(calendar)));
        byAxis.set(axisKey, [...(byAxis.get(axisKey) ?? []), { calendar, sectionIndex: section.index, factHash }]);
      }
    } catch {
      analysisFailures.push(section.index);
    }
  }
  const contexts = [...byAxis.values()].map(values => ({
    calendar: values[0]!.calendar,
    sectionIndexes: [...new Set(values.map(value => value.sectionIndex))].sort((a, b) => a - b),
    factHashes: [...new Set(values.map(value => value.factHash))].sort(),
  }));
  return { contexts, analysisFailures };
}

function priceAxisTargets(input: {
  documentIr: DocumentIR;
  contexts: CalendarContext[];
  axisBinding: ReturnType<typeof bindCanonicalVariantsToTablePriceAxes>;
}): TargetSeed[] {
  const ambiguous = new Set(input.axisBinding.ambiguousAxisKeys);
  const unbound = new Set(input.axisBinding.unboundAxisKeys);
  return input.contexts.flatMap(context => {
    const axisKey = documentIrTablePriceCalendarAxisKey(context.calendar);
    const reason = ambiguous.has(axisKey)
      ? 'price_axis_ambiguous' as const
      : unbound.has(axisKey)
        ? 'price_axis_unbound' as const
        : null;
    if (!reason) return [];
    const table = input.documentIr.tables.find(item => item.id === context.calendar.tableId) ?? null;
    const sourceNodes = new Set(context.calendar.sourceNodeIds);
    const candidateCells = (table?.cells ?? [])
      .filter(cell => sourceNodes.has(cell.nodeId))
      .sort((left, right) => Number(MONEY_PATTERN.test(right.text)) - Number(MONEY_PATTERN.test(left.text))
        || left.row - right.row
        || left.column - right.column);
    const candidateGroup = input.axisBinding.candidateGroups.find(group => group.axisKey === axisKey);
    const candidateAxisKeys = reason === 'price_axis_ambiguous'
      ? candidateGroup?.competingAxisKeys ?? [axisKey]
      : [axisKey];
    return [targetSeed({
      sectionIndex: context.sectionIndexes.length === 1 ? context.sectionIndexes[0] : null,
      table,
      cell: candidateCells[0] ?? null,
      fieldKey: 'price_axis_ownership',
      candidateAxisKeys,
      candidateValues: priceFactValue(context.calendar),
      reasonCodes: [reason],
    })];
  });
}

function deduplicateSeeds(seeds: TargetSeed[]): TargetSeed[] {
  const byIdentity = new Map<string, TargetSeed>();
  for (const seed of seeds) {
    const identity = canonicalJson({
      pageIndex: seed.pageIndex,
      sectionIndex: seed.sectionIndex,
      tableKey: seed.tableKey,
      cellAddress: seed.cellAddress,
      fieldKey: seed.fieldKey,
    });
    const previous = byIdentity.get(identity);
    byIdentity.set(identity, previous ? {
      ...previous,
      candidateAxisKeys: sortedUnique([...previous.candidateAxisKeys, ...seed.candidateAxisKeys]),
      candidateValues: sortedUnique([...previous.candidateValues, ...seed.candidateValues]),
      reasonCodes: sortedUnique([...previous.reasonCodes, ...seed.reasonCodes]) as RecoveryTargetReasonCode[],
    } : seed);
  }
  return [...byIdentity.values()].sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
}

export function buildProductRegistrationAnalysisRecoveryPlan(input: {
  documentIr: DocumentIR;
  normalization: CanonicalNormalization;
  normalizationId: string;
  sourceHash: string;
  maxTargets?: number;
}): AnalysisRecoveryPlanV1 {
  if (!SHA256_PATTERN.test(input.sourceHash)) throw new Error('ANALYSIS_RECOVERY_SOURCE_HASH_INVALID');
  if (!input.normalizationId.trim()) throw new Error('ANALYSIS_RECOVERY_NORMALIZATION_ID_REQUIRED');
  if (input.normalization.sections.some(section => section.evidence.some(evidence => (
    evidence.sourceDocumentId && evidence.sourceDocumentId !== input.normalization.sourceDocumentId
  )))) {
    throw new Error('ANALYSIS_RECOVERY_SOURCE_LINEAGE_MISMATCH');
  }
  if (input.normalization.extractionId.trim().length === 0) {
    throw new Error('ANALYSIS_RECOVERY_EXTRACTION_ID_REQUIRED');
  }

  const { contexts, analysisFailures } = calendarContexts(input);
  const factHashesByAxis = new Map<string, Set<string>>();
  for (const context of contexts) {
    const axisKey = documentIrTablePriceCalendarAxisKey(context.calendar);
    factHashesByAxis.set(axisKey, new Set([
      ...(factHashesByAxis.get(axisKey) ?? []),
      ...context.factHashes,
    ]));
  }
  const axisBinding = bindCanonicalVariantsToTablePriceAxes({
    canonicalSections: input.normalization.canonicalPayload.sections,
    calendars: contexts.map(context => context.calendar),
    referenceDate: input.normalization.qualityDiagnostics.departureDatePolicy.referenceDate,
  });

  const seeds: TargetSeed[] = [
    ...tableStructureTargets(input.documentIr),
    ...parserWarningTargets(input.documentIr),
    ...priceAxisTargets({ documentIr: input.documentIr, contexts, axisBinding }),
  ];
  for (const [axisKey, factHashes] of factHashesByAxis) {
    if (factHashes.size <= 1) continue;
    const context = contexts.find(item => documentIrTablePriceCalendarAxisKey(item.calendar) === axisKey)!;
    const table = input.documentIr.tables.find(item => item.id === context.calendar.tableId) ?? null;
    seeds.push(targetSeed({
      table,
      fieldKey: 'price_axis_ownership',
      candidateAxisKeys: [axisKey],
      candidateValues: priceFactValue(context.calendar),
      reasonCodes: ['price_axis_conflict'],
    }));
  }
  for (const sectionIndex of analysisFailures) {
    seeds.push(targetSeed({
      sectionIndex,
      fieldKey: `sections[${sectionIndex}].price`,
      reasonCodes: ['price_calendar_analysis_failed'],
    }));
  }

  const sourceInsufficientFields: string[] = [];
  const unresolvedReviewFields: string[] = [];
  for (const field of input.normalization.qualityDiagnostics.completeness.fields) {
    if (field.state === 'confirmed' || field.state === 'not_applicable' || field.safeToDegrade) continue;
    const sectionIndex = sectionIndexFromFieldPath(field.fieldPath);
    const sectionText = sectionIndex == null
      ? input.documentIr.text
      : input.normalization.sections.find(section => section.index === sectionIndex)?.rawText ?? input.documentIr.text;
    if (field.state === 'unavailable' && !sourceHasFieldSignal(field.fieldPath, sectionText)) {
      sourceInsufficientFields.push(field.fieldPath);
      continue;
    }
    const region = findFieldRegion(input.documentIr, input.normalization, field.fieldPath);
    unresolvedReviewFields.push(field.fieldPath);
    seeds.push(targetSeed({
      ...region,
      fieldKey: field.fieldPath,
      reasonCodes: [field.state === 'conflicting'
        ? 'canonical_field_conflict'
        : 'canonical_field_unavailable_with_source_signal'],
    }));
  }
  input.normalization.canonicalPayload.sections.forEach((section, sectionIndex) => {
    if (!('error' in section)) return;
    unresolvedReviewFields.push(`sections[${sectionIndex}]`);
    seeds.push(targetSeed({
      sectionIndex,
      fieldKey: `sections[${sectionIndex}]`,
      reasonCodes: ['canonical_section_error'],
    }));
  });

  const uniqueSeeds = deduplicateSeeds(seeds);
  const maxTargets = Math.min(512, Math.max(1, Math.trunc(input.maxTargets ?? 128)));
  const selectionTruncated = uniqueSeeds.length > maxTargets;
  const targets = uniqueSeeds.slice(0, maxTargets).map(seed => materializeTarget({
    sourceId: input.normalization.sourceDocumentId,
    sourceHash: input.sourceHash,
    extractionId: input.normalization.extractionId,
    documentType: input.documentIr.sourceType,
    seed,
  }));
  const normalizedSourceInsufficient = sortedUnique(sourceInsufficientFields);
  const normalizedReviewFields = sortedUnique(unresolvedReviewFields);
  const disposition: AnalysisRecoveryPlanV1['disposition'] = targets.length > 0 || selectionTruncated
    ? 'recovery_required'
    : normalizedSourceInsufficient.length > 0
      ? 'source_insufficient'
      : input.normalization.status === 'needs_review' || normalizedReviewFields.length > 0
        ? 'human_review_required'
        : 'analysis_clear';
  const planWithoutHash = {
    version: PRODUCT_REGISTRATION_ANALYSIS_RECOVERY_PLAN_VERSION,
    sourceId: input.normalization.sourceDocumentId,
    sourceHash: input.sourceHash,
    parentExtractionId: input.normalization.extractionId,
    normalizationId: input.normalizationId,
    normalizationHash: sha256Hex(canonicalJson({
      version: input.normalization.version,
      rawTextHash: input.normalization.rawTextHash,
      canonicalPayload: input.normalization.canonicalPayload,
      qualityDiagnostics: input.normalization.qualityDiagnostics,
    })),
    disposition,
    analysisOnly: true as const,
    revisionWriteAuthority: false as const,
    snapshotWriteAuthority: false as const,
    publicationPointerWriteAuthority: false as const,
    customerPublicationAuthority: false as const,
    targets,
    sourceInsufficientFields: normalizedSourceInsufficient,
    unresolvedReviewFields: normalizedReviewFields,
    axisBinding,
    selectionTruncated,
  };
  return { ...planWithoutHash, planHash: sha256Hex(canonicalJson(planWithoutHash)) };
}
