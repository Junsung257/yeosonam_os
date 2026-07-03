import { describe, expect, it } from 'vitest';
import { checkLength, checkLinks } from './blog-quality-gate';
import { repairPublishReadiness } from './blog-publish-readiness-repair';

describe('blog publish readiness repair', () => {
  it('adds support and internal CTA to thin info posts before publish gates', () => {
    const source = [
      '# 세부 쇼핑 예산 선물 리스트와 면세점 체크',
      '',
      '세부 쇼핑 예산은 선물, 면세점, 현지 마트 가격을 나눠서 보면 판단이 쉽습니다. '.repeat(45),
      '',
      '## 예산 체크',
      '',
      '| 항목 | 확인 기준 |',
      '| --- | --- |',
      '| 선물 | 수량과 무게 |',
      '| 면세점 | 출국장 재고 |',
      '| 마트 | 결제 수단 |',
      '',
      '## 공식 확인',
      '',
      '- [외교부 해외안전여행](https://www.0404.go.kr/)',
      '- [인천국제공항](https://www.airport.kr/)',
    ].join('\n');

    expect(checkLength(source, 'info').passed).toBe(false);
    expect(checkLinks(source).passed).toBe(false);

    const result = repairPublishReadiness({
      markdown: source,
      blogType: 'info',
      slug: 'cebu-shopping-budget-checklist',
      destination: '세부',
      topic: '세부 쇼핑 예산 선물 리스트와 면세점 체크',
      primaryKeyword: '세부 쇼핑 예산',
    });

    expect(result.changes).toEqual(expect.arrayContaining([
      'appended_publish_readiness_support',
      'appended_standard_internal_cta',
    ]));
    expect(checkLength(result.markdown, 'info').passed).toBe(true);
    expect(checkLinks(result.markdown).passed).toBe(true);
    expect(result.markdown).toContain('## 문의 전 최종 확인');
    expect(result.markdown).toContain('/packages?');
  });
});
