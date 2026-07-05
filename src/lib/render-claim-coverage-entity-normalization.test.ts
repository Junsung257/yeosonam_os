import { describe, expect, it } from 'vitest';

import { evaluateRenderClaimCoverage } from './render-claim-coverage';

describe('render claim coverage source normalization', () => {
  it('accepts vertical month-header date tables such as month header plus day list', () => {
    const result = evaluateRenderClaimCoverage({
      raw_text: '7\uC6D4\n19,20,21\n3\uBC15\n839,000 -> 599,000',
      price_dates: [{ date: '2026-07-20', price: 599000, confirmed: false }],
      itinerary_data: { days: [] },
    });

    expect(result.unsupported.some(c => c.id === 'priceDates[0].date')).toBe(false);
    expect(result.unsupported.some(c => c.id === 'priceDates[0].price')).toBe(false);
  });

  it('accepts common HTML entities in source text for customer term evidence', () => {
    const result = evaluateRenderClaimCoverage({
      raw_text: '\uD3EC\uD568\uC0AC\uD56D\n &#9830;\uD638\uD154\nHOTEL : \uBC00\uB808\uB2C8\uC5C4 \uD638\uD154 OR \uC624\uB85C\uB77C\uD638\uD154 &#8211; 2\uC7781\uC2E4or3\uC7781\uC2E4 (\uC8154\uC131)',
      inclusions: ['\u2666\uD638\uD154'],
      itinerary_data: {
        days: [{
          day: 1,
          hotel: { name: '\uBC00\uB808\uB2C8\uC5C4 \uD638\uD154 OR \uC624\uB85C\uB77C\uD638\uD154 \u2013 2\uC7781\uC2E4or3\uC7781\uC2E4 (\uC8154\uC131)' },
          schedule: [],
        }],
      },
    });

    expect(result.unsupported.some(c => c.value === '\u2666\uD638\uD154')).toBe(false);
    expect(result.unsupported.some(c => c.value.includes('\uBC00\uB808\uB2C8\uC5C4 \uD638\uD154'))).toBe(false);
  });
});
