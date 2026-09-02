import { describe, expect, it } from 'vitest';

import { evaluateBlogPageSpeedObservationV4, parseBlogPageSpeedPayloadV4 } from './blog-pagespeed-v4';

describe('blog PageSpeed V4', () => {
  it('prefers URL-level CrUX and normalizes CLS and Lighthouse score', () => {
    const observation = parseBlogPageSpeedPayloadV4('https://www.yeosonam.com/blog/x', {
      id: 'https://www.yeosonam.com/blog/x',
      loadingExperience: { metrics: {
        INTERACTION_TO_NEXT_PAINT: { percentile: 180, category: 'FAST' },
        LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2400, category: 'FAST' },
        CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 8, category: 'FAST' },
      } },
      lighthouseResult: { categories: { performance: { score: 0.94 } } },
    });
    expect(observation).toMatchObject({ fieldSource: 'url', inpMs: 180, lcpMs: 2400, cls: 0.08, performanceScore: 94 });
    expect(evaluateBlogPageSpeedObservationV4(observation)).toEqual([]);
  });

  it('uses origin CrUX as a disclosed fallback and reports threshold failures', () => {
    const observation = parseBlogPageSpeedPayloadV4('https://www.yeosonam.com/blog/x', {
      originLoadingExperience: { metrics: {
        INTERACTION_TO_NEXT_PAINT: { percentile: 260 },
        LARGEST_CONTENTFUL_PAINT_MS: { percentile: 3100 },
        CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 18 },
      } },
      lighthouseResult: { categories: { performance: { score: 0.72 } } },
    });
    expect(observation.fieldSource).toBe('origin');
    expect(evaluateBlogPageSpeedObservationV4(observation)).toEqual(expect.arrayContaining([
      'crux_inp_above_200ms', 'crux_lcp_above_2500ms', 'crux_cls_above_0_1', 'pagespeed_performance_below_90',
    ]));
  });
});
