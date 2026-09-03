import {
  documentIrTablePriceCalendarAxisKey,
  type DocumentIrTablePriceCalendar,
} from './table-grid-price-calendar';

type JsonObject = Record<string, unknown>;

export type CanonicalTableAxisBinding = {
  axisKey: string;
  sectionIndex: number;
  variantIndex: number;
  variantKey: string | null;
};

export type CanonicalTableAxisBindingResult = {
  bindings: CanonicalTableAxisBinding[];
  unboundAxisKeys: string[];
  ambiguousAxisKeys: string[];
  candidateGroups: Array<{
    axisKey: string;
    candidateVariants: Array<{
      sectionIndex: number;
      variantIndex: number;
      variantKey: string | null;
    }>;
    competingAxisKeys: string[];
  }>;
  diagnostics: {
    exactAxisCount: number;
    nonExactAxisCount: number;
    exactVariantCount: number;
    nonExactVariantCount: number;
    unboundExactAxisCount: number;
    unboundNonExactAxisCount: number;
  };
};

function object(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}

function exactPriceFact(value: unknown): string | null {
  const price = object(value);
  const date = typeof price?.date === 'string' ? price.date : '';
  const amount = Number(price?.amount);
  const currency = typeof price?.currency === 'string' ? price.currency.toUpperCase() : '';
  return /^\d{4}-\d{2}-\d{2}$/u.test(date) && Number.isFinite(amount) && amount > 0 && currency
    ? JSON.stringify([date, amount, currency])
    : null;
}

function exactFactDate(fact: string): string | null {
  try {
    const value: unknown = JSON.parse(fact);
    return Array.isArray(value) && /^\d{4}-\d{2}-\d{2}$/u.test(String(value[0] ?? ''))
      ? String(value[0])
      : null;
  } catch {
    return null;
  }
}

function exactFactSetsCompatible(
  canonicalFacts: Set<string>,
  sourceFacts: Set<string>,
  referenceDate: string | null,
): boolean {
  if (canonicalFacts.size === 0 || sourceFacts.size === 0) return false;
  if (![...canonicalFacts].every(fact => sourceFacts.has(fact))) return false;
  if (canonicalFacts.size === sourceFacts.size) return true;
  if (!referenceDate) return false;
  return [...sourceFacts]
    .filter(fact => !canonicalFacts.has(fact))
    .every(fact => {
      const date = exactFactDate(fact);
      return Boolean(date && date < referenceDate);
    });
}

function scopedPriceFact(value: unknown): string | null {
  const price = object(value);
  const dateRange = object(price?.date_range);
  const rangeStart = typeof dateRange?.start === 'string' ? dateRange.start : '';
  const rangeEnd = typeof dateRange?.end === 'string' ? dateRange.end : '';
  const weekday = price?.weekday == null ? null : Number(price.weekday);
  const amount = Number(price?.amount);
  const currency = typeof price?.currency === 'string' ? price.currency.toUpperCase() : '';
  if (!Number.isFinite(amount) || amount <= 0 || !currency) return null;
  if (/^\d{4}-\d{2}-\d{2}$/u.test(rangeStart)
    && /^\d{4}-\d{2}-\d{2}$/u.test(rangeEnd)
    && rangeStart <= rangeEnd) {
    return JSON.stringify([
      'date_range',
      rangeStart,
      rangeEnd,
      Number.isInteger(weekday) && weekday! >= 0 && weekday! <= 6 ? weekday : null,
      amount,
      currency,
    ]);
  }
  if (Number.isInteger(weekday) && weekday! >= 0 && weekday! <= 6) {
    return JSON.stringify(['weekday', weekday, amount, currency]);
  }
  return null;
}

function scopedFactsCompatible(canonicalFact: string, sourceFact: string): boolean {
  let canonical: unknown;
  let source: unknown;
  try {
    canonical = JSON.parse(canonicalFact);
    source = JSON.parse(sourceFact);
  } catch {
    return false;
  }
  if (!Array.isArray(canonical) || !Array.isArray(source) || canonical[0] !== source[0]) return false;
  if (canonical[0] === 'weekday') return canonicalFact === sourceFact;
  if (canonical[0] !== 'date_range' || canonical.length !== 6 || source.length !== 6) return false;
  const [canonicalKind, canonicalStart, canonicalEnd, canonicalWeekday, canonicalAmount, canonicalCurrency] = canonical;
  const [sourceKind, sourceStart, sourceEnd, sourceWeekday, sourceAmount, sourceCurrency] = source;
  return canonicalKind === sourceKind
    && typeof canonicalStart === 'string'
    && typeof canonicalEnd === 'string'
    && typeof sourceStart === 'string'
    && typeof sourceEnd === 'string'
    && canonicalStart >= sourceStart
    && canonicalStart <= canonicalEnd
    && canonicalEnd === sourceEnd
    && canonicalWeekday === sourceWeekday
    && canonicalAmount === sourceAmount
    && canonicalCurrency === sourceCurrency;
}

function scopedFactSetsCompatible(canonicalFacts: Set<string>, sourceFacts: Set<string>): boolean {
  if (canonicalFacts.size !== sourceFacts.size || canonicalFacts.size === 0) return false;
  const remaining = new Set(sourceFacts);
  for (const canonicalFact of canonicalFacts) {
    const matches = [...remaining].filter(sourceFact => scopedFactsCompatible(canonicalFact, sourceFact));
    if (matches.length !== 1) return false;
    remaining.delete(matches[0]!);
  }
  return remaining.size === 0;
}

/**
 * Full price-fact sets bind source axes to canonical variants. A shared value
 * or one overlapping date is never enough. The result is accepted only when
 * both directions of the relationship are one-to-one.
 */
export function bindCanonicalVariantsToTablePriceAxes(input: {
  canonicalSections: Array<Record<string, unknown>>;
  calendars: DocumentIrTablePriceCalendar[];
  referenceDate?: string | null;
}): CanonicalTableAxisBindingResult {
  const referenceDate = typeof input.referenceDate === 'string'
    && /^\d{4}-\d{2}-\d{2}$/u.test(input.referenceDate)
    ? input.referenceDate
    : null;
  const variants = input.canonicalSections.flatMap((section, sectionIndex) => {
    const v3 = object(section.v3);
    const ledger = object(v3?.ledger);
    return (Array.isArray(ledger?.variants) ? ledger.variants : []).flatMap((rawVariant, variantIndex) => {
      const variant = object(rawVariant);
      if (!variant) return [];
      const priceCalendar = Array.isArray(variant.price_calendar) ? variant.price_calendar : [];
      const exactFacts = new Set(priceCalendar.map(exactPriceFact).filter((fact): fact is string => Boolean(fact)));
      const scopedFacts = new Set(priceCalendar.map(scopedPriceFact).filter((fact): fact is string => Boolean(fact)));
      if (exactFacts.size === 0 && scopedFacts.size === 0) return [];
      return [{
        id: `${sectionIndex}:${variantIndex}`,
        sectionIndex,
        variantIndex,
        variantKey: typeof variant.variant_key === 'string' && variant.variant_key.trim()
          ? variant.variant_key.trim()
          : null,
        exactFacts,
        scopedFacts,
      }];
    });
  });
  const axes = input.calendars.flatMap(calendar => {
    const exactFacts = new Set(calendar.prices.map(exactPriceFact).filter((fact): fact is string => Boolean(fact)));
    const scopedFacts = new Set(calendar.prices.map(scopedPriceFact).filter((fact): fact is string => Boolean(fact)));
    return exactFacts.size > 0 || scopedFacts.size > 0 ? [{
      axisKey: documentIrTablePriceCalendarAxisKey(calendar),
      exactFacts,
      scopedFacts,
    }] : [];
  });
  const axisCandidates = new Map<string, typeof variants>();
  const variantCandidateAxes = new Map<string, string[]>();
  for (const axis of axes) {
    const candidates = variants.filter(variant => axis.exactFacts.size > 0
      ? exactFactSetsCompatible(variant.exactFacts, axis.exactFacts, referenceDate)
      : variant.exactFacts.size === 0
        ? scopedFactSetsCompatible(variant.scopedFacts, axis.scopedFacts)
        : false);
    axisCandidates.set(axis.axisKey, candidates);
    for (const candidate of candidates) {
      variantCandidateAxes.set(candidate.id, [...(variantCandidateAxes.get(candidate.id) ?? []), axis.axisKey]);
    }
  }

  const bindings: CanonicalTableAxisBinding[] = [];
  const unboundAxisKeys: string[] = [];
  const ambiguousAxisKeys: string[] = [];
  for (const axis of axes) {
    const candidates = axisCandidates.get(axis.axisKey) ?? [];
    if (candidates.length === 0) {
      unboundAxisKeys.push(axis.axisKey);
      continue;
    }
    const candidate = candidates.length === 1 ? candidates[0]! : null;
    if (!candidate || (variantCandidateAxes.get(candidate.id) ?? []).length !== 1) {
      ambiguousAxisKeys.push(axis.axisKey);
      continue;
    }
    bindings.push({
      axisKey: axis.axisKey,
      sectionIndex: candidate.sectionIndex,
      variantIndex: candidate.variantIndex,
      variantKey: candidate.variantKey,
    });
  }
  return {
    bindings,
    unboundAxisKeys: [...new Set(unboundAxisKeys)].sort(),
    ambiguousAxisKeys: [...new Set(ambiguousAxisKeys)].sort(),
    candidateGroups: axes.map(axis => {
      const candidates = axisCandidates.get(axis.axisKey) ?? [];
      return {
        axisKey: axis.axisKey,
        candidateVariants: candidates.map(candidate => ({
          sectionIndex: candidate.sectionIndex,
          variantIndex: candidate.variantIndex,
          variantKey: candidate.variantKey,
        })),
        competingAxisKeys: sortedUniqueAxisKeys(candidates.flatMap(candidate => (
          variantCandidateAxes.get(candidate.id) ?? []
        ))),
      };
    }).sort((left, right) => left.axisKey.localeCompare(right.axisKey)),
    diagnostics: {
      exactAxisCount: axes.filter(axis => axis.exactFacts.size > 0).length,
      nonExactAxisCount: axes.filter(axis => axis.exactFacts.size === 0).length,
      exactVariantCount: variants.filter(variant => variant.exactFacts.size > 0).length,
      nonExactVariantCount: variants.filter(variant => variant.exactFacts.size === 0).length,
      unboundExactAxisCount: axes.filter(axis => axis.exactFacts.size > 0
        && unboundAxisKeys.includes(axis.axisKey)).length,
      unboundNonExactAxisCount: axes.filter(axis => axis.exactFacts.size === 0
        && unboundAxisKeys.includes(axis.axisKey)).length,
    },
  };
}

function sortedUniqueAxisKeys(values: string[]): string[] {
  return [...new Set(values)].sort();
}
