import { describe, expect, it } from 'vitest';
import {
  repairBlogEditorialQuality,
  repairBlogStructureQuality,
  repairKeywordDensityToTarget,
} from './blog-editorial-repair';
import { checkMarkdownTableIntegrity } from './blog-quality-gate';

describe('blog editorial repair', () => {
  it('repairs loose markdown tables with blank lines and missing separators', () => {
    const result = repairBlogStructureQuality({
      title: 'Nha Trang weather',
      category: 'weather',
      contentType: 'guide',
      blogHtml: [
        '# Nha Trang weather',
        '',
        '## Monthly weather',
        '',
        '| Month | Season | Rain |',
        '',
        '| January | Dry | Low |',
        '',
        '| February | Dry | Low |',
        '',
        '| March | Dry | Medium |',
      ].join('\n'),
    });

    expect(result.changed).toBe(true);
    expect(result.changes).toContain('repaired_loose_markdown_tables');
    expect(result.blogHtml).toContain('| --- | --- | --- |');
    expect(result.blogHtml).not.toContain('| Month | Season | Rain |\n\n| January | Dry | Low |');
  });

  it('converts underfilled markdown tables to scannable lists', () => {
    const result = repairBlogStructureQuality({
      title: 'Bali family budget',
      category: 'travel_tips',
      contentType: 'guide',
      primaryKeyword: 'Bali family budget',
      blogHtml: [
        '# Bali family budget',
        '',
        '| Item | Note |',
        '| --- | --- |',
        '| Taxi | Confirm airport pickup cost before arrival |',
      ].join('\n'),
    });

    expect(result.changed).toBe(true);
    expect(result.changes).toContain('repaired_loose_markdown_tables');
    expect(result.blogHtml).not.toContain('| Item | Note |');
    expect(result.blogHtml).toContain('- Item: Taxi / Note: Confirm airport pickup cost before arrival');
  });

  it('repairs informational sales tone and missing weather table', () => {
    const source = `# 장가계 월별 날씨와 옷차림 가이드

장가계 날씨는 월별로 체감 차이가 커서 옷차림과 우기 준비를 함께 보셔야 합니다.

## 장가계 날씨 핵심

이 상품을 고른 이유는 여행 정보를 확인하는 데 도움이 되기 때문입니다. 우기에는 비가 올 수 있고 건기에는 걷기 좋은 날도 있습니다.
`;

    const result = repairBlogEditorialQuality({
      title: '장가계 월별 날씨와 옷차림 가이드',
      category: 'weather',
      contentType: 'guide',
      blogHtml: source,
    });

    expect(result.changed).toBe(true);
    expect(result.changes).toContain('sanitized_info_sales_tone');
    expect(result.changes).toContain('added_weather_check_table');
    expect(result.blogHtml).toContain('월별 날씨 체크표');
    expect(result.blogHtml).not.toContain('이 상품');
    expect(result.after.score).toBeGreaterThan(result.before.score);
  });

  it('adds official sources for high-change information posts', () => {
    const result = repairBlogEditorialQuality({
      title: '베트남 무비자 입국 규정 총정리',
      category: 'visa',
      contentType: 'guide',
      blogHtml: `# 베트남 무비자 입국 규정 총정리

## 체류 기간

베트남 입국 규정은 출발 전 확인해야 합니다.

## 준비 서류

- 여권
- 항공권
- 숙소 정보
`,
    });

    expect(result.changes).toContain('added_official_reference_links');
    expect(result.blogHtml).toContain('외교부 해외안전여행');
  });

  it('moves early hard CTA blocks to the bottom for informational posts', () => {
    const source = [
      '# 몽골 가족여행 2026 실제 경비표',
      '',
      '몽골 가족여행 비용은 항공, 숙소, 차량 이동, 식비를 따로 나눠 봐야 판단이 쉽습니다. 성인과 아이 동행 여부에 따라 하루 예산과 이동 피로가 달라집니다.',
      '',
      '[관련 패키지 보기](/packages?destination=%EB%AA%BD%EA%B3%A8&utm_source=naver_blog)',
      '',
      '## 비용 빠른 판단표',
      '',
      '| 항목 | 확인 기준 | 주의할 점 |',
      '| --- | --- | --- |',
      '| 항공 | 출발 도시와 시간대 | 성수기에는 총액 차이가 큽니다. |',
      '| 숙소 | 위치와 조식 포함 여부 | 가족 여행은 이동 시간이 중요합니다. |',
      '| 차량 | 전용차와 합승 여부 | 아이 동반이면 대기 시간을 줄입니다. |',
      '',
      '## 가족 구성별 체크리스트',
      '',
      '- 아이 여권 유효기간을 확인합니다.',
      '- 차량 이동 시간을 2시간 단위로 나눕니다.',
      '- 방한복과 방수 신발을 따로 챙깁니다.',
      '- 현지 식비와 간식비를 분리합니다.',
      '- 비상 연락처를 저장합니다.',
      '',
      '## 가격 변동 리스크',
      '',
      '항공 좌석, 환율, 차량 배정에 따라 실제 총액은 달라질 수 있습니다.',
      '',
      '## FAQ',
      '',
      'Q. 가족 여행 예산은 언제 다시 확인해야 하나요?',
      '',
      'A. 출발 2주 전과 결제 직전에 다시 확인하는 편이 안전합니다.',
    ].join('\n');

    const result = repairBlogStructureQuality({
      title: '몽골 가족여행 2026 실제 경비표',
      category: 'cost',
      contentType: 'guide',
      primaryKeyword: '몽골 가족여행 경비',
      blogHtml: source,
    });

    expect(result.changed).toBe(true);
    expect(result.changes).toContain('moved_early_info_cta_to_bottom');
    expect(result.blogHtml.indexOf('[관련 패키지 보기]')).toBeGreaterThan(result.blogHtml.indexOf('## 여행 상품과 함께 확인하기'));
    expect(result.after.issues.some((issue) => issue.code === 'early_strong_cta')).toBe(false);
  });

  it('softens early hard CTA sentences without dropping informational context', () => {
    const source = [
      '# 몽골 가족여행 2026 실제 경비표',
      '',
      '예약하기 전에 상담 신청을 바로 남기고 출발일, 인원, 숙소 위치를 먼저 확인하세요.',
      '',
      '몽골 가족여행 비용은 항공, 숙소, 차량 이동, 식비를 따로 나눠 봐야 판단이 쉽습니다. 성인과 아이 동행 여부에 따라 하루 예산과 이동 피로가 달라집니다.',
      '',
      '## 비용 빠른 판단표',
      '',
      '| 항목 | 확인 기준 | 주의할 점 |',
      '| --- | --- | --- |',
      '| 항공 | 출발 도시와 시간대 | 성수기에는 총액 차이가 큽니다. |',
      '| 숙소 | 위치와 조식 포함 여부 | 가족 여행은 이동 시간이 중요합니다. |',
      '| 차량 | 전용차와 합승 여부 | 아이 동반이면 대기 시간을 줄입니다. |',
    ].join('\n');

    const result = repairBlogEditorialQuality({
      title: '몽골 가족여행 2026 실제 경비표',
      category: 'cost',
      contentType: 'guide',
      primaryKeyword: '몽골 가족여행 경비',
      blogHtml: source,
    });

    expect(result.changed).toBe(true);
    expect(result.changes).toContain('moved_early_info_cta_to_bottom');
    expect(result.blogHtml).toContain('출발일, 인원, 숙소 위치를 먼저 확인하세요.');
    expect(result.blogHtml).not.toContain('예약하기');
    expect(result.blogHtml).not.toContain('상담 신청');
    expect(result.after.issues.some((issue) => issue.code === 'early_strong_cta')).toBe(false);
  });

  it('softens unsupported Yeosonam data claims before intent gates', () => {
    const source = [
      '# 오사카 여행 준비물',
      '',
      '오사카 여행 준비물은 이동 동선, 결제 수단, 날씨 변수를 먼저 나눠 보면 판단이 쉽습니다. 출발 전에는 여권과 현지 결제 수단을 다시 확인해야 합니다.',
      '',
      '## 판단 기준',
      '',
      '여소남 데이터로 보면 이 준비물이 가장 좋습니다. 여행자는 같은 기준을 그대로 따르면 됩니다.',
    ].join('\n');

    const result = repairBlogEditorialQuality({
      title: '오사카 여행 준비물',
      category: 'preparation',
      contentType: 'guide',
      primaryKeyword: '오사카 여행 준비물',
      blogHtml: source,
    });

    expect(result.changed).toBe(true);
    expect(result.changes).toContain('softened_unsupported_yeosonam_data_claims');
    expect(result.blogHtml).not.toContain('여소남 데이터');
    expect(result.after.issues.some((issue) => issue.code === 'unsupported_yeosonam_data')).toBe(false);
  });

  it('repairs raw directive leaks and collapsed checklist items', () => {
    const source = [
      '# 여행 준비 체크',
      '',
      '::: tip',
      '출발 전에 확인하세요.',
      ':::',
      '',
      '## 준비 체크리스트',
      '',
      '- 1. 여권 유효기간을 확인합니다. 2. 항공권 영문 이름을 확인합니다. 3. 현지 결제 카드와 소액 현금을 나눠 챙깁니다. 4. 비상 연락처를 가족에게 공유합니다.',
    ].join('\n');

    const result = repairBlogStructureQuality({
      title: '여행 준비 체크',
      category: 'preparation',
      contentType: 'guide',
      blogHtml: source,
    });

    expect(result.changed).toBe(true);
    expect(result.changes).toEqual(
      expect.arrayContaining(['removed_raw_directive_leaks', 'split_collapsed_checklist_items']),
    );
    expect(result.blogHtml).not.toContain(':::');
    expect(result.blogHtml).toContain('- 여권 유효기간을 확인합니다.');
    expect(result.blogHtml).toContain('- 항공권 영문 이름을 확인합니다.');
  });

  it('removes rendered artifacts, softens clickbait wording, and adds a comparison table', () => {
    const source = [
      '# 해외여행 비상약 완벽 가이드 TOP 5',
      '',
      '$1 출발 전에 확인해야 할 항목입니다.',
      '',
      '## 준비 체크리스트',
      '',
      '- 해열제와 소화제를 분리합니다.',
      '- 처방약은 영문 처방전을 같이 챙깁니다.',
      '- 액체류는 기내 반입 기준을 확인합니다.',
      '- 여행자보험 긴급 연락처를 저장합니다.',
    ].join('\n');

    const result = repairBlogStructureQuality({
      title: '해외여행 비상약 체크리스트',
      category: 'preparation',
      contentType: 'guide',
      primaryKeyword: '해외여행 비상약',
      blogHtml: source,
    });

    expect(result.changed).toBe(true);
    expect(result.changes).toEqual(
      expect.arrayContaining([
        'removed_render_artifacts',
        'softened_promotional_info_tone',
        'added_minimum_reading_structure',
      ]),
    );
    expect(result.blogHtml).not.toContain('$1');
    expect(result.blogHtml).not.toContain('완벽 가이드');
    expect(result.blogHtml).not.toContain('TOP 5');
    expect(result.blogHtml).toContain('판단 기준 빠른 비교');
  });

  it('adds a publish checklist and splits overlong headings before publish gates', () => {
    const source = [
      '# Cebu budget checklist',
      '',
      '## [Cebu travel budget] This heading accidentally contains a long paragraph about comparing flights, hotels, transfer time, payment methods, and cancellation rules before booking',
      '',
      'Travelers should compare each cost before departure.',
      '',
      '## FAQ',
      '',
      'Q. When should I check prices?',
      '',
      'A. Check again before booking.',
    ].join('\n');

    const result = repairBlogStructureQuality({
      title: 'Cebu budget checklist',
      slug: 'cebu-budget-checklist',
      category: 'travel_tips',
      contentType: 'guide',
      primaryKeyword: 'Cebu budget',
      blogHtml: source,
    });

    expect(result.changed).toBe(true);
    expect(result.changes).toEqual(
      expect.arrayContaining(['split_overlong_headings', 'added_publish_checklist']),
    );
    expect(result.blogHtml).toContain('## Cebu travel budget');
    expect(result.blogHtml).toContain('\uC5EC\uD589 \uCCB4\uD06C\uB9AC\uC2A4\uD2B8');
    expect(result.blogHtml).toContain('- Cebu budget');
  });

  it('moves prose-only markdown table rows outside the table', () => {
    const source = [
      '# Europe summer travel',
      '',
      '| City | Weather | Note |',
      '| --- | --- | --- |',
      '| Oslo | mild | jacket |',
      '| Check point: July northern Europe can stay bright late into the night. Confirm blackout curtains and pack a sleep mask before departure. | | |',
      '| Zurich | cool | layers |',
    ].join('\n');

    const result = repairBlogStructureQuality({
      title: 'Europe summer travel checklist',
      slug: 'europe-summer-travel',
      category: 'travel_tips',
      contentType: 'guide',
      primaryKeyword: 'Europe summer travel',
      blogHtml: source,
    });

    expect(result.changed).toBe(true);
    expect(result.changes).toContain('split_table_prose_rows');
    expect(result.blogHtml).not.toContain('| Check point: July northern Europe');
    expect(result.blogHtml).toContain('Check point: July northern Europe can stay bright late into the night.');
    expect(result.blogHtml).toContain('- City: Zurich / Weather: cool / Note: layers');
  });

  it('adds markdown table boundaries before following prose', () => {
    const source = [
      '# Europe summer travel',
      '',
      '| City | Weather |',
      '| --- | --- |',
      '| Oslo | mild |',
      'Check point: July northern Europe can stay bright late into the night.',
    ].join('\n');

    const result = repairBlogStructureQuality({
      title: 'Europe summer travel checklist',
      slug: 'europe-summer-travel',
      category: 'travel_tips',
      contentType: 'guide',
      primaryKeyword: 'Europe summer travel',
      blogHtml: source,
    });

    expect(result.changed).toBe(true);
    expect(result.changes).toContain('added_markdown_table_boundaries');
    expect(result.blogHtml).toContain('- City: Oslo / Weather: mild\n\nCheck point: July northern Europe');
  });

  it('force-repairs mismatched markdown table rows that would fail the publish gate', () => {
    const source = [
      '# Mongolia hotel area budget',
      '',
      '| Area | Fit | Note |',
      '| --- | --- | --- |',
      '| Ulaanbaatar center | first timers | easiest transfer |',
      '| Terelj | family |',
      '| Airport side | late arrival | fewer dinner options |',
    ].join('\n');

    const result = repairBlogStructureQuality({
      title: 'Mongolia hotel area budget',
      slug: 'mongolia-hotel-area-budget',
      category: 'cost',
      contentType: 'guide',
      primaryKeyword: 'Mongolia hotel area',
      blogHtml: source,
    });

    expect(result.changed).toBe(true);
    expect(result.changes).toContain('force_repaired_broken_markdown_tables');
    expect(result.blogHtml).not.toContain('| Area | Fit | Note |');
    expect(result.blogHtml).toContain('- Area: Ulaanbaatar center / Fit: first timers / Note: easiest transfer');
    expect(checkMarkdownTableIntegrity(result.blogHtml).passed).toBe(true);
  });

  it('adds missing separators to otherwise valid 3-row tables before gate checks', () => {
    const source = [
      '# Mongolia food budget',
      '',
      '| Item | Budget | Check |',
      '| Breakfast | 10000 KRW | hotel inclusion |',
      '| Lunch | 15000 KRW | local restaurant |',
      '| Dinner | 25000 KRW | tourist area premium |',
    ].join('\n');

    const result = repairBlogStructureQuality({
      title: 'Mongolia food budget',
      slug: 'mongolia-food-budget',
      category: 'cost',
      contentType: 'guide',
      primaryKeyword: 'Mongolia food budget',
      blogHtml: source,
    });

    expect(result.changed).toBe(true);
    expect(result.blogHtml).toContain('| --- | --- | --- |');
    expect(checkMarkdownTableIntegrity(result.blogHtml).passed).toBe(true);
  });

  it('caps excessive h2 headings by demoting later support sections', () => {
    const source = [
      '# City planning guide',
      '',
      ...Array.from({ length: 12 }, (_, index) => [
        `## Section ${index + 1}`,
        '',
        `Planning note ${index + 1} with enough detail for the article body.`,
        '',
      ]).flat(),
    ].join('\n');

    const result = repairBlogStructureQuality({
      title: 'City planning guide',
      slug: 'city-planning-guide',
      category: 'travel_tips',
      contentType: 'guide',
      primaryKeyword: 'City planning',
      blogHtml: source,
    });

    expect(result.changed).toBe(true);
    expect(result.changes).toContain('capped_h2_headings');
    expect(result.blogHtml.match(/^##\s+\S/gm) || []).toHaveLength(9);
    expect(result.blogHtml).toContain('### Section 10');
  });

  it('repairs blank headings before numbered subsections', () => {
    const source = [
      '# Europe travel guide',
      '',
      '##',
      '',
      '1. Weather and clothes',
      '',
      'Pack layers before departure.',
    ].join('\n');

    const result = repairBlogStructureQuality({
      title: 'Europe travel guide',
      slug: 'europe-travel-guide',
      category: 'travel_tips',
      contentType: 'guide',
      primaryKeyword: 'Europe travel',
      blogHtml: source,
    });

    expect(result.changed).toBe(true);
    expect(result.changes).toContain('repaired_blank_headings');
    expect(result.blogHtml).not.toContain('\n##\n');
    expect(result.blogHtml).toContain('### 1. Weather and clothes');
  });

  it('reduces excessive primary keyword density deterministically', () => {
    const source = Array.from(
      { length: 18 },
      () => '해외여행 비상약은 해외여행 비상약 준비에서 자주 반복되는 주제입니다.',
    ).join('\n\n');

    const result = repairKeywordDensityToTarget(source, '해외여행 비상약', 'info');

    expect(result.changed).toBe(true);
    expect(result.beforeCount).toBeGreaterThan(result.allowedCount);
    expect(result.afterCount).toBeLessThanOrEqual(result.allowedCount);
    expect(result.blogHtml).toContain('비상약');
  });
});
