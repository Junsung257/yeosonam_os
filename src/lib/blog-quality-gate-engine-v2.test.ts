import { describe, expect, it } from 'vitest';
import { checkBlogEngineV2 } from './blog-quality-gate';

describe('checkBlogEngineV2', () => {
  it('requires every engine category to reach 100 before publish', () => {
    const result = checkBlogEngineV2({
      blog_html: [
        '# 몽골 7월 날씨와 옷차림',
        '',
        '몽골 7월 날씨는 낮 햇볕, 밤 일교차, 갑작스러운 소나기를 함께 보고 옷을 겹쳐 입는 기준으로 준비하면 됩니다. 지금 상담을 바로 남기면 잔여 좌석도 확인할 수 있습니다.',
        '',
        '## 날씨 판단 기준',
        '| 항목 | 확인 기준 | 준비물 |',
        '| --- | --- | --- |',
        '| 낮 | 강한 햇볕 | 모자와 선글라스 |',
        '| 밤 | 큰 일교차 | 방풍 겉옷 |',
        '| 비 | 짧은 소나기 | 우비 또는 접이식 우산 |',
        '',
        '## 공식 확인',
        '[몽골 기상 정보](https://example.com/weather)',
      ].join('\n'),
      slug: 'mongolia-july-weather',
      blog_type: 'info',
      primary_keyword: '몽골 7월 날씨',
      destination: '몽골',
      generation_meta: {
        writer: 'info_writer',
        info_guide_brief: {
          reader_question: '몽골 7월 날씨와 옷차림은 어떻게 준비하나요?',
          answer_first: '낮/밤 일교차와 소나기를 기준으로 준비합니다.',
          official_sources_required: true,
        },
        content_brief: {
          search_intent: 'weather',
          evidence: ['기상 정보 확인 필요'],
        },
      },
    });

    expect(result.passed).toBe(false);
    expect(result.reason).toContain('sales_pressure');
    expect(result.reason).toContain('sales_pressure_control:45');
  });
});
