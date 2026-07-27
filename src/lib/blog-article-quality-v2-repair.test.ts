import { describe, expect, it } from 'vitest';
import { repairArticleQualityV2Specifics } from './blog-article-quality-v2-repair';

describe('repairArticleQualityV2Specifics', () => {
  it('repairs stale confirmation dates that previously blocked daily quota recovery', () => {
    const result = repairArticleQualityV2Specifics(
      [
        '# 푸꾸옥 가족여행 경비표',
        '',
        '이 정보는 2024년 7월 8일 확인 기준으로 작성되었습니다.',
      ].join('\n'),
      'info',
    );

    expect(result.markdown).not.toContain('2024년 7월 8일 확인 기준');
    expect(result.markdown).toContain('출발 전 공식 안내 재확인 기준');
    expect(result.changes).toContain('article_v2_stale_confirmation_date_repaired');
  });

  it('replaces unsupported internal data claims with source-safe wording', () => {
    const result = repairArticleQualityV2Specifics(
      '여소남 내부 상품/예약 데이터 기준, 몽골 상품은 여러 가격대로 구성됩니다.',
      'info',
    );

    expect(result.markdown).not.toContain('여소남 내부 상품/예약 데이터 기준');
    expect(result.markdown).toContain('등록된 상품 정보 기준');
    expect(result.changes).toContain('article_v2_unsupported_internal_claim_repaired');
  });

  it('replaces readable unsupported internal review claims with public-source wording', () => {
    const result = repairArticleQualityV2Specifics(
      '여소남 검토 상품 가격대는 799,000원부터 시작합니다.',
      'info',
    );

    expect(result.markdown).not.toContain('여소남 검토');
    expect(result.markdown).toContain('확인 가능한 상품 가격대는 799,000원부터 시작합니다.');
    expect(result.changes).toContain('article_v2_unsupported_internal_claim_repaired');
  });

  it('removes hard sales CTA lines from the top of information posts', () => {
    const result = repairArticleQualityV2Specifics(
      [
        '# 세부 공항 이동',
        '',
        '카톡 무료 상담으로 바로 문의하세요.',
        '',
        '세부 공항 이동은 도착 시간과 숙소 위치를 먼저 보면 됩니다.',
        '',
        '## 판단표',
        '',
        '| 상황 | 확인 |',
        '| --- | --- |',
        '| 밤 도착 | 픽업 여부 |',
      ].join('\n'),
      'info',
    );

    expect(result.markdown).not.toContain('카톡 무료 상담');
    expect(result.markdown).toContain('세부 공항 이동은 도착 시간과 숙소 위치를 먼저 보면 됩니다.');
    expect(result.changes.some(change => change.startsWith('article_v2_top_sales_cta_removed_'))).toBe(true);
  });

  it('keeps product CTAs because product posts are expected to sell through consultation', () => {
    const source = [
      '# 나트랑 패키지',
      '',
      '상품 보기 전에 가격과 포함 항목을 확인하세요.',
    ].join('\n');
    const result = repairArticleQualityV2Specifics(source, 'product');

    expect(result.markdown).toBe(source);
    expect(result.changes).toEqual([]);
  });
});
