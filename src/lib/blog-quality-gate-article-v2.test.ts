import { describe, expect, it } from 'vitest';
import { checkArticleQualityV2 } from './blog-quality-gate';

describe('checkArticleQualityV2', () => {
  it('blocks info posts with broken surface text, unsupported internal claims, and stale confirmation dates', () => {
    const result = checkArticleQualityV2({
      blog_html: [
        '## 공식 확인 링크',
        '',
        '몽골 7월 날씨은 비용, 이동 시간, 현지 결제 조건을 먼저 확인해야 합니다.',
        '',
        '여소남 내부 상품/예약 데이터 기준으로 정리했습니다.',
        '',
        '이 정보는 2024년 6월 10일 확인 기준으로 작성되었습니다.',
        '',
        '## 공식 확인 링크',
        '',
        '> **',
      ].join('\n'),
      slug: 'mongolia-weather-packing',
      blog_type: 'info',
      primary_keyword: '몽골 7월 날씨 옷차림 여행 준비물',
      generation_meta: null,
    });

    expect(result.passed).toBe(false);
    expect(result.evidence?.issues).toEqual(
      expect.arrayContaining([
        'duplicate_heading:공식 확인 링크',
        'standalone_markdown_bold',
        'broken_korean_surface',
        'unsupported_internal_data_claim',
        'info_intro_intent_mismatch',
      ]),
    );
    expect(String(result.reason)).toContain('stale_confirmation_date');
  });

  it('blocks product posts that do not help customers make a pre-inquiry decision', () => {
    const result = checkArticleQualityV2({
      blog_html: [
        '## 상품 소개',
        '',
        '부산 출발 나트랑 패키지입니다. 지금 문의하면 자세히 안내해드립니다.',
      ].join('\n'),
      slug: 'nha-trang-package',
      blog_type: 'product',
      product_id: 'pkg_1',
      primary_keyword: '나트랑 패키지',
    });

    expect(result.passed).toBe(false);
    expect(result.evidence?.issues).toContain('product_decision_structure_missing');
  });
});
