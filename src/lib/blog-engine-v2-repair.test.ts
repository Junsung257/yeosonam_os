import { describe, expect, it } from 'vitest';
import { evaluateBlogEngineV2 } from './blog-engine-v2';
import { repairBlogEngineV2Readiness } from './blog-engine-v2-repair';

describe('blog engine v2 repair', () => {
  it('rewrites weak info openings so task completion can recover in the same publish run', () => {
    const markdown = [
      '# 몽골 7월 날씨 옷차림',
      '',
      '몽골 7월 날씨은 먼저 몽골 7월 날씨 한눈에 보기 기준으로 확인하면 됩니다.',
      '',
      '## 빠른 판단표',
      '| 항목 | 확인 기준 | 준비 |',
      '| --- | --- | --- |',
      '| 낮 | 기온 | 얇은 긴팔 |',
      '| 밤 | 일교차 | 겉옷 |',
      '| 비 | 소나기 | 방수팩 |',
      '',
      '[외교부 해외안전여행](https://www.0404.go.kr/)',
    ].join('\n');
    const before = evaluateBlogEngineV2({
      blogHtml: markdown,
      primaryKeyword: '몽골 7월 날씨',
      destination: '몽골',
      generationMeta: {
        writer: 'info_writer',
        info_guide_brief: { official_sources_required: true },
        content_brief: { search_intent: 'weather' },
      },
    });

    const repaired = repairBlogEngineV2Readiness({
      markdown,
      topic: '몽골 7월 날씨 옷차림',
      primaryKeyword: '몽골 7월 날씨',
      destination: '몽골',
      generationMeta: {
        writer: 'info_writer',
        info_guide_brief: { official_sources_required: true },
        content_brief: { search_intent: 'weather' },
      },
      evaluation: before,
    });
    const after = evaluateBlogEngineV2({
      blogHtml: repaired.markdown,
      primaryKeyword: '몽골 7월 날씨',
      destination: '몽골',
      generationMeta: repaired.generationMeta,
    });

    expect(before.metrics.task_completion).toBeLessThan(95);
    expect(repaired.changed).toBe(true);
    expect(repaired.changes).toContain('engine_v2_answer_first_intro');
    expect(repaired.markdown.slice(0, 260)).not.toMatch(/비용|가격|결제|상담/);
    expect(after.metrics.task_completion).toBeGreaterThanOrEqual(95);
  });

  it('repairs naturalness failures without only blocking publication', () => {
    const markdown = [
      '# 발리 여행 준비물',
      '',
      '발리 여행 준비물은 날씨와 이동 동선을 먼저 보면 됩니다. 발리 여행 준비물은 숙소 위치와 액티비티에 따라 달라집니다. 완벽 가이드 기준으로 확인하세요.',
      '',
      '## 체크리스트',
      '| 항목 | 확인 기준 | 준비 |',
      '| --- | --- | --- |',
      '| 날씨 | 우기 여부 | 방수팩 |',
      '| 이동 | 차량 이동 | 멀미약 |',
      '| 물놀이 | 액티비티 | 래시가드 |',
      '',
      '[외교부 해외안전여행](https://www.0404.go.kr/)',
    ].join('\n');
    const before = evaluateBlogEngineV2({
      blogHtml: markdown,
      primaryKeyword: '발리 여행 준비물',
      destination: '발리',
      generationMeta: {
        writer: 'info_writer',
        info_guide_brief: { official_sources_required: true },
        content_brief: { search_intent: 'packing' },
      },
    });

    const repaired = repairBlogEngineV2Readiness({
      markdown,
      topic: '발리 여행 준비물',
      primaryKeyword: '발리 여행 준비물',
      destination: '발리',
      generationMeta: {
        writer: 'info_writer',
        info_guide_brief: { official_sources_required: true },
        content_brief: { search_intent: 'packing' },
      },
      evaluation: before,
    });

    expect(before.metrics.naturalness).toBeLessThan(95);
    expect(repaired.changes).toContain('engine_v2_naturalness_surface');
    expect(repaired.markdown).not.toContain('완벽 가이드');
    expect(repaired.markdown).toContain('또한 숙소 위치와 액티비티에 따라 달라집니다.');
  });

  it('removes generic blog greetings that make posts feel AI-written', () => {
    const markdown = [
      '# 세부 가족여행',
      '',
      '오늘은 세부 가족여행 준비 기준을 정리합니다. 이번 글에서는 아이 동반 여행에서 먼저 볼 조건을 설명합니다. 안녕하세요! 가치 있는 여행을 소개하는 여소남입니다.',
      '',
      '## 빠른 판단표',
      '| 항목 | 확인 기준 | 준비 |',
      '| --- | --- | --- |',
      '| 숙소 | 위치 | 이동 시간 |',
      '| 물놀이 | 날씨 | 수영복 |',
      '| 이동 | 차량 | 휴식 시간 |',
      '',
      '[외교부 해외안전여행](https://www.0404.go.kr/)',
    ].join('\n');
    const before = evaluateBlogEngineV2({
      blogHtml: markdown,
      primaryKeyword: '세부 가족여행',
      destination: '세부',
      generationMeta: {
        writer: 'info_writer',
        info_guide_brief: { official_sources_required: true },
        content_brief: { search_intent: 'family' },
      },
    });
    const repaired = repairBlogEngineV2Readiness({
      markdown,
      topic: '세부 가족여행',
      primaryKeyword: '세부 가족여행',
      destination: '세부',
      generationMeta: {
        writer: 'info_writer',
        info_guide_brief: { official_sources_required: true },
        content_brief: { search_intent: 'family' },
      },
      evaluation: before,
    });

    expect(repaired.markdown).not.toMatch(/안녕하세요|오늘은|이번\s*글에서는/);
  });

  it('does not rewrite image captions or html tags while repairing repeated sentences', () => {
    const markdown = [
      '# 세부 가족여행',
      '',
      '<figcaption>세부 여행 준비 장면 아이와 가족여행</figcaption>',
      '',
      '세부 가족여행은 숙소 위치와 이동 동선을 먼저 보면 됩니다. 세부 가족여행은 아이 컨디션과 물놀이 시간을 같이 봐야 합니다. 세부 가족여행은 출발 전 공식 안내를 확인하면 좋습니다.',
      '',
      '## 체크리스트',
      '| 항목 | 확인 기준 | 준비 |',
      '| --- | --- | --- |',
      '| 숙소 | 위치 | 이동 시간 |',
      '| 물놀이 | 날씨 | 수영복 |',
      '| 이동 | 차량 | 휴식 시간 |',
      '',
      '[외교부 해외안전여행](https://www.0404.go.kr/)',
    ].join('\n');
    const before = evaluateBlogEngineV2({
      blogHtml: markdown,
      primaryKeyword: '세부 가족여행',
      destination: '세부',
      generationMeta: {
        writer: 'info_writer',
        info_guide_brief: { official_sources_required: true },
        content_brief: { search_intent: 'family' },
      },
    });

    const repaired = repairBlogEngineV2Readiness({
      markdown,
      topic: '세부 가족여행',
      primaryKeyword: '세부 가족여행',
      destination: '세부',
      generationMeta: {
        writer: 'info_writer',
        info_guide_brief: { official_sources_required: true },
        content_brief: { search_intent: 'family' },
      },
      evaluation: before,
    });

    expect(repaired.markdown).toContain('<figcaption>세부 여행 준비 장면 아이와 가족여행</figcaption>');
    expect(repaired.markdown).not.toContain('또한 >');
    expect(repaired.markdown).not.toContain('또한 /figcaption');
  });

  it('removes broken html artifacts left by older sentence repairs', () => {
    const markdown = [
      '# 세부 가족여행',
      '',
      '세부 가족여행은 숙소 위치와 이동 동선을 먼저 보면 됩니다. 세부 가족여행은 아이 컨디션과 물놀이 시간을 같이 봐야 합니다.',
      '',
      '![세부 여행 준비](https://images.example.com/cebu.jpg)',
      '또한 >세부 여행 준비 장면 아이와 가족여행</figcaption>',
      '',
      '<aside class="blog-callout blog-callout-tip">',
      '<strong>읽는 순서</strong>',
      '<p>처음 읽는 분은 표와 체크리스트를 먼저 보면 됩니다.</p>',
      '</aside>',
      '',
      '또한 s="blog-callout blog-callout-tip">',
      '또한 순서</strong>',
      '또한 표와 체크리스트를 먼저 보면 됩니다.</p>',
      '</aside>',
      '',
      '## 체크리스트',
      '| 항목 | 확인 기준 | 준비 |',
      '| --- | --- | --- |',
      '| 숙소 | 위치 | 이동 시간 |',
      '| 물놀이 | 날씨 | 수영복 |',
      '| 이동 | 차량 | 휴식 시간 |',
      '',
      '[외교부 해외안전여행](https://www.0404.go.kr/)',
    ].join('\n');

    const before = evaluateBlogEngineV2({
      blogHtml: markdown,
      primaryKeyword: '세부 가족여행',
      destination: '세부',
      generationMeta: {
        writer: 'info_writer',
        info_guide_brief: { official_sources_required: true },
        content_brief: { search_intent: 'family' },
      },
    });
    const repaired = repairBlogEngineV2Readiness({
      markdown,
      topic: '세부 가족여행',
      primaryKeyword: '세부 가족여행',
      destination: '세부',
      generationMeta: {
        writer: 'info_writer',
        info_guide_brief: { official_sources_required: true },
        content_brief: { search_intent: 'family' },
      },
      evaluation: before,
    });

    expect(repaired.changes).toContain('engine_v2_broken_html_artifacts');
    expect(repaired.markdown).not.toContain('또한 >');
    expect(repaired.markdown).not.toContain('또한 s="blog-callout');
    expect(repaired.markdown).not.toContain('또한 순서</strong>');
    expect(repaired.markdown).toContain('<aside class="blog-callout blog-callout-tip">');
  });

  it('fills missing product consult brief fields and appends decision blocks', () => {
    const markdown = [
      '# 발리 4박5일 패키지',
      '',
      '발리 4박5일 상품은 가격과 일정을 먼저 확인하면 됩니다.',
      '',
      '## 포함/불포함',
      '| 구분 | 항목 | 확인 포인트 |',
      '| --- | --- | --- |',
      '| 포함 | 항공 | 상담 확인 |',
      '| 불포함 | 개인경비 | 상담 확인 |',
    ].join('\n');
    const before = evaluateBlogEngineV2({
      blogHtml: markdown,
      primaryKeyword: '발리 패키지',
      destination: '발리',
      contentType: 'package_intro',
      productId: 'pkg_123',
      generationMeta: {
        writer: 'product_consultant_writer',
        product_consult_brief: {
          included: ['항공'],
          excluded: ['개인경비'],
        },
      },
    });

    const repaired = repairBlogEngineV2Readiness({
      markdown,
      topic: '발리 4박5일 패키지',
      primaryKeyword: '발리 패키지',
      destination: '발리',
      productId: 'pkg_123',
      generationMeta: {
        writer: 'product_consultant_writer',
        product_consult_brief: {
          included: ['항공'],
          excluded: ['개인경비'],
        },
      },
      evaluation: before,
    });
    const after = evaluateBlogEngineV2({
      blogHtml: repaired.markdown,
      primaryKeyword: '발리 패키지',
      destination: '발리',
      contentType: 'package_intro',
      productId: 'pkg_123',
      generationMeta: repaired.generationMeta,
    });

    expect(before.metrics.product_decision_helpfulness).toBeLessThan(95);
    expect(repaired.changes).toContain('engine_v2_product_consult_brief');
    expect(repaired.changes).toContain('engine_v2_product_decision_blocks');
    expect(repaired.markdown).toContain('## 10초 판단');
    expect(after.metrics.product_decision_helpfulness).toBeGreaterThanOrEqual(95);
  });
});
