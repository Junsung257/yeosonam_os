import { describe, expect, it } from 'vitest';
import { inspectBlogCandidatePrepublishContract } from './blog-candidate-prepublish-contract';

describe('inspectBlogCandidatePrepublishContract', () => {
  it('blocks cliche month-leading topics before they become weak numeric slugs', () => {
    const result = inspectBlogCandidatePrepublishContract({
      topic: '7\uC6D4 \uD638\uC8FC \uC2DC\uB4DC\uB2C8 \uC5EC\uD589, \uD55C\uAD6D\uACFC \uBC18\uB300! \uACA8\uC6B8 \uB0A0\uC528\uC640 \uC990\uAE38 \uAC70\uB9AC \u2014 \uCD1D\uC815\uB9AC',
      destination: '\uC2DC\uB4DC\uB2C8',
    });

    expect(result.passed).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'editorial_cliche_topic',
      'risky_numeric_slug_topic',
      'weak_expected_slug',
    ]));
  });

  it('blocks machine separator topics that previously reached SEO url_slug failures', () => {
    const result = inspectBlogCandidatePrepublishContract({
      topic: '\uAC00\uC871 7\uC6D4 \uB0A0\uC528 \uC5EC\uD589 \uAC00\uC774\uB4DC 2026|\uC6D4\uBCC4 \uB0A0\uC528\u00B7\uC637\uCC28\uB9BC \uCCB4\uD06C\uB9AC\uC2A4\uD2B8',
      destination: '\uAC00\uC871',
    });

    expect(result.passed).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'machine_topic_separator',
      'weak_expected_slug',
    ]));
  });

  it('passes specific reader-facing candidates without banned editorial formulae', () => {
    const result = inspectBlogCandidatePrepublishContract({
      topic: '\uC138\uBD80 \uC1FC\uD551 \uC608\uC0B0 \uC120\uBB3C \uB9AC\uC2A4\uD2B8\uC640 \uBA74\uC138\uC810 \uCCB4\uD06C',
      destination: '\uC138\uBD80',
      meta: { expected_slug: 'cebu-shopping-budget' },
    });

    expect(result.passed).toBe(true);
  });

  it('blocks destinationless broad recommendation topics without a concrete comparison brief', () => {
    const result = inspectBlogCandidatePrepublishContract({
      topic: '\uC5EC\uB984\uBC29\uD559 \uAC00\uC871 \uD574\uC678\uC5EC\uD589, \uC544\uC774\uC640 \uAC00\uAE30 \uC88B\uC740 \uC548\uC804\uD55C \uD734\uC591\uC9C0 \uCD94\uCC9C',
      destination: null,
      meta: { intentionally_generic: true },
    });

    expect(result.passed).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('broad_generic_recommendation');
  });
});
