import { describe, expect, it } from 'vitest';
import { normalizeOptionalTour } from './itinerary-render';
import { evaluateRenderClaimCoverage } from './render-claim-coverage';

describe('optional tour customer source coverage', () => {
  it('accepts OR source wording with a price parenthetical', () => {
    const result = evaluateRenderClaimCoverage({
      raw_text: '\uC120\uD0DD\uAD00\uAD11\n\uCC28\uBC0D\uC1FCOR\uC544\uC624\uC790\uC774\uC1FC($40/\uC778)',
      optional_tours: [{ name: '\uCC28\uBC0D\uC1FC \uB610\uB294 \uC544\uC624\uC790\uC774\uC1FC()', price: '$40/\uC778' }],
      itinerary_data: { days: [] },
    });

    expect(result.unsupported.some(claim => claim.value.includes('\uCC28\uBC0D\uC1FC'))).toBe(false);
  });

  it('removes empty parentheses from optional tour display names', () => {
    const tour = normalizeOptionalTour({
      name: '\uCC28\uBC0D\uC1FC \uB610\uB294 \uC544\uC624\uC790\uC774\uC1FC()',
      price_usd: 40,
    });

    expect(tour.name).toBe('\uCC28\uBC0D\uC1FC \uB610\uB294 \uC544\uC624\uC790\uC774\uC1FC');
    expect(tour.displayName).toBe('\uCC28\uBC0D\uC1FC \uB610\uB294 \uC544\uC624\uC790\uC774\uC1FC');
  });
});
