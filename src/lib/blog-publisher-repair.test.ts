import { describe, expect, it } from 'vitest';
import { checkHook } from './blog-quality-gate';
import { inspectBlogIntentQuality } from './blog-content-intent';
import { repairBlogEditorialQuality } from './blog-editorial-repair';
import { repairPublisherSeoSlug, strengthenPublisherIntroHook } from './blog-publisher-repair';
import { inspectBlogSlugQuality } from './blog-slug-quality';

describe('blog publisher repair helpers', () => {
  it('repairs numeric-leading weather slugs before SEO blocks publishing', () => {
    const result = repairPublisherSeoSlug({
      currentSlug: '7-australia-sydney-weather-guide',
      item: {
        topic: '7\uC6D4 \uD638\uC8FC \uC2DC\uB4DC\uB2C8 \uC5EC\uD589, \uD55C\uAD6D\uACFC \uBC18\uB300! \uACA8\uC6B8 \uB0A0\uC528\uC640 \uC990\uAE38 \uAC70\uB9AC',
        destination: '\uD638\uC8FC \uC2DC\uB4DC\uB2C8',
        category: 'weather',
      },
      primaryKeyword: '\uD638\uC8FC \uC2DC\uB4DC\uB2C8 7\uC6D4 \uB0A0\uC528',
    });

    expect(result.changed).toBe(true);
    expect(result.slug).toBe('australia-sydney-weather-july');
    expect(inspectBlogSlugQuality({
      slug: result.slug,
      primaryKeyword: '\uD638\uC8FC \uC2DC\uB4DC\uB2C8 7\uC6D4 \uB0A0\uC528',
      destination: '\uD638\uC8FC \uC2DC\uB4DC\uB2C8',
    }).passed).toBe(true);
  });

  it('repairs family recommendation slugs without exposing generated ids', () => {
    const result = repairPublisherSeoSlug({
      currentSlug: 'travel-guide-q35bf6ed0',
      item: {
        topic: '\uC5EC\uB984\uBC29\uD559 \uAC00\uC871 \uD574\uC678\uC5EC\uD589, \uC544\uC774\uC640 \uAC00\uAE30 \uC88B\uC740 \uC548\uC804\uD55C \uD734\uC591\uC9C0 \uCD94\uCC9C',
        category: 'comparison',
      },
      primaryKeyword: '\uAC00\uC871 \uD574\uC678\uC5EC\uD589 \uCD94\uCC9C',
    });

    expect(result.slug).toBe('family-summer-vacation-safe-resort-recommendation');
    expect(result.slug).not.toMatch(/q[0-9a-f]{6,10}|travel-guide/);
    expect(inspectBlogSlugQuality({
      slug: result.slug,
      primaryKeyword: '\uAC00\uC871 \uD574\uC678\uC5EC\uD589 \uCD94\uCC9C',
    }).passed).toBe(true);
  });

  it('repairs numeric family weather slugs into a publishable intent slug', () => {
    const result = repairPublisherSeoSlug({
      currentSlug: '7-family-weather-guide',
      item: {
        topic: '\uAC00\uC871 7\uC6D4 \uB0A0\uC528 \uC5EC\uD589 \uAC00\uC774\uB4DC 2026|\uC6D4\uBCC4 \uB0A0\uC528\u00B7\uC637\uCC28\uB9BC \uCCB4\uD06C\uB9AC\uC2A4\uD2B8',
        category: 'weather',
      },
      primaryKeyword: '\uAC00\uC871 7\uC6D4 \uB0A0\uC528 \uC5EC\uD589',
    });

    expect(result.changed).toBe(true);
    expect(result.slug).toBe('weather-family-checklist-july-2026');
    expect(result.slug).not.toMatch(/^\d|travel-guide|q[0-9a-f]{6,10}/);
    expect(inspectBlogSlugQuality({
      slug: result.slug,
      primaryKeyword: '\uAC00\uC871 7\uC6D4 \uB0A0\uC528 \uC5EC\uD589',
    }).passed).toBe(true);
  });

  it('replaces a weak first paragraph with a concrete hook', () => {
    const source = [
      '# \uB098\uD2B8\uB791/\uB2EC\uB78F 6\uC6D4 \uB0A0\uC528\uC640 \uC637\uCC28\uB9BC',
      '',
      '\uB098\uD2B8\uB791\uACFC \uB2EC\uB78F\uC740 \uC5EC\uD589\uC790\uC5D0\uAC8C \uB9E4\uB825\uC801\uC778 \uC120\uD0DD\uC9C0\uC785\uB2C8\uB2E4.',
      '',
      '## \uC6D4\uBCC4 \uCCB4\uD06C',
      '',
      '| \uAD6C\uBD84 | \uD655\uC778 | \uBA54\uBAA8 |',
      '| --- | --- | --- |',
      '| 6\uC6D4 | \uC6B0\uAE30 | \uBE44 \uC608\uBCF4 \uD655\uC778 |',
    ].join('\n');

    const repaired = strengthenPublisherIntroHook(source, {
      topic: '\uB098\uD2B8\uB791/\uB2EC\uB78F 6\uC6D4 \uB0A0\uC528\uC640 \uC637\uCC28\uB9BC',
      destination: '\uB098\uD2B8\uB791/\uB2EC\uB78F',
    }, '\uB098\uD2B8\uB791 \uB2EC\uB78F 6\uC6D4 \uB0A0\uC528', new Date('2026-07-03T00:00:00Z'));

    expect(checkHook(repaired).passed).toBe(true);
    expect(repaired).toContain('2026\uB144 7\uC6D4 \uAE30\uC900');
    expect(repaired.indexOf('\uB098\uD2B8\uB791\uACFC \uB2EC\uB78F\uC740')).toBe(-1);
  });

  it('adds a decision block to family recommendation info posts', () => {
    const source = [
      '# \uC5EC\uB984\uBC29\uD559 \uAC00\uC871 \uD574\uC678\uC5EC\uD589 \uCD94\uCC9C',
      '',
      '\uC544\uC774\uC640 \uAC00\uB294 \uC5EC\uB984\uBC29\uD559 \uD574\uC678\uC5EC\uD589\uC740 \uBE44\uD589 \uC2DC\uAC04\uACFC \uC548\uC804\uD55C \uC774\uB3D9 \uB3D9\uC120\uC744 \uBA3C\uC800 \uBCF4\uB294 \uAC83\uC774 \uC88B\uC2B5\uB2C8\uB2E4.',
      '',
      '## \uCD94\uCC9C \uD734\uC591\uC9C0',
      '',
      '- \uAD0C\uC740 \uBE44\uD589 \uC2DC\uAC04\uC774 \uBE44\uAD50\uC801 \uC9E7\uC2B5\uB2C8\uB2E4.',
      '- \uB2E4\uB0AD\uC740 \uC219\uC18C \uC120\uD0DD\uC9C0\uAC00 \uB113\uC2B5\uB2C8\uB2E4.',
    ].join('\n');

    const before = inspectBlogIntentQuality({
      title: '\uC5EC\uB984\uBC29\uD559 \uAC00\uC871 \uD574\uC678\uC5EC\uD589 \uCD94\uCC9C',
      slug: 'family-overseas-trip-recommendation',
      category: 'comparison',
      contentType: 'guide',
      primaryKeyword: '\uAC00\uC871 \uD574\uC678\uC5EC\uD589 \uCD94\uCC9C',
      blogHtml: source,
    });
    expect(before.issues.map((issue) => issue.code)).toContain('missing_required_block');

    const repaired = repairBlogEditorialQuality({
      title: '\uC5EC\uB984\uBC29\uD559 \uAC00\uC871 \uD574\uC678\uC5EC\uD589 \uCD94\uCC9C',
      slug: 'family-overseas-trip-recommendation',
      category: 'comparison',
      contentType: 'guide',
      primaryKeyword: '\uAC00\uC871 \uD574\uC678\uC5EC\uD589 \uCD94\uCC9C',
      blogHtml: source,
    });

    expect(repaired.changes).toContain('added_comparison_decision_block');
    expect(repaired.blogHtml).toContain('\uC0C1\uD669\uBCC4 \uC120\uD0DD \uAE30\uC900');
    expect(repaired.after.issues.map((issue) => issue.code)).not.toContain('missing_required_block');
  });
});
