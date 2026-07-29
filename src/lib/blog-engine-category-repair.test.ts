import { describe, expect, it } from 'vitest';
import { evaluateBlogEngineV2 } from './blog-engine-v2';
import { repairBlogEngineCategoryGaps } from './blog-engine-category-repair';

describe('repairBlogEngineCategoryGaps', () => {
  it('replaces generic answer-first leads with topic-specific customer decisions', () => {
    const result = repairBlogEngineCategoryGaps({
      markdown: [
        '# 다낭 비자·입국 서류 필요 여부',
        '',
        '다낭 비자·입국 서류 필요 여부는 먼저 핵심 요약, 여행 전 확인 기준으로 보면 됩니다.',
        '',
        '## 확인 표',
        '| 항목 | 기준 | 메모 |',
        '| --- | --- | --- |',
        '| 여권 | 6개월 | 출발 전 확인 |',
        '| 숙소 | 예약 정보 | 입국 시 필요할 수 있음 |',
        '| 항공 | 영문 이름 | 여권과 일치 |',
        '',
        '## 공식 확인',
        '[외교부 해외안전여행](https://www.0404.go.kr/)',
      ].join('\n'),
      blogType: 'info',
      title: '다낭 비자·입국 서류 필요 여부',
      slug: 'danang-visa-entry-documents',
      destination: '다낭',
      primaryKeyword: '다낭 비자·입국 서류 필요 여부',
      generationMeta: { writer: 'info_writer' },
    });

    expect(result.markdown).not.toContain('핵심 요약, 여행 전 확인 기준으로 보면 됩니다');
    expect(result.markdown).toContain('출발 2주 전 무비자 가능 여부');
  });

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
    expect(result.markdown).toMatch(/몽골.*(?:날씨|옷차림|준비물|기온|비 예보)/);
    expect(result.markdown).not.toContain('날씨은');
    expect(result.markdown).toMatch(/https:\/\/(?:www\.)?0404\.go\.kr|https:\/\/www\.iatatravelcentre\.com/);
    expect(result.afterScore).toBeGreaterThan(result.beforeScore);
  });

  it('replaces old weather answer boilerplate before engine scoring', () => {
    const result = repairBlogEngineCategoryGaps({
      markdown: [
        '# 발리 7월 날씨',
        '',
        '발리 7월 날씨은 먼저 발리 7월 날씨 한눈에 보기, 7월 기온/강수/습도 표 기준으로 확인하면 됩니다.',
        '',
        '## 날씨 표',
        '| 구분 | 기준 | 준비 |',
        '| --- | --- | --- |',
        '| 낮 | 30℃ | 얇은 옷 |',
        '| 밤 | 24℃ | 얇은 겉옷 |',
        '| 비 | 소나기 | 우산 |',
      ].join('\n'),
      blogType: 'info',
      title: '발리 7월 날씨',
      slug: 'bali-weather-packing',
      destination: '발리',
      primaryKeyword: '발리 7월 날씨',
      contentType: 'guide',
      generationMeta: { writer: 'info_writer' },
    });

    expect(result.markdown).not.toContain('날씨은 먼저');
    expect(result.markdown).not.toContain('기준으로 확인하면 됩니다');
    expect(result.markdown).toMatch(/발리.*(?:출발 7일|출발 24시간|3가지)/);
    expect(result.afterScore).toBe(100);
  });

  it('removes the repetitive time-saving and budget-error claim from customer copy', () => {
    const result = repairBlogEngineCategoryGaps({
      markdown: [
        '# 캐나다 로키산맥 대중교통',
        '',
        '2026년 7월 기준, 비용과 이동 시간을 먼저 비교해야 합니다. 현지에서 1~2시간을 아끼고 예산 오차를 줄일 수 있습니다.',
        '',
        '## 노선 비교',
        '| 노선 | 요금 | 소요 시간 |',
        '| --- | --- | --- |',
        '| 8X | 12.50 CAD | 57분 |',
        '| 셔틀 | 12.75 CAD | 예약 확인 |',
        '',
        '## 이용 순서',
        '- 공식 시간표를 확인합니다.',
        '- 예약 가능 여부를 확인합니다.',
        '- 추가 수수료를 비교합니다.',
        '- 숙소와 정류장 거리를 확인합니다.',
        '- 막차 전에 복귀합니다.',
      ].join('\n'),
      blogType: 'info',
      title: '캐나다 로키산맥 대중교통',
      slug: 'canada-rockies-public-transport',
      destination: '캐나다 로키산맥',
      primaryKeyword: '캐나다 로키산맥 대중교통',
      contentType: 'guide',
      generationMeta: { writer: 'info_writer' },
    });

    expect(result.changes).toContain('engine_category_customer_language_surface');
    expect(result.markdown).not.toContain('1~2시간을 아끼고 예산 오차');
    expect(result.markdown).toContain('이동 조건과 추가 비용을 함께 확인하면');
    expect(result.afterScore).toBe(100);
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
