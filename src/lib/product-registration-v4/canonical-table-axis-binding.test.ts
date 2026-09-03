import { describe, expect, it } from 'vitest';

import { bindCanonicalVariantsToTablePriceAxes } from './canonical-table-axis-binding';
import type { DocumentIrTablePriceCalendar } from './table-grid-price-calendar';

function calendar(gradeLabel: string, amount: number, tableId = 'shared-price-table'): DocumentIrTablePriceCalendar {
  const evidence = (row: number) => ({
    line_start: row,
    line_end: row,
    char_start: 0,
    char_end: 1,
    quote: `${gradeLabel}-${row}`,
    quote_hash: `hash-${tableId}-${gradeLabel}-${row}`,
    extraction_method: 'document_ir_table_cell' as const,
  });
  return {
    tableId,
    durationDays: 5,
    transportCode: 'ZZ',
    gradeLabel,
    productLabelKind: 'package_grade',
    sourceNodeIds: [`node-${tableId}-${gradeLabel}`],
    prices: [
      { date: '2027-10-03', label: '10/3', amount, currency: 'KRW', list_price: null, evidence: evidence(1) },
      { date: '2027-10-04', label: '10/4', amount, currency: 'KRW', list_price: null, evidence: evidence(2) },
    ],
  };
}

function canonicalSection(variantKey: string, amount: number): Record<string, unknown> {
  return {
    v3: {
      ledger: {
        variants: [{
          variant_key: variantKey,
          price_calendar: [
            { date: '2027-10-03', amount, currency: 'KRW' },
            { date: '2027-10-04', amount, currency: 'KRW' },
          ],
        }],
      },
    },
  };
}

describe('bindCanonicalVariantsToTablePriceAxes', () => {
  it('binds distinct source grades one-to-one to canonical variants', () => {
    const result = bindCanonicalVariantsToTablePriceAxes({
      canonicalSections: [canonicalSection('standard', 699_000), canonicalSection('premium', 799_000)],
      calendars: [calendar('standard', 699_000), calendar('premium', 799_000)],
    });

    expect(result.bindings.map(binding => [binding.sectionIndex, binding.variantKey])).toEqual([
      [0, 'standard'],
      [1, 'premium'],
    ]);
    expect(result.unboundAxisKeys).toEqual([]);
    expect(result.ambiguousAxisKeys).toEqual([]);
  });

  it('does not pick the first axis when sibling grades have equal price facts', () => {
    const result = bindCanonicalVariantsToTablePriceAxes({
      canonicalSections: [canonicalSection('unknown-grade', 699_000)],
      calendars: [calendar('standard', 699_000), calendar('premium', 699_000)],
    });

    expect(result.bindings).toEqual([]);
    expect(result.ambiguousAxisKeys).toHaveLength(2);
    expect(result.candidateGroups).toEqual(expect.arrayContaining([
      expect.objectContaining({ competingAxisKeys: expect.arrayContaining(result.ambiguousAxisKeys) }),
    ]));
  });

  it('keeps identical facts in separate source tables ambiguous', () => {
    const result = bindCanonicalVariantsToTablePriceAxes({
      canonicalSections: [canonicalSection('same-price', 699_000)],
      calendars: [
        calendar('standard', 699_000, 'table-product-a'),
        calendar('standard', 699_000, 'table-product-b'),
      ],
    });

    expect(result.bindings).toEqual([]);
    expect(result.ambiguousAxisKeys).toHaveLength(2);
    expect(new Set(result.ambiguousAxisKeys).size).toBe(2);
  });

  it('rejects a coincidental partial overlap', () => {
    const section = canonicalSection('standard', 699_000);
    const variant = ((section.v3 as { ledger: { variants: Array<{ price_calendar: unknown[] }> } })
      .ledger.variants[0]!);
    variant.price_calendar[1] = { date: '2027-10-04', amount: 749_000, currency: 'KRW' };

    const result = bindCanonicalVariantsToTablePriceAxes({
      canonicalSections: [section],
      calendars: [calendar('standard', 699_000)],
    });

    expect(result.bindings).toEqual([]);
    expect(result.unboundAxisKeys).toHaveLength(1);
  });

  it('accepts only historical source facts omitted by the reference-date policy', () => {
    const section = canonicalSection('standard', 699_000);
    const variant = ((section.v3 as { ledger: { variants: Array<{ price_calendar: unknown[] }> } })
      .ledger.variants[0]!);
    variant.price_calendar.shift();

    expect(bindCanonicalVariantsToTablePriceAxes({
      canonicalSections: [section],
      calendars: [calendar('standard', 699_000)],
      referenceDate: '2027-10-04',
    }).bindings).toHaveLength(1);

    expect(bindCanonicalVariantsToTablePriceAxes({
      canonicalSections: [section],
      calendars: [calendar('standard', 699_000)],
      referenceDate: '2027-10-03',
    }).bindings).toHaveLength(0);
  });
});
