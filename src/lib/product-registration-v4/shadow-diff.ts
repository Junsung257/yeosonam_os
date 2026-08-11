import { stableJson } from './revision';

export type V5ShadowDiffKind = 'match' | 'missing' | 'added' | 'changed';
export type V5ShadowDiffSeverity = 'critical' | 'high' | 'normal';

export type V5ShadowDiff = {
  fieldPath: string;
  kind: V5ShadowDiffKind;
  severity: V5ShadowDiffSeverity;
  legacyValue: unknown;
  canonicalValue: unknown;
};

export type V5ShadowDiffReport = {
  diffs: V5ShadowDiff[];
  criticalMismatch: boolean;
  highMismatch: boolean;
  matchedCriticalFieldCount: number;
  mismatchedCriticalFieldCount: number;
};

type JsonObject = Record<string, unknown>;

const CRITICAL_FIELDS = [
  'price_calendar',
  'flight_segments',
  'minimum_departure',
  'standard_notices',
  'days',
  'inclusions',
  'exclusions',
  'options',
] as const;

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function sectionsOf(value: unknown): unknown[] {
  const record = asObject(value);
  return Array.isArray(record?.sections) ? record.sections : [value];
}

function variantsOf(value: unknown): unknown[] {
  const section = asObject(value);
  const v3 = asObject(section?.v3) ?? section;
  const ledger = asObject(v3?.ledger);
  return asArray(ledger?.variants);
}

function flattenedVariants(value: unknown): unknown[] {
  return sectionsOf(value).flatMap(section => variantsOf(section));
}

function severityForField(field: string): V5ShadowDiffSeverity {
  if (['price_calendar', 'flight_segments', 'minimum_departure', 'standard_notices'].includes(field)) return 'critical';
  if (['days', 'inclusions', 'exclusions', 'options'].includes(field)) return 'high';
  return 'normal';
}

function compareField(input: {
  fieldPath: string;
  field: string;
  legacyValue: unknown;
  canonicalValue: unknown;
}): V5ShadowDiff {
  const legacyMissing = input.legacyValue === undefined || input.legacyValue === null;
  const canonicalMissing = input.canonicalValue === undefined || input.canonicalValue === null;
  const kind: V5ShadowDiffKind = legacyMissing && !canonicalMissing
    ? 'added'
    : !legacyMissing && canonicalMissing
      ? 'missing'
      : stableJson(input.legacyValue) === stableJson(input.canonicalValue)
        ? 'match'
        : 'changed';
  return {
    fieldPath: input.fieldPath,
    kind,
    severity: severityForField(input.field),
    legacyValue: input.legacyValue,
    canonicalValue: input.canonicalValue,
  };
}

/**
 * Field-level differential check used during V3/V5 dual-write. It compares
 * only business-critical facts and deliberately ignores editorial formatting.
 */
export function buildV3V5CriticalDiff(input: {
  legacyPayload: unknown;
  canonicalPayload: unknown;
}): V5ShadowDiffReport {
  const diffs: V5ShadowDiff[] = [];
  const legacyVariants = flattenedVariants(input.legacyPayload);
  const canonicalVariants = flattenedVariants(input.canonicalPayload);
  const variantCount = Math.max(legacyVariants.length, canonicalVariants.length);
  for (let variantIndex = 0; variantIndex < variantCount; variantIndex += 1) {
    const legacyVariant = asObject(legacyVariants[variantIndex]);
    const canonicalVariant = asObject(canonicalVariants[variantIndex]);
    for (const field of CRITICAL_FIELDS) {
      diffs.push(compareField({
        fieldPath: `variants[${variantIndex}].${field}`,
        field,
        legacyValue: legacyVariant?.[field],
        canonicalValue: canonicalVariant?.[field],
      }));
    }
  }

  const mismatches = diffs.filter(diff => diff.kind !== 'match');
  const criticalMismatches = mismatches.filter(diff => diff.severity === 'critical');
  const highMismatches = mismatches.filter(diff => diff.severity === 'high');
  const criticalDiffs = diffs.filter(diff => diff.severity === 'critical');
  return {
    diffs,
    criticalMismatch: criticalMismatches.length > 0,
    highMismatch: highMismatches.length > 0,
    matchedCriticalFieldCount: criticalDiffs.filter(diff => diff.kind === 'match').length,
    mismatchedCriticalFieldCount: criticalMismatches.length,
  };
}
