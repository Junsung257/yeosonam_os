import { describe, expect, it } from 'vitest';
import { buildEntityReviewItem, buildV3EntitySummary } from './entity-normalizer';

const evidence = {
  quote: '',
  char_start: 0,
  char_end: 0,
  line_start: 1,
  line_end: 1,
};

function attractionEvent(rawText: string) {
  return {
    type: 'attraction',
    time: null,
    raw_text: rawText,
    canonical_id: null,
    canonical_type: null,
    match_status: 'unmatched',
    evidence,
  } as const;
}

describe('V3 entity meal label normalization', () => {
  it('does not block standalone meal labels as unresolved attractions', () => {
    for (const label of [
      '\uC804\uD1B5\uC2DD',
      'BBQ',
      '(\uD558\uC774\uB514\uB77C\uC624)',
      '+\uC0DD\uC218',
      '\uBC18\uC138\uC624',
      '\uBE44\uC5B4\uD50C\uB77C\uC790',
      '(\uBDD4\uD398\uC2DD)',
      '(\uB78D\uC2A4\uD130\u00BD)',
      '\uC138\uD2B8',
    ]) {
      const item = buildEntityReviewItem({
        event: attractionEvent(label),
        dayNumber: 2,
        destination: 'Da Nang',
      });

      expect(item.category).toBe('meal');
      expect(item.blocks_publish).toBe(false);
      expect(item.suggested_action).toBe('auto_resolve_existing');
    }
  });

  it('keeps standalone meal labels out of the attraction unresolved summary', () => {
    const summary = buildV3EntitySummary({
      ledger: {
        variants: [
          {
            days: [
              {
                day: 2,
                route: [],
                events: [attractionEvent('\uC804\uD1B5\uC2DD'), attractionEvent('BBQ')],
                meals: { breakfast: {}, lunch: {}, dinner: {} },
                hotel: {},
              },
            ],
            options: [],
            shopping: [],
            structured_facts: [],
            standard_notices: [],
          },
        ],
      } as any,
      destination: 'Da Nang',
    });

    expect(summary.attraction_unresolved_count).toBe(0);
    expect(summary.review_items.some(item => item.category === 'attraction')).toBe(false);
  });

  it('keeps flight schedule labels out of unresolved attractions', () => {
    for (const label of ['(\uC815\uADDC)', '(\uC99D\uD3B8)']) {
      const item = buildEntityReviewItem({
        event: attractionEvent(label),
        dayNumber: 1,
        destination: 'Da Nang',
      });

      expect(item.category).toBe('notice');
      expect(item.blocks_publish).toBe(false);
      expect(item.suggested_action).toBe('auto_resolve_existing');
    }
  });

  it('treats known shopping-stop count disclosures as customer-safe shopping facts', () => {
    const summary = buildV3EntitySummary({
      ledger: {
        variants: [
          {
            days: [],
            options: [],
            shopping: [{
              value: '\uB178\uB2C8&\uCE68\uD5A5/ \uC7A1\uD654 / \uCEE4\uD53C 3\uACF3 \uBC29\uBB38',
              evidence,
            }],
            structured_facts: [],
            standard_notices: [],
          },
        ],
      } as any,
      destination: 'Da Nang',
    });

    expect(summary.shopping_review_needed_count).toBe(0);
    expect(summary.review_items.some(item => item.category === 'shopping')).toBe(false);
  });
});
