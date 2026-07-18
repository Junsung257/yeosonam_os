import { describe, expect, it } from 'vitest';

import { inspectBlogImageQuality, repairBlogImageQuality } from './blog-image-quality';

describe('blog-image-quality', () => {
  it('passes image-rich markdown with contextual alt and captions', () => {
    const markdown = [
      '## 장가계 월별 날씨',
      '![장가계 월별 날씨 풍경](https://images.pexels.com/photos/1/pexels-photo-1.jpeg)',
      '<figcaption>장가계 날씨와 옷차림을 함께 볼 수 있는 풍경</figcaption>',
      '## 장가계 추천 코스',
      '![장가계 추천 코스](https://images.pexels.com/photos/2/pexels-photo-2.jpeg)',
      '<figcaption>장가계 여행 코스 이미지</figcaption>',
      '## 준비물',
      '![장가계 준비물 체크](https://images.pexels.com/photos/3/pexels-photo-3.jpeg)',
    ].join('\n\n');

    const report = inspectBlogImageQuality(markdown, {
      destination: '장가계',
      primaryKeyword: '장가계 날씨',
      blogType: 'info',
    });

    expect(report.passed).toBe(true);
    expect(report.evidence.imageCount).toBe(3);
    expect(report.evidence.contextMatchedImages).toBeGreaterThan(0);
  });

  it('fails empty alt, duplicate urls, malformed Pexels urls, and no contextual text', () => {
    const markdown = [
      '## 본문',
      '![](https://images/pexels.com/photos/1/pexels-photo-1.jpeg)',
      '![image](https://images.pexels.com/photos/2/pexels-photo-2.jpeg)',
      '![풍경](https://images.pexels.com/photos/2/pexels-photo-2.jpeg)',
    ].join('\n\n');

    const report = inspectBlogImageQuality(markdown, {
      destination: '다낭',
      primaryKeyword: '다낭 날씨',
      blogType: 'info',
    });

    expect(report.passed).toBe(false);
    expect(report.evidence.issues).toEqual(expect.arrayContaining([
      'missing_alt',
      'generic_alt',
      'malformed_image_url',
      'duplicate_image_url',
      'no_contextual_alt_or_caption',
    ]));
  });

  it('requires at least two images for product posts and three for info posts', () => {
    const markdown = [
      '![다낭 상품 대표 이미지](https://images.pexels.com/photos/1/pexels-photo-1.jpeg)',
      '![다낭 호텔 이미지](https://images.pexels.com/photos/2/pexels-photo-2.jpeg)',
    ].join('\n\n');

    expect(inspectBlogImageQuality(markdown, {
      destination: '다낭',
      blogType: 'product',
    }).passed).toBe(true);

    expect(inspectBlogImageQuality(markdown, {
      destination: '다낭',
      blogType: 'info',
    }).evidence.issues).toContain('image_count_below_minimum');
  });

  it('does not require image captions to match generated slug fragments', () => {
    const markdown = [
      '![가족 여행 준비 풍경](https://images.pexels.com/photos/1/pexels-photo-1.jpeg)',
      '![공항 이동 체크 이미지](https://images.pexels.com/photos/2/pexels-photo-2.jpeg)',
      '![현지 일정 비교 사진](https://images.pexels.com/photos/3/pexels-photo-3.jpeg)',
    ].join('\n\n');

    const report = inspectBlogImageQuality(markdown, {
      primaryKeyword: 'june-family-travel-best-3',
      blogType: 'info',
    });

    expect(report.passed).toBe(true);
    expect(report.evidence.contextTokens).toEqual([]);
  });

  it('repairs image alt and captions with destination context', () => {
    const markdown = [
      '## 괌 이동 준비',
      '![image](https://images.pexels.com/photos/11/pexels-photo-11.jpeg)',
      '',
      '![여행 사진](https://images.pexels.com/photos/12/pexels-photo-12.jpeg)',
      '<figcaption>현지 풍경 이미지</figcaption>',
      '',
      '![렌터카 참고](https://images.pexels.com/photos/13/pexels-photo-13.jpeg)',
    ].join('\n');

    expect(inspectBlogImageQuality(markdown, {
      destination: '괌',
      primaryKeyword: '괌 렌터카 택시 픽업 이동비 비교',
      blogType: 'info',
    }).passed).toBe(false);

    const result = repairBlogImageQuality(markdown, {
      destination: '괌',
      primaryKeyword: '괌 렌터카 택시 픽업 이동비 비교',
      blogType: 'info',
    });

    expect(result.changed).toBe(true);
    expect(result.markdown).toContain('괌 렌터카 택시 픽업 이동비 비교 여행 준비 참고 이미지');
    expect(result.markdown).toContain('<figcaption>괌 렌터카 택시 픽업 이동비 비교 여행 준비와 현지 판단 기준을 함께 확인할 이미지입니다.</figcaption>');
    expect(inspectBlogImageQuality(result.markdown, {
      destination: '괌',
      primaryKeyword: '괌 렌터카 택시 픽업 이동비 비교',
      blogType: 'info',
    }).passed).toBe(true);
  });
});
