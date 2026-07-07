import { describe, expect, it } from 'vitest';
import { evaluateBlogEngineV2 } from './blog-engine-v2';
import { repairBlogEngineCategoryGaps } from './blog-engine-category-repair';

describe('repairBlogEngineCategoryGaps', () => {
  it('adds answer-first and official source support for weak information guides', () => {
    const markdown = [
      '# 몽골 7월 날씨',
      '',
      '오늘은 몽골 여행을 준비하는 분들을 위해 필요한 내용을 정리했습니다.',
      '',
      '## 준비 체크',
      '| 항목 | 확인 기준 | 메모 |',
      '| --- | --- | --- |',
      '| 낮 | 햇볕 | 모자 준비 |',
      '| 밤 | 일교차 | 겉옷 준비 |',
      '| 비 | 소나기 | 우비 준비 |',
    ].join('\n');

    const result = repairBlogEngineCategoryGaps({
      markdown,
      blogType: 'info',
      title: '몽골 7월 날씨',
      slug: 'mongolia-weather-july',
      destination: '몽골',
      primaryKeyword: '몽골 7월 날씨',
      contentType: 'guide',
      generationMeta: {
        writer: 'info_writer',
        info_guide_brief: {
          official_sources_required: true,
        },
      },
    });

    expect(result.changed).toBe(true);
    expect(result.changes).toEqual(expect.arrayContaining([
      'engine_category_reader_task_intro',
      'engine_category_evidence_links',
    ]));
    expect(result.markdown).toContain('몽골 7월 날씨에서 핵심은');
    expect(result.markdown).not.toContain('날씨은');
    expect(result.markdown).toMatch(/https:\/\/(?:www\.)?0404\.go\.kr|https:\/\/www\.iatatravelcentre\.com/);
    expect(result.afterScore).toBeGreaterThan(result.beforeScore);
  });

  it('adds missing product decision blocks from product brief evidence', () => {
    const markdown = [
      '# 푸꾸옥 4박6일 패키지',
      '',
      '부산 출발 푸꾸옥 4박6일 상품은 899,000원부터 기준으로 먼저 볼 수 있습니다.',
      '',
      '## 일정 개요',
      '- 항공과 숙소 조건은 문의 시점에 확인합니다.',
    ].join('\n');

    const result = repairBlogEngineCategoryGaps({
      markdown,
      blogType: 'product',
      title: '푸꾸옥 4박6일 패키지',
      slug: 'phuquoc-package',
      destination: '푸꾸옥',
      primaryKeyword: '푸꾸옥 패키지',
      contentType: 'package_intro',
      productId: 'pkg_1',
      generationMeta: {
        writer: 'product_consultant_writer',
        product_consult_brief: {
          price_from: 899000,
          departure_city: '부산',
          duration: '4박6일',
          included: ['왕복 항공', '호텔'],
          excluded: ['개인경비'],
          fit_for: ['가족 패키지를 비교하는 분'],
          not_fit_for: ['자유일정 중심 여행을 원하는 분'],
          risk_notes: ['항공 좌석과 객실 가능 여부에 따라 가격 변동'],
          consult_questions: ['출발일과 인원은 어떻게 되나요?'],
        },
      },
    });

    expect(result.changed).toBe(true);
    expect(result.changes).toContain('engine_category_product_decision_blocks');
    expect(result.markdown).toContain('## 10초 판단');
    expect(result.markdown).toContain('## 포함/불포함');
    expect(result.markdown).toContain('## 맞는 사람과 안 맞는 사람');
    expect(result.markdown).toContain('## 가격 변동 조건');
    expect(result.markdown).toContain('## 문의 전 질문');

    const evaluation = evaluateBlogEngineV2({
      blogHtml: result.markdown,
      primaryKeyword: '푸꾸옥 패키지',
      destination: '푸꾸옥',
      contentType: 'package_intro',
      productId: 'pkg_1',
      generationMeta: {
        writer: 'product_consultant_writer',
        product_consult_brief: {
          included: ['왕복 항공', '호텔'],
          excluded: ['개인경비'],
          fit_for: ['가족 패키지를 비교하는 분'],
          not_fit_for: ['자유일정 중심 여행을 원하는 분'],
          risk_notes: ['항공 좌석과 객실 가능 여부에 따라 가격 변동'],
          consult_questions: ['출발일과 인원은 어떻게 되나요?'],
        },
      },
    });
    expect(evaluation.metrics.product_decision_helpfulness).toBe(100);
  });
});
