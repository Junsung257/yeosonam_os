import { describe, expect, it } from 'vitest';
import { evaluateUploadDeliverability } from './deliverability-gate';

describe('evaluateUploadDeliverability', () => {
  it('blocks customer deliverables with structured root-cause messages', () => {
    const result = evaluateUploadDeliverability({
      priceRows: [],
      priceDates: [],
      destination: 'UNK',
      destinationCode: 'UNK',
      internalCode: 'PUS-AA-UNK-5D',
      itineraryDays: [{ day: 1 }, { day: 1 }],
      durationDays: 5,
      priceRecoveryFailures: ['llm:price_dates missing', 'deterministic:none:price_tiers missing'],
    });

    expect(result.ok).toBe(false);
    expect(result.blockers.join(' | ')).toContain('product_prices');
    expect(result.blockers.join(' | ')).toContain('price_dates');
    expect(result.blockers.join(' | ')).toContain('destination unresolved');
    expect(result.blockers.join(' | ')).toContain('itinerary duplicate day number');
  });

  it('blocks optional-tour price pollution when tiny ticket prices become product candidates', () => {
    const result = evaluateUploadDeliverability({
      priceRows: [{ target_date: '2026-07-01', day_of_week: null, net_price: 50000, adult_selling_price: 50000, child_price: null, note: null }],
      priceDates: [{ date: '2026-07-01', price: 50000, confirmed: false }],
      destination: 'Phu Quoc',
      destinationCode: 'PQC',
      internalCode: 'PUS-AA-PQC-5D',
      itineraryDays: [{ day: 1 }],
      durationDays: 5,
      rawText: 'Optional tour: VinWonders admission ticket adult 50,000원',
    });

    expect(result.ok).toBe(false);
    expect(result.blockers.join(' | ')).toContain('optional-tour ticket amount polluted product price');
  });

  it('blocks surcharge or cancellation prices even when they are above the tiny-price threshold', () => {
    const result = evaluateUploadDeliverability({
      priceRows: [{ target_date: '2026-07-04', day_of_week: null, net_price: 200000, adult_selling_price: 200000, child_price: null, note: null }],
      priceDates: [{ date: '2026-07-04', price: 200000, confirmed: false }],
      destination: 'Fukuoka',
      destinationCode: 'FUK',
      internalCode: 'PUS-AA-FUK-03-0001',
      itineraryDays: [{ day: 1 }, { day: 2 }, { day: 3 }],
      durationDays: 3,
      rawText: `
Sales price
Cancellation policy
Cancel 1 day before departure: 200,000원 penalty
`,
    });

    expect(result.ok).toBe(false);
    expect(result.blockers.join(' | ')).toContain('optional/surcharge/cancellation amount polluted product price');
  });

  it('blocks missing or non-contiguous itinerary days before A4/mobile rendering', () => {
    const base = {
      priceRows: [{ target_date: '2026-07-04', day_of_week: null, net_price: 999000, adult_selling_price: 999000, child_price: null, note: null }],
      priceDates: [{ date: '2026-07-04', price: 999000, confirmed: false }],
      destination: 'Clark',
      destinationCode: 'CRK',
      internalCode: 'PUS-AA-CRK-05-0001',
      durationDays: 5,
    };

    const empty = evaluateUploadDeliverability({
      ...base,
      itineraryDays: [],
    });
    expect(empty.ok).toBe(false);
    expect(empty.blockers.join(' | ')).toContain('itinerary missing');

    const missingDayNumber = evaluateUploadDeliverability({
      ...base,
      itineraryDays: [{ day: 1 }, {}],
    });
    expect(missingDayNumber.ok).toBe(false);
    expect(missingDayNumber.blockers.join(' | ')).toContain('itinerary day number missing');

    const gap = evaluateUploadDeliverability({
      ...base,
      itineraryDays: [{ day: 1 }, { day: 3 }],
    });
    expect(gap.ok).toBe(false);
    expect(gap.blockers.join(' | ')).toContain('itinerary day sequence error');
  });

  it('blocks pasted table fragments that leaked into schedule activities', () => {
    const result = evaluateUploadDeliverability({
      priceRows: [{ target_date: '2026-06-18', day_of_week: null, net_price: 1219000, adult_selling_price: 1219000, child_price: null, note: null }],
      priceDates: [{ date: '2026-06-18', price: 1219000, confirmed: false }],
      destination: '죠시',
      destinationCode: 'TYO',
      internalCode: 'PUS-ETC-TYO-04-0009',
      durationDays: 4,
      itineraryDays: [
        {
          day: 1,
          schedule: [
            { activity: 'BX112', type: 'normal' },
            { activity: '07:50', type: 'normal' },
            { activity: '전용차량', type: 'normal' },
            { activity: 'HOTEL: 호텔 죠시 또는 동급', type: 'normal' },
            { activity: '중:클럽식', type: 'normal' },
          ],
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.blockers.join('\n')).toContain('itinerary schedule quality error');
    expect(result.blockers.join('\n')).toContain('BX112');
    expect(result.blockers.join('\n')).toContain('HOTEL: 호텔 죠시');
  });

  it('does not block valid package prices just because optional charges exist elsewhere', () => {
    const result = evaluateUploadDeliverability({
      priceRows: [{ target_date: '2026-07-04', day_of_week: null, net_price: 999000, adult_selling_price: 999000, child_price: null, note: null }],
      priceDates: [{ date: '2026-07-04', price: 999000, confirmed: false }],
      destination: 'Clark',
      destinationCode: 'CRK',
      internalCode: 'PUS-AA-CRK-05-0001',
      itineraryDays: [{ day: 1 }, { day: 2 }, { day: 3 }, { day: 4 }, { day: 5 }],
      durationDays: 5,
      rawText: `
Package table
6/20
999,-

Excluded: personal expenses, weekend golf surcharge 15,000원
`,
    });

    expect(result.ok).toBe(true);
  });

  it('blocks product_prices and price_dates mismatches before saving A4/mobile inputs', () => {
    const result = evaluateUploadDeliverability({
      priceRows: [{ target_date: '2026-07-04', day_of_week: null, net_price: 999000, adult_selling_price: 999000, child_price: null, note: null }],
      priceDates: [{ date: '2026-07-04', price: 1159000, confirmed: false }],
      destination: 'Clark',
      destinationCode: 'CRK',
      internalCode: 'PUS-AA-CRK-05-0001',
      itineraryDays: [{ day: 1 }, { day: 2 }, { day: 3 }, { day: 4 }, { day: 5 }],
      durationDays: 5,
    });

    expect(result.ok).toBe(false);
    expect(result.blockers.join(' | ')).toContain('price storage mismatch');
  });

  it('blocks calendar summaries that omit product price dates', () => {
    const result = evaluateUploadDeliverability({
      priceRows: [
        { target_date: '2026-07-04', day_of_week: null, net_price: 999000, adult_selling_price: 999000, child_price: null, note: null },
        { target_date: '2026-07-05', day_of_week: null, net_price: 1099000, adult_selling_price: 1099000, child_price: null, note: null },
      ],
      priceDates: [{ date: '2026-07-04', price: 999000, confirmed: false }],
      destination: 'Clark',
      destinationCode: 'CRK',
      internalCode: 'PUS-AA-CRK-05-0001',
      itineraryDays: [{ day: 1 }, { day: 2 }, { day: 3 }, { day: 4 }, { day: 5 }],
      durationDays: 5,
    });

    expect(result.ok).toBe(false);
    expect(result.blockers.join(' | ')).toContain('price_dates missing date 2026-07-05');
  });

  it('blocks positive product price rows that still have no customer selling price', () => {
    const result = evaluateUploadDeliverability({
      priceRows: [{ target_date: '2026-07-04', day_of_week: null, net_price: 999000, adult_selling_price: null, child_price: null, note: null }],
      priceDates: [{ date: '2026-07-04', price: 999000, confirmed: false }],
      destination: 'Clark',
      destinationCode: 'CRK',
      internalCode: 'PUS-AA-CRK-05-0001',
      itineraryDays: [{ day: 1 }, { day: 2 }, { day: 3 }, { day: 4 }, { day: 5 }],
      durationDays: 5,
    });

    expect(result.ok).toBe(false);
    expect(result.blockers.join(' | ')).toContain('customer selling price missing');
  });
});
