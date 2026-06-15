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

  it('blocks source-backed round-trip flight times when saved flight segments are incomplete', () => {
    const result = evaluateUploadDeliverability({
      priceRows: [{ target_date: '2026-07-16', day_of_week: null, net_price: 1429000, adult_selling_price: 1429000, child_price: null, note: null }],
      priceDates: [{ date: '2026-07-16', price: 1429000, confirmed: false }],
      destination: 'Yanji',
      destinationCode: 'YNJ',
      internalCode: 'PUS-AA-YNJ-04-0001',
      durationDays: 4,
      itineraryDays: [{ day: 1 }, { day: 2 }, { day: 3 }, { day: 4 }],
      itineraryData: {
        flight_segments: [
          { leg: 'outbound', flight_no: 'BX337', dep_time: null, arr_time: null },
          { leg: 'inbound', flight_no: 'BX338', dep_time: null, arr_time: null },
        ],
      },
      rawText: [
        'BX337',
        '06:30',
        '09:40',
        '11:30',
        'BX338',
        '12:30',
        '16:25',
      ].join('\n'),
    });

    expect(result.ok).toBe(false);
    expect(result.blockers.join('\n')).toContain('flight time source mismatch');
  });

  it('accepts source-backed round-trip flight times when outbound and inbound segments are complete', () => {
    const result = evaluateUploadDeliverability({
      priceRows: [{ target_date: '2026-07-16', day_of_week: null, net_price: 1429000, adult_selling_price: 1429000, child_price: null, note: null }],
      priceDates: [{ date: '2026-07-16', price: 1429000, confirmed: false }],
      destination: 'Yanji',
      destinationCode: 'YNJ',
      internalCode: 'PUS-AA-YNJ-04-0001',
      durationDays: 4,
      itineraryDays: [{ day: 1 }, { day: 2 }, { day: 3 }, { day: 4 }],
      itineraryData: {
        flight_segments: [
          { leg: 'outbound', flight_no: 'BX337', dep_time: '09:40', arr_time: '11:30' },
          { leg: 'inbound', flight_no: 'BX338', dep_time: '12:30', arr_time: '16:25' },
        ],
      },
      rawText: [
        'BX337',
        '06:30',
        '09:40',
        '11:30',
        'BX338',
        '12:30',
        '16:25',
      ].join('\n'),
    });

    expect(result.ok).toBe(true);
  });

  it('accepts catalog time-column flight departure when nearby source line has airport departure evidence', () => {
    const result = evaluateUploadDeliverability({
      priceRows: [{ target_date: '2026-07-13', day_of_week: null, net_price: 1239000, adult_selling_price: 1239000, child_price: null, note: null }],
      priceDates: [{ date: '2026-07-13', price: 1239000, confirmed: false }],
      destination: '나트랑',
      destinationCode: 'CXR',
      internalCode: 'PUS-ETC-CXR-05-0001',
      durationDays: 5,
      itineraryDays: [{ day: 1 }, { day: 2 }, { day: 3 }, { day: 4 }, { day: 5 }],
      itineraryData: {
        flight_segments: [
          { leg: 'outbound', flight_no: 'BX781', dep_time: '19:20', arr_time: '22:20' },
          { leg: 'inbound', flight_no: 'BX782', dep_time: '23:20', arr_time: '06:20' },
        ],
      },
      rawText: [
        'BX781',
        '19:20',
        '22:20',
        '출발2시간전 김해공항 국제선 2층에서 미팅 후 수속',
        '김해 국제공항 출발',
        '나트랑 깜란 국제공항 도착',
        'BX782',
        '22:00',
        '23:20',
        '나트랑 깜란 국제공항 출발',
        '06:20',
        '김해 국제공항 도착',
      ].join('\n'),
    });

    expect(result.ok).toBe(true);
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

  it('blocks malformed price_dates before a price string can become a travel date', () => {
    const result = evaluateUploadDeliverability({
      priceRows: [{ target_date: '2026-07-04', day_of_week: null, net_price: 999000, adult_selling_price: 999000, child_price: null, note: null }],
      priceDates: [{ date: '1,299,000원', price: 999000, confirmed: false }],
      destination: 'Fukuoka',
      destinationCode: 'FUK',
      internalCode: 'PUS-AA-FUK-03-0001',
      itineraryDays: [{ day: 1 }, { day: 2 }, { day: 3 }],
      durationDays: 3,
    });

    expect(result.ok).toBe(false);
    expect(result.blockers.join(' | ')).toContain('price shape error: price_dates invalid date 1,299,000원');
  });

  it('blocks duplicate price_dates and invalid package price ranges', () => {
    const duplicate = evaluateUploadDeliverability({
      priceRows: [{ target_date: '2026-07-04', day_of_week: null, net_price: 999000, adult_selling_price: 999000, child_price: null, note: null }],
      priceDates: [
        { date: '2026-07-04', price: 999000, confirmed: false },
        { date: '2026-07-04', price: 999000, confirmed: false },
      ],
      destination: 'Fukuoka',
      destinationCode: 'FUK',
      internalCode: 'PUS-AA-FUK-03-0001',
      itineraryDays: [{ day: 1 }, { day: 2 }, { day: 3 }],
      durationDays: 3,
    });

    expect(duplicate.ok).toBe(false);
    expect(duplicate.blockers.join(' | ')).toContain('price_dates duplicate date 2026-07-04');

    const invalidPrice = evaluateUploadDeliverability({
      priceRows: [{ target_date: '2026-07-04', day_of_week: null, net_price: 5000, adult_selling_price: 5000, child_price: null, note: null }],
      priceDates: [{ date: '2026-07-04', price: 5000, confirmed: false }],
      destination: 'Fukuoka',
      destinationCode: 'FUK',
      internalCode: 'PUS-AA-FUK-03-0001',
      itineraryDays: [{ day: 1 }, { day: 2 }, { day: 3 }],
      durationDays: 3,
    });

    expect(invalidPrice.ok).toBe(false);
    expect(invalidPrice.blockers.join(' | ')).toContain('price_dates invalid price 2026-07-04: 5000');
  });

  it('blocks customer selling prices below net price', () => {
    const result = evaluateUploadDeliverability({
      priceRows: [{ target_date: '2026-07-04', day_of_week: null, net_price: 999000, adult_selling_price: 899000, child_price: null, note: null }],
      priceDates: [{ date: '2026-07-04', price: 999000, confirmed: false }],
      destination: 'Fukuoka',
      destinationCode: 'FUK',
      internalCode: 'PUS-AA-FUK-03-0001',
      itineraryDays: [{ day: 1 }, { day: 2 }, { day: 3 }],
      durationDays: 3,
    });

    expect(result.ok).toBe(false);
    expect(result.blockers.join(' | ')).toContain('adult_selling_price below net_price');
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
