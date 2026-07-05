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
    for (const label of ['\uC804\uD1B5\uC2DD', 'BBQ', '(\uD558\uC774\uB514\uB77C\uC624)', '+\uC0DD\uC218']) {
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
});
