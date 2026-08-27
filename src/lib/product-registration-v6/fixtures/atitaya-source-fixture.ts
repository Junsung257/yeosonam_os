/**
 * Atitaya regression fixture distilled from the supplier HWP audit sample.
 * The original HWP remains an immutable source artifact outside customer
 * projections; this fixture keeps only the layout-preserving facts needed for
 * deterministic parser/regression checks.
 */
export const atitayaSourceFixture = {
  expectedOutcome: 'REVIEW_REQUIRED' as const,
  expectedBlockers: [
    'PRICE_FORMAT_AMBIGUOUS',
    'VARIANT_BOUNDARY_AMBIGUOUS',
    'TICKETING_DEADLINE_YEAR_UNRESOLVED',
    'MINIMUM_PARTICIPANTS_FORMAT_UNRESOLVED',
    'SUPPLIER_TERM_UNRESOLVED',
    'FUTURE_PRICE_EFFECTIVE_DATE_UNRESOLVED',
  ] as const,
  rawMarkers: ['그림입니다', 'Adobe ImageReady', 'HOTEL :', '조:', '중:', '석:', '별도문의', '85,9000'],
  canonicalPayload: {
    sections: [{
      sectionKey: 'atitaya-3n5d',
      v3: { ledger: { variants: [{
        variant_key: '3n5d',
        price_calendar: [
          { date: '2026-10-30', amount: '869,000', currency: 'KRW', source_labels: ['별도문의', '제외일자'], rule_type: 'EXACT_DATE_OVERRIDE' },
          { date: '2026-10-31', amount: '85,9000', currency: 'KRW', source_labels: ['별도문의'], rule_type: 'EXACT_DATE_OVERRIDE' },
        ],
        days: [{ day: 2, hotel: { name: '아티타야리조트' }, events: [{ raw_text: '아티타야CC 무제한라운드' }] }],
      }, {
        // The source contains a '*4박6일' block. It must not be folded into
        // the 3박5일 variant when the boundary evidence is incomplete.
        variant_key: '4n6d-unresolved',
        price_calendar: [],
        days: [{ day: 4, events: [{ raw_text: '*4박6일 아티타야CC 무제한라운드' }] }],
      }] } },
    }],
  },
};
