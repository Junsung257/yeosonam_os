import { describe, expect, it } from 'vitest';
import { repairBlogFinalCustomerSurface } from './blog-final-customer-surface';

describe('repairBlogFinalCustomerSurface structure cleanup', () => {
  it('removes duplicate heading sections before public customer quality checks', () => {
    const result = repairBlogFinalCustomerSurface({
      destination: 'Cebu',
      primaryKeyword: 'Cebu family itinerary',
      markdown: [
        '# Cebu family itinerary',
        '',
        'Cebu family trips are easier when airport movement, hotel location, and child rest time are checked first.',
        '',
        '## Day 1',
        '',
        'Arrive, move to the hotel, and keep dinner simple.',
        '',
        '## Day 2',
        '',
        'Use the first full day for a short sea activity.',
        '',
        '## Day 2',
        '',
        'This repeated section makes the article look automatically assembled.',
        '',
        '## Day 3',
        '',
        'Leave enough recovery time before the return flight.',
      ].join('\n'),
    });

    expect(result.changes).toContain('remove_duplicate_heading_sections');
    expect((result.markdown.match(/^## Day 2/gm) || []).length).toBe(1);
    expect(result.markdown).not.toContain('automatically assembled');
  });

  it('prunes low-value overflow sections when an article has too many H2 blocks', () => {
    const result = repairBlogFinalCustomerSurface({
      destination: 'Bali',
      primaryKeyword: 'Bali travel prep',
      markdown: [
        '# Bali travel prep',
        '',
        'Bali travel prep should start with weather, movement, budget, and documents that can change before departure.',
        '',
        ...Array.from({ length: 8 }, (_, index) => [
          `## Decision section ${index + 1}`,
          '',
          'This section helps the customer decide what to check next.',
          '',
        ].join('\n')),
        '## FAQ',
        '',
        'Q. When should I check this?',
        '',
        '## Recommended posts',
        '',
        '- Read another generic post',
      ].join('\n'),
    });

    expect(result.changes).toContain('prune_low_value_overflow_sections');
    expect(result.markdown).not.toContain('## FAQ');
    expect(result.markdown).not.toContain('## Recommended posts');
  });

  it('keeps official source sections because evidence links are required for trust', () => {
    const result = repairBlogFinalCustomerSurface({
      destination: 'Bali',
      primaryKeyword: 'Bali travel prep',
      markdown: [
        '# Bali travel prep',
        '',
        'Bali travel prep should start with weather, movement, budget, and documents that can change before departure.',
        '',
        ...Array.from({ length: 8 }, (_, index) => [
          `## Decision section ${index + 1}`,
          '',
          'This section helps the customer decide what to check next.',
          '',
        ].join('\n')),
        '## Official source links',
        '',
        '- [MOFA travel safety](https://www.0404.go.kr/)',
      ].join('\n'),
    });

    expect(result.markdown).toContain('## Official source links');
    expect(result.markdown).toContain('https://www.0404.go.kr/');
  });
});
