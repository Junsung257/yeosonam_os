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

  it('flattens low-value overflow headings when an article has too many H2 blocks', () => {
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

    expect(result.changes).toContain('flatten_low_value_subheadings');
    expect(result.markdown).not.toContain('## FAQ');
    expect(result.markdown).not.toContain('## Recommended posts');
    expect(result.markdown).toContain('**FAQ**');
    expect(result.markdown).toContain('**Recommended posts**');
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
  it('removes repeated title H2 and flattens low-value FAQ subheadings', () => {
    const result = repairBlogFinalCustomerSurface({
      destination: 'Bohol',
      title: 'Bohol hotel area budget guide',
      primaryKeyword: 'Bohol hotel area budget',
      markdown: [
        '# Bohol hotel area budget guide',
        '',
        'Bohol hotel area planning is easier when the first decision is location, movement time, and total stay budget.',
        '',
        '## Bohol hotel area budget guide',
        '',
        'This duplicated title heading makes the article look assembled.',
        '',
        '## Fast decision table',
        '',
        '| Area | Good for | Check |',
        '| --- | --- | --- |',
        '| Alona | First timers | Beach noise |',
        '| Panglao | Families | Car time |',
        '| Tagbilaran | Budget | Sea access |',
        '',
        '### 자주 묻는 질문',
        '',
        '### Q1. When should I book?',
        '',
        'A. Check room area and movement time first.',
        '',
        '### Q2. Can I change later?',
        '',
        'A. Check cancellation rules before deposit.',
      ].join('\n'),
    });

    expect(result.changes).toContain('remove_redundant_title_heading');
    expect(result.changes).toContain('flatten_low_value_subheadings');
    expect(result.markdown).not.toContain('## Bohol hotel area budget guide\n\nThis duplicated title heading');
    expect(result.markdown).toContain('**자주 묻는 질문**');
    expect(result.markdown).toContain('**Q1. When should I book?**');
    expect((result.markdown.match(/^###\s+/gm) || []).length).toBe(0);
  });

  it('removes standalone horizontal rules without breaking table separators', () => {
    const result = repairBlogFinalCustomerSurface({
      destination: 'Da Nang',
      primaryKeyword: 'Da Nang airport transfer',
      markdown: [
        '# Da Nang airport transfer',
        '',
        'Da Nang airport transfer should start with arrival time, luggage, and hotel location.',
        '',
        '---',
        '',
        '## Transfer options',
        '',
        '| Option | Check | Tip |',
        '| --- | --- | --- |',
        '| Taxi | Meter | Prepare cash |',
        '| Pickup | Reservation | Confirm name |',
        '| Bus | Route | Check time |',
        '',
        '---',
      ].join('\n'),
    });

    expect(result.changes).toContain('remove_standalone_horizontal_rules');
    expect(result.markdown).not.toMatch(/^\s*---\s*$/m);
    expect(result.markdown).toContain('| --- | --- | --- |');
  });

  it('flattens excess H2 headings instead of publishing an overbuilt article outline', () => {
    const result = repairBlogFinalCustomerSurface({
      destination: 'Bali',
      primaryKeyword: 'Bali family budget',
      markdown: [
        '# Bali family budget',
        '',
        'Bali family budget planning should start with total cost, hotel area, and moving time before picking a package.',
        '',
        ...Array.from({ length: 11 }, (_, index) => [
          `## Decision block ${index + 1}`,
          '',
          'This block has useful details, but too many H2 sections make the article look automatically assembled.',
          '',
        ].join('\n')),
        '## 공식 확인 링크',
        '',
        '- [MOFA travel safety](https://www.0404.go.kr/)',
      ].join('\n'),
    });

    expect(result.changes).toContain('flatten_excess_h2_headings');
    expect((result.markdown.match(/^##\s+/gm) || []).length).toBe(9);
    expect(result.markdown).toContain('**Decision block 9**');
    expect(result.markdown).toContain('## 공식 확인 링크');
    expect(result.markdown).toContain('automatically assembled');
  });

  it('keeps markdown tables separated from following prose and labels', () => {
    const result = repairBlogFinalCustomerSurface({
      destination: '몽골',
      primaryKeyword: '몽골 날씨와 옷차림',
      markdown: [
        '# 몽골 날씨와 옷차림',
        '',
        '몽골 날씨와 옷차림은 일교차와 이동 동선을 먼저 확인하면 준비가 쉬워집니다.',
        '',
        '**상황별 선택 기준**',
        '| 상황 | 먼저 볼 것 | 확인할 점 |',
        '| --- | --- | --- |',
        '| 아이 동반 | 이동 시간 | 식사와 침대 조건 |',
        '| 예산 중심 | 총액 | 현지 추가비 |',
        '**맞는 사람과 안 맞는 사람**',
        '숫자는 확정값이 아니라 비교 기준입니다.',
      ].join('\n'),
    });

    expect(result.changes).toContain('separate_markdown_tables');
    expect(result.markdown).toContain('\n\n| 상황 | 먼저 볼 것 | 확인할 점 |');
    expect(result.markdown).toContain('| 예산 중심 | 총액 | 현지 추가비 |\n\n**맞는 사람과 안 맞는 사람**');
  });
});
